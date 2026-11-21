import {
  TaskLifecycleError,
  type TaskLifecycleStore,
  type TaskRecord
} from "../../autonomy/TaskLifecycleCoordinator";

/** The subset of SQLite-backed Durable Object SQL used by the store. */
export interface LifecycleSnapshotSql {
  exec(statement: string, ...bindings: (number | string)[]): Iterable<Record<string, unknown>>;
}

const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

/**
 * Use one store instance per coordinator, backed by the same Durable Object
 * for every writer of this document-analysis lifecycle. A stale coordinator
 * must reload and reconcile before it can save again.
 */
export class DurableTaskLifecycleStore implements TaskLifecycleStore {
  private revision: number | null = null;

  constructor(private readonly sql: LifecycleSnapshotSql) {
    sql.exec(`CREATE TABLE IF NOT EXISTS pocket_analysis_snapshot_v1 (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL CHECK (revision > 0),
      payload TEXT NOT NULL
    )`);
  }

  load(): TaskRecord[] {
    this.revision = null;
    const [row] = this.sql.exec(
      "SELECT revision, payload FROM pocket_analysis_snapshot_v1 WHERE id = 1"
    );
    if (!row) {
      this.revision = 0;
      return [];
    }

    const { revision, payload } = row;
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1 ||
        typeof payload !== "string") {
      throw new TaskLifecycleError("store_corrupt", "Invalid document analysis snapshot row");
    }
    checkSize(payload);

    let records: unknown;
    try {
      records = JSON.parse(payload);
    } catch {
      throw new TaskLifecycleError("store_corrupt", "Invalid document analysis snapshot JSON");
    }
    if (!Array.isArray(records)) {
      throw new TaskLifecycleError("store_corrupt", "Document analysis snapshot must be an array");
    }

    this.revision = revision;
    // The coordinator validates individual records and attempt IDs at initialization.
    return records as TaskRecord[];
  }

  save(records: readonly TaskRecord[]): void {
    const revision = this.revision;
    if (revision === null) {
      throw new TaskLifecycleError("store_not_loaded", "Load the document analysis snapshot before saving");
    }
    const next = revision + 1;
    if (!Number.isSafeInteger(next)) {
      throw new TaskLifecycleError("store_corrupt", "Document analysis snapshot revision is exhausted");
    }

    const payload = JSON.stringify(records);
    checkSize(payload);
    const rows = revision === 0
      ? this.sql.exec(
          `INSERT INTO pocket_analysis_snapshot_v1 (id, revision, payload)
           VALUES (1, ?, ?) ON CONFLICT (id) DO NOTHING RETURNING revision`,
          next, payload
        )
      : this.sql.exec(
          `UPDATE pocket_analysis_snapshot_v1 SET revision = ?, payload = ?
           WHERE id = 1 AND revision = ? RETURNING revision`,
          next, payload, revision
        );

    if (Array.from(rows).length !== 1) {
      this.revision = null;
      throw new TaskLifecycleError("store_conflict", "Document analysis snapshot changed; reload before saving");
    }
    this.revision = next;
  }
}

function checkSize(payload: string): void {
  if (encoder.encode(payload).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new TaskLifecycleError("store_too_large", "Document analysis snapshot exceeds 1 MiB");
  }
}
