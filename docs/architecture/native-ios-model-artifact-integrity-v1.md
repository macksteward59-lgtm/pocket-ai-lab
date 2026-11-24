# Native iOS Model Artifact Integrity v1

## Purpose

Bind a loaded native model session to the exact GGUF bytes that were imported. This provides local artifact integrity and stable content identity. It does not establish publisher authenticity, model provenance, runtime attestation, or action authorization.

## Import contract

1. Accept only a .gguf filename.
2. Copy external input into a same-directory staging file on a utility task.
3. Validate the four-byte GGUF magic prefix.
4. Stream the staged file through SHA-256 in 1 MiB chunks while counting bytes; the whole model is never loaded into memory for hashing.
5. Only after header validation and hashing succeed, atomically replace the destination or move the staged file into place.
6. If copy, header validation, or hashing fails, preserve the previous destination and selected model state.
7. If the selected source already resolves to the destination path, do not copy or delete it; validate and fingerprint it in place.

The importer returns the destination URL plus {sha256, byteCount}.

## Load contract

- The app recomputes the fingerprint before disturbing an existing loaded session.
- A changed or unreadable file is rejected; the stale session is unloaded rather than silently used under a different selected-artifact identity.
- The ModelDescriptor.id is content-addressed as sha256- followed by the lowercase digest.
- After native load returns, the app fingerprints the file again. If the file changed while llama.cpp was loading it, the new session is immediately unloaded and no session is retained.
- The app displays a shortened digest and byte count as local integrity metadata.
- Runtime trust remains Unverified. A content hash is not a signed runtime proof.

## Security and resource boundaries

- Hashing is streaming and bounded to a 1 MiB read buffer.
- The GGUF check is only a magic-prefix check. llama.cpp remains responsible for full format parsing.
- SHA-256 detects byte changes relative to the imported artifact but does not say who produced the file or whether its contents are safe.
- No model file is encrypted at rest by this change.
- The file is not continuously rehashed during generation. Once the engine has loaded a model, inference uses that in-memory session; a later file change is detected on the next load attempt.
- This mechanism does not provision trusted keys, issue runtime proofs, establish device attestation, or modify APEX/East authorization.

## Validation

Tests cover a known SHA-256 vector, content-addressed session IDs, mutation after import, mutation during native load, preservation of the prior file after invalid replacement, and existing same-file import behavior.

CI and simulator success do not prove physical iPhone performance or Metal execution. Physical-device acceptance remains separate.
