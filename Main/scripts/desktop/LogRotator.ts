/**
 * Keep a local log from growing without bound. Nothing is uploaded.
 */
import { rename, rm, stat } from "node:fs/promises";

export async function rotateIfNeeded(filePath: string, maxBytes: number, keep = 3): Promise<void> {
  if (!Number.isFinite(maxBytes) || maxBytes < 1) throw new Error("maxBytes must be positive");
  if (!Number.isInteger(keep) || keep < 1 || keep > 10) throw new Error("keep must be from 1 to 10");
  let size = 0;
  try {
    size = (await stat(filePath)).size;
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  if (size < maxBytes) return;
  await rm(filePath + "." + keep, { force: true });
  for (let index = keep - 1; index >= 1; index -= 1) {
    await rename(filePath + "." + index, filePath + "." + (index + 1)).catch(error => {
      if (!isNotFound(error)) throw error;
    });
  }
  await rename(filePath, filePath + ".1");
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
