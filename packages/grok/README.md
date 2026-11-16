# Grok Workspace

This folder preserves the Grok Workspace artifact/attachment boundary from the original Pocket AI Lab archive. It is a workspace manifest, not a running service or an inference provider.

The original grok-workspace.zip snapshot contained:
- .grok/status — a status record captured on 2026-11-02, not a live health signal.
- attachments/exploitgym-main.zip — an archived ExploitGym source snapshot.

The status snapshot is preserved in .grok/status.snapshot.json. Its historical READY value must never be interpreted as current availability. The original attachment is represented by its SHA-256 and upstream commit in workspace-manifest.json; the canonical source is restored as the pinned packages/exploitgym submodule rather than duplicated as a large ZIP.

Future artifact and attachment persistence must use explicit user-approved imports, content hashes, bounded storage, and provenance. No artifact in this directory is automatically executed or treated as model authority.
