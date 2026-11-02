/**
 * Model Router and Resource Scheduler (offline-first)
 */

import { ModelDescriptor } from "../model-registry/ModelRegistry";

export interface ResourceReport {
  availableMemoryMB: number;
  loadedModels: string[];
}

export class ModelRouter {
  private loaded = new Set<string>();
  private queue: Array<{ agentId: string; model: ModelDescriptor; resolve: (m: ModelDescriptor) => void }> = [];

  constructor(private getResources: () => ResourceReport) {}

  async route(agentId: string, preferred: ModelDescriptor | undefined, requiredCaps: string[]): Promise<ModelDescriptor> {
    const candidates = preferred ? [preferred] : [];
    // In full impl, query registry for capability match
    const model = candidates[0] ?? { id: "fallback", name: "Local", path: "", contextLength: 4096, capabilities: requiredCaps, memoryEstimateMB: 2000 };

    const resources = this.getResources();
    if (resources.availableMemoryMB < model.memoryEstimateMB && this.loaded.size > 0) {
      // Queue or unload idle
      return new Promise(resolve => {
        this.queue.push({ agentId, model, resolve });
      });
    }

    this.loaded.add(model.id);
    return model;
  }

  release(modelId: string): void {
    this.loaded.delete(modelId);
    // Process queue if possible
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.loaded.add(next.model.id);
      next.resolve(next.model);
    }
  }
}
