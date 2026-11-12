/**
 * Explicit copy from a plaintext MemoryStore to an encrypted store.
 * The source is never deleted or modified; FileMemoryStore does not auto-migrate.
 */
import type { MemoryEntry, MemoryStore } from "./MemoryManager";

export interface MemoryMigrationResult {
  entriesCopied: number;
  sourcePreserved: true;
}

export async function migratePlaintextMemory(
  source: MemoryStore,
  encryptedTarget: MemoryStore
): Promise<MemoryMigrationResult> {
  const sourceEntries = await source.load();
  const existingTarget = await encryptedTarget.load();
  if (existingTarget.length > 0) {
    throw new Error("Encrypted memory target is not empty; refusing to overwrite it.");
  }

  await encryptedTarget.save(sourceEntries.map(cloneEntry));
  const verified = await encryptedTarget.load();
  if (canonicalize(verified) !== canonicalize(sourceEntries)) {
    throw new Error("Encrypted memory migration verification failed; plaintext source was preserved.");
  }
  return { entriesCopied: verified.length, sourcePreserved: true };
}

function cloneEntry(entry: MemoryEntry): MemoryEntry {
  return {
    ...entry,
    provenance: { ...entry.provenance, sourceRefs: [...entry.provenance.sourceRefs] }
  };
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return \`[\${value.map(canonicalize).join(",")}]\`;
  if (isRecord(value)) {
    return \`{\${Object.keys(value).sort().map(key => \`\${JSON.stringify(key)}:\${canonicalize(value[key])}\`).join(",")}}\`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
