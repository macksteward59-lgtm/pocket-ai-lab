/**
 * Host composition helper for bounded Director tasks.
 *
 * The intelligence package receives already-constructed capability ports,
 * tool lifecycle service, and model provider. It does not construct network,
 * filesystem, device, approval, or model-runtime adapters itself.
 */
import { DirectorCapabilities } from "./DirectorCapabilities";
import { DirectorCommandRouter } from "./DirectorCommandRouter";
import { DirectorTaskRunner, type DirectorTaskProvider, type DirectorTaskResult } from "./DirectorTaskRunner";
import type { ToolDirector } from "../tooling/ToolDirector";

export interface DirectorTaskRuntimeOptions {
  capabilities: DirectorCapabilities;
  toolDirector: ToolDirector;
  provider: DirectorTaskProvider;
  maxSteps?: number;
}

export interface DirectorTaskRuntime {
  runTask(context: { taskId: string }, objective: string): Promise<DirectorTaskResult>;
}

/**
 * Compose one bounded task runtime at the host's composition root.
 *
 * Capability implementations and their approval verifiers remain host-owned.
 * The model provider returns proposals only; every step is validated and
 * dispatched by DirectorTaskRunner -> DirectorCommandRouter -> capability
 * ports. No approval is inferred from model output.
 */
export function createDirectorTaskRuntime(options: DirectorTaskRuntimeOptions): DirectorTaskRuntime {
  if (!options || !(options.capabilities instanceof DirectorCapabilities)) {
    throw new Error("A configured DirectorCapabilities instance is required");
  }
  if (!options.toolDirector || typeof options.toolDirector.develop !== "function" ||
      typeof options.toolDirector.activate !== "function" || typeof options.toolDirector.retire !== "function") {
    throw new Error("A configured ToolDirector instance is required");
  }
  if (!options.provider || typeof options.provider.propose !== "function") {
    throw new Error("A Director task provider is required");
  }

  const router = new DirectorCommandRouter(options.capabilities, options.toolDirector);
  const runner = new DirectorTaskRunner(router, { maxSteps: options.maxSteps });
  const provider = options.provider;

  return Object.freeze({
    runTask: (context: { taskId: string }, objective: string) =>
      runner.run(provider, context, objective)
  });
}
