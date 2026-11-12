/**
 * Fail-closed model selection and resource accounting.
 * Waiting indefinitely for memory is deliberately avoided; callers may retry.
 */
import { ModelDescriptor } from "../model-registry/ModelRegistry";

export interface ResourceReport {
  availableMemoryMB: number;
  loadedModels: string[];
}

interface ModelReservation {
  memoryMB: number;
  modelPath: string;
  references: number;
  retiring: boolean;
}

export class ModelRouter {
  /**
   * A model's weights are a shared reservation, but concurrent tasks may each
   * hold a lease on that reservation. A replaced model remains reserved until
   * all old leases drain; new work cannot attach to the old reservation.
   * Per-request KV-cache/workspace memory is not represented by this estimate.
   */
  private reservations = new Map<string, ModelReservation>();
  /**
   * After a confirmed replacement drains, an external loadedModels ID may
   * still describe the old artifact. Force the next route through admission.
   */
  private mustRevalidate = new Set<string>();

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

    const existingReservation = this.reservations.get(preferred.id);
    if (existingReservation?.retiring) {
      throw new Error("Model " + preferred.id + " is being replaced; retry after in-flight leases finish");
    }
    if (existingReservation &&
        (existingReservation.modelPath !== preferred.path ||
         existingReservation.memoryMB !== preferred.memoryEstimateMB)) {
      throw new Error(
        "Model " + preferred.id +
        " descriptor changed while active reservations exist; wait for in-flight leases to finish"
      );
    }

    const forceRevalidation = this.mustRevalidate.has(preferred.id);
    const alreadyLoaded = Boolean(existingReservation) ||
      (!forceRevalidation && resources.loadedModels.includes(preferred.id));
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

    if (existingReservation) {
      existingReservation.references += 1;
    } else if (!alreadyLoaded || forceRevalidation) {
      this.reservations.set(preferred.id, {
        memoryMB: preferred.memoryEstimateMB,
        modelPath: preferred.path,
        references: 1,
        retiring: false
      });
    }
    if (forceRevalidation) this.mustRevalidate.delete(preferred.id);
    return preferred;
  }

  /**
   * Retires a reservation after an explicitly confirmed model replacement or
   * removal. Existing holders may finish and release normally, but no new
   * route may attach until the final old lease drains.
   */
  retire(modelId: string): void {
    const reservation = this.reservations.get(modelId);
    if (!reservation) {
      this.mustRevalidate.add(modelId);
      return;
    }
    reservation.retiring = true;
    if (reservation.references <= 0) {
      this.reservations.delete(modelId);
      this.mustRevalidate.add(modelId);
    }
  }

  release(modelId: string): void {
    const reservation = this.reservations.get(modelId);
    if (!reservation || reservation.references <= 0) return;
    reservation.references -= 1;
    if (reservation.references === 0) {
      this.reservations.delete(modelId);
      if (reservation.retiring) this.mustRevalidate.add(modelId);
    }
  }

  getLoadedModels(): string[] {
    return [...this.reservations.keys()];
  }
}
