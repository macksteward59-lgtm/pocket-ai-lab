/**
 * Supplies a stable 256-bit key for encrypted memory.
 * Production implementations must persist keys in an OS-backed secure store.
 */
export interface MemoryKeyProvider {
  /** Return the existing key or create/persist one using platform security. */
  getOrCreateKey(): Promise<Uint8Array | null>;
}
