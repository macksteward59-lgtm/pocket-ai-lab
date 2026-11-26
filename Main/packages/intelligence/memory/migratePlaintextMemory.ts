/**
 * Explicit copy from a plaintext MemoryStore to an encrypted store.
 * The source is never deleted or modified; FileMemoryStore does not auto-migrate.
 */
import type { MemoryEntry, MemoryStore } from "./MemoryManager";

export interface MemoryMigrationResult {
  entriesCopied: number;
  sourcePreserved: true;
}

interface AtomicMigrationTarget extends MemoryStore {
  /** Atomically refuses a non-empty vault, writes, and reads back under one lock. */
  migrateIfEmpty(entries: MemoryEntry[]): Promise<MemoryEntry[]>;
}

/** Serializes fallback migrations for generic MemoryStore targets in this process. */
const migrationQueues = new WeakMap<object, Promise<void>>();

export async function migratePlaintextMemory(
  source: MemoryStore,
  encryptedTarget: MemoryStore
): Promise<MemoryMigrationResult> {
  const sourceEntries = (await source.load()).map(cloneEntry);
  let verified: MemoryEntry[];
  if (hasAtomicMigration(encryptedTarget)) {
    verified = await encryptedTarget.migrateIfEmpty(sourceEntries);
  } else {
    // Generic stores have no cross-process transaction primitive. Serialize
    // same-object migrations in this process; production encrypted storage
    // implements migrateIfEmpty with a cross-process exclusive file lock.
    verified = await withMigrationQueue(encryptedTarget, async () => {
      const existingTarget = await encryptedTarget.load();
      if (existingTarget.length > 0) throw new Error("Encrypted memory target is not empty; refusing to overwrite it.");
      await encryptedTarget.save(sourceEntries.map(cloneEntry));
      return encryptedTarget.load();
    });
  }
  if (canonicalize(verified) !== canonicalize(sourceEntries)) {
    throw new Error("Encrypted memory migration verification failed; plaintext source was preserved.");
  }
  return { entriesCopied: verified.length, sourcePreserved: true };
}

async function withMigrationQueue<T>(target: object, operation: () => Promise<T>): Promise<T> {
  const previous = migrationQueues.get(target) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  migrationQueues.set(target, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (migrationQueues.get(target) === current) migrationQueues.delete(target);
  }
}

function hasAtomicMigration(target: MemoryStore): target is AtomicMigrationTarget {
  return typeof (target as Partial<AtomicMigrationTarget>).migrateIfEmpty === "function";
}

function cloneEntry(entry: MemoryEntry): MemoryEntry {
  return {
    ...entry,
    provenance: {
      ...entry.provenance,
      sourceRefs: [...entry.provenance.sourceRefs]
    }
  };
}

/** Canonical comparison ignores undefined optional object fields, as JSON storage does. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  if (isRecord(value)) {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
    return "{" + keys.map(key => JSON.stringify(key) + ":" + canonicalize(value[key])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
