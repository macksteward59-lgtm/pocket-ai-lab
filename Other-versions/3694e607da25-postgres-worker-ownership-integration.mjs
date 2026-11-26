import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  InMemoryTaskLifecycleStore,
  TaskLifecycleCoordinator,
  TaskLifecycleError
} from "../TaskLifecycleCoordinator.ts";
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


async function verifyLegacyExpiryPolicyMigration() {
  const namespace = "legacy-expiry-" + randomUUID();
  const legacyTaskId = "legacy-task-" + randomUUID();
  const mutationTaskId = "migration-trigger-" + randomUUID();

  try {
    // Produce a valid current task, then serialize the exact pre-versioned
    // shape that existed before expiryPolicyVersion was introduced.
    const seedCoordinator = new TaskLifecycleCoordinator({
      store: new InMemoryTaskLifecycleStore(),
      workerId: "legacy-seed-" + randomUUID()
    });
    await seedCoordinator.init();
    const legacy = structuredClone(await seedCoordinator.createTask({
      id: legacyTaskId,
      objective: "Migrate a persisted pre-versioned multi-attempt task",
      steps: [{
        id: "external-effect",
        description: "A prior multi-attempt step with an ambiguous persisted false default",
        maxAttempts: 3,
        uncertainOnExpiredLease: false
      }]
    }));
    delete legacy.expiryPolicyVersion;
    legacy.steps[0].uncertainOnExpiredLease = false;

    // Seed real JSONB, not the fake SQL adapter, at a nonzero record version.
    await pool.query(
      `INSERT INTO pocket_task_lifecycle_snapshots
        (namespace, schema_version, record_version, payload, updated_at)
       VALUES ($1, 1, 7, $2::jsonb, CURRENT_TIMESTAMP)`,
      [namespace, JSON.stringify([legacy])]
    );

    const migrated = new TaskLifecycleCoordinator({
      store: new PostgresTaskLifecycleStore(database, namespace),
      workerId: "legacy-reader-" + randomUUID()
    });
    await migrated.init();

    expectLegacyMigration(migrated.getTask(legacyTaskId));

    // Initialization normalizes only the in-memory view. The persisted row
    // remains untouched until a normal lifecycle mutation performs the CAS write.
    const beforeMutation = await pool.query(
      "SELECT record_version FROM pocket_task_lifecycle_snapshots WHERE namespace = $1",
      [namespace]
    );
    assert.equal(Number(beforeMutation.rows[0]?.record_version), 7);

    await migrated.createTask({
      id: mutationTaskId,
      objective: "Trigger a normal lifecycle snapshot write after legacy normalization",
      steps: [{ id: "inspect", description: "Persist the normalized legacy snapshot" }]
    });

    const afterMutation = await pool.query(
      "SELECT record_version, payload FROM pocket_task_lifecycle_snapshots WHERE namespace = $1",
      [namespace]
    );
    assert.equal(Number(afterMutation.rows[0]?.record_version), 8);
    const stored = typeof afterMutation.rows[0]?.payload === "string"
      ? JSON.parse(afterMutation.rows[0].payload)
      : afterMutation.rows[0]?.payload;
    assert.ok(Array.isArray(stored));
    const storedLegacy = stored.find(record => record.id === legacyTaskId);
    assert.ok(storedLegacy, "the original legacy task must remain in the persisted snapshot");
    assert.equal(storedLegacy.expiryPolicyVersion, 1);
    assert.equal(storedLegacy.steps[0].uncertainOnExpiredLease, true);

    console.log("East PostgreSQL legacy expiry-policy migration checks passed");
  } finally {
    await pool.query(
      "DELETE FROM pocket_task_lifecycle_snapshots WHERE namespace = $1",
      [namespace]
    );
  }
}

function expectLegacyMigration(task) {
  assert.equal(task.expiryPolicyVersion, 1);
  assert.equal(task.steps[0].uncertainOnExpiredLease, true);
}

async function main() {
  const namespace = "worker-fence-" + randomUUID();
  const taskId = "task-" + randomUUID();
  const ownerId = "worker-owner-" + randomUUID();
  const contenderId = "worker-contender-" + randomUUID();
  const owner = new TaskLifecycleCoordinator({
    store: new PostgresTaskLifecycleStore(database, namespace),
    workerId: ownerId
  });
  const contender = new TaskLifecycleCoordinator({
    store: new PostgresTaskLifecycleStore(database, namespace),
    workerId: contenderId
  });

  try {
    await Promise.all([owner.init(), contender.init()]);
    await owner.createTask({
      id: taskId,
      objective: "Verify durable PostgreSQL worker ownership fencing",
      leaseMs: 60_000,
      steps: [{
        id: "single-effect",
        description: "Claim one durable step and complete it only as its owner",
        maxAttempts: 1
      }]
    });
    await contender.reload();

    // Both independent coordinators race from the same persisted version.
    const outcomes = await Promise.allSettled([
      owner.claimNextStep(taskId),
      contender.claimNextStep(taskId)
    ]);
    const winners = outcomes.filter(result => result.status === "fulfilled");
    const losers = outcomes.filter(result => result.status === "rejected");
    assert.equal(winners.length, 1, "exactly one worker must acquire the step");
    assert.equal(losers.length, 1, "the competing worker must lose the CAS race");
    assert.equal(losers[0].reason?.code, "store_conflict");

    const ownerWon = outcomes[0].status === "fulfilled";
    const winningCoordinator = ownerWon ? owner : contender;
    const losingCoordinator = ownerWon ? contender : owner;
    const claim = winners[0].value;
    assert.equal(claim.ownerId, ownerWon ? ownerId : contenderId);

    // A third, independent process reads the persisted active owner identity.
    const observer = new TaskLifecycleCoordinator({
      store: new PostgresTaskLifecycleStore(database, namespace),
      workerId: "worker-observer-" + randomUUID()
    });
    await observer.init();
    const persisted = observer.getTask(taskId).steps[0];
    assert.equal(persisted.status, "running");
    assert.equal(persisted.currentAttempt?.id, claim.attemptId);
    assert.equal(persisted.currentAttempt?.ownerId, claim.ownerId);

    // Possession of the attempt ID is insufficient: both completion and
    // failure by a foreign worker must be rejected without changing the row.
    await losingCoordinator.reload();
    await assert.rejects(
      losingCoordinator.completeStep({
        taskId,
        stepId: claim.stepId,
        attemptId: claim.attemptId,
        result: "unauthorized foreign-worker completion"
      }),
      error => error instanceof TaskLifecycleError && error.code === "lease_owner_mismatch"
    );
    await assert.rejects(
      losingCoordinator.failStep({
        taskId,
        stepId: claim.stepId,
        attemptId: claim.attemptId,
        error: "unauthorized foreign-worker failure",
        retryable: true
      }),
      error => error instanceof TaskLifecycleError && error.code === "lease_owner_mismatch"
    );

    const unchanged = new TaskLifecycleCoordinator({
      store: new PostgresTaskLifecycleStore(database, namespace),
      workerId: "worker-verifier-" + randomUUID()
    });
    await unchanged.init();
    assert.equal(unchanged.getTask(taskId).steps[0].status, "running");
    assert.equal(unchanged.getTask(taskId).steps[0].currentAttempt?.ownerId, claim.ownerId);

    const completed = await winningCoordinator.completeStep({
      taskId,
      stepId: claim.stepId,
      attemptId: claim.attemptId,
      result: "completed by the persisted lease owner"
    });
    assert.equal(completed.steps[0].status, "succeeded");

    const finalObserver = new TaskLifecycleCoordinator({
      store: new PostgresTaskLifecycleStore(database, namespace),
      workerId: "worker-final-observer-" + randomUUID()
    });
    await finalObserver.init();
    assert.equal(finalObserver.getTask(taskId).status, "completed");
    assert.equal(finalObserver.getTask(taskId).steps[0].result, "completed by the persisted lease owner");
    assert.deepEqual(
      finalObserver.getTask(taskId).events.map(event => event.type),
      ["task.created", "step.claimed", "step.completed", "task.completed"]
    );
    assert.equal(finalObserver.getTask(taskId).events[1].ownerId, claim.ownerId);
    assert.equal(finalObserver.getTask(taskId).events[1].resultingStepStatus, "running");
    assert.equal(finalObserver.getTask(taskId).events[2].resultingStepStatus, "succeeded");
    assert.equal(finalObserver.getTask(taskId).events[3].resultingTaskStatus, "completed");

    console.log("East PostgreSQL worker-ownership and event-journal checks passed");
    await verifyLegacyExpiryPolicyMigration();
  } finally {
    await pool.query(
      "DELETE FROM pocket_task_lifecycle_snapshots WHERE namespace = $1",
      [namespace]
    );
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
