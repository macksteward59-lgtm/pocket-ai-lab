/**
 * Backend seam. HttpLlamaCppBackend talks to llama-server today.
 * A native binding can implement this without changing the orchestrator.
 */
import type { LlamaCppChatMessage } from "./prompt";

export interface LlamaCppFunctionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export type LlamaCppToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

export interface LlamaCppToolCall {
  id?: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface LlamaCppCompletionParams {
  /** Flat prompt. Always present so any backend can fall back to it. */
  prompt: string;
  /** Optional chat messages rendered with the model's chat template. */
  messages?: readonly LlamaCppChatMessage[];
  model: string;
  temperature: number;
  maxTokens: number;
  stop?: readonly string[];
  seed?: number;
  /** Passed to llama-server as json_schema. Absence means unconstrained text. */
  jsonSchema?: Record<string, unknown>;
  /** OpenAI-compatible function definitions. Supported by chat API only. */
  tools?: readonly LlamaCppFunctionTool[];
  /** Tool selection policy. Supported by chat API only. */
  toolChoice?: LlamaCppToolChoice;
}

export interface LlamaCppCompletionResult {
  /** Exact text returned by the backend. Empty when a tool call is returned. */
  content: string;
  /** Structured function calls returned by the OpenAI-compatible chat API. */
  toolCalls?: readonly LlamaCppToolCall[];
}

export interface LlamaCppServerInfo {
  modelName?: string;
  contextLength?: number;
  hasChatTemplate?: boolean;
}

export interface LlamaCppBackend {
  complete(params: LlamaCppCompletionParams, signal: AbortSignal): Promise<LlamaCppCompletionResult>;
  health(signal: AbortSignal): Promise<void>;
  completeStream?(
    params: LlamaCppCompletionParams,
    signal: AbortSignal,
    onDelta: (text: string) => void
  ): Promise<LlamaCppCompletionResult>;
  info?(signal: AbortSignal): Promise<LlamaCppServerInfo>;
}
