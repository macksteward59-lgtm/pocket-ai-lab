import { describe, expect, it } from "vitest";
import {
  TaskLifecycleCoordinator,
  type TaskRecord
} from "../autonomy/TaskLifecycleCoordinator";
import {
  PostgresTaskLifecycleStore,
  type TaskLifecycleSqlDatabase,
  type TaskLifecycleSqlResult,
  type TaskLifecycleSqlTransaction
} from "../autonomy/PostgresTaskLifecycleStore";

interface FakeRow extends Record<string, unknown> {
  schema_version: number;
  record_version: number;
  payload: unknown;
}

class FakePostgresDatabase implements TaskLifecycleSqlDatabase {
  private rows = new Map<string, FakeRow>();
  private queue: Promise<void> = Promise.resolve();
  failNextUpdate = false;

  seed(namespace: string, row: FakeRow): void {
    this.rows.set(namespace, cloneRow(row));
  }

  async transaction<T>(operation: (transaction: TaskLifecycleSqlTransaction) => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;

    const working = new Map([...this.rows].map(([key, row]) => [key, cloneRow(row)]));
    const transaction: TaskLifecycleSqlTransaction = {
      query: async (sql: string, parameters: readonly unknown[] = []): Promise<TaskLifecycleSqlResult> => {
        const namespace = String(parameters[0] ?? "");
        if (sql.includes("INSERT INTO pocket_task_lifecycle_snapshots")) {
          if (!working.has(namespace)) {
            working.set(namespace, {
              schema_version: Number(parameters[1]),
              record_version: 0,
              payload: []
            });
          }
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("SELECT schema_version, record_version, payload")) {
          const row = working.get(namespace);
          return { rows: row ? [cloneRow(row)] : [], rowCount: row ? 1 : 0 };
        }

        if (sql.includes("SELECT schema_version, record_version")) {
          const row = working.get(namespace);
          return {
            rows: row ? [{ schema_version: row.schema_version, record_version: row.record_version }] : [],
            rowCount: row ? 1 : 0
          };
        }

        if (sql.trimStart().startsWith("UPDATE pocket_task_lifecycle_snapshots")) {
          if (this.failNextUpdate) {
            this.failNextUpdate = false;
            throw new Error("simulated database write failure");
          }
          const row = working.get(namespace);
          const expectedVersion = Number(parameters[2]);
          if (!row || row.record_version !== expectedVersion) return { rows: [], rowCount: 0 };
          const updated: FakeRow = {
            ...row,
            payload: JSON.parse(String(parameters[1])),
            record_version: expectedVersion + 1
          };
          working.set(namespace, updated);
          return { rows: [{ record_version: updated.record_version }], rowCount: 1 };
        }

        throw new Error("Unexpected SQL in fake database: " + sql);
      }
    };

    try {
      const result = await operation(transaction);
      this.rows = working;
      return result;
    } finally {
      release();
    }
  }
}

function cloneRow(row: FakeRow): FakeRow {
  return JSON.parse(JSON.stringify(row)) as FakeRow;
}

function task(id: string): TaskRecord {
  return {
    id,
    objective: "Persist one bounded lifecycle",
    status: "ready",
    steps: [{
      id: "inspect",
      description: "Inspect the implementation",
      dependsOn: [],
      maxAttempts: 1,
      attempts: 0,
      attemptIds: [],
      status: "pending",
      currentAttempt: null,
      completedAt: null,
      result: null,
      evidenceRefs: [],
      lastError: null
    }],
    maxConcurrentSteps: 1,
    leaseMs: 60_000,
    metadata: {},
    createdAt: "2026-11-15T12:00:00.000Z",
    updatedAt: "2026-11-15T12:00:00.000Z",
    completedAt: null,
    events: []
  };
}

function definition(id: string) {
  return {
    id,
    objective: "Persist lifecycle " + id,
    steps: [{ id: "inspect", description: "Inspect the implementation", maxAttempts: 1 }]
  };
}

describe("PostgresTaskLifecycleStore", () => {
  it("rejects a stale writer instead of overwriting another process", async () => {
    const database = new FakePostgresDatabase();
    const first = new PostgresTaskLifecycleStore(database, "workspace-a");
    const stale = new PostgresTaskLifecycleStore(database, "workspace-a");
    await first.load();
    await stale.load();

    await first.save([task("first")]);
    await expect(stale.save([task("stale")])).rejects.toMatchObject({ code: "store_conflict" });

    const current = await stale.load();
    expect(current.map(record => record.id)).toEqual(["first"]);
    await stale.save([...current, task("second")]);

    const observer = new PostgresTaskLifecycleStore(database, "workspace-a");
    expect((await observer.load()).map(record => record.id)).toEqual(["first", "second"]);
  });

  it("lets a coordinator reload after a version conflict and continue without losing another worker's task", async () => {
    const database = new FakePostgresDatabase();
    const first = new TaskLifecycleCoordinator({
      store: new PostgresTaskLifecycleStore(database, "workspace-b")
    });
    const stale = new TaskLifecycleCoordinator({
      store: new PostgresTaskLifecycleStore(database, "workspace-b")
    });
    await first.init();
    await stale.init();

    await first.createTask(definition("task-first"));
    await expect(stale.createTask(definition("task-stale"))).rejects.toMatchObject({ code: "store_conflict" });

    await stale.reload();
    await stale.createTask(definition("task-second"));
    expect(stale.listTasks().map(record => record.id).sort()).toEqual(["task-first", "task-second"]);
  });

  it("admits one worker for a concurrent claim and fences the other worker from completion", async () => {
    const database = new FakePostgresDatabase();
    const owner = new TaskLifecycleCoordinator({
      store: new PostgresTaskLifecycleStore(database, "workspace-claim-race"),
      workerId: "worker-a"
    });
    const contender = new TaskLifecycleCoordinator({
      store: new PostgresTaskLifecycleStore(database, "workspace-claim-race"),
      workerId: "worker-b"
    });
    await owner.init();
    await contender.init();
    await owner.createTask(definition("task-claim-race"));
    await contender.reload();

    const [ownerResult, contenderResult] = await Promise.allSettled([
      owner.claimNextStep("task-claim-race"),
      contender.claimNextStep("task-claim-race")
    ]);
    expect([ownerResult, contenderResult].filter(result => result.status === "fulfilled")).toHaveLength(1);

    const ownerWon = ownerResult.status === "fulfilled";
    const winningResult = ownerWon ? ownerResult : contenderResult;
    const losingResult = ownerWon ? contenderResult : ownerResult;
    const winner = ownerWon ? owner : contender;
    const loser = ownerWon ? contender : owner;
    expect(losingResult).toMatchObject({
      status: "rejected",
      reason: { code: "store_conflict" }
    });
    const claim = winningResult.status === "fulfilled" ? winningResult.value : null;
    expect(claim).not.toBeNull();
    expect(claim?.ownerId).toBe(ownerWon ? "worker-a" : "worker-b");

    await loser.reload();
    await expect(loser.completeStep({
      taskId: "task-claim-race",
      stepId: claim!.stepId,
      attemptId: claim!.attemptId,
      result: "foreign worker completion"
    })).rejects.toMatchObject({ code: "lease_owner_mismatch" });

    const completed = await winner.completeStep({
      taskId: "task-claim-race",
      stepId: claim!.stepId,
      attemptId: claim!.attemptId,
      result: "claim owner completion"
    });
    expect(completed.status).toBe("completed");
  });

  it("isolates namespaces", async () => {
    const database = new FakePostgresDatabase();
    const first = new PostgresTaskLifecycleStore(database, "workspace-one");
    const second = new PostgresTaskLifecycleStore(database, "workspace-two");
    await first.load();
    await second.load();
    await first.save([task("private-to-one")]);

    expect(await second.load()).toEqual([]);
  });

  it("fails closed on unknown schema versions", async () => {
    const database = new FakePostgresDatabase();
    database.seed("future", { schema_version: 99, record_version: 0, payload: [] });
    const store = new PostgresTaskLifecycleStore(database, "future");
    await expect(store.load()).rejects.toMatchObject({ code: "unsupported_store_schema" });
  });

  it("preserves the prior committed snapshot when a database write fails", async () => {
    const database = new FakePostgresDatabase();
    const store = new PostgresTaskLifecycleStore(database, "workspace-rollback");
    await store.load();
    database.failNextUpdate = true;

    await expect(store.save([task("not-committed")])).rejects.toThrow("simulated database write failure");
    const observer = new PostgresTaskLifecycleStore(database, "workspace-rollback");
    expect(await observer.load()).toEqual([]);
  });

  it("rejects snapshots above the configured storage bound", async () => {
    const store = new PostgresTaskLifecycleStore(new FakePostgresDatabase(), "workspace-large");
    await store.load();
    const oversized = task("oversized");
    oversized.objective = "x".repeat(PostgresTaskLifecycleStore.maximumSnapshotCharacters);
    await expect(store.save([oversized])).rejects.toMatchObject({ code: "store_too_large" });
  });

  it("rejects oversized persisted snapshots before cloning or parsing them", async () => {
    const database = new FakePostgresDatabase();
    database.seed("workspace-corrupt-large", {
      schema_version: 1,
      record_version: 1,
      payload: " ".repeat(PostgresTaskLifecycleStore.maximumSnapshotCharacters + 1)
    });
    const store = new PostgresTaskLifecycleStore(database, "workspace-corrupt-large");
    await expect(store.load()).rejects.toMatchObject({ code: "store_too_large" });
  });

  it("requires a load before the first save", async () => {
    const store = new PostgresTaskLifecycleStore(new FakePostgresDatabase(), "workspace-unloaded");
    await expect(store.save([])).rejects.toMatchObject({ code: "store_not_loaded" });
  });
});
