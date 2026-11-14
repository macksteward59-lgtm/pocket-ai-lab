/**
 * Fail-closed model selection and generation-aware resource accounting.
 *
 * A route returns the exact descriptor generation that must later be released.
 * Replacements retire old generations and drain their in-flight leases before
 * a new descriptor with the same ID can route. A reservation is not proof that
 * the runtime loaded a model; callers confirm only after successful inference.
 */
import type { ModelDescriptor } from "../model-registry/ModelRegistry";

export interface ResourceReport {
  availableMemoryMB: number;
  loadedModels: string[];
}

interface Reservation {
  descriptor: ModelDescriptor;
  memoryMB: number;
  fingerprint: string;
  references: number;
  retired: boolean;
}

export class ModelRouter {
  /** Multiple generations may coexist only while a retired generation drains. */
  private reservations = new Map<string, Reservation[]>();
  /** IDs whose prior artifact was retired and whose replacement load is unconfirmed. */
  private requiresFreshLoad = new Set<string>();
  private retiredDescriptors = new WeakSet<ModelDescriptor>();
  private descriptorIds = new WeakMap<ModelDescriptor, string>();

  constructor(private readonly getResources: () => ResourceReport) {}

  async route(
    agentId: string,
    preferred: ModelDescriptor | undefined,
    requiredCaps: string[]
  ): Promise<ModelDescriptor> {
    if (typeof agentId !== "string" || !agentId.trim()) throw new Error("agentId is required");
    if (!preferred) throw new Error("No model is registered for agent " + agentId);
    if (this.retiredDescriptors.has(preferred)) {
      throw new Error("Model " + preferred.id + " has been retired and cannot accept new routes");
    }
    const originalId = this.descriptorIds.get(preferred);
    if (originalId !== undefined && originalId !== preferred.id) {
      throw new Error("Model descriptor identity changed its model ID");
    }
    if (typeof preferred.id !== "string" || !preferred.id.trim() ||
        typeof preferred.path !== "string" || !preferred.path.trim()) {
      throw new Error("Model " + String(preferred.id) + " has no configured runtime path");
    }
    this.descriptorIds.set(preferred, preferred.id);
    if (!Number.isFinite(preferred.memoryEstimateMB) || preferred.memoryEstimateMB <= 0) {
      throw new Error("Model " + preferred.id + " has an invalid memory estimate");
    }
    if (!Array.isArray(preferred.capabilities) ||
        preferred.capabilities.some(capability => typeof capability !== "string" || !capability.trim()) ||
        !Array.isArray(requiredCaps) ||
        requiredCaps.some(capability => typeof capability !== "string" || !capability.trim())) {
      throw new Error("Model capability inventory is invalid");
    }
    const missing = requiredCaps.filter(cap => !preferred.capabilities.includes(cap));
    if (missing.length) {
      throw new Error("Model " + preferred.id + " lacks required capabilities: " + missing.join(", "));
    }

    const resources = this.getResources();
    if (!resources || !Number.isFinite(resources.availableMemoryMB) || resources.availableMemoryMB < 0) {
      throw new Error("Resource provider returned invalid available memory");
    }
    if (!Array.isArray(resources.loadedModels) ||
        !resources.loadedModels.every(id => typeof id === "string")) {
      throw new Error("Resource provider returned an invalid loaded-model list");
    }

    const generations = this.reservations.get(preferred.id) ?? [];
    const existing = generations.find(reservation => reservation.descriptor === preferred);
    const fingerprint = descriptorFingerprint(preferred);
    if (existing && existing.fingerprint !== fingerprint) {
      throw new Error("Model " + preferred.id + " descriptor changed while route leases are active");
    }
    if (existing?.retired || this.retiredDescriptors.has(preferred)) {
      throw new Error("Model " + preferred.id + " has been retired and cannot accept new routes");
    }
    if (generations.some(reservation => reservation.descriptor !== preferred)) {
      throw new Error("Model " + preferred.id + " is being replaced until the previous generation drains");
    }

    // A reported loaded ID is reusable only when this router has no tracked
    // generation and the ID has not been invalidated by a replacement/removal.
    const externallyLoaded = generations.length === 0 &&
      !this.requiresFreshLoad.has(preferred.id) &&
      resources.loadedModels.includes(preferred.id);
    const reservedElsewhere = [...this.reservations.values()]
      .flat()
      .filter(reservation => reservation !== existing)
      .reduce((sum, reservation) => sum + reservation.memoryMB, 0);
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
        fingerprint,
        references: 1,
        retired: false
      });
      this.reservations.set(preferred.id, generations);
    }
    return preferred;
  }

  /**
   * Retire the current generation for an ID. Existing route leases remain
   * accounted for until released. A stale runtime loadedModels entry cannot
   * make a replacement appear loaded.
   */
  retire(modelId: string, descriptor?: ModelDescriptor): void {
    if (typeof modelId !== "string" || !modelId.trim()) return;
    this.requiresFreshLoad.add(modelId);
    if (descriptor) this.retiredDescriptors.add(descriptor);
    const generations = this.reservations.get(modelId);
    if (!generations) return;
    for (const reservation of generations) {
      reservation.retired = true;
      this.retiredDescriptors.add(reservation.descriptor);
    }
  }

  /**
   * Confirm a replacement only after the inference provider successfully
   * generates with that exact descriptor. Route selection alone is not load proof.
   */
  confirmLoaded(descriptor: ModelDescriptor): void {
    if (this.retiredDescriptors.has(descriptor)) return;
    for (const [modelId, generations] of this.reservations) {
      const activeGeneration = generations.some(
        reservation => reservation.descriptor === descriptor && !reservation.retired
      );
      if (activeGeneration) {
        this.requiresFreshLoad.delete(modelId);
        return;
      }
    }
  }

  /** Release the exact descriptor generation returned by route(). */
  release(descriptor: ModelDescriptor): void {
    for (const [modelId, generations] of this.reservations) {
      const reservation = generations.find(item => item.descriptor === descriptor);
      if (!reservation) continue;
      reservation.references -= 1;
      if (reservation.references <= 0) {
        const remaining = generations.filter(item => item !== reservation);
        if (remaining.length) this.reservations.set(modelId, remaining);
        else this.reservations.delete(modelId);
      }
      return;
    }
  }

  /** IDs with one or more active route leases owned by this router. */
  getLoadedModels(): string[] {
    return [...this.reservations.keys()];
  }
}


function descriptorFingerprint(descriptor: ModelDescriptor): string {
  return JSON.stringify({
    id: descriptor.id,
    name: descriptor.name,
    path: descriptor.path,
    contextLength: descriptor.contextLength,
    quantization: descriptor.quantization ?? null,
    capabilities: [...descriptor.capabilities],
    memoryEstimateMB: descriptor.memoryEstimateMB
  });
}
