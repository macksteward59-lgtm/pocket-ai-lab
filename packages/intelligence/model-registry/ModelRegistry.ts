/**
 * Model Registry
 */

export interface ModelDescriptor {
  id: string;
  name: string;
  path: string; // GGUF or local path
  contextLength: number;
  quantization?: string;
  capabilities: string[];
  memoryEstimateMB: number;
}

export class ModelRegistry {
  private models = new Map<string, ModelDescriptor>();
  private agentModelMap = new Map<string, string>(); // agentId -> preferred modelId

  register(model: ModelDescriptor): void {
    this.models.set(model.id, model);
  }

  associateAgent(agentId: string, modelId: string): void {
    if (!this.models.has(modelId)) throw new Error(`Model ${modelId} not registered`);
    this.agentModelMap.set(agentId, modelId);
  }

  getPreferredModel(agentId: string): ModelDescriptor | undefined {
    const mid = this.agentModelMap.get(agentId);
    return mid ? this.models.get(mid) : undefined;
  }

  has(id: string): boolean {
    return this.models.has(id);
  }

  get(id: string): ModelDescriptor | undefined {
    return this.models.get(id);
  }

  /** Removes a model and any agent associations pointing at it. Does not touch router reservations. */
  unregister(id: string): boolean {
    const removed = this.models.delete(id);
    if (removed) {
      for (const [agentId, modelId] of [...this.agentModelMap]) {
        if (modelId === id) this.agentModelMap.delete(agentId);
      }
    }
    return removed;
  }

  listModels(): ModelDescriptor[] {
    return Array.from(this.models.values());
  }

  findByCapability(cap: string): ModelDescriptor[] {
    return this.listModels().filter(m => m.capabilities.includes(cap));
  }
}
