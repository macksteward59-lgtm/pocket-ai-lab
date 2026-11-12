# Bug Bounty Policy Intake Provenance

This module captures policy text supplied by an operator or UI and records content identity. It intentionally does not fetch a URL.

## Capture contract

- HTTPS source URL with no embedded credentials.
- Explicit timezone-bearing retrieval timestamp.
- Plain text or Markdown only.
- Non-empty policy text, no null bytes, maximum 512 KiB.
- SHA-256 is computed over the exact UTF-8 text. The original text is retained unchanged.
- Snapshot records and comparison results are immutable and always carry `authorized: false`.

## Version comparison

Snapshots may be compared only when program ID, platform, and canonical source URL match.

- `unchanged`: identical content hash and non-regressing retrieval time.
- `changed`: content hash differs and retrieval time is later; requires re-extraction and human review.
- `timestamp-conflict`: different content has the same retrieval timestamp; retain both and resolve provenance.
- `out-of-order`: current retrieval timestamp predates the previous snapshot; do not silently promote it.

## Security and trust limitations

A SHA-256 digest proves only that two captured text values are byte-identical; it does not prove who published the text, that the source URL was actually visited, or that the policy is authentic/current. The timestamp is supplied by the caller and is not a trusted clock attestation. The module has no HTTP client, browser, crawler, persistence layer, credential store, parser, scanner, or execution adapter.

The intake output is untrusted source material. It cannot grant permission, set an authorization state, approve testing, or submit reports. A future fetch adapter must be separately reviewed for SSRF, redirect handling, size/time limits, source authenticity, and content provenance before it is connected.
