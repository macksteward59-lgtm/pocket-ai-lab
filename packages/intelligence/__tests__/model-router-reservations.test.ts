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

describe("ModelRouter generation-aware reservation leases", () => {
  it("keeps a shared exact descriptor reservation until every route releases", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 512, loadedModels: [] }));
    const shared = model("shared", 512);

    await router.route("reasoner", shared, ["reason"]);
    await router.route("researcher", shared, ["reason"]);
    expect(router.getLoadedModels()).toEqual(["shared"]);

    router.release(shared);
    await expect(router.route("engineer", model("other", 128), ["reason"]))
      .rejects.toThrow(/Insufficient memory/);

    router.release(shared);
    expect(router.getLoadedModels()).toEqual([]);
    await expect(router.route("engineer", model("other", 128), ["reason"]))
      .resolves.toMatchObject({ id: "other" });
  });

  it("does not reserve or release models owned by the runtime", async () => {
    const external = model("runtime-owned", 512);
    const router = new ModelRouter(() => ({ availableMemoryMB: 0, loadedModels: ["runtime-owned"] }));
    await router.route("reasoner", external, ["reason"]);
    expect(router.getLoadedModels()).toEqual([]);
    router.release(external);
    expect(router.getLoadedModels()).toEqual([]);
  });

  it("rejects a changed memory estimate while route leases are active", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 1024, loadedModels: [] }));
    const shared = model("shared", 256);
    await router.route("reasoner", shared, ["reason"]);
    shared.memoryEstimateMB = 512;
    await expect(router.route("researcher", shared, ["reason"]))
      .rejects.toThrow(/descriptor changed/);
    router.release(shared);
  });

  it("rejects path or ID mutation while preserving exact lease release", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 1024, loadedModels: [] }));
    const descriptor = model("mutable", 256);
    await router.route("reasoner", descriptor, ["reason"]);
    descriptor.path = "/models/changed.gguf";
    await expect(router.route("researcher", descriptor, ["reason"]))
      .rejects.toThrow(/descriptor changed/);
    descriptor.id = "changed-id";
    await expect(router.route("validator", descriptor, ["reason"]))
      .rejects.toThrow(/identity changed/);
    // Release locates the exact descriptor object, even if its mutable ID was changed.
    router.release(descriptor);
    expect(router.getLoadedModels()).toEqual([]);
  });

  it("rejects a different descriptor generation until the old generation drains", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 1024, loadedModels: [] }));
    const oldDescriptor = model("same-id", 256);
    const replacement = model("same-id", 512);
    await router.route("reasoner", oldDescriptor, ["reason"]);
    router.retire("same-id", oldDescriptor);

    await expect(router.route("researcher", oldDescriptor, ["reason"]))
      .rejects.toThrow(/retired/);
    await expect(router.route("engineer", replacement, ["reason"]))
      .rejects.toThrow(/previous generation drains/);

    router.release(oldDescriptor);
    expect(router.getLoadedModels()).toEqual([]);
    await expect(router.route("engineer", replacement, ["reason"]))
      .resolves.toBe(replacement);
    expect(router.getLoadedModels()).toEqual(["same-id"]);
  });

  it("requires fresh admission after retirement even when the provider reports a stale loaded ID", async () => {
    const resources = { availableMemoryMB: 0, loadedModels: ["same-id"] };
    const router = new ModelRouter(() => resources);
    const oldDescriptor = model("same-id", 256);
    const replacement = model("same-id", 256);
    router.retire("same-id", oldDescriptor);

    await expect(router.route("reasoner", replacement, ["reason"]))
      .rejects.toThrow(/Insufficient memory/);
    expect(router.getLoadedModels()).toEqual([]);
  });

  it("does not clear the fresh-load requirement until generation is confirmed", async () => {
    const resources = { availableMemoryMB: 512, loadedModels: ["same-id"] };
    const router = new ModelRouter(() => resources);
    const oldDescriptor = model("same-id", 256);
    const replacement = model("same-id", 256);
    router.retire("same-id", oldDescriptor);

    await router.route("reasoner", replacement, ["reason"]);
    router.release(replacement);
    resources.availableMemoryMB = 0;
    await expect(router.route("researcher", replacement, ["reason"]))
      .rejects.toThrow(/Insufficient memory/);
  });

  it("reuses an externally loaded replacement only after successful generation confirmation", async () => {
    const resources = { availableMemoryMB: 512, loadedModels: ["same-id"] };
    const router = new ModelRouter(() => resources);
    const oldDescriptor = model("same-id", 256);
    const replacement = model("same-id", 256);
    router.retire("same-id", oldDescriptor);

    await router.route("reasoner", replacement, ["reason"]);
    router.confirmLoaded(replacement);
    router.release(replacement);
    resources.availableMemoryMB = 0;
    await expect(router.route("researcher", replacement, ["reason"]))
      .resolves.toBe(replacement);
    expect(router.getLoadedModels()).toEqual([]);
  });

  it("does not confirm a retired descriptor", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 512, loadedModels: [] }));
    const descriptor = model("retired", 256);
    await router.route("reasoner", descriptor, ["reason"]);
    router.retire("retired", descriptor);
    router.confirmLoaded(descriptor);
    router.release(descriptor);
    await expect(router.route("reasoner", descriptor, ["reason"]))
      .rejects.toThrow(/retired/);
  });

  it("rejects malformed runtime resource reports", async () => {
    const router = new ModelRouter(() => ({
      availableMemoryMB: 1024,
      loadedModels: "shared" as unknown as string[]
    }));
    await expect(router.route("reasoner", model("shared", 256), ["reason"]))
      .rejects.toThrow(/invalid loaded-model list/);
  });
});
