/**
 * Public entry for the local llama.cpp adapter.
 * Import this module from the composition root. Do not import it from
 * Orchestrator, DeliberationEngine, MessageBus, or ModelRouter.
 */

export {
  LlamaCppInferenceProvider,
  createLlamaCppInferenceProvider,
  registerLlamaCppInferenceProvider,
  LLAMA_CPP_PROVIDER_ID
} from "./LlamaCppInferenceProvider";
export type {
  LlamaCppGenerateOptions,
  InferenceProviderFactoryRegistry
} from "./LlamaCppInferenceProvider";
export type { LlamaCppInferenceResult } from "./result";
export { LlamaCppInferenceError } from "./errors";
export type { LlamaCppErrorCode } from "./errors";
export { LLAMA_CPP_DEFAULTS, normalizeLlamaCppConfig } from "./config";
export type {
  LlamaCppApiMode,
  LlamaCppProviderConfig,
  LlamaCppProviderConfigInput
} from "./config";
export type {
  LlamaCppBackend,
  LlamaCppCompletionParams,
  LlamaCppCompletionResult
} from "./backend";
export { HttpLlamaCppBackend } from "./httpBackend";
