/**
 * Public entry for the local llama.cpp adapter.
 * Import this module from the composition root. Do not import it from
 * Orchestrator, DeliberationEngine, MessageBus, or ModelRouter.
 */

export {
  LlamaCppInferenceProvider,
  createLlamaCppInferenceProvider,
  registerLlamaCppInferenceProvider,
  LLAMA_CPP_PROVIDER_ID,
  StreamingFieldPreview,
  parsePlainChatOutput,
  assertSubstantiveStagePayload
} from "./LlamaCppInferenceProvider";
export type {
  LlamaCppGenerateOptions,
  LlamaCppStreamOptions,
  InferenceProviderFactoryRegistry
} from "./LlamaCppInferenceProvider";
export type { LlamaCppInferenceResult } from "./result";
export { LlamaCppInferenceError } from "./errors";
export type { LlamaCppErrorCode } from "./errors";
export { LLAMA_CPP_DEFAULTS, normalizeLlamaCppConfig } from "./config";
export type {
  LlamaCppApiMode,
  LlamaCppChatOutput,
  LlamaCppPromptFormat,
  LlamaCppProviderConfig,
  LlamaCppProviderConfigInput
} from "./config";
export type {
  LlamaCppBackend,
  LlamaCppCompletionParams,
  LlamaCppCompletionResult,
  LlamaCppServerInfo,
  LlamaCppFunctionTool,
  LlamaCppToolChoice,
  LlamaCppToolCall
} from "./backend";
export { buildLlamaCppMessages, buildLlamaCppPrompt } from "./prompt";
export type { LlamaCppChatMessage, LlamaCppPromptOptions } from "./prompt";
export { HttpLlamaCppBackend } from "./httpBackend";

export { LlamaCppDirectorCommandProvider } from "./DirectorCommandProvider";
