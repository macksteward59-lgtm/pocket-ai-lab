# Native iOS encrypted memory vault

## Scope and user control

The native Memory tab is an explicit, device-local notebook. It does not observe chat, intercept agent messages, auto-save prompts, or automatically retrieve memories into model context. The user creates, edits, and deletes entries manually. This is a first native storage slice, not a completed cross-agent memory integration.

Each entry records a layer (working, episodic, semantic, or procedural), content, creation time, agent/source label, optional task ID, source references, and verification state. New entries are always unverified. Editing preserves entry identity and creation time and resets verification to false. The current UI does not offer a verification control.

## At-rest protection

- The vault uses AES-256-GCM through CryptoKit.
- A versioned magic prefix and fixed additional authenticated data bind the ciphertext to this format.
- The 256-bit random key is stored as a generic-password item in iOS Keychain under a stable service/account.
- The Keychain item uses kSecAttrAccessibleWhenUnlockedThisDeviceOnly: unavailable while the device is locked and not migrated to another device through backup.
- The encrypted file is stored in the app's private Application Support directory with complete file protection; the dedicated memory directory is excluded from device backup because the key is device-only.
- Tampered, malformed, oversized, or unauthenticated vault content fails closed. No plaintext fallback exists.
- An empty read does not create a key. A key is created only when the first explicit write occurs.
- If a vault file exists but its Keychain key is missing or inaccessible, reads and writes fail closed; the app does not generate a replacement key that would strand or overwrite existing data.

## Recovery and migration

There is no automatic import from the web prototype's plaintext memory file, and no cross-device sync. Key loss means the existing encrypted vault cannot be recovered by this implementation. Users should retain a separately protected backup before relying on the vault for important information. Key reset, export/import, backup/restore, and explicit plaintext migration require separate reviewed workflows.

## Boundaries

Encryption at rest does not protect data while the app is unlocked and the key is in use, nor does it defend against a compromised process or operating system. Memory provenance is descriptive, not proof. A stored memory is not an authorization, APEX receipt, or runtime attestation. The vault is connected to native Agent Team only through explicit per-task selection: the operator enables memory context, selects individual records, and the selection is cleared after task submission. Context is capped at 2 KB, labelled untrusted in every role prompt, and only selected record IDs are stored in task history. No automatic retrieval or injection occurs. The vault is not synchronized with the TypeScript MemoryManager; cross-runtime retention, provenance, and deletion semantics remain separate work.

## Validation required

Automated iOS tests cover explicit CRUD, encrypted persistence, tamper rejection, missing-key fail-closed behavior, and empty reads that do not create keys. Hosted simulator CI is a code/test gate only. Physical acceptance still requires installing on the iPhone Air (256 GB), confirming Keychain behavior while locked/unlocked, restart persistence, file protection, backup behavior, and recovery UX on the actual device.
