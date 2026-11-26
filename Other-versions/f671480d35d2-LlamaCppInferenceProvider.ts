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
import type { LlamaCppBackend } from "./backend";
import { normalizeLlamaCppConfig, type LlamaCppProviderConfig, type LlamaCppProviderConfigInput } from "./config";
import { classifyAbort, isAbortError, LlamaCppInferenceError } from "./errors";
import { HttpLlamaCppBackend } from "./httpBackend";
import { isLlamaCppDeliberationStage, LLAMA_CPP_STAGE_JSON_SCHEMAS } from "./payloadSchema";
import { parseLlamaCppOutput } from "./parseOutput";
import { buildLlamaCppPrompt } from "./prompt";
import type { LlamaCppInferenceResult } from "./result";

export type { LlamaCppInferenceResult } from "./result";

export interface LlamaCppGenerateOptions {
  /** Honored by this adapter. Not yet part of InferenceProvider; see coordination log. */
  signal?: AbortSignal;
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

    let content: string;
    try {
      const completion = await this.backend.complete({
        prompt: buildLlamaCppPrompt(request, this.config.modelAlias),
        model: this.config.modelAlias ?? request.modelId,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
        stop: this.config.stop,
        seed: this.config.seed,
        jsonSchema: jsonSchemaFor(request)
      }, signal);
      content = completion.content;
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

    return parseLlamaCppOutput(request.stage, content);
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
  if (!isLlamaCppDeliberationStage(request.stage)) {
    throw new LlamaCppInferenceError("invalid_request", "stage has no llama.cpp payload schema");
  }
  const schema = JSON.parse(JSON.stringify(LLAMA_CPP_STAGE_JSON_SCHEMAS[request.stage])) as {
    properties: Record<string, unknown>;
  };
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

function assertRequest(request: InferenceRequest): void {
  if (!request || typeof request !== "object") {
    throw new LlamaCppInferenceError("invalid_request", "Inference request is required");
  }
  requireText(request.agentId, "agentId");
  requireText(request.modelId, "modelId");
  requireText(request.prompt, "prompt");
  requireText(request.stage, "stage");
  if (!isLlamaCppDeliberationStage(request.stage)) {
    throw new LlamaCppInferenceError(
      "invalid_request",
      `stage ${JSON.stringify(request.stage)} has no llama.cpp payload schema`
    );
  }
  if (!Array.isArray(request.contextMessages)) {
    throw new LlamaCppInferenceError("invalid_request", "contextMessages must be an array");
  }
}

function requireText(value: unknown, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LlamaCppInferenceError("invalid_request", `${name} must be a non-empty string`);
  }
}
