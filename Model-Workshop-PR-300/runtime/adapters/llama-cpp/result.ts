/**
 * Dual result shape.
 * `payload` satisfies the PR #1 InferenceResult.
 * `text` satisfies main's current InferenceResult.
 * Both come from the same backend response; neither is invented.
 */

export interface LlamaCppInferenceResult {
  /** Main contract: exact backend text for this call. */
  text: string;
  /** PR #1 contract: schema-checked stage payload. */
  payload: unknown;
  evidenceRefs?: string[];
  /** Copied only when the model payload included a finite confidence number. */
  confidence?: number;
}
