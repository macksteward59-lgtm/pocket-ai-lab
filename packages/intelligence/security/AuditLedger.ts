/**
 * Append-only JSONL ledger. Each line stores the previous hash and a SHA-256.
 * Entries cannot set authorized to true.
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export const LEDGER_GENESIS = "0".repeat(64);

export interface LedgerRecord {
  seq: number;
  prevHash: string;
  payload: Record<string, unknown>;
  hash: string;
  authorized: false;
}

export class AuditLedger {
  constructor(private readonly filePath: string) {}

  async append(payload: Record<string, unknown>): Promise<LedgerRecord> {
    if (payload.authorized === true) {
      throw new Error("Ledger entries cannot set authorized true");
    }
    const existing = await this.read();
    const prevHash = existing.length ? existing[existing.length - 1].hash : LEDGER_GENESIS;
    const stored = { ...payload, authorized: false as const };
    const hash = createHash("sha256").update(prevHash + "\n" + canonicalize(stored)).digest("hex");
    const record: LedgerRecord = {
      seq: existing.length,
      prevHash,
      payload: stored,
      hash,
      authorized: false
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, JSON.stringify(record) + "\n", "utf8");
    return record;
  }

  async read(): Promise<LedgerRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    return raw.split("\n").filter(line => line.trim()).map(line => {
      const parsed = JSON.parse(line) as LedgerRecord;
      if (parsed.authorized !== false) throw new Error("Ledger entry must keep authorized false");
      return parsed;
    });
  }

  async verify(): Promise<boolean> {
    const records = await this.read();
    let prev = LEDGER_GENESIS;
    for (const record of records) {
      if (record.prevHash !== prev || record.authorized !== false) return false;
      const expected = createHash("sha256").update(record.prevHash + "\n" + canonicalize(record.payload)).digest("hex");
      if (expected !== record.hash) return false;
      prev = record.hash;
    }
    return true;
  }
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
