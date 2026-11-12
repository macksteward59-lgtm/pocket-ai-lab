/**
 * Fail-closed model selection and resource accounting.
 * Waiting indefinitely for memory is deliberately avoided; callers may retry.
 */
import { ModelDescriptor } from "../model-registry/ModelRegistry";

export interface ResourceReport {
  availableMemoryMB: number;
  loadedModels: string[];
}

interface Reservation {
  /** Descriptor identity distinguishes old and replacement generations sharing an ID. */
  descriptor: ModelDescriptor;
  memoryMB: number;
  references: number;
  retired: boolean;
}

export class ModelRouter {
  /** Multiple generations may coexist while requests against a replaced model drain. */
  private reservations = new Map<string, Reservation[]>();

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

    const generations = this.reservations.get(preferred.id) ?? [];
    const existing = generations.find(reservation => reservation.descriptor === preferred);
    if (existing?.retired) throw new Error("Model " + preferred.id + " has been retired and cannot accept new routes");
    const reservedElsewhere = [...this.reservations.values()]
      .flat()
      .filter(reservation => reservation !== existing)
      .reduce((sum, reservation) => sum + reservation.memoryMB, 0);
    // A reported loaded ID is only reusable when this router has no tracked
    // generation for that ID. Otherwise it may refer to the retired generation.
    const externallyLoaded = generations.length === 0 && resources.loadedModels.includes(preferred.id);
    const available = Math.max(0, resources.availableMemoryMB - reservedElsewhere);

    if (!existing && !externallyLoaded && available < preferred.memoryEstimateMB) {
      throw new Error(
        "Insufficient memory for " + preferred.id + ": requires " +
        preferred.memoryEstimateMB + "MB, " + available + "MB available"
      );
    }

    if (existing) {
      existing.references += 1;
    } else if (!externallyLoaded) {
      generations.push({
        descriptor: preferred,
        memoryMB: preferred.memoryEstimateMB,
        references: 1,
        retired: false
      });
      this.reservations.set(preferred.id, generations);
    }
    return preferred;
  }

  /**
   * Retire every currently reserved generation for this ID. Existing leases
   * remain accounted for until their exact descriptor is released.
   */
  retire(modelId: string): void {
    const generations = this.reservations.get(modelId);
    if (!generations) return;
    for (const reservation of generations) reservation.retired = true;
  }

  /** Release the exact descriptor generation returned by route(). */
  release(descriptor: ModelDescriptor): void {
    const generations = this.reservations.get(descriptor.id);
    if (!generations) return;
    const reservation = generations.find(item => item.descriptor === descriptor);
    if (!reservation) return;
    reservation.references -= 1;
    if (reservation.references <= 0) {
      const remaining = generations.filter(item => item !== reservation);
      if (remaining.length) this.reservations.set(descriptor.id, remaining);
      else this.reservations.delete(descriptor.id);
    }
  }

  getLoadedModels(): string[] {
    return [...this.reservations.keys()];
  }
}
