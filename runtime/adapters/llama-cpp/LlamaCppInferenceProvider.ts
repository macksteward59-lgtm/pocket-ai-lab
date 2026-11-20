/**
 * Local llama.cpp InferenceProvider.
 *
 * Built against the codex/gate-0-1-agent-engine contract (PR #1) while this
 * branch stays on main. generate() therefore returns both:
 *   - payload: structured stage object required by PR #1
 *   - text: raw backend text required by main's current InferenceResult
 * Extra fields are ignored by whichever orchestrator consumes the result.
 * The InferenceProvider interface is not modified here.
 *
 * Model output is untrusted. evidenceRefs and verification flags are copied
 * only when the model supplied them. They are not APEX receipts or approvals.
 */

import type { InferenceProvider, InferenceRequest } from "../../../packages/intelligence/orchestrator/Orchestrator";
import type { LlamaCppBackend, LlamaCppCompletionParams, LlamaCppServerInfo } from "./backend";
import { normalizeLlamaCppConfig, type LlamaCppProviderConfig, type LlamaCppProviderConfigInput } from "./config";
import { classifyAbort, isAbortError, LlamaCppInferenceError } from "./errors";
import { HttpLlamaCppBackend } from "./httpBackend";
import {
  isLlamaCppDeliberationStage,
  LLAMA_CPP_CHAT_ANALYSIS_MAX_LENGTH,
  LLAMA_CPP_STAGE_JSON_SCHEMAS,
  LLAMA_CPP_POLICY_REVIEW_JSON_SCHEMA
} from "./payloadSchema";
import { parseLlamaCppOutput } from "./parseOutput";
import { buildLlamaCppMessages, buildLlamaCppPrompt, isChatRequest, type LlamaCppChatMessage } from "./prompt";
import type { LlamaCppInferenceResult } from "./result";

export type { LlamaCppInferenceResult } from "./result";

export interface LlamaCppGenerateOptions {
  /** Honored by this adapter. Not yet part of InferenceProvider; see coordination log. */
  signal?: AbortSignal;
}

export interface LlamaCppStreamOptions extends LlamaCppGenerateOptions {
  /**
   * Receives the user-visible text decoded so far (for chat, the partial
   * `analysis` string). This is a preview only; the final result is still
   * schema-validated and may be rejected.
   */
  onPreview?: (text: string) => void;
  /** Called when a malformed attempt is discarded and a repair call begins. */
  onRetry?: (attempt: number, reason: string) => void;
}

export const LLAMA_CPP_PROVIDER_ID = "llama.cpp";

export interface InferenceProviderFactoryRegistry {
  register(id: string, factory: () => InferenceProvider): void;
}

export class LlamaCppInferenceProvider implements InferenceProvider {
  readonly config: LlamaCppProviderConfig;
  private readonly backend: LlamaCppBackend;

  constructor(config?: LlamaCppProviderConfigInput, backend?: LlamaCppBackend) {
    this.config = normalizeLlamaCppConfig(config ?? {});
    this.backend = backend ?? new HttpLlamaCppBackend(this.config);
  }

  async generate(
    request: InferenceRequest,
    options?: LlamaCppGenerateOptions
  ): Promise<LlamaCppInferenceResult> {
    return this.run(request, options, undefined);
  }

  /**
   * Same contract as generate(), but streams a live preview of the reply when
   * the backend supports streaming. The returned result is validated exactly
   * like generate(); a preview is never a substitute for it.
   */
  async generateStream(
    request: InferenceRequest,
    options?: LlamaCppStreamOptions
  ): Promise<LlamaCppInferenceResult> {
    return this.run(request, options, options);
  }

  /** Loaded-model metadata when the backend can report it. */
  async serverInfo(signal?: AbortSignal): Promise<LlamaCppServerInfo> {
    if (!this.backend.info) return {};
    const timeoutSignal = AbortSignal.timeout(Math.min(this.config.timeoutMs, 5000));
    const combined = signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal;
    try {
      return await this.backend.info(combined);
    } catch {
      return {};
    }
  }

  private async run(
    request: InferenceRequest,
    options: LlamaCppGenerateOptions | undefined,
    stream: LlamaCppStreamOptions | undefined
  ): Promise<LlamaCppInferenceResult> {
    assertRequest(request);
    if (!isLlamaCppDeliberationStage(request.stage)) {
      throw new LlamaCppInferenceError("invalid_request", "stage has no llama.cpp payload schema");
    }
    if (options?.signal?.aborted) {
      throw new LlamaCppInferenceError("cancelled", "Inference cancelled");
    }

    const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs);
    const signal = options?.signal
      ? AbortSignal.any([timeoutSignal, options.signal])
      : timeoutSignal;

    const chat = isChatRequest(request);
    const plainChat = chat && this.config.chatOutput === "text";
    const promptOptions = { plainChat };
    const aliases = !chat && this.config.aliasMessageIds ? MessageIdAliases.from(request) : undefined;
    const basePrompt = aliasText(buildLlamaCppPrompt(request, this.config.modelAlias, promptOptions), aliases);
    const baseMessages = this.config.promptFormat === "chat"
      ? buildLlamaCppMessages(request, this.config.modelAlias, promptOptions)
        .map(message => ({ ...message, content: aliasText(message.content, aliases) }))
      : undefined;
    const jsonSchema = plainChat ? undefined : aliasSchema(jsonSchemaFor(request), aliases);
    const stop = plainChat && !baseMessages
      ? [...(this.config.stop ?? []), "\nUser:"]
      : this.config.stop;

    let lastError: LlamaCppInferenceError | undefined;
    let previous: { content: string; reason: string } | undefined;
    for (let attempt = 0; attempt <= this.config.repairAttempts; attempt++) {
      if (attempt > 0 && previous) stream?.onRetry?.(attempt, previous.reason);
      const params: LlamaCppCompletionParams = {
        prompt: previous ? repairPrompt(basePrompt, previous, plainChat) : basePrompt,
        model: this.config.modelAlias ?? request.modelId,
        // A retry that repeats the same sampling tends to repeat the same
        // mistake, so each repair attempt samples a little more freely.
        temperature: attempt === 0
          ? this.config.temperature
          : Math.min(1, Math.round((this.config.temperature + 0.2 * attempt) * 100) / 100),
        maxTokens: chat || this.config.agentMaxTokens === undefined
          ? this.config.maxTokens
          : Math.min(this.config.maxTokens, this.config.agentMaxTokens),
        stop,
        seed: this.config.seed,
        jsonSchema
      };
      if (baseMessages) params.messages = previous ? repairMessages(baseMessages, previous, plainChat) : baseMessages;

      let content: string;
      try {
        if (stream?.onPreview && this.backend.completeStream) {
          const preview = plainChat
            ? new PlainTextPreview()
            : new StreamingFieldPreview(chat ? "analysis" : previewField(request.stage));
          const onPreview = stream.onPreview;
          const completion = await this.backend.completeStream(params, signal, delta => {
            const text = preview.push(delta);
            if (text !== undefined) onPreview(text);
          });
          content = completion.content;
        } else {
          const completion = await this.backend.complete(params, signal);
          content = completion.content;
        }
      } catch (error) {
        if (isAbortError(error) || signal.aborted) {
          throw classifyAbort(timeoutSignal, options?.signal, this.config.timeoutMs);
        }
        if (error instanceof LlamaCppInferenceError) throw error;
        throw new LlamaCppInferenceError(
          "backend_unreachable",
          "llama.cpp backend unreachable",
          { cause: error }
        );
      }

      try {
        if (plainChat) return parsePlainChatOutput(content);
        const parsed = parseLlamaCppOutput(
          request.stage,
          aliases ? aliases.restore(content) : content,
          request.responseContract
        );
        if (!chat && !request.responseContract && this.config.requireSubstantive) {
          assertSubstantiveStagePayload(request.stage, parsed.payload);
        }
        return parsed;
      } catch (error) {
        if (!(error instanceof LlamaCppInferenceError)) throw error;
        if (error.code !== "malformed_response" && error.code !== "empty_output") throw error;
        lastError = error;
        previous = { content, reason: error.message };
      }
    }
    throw lastError ?? new LlamaCppInferenceError("malformed_response", "llama.cpp output was rejected");
  }

  async checkHealth(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new LlamaCppInferenceError("cancelled", "Health check cancelled");
    }
    const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal;
    try {
      await this.backend.health(combined);
    } catch (error) {
      if (isAbortError(error) || combined.aborted) {
        throw classifyAbort(timeoutSignal, signal, this.config.timeoutMs);
      }
      if (error instanceof LlamaCppInferenceError) throw error;
      throw new LlamaCppInferenceError(
        "backend_unreachable",
        "llama.cpp backend unreachable",
        { cause: error }
      );
    }
  }
}

export function createLlamaCppInferenceProvider(
  config?: LlamaCppProviderConfigInput,
  backend?: LlamaCppBackend
): LlamaCppInferenceProvider {
  return new LlamaCppInferenceProvider(config, backend);
}

/**
 * Registers the factory on a caller-owned registry.
 * Orchestrator does not import this module; composition happens at the edge.
 */
export function registerLlamaCppInferenceProvider(
  registry: InferenceProviderFactoryRegistry,
  config?: LlamaCppProviderConfigInput
): void {
  registry.register(LLAMA_CPP_PROVIDER_ID, () => createLlamaCppInferenceProvider(config));
}

function jsonSchemaFor(request: InferenceRequest): Record<string, unknown> {
  if (request.responseContract === "bug-bounty-policy-review") {
    if (request.stage !== "independent") {
      throw new LlamaCppInferenceError("invalid_request", "bug-bounty policy review contract requires the independent stage");
    }
    return JSON.parse(JSON.stringify(LLAMA_CPP_POLICY_REVIEW_JSON_SCHEMA)) as Record<string, unknown>;
  }
  if (request.responseContract !== undefined) {
    throw new LlamaCppInferenceError("invalid_request", "unsupported inference response contract");
  }
  if (!isLlamaCppDeliberationStage(request.stage)) {
    throw new LlamaCppInferenceError("invalid_request", "stage has no llama.cpp payload schema");
  }
  const schema = JSON.parse(JSON.stringify(LLAMA_CPP_STAGE_JSON_SCHEMAS[request.stage])) as {
    properties: Record<string, unknown>;
  };
  if (isChatRequest(request)) {
    schema.properties.analysis = { type: "string", maxLength: LLAMA_CPP_CHAT_ANALYSIS_MAX_LENGTH };
  }
  const contextIds = [...new Set(request.contextMessages.map(message => message.messageId))];
  if ((request.stage === "synthesis" || request.stage === "challenge") && contextIds.length > 0) {
    // References must point at real transcript messages, not invented labels.
    schema.properties.evidenceRefs = {
      type: "array",
      maxItems: Math.min(8, contextIds.length),
      items: { type: "string", enum: contextIds }
    };
  }
  if (request.stage === "revision") {
    const ids = [...new Set(request.contextMessages.map(message => message.messageId))];
    schema.properties.addressesMessageIds = {
      type: "array",
      maxItems: ids.length,
      items: ids.length > 0 ? { type: "string", enum: ids } : { type: "string" }
    };
  }
  return schema;
}

function repairNote(previous: { content: string; reason: string }, plain = false): string {
  const shown = previous.content.length > 400 ? previous.content.slice(0, 400) + "…" : previous.content;
  return [
    "Your previous output was rejected: " + previous.reason,
    "Previous output: " + (shown.trim() || "(empty)"),
    plain
      ? "Try again. Write a direct, non-empty reply to the user's last message."
      : "Try again. Return only one valid JSON object with exactly the required fields."
  ].join("\n");
}

function repairPrompt(base: string, previous: { content: string; reason: string }, plain = false): string {
  return base + "\n\n" + repairNote(previous, plain);
}

function repairMessages(
  base: readonly LlamaCppChatMessage[],
  previous: { content: string; reason: string },
  plain = false
): LlamaCppChatMessage[] {
  return [
    ...base,
    { role: "assistant", content: previous.content.slice(0, 2000) || "(empty)" },
    { role: "user", content: repairNote(previous, plain) }
  ];
}

function previewField(stage: string): string {
  switch (stage) {
    case "cross-review": return "question";
    case "challenge": return "objection";
    case "revision": return "revision";
    case "verification": return "reason";
    case "synthesis": return "synthesis";
    default: return "analysis";
  }
}

/**
 * Small models copy long UUIDs into prose fields or mangle them. With
 * aliasMessageIds on, the model sees short labels (M1, M2, ...) instead, and
 * references are mapped back to the real ids before schema validation.
 * Unknown labels are left as-is, so the uuid schema still fails closed.
 */
class MessageIdAliases {
  private constructor(
    readonly toLabel: ReadonlyMap<string, string>,
    readonly toId: ReadonlyMap<string, string>
  ) {}

  static from(request: InferenceRequest): MessageIdAliases | undefined {
    const ids = [...new Set(request.contextMessages.map(message => message.messageId))];
    if (ids.length === 0) return undefined;
    const toLabel = new Map<string, string>();
    const toId = new Map<string, string>();
    ids.forEach((id, index) => {
      const label = `M${index + 1}`;
      toLabel.set(id, label);
      toId.set(label, id);
    });
    return new MessageIdAliases(toLabel, toId);
  }

  restore(content: string): string {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content.trim());
    } catch {
      return content;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return content;
    const record = { ...(parsed as Record<string, unknown>) };
    for (const key of ["addressesMessageIds", "evidenceRefs"]) {
      const value = record[key];
      if (Array.isArray(value)) {
        record[key] = value.map(item => typeof item === "string" ? this.toId.get(item.trim()) ?? item : item);
      }
    }
    return JSON.stringify(record);
  }
}

function aliasText(text: string, aliases: MessageIdAliases | undefined): string {
  if (!aliases) return text;
  let out = text;
  for (const [id, label] of aliases.toLabel) out = out.split(id).join(label);
  return out;
}

function aliasSchema(
  schema: Record<string, unknown>,
  aliases: MessageIdAliases | undefined
): Record<string, unknown> {
  if (!aliases) return schema;
  return JSON.parse(JSON.stringify(schema), (_key, value) =>
    typeof value === "string" ? aliases.toLabel.get(value) ?? value : value
  ) as Record<string, unknown>;
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const INSTRUCTION_ECHO = /\b(what to do now:|return only (a single|one)|required json object|output format:)/i;
const STAGE_MAIN_FIELD: Record<string, string> = {
  independent: "analysis",
  "cross-review": "question",
  challenge: "objection",
  revision: "revision",
  synthesis: "synthesis"
};

/**
 * Schema-valid is not the same as useful. Small models sometimes paste a
 * message id or a single token into the main text field. That output is
 * rejected (and may be repaired by a retry) instead of entering the
 * transcript. This only rejects; it never rewrites model text.
 */
export function assertSubstantiveStagePayload(stage: string, payload: unknown): void {
  const field = STAGE_MAIN_FIELD[stage];
  if (!field || !payload || typeof payload !== "object") return;
  const value = (payload as Record<string, unknown>)[field];
  if (typeof value !== "string") return;
  const prose = value.replace(UUID_PATTERN, " ");
  const words = prose.match(/[\p{L}]{2,}/gu) ?? [];
  if (INSTRUCTION_ECHO.test(value)) {
    throw new LlamaCppInferenceError(
      "malformed_response",
      `llama.cpp ${stage} output repeats the instructions instead of answering; write your own ${field}`
    );
  }
  if (words.length < 3) {
    throw new LlamaCppInferenceError(
      "malformed_response",
      `llama.cpp ${stage} output has no usable ${field} text; write the ${field} as plain sentences, not ids or labels`
    );
  }
}

/** Streams plain-text chat output as-is (leading whitespace trimmed). */
class PlainTextPreview {
  private raw = "";
  private last = "";
  push(delta: string): string | undefined {
    this.raw += delta;
    const text = this.raw.replace(/^\s+/, "");
    if (!text || text === this.last) return undefined;
    this.last = text;
    return text;
  }
}

/**
 * Plain-text chat replies become the independent-stage payload
 * {"analysis": text}. If the model emitted a JSON object anyway, its analysis
 * string is used. Empty output fails closed; nothing is invented.
 */
export function parsePlainChatOutput(content: string): LlamaCppInferenceResult {
  let text = typeof content === "string" ? content.trim() : "";
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && typeof (parsed as { analysis?: unknown }).analysis === "string") {
        text = ((parsed as { analysis: string }).analysis).trim();
      }
    } catch {
      // Not JSON: keep the prose as written.
    }
  }
  if (!text) {
    throw new LlamaCppInferenceError("empty_output", "llama.cpp returned empty output");
  }
  if (text.length > LLAMA_CPP_CHAT_ANALYSIS_MAX_LENGTH) {
    text = text.slice(0, LLAMA_CPP_CHAT_ANALYSIS_MAX_LENGTH).trimEnd() + "…";
  }
  return parseLlamaCppOutput("independent", JSON.stringify({ analysis: text }));
}

/**
 * Incrementally decodes one top-level JSON string field from a token stream,
 * so the UI can show the reply while the model is still writing it.
 * Returns undefined until the field begins.
 */
export class StreamingFieldPreview {
  private raw = "";
  private start = -1;
  private last = "";

  constructor(private readonly field: string) {}

  push(delta: string): string | undefined {
    this.raw += delta;
    if (this.start < 0) {
      const match = new RegExp('"' + this.field + '"\\s*:\\s*"').exec(this.raw);
      if (!match) return undefined;
      this.start = match.index + match[0].length;
    }
    const decoded = decodePartialJsonString(this.raw.slice(this.start));
    if (decoded === this.last) return undefined;
    this.last = decoded;
    return decoded;
  }
}

function decodePartialJsonString(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"') break;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) break;
    i++;
    switch (next) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": break;
      case "b": case "f": break;
      case "u": {
        const hex = body.slice(i + 1, i + 5);
        if (hex.length < 4) return out;
        if (/^[0-9a-fA-F]{4}$/.test(hex)) out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        break;
      }
      default: out += next;
    }
  }
  return out;
}

function assertRequest(request: InferenceRequest): void {
  if (!request || typeof request !== "object") {
    throw new LlamaCppInferenceError("invalid_request", "Inference request is required");
  }
  requireText(request.agentId, "agentId");
  requireText(request.modelId, "modelId");
  requireText(request.prompt, "prompt");
  requireText(request.stage, "stage");
  if (request.responseContract !== undefined &&
      (request.responseContract !== "bug-bounty-policy-review" ||
       request.stage !== "independent" || request.agentId === "chat")) {
    throw new LlamaCppInferenceError(
      "invalid_request",
      "the bug-bounty policy-review response contract requires a non-chat independent-stage request"
    );
  }
  if (!isLlamaCppDeliberationStage(request.stage)) {
    throw new LlamaCppInferenceError(
      "invalid_request",
      `stage ${JSON.stringify(request.stage)} has no llama.cpp payload schema`
    );
  }
  if (!Array.isArray(request.contextMessages)) {
    throw new LlamaCppInferenceError("invalid_request", "contextMessages must be an array");
  }
  if (request.conversation !== undefined) {
    if (!Array.isArray(request.conversation)) {
      throw new LlamaCppInferenceError("invalid_request", "conversation must be an array");
    }
    for (const turn of request.conversation) {
      if (!turn || (turn.role !== "user" && turn.role !== "assistant") || typeof turn.content !== "string") {
        throw new LlamaCppInferenceError("invalid_request", "conversation turns need a user/assistant role and string content");
      }
    }
  }
  if (request.memoryContext !== undefined) {
    if (!Array.isArray(request.memoryContext) ||
        !request.memoryContext.every(item => item && typeof item.id === "string" && typeof item.content === "string")) {
      throw new LlamaCppInferenceError("invalid_request", "memoryContext must be an array of {id, content}");
    }
  }
}

function requireText(value: unknown, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LlamaCppInferenceError("invalid_request", `${name} must be a non-empty string`);
  }
}
