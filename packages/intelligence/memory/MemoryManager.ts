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
      const nextStore = [...this.store, full];
      if (this.backend) await this.backend.save(nextStore.map(cloneEntry));
      this.store = nextStore;
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
      const nextStore = this.store.filter(entry => entry.id !== id);
      if (this.backend) await this.backend.save(nextStore.map(cloneEntry));
      this.store = nextStore;
      return true;
    });
  }

  async update(id: string, patch: { content: string; sourceRefs?: string[] }): Promise<boolean> {
    if (typeof patch.content !== "string" || !patch.content.trim()) {
      throw new Error("Memory content is required.");
    }
    return this.withMutation(async () => {
      const index = this.store.findIndex(entry => entry.id === id);
      if (index < 0) return false;
      const nextStore = this.snapshot();
      const current = nextStore[index];
      nextStore[index] = {
        ...current,
        content: patch.content.trim(),
        provenance: {
          ...current.provenance,
          verified: false,
          sourceRefs: patch.sourceRefs
            ? [...patch.sourceRefs]
            : [...current.provenance.sourceRefs]
        }
      };
      if (this.backend) await this.backend.save(nextStore.map(cloneEntry));
      this.store = nextStore;
      return true;
    });
  }

  async markVerified(id: string, verified: boolean): Promise<boolean> {
    return this.withMutation(async () => {
      const index = this.store.findIndex(value => value.id === id);
      if (index < 0) return false;
      const nextStore = this.snapshot();
      nextStore[index].provenance.verified = verified;
      if (this.backend) await this.backend.save(nextStore.map(cloneEntry));
      this.store = nextStore;
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
