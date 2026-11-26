import { describe, expect, it } from "vitest";
import { ModelRouter } from "../model-router/ModelRouter";
import type { ModelDescriptor } from "../model-registry/ModelRegistry";

const model = (id: string, memoryEstimateMB: number): ModelDescriptor => ({
  id,
  name: id,
  path: "/models/" + id + ".gguf",
  contextLength: 2048,
  capabilities: ["reason"],
  memoryEstimateMB
});

describe("ModelRouter reservation leases", () => {
  it("keeps a shared model reservation until every concurrent route releases", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 512, loadedModels: [] }));
    const shared = model("shared", 512);

    const first = await router.route("reasoner", shared, ["reason"]);
    const second = await router.route("researcher", shared, ["reason"]);
    expect(router.getLoadedModels()).toEqual(["shared"]);

    router.release(first);
    await expect(router.route("engineer", model("other", 128), ["reason"]))
      .rejects.toThrow(/Insufficient memory/);

    router.release(second);
    expect(router.getLoadedModels()).toEqual([]);
    const other = await router.route("engineer", model("other", 128), ["reason"]);
    expect(other.id).toBe("other");
    router.release(other);
  });

  it("does not reserve or release models owned by the runtime", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 0, loadedModels: ["runtime-owned"] }));
    const external = model("runtime-owned", 512);
    const lease = await router.route("reasoner", external, ["reason"]);
    expect(router.getLoadedModels()).toEqual([]);
    router.release(lease);
    expect(router.getLoadedModels()).toEqual([]);
  });

  it("rejects a changed memory estimate while route leases are active", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 1024, loadedModels: [] }));
    const shared = model("shared", 256);
    await router.route("reasoner", shared, ["reason"]);
    shared.memoryEstimateMB = 512;
    await expect(router.route("researcher", shared, ["reason"]))
      .rejects.toThrow(/changed its memory estimate/);
    router.release(shared);
  });

  it("rejects malformed runtime resource reports", async () => {
    const router = new ModelRouter(() => ({
      availableMemoryMB: 1024,
      loadedModels: "shared" as unknown as string[]
    }));
    await expect(router.route("reasoner", model("shared", 256), ["reason"]))
      .rejects.toThrow(/invalid loaded-model list/);
  });

  it("keeps retired generations reserved until all old leases drain", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 512, loadedModels: [] }));
    const oldModel = model("shared", 512);
    const first = await router.route("reasoner", oldModel, ["reason"]);
    const second = await router.route("researcher", oldModel, ["reason"]);

    router.retire("shared", oldModel);
    expect(router.getLoadedModels()).toEqual(["shared"]);
    await expect(router.route("engineer", oldModel, ["reason"])).rejects.toThrow(/retired/);
    const replacement = model("shared", 128);
    await expect(router.route("engineer", replacement, ["reason"])).rejects.toThrow(/being replaced/);

    router.release(first);
    expect(router.getLoadedModels()).toEqual(["shared"]);
    router.release(second);
    expect(router.getLoadedModels()).toEqual([]);

    const replacementLease = await router.route("engineer", replacement, ["reason"]);
    expect(replacementLease).toBe(replacement);
    router.release(replacementLease);
  });
});
