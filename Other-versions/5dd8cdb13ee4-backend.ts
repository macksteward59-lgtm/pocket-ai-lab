/**
 * Backend seam. HttpLlamaCppBackend talks to llama-server today.
 * A native binding (for example node-llama-cpp) can implement this later
 * without changing InferenceProvider or the orchestrator.
 */

export interface LlamaCppCompletionParams {
  prompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  stop?: readonly string[];
  seed?: number;
}

export interface LlamaCppCompletionResult {
  /** Exact text returned by the backend. Empty string is a failure, not a result. */
  content: string;
}

export interface LlamaCppBackend {
  complete(params: LlamaCppCompletionParams, signal: AbortSignal): Promise<LlamaCppCompletionResult>;
  health(signal: AbortSignal): Promise<void>;
}
