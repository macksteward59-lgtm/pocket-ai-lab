/**
 * Memory Manager — four layers with provenance.
 * In-memory by default; an optional persistence backend can be injected.
 * New entries always begin unverified. Verification is a separate explicit operation.
 * Mutations are serialized so a failed save cannot roll back another caller's write.
 */

import { randomUUID } from "node:crypto";

export interface MemoryEntry {
  id: string;
  layer: "working" | "episodic" | "semantic" | "procedural";
  content: string;
  provenance: {
    agentId: string;
    taskId?: string;
    verified: boolean;
    sourceRefs: string[];
  };
  createdAt: string;
}

export interface MemoryStore {
  load(): Promise<MemoryEntry[]> | MemoryEntry[];
  save(entries: MemoryEntry[]): Promise<void> | void;
}

export class MemoryManager {
  private store: MemoryEntry[] = [];
  private backend?: MemoryStore;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(backend?: MemoryStore) {
    this.backend = backend;
  }

  async init(): Promise<void> {
    await this.withMutation(async () => {
      if (this.backend) this.store = (await this.backend.load()).map(cloneEntry);
    });
  }

  async write(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<string> {
    return this.withMutation(async () => {
      const id = `mem-${randomUUID()}`;
      const full: MemoryEntry = {
        ...entry,
        provenance: {
          ...entry.provenance,
          verified: false,
          sourceRefs: [...entry.provenance.sourceRefs]
        },
        id,
        createdAt: new Date().toISOString()
      };
      this.store.push(full);
      try {
        if (this.backend) await this.backend.save(this.snapshot());
      } catch (error) {
        const index = this.store.findIndex(value => value.id === id);
        if (index >= 0) this.store.splice(index, 1);
        throw error;
      }
      return id;
    });
  }

  list(): MemoryEntry[] {
    return this.snapshot();
  }

  retrieve(layer: MemoryEntry["layer"], query: string, limit = 5): MemoryEntry[] {
    const q = query.toLowerCase();
    return this.store
      .filter(entry => entry.layer === layer && entry.content.toLowerCase().includes(q))
      .slice(0, limit)
      .map(cloneEntry);
  }

  getByTask(taskId: string): MemoryEntry[] {
    return this.store.filter(entry => entry.provenance.taskId === taskId).map(cloneEntry);
  }

  async delete(id: string): Promise<boolean> {
    return this.withMutation(async () => {
      const index = this.store.findIndex(entry => entry.id === id);
      if (index < 0) return false;
      const [removed] = this.store.splice(index, 1);
      try {
        if (this.backend) await this.backend.save(this.snapshot());
      } catch (error) {
        this.store.splice(index, 0, removed);
        throw error;
      }
      return true;
    });
  }

  async markVerified(id: string, verified: boolean): Promise<boolean> {
    return this.withMutation(async () => {
      const entry = this.store.find(value => value.id === id);
      if (!entry) return false;
      const previous = entry.provenance.verified;
      entry.provenance.verified = verified;
      try {
        if (this.backend) await this.backend.save(this.snapshot());
      } catch (error) {
        entry.provenance.verified = previous;
        throw error;
      }
      return true;
    });
  }

  private snapshot(): MemoryEntry[] {
    return this.store.map(cloneEntry);
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release!: () => void;
    this.mutationQueue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function cloneEntry(entry: MemoryEntry): MemoryEntry {
  return {
    ...entry,
    provenance: {
      ...entry.provenance,
      sourceRefs: [...entry.provenance.sourceRefs]
    }
  };
}
