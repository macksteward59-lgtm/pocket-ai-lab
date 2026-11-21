/** Host-selected source generation. Returned code is an untrusted candidate, never an execution grant. */
export interface CodeGenerationRequest {
  readonly modelId: string;
  readonly language: "python";
  readonly prompt: string;
  readonly maxSourceBytes: number;
  /** Explicit prompt refinement; omission preserves the original source-contract instructions. */
  readonly promptStyle?: "schema-only";
}

export interface CodeGenerationResult {
  /** Exact decoded source field. Providers must not repair, trim, or substitute source. */
  readonly source: string;
  /** Exact backend message content, before parsing the source field; not the original HTTP body. */
  readonly rawOutput: string;
}
