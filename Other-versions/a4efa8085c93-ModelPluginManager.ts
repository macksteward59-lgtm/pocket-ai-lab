/**
 * Plug-and-play model management on top of the ModelRegistry/ModelRouter.
 *
 * This decides which descriptor is registered; it never loads a model or runs
 * inference. Replacements retire the old descriptor generation so existing
 * route leases can drain while new routes wait for fresh admission.
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
  /** Required to replace/remove a model while route leases are active. */
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

  async addModel(input: AddModelInput): Promise<ModelDescriptor> {
    if (this.registry.has(input.id)) {
      throw new ModelSourceError(`Model ${input.id} is already registered; use replaceModel to swap it`);
    }
    const descriptor = await this.buildDescriptor(input);
    // The source resolution is asynchronous; re-check before committing.
    if (this.registry.has(descriptor.id)) {
      throw new ModelSourceError(`Model ${descriptor.id} was registered while its source was being prepared`);
    }
    this.registry.register(descriptor);
    this.record({ action: "added", modelId: descriptor.id, source: describeSource(input.source) });
    return descriptor;
  }

  async replaceModel(existingId: string, input: AddModelInput, options: ReplaceModelOptions = {}): Promise<ModelDescriptor> {
    const existingDescriptor = this.registry.get(existingId);
    if (!existingDescriptor) {
      throw new ModelSourceError(`Model ${existingId} is not registered; use addModel instead`);
    }
    if (input.id !== existingId && this.registry.has(input.id)) {
      throw new ModelSourceError(`Model ${input.id} is already registered; replacement target IDs must be unique`);
    }

    const loadedBeforeBuild = this.router?.getLoadedModels().includes(existingId) ?? false;
    if (loadedBeforeBuild && !options.confirmReplaceLoaded) {
      throw new ModelSourceError(
        `Model ${existingId} is currently loaded; pass confirmReplaceLoaded: true to retire it and let existing requests drain`
      );
    }

    const descriptor = await this.buildDescriptor(input);

    // Another replacement/removal may have completed while the source was
    // resolving. Do not overwrite that newer descriptor.
    if (this.registry.get(existingId) !== existingDescriptor) {
      throw new ModelSourceError(
        `Model ${existingId} changed while its replacement was being prepared; retry against the current descriptor`
      );
    }
    if (input.id !== existingId && this.registry.has(input.id)) {
      throw new ModelSourceError(`Model ${input.id} was registered while its replacement was being prepared`);
    }

    // A route may have started while buildDescriptor awaited the fetcher.
    const loadedAtCommit = this.router?.getLoadedModels().includes(existingId) ?? false;
    if (loadedAtCommit && !options.confirmReplaceLoaded) {
      throw new ModelSourceError(
        `Model ${existingId} became loaded while its replacement was being prepared; retry with confirmReplaceLoaded: true`
      );
    }

    this.registry.unregister(existingId);
    // Retire even if no in-process lease is visible: the runtime may still
    // report the old artifact under the same ID. The replacement must load
    // successfully before that stale runtime ID can be trusted again.
    this.router?.retire(existingId, existingDescriptor);
    this.registry.register(descriptor);
    this.record({
      action: "replaced",
      modelId: descriptor.id,
      previousModelId: existingId,
      source: describeSource(input.source)
    });
    return descriptor;
  }

  removeModel(id: string, options: ReplaceModelOptions = {}): boolean {
    const existingDescriptor = this.registry.get(id);
    if (!existingDescriptor) return false;
    const loaded = this.router?.getLoadedModels().includes(id) ?? false;
    if (loaded && !options.confirmReplaceLoaded) {
      throw new ModelSourceError(
        `Model ${id} is currently loaded; pass confirmReplaceLoaded: true to retire it and let existing requests drain`
      );
    }
    const removed = this.registry.unregister(id);
    if (removed) {
      this.router?.retire(id, existingDescriptor);
      this.record({ action: "removed", modelId: id, source: "n/a" });
    }
    return removed;
  }

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
    if (!Number.isFinite(memoryEstimateMB) || memoryEstimateMB <= 0) {
      throw new ModelSourceError(`Model ${input.id} has an invalid memory estimate`);
    }
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
