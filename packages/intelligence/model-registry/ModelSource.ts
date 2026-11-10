/**
 * Model sources: where a GGUF (or other local-runtime) model file comes from.
 *
 * This module describes sources and validates the result; it does not fetch
 * anything itself. Downloading from Hugging Face, GitHub, or an arbitrary URL
 * needs network access this package does not assume it has, so fetching is an
 * injected `ModelFetcher` the host app implements (e.g. with its own HTTP
 * client and disk cache). The only fetcher provided here, `LocalFileFetcher`,
 * handles a file already on disk and needs no network.
 */
import { stat } from "node:fs/promises";

export type ModelSource =
  | { type: "local-file"; path: string }
  | { type: "huggingface"; repoId: string; file: string; revision?: string }
  | { type: "github"; repoUrl: string; file: string; ref?: string }
  | { type: "gguf-url"; url: string };

export interface ResolvedModel {
  /** Local filesystem path to the model file, ready for the inference host to load. */
  path: string;
  sizeBytes: number;
  sha256?: string;
}

export interface ModelFetcher {
  /** Resolves a source to a local file. Should throw rather than return a partial result. */
  resolve(source: ModelSource): Promise<ResolvedModel>;
}

export class ModelSourceError extends Error {}

function describeSource(source: ModelSource): string {
  switch (source.type) {
    case "local-file": return source.path;
    case "huggingface": return `hf:${source.repoId}/${source.file}`;
    case "github": return `${source.repoUrl}#${source.ref ?? "default"}:${source.file}`;
    case "gguf-url": return source.url;
  }
}

/**
 * Handles `local-file` sources only, with no network access. Any remote
 * source type is refused with a clear message naming what is missing, rather
 * than silently doing nothing or guessing a path.
 */
export class LocalFileFetcher implements ModelFetcher {
  async resolve(source: ModelSource): Promise<ResolvedModel> {
    if (source.type !== "local-file") {
      throw new ModelSourceError(
        `LocalFileFetcher cannot resolve a "${source.type}" source (${describeSource(source)}); ` +
        "inject a ModelFetcher with network access to support Hugging Face, GitHub, or URL sources"
      );
    }
    if (!source.path?.trim()) throw new ModelSourceError("local-file source needs a non-empty path");
    let info: { size: number; isFile: () => boolean };
    try {
      info = await stat(source.path);
    } catch (err) {
      throw new ModelSourceError(`Could not read local model file ${source.path}: ${(err as Error).message}`);
    }
    if (!info.isFile()) throw new ModelSourceError(`Local model path ${source.path} is not a file`);
    if (!/\.(gguf|ggml|bin)$/i.test(source.path)) {
      throw new ModelSourceError(`Local model file ${source.path} does not look like a model file (expected .gguf/.ggml/.bin)`);
    }
    return { path: source.path, sizeBytes: info.size };
  }
}

/**
 * A fetcher that always refuses. Used as the default so that "no fetcher
 * configured" fails loudly and specifically, instead of a plugin manager
 * silently falling back to something that looks like it works but can't
 * reach the network.
 */
export class UnconfiguredFetcher implements ModelFetcher {
  async resolve(source: ModelSource): Promise<ResolvedModel> {
    throw new ModelSourceError(
      `No ModelFetcher capable of "${source.type}" sources is configured (requested: ${describeSource(source)}). ` +
      "Pass one to ModelPluginManager; LocalFileFetcher covers local-file sources only."
    );
  }
}

/** Rough memory estimate from file size when the caller does not supply one. Intentionally conservative (generous). */
export function estimateMemoryMB(sizeBytes: number, overheadFactor = 1.2): number {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new ModelSourceError("sizeBytes must be a positive number");
  return Math.ceil((sizeBytes / (1024 * 1024)) * overheadFactor);
}
