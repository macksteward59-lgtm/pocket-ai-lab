import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
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

async function main() {
  const namespace = "worker-fence-" + randomUUID();
  const taskId = "task-" + randomUUID();
  const owner = new TaskLifecycleCoordinator({
    store: new PostgresTaskLifecycleStore(database, namespace),
    workerId: "worker-owner-" + randomUUID()
  });
  const contender = new TaskLifecycleCoordinator({
    store: new PostgresTaskLifecycleStore(database, namespace),
    workerId: "worker-contender-" + randomUUID()
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
    assert.equal(claim.ownerId, ownerWon ? ownerWonId(owner) : claim.ownerId);
    assert.ok(claim.ownerId.startsWith("worker-owner-") || claim.ownerId.startsWith("worker-contender-"));

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

    console.log("East PostgreSQL worker-ownership integration checks passed");
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
