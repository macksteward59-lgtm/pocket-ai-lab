import type { InferenceProvider, InferenceRequest, InferenceResult } from "../../orchestrator/Orchestrator";
import { CLOUD_ANALYSIS_LIMITS, CloudAnalysisFailure, type CloudAnalysisUsage } from "./types";
import { isBoundedText, isIdentifier, isObject, readBoundedJSON, withAbort } from "./validation";

export const DEEPSEEK_ANALYSIS_ENDPOINT = "https://api.deepseek.com/chat/completions";
export const DEEPSEEK_ANALYSIS_MODELS = ["deepseek-flash", "deepseek-v4-pro"] as const;
export type DeepSeekAnalysisModel = typeof DEEPSEEK_ANALYSIS_MODELS[number];

export interface DeepSeekAnalysisOptions {
  enabled: true;
  apiKey: string;
  model: DeepSeekAnalysisModel;
  /** Explicit provider-reported identities; aliases are not immutable weight attestations. */
  acceptedResponseModels?: readonly string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface CloudAnalysisInferenceResult extends InferenceResult {
  payload: { analysis: string };
  providerID: "deepseek";
  requestedModel: string;
  actualModel: string;
  providerResponseID: string;
  usage: CloudAnalysisUsage;
  finishReason: "stop";
}

export interface CloudAnalysisGenerateOptions {
  signal?: AbortSignal;
  maxOutputTokens?: number;
}

/**
 * One approved text input, one non-streaming provider call, and no tools or retries.
 * Implements the existing provider abstraction without broadening its shared contract.
 */
export class DeepSeekAnalysisProvider implements InferenceProvider {
  readonly requestedModel: DeepSeekAnalysisModel;
  readonly providerID = "deepseek" as const;
  private readonly apiKey: string;
  private readonly acceptedResponseModels: ReadonlySet<string>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DeepSeekAnalysisOptions) {
    if (options?.enabled !== true) throw new Error("Cloud analysis must be explicitly enabled.");
    if (typeof options.apiKey !== "string" || !options.apiKey.trim() || /[\r\n]/.test(options.apiKey)) {
      throw new Error("A server-held provider credential is required.");
    }
    if (!(DEEPSEEK_ANALYSIS_MODELS as readonly string[]).includes(options.model)) {
      throw new Error("Unsupported cloud analysis model profile.");
    }
    const accepted = options.acceptedResponseModels ?? [options.model];
    if (!Array.isArray(accepted) || accepted.length < 1 || accepted.length > 8 || !accepted.every(isIdentifier)) {
      throw new Error("Explicit bounded response model identities are required.");
    }
    const timeout = options.timeoutMs ?? CLOUD_ANALYSIS_LIMITS.timeoutMs;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > CLOUD_ANALYSIS_LIMITS.timeoutMs) {
      throw new Error("Cloud analysis timeout is outside the supported limit.");
    }
    this.requestedModel = options.model;
    this.apiKey = options.apiKey;
    this.acceptedResponseModels = new Set(accepted);
    this.timeoutMs = timeout;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(request: InferenceRequest, options: CloudAnalysisGenerateOptions = {}): Promise<CloudAnalysisInferenceResult> {
    const maxOutputTokens = options.maxOutputTokens ?? CLOUD_ANALYSIS_LIMITS.outputTokens;
    if (!request || request.agentId !== "cloud-analysis" || request.stage !== "independent" ||
        request.modelId !== this.requestedModel || !Array.isArray(request.contextMessages) ||
        request.contextMessages.length !== 0 || request.conversation !== undefined || request.memoryContext !== undefined ||
        !isBoundedText(request.prompt, CLOUD_ANALYSIS_LIMITS.inputBytes) ||
        !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > CLOUD_ANALYSIS_LIMITS.outputTokens) {
      throw new CloudAnalysisFailure("invalid_request");
    }
    if (options.signal?.aborted) throw new CloudAnalysisFailure("cancelled");

    const controller = new AbortController();
    let timedOut = false;
    const onCancel = () => controller.abort();
    options.signal?.addEventListener("abort", onCancel, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      // No task identity, credential, consent metadata, earlier messages or memory is forwarded.
      const response = await withAbort(this.fetchImpl(DEEPSEEK_ANALYSIS_ENDPOINT, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        headers: {
          authorization: "Bearer " + this.apiKey,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({
          model: this.requestedModel,
          messages: [{ role: "user", content: request.prompt }],
          reasoning_effort: "none",
          stream: false,
          max_tokens: maxOutputTokens,
          tool_choice: "none"
        }),
        signal: controller.signal
      }), controller.signal);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new CloudAnalysisFailure("upstream_failed");
      }
      if (response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
        void response.body?.cancel().catch(() => {});
        throw new CloudAnalysisFailure("invalid_response");
      }
      const value = await readBoundedJSON(
        response.body, CLOUD_ANALYSIS_LIMITS.providerResponseBytes, controller.signal, "invalid_response"
      );
      if (controller.signal.aborted) throw new CloudAnalysisFailure("cancelled");
      return this.parseResponse(value, maxOutputTokens);
    } catch (error) {
      if (timedOut) throw new CloudAnalysisFailure("upstream_timeout");
      if (options.signal?.aborted) throw new CloudAnalysisFailure("cancelled");
      if (error instanceof CloudAnalysisFailure) throw error;
      throw new CloudAnalysisFailure("upstream_failed");
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onCancel);
    }
  }

  private parseResponse(value: unknown, maxOutputTokens: number): CloudAnalysisInferenceResult {
    const invalid = () => { throw new CloudAnalysisFailure("invalid_response"); };
    if (!isObject(value) || !isIdentifier(value.id) || !isIdentifier(value.model) ||
        !this.acceptedResponseModels.has(value.model) || value.object !== "chat.completion" ||
        !Array.isArray(value.choices) || value.choices.length !== 1 || !isObject(value.usage)) return invalid();
    const choice = value.choices[0];
    if (!isObject(choice) || choice.index !== 0 || choice.finish_reason !== "stop" || !isObject(choice.message)) return invalid();
    const message = choice.message;
    if (message.role !== "assistant" || !isBoundedText(message.content, CLOUD_ANALYSIS_LIMITS.outputBytes)) return invalid();
    // The text-only profile does not request tools or reasoning output. Fail on a changed mode.
    for (const key of ["tool_calls", "server_tool_calls"]) {
      if (message[key] !== undefined && message[key] !== null &&
          (!Array.isArray(message[key]) || (message[key] as unknown[]).length !== 0)) return invalid();
    }
    if (message.reasoning_content !== undefined && message.reasoning_content !== null && message.reasoning_content !== "") return invalid();
    const usage = value.usage;
    for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
      if (!Number.isSafeInteger(usage[key]) || Number(usage[key]) < 0) return invalid();
    }
    const promptTokens = Number(usage.prompt_tokens);
    const completionTokens = Number(usage.completion_tokens);
    const totalTokens = Number(usage.total_tokens);
    if (completionTokens > maxOutputTokens || !Number.isSafeInteger(promptTokens + completionTokens) ||
        totalTokens !== promptTokens + completionTokens) return invalid();
    return {
      payload: { analysis: message.content },
      providerID: this.providerID,
      requestedModel: this.requestedModel,
      actualModel: value.model,
      providerResponseID: value.id,
      usage: { promptTokens, completionTokens, totalTokens },
      finishReason: "stop"
    };
  }
}
