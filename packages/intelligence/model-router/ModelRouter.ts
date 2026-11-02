/**
 * Model Router and Resource Scheduler (offline-first)
 * Memory report is injectable. Queue resolves when resources free up.
 */

import { ModelDescriptor } from "../model-registry/ModelRegistry";

export interface ResourceReport {
  availableMemoryMB: number;
  loadedModels: string[];
}

export class ModelRouter {
  private loaded = new Set<string>();
  private queue: Array<{ agentId: string; model: ModelDescriptor; resolve: (m: ModelDescriptor) => void; reject: (e: Error) => void }> = [];

  constructor(private getResources: () => ResourceReport) {}

  async route(agentId: string, preferred: ModelDescriptor | undefined, requiredCaps: string[]): Promise<ModelDescriptor> {
    const candidates = preferred ? [preferred] : [];
    const model = candidates[0] ?? {
      id: "fallback",
      name: "Local",
      path: "",
      contextLength: 4096,
      capabilities: requiredCaps,
      memoryEstimateMB: 2000
    };

    const resources = this.getResources();
    const needsMemory = !this.loaded.has(model.id) && resources.availableMemoryMB < model.memoryEstimateMB;

    if (needsMemory && this.loaded.size === 0) {
      // No models loaded and not enough memory — fail fast rather than hang
      throw new Error(`Insufficient memory for model ${model.id} (${model.memoryEstimateMB}MB needed, ${resources.availableMemoryMB}MB available)`);
    }

    if (needsMemory) {
      return new Promise((resolve, reject) => {
        this.queue.push({ agentId, model, resolve, reject });
      });
    }

    this.loaded.add(model.id);
    return model;
  }

  release(modelId: string): void {
    this.loaded.delete(modelId);
    this.processQueue();
  }

  private processQueue(): void {
    while (this.queue.length > 0) {
      const next = this.queue[0];
      const resources = this.getResources();
      if (resources.availableMemoryMB >= next.model.memoryEstimateMB || this.loaded.has(next.model.id)) {
        this.queue.shift();
        this.loaded.add(next.model.id);
        next.resolve(next.model);
      } else {
        break;
      }
    }
  }

  getLoadedModels(): string[] {
    return Array.from(this.loaded);
  }
}
