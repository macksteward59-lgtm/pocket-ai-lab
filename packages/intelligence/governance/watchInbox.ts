/**
 * Read scanner exports from a local directory and post them to the sidecar.
 * Files are not fetched from the internet. Target URIs inside an export are not requested.
 */
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { PolicyCheckError, assertLoopback } from "../security/PolicyChecker";
import { SourceFormat } from "../security/reviewTypes";

export function classifyExport(filename: string): SourceFormat | null {
  const lower = filename.toLowerCase();
  if (lower.includes("nessus") || lower.endsWith(".csv")) {
    if (lower.includes("burp")) return "burp";
    return lower.includes("zap") ? "zap" : "nessus";
  }
  if (lower.includes("zap") && lower.endsWith(".json")) return "zap";
  if (lower.endsWith(".json")) return "zap";
  if (lower.endsWith(".xml")) return "burp";
  return null;
}

export async function watchOnce(input: {
  inbox: string;
  outbox: string;
  sidecarUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<{ submitted: string[]; skipped: string[] }> {
  assertLoopback(input.sidecarUrl);
  await mkdir(input.inbox, { recursive: true });
  await mkdir(input.outbox, { recursive: true });
  const processed = path.join(input.inbox, "processed");
  await mkdir(processed, { recursive: true });
  const names = await readdir(input.inbox, { withFileTypes: true });
  const submitted: string[] = [];
  const skipped: string[] = [];
  for (const entry of names) {
    if (!entry.isFile()) continue;
    const format = classifyExport(entry.name);
    if (!format) {
      skipped.push(entry.name);
      continue;
    }
    const source = path.join(input.inbox, entry.name);
    const content = await readFile(source, "utf8");
    const reviewUrl = new URL("/api/v1/governance/review", input.sidecarUrl);
    const fetchImpl = input.fetchImpl ?? fetch;
    const response = await fetchImpl(reviewUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_format: format, content })
    });
    if (!response.ok) throw new PolicyCheckError("Review sidecar returned " + response.status);
    const body = await response.json() as Record<string, unknown>;
    if (body.authorized !== false) throw new PolicyCheckError("Review response must keep authorized false");
    await writeFile(path.join(input.outbox, entry.name + ".review.json"), JSON.stringify(body, null, 2), "utf8");
    await rename(source, path.join(processed, entry.name));
    submitted.push(entry.name);
  }
  return { submitted, skipped };
}
