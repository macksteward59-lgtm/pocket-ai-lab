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
      id,
      createdAt: new Date().toISOString()
    };
    this.store.push(full);
    if (this.backend) {
      await this.backend.save(this.store);
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

  markVerified(id: string, verified: boolean): boolean {
    const entry = this.store.find(e => e.id === id);
    if (!entry) return false;
    entry.provenance.verified = verified;
    return true;
  }
}
