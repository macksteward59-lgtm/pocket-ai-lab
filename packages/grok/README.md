# Grok Workspace

This directory preserves the Grok Workspace artifact/attachment boundary from the original `east-unified.zip` archive. It is a workspace manifest and historical snapshot, not a running service or inference provider.

The archived `grok-workspace.zip` contained:
- `.grok/status`, captured on 2026-11-02. The preserved `.grok/status.snapshot.json` is historical and is not a live health signal.
- `attachments/exploitgym-main.zip`, represented by its recorded SHA-256 in `workspace-manifest.json`.

The canonical ExploitGym source is represented separately as a pinned Git submodule at `packages/exploitgym`. The archive did not contain Git commit metadata, so the pin is a later verified upstream revision, not a claim that it is byte-for-byte the archived ZIP.

Future artifact and attachment persistence must use explicit user-approved imports, content hashes, bounded storage, and provenance. No artifact in this directory is automatically executed or treated as model authority.
