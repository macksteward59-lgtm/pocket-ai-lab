/**
 * Backend seam. HttpLlamaCppBackend talks to llama-server today.
 * A native binding (for example node-llama-cpp) can implement this later
 * without changing InferenceProvider or the orchestrator.
 */

import type { LlamaCppChatMessage } from "./prompt";

export interface LlamaCppCompletionParams {
  /** Flat prompt. Always present so any backend can fall back to it. */
  prompt: string;
  /**
   * Optional chat messages. When present, a backend that can apply the
   * model's chat template should prefer them over `prompt`.
   */
  messages?: readonly LlamaCppChatMessage[];
  model: string;
  temperature: number;
  maxTokens: number;
  stop?: readonly string[];
  seed?: number;
  /** Passed to llama-server as json_schema. Absence means unconstrained text. */
  jsonSchema?: Record<string, unknown>;
}

export interface LlamaCppCompletionResult {
  /** Exact text returned by the backend. Empty string is a failure, not a result. */
  content: string;
}

export interface LlamaCppServerInfo {
  /** File name of the loaded model, when the server reports it. */
  modelName?: string;
  /** Context window size reported by the server. */
  contextLength?: number;
  /** True when the server reports a chat template for the loaded model. */
  hasChatTemplate?: boolean;
}

export interface LlamaCppBackend {
  complete(params: LlamaCppCompletionParams, signal: AbortSignal): Promise<LlamaCppCompletionResult>;
  health(signal: AbortSignal): Promise<void>;
  /**
   * Optional token streaming. `onDelta` receives raw text pieces as they
   * arrive; the resolved content is the full concatenated text.
   */
  completeStream?(
    params: LlamaCppCompletionParams,
    signal: AbortSignal,
    onDelta: (text: string) => void
  ): Promise<LlamaCppCompletionResult>;
  /** Optional server metadata. Never required for inference. */
  info?(signal: AbortSignal): Promise<LlamaCppServerInfo>;
}
