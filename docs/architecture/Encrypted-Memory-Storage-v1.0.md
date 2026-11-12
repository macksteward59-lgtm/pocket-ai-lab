# Encrypted Memory Storage v1.0

## Status

This change adds an opt-in encrypted file backend and an injected key-provider contract. It does not silently replace the existing plaintext FileMemoryStore, wire encryption into the consumer server, or claim that a platform keychain adapter already exists.

## Data format and cryptography

- AES-256-GCM authenticated encryption.
- Fresh 96-bit nonce for each save; 128-bit authentication tag.
- Versioned envelope with algorithm identifier, nonce, tag, and ciphertext.
- Fixed format-specific additional authenticated data binds the ciphertext to this store format.
- Modified envelope, ciphertext, tag, or wrong key fails closed. No plaintext fallback is attempted.
- Plaintext and the cached in-process key buffer are zeroed on normal completion/close paths where the runtime permits it. JavaScript runtimes cannot guarantee complete memory erasure or prevent copies made by the runtime.

## Key custody contract

MemoryKeyProvider.getOrCreateKey() must return exactly 32 bytes from a stable OS-backed secure store, or return null when the key cannot be retrieved. Production adapters must:
- generate a cryptographically random key using the platform cryptographic API;
- persist it in the platform secure key store (for iOS, an appropriately access-controlled Keychain item);
- return the same key for the same memory vault;
- never write key material beside the memory file, to environment variables, logs, source control, or application preferences;
- surface access denial, device-lock, key invalidation, and key loss as unavailable rather than silently generating a replacement key for existing ciphertext.

The repository currently supplies the interface and a test-only in-memory provider. It does not yet contain an iOS Keychain, macOS Keychain, Windows DPAPI, or browser WebCrypto key provider. Until one is implemented and independently tested, this backend must not be enabled for production user data.

## Migration

Migration is explicit via migratePlaintextMemory(source, encryptedTarget). It:
1. reads the legacy source;
2. refuses to overwrite a target that already contains entries;
3. writes encrypted data;
4. reads it back and compares the complete entries;
5. leaves the plaintext source untouched.

Users should retain a verified backup until they confirm the encrypted vault opens with the same platform key after app restart. The old plaintext file is not deleted automatically. A later, separate user-approved cleanup step may securely remove it, subject to backup and filesystem limitations.

## Integration gate

Do not switch apps/web/server.mjs or any default memory path to this backend until a real key provider exists for that execution environment, provider lifecycle/lock behavior is tested, migration UX is explicit, and the app fails closed with a clear recovery path. The current web prototype continues to use checksummed plaintext protected by restrictive POSIX permissions; it is not encrypted at rest.

## Security boundaries

Encryption protects stored bytes against offline file disclosure when the key remains unavailable to the attacker. It does not protect data while the app is unlocked and using the key, defend against a compromised process or malicious extensions, establish memory provenance, mark entries verified, authorize an action, or change APEX/East evidence and trust semantics.

## Write and lifecycle safety

- Store operations are tracked. `close()` stops new work, waits for active reads/writes/migrations to finish, then zeroes the private cached key copy. A key-provider response arriving during an active save cannot race with key zeroing.
- Key retrieval is single-flight per store instance. Provider-owned key bytes are copied; the store only zeroes its own buffer.
- Save plaintext buffers are zeroed in a `finally` path that includes key-provider failures. Ciphertext/envelope buffers are also cleared after writing.
- Writers are serialized within the process and acquire an exclusive `memory.enc.lock` file for cross-process exclusion. If another process holds the lock, the operation fails closed and does not remove that process's lock.
- A crash can leave a stale lock file. Recovery must be an explicit operator action after confirming no writer is active; the store does not guess whether a lock is stale.
- Writes use a mode-0600 temporary file, file sync, atomic rename, and a containing-directory sync on POSIX before reporting success. Windows skips directory sync because this implementation does not claim a portable directory-fsync primitive there.
- Any failure before rename removes the temporary file. The existing vault is not replaced by an incomplete temp artifact.

The encrypted store also exposes an atomic `migrateIfEmpty` operation. The migration check, encrypted save, and read-back occur under the same exclusive write lock, so two competing migrations cannot both observe an empty target and overwrite each other. Generic MemoryStore implementations without that operation receive only an in-process per-object migration queue and do not provide cross-process transaction guarantees.
