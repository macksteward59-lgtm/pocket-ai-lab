/**
 * Memory Manager — four layers with provenance
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

export class MemoryManager {
  private store: MemoryEntry[] = [];

  write(entry: Omit<MemoryEntry, "id" | "createdAt">): string {
    const id = `mem-${Date.now()}`;
    this.store.push({
      ...entry,
      id,
      createdAt: new Date().toISOString()
    });
    return id;
  }

  retrieve(layer: MemoryEntry["layer"], query: string, limit = 5): MemoryEntry[] {
    // Simple keyword match; replace with FTS or vector later
    return this.store
      .filter(e => e.layer === layer && e.content.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit);
  }

  getByTask(taskId: string): MemoryEntry[] {
    return this.store.filter(e => e.provenance.taskId === taskId);
  }
}
