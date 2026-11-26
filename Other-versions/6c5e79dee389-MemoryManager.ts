/**
 * Memory Manager — four layers with provenance
 * In-memory by default; optional persistence backend can be injected.
 * Never auto-marks entries as verified.
 */

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

  constructor(backend?: MemoryStore) {
    this.backend = backend;
  }

  async init(): Promise<void> {
    if (this.backend) {
      this.store = await this.backend.load();
    }
  }

  async write(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<string> {
    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const full: MemoryEntry = {
      ...entry,
      provenance: { ...entry.provenance, verified: entry.provenance.verified },
      id,
      createdAt: new Date().toISOString()
    };
    this.store.push(full);
    try {
      if (this.backend) await this.backend.save(this.store);
    } catch (error) {
      this.store.pop();
      throw error;
    }
    return id;
  }

  retrieve(layer: MemoryEntry["layer"], query: string, limit = 5): MemoryEntry[] {
    const q = query.toLowerCase();
    return this.store
      .filter(e => e.layer === layer && e.content.toLowerCase().includes(q))
      .slice(0, limit);
  }

  getByTask(taskId: string): MemoryEntry[] {
    return this.store.filter(e => e.provenance.taskId === taskId);
  }

  async markVerified(id: string, verified: boolean): Promise<boolean> {
    const entry = this.store.find(e => e.id === id);
    if (!entry) return false;
    const previous = entry.provenance.verified;
    entry.provenance.verified = verified;
    try {
      if (this.backend) await this.backend.save(this.store);
    } catch (error) {
      entry.provenance.verified = previous;
      throw error;
    }
    return true;
  }
}
