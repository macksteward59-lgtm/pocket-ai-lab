import {
  TaskLifecycleError,
  type TaskLifecycleStore,
  type TaskRecord
} from "./TaskLifecycleCoordinator";

/**
 * Minimal PostgreSQL query surface. A host can adapt node-postgres, postgres.js,
 * or another PostgreSQL client without making the intelligence package depend
 * on a particular driver.
 */
export interface TaskLifecycleSqlResult {
  rows: readonly Record<string, unknown>[];
  rowCount?: number | null;
}

export interface TaskLifecycleSqlTransaction {
  query(sql: string, parameters?: readonly unknown[]): Promise<TaskLifecycleSqlResult>;
}

export interface TaskLifecycleSqlDatabase {
  /** Must run the callback in one real database transaction. */
  transaction<T>(operation: (transaction: TaskLifecycleSqlTransaction) => Promise<T>): Promise<T>;
}

/**
 * Namespaced, transactional PostgreSQL snapshot store.
 *
 * Each store instance remembers the version returned by its last load/save.
 * save() takes a row lock and compares that version before replacing the
 * snapshot. Two processes that loaded the same version cannot overwrite one
 * another: the stale writer receives store_conflict and must reload/reconcile.
 *
 * This adapter does not create database credentials, encryption keys, RLS
 * policies, or APEX approvals. The host owns connection security and migration
 * execution. Persisted model output and evidence references remain untrusted.
 */
export class PostgresTaskLifecycleStore implements TaskLifecycleStore {
  static readonly currentSchemaVersion = 1;
  static readonly maximumSnapshotCharacters = 4 * 1_024 * 1_024;

  private expectedVersion: number | null = null;

  constructor(
    private readonly database: TaskLifecycleSqlDatabase,
    private readonly namespace: string
  ) {
    if (!database || typeof database.transaction !== "function") {
      throw new TaskLifecycleError("invalid_store", "A transactional PostgreSQL database adapter is required");
    }
    if (typeof namespace !== "string" || !namespace.trim() || namespace.length > 256) {
      throw new TaskLifecycleError("invalid_namespace", "A non-empty lifecycle namespace up to 256 characters is required");
    }
  }

  async load(): Promise<TaskRecord[]> {
    const snapshot = await this.database.transaction(async transaction => {
      await transaction.query(
        `INSERT INTO pocket_task_lifecycle_snapshots
          (namespace, schema_version, record_version, payload, updated_at)
         VALUES ($1, $2, 0, '[]'::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (namespace) DO NOTHING`,
        [this.namespace, PostgresTaskLifecycleStore.currentSchemaVersion]
      );

      const result = await transaction.query(
        `SELECT schema_version, record_version, payload
           FROM pocket_task_lifecycle_snapshots
          WHERE namespace = $1`,
        [this.namespace]
      );
      const row = result.rows[0];
      if (!row) {
        throw new TaskLifecycleError("store_missing_namespace", "Lifecycle snapshot row was not created or could not be read");
      }

      const schemaVersion = toSafeInteger(row.schema_version);
      if (schemaVersion !== PostgresTaskLifecycleStore.currentSchemaVersion) {
        throw new TaskLifecycleError("unsupported_store_schema", "Lifecycle snapshot schema version is not supported");
      }
      const recordVersion = toSafeInteger(row.record_version);
      if (recordVersion === null || recordVersion < 0) {
        throw new TaskLifecycleError("store_corrupt", "Lifecycle snapshot record version is invalid");
      }

      let records: unknown = row.payload;
      // Enforce the same bound on reads as writes. A corrupt or externally
      // modified JSONB row must not cause an unbounded allocation during load.
      let encodedPayload: string;
      try {
        encodedPayload = typeof records === "string" ? records : JSON.stringify(records) ?? "";
      } catch {
        throw new TaskLifecycleError("store_corrupt", "Lifecycle snapshot payload could not be serialized");
      }
      if (encodedPayload.length > PostgresTaskLifecycleStore.maximumSnapshotCharacters) {
        throw new TaskLifecycleError("store_too_large", "Lifecycle snapshot exceeds the configured storage limit");
      }
      if (typeof records === "string") {
        try {
          records = JSON.parse(records);
        } catch {
          throw new TaskLifecycleError("store_corrupt", "Lifecycle snapshot payload is not valid JSON");
        }
      }
      if (!Array.isArray(records)) {
        throw new TaskLifecycleError("store_corrupt", "Lifecycle snapshot payload must be an array");
      }

      return {
        version: recordVersion,
        records: cloneRecords(records as TaskRecord[])
      };
    });

    // Update the local CAS token only after the read transaction commits.
    this.expectedVersion = snapshot.version;
    return snapshot.records;
  }

  async save(records: readonly TaskRecord[]): Promise<void> {
    if (this.expectedVersion === null) {
      throw new TaskLifecycleError("store_not_loaded", "Call load() before saving a lifecycle snapshot");
    }
    if (!Array.isArray(records)) {
      throw new TaskLifecycleError("store_corrupt", "Lifecycle snapshot must be an array");
    }

    const expectedVersion = this.expectedVersion;
    const payload = JSON.stringify(records);
    if (typeof payload !== "string") {
      throw new TaskLifecycleError("store_corrupt", "Lifecycle snapshot could not be serialized");
    }
    if (payload.length > PostgresTaskLifecycleStore.maximumSnapshotCharacters) {
      throw new TaskLifecycleError("store_too_large", "Lifecycle snapshot exceeds the configured storage limit");
    }

    const nextVersion = await this.database.transaction(async transaction => {
      const locked = await transaction.query(
        `SELECT schema_version, record_version
           FROM pocket_task_lifecycle_snapshots
          WHERE namespace = $1
          FOR UPDATE`,
        [this.namespace]
      );
      const row = locked.rows[0];
      if (!row) {
        throw new TaskLifecycleError("store_missing_namespace", "Lifecycle snapshot row is missing");
      }

      const schemaVersion = toSafeInteger(row.schema_version);
      if (schemaVersion !== PostgresTaskLifecycleStore.currentSchemaVersion) {
        throw new TaskLifecycleError("unsupported_store_schema", "Lifecycle snapshot schema version is not supported");
      }
      const currentVersion = toSafeInteger(row.record_version);
      if (currentVersion === null || currentVersion < 0) {
        throw new TaskLifecycleError("store_corrupt", "Lifecycle snapshot record version is invalid");
      }
      if (currentVersion !== expectedVersion) {
        throw new TaskLifecycleError("store_conflict", "Lifecycle snapshot changed in another process; reload before retrying");
      }

      const updated = await transaction.query(
        `UPDATE pocket_task_lifecycle_snapshots
            SET payload = $2::jsonb,
                record_version = record_version + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE namespace = $1 AND record_version = $3
          RETURNING record_version`,
        [this.namespace, payload, expectedVersion]
      );
      const changed = updated.rowCount ?? updated.rows.length;
      if (changed !== 1) {
        throw new TaskLifecycleError("store_conflict", "Lifecycle snapshot compare-and-swap did not update exactly one row");
      }
      const writtenVersion = toSafeInteger(updated.rows[0]?.record_version);
      if (writtenVersion !== expectedVersion + 1) {
        throw new TaskLifecycleError("store_corrupt", "Database returned an invalid lifecycle snapshot version");
      }
      return writtenVersion;
    });

    // Do not advance the token until the database transaction has committed.
    this.expectedVersion = nextVersion;
  }
}

function toSafeInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(number) ? number : null;
}

function cloneRecords(records: TaskRecord[]): TaskRecord[] {
  try {
    return JSON.parse(JSON.stringify(records)) as TaskRecord[];
  } catch {
    throw new TaskLifecycleError("store_corrupt", "Lifecycle snapshot could not be cloned");
  }
}
