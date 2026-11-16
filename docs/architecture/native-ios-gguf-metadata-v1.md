# Native GGUF metadata inspection

## Implementation

The iOS bridge calls the GGUF parser from the repository's pinned llama.cpp build (tag b12233, commit `5f490d7bfe78844e6390c869454c149fd7e003a8`). It uses `gguf_init_from_file` with `no_alloc = true`, so tensor weights are not allocated for catalog inspection.

The bridge returns bounded fields:
- GGUF version and metadata-key count
- `general.architecture`
- architecture-specific `<architecture>.context_length`, when present
- `general.name` and `tokenizer.ggml.model`, when present and bounded
- `general.file_type`, as a raw numeric code only
- `general.parameter_count`, when present
- file size from the filesystem

The parser rejects missing/non-regular files, artifacts larger than 128 GiB, metadata tables with more than 65,536 keys, missing architecture, invalid numeric values, and malformed/unreadable GGUF input. The caller must run inspection away from the UI thread.

## Interpretation limits

- A raw `general.file_type` integer is not converted to a guessed quantization label.
- Training context is a model-declared maximum, not a promise that the current runtime loaded that context.
- Tokenizer metadata identifies a declared tokenizer model only; it does not establish prompt-template correctness.
- Architecture, parameter count, tokenizer, and file type do not prove reasoning, coding, vision, tool-use, or other task competence.
- This metadata does not establish authenticity, provenance, safety, runtime readiness, attestation, or authorization.
- Unknown fields remain unknown; the model catalog must not substitute filename guesses.

## Validation

Unit tests cover absent files, directories, and preservation of unknown optional fields. The pinned native build must additionally compile the C bridge and run the native test suite. A known-good smoke GGUF integration test is the next validation increment.
