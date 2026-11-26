/**
 * Fail-closed model selection and resource accounting.
 * Waiting indefinitely for memory is deliberately avoided; callers may retry.
 */
import { ModelDescriptor } from "../model-registry/ModelRegistry";

export interface ResourceReport {
  availableMemoryMB: number;
  loadedModels: string[];
}

export class ModelRouter {
  private reservations = new Map<string, number>();

  constructor(private readonly getResources: () => ResourceReport) {}

  async route(
    agentId: string,
    preferred: ModelDescriptor | undefined,
    requiredCaps: string[]
  ): Promise<ModelDescriptor> {
    if (!agentId.trim()) throw new Error("agentId is required");
    if (!preferred) throw new Error("No model is registered for agent " + agentId);
    if (!preferred.id || !preferred.path) {
      throw new Error("Model " + preferred.id + " has no configured runtime path");
    }
    if (!Number.isFinite(preferred.memoryEstimateMB) || preferred.memoryEstimateMB <= 0) {
      throw new Error("Model " + preferred.id + " has an invalid memory estimate");
    }
    const missing = requiredCaps.filter(cap => !preferred.capabilities.includes(cap));
    if (missing.length) {
      throw new Error("Model " + preferred.id + " lacks required capabilities: " + missing.join(", "));
    }

    const resources = this.getResources();
    if (!Number.isFinite(resources.availableMemoryMB) || resources.availableMemoryMB < 0) {
      throw new Error("Resource provider returned invalid available memory");
    }
    const alreadyLoaded = resources.loadedModels.includes(preferred.id) || this.reservations.has(preferred.id);
    const reservedElsewhere = [...this.reservations.entries()]
      .filter(([id]) => id !== preferred.id)
      .reduce((sum, [, amount]) => sum + amount, 0);
    const available = Math.max(0, resources.availableMemoryMB - reservedElsewhere);
    if (!alreadyLoaded && available < preferred.memoryEstimateMB) {
      throw new Error(
        "Insufficient memory for " + preferred.id + ": requires " +
        preferred.memoryEstimateMB + "MB, " + available + "MB available"
      );
    }
    if (!alreadyLoaded) this.reservations.set(preferred.id, preferred.memoryEstimateMB);
    return preferred;
  }

  release(modelId: string): void {
    this.reservations.delete(modelId);
  }

  getLoadedModels(): string[] {
    return [...this.reservations.keys()];
  }
}
