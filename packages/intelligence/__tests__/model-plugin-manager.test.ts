import { describe, expect, it } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ModelRegistry } from "../model-registry/ModelRegistry";
import { ModelRouter } from "../model-router/ModelRouter";
import { ModelPluginManager } from "../model-registry/ModelPluginManager";
import { LocalFileFetcher, UnconfiguredFetcher, ModelSourceError, estimateMemoryMB } from "../model-registry/ModelSource";

async function withGgufFile<T>(bytes: number, fn: (filePath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "model-plugin-"));
  const filePath = path.join(dir, "model.gguf");
  await writeFile(filePath, Buffer.alloc(bytes, 1));
  try {
    return await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const baseInput = (filePath: string, id = "local-llama") => ({
  id, name: "Local Llama", source: { type: "local-file" as const, path: filePath },
  contextLength: 4096, capabilities: ["reason", "code"]
});

describe("LocalFileFetcher", () => {
  it("resolves a real local .gguf file and reports its size", async () =>
    withGgufFile(2048, async filePath => {
      const resolved = await new LocalFileFetcher().resolve({ type: "local-file", path: filePath });
      expect(resolved.path).toBe(filePath);
      expect(resolved.sizeBytes).toBe(2048);
    }));

  it("refuses a missing file and a non-model extension", async () => {
    const fetcher = new LocalFileFetcher();
    await expect(fetcher.resolve({ type: "local-file", path: "/no/such/file.gguf" })).rejects.toThrow(/Could not read local model file/);
    let threw: unknown;
    try { await fetcher.resolve({ type: "local-file", path: "/no/such/file.gguf" }); } catch (e) { threw = e; }
    expect(threw instanceof ModelSourceError).toBe(true);
    await withGgufFile(10, async filePath => {
      const txtPath = filePath.replace(/\.gguf$/, ".txt");
      await writeFile(txtPath, "not a model");
      await expect(fetcher.resolve({ type: "local-file", path: txtPath })).rejects.toThrow(/does not look like a model file/);
    });
  });

  it("refuses non-local-file sources by name, without guessing a path", async () => {
    await expect(new LocalFileFetcher().resolve({ type: "huggingface", repoId: "org/repo", file: "model.gguf" }))
      .rejects.toThrow(/cannot resolve a "huggingface" source/);
  });
});

describe("UnconfiguredFetcher", () => {
  it("always refuses, naming the requested source", async () => {
    await expect(new UnconfiguredFetcher().resolve({ type: "gguf-url", url: "https://example.com/m.gguf" }))
      .rejects.toThrow(/No ModelFetcher/);
  });
});

describe("estimateMemoryMB", () => {
  it("scales with size and overhead factor, and rejects bad input", () => {
    expect(estimateMemoryMB(1024 * 1024)).toBe(2); // 1MB * 1.2 rounds up
    expect(estimateMemoryMB(1024 * 1024, 1)).toBe(1);
    expect(() => estimateMemoryMB(0)).toThrow();
    expect(() => estimateMemoryMB(-5)).toThrow();
  });
});

describe("ModelPluginManager", () => {
  it("adds a model from a local-file source end to end", async () =>
    withGgufFile(10 * 1024 * 1024, async filePath => {
      const registry = new ModelRegistry();
      const manager = new ModelPluginManager({ registry, fetcher: new LocalFileFetcher() });
      const descriptor = await manager.addModel(baseInput(filePath));
      expect(descriptor.path).toBe(filePath);
      expect(descriptor.memoryEstimateMB).toBeGreaterThan(10);
      expect(registry.get("local-llama")).toBeDefined();
      expect(manager.getChangeLog()).toHaveLength(1);
      expect(manager.getChangeLog()[0].action).toBe("added");
    }));

  it("refuses to add a model whose id is already registered", async () =>
    withGgufFile(1024, async filePath => {
      const registry = new ModelRegistry();
      const manager = new ModelPluginManager({ registry, fetcher: new LocalFileFetcher() });
      await manager.addModel(baseInput(filePath));
      await expect(manager.addModel(baseInput(filePath))).rejects.toThrow(/already registered/);
    }));

  it("refuses remote sources without an injected fetcher, with a specific error", async () => {
    const registry = new ModelRegistry();
    const manager = new ModelPluginManager({ registry });
    await expect(manager.addModel({
      id: "remote-model", name: "Remote", contextLength: 2048, capabilities: ["reason"],
      source: { type: "huggingface", repoId: "org/repo", file: "model.gguf" }
    })).rejects.toThrow(/No ModelFetcher/);
    expect(registry.has("remote-model")).toBe(false);
  });

  it("validates id, name, contextLength, and capabilities before ever calling the fetcher", async () => {
    const registry = new ModelRegistry();
    let fetcherCalls = 0;
    const countingFetcher = { resolve: async () => { fetcherCalls++; return { path: "/x.gguf", sizeBytes: 1 }; } };
    const manager = new ModelPluginManager({ registry, fetcher: countingFetcher });
    const src = { type: "local-file" as const, path: "/x.gguf" };
    await expect(manager.addModel({ id: "", name: "n", contextLength: 1, capabilities: ["a"], source: src })).rejects.toThrow(/id is required/);
    await expect(manager.addModel({ id: "x", name: "", contextLength: 1, capabilities: ["a"], source: src })).rejects.toThrow(/name is required/);
    await expect(manager.addModel({ id: "x", name: "n", contextLength: 0, capabilities: ["a"], source: src })).rejects.toThrow(/contextLength/);
    await expect(manager.addModel({ id: "x", name: "n", contextLength: 1, capabilities: [], source: src })).rejects.toThrow(/capability/);
    expect(fetcherCalls).toBe(0);
  });

  it("replaces a model that is not loaded without any confirmation flag", async () =>
    withGgufFile(1024, async filePath => {
      const registry = new ModelRegistry();
      const manager = new ModelPluginManager({ registry, fetcher: new LocalFileFetcher() });
      await manager.addModel(baseInput(filePath));
      const replaced = await manager.replaceModel("local-llama", baseInput(filePath, "local-llama"));
      expect(replaced.id).toBe("local-llama");
      expect(manager.getChangeLog().map(e => e.action)).toEqual(["added", "replaced"]);
    }));

  it("retires all old leases before admitting a confirmed replacement with a fresh memory check", async () =>
    withGgufFile(1024, async filePath => {
      const replacementPath = path.join(path.dirname(filePath), "replacement.gguf");
      await writeFile(replacementPath, Buffer.alloc(1024, 2));
      const registry = new ModelRegistry();
      const router = new ModelRouter(() => ({ availableMemoryMB: 1024, loadedModels: [] }));
      const manager = new ModelPluginManager({ registry, router, fetcher: new LocalFileFetcher() });
      await manager.addModel({ ...baseInput(filePath), memoryEstimateMB: 256 });
      const oldDescriptor = registry.get("local-llama");
      await Promise.all([
        router.route("agent-1", oldDescriptor, []),
        router.route("agent-2", oldDescriptor, [])
      ]);

      await expect(manager.replaceModel("local-llama", {
        ...baseInput(replacementPath), memoryEstimateMB: 1536
      })).rejects.toThrow(/currently loaded/);

      const replaced = await manager.replaceModel("local-llama", {
        ...baseInput(replacementPath), memoryEstimateMB: 1536
      }, { confirmReplaceLoaded: true });
      expect(replaced.path).toBe(replacementPath);
      expect(router.getLoadedModels()).toContain("local-llama");

      await expect(router.route("agent-3", registry.get("local-llama"), []))
        .rejects.toThrow(/being replaced/);
      router.release(oldDescriptor!);
      await expect(router.route("agent-3", registry.get("local-llama"), []))
        .rejects.toThrow(/being replaced/);

      router.release(oldDescriptor!);
      expect(router.getLoadedModels()).not.toContain("local-llama");
      await expect(router.route("agent-3", registry.get("local-llama"), []))
        .rejects.toThrow(/Insufficient memory/);
    }));

  it("rechecks memory after replacing an externally loaded model with no router lease", async () =>
    withGgufFile(1024, async filePath => {
      const replacementPath = path.join(path.dirname(filePath), "external-replacement.gguf");
      await writeFile(replacementPath, Buffer.alloc(1024, 3));
      const registry = new ModelRegistry();
      const router = new ModelRouter(() => ({
        availableMemoryMB: 1024,
        loadedModels: ["local-llama"]
      }));
      const manager = new ModelPluginManager({ registry, router, fetcher: new LocalFileFetcher() });
      await manager.addModel({ ...baseInput(filePath), memoryEstimateMB: 256 });

      await manager.replaceModel("local-llama", {
        ...baseInput(replacementPath), memoryEstimateMB: 1536
      });

      await expect(router.route("agent-1", registry.get("local-llama"), []))
        .rejects.toThrow(/Insufficient memory/);
    }));

  it("refuses replaceModel for an id that was never registered", async () =>
    withGgufFile(1024, async filePath => {
      const manager = new ModelPluginManager({ registry: new ModelRegistry(), fetcher: new LocalFileFetcher() });
      await expect(manager.replaceModel("nope", baseInput(filePath))).rejects.toThrow(/not registered/);
    }));

  it("removes a model, refusing if loaded unless confirmed, and records the change", async () =>
    withGgufFile(1024, async filePath => {
      const registry = new ModelRegistry();
      const router = new ModelRouter(() => ({ availableMemoryMB: 1024, loadedModels: [] }));
      const manager = new ModelPluginManager({ registry, router, fetcher: new LocalFileFetcher() });
      await manager.addModel(baseInput(filePath));
      await router.route("agent-1", registry.get("local-llama"), []);

      expect(() => manager.removeModel("local-llama")).toThrow(/currently loaded/);
      expect(manager.removeModel("local-llama", { confirmReplaceLoaded: true })).toBe(true);
      expect(registry.has("local-llama")).toBe(false);
      expect(manager.removeModel("local-llama")).toBe(false); // already gone, no throw, no duplicate log entry
      expect(manager.getChangeLog().filter(e => e.action === "removed")).toHaveLength(1);
    }));

  it("caps the change log and returns defensive copies", async () =>
    withGgufFile(1024, async filePath => {
      const manager = new ModelPluginManager({ registry: new ModelRegistry(), fetcher: new LocalFileFetcher(), maxChangeLogEntries: 2 });
      await manager.addModel(baseInput(filePath, "m1"));
      await manager.addModel(baseInput(filePath, "m2"));
      await manager.addModel(baseInput(filePath, "m3"));
      const log = manager.getChangeLog();
      expect(log).toHaveLength(2);
      log[0].action = "removed" as never;
      expect(manager.getChangeLog()[0].action).not.toBe("removed");
    }));
});
