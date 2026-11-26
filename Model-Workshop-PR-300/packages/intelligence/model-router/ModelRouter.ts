/**
 * Fail-closed model selection and resource accounting.
 * Reservations are leases: each successful route must be paired with one release.
 * Waiting indefinitely for memory is deliberately avoided; callers may retry.
 */
import { ModelDescriptor } from "../model-registry/ModelRegistry";

export interface ResourceReport {
  availableMemoryMB: number;
  loadedModels: string[];
}

interface ModelReservation {
  memoryMB: number;
  activeRoutes: number;
}

export class ModelRouter {
  private reservations = new Map<string, ModelReservation>();

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
    if (!Array.isArray(resources.loadedModels) || !resources.loadedModels.every(id => typeof id === "string")) {
      throw new Error("Resource provider returned an invalid loaded-model list");
    }

    const existing = this.reservations.get(preferred.id);
    if (existing && existing.memoryMB !== preferred.memoryEstimateMB) {
      throw new Error(
        "Model " + preferred.id + " changed its memory estimate while routes are active"
      );
    }

    const externallyLoaded = resources.loadedModels.includes(preferred.id);
    const reservedElsewhere = [...this.reservations.entries()]
      .filter(([id]) => id !== preferred.id)
      .reduce((sum, [, reservation]) => sum + reservation.memoryMB, 0);
    const available = Math.max(0, resources.availableMemoryMB - reservedElsewhere);

    if (!existing && !externallyLoaded && available < preferred.memoryEstimateMB) {
      throw new Error(
        "Insufficient memory for " + preferred.id + ": requires " +
        preferred.memoryEstimateMB + "MB, " + available + "MB available"
      );
    }

    // A reservation is counted once for memory but leased once per route.
    // Externally loaded models are owned by the runtime/resource provider.
    if (existing) {
      existing.activeRoutes += 1;
    } else if (!externallyLoaded) {
      this.reservations.set(preferred.id, {
        memoryMB: preferred.memoryEstimateMB,
        activeRoutes: 1
      });
    }
    return preferred;
  }

  /**
   * Releases one route lease. A model reservation remains until every route
   * that selected it has released; externally loaded models are never owned here.
   */
  release(modelId: string): void {
    const reservation = this.reservations.get(modelId);
    if (!reservation) return;
    reservation.activeRoutes -= 1;
    if (reservation.activeRoutes <= 0) this.reservations.delete(modelId);
  }

  /**
   * Drops the entire reservation for a model, regardless of active route count.
   * Intended only for confirmed admin replace/remove where the caller has already
   * acknowledged that in-flight requests against the model may fail. Must not be
   * used as a substitute for a normal per-route release().
   */
  forceDropReservation(modelId: string): void {
    this.reservations.delete(modelId);
  }

  /** Models for which this router currently holds an in-flight memory reservation. */
  getLoadedModels(): string[] {
    return [...this.reservations.keys()];
  }
}
