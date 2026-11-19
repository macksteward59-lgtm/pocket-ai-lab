# Native iOS Model Artifact Integrity v1

## Purpose

Bind a pooled native model session to the exact imported GGUF bytes. The fingerprint provides local content identity and detects byte changes at import/load boundaries. It does not establish publisher authenticity, provenance, runtime attestation, or action authorization.

## Import contract

1. Accept only a `.gguf` filename.
2. Copy external input into a same-directory staging file.
3. Validate a 24-byte minimum GGUF header: magic, little-endian version (currently v1-v3), tensor-count field, and metadata-entry-count field.
4. Stream the staged file through SHA-256 in 1 MiB chunks while counting bytes; never load the whole file into memory for hashing.
5. Replace or move the staged artifact only after header validation and hashing succeed.
6. Preserve the prior destination and selected artifact when copy, validation, or hashing fails.
7. If the selected source already resolves to the destination, validate and fingerprint it in place without copying/deleting itself.

The importer returns the destination URL plus sha256 and byteCount.

## Load contract

- Recompute the fingerprint before changing a currently loaded session.
- If the file changed or became unreadable, reject loading and unload any stale session associated with that selected artifact.
- Set ModelDescriptor.id to sha256- plus the lowercase digest.
- After native load returns, fingerprint the file again. If it changed during loading, release the exact ModelPool lease, unload the just-loaded session, and retain no lease.
- Show a shortened digest and byte count as local integrity metadata.
- Runtime trust remains Unverified; a content hash is not a signed runtime proof.

## Boundaries

- Hashing uses a bounded 1 MiB read buffer.
- The 24-byte header check is a minimum structural guard, not a complete GGUF parser. llama.cpp remains responsible for full metadata/tensor parsing.
- SHA-256 detects changes relative to the imported artifact; it does not identify who produced it or prove the model is safe.
- The file is not encrypted at rest and is not continuously rehashed during generation.
- No key provisioning, runtime proof verification, device attestation, APEX authorization, or East/e3 execution authority is added.
- Model output remains untrusted proposal data.

## Regression coverage

- Truncated and unsupported-version GGUF headers are rejected.
- Failed staged import preserves the last known-good file.
- Same-path import does not delete/copy onto itself.
- Session model IDs are content-addressed.
- File mutation after import prevents native load.
- File mutation during native load causes the acquired session to be released and unloaded.

Simulator/host CI is not physical iPhone acceptance. Device memory, thermal, battery, and Metal behavior remain separate validation gates.