import path from "node:path";
import { homedir } from "node:os";
import { FileMemoryStore } from "../../packages/intelligence/memory/FileMemoryStore";
import { MemoryManager } from "../../packages/intelligence/memory/MemoryManager";
import { DirectorCapabilities } from "../../packages/intelligence/director/DirectorCapabilities";
import { createDirectorTaskRuntime } from "../../packages/intelligence/director/createDirectorTaskRuntime";
import { ToolDirector } from "../../packages/intelligence/tooling/ToolDirector";
import { ToolRegistry } from "../../packages/intelligence/security/tools";
import { LlamaCppDirectorCommandProvider } from "../../runtime/adapters/llama-cpp/DirectorCommandProvider";
import { TavilyResearchProvider } from "../../runtime/adapters/research/TavilyResearchProvider";
import { LocalProjectInspector } from "../../runtime/adapters/director/LocalProjectInspector";

const memoryManagers = new Map<string, Promise<MemoryManager>>();

async function openPersistentMemory(directory: string): Promise<MemoryManager> {
  const resolved = path.resolve(directory);
  if (!memoryManagers.has(resolved)) {
    const pending = (async () => {
      const store = await FileMemoryStore.open(resolved);
      const manager = new MemoryManager(store);
      await manager.init();
      return manager;
    })();
    memoryManagers.set(resolved, pending);
  }
  try {
    return await memoryManagers.get(resolved)!;
  } catch (error) {
    memoryManagers.delete(resolved);
    throw error;
  }
}

export interface LocalDirectorRuntimeConfig {
  api: string;
  baseUrl: string;
  modelAlias?: string;
  timeoutMs?: number;
}

/**
 * Compose the web app's local Director runtime from concrete, read-only host
 * adapters. Missing approval, device, tool-builder, and sandbox services are
 * intentionally not fabricated; those command paths fail closed.
 */
export async function createLocalDirectorTaskRuntime(
  config: LocalDirectorRuntimeConfig,
  options: { env?: NodeJS.ProcessEnv; workspaceRoot?: string } = {}
) {
  const env = options.env ?? process.env;
  if (config.api !== "openai-chat") {
    throw new Error("Director tasks require LLAMACPP_API=openai-chat and a llama-server --jinja model");
  }
  if (typeof config.modelAlias !== "string" || !config.modelAlias.trim()) {
    throw new Error("Director tasks require LLAMACPP_MODEL_ALIAS matching the loaded llama-server model id");
  }
  const memoryDirectory = env.POCKET_MEMORY_DIR || path.join(homedir(), ".pocket-ai-lab");
  const [memory, projectInspector] = await Promise.all([
    openPersistentMemory(memoryDirectory),
    LocalProjectInspector.open(options.workspaceRoot ?? process.cwd())
  ]);
  const research = env.TAVILY_API_KEY
    ? new TavilyResearchProvider({ apiKey: env.TAVILY_API_KEY })
    : undefined;
  const capabilities = new DirectorCapabilities({
    memory,
    projectInspector,
    ...(research ? { research } : {})
  });
  // No builder, sandbox, artifact store, or approval verifier is supplied.
  // Tool creation/testing and consequential actions therefore remain blocked.
  const toolDirector = new ToolDirector({ registry: new ToolRegistry() });
  const provider = new LlamaCppDirectorCommandProvider({
    api: "openai-chat",
    baseUrl: config.baseUrl,
    modelAlias: config.modelAlias,
    timeoutMs: config.timeoutMs ?? 120_000
  });
  return createDirectorTaskRuntime({
    capabilities,
    toolDirector,
    provider,
    maxSteps: 8
  });
}
