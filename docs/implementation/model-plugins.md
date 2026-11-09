# Model plugins: implementation notes

Design: register or swap a model descriptor from a local GGUF file.
Hugging Face, GitHub, and direct URL sources are names only. The default
fetcher refuses them. This package does not download, does not load weights
into the orchestrator, and does not change the injected `InferenceProvider`.
Model text stays untrusted.

## Code map
- `packages/intelligence/model-registry/ModelSource.ts` -- `ModelSource` (the
  four source shapes), `ModelFetcher` interface, `LocalFileFetcher` (handles
  `local-file` only, no network), `UnconfiguredFetcher` (the default; always
  refuses, by design, so a missing fetcher fails loudly and specifically
  instead of silently doing nothing).
- `packages/intelligence/model-registry/ModelPluginManager.ts` --
  `addModel`, `replaceModel`, `removeModel`, `getChangeLog()`.
- `packages/intelligence/model-registry/ModelRegistry.ts` -- gained `has()`,
  `get()`, `unregister()` to support the above; nothing existing changed.

## Usage
```ts
import { ModelRegistry } from "./packages/intelligence/model-registry/ModelRegistry";
import { ModelRouter } from "./packages/intelligence/model-router/ModelRouter";
import { ModelPluginManager } from "./packages/intelligence/model-registry/ModelPluginManager";
import { LocalFileFetcher } from "./packages/intelligence/model-registry/ModelSource";

const registry = new ModelRegistry();
const router = new ModelRouter(() => hostResourceSnapshot());
const manager = new ModelPluginManager({ registry, router, fetcher: new LocalFileFetcher() });

await manager.addModel({
  id: "local-llama-8b", name: "Llama 3 8B (local)",
  source: { type: "local-file", path: "/models/llama-3-8b.Q4_K_M.gguf" },
  contextLength: 8192, capabilities: ["reason", "code"]
});

// Swapping a model that's currently loaded needs explicit confirmation:
await manager.replaceModel("local-llama-8b", { /* new AddModelInput */ }, { confirmReplaceLoaded: true });
```

To support Hugging Face / GitHub / URL sources, implement `ModelFetcher.resolve()`
yourself (download to disk, return the local path and size) and pass it as
`fetcher`. Nothing here can do that download inside this package -- it has
no network access, deliberately, so it cannot silently fetch from the
internet on your behalf.

## Known limitations
- `estimateMemoryMB` is a rough file-size-times-overhead estimate, not a
  measurement of actual runtime memory (context length, KV cache, and
  quantization scheme all affect real usage). Pass `memoryEstimateMB`
  explicitly when you know a better number.
- `removeModel`/`replaceModel` check `ModelRouter.getLoadedModels()`, which
  reflects only reservations *this* router instance made via `route()` --
  not an externally reported "loaded" list. If multiple router instances or
  processes can load the same model, this check does not see across them.
- No validation that a `.gguf` file is actually well-formed (correct magic
  bytes, valid header); only the extension is checked.
