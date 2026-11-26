/**
 * Store review summaries through MemoryManager.
 * Ranking uses the existing relevance search. New entries stay unverified.
 */
import { MemoryEntry, MemoryManager } from "./MemoryManager";

export class ContextIngester {
  constructor(private readonly memory: MemoryManager) {}

  async ingest(input: { taskId: string; title: string; summary: string; sourceRef: string }): Promise<string> {
    if (!input.taskId.trim() || !input.title.trim()) {
      throw new Error("taskId and title are required");
    }
    return this.memory.write({
      layer: "episodic",
      content: input.title + "\n" + input.summary,
      provenance: {
        agentId: "archivist",
        taskId: input.taskId,
        verified: false,
        sourceRefs: [input.sourceRef]
      }
    });
  }

  related(query: string, limit = 5): MemoryEntry[] {
    return this.memory.search(query, { limit, minScore: 0 });
  }
}
