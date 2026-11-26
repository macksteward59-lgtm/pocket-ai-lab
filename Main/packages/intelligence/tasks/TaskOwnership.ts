/**
 * Task ownership separation.
 *
 * Ported as a rule from the uploaded Python integrator, without its HTTP
 * service, handlers, or database. AI-owned tasks and user-owned tasks are
 * separate. An AI actor cannot mutate a user-owned task. This module does
 * not execute capabilities and does not set `authorized`.
 */

export type TaskOwner = "ai" | "user";

export interface OwnedTask {
  id: string;
  owner: TaskOwner;
  title: string;
  description: string;
  notes: string[];
}

export class TaskOwnershipError extends Error {}

export class TaskLedger {
  private readonly tasks = new Map<string, OwnedTask>();

  create(owner: TaskOwner, title: string, description = ""): OwnedTask {
    if (owner !== "ai" && owner !== "user") {
      throw new TaskOwnershipError("owner must be ai or user");
    }
    if (!title?.trim()) throw new TaskOwnershipError("title is required");
    const task: OwnedTask = {
      id: "task-" + crypto.randomUUID(),
      owner,
      title: title.trim(),
      description,
      notes: []
    };
    this.tasks.set(task.id, task);
    return this.copy(task);
  }

  get(id: string): OwnedTask | undefined {
    const task = this.tasks.get(id);
    return task ? this.copy(task) : undefined;
  }

  listByOwner(owner: TaskOwner): OwnedTask[] {
    return [...this.tasks.values()].filter(task => task.owner === owner).map(task => this.copy(task));
  }

  /**
   * The only AI mutation. Refuses user-owned tasks even if the note claims
   * to be an approval or an authorization.
   */
  aiAppendNote(id: string, note: string): OwnedTask {
    const task = this.tasks.get(id);
    if (!task) throw new TaskOwnershipError("Task not found");
    if (task.owner !== "ai") {
      throw new TaskOwnershipError("AI actor cannot mutate a user-owned task");
    }
    if (!note?.trim()) throw new TaskOwnershipError("note is required");
    task.notes.push(note.trim());
    return this.copy(task);
  }

  private copy(task: OwnedTask): OwnedTask {
    return { ...task, notes: [...task.notes] };
  }
}
