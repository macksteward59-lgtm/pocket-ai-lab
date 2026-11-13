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

    await router.route("reasoner", model("shared", 512), ["reason"]);
    await router.route("researcher", model("shared", 512), ["reason"]);
    expect(router.getLoadedModels()).toEqual(["shared"]);

    // One consumer finishing must not free memory while another still uses the model.
    router.release("shared");
    await expect(router.route("engineer", model("other", 128), ["reason"]))
      .rejects.toThrow(/Insufficient memory/);

    router.release("shared");
    expect(router.getLoadedModels()).toEqual([]);
    await expect(router.route("engineer", model("other", 128), ["reason"])).resolves.toMatchObject({
      id: "other"
    });
  });

  it("does not reserve or release models owned by the runtime", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 0, loadedModels: ["runtime-owned"] }));
    await router.route("reasoner", model("runtime-owned", 512), ["reason"]);
    expect(router.getLoadedModels()).toEqual([]);
    router.release("runtime-owned");
    expect(router.getLoadedModels()).toEqual([]);
  });

  it("rejects a changed memory estimate while route leases are active", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 1024, loadedModels: [] }));
    await router.route("reasoner", model("shared", 256), ["reason"]);
    await expect(router.route("researcher", model("shared", 512), ["reason"]))
      .rejects.toThrow(/changed its memory estimate/);
    router.release("shared");
  });

  it("rejects malformed runtime resource reports", async () => {
    const router = new ModelRouter(() => ({
      availableMemoryMB: 1024,
      loadedModels: "shared" as unknown as string[]
    }));
    await expect(router.route("reasoner", model("shared", 256), ["reason"]))
      .rejects.toThrow(/invalid loaded-model list/);
  });

  it("forceDropReservation clears all route leases without partial release", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 512, loadedModels: [] }));

    await router.route("reasoner", model("shared", 512), ["reason"]);
    await router.route("researcher", model("shared", 512), ["reason"]);
    expect(router.getLoadedModels()).toEqual(["shared"]);

    // Admin drop must not leave a half-open lease count.
    router.forceDropReservation("shared");
    expect(router.getLoadedModels()).toEqual([]);

    // Subsequent per-route releases are no-ops once the reservation is gone.
    router.release("shared");
    router.release("shared");
    expect(router.getLoadedModels()).toEqual([]);

    await expect(router.route("engineer", model("other", 128), ["reason"])).resolves.toMatchObject({
      id: "other"
    });
  });
});
