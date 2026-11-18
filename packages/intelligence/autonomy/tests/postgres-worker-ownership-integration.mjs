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
  const ownerId = "worker-owner-" + randomUUID();
  const contenderId = "worker-contender-" + randomUUID();
  const cancellationNamespace = namespace + "-cancel";
  const cancellationTaskId = "cancel-task-" + randomUUID();
  const cancellationOwnerId = "cancel-owner-" + randomUUID();
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

    // A second namespace exercises the durable cancellation-request/drain path
    // against real PostgreSQL rather than the in-memory or fake SQL adapters.
    const cancellationOwner = new TaskLifecycleCoordinator({
      store: new PostgresTaskLifecycleStore(database, cancellationNamespace),
      workerId: cancellationOwnerId
    });
    await cancellationOwner.init();
    await cancellationOwner.createTask({
      id: cancellationTaskId,
      objective: "Persist cancellation intent and drain every active owner",
      leaseMs: 60_000,
      maxConcurrentSteps: 2,
      steps: [
        { id: "first", description: "First active execution" },
        { id: "second", description: "Second active execution" },
        { id: "join", description: "Pending dependent execution", dependsOn: ["first", "second"] }
      ]
    });
    const [first, second] = await Promise.all([
      cancellationOwner.claimNextStep(cancellationTaskId),
      cancellationOwner.claimNextStep(cancellationTaskId)
    ]);
    assert.ok(first);
    assert.ok(second);

    const requested = await cancellationOwner.cancelTask(cancellationTaskId);
    assert.equal(requested.status, "running");
    assert.equal(requested.steps.filter(step => step.status === "running").length, 2);
    assert.equal(requested.steps.find(step => step.id === "join")?.status, "cancelled");
    const requestEvent = requested.events.find(event => event.type === "task.cancel_requested");
    assert.ok(requestEvent);

    const cancellationObserver = new TaskLifecycleCoordinator({
      store: new PostgresTaskLifecycleStore(database, cancellationNamespace),
      workerId: "cancel-observer-" + randomUUID()
    });
    await cancellationObserver.init();
    const persistedRequest = cancellationObserver.getTask(cancellationTaskId);
    assert.equal(persistedRequest.status, "running");
    assert.equal(
      persistedRequest.events.find(event => event.type === "task.cancel_requested")?.occurredAt,
      requestEvent.occurredAt
    );
    assert.equal(
      persistedRequest.steps.find(step => step.id === "first")?.currentAttempt?.ownerId,
      cancellationOwnerId
    );
    assert.equal(await cancellationObserver.claimNextStep(cancellationTaskId), null);
    await assert.rejects(
      cancellationObserver.settleCancelledStep({
        taskId: cancellationTaskId, stepId: first.stepId, attemptId: first.attemptId
      }),
      error => error instanceof TaskLifecycleError && error.code === "lease_owner_mismatch"
    );

    const afterFirstDrain = await cancellationOwner.settleCancelledStep({
      taskId: cancellationTaskId, stepId: first.stepId, attemptId: first.attemptId
    });
    assert.equal(afterFirstDrain.status, "running");
    await cancellationObserver.reload();
    assert.equal(
      cancellationObserver.getTask(cancellationTaskId).steps.find(step => step.id === "second")?.currentAttempt?.id,
      second.attemptId
    );

    const afterSecondDrain = await cancellationOwner.settleCancelledStep({
      taskId: cancellationTaskId, stepId: second.stepId, attemptId: second.attemptId
    });
    assert.equal(afterSecondDrain.status, "cancelled");
    const cancellationFinalObserver = new TaskLifecycleCoordinator({
      store: new PostgresTaskLifecycleStore(database, cancellationNamespace),
      workerId: "cancel-final-observer-" + randomUUID()
    });
    await cancellationFinalObserver.init();
    const persistedFinal = cancellationFinalObserver.getTask(cancellationTaskId);
    assert.equal(persistedFinal.status, "cancelled");
    assert.equal(persistedFinal.events.filter(event => event.type === "task.cancel_requested").length, 1);
    assert.equal(persistedFinal.events.filter(event => event.type === "task.cancelled").length, 1);
    const eventTypes = persistedFinal.events.map(event => event.type);
    const requestIndex = eventTypes.indexOf("task.cancel_requested");
    const terminalIndex = eventTypes.lastIndexOf("task.cancelled");
    assert.ok(requestIndex >= 0 && terminalIndex > requestIndex);
    assert.equal(eventTypes.includes("task.completed"), false);
    assert.equal(eventTypes.includes("task.failed"), false);
    for (const claim of [first, second]) {
      const settlementIndex = persistedFinal.events.findIndex(event =>
        event.type === "step.cancelled" && event.attemptId === claim.attemptId &&
        event.ownerId === cancellationOwnerId
      );
      assert.ok(settlementIndex > requestIndex && settlementIndex < terminalIndex);
    }
    await assert.rejects(
      cancellationOwner.completeStep({
        taskId: cancellationTaskId, stepId: first.stepId, attemptId: first.attemptId,
        result: "stale completion after cancellation settlement"
      }),
      error => error instanceof TaskLifecycleError && error.code === "stale_attempt"
    );

    console.log("East PostgreSQL worker-ownership, cancellation-drain, and event-journal checks passed");
  } finally {
    await pool.query(
      "DELETE FROM pocket_task_lifecycle_snapshots WHERE namespace = ANY($1)",
      [[namespace, cancellationNamespace]]
    );
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
