import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresTaskLifecycleStore } from "../PostgresTaskLifecycleStore.ts";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });

const database = {
  async transaction(operation) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const transaction = {
        async query(sql, parameters = []) {
          const result = await client.query(sql, parameters);
          return { rows: result.rows, rowCount: result.rowCount };
        }
      };
      const result = await operation(transaction);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original transaction failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }
};

function record(id) {
  return {
    id,
    objective: "Exercise real PostgreSQL lifecycle persistence",
    status: "ready",
    steps: [],
    maxConcurrentSteps: 1,
    leaseMs: 60_000,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  };
}

async function main() {
  const namespace = "adapter-" + randomUUID();
  const first = new PostgresTaskLifecycleStore(database, namespace);
  const stale = new PostgresTaskLifecycleStore(database, namespace);

  await Promise.all([first.load(), stale.load()]);
  await first.save([record("first")]);

  await assert.rejects(
    stale.save([record("stale")]),
    error => error?.code === "store_conflict"
  );

  const reloaded = await stale.load();
  assert.deepEqual(reloaded.map(item => item.id), ["first"]);
  await stale.save([...reloaded, record("second")]);

  const observer = new PostgresTaskLifecycleStore(database, namespace);
  assert.deepEqual((await observer.load()).map(item => item.id), ["first", "second"]);

  // Two independent store instances load the same committed version and race.
  const raceNamespace = namespace + "-race";
  const raceA = new PostgresTaskLifecycleStore(database, raceNamespace);
  const raceB = new PostgresTaskLifecycleStore(database, raceNamespace);
  await Promise.all([raceA.load(), raceB.load()]);

  const outcomes = await Promise.allSettled([
    raceA.save([record("race-a")]),
    raceB.save([record("race-b")])
  ]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  const rejected = outcomes.find(result => result.status === "rejected");
  assert.equal(rejected?.reason?.code, "store_conflict");

  const raceObserver = new PostgresTaskLifecycleStore(database, raceNamespace);
  const raceSnapshot = await raceObserver.load();
  assert.equal(raceSnapshot.length, 1);
  assert.ok(["race-a", "race-b"].includes(raceSnapshot[0].id));

  // Inject a database-side failure after the UPDATE starts and prove rollback
  // leaves the last committed snapshot intact.
  const rollbackNamespace = namespace + "-rollback";
  const rollbackStore = new PostgresTaskLifecycleStore(database, rollbackNamespace);
  await rollbackStore.load();
  await rollbackStore.save([record("before-failure")]);

  await pool.query("CREATE OR REPLACE FUNCTION public.reject_test_lifecycle_payload() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload @> '[{\"id\":\"trigger-failure\"}]'::jsonb THEN RAISE EXCEPTION 'simulated PostgreSQL persistence failure'; END IF; RETURN NEW; END; $$");
  await pool.query("CREATE TRIGGER reject_test_lifecycle_payload BEFORE UPDATE ON pocket_task_lifecycle_snapshots FOR EACH ROW EXECUTE FUNCTION public.reject_test_lifecycle_payload()");

  try {
    await assert.rejects(
      rollbackStore.save([record("trigger-failure")]),
      /simulated PostgreSQL persistence failure/
    );
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS reject_test_lifecycle_payload ON pocket_task_lifecycle_snapshots");
    await pool.query("DROP FUNCTION IF EXISTS public.reject_test_lifecycle_payload()");
  }

  const rollbackObserver = new PostgresTaskLifecycleStore(database, rollbackNamespace);
  assert.deepEqual((await rollbackObserver.load()).map(item => item.id), ["before-failure"]);

  await pool.query(
    "DELETE FROM pocket_task_lifecycle_snapshots WHERE namespace = ANY($1::text[])",
    [[namespace, raceNamespace, rollbackNamespace]]
  );

  console.log("East TypeScript PostgreSQL adapter integration checks passed");
}

try {
  await main();
} finally {
  await pool.end();
}
