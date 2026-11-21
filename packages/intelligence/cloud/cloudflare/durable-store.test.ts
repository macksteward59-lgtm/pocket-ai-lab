import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskLifecycleCoordinator } from "../../autonomy/TaskLifecycleCoordinator";
import { DurableTaskLifecycleStore, type LifecycleSnapshotSql } from "./DurableTaskLifecycleStore";

describe("DurableTaskLifecycleStore against SQLite", () => {
  let database: DatabaseSync;
  let sql: LifecycleSnapshotSql;

  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    sql = {
      exec: (statement, ...bindings) => database.prepare(statement).all(...bindings)
    };
  });

  afterEach(() => database.close());

  function coordinator() {
    return new TaskLifecycleCoordinator({ store: new DurableTaskLifecycleStore(sql) });
  }

  function task(id: string) {
    return { id, objective: "Summarize a fixture document", steps: [{ id: "analysis", description: "Summarize" }] };
  }

  it("rejects stale first inserts and later updates until the coordinator reloads", async () => {
    const first = coordinator();
    const second = coordinator();
    await Promise.all([first.init(), second.init()]);

    await first.createTask(task("first"));
    await expect(second.createTask(task("second"))).rejects.toMatchObject({ code: "store_conflict" });
    await second.reload();
    await second.createTask(task("second"));
    await expect(first.createTask(task("third"))).rejects.toMatchObject({ code: "store_conflict" });
    await first.reload();
    await first.createTask(task("third"));

    const reopened = new DurableTaskLifecycleStore(sql);
    expect(reopened.load().map(record => record.id)).toEqual(["first", "second", "third"]);
  });

  it("leaves the previous snapshot intact when SQLite aborts a write", async () => {
    const writer = coordinator();
    await writer.init();
    await writer.createTask(task("first"));
    database.exec(`CREATE TRIGGER reject_write BEFORE UPDATE ON pocket_analysis_snapshot_v1
                   BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END`);
    await expect(writer.createTask(task("failed"))).rejects.toThrow("fixture write failure");
    expect(new DurableTaskLifecycleStore(sql).load().map(record => record.id)).toEqual(["first"]);
    database.exec("DROP TRIGGER reject_write");
    await writer.createTask(task("second"));
    expect(new DurableTaskLifecycleStore(sql).load().map(record => record.id)).toEqual(["first", "second"]);
  });

  it("rejects corrupt snapshots and requires a successful load before saving", () => {
    const store = new DurableTaskLifecycleStore(sql);
    expect(() => store.save([])).toThrow(expect.objectContaining({ code: "store_not_loaded" }));
    store.load();
    store.save([]);
    database.exec("UPDATE pocket_analysis_snapshot_v1 SET payload = 'invalid json'");
    expect(() => store.load()).toThrow(expect.objectContaining({ code: "store_corrupt" }));
    expect(() => store.save([])).toThrow(expect.objectContaining({ code: "store_not_loaded" }));
  });

  it("limits stored bytes before publication, including multibyte content", async () => {
    const writer = coordinator();
    await writer.init();
    await writer.createTask(task("first"));
    const store = new DurableTaskLifecycleStore(sql);
    const [record] = store.load();
    record.objective = "文".repeat(350_000);
    expect(() => store.save([record])).toThrow(expect.objectContaining({ code: "store_too_large" }));
    expect(new DurableTaskLifecycleStore(sql).load()[0]?.objective).toBe("Summarize a fixture document");
  });
});
