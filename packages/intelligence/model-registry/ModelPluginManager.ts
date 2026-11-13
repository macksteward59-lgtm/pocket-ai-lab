/**
 * Plug-and-play model management: add or replace a model from a GitHub repo,
 * a Hugging Face repo, a direct URL, or a local GGUF/GGML file, on top of the
 * existing ModelRegistry/ModelRouter.
 *
 * This decides *which model descriptor is registered*; it never loads a model
 * into memory or runs inference itself (the host's InferenceProvider does
 * that once ModelRouter.route resolves a descriptor). Swapping a model that
 * is currently loaded is refused unless the caller explicitly confirms,
 * because agents are relying on that model mid-task.
 */
import { ModelRegistry, type ModelDescriptor } from "./ModelRegistry";
import { ModelRouter } from "../model-router/ModelRouter";
import { ModelSourceError, UnconfiguredFetcher, estimateMemoryMB, type ModelFetcher, type ModelSource } from "./ModelSource";

export interface AddModelInput {
  id: string;
  name: string;
  source: ModelSource;
  contextLength: number;
  capabilities: string[];
  quantization?: string;
  /** Overrides the size-derived estimate when the caller knows a better figure. */
  memoryEstimateMB?: number;
}

export interface ModelChangeLogEntry {
  at: string;
  action: "added" | "replaced" | "removed";
  modelId: string;
  previousModelId?: string;
  source: string;
}

export interface ReplaceModelOptions {
  /** Required to replace a model the router reports as currently loaded. */
  confirmReplaceLoaded?: boolean;
}

function describeSource(source: ModelSource): string {
  switch (source.type) {
    case "local-file": return source.path;
    case "huggingface": return `hf:${source.repoId}/${source.file}`;
    case "github": return `${source.repoUrl}#${source.ref ?? "default"}:${source.file}`;
    case "gguf-url": return source.url;
  }
}

export class ModelPluginManager {
  private readonly registry: ModelRegistry;
  private readonly router?: ModelRouter;
  private readonly fetcher: ModelFetcher;
  private readonly changeLog: ModelChangeLogEntry[] = [];
  private readonly maxChangeLogEntries: number;

  constructor(opts: { registry: ModelRegistry; router?: ModelRouter; fetcher?: ModelFetcher; maxChangeLogEntries?: number }) {
    this.registry = opts.registry;
    this.router = opts.router;
    this.fetcher = opts.fetcher ?? new UnconfiguredFetcher();
    this.maxChangeLogEntries = Math.max(1, opts.maxChangeLogEntries ?? 500);
  }

  /** Adds a new model. Throws if the id is already registered -- use replaceModel for that. */
  async addModel(input: AddModelInput): Promise<ModelDescriptor> {
    if (this.registry.has(input.id)) {
      throw new ModelSourceError(`Model ${input.id} is already registered; use replaceModel to swap it`);
    }
    const descriptor = await this.buildDescriptor(input);
    this.registry.register(descriptor);
    this.record({ action: "added", modelId: descriptor.id, source: describeSource(input.source) });
    return descriptor;
  }

  /**
   * Replaces an existing model's source/metadata under the same id (agent
   * associations survive automatically since they key on id), or removes the
   * old id and adds a new one when `input.id` differs from `existingId`.
   */
  async replaceModel(existingId: string, input: AddModelInput, options: ReplaceModelOptions = {}): Promise<ModelDescriptor> {
    if (!this.registry.has(existingId)) {
      throw new ModelSourceError(`Model ${existingId} is not registered; use addModel instead`);
    }
    const loadedElsewhere = this.router?.getLoadedModels().includes(existingId) ?? false;
    if (loadedElsewhere && !options.confirmReplaceLoaded) {
      throw new ModelSourceError(
        `Model ${existingId} is currently loaded; pass confirmReplaceLoaded: true to swap it anyway ` +
        "(in-flight requests against it may fail)"
      );
    }

    const descriptor = await this.buildDescriptor(input);
    this.registry.unregister(existingId);
    // Confirmed admin replace drops the whole reservation. Calling release()
    // once would steal a single route lease when multiple routes are active.
    if (loadedElsewhere) this.router?.forceDropReservation(existingId);
    this.registry.register(descriptor);
    this.record({ action: "replaced", modelId: descriptor.id, previousModelId: existingId, source: describeSource(input.source) });
    return descriptor;
  }

  /** Removes a model outright. Refuses if it is currently loaded, unless confirmed. */
  removeModel(id: string, options: ReplaceModelOptions = {}): boolean {
    const loaded = this.router?.getLoadedModels().includes(id) ?? false;
    if (loaded && !options.confirmReplaceLoaded) {
      throw new ModelSourceError(`Model ${id} is currently loaded; pass confirmReplaceLoaded: true to remove it anyway`);
    }
    const removed = this.registry.unregister(id);
    if (removed) {
      // Confirmed admin remove drops the whole reservation so concurrent route
      // leases are not partially consumed.
      if (loaded) this.router?.forceDropReservation(id);
      this.record({ action: "removed", modelId: id, source: "n/a" });
    }
    return removed;
  }

  /** Copy of the change log, oldest first. */
  getChangeLog(): ModelChangeLogEntry[] {
    return this.changeLog.map(entry => ({ ...entry }));
  }

  private async buildDescriptor(input: AddModelInput): Promise<ModelDescriptor> {
    if (!input.id?.trim()) throw new ModelSourceError("Model id is required");
    if (!input.name?.trim()) throw new ModelSourceError("Model name is required");
    if (!Number.isFinite(input.contextLength) || input.contextLength <= 0) {
      throw new ModelSourceError(`Model ${input.id} needs a positive contextLength`);
    }
    if (!input.capabilities?.length) throw new ModelSourceError(`Model ${input.id} needs at least one capability`);

    const resolved = await this.fetcher.resolve(input.source);
    if (!resolved.path?.trim()) throw new ModelSourceError(`Resolved model ${input.id} has no local path`);

    const memoryEstimateMB = input.memoryEstimateMB ?? estimateMemoryMB(resolved.sizeBytes);
    return {
      id: input.id,
      name: input.name,
      path: resolved.path,
      contextLength: input.contextLength,
      quantization: input.quantization,
      capabilities: [...input.capabilities],
      memoryEstimateMB
    };
  }

  private record(entry: Omit<ModelChangeLogEntry, "at">): void {
    this.changeLog.push({ at: new Date().toISOString(), ...entry });
    if (this.changeLog.length > this.maxChangeLogEntries) {
      this.changeLog.splice(0, this.changeLog.length - this.maxChangeLogEntries);
    }
  }
}
