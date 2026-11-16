# Original archive reconciliation

## Source of truth

The user's Library contains east-unified.zip, inspected on 2026-11-16.

- Outer archive SHA-256: 5df887041e429bb35ad1ce9d0445e14749dd126940626298bb79322e138c536b
- Nested director-project.zip SHA-256: c149ec34dbff28c9755ffa5683316eab0f0721effee08fe80c9fe557f3dc7358
- Nested exploitgym-main.zip SHA-256: fa6e111a5348ce91e6518aeff04a766ad6752ebb7adab39e4b976baf9d4c1fa4
- Nested grok-workspace.zip SHA-256: 71546654067adcdacd20b2c8d49e6299dea7c30386d44e2fc9a8dcf06349bb4c

## Restored in this slice

- Director/APEX iOS BridgeGate, RuntimeController, and LlamaEngine compatibility boundary, hardened and backed by the shared PocketLlamaEngine package.
- ExploitGym source as a Git submodule pinned to upstream main commit a8029e47135a29f1c1a6e79109bf86fba379b3f3 (2026-11-09). The archived ZIP did not contain commit metadata, so this is a verified later upstream pin, not a claim that it is the exact ZIP revision.
- Grok Workspace status snapshot and attachment manifest, clearly marked historical and not live.

## Deferred rather than blindly copied

- The archive contains a much larger Director web workspace. The current repository has only a small subset of that source tree. This PR does not claim that all 169 archived Director files have been restored. Trust/RLS/schema files remain subject to the active owner-authored contract and APEX verifier work; they must not be copied over current work without reconciliation.
- The original ApexShell SwiftUI/WebKit shell is not copied as executable code because it creates an ephemeral signing key and passes it into the runtime controller. The replacement bridge returns unsigned evidence candidates and leaves signing/authorization to Director.
- The original ExploitGym ZIP attachment is not duplicated in Git; the upstream source is represented by the pinned submodule, while the archived attachment hash is preserved in the Grok workspace manifest.

## Next integration gates

1. Run ApexBridge tests as part of the native app XCTest suite against the same pinned llama.cpp runtime dependency.
2. Connect the WKScriptMessageHandler action dispatcher to BridgeGate and RuntimeController with host-owned approval state and explicit response/error handling.
3. Reconcile the full Director web workspace against current packages without overwriting the active trust verifier, RLS contract, or East lifecycle work.
4. Implement a separately approved isolated ExploitGym worker adapter; do not allow automatic agent execution.
5. Add Grok Workspace artifact/attachment persistence with explicit import, hash, provenance, and retention.
