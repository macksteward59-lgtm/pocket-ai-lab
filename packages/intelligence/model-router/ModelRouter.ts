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
  /**
   * A model's weights are a shared reservation, but concurrent tasks may each
   * hold a lease on that reservation. Keep it until every holder releases it.
   * Per-request KV-cache/workspace memory is not represented by this estimate.
   */
  private reservations = new Map<string, { memoryMB: number; references: number }>();

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
      .reduce((sum, [, reservation]) => sum + reservation.memoryMB, 0);
    const available = Math.max(0, resources.availableMemoryMB - reservedElsewhere);
    if (!alreadyLoaded && available < preferred.memoryEstimateMB) {
      throw new Error(
        "Insufficient memory for " + preferred.id + ": requires " +
        preferred.memoryEstimateMB + "MB, " + available + "MB available"
      );
    }
    const existingReservation = this.reservations.get(preferred.id);
    if (existingReservation) {
      existingReservation.references += 1;
    } else if (!alreadyLoaded) {
      this.reservations.set(preferred.id, {
        memoryMB: preferred.memoryEstimateMB,
        references: 1
      });
    }
    return preferred;
  }

  release(modelId: string): void {
    const reservation = this.reservations.get(modelId);
    if (!reservation) return;
    reservation.references -= 1;
    if (reservation.references <= 0) this.reservations.delete(modelId);
  }

  getLoadedModels(): string[] {
    return [...this.reservations.keys()];
  }
}
