import path from "node:path";
import { MemoryManager } from "../../packages/intelligence/memory/MemoryManager";
import { FileMemoryStore } from "../../packages/intelligence/memory/FileMemoryStore";

const memoryManagerPromises = new Map<string, Promise<MemoryManager>>();

/** One shared manager per durable directory for all web routes and Director tasks. */
export async function openMemoryManager(env: NodeJS.ProcessEnv = process.env): Promise<MemoryManager> {
  const directory = path.resolve(env.POCKET_MEMORY_DIR || path.join(
    env.HOME || env.USERPROFILE || ".",
    ".pocket-ai-lab"
  ));
  if (!memoryManagerPromises.has(directory)) {
    const pending = (async () => {
      const store = await FileMemoryStore.open(directory);
      const manager = new MemoryManager(store);
      await manager.init();
      return manager;
    })();
    memoryManagerPromises.set(directory, pending);
  }
  try {
    return await memoryManagerPromises.get(directory)!;
  } catch (error) {
    memoryManagerPromises.delete(directory);
    throw error;
  }
}
