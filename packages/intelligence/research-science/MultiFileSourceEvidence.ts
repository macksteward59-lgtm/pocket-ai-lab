import { createHash } from "node:crypto";

const MAX_FILES = 200;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 10_000_000;
const MAX_EDGES = 2_000;
const MAX_CANDIDATES = 100;
const MAX_PATH = 240;

export interface MultiFileSource {
  path: string;
  source: string;
}

export interface ResolvedImportEdge {
  from: string;
  to: string;
  symbol?: string;
}

export interface UnresolvedImport {
  from: string;
  module: string;
  reason: "external" | "dynamic" | "not-found" | "ambiguous" | "unsupported";
}

export interface CrossFileFlowObservation {
  kind: string;
  sourceFile: string;
  sourceLine: number;
  sourceExcerpt: string;
  sinkFile: string;
  sinkLine: number;
  sinkExcerpt: string;
  remediation: string;
}

export interface MultiFileEvidenceInput {
  files: readonly MultiFileSource[];
  resolvedImports: readonly ResolvedImportEdge[];
  unresolvedImports?: readonly UnresolvedImport[];
  observations: readonly CrossFileFlowObservation[];
}

export interface BoundCrossFileCandidate extends CrossFileFlowObservation {
  sourceSha256: string;
  sinkSha256: string;
  evidenceRef: string;
  status: "unverified";
  classification: "cross-file-static-review-signal";
}

export interface MultiFileEvidenceReport {
  files: readonly Readonly<{ path: string; sourceSha256: string; sourceBytes: number }>[];
  resolvedImports: readonly Readonly<ResolvedImportEdge>[];
  unresolvedImports: readonly Readonly<UnresolvedImport>[];
  candidates: readonly Readonly<BoundCrossFileCandidate>[];
  completeness: "complete" | "partial";
  totalSourceBytes: number;
  authorized: false;
  sourceExecuted: false;
  vulnerabilityConfirmed: false;
  notes: readonly string[];
}

const ALLOWED_KINDS = new Set([
  "dynamic-exec", "process-spawn", "deserialization", "sql-query", "network-client"
]);

function validateRelativePath(path: unknown): asserts path is string {
  if (typeof path !== "string" || path.length < 1 || path.length > MAX_PATH ||
      path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\\") ||
      /[\x00-\x1f\x7f]/.test(path) ||
      path.split("/").some(part => part === "" || part === "." || part === "..")) {
    throw new Error("Source path must be a bounded relative path without traversal segments");
  }
}

function lineMatches(source: string, line: number, excerpt: string): boolean {
  const lines = source.split(/\r\n|\n|\r/);
  return Number.isSafeInteger(line) && line >= 1 && line <= lines.length &&
    typeof excerpt === "string" && excerpt.length > 0 && excerpt.length <= 240 &&
    lines[line - 1].trim().slice(0, 240) === excerpt;
}

function hasDirectedPath(adjacency: Map<string, string[]>, from: string, to: string): boolean {
  if (from === to) return true;
  const seen = new Set<string>([from]);
  const queue = [from];
  for (let cursor = 0; cursor < queue.length && cursor < MAX_FILES; cursor += 1) {
    for (const next of adjacency.get(queue[cursor]) ?? []) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/**
 * Independently binds proposed cross-file observations to exact source files,
 * per-file SHA-256 digests, source excerpts, and a caller-supplied resolved
 * import graph. It does not resolve imports or perform data-flow analysis.
 */
export function bindMultiFileEvidence(input: MultiFileEvidenceInput): MultiFileEvidenceReport {
  if (!input || typeof input !== "object" || !Array.isArray(input.files) ||
      input.files.length < 1 || input.files.length > MAX_FILES) {
    throw new Error("Multi-file evidence requires between 1 and 200 source files");
  }
  if (!Array.isArray(input.resolvedImports) || input.resolvedImports.length > MAX_EDGES ||
      !Array.isArray(input.observations) || input.observations.length > MAX_CANDIDATES) {
    throw new Error("Multi-file evidence exceeds graph or observation limits");
  }
  const unresolved = input.unresolvedImports ?? [];
  if (!Array.isArray(unresolved) || unresolved.length > MAX_EDGES) {
    throw new Error("Unresolved import list exceeds its limit");
  }

  const byPath = new Map<string, { source: string; digest: string; bytes: number }>();
  const files: Array<{ path: string; sourceSha256: string; sourceBytes: number }> = [];
  let totalSourceBytes = 0;
  for (const file of input.files) {
    if (!file || typeof file !== "object") throw new Error("Malformed source file");
    validateRelativePath(file.path);
    if (byPath.has(file.path)) throw new Error("Duplicate source path: " + file.path);
    if (typeof file.source !== "string") throw new Error("Source content must be text");
    const bytes = Buffer.byteLength(file.source, "utf8");
    if (bytes > MAX_FILE_BYTES) throw new Error("A source file exceeds the 1 MB limit");
    totalSourceBytes += bytes;
    if (totalSourceBytes > MAX_TOTAL_BYTES) throw new Error("Aggregate source exceeds the 10 MB limit");
    const digest = createHash("sha256").update(file.source, "utf8").digest("hex");
    byPath.set(file.path, { source: file.source, digest, bytes });
    files.push(Object.freeze({ path: file.path, sourceSha256: digest, sourceBytes: bytes }));
  }

  const adjacency = new Map<string, string[]>();
  const edgeKeys = new Set<string>();
  const edges: ResolvedImportEdge[] = [];
  for (const edge of input.resolvedImports) {
    if (!edge || typeof edge !== "object") throw new Error("Malformed resolved import edge");
    validateRelativePath(edge.from);
    validateRelativePath(edge.to);
    if (!byPath.has(edge.from) || !byPath.has(edge.to)) {
      throw new Error("Resolved import edge references a file outside the submitted manifest");
    }
    if (edge.symbol !== undefined && (typeof edge.symbol !== "string" || edge.symbol.length > 128)) {
      throw new Error("Import symbol is malformed");
    }
    const key = edge.from + "\u0000" + edge.to + "\u0000" + (edge.symbol ?? "");
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
    edges.push(Object.freeze({ ...edge }));
  }

  const frozenUnresolved = unresolved.map(item => {
    if (!item || typeof item !== "object") throw new Error("Malformed unresolved import");
    validateRelativePath(item.from);
    if (!byPath.has(item.from) || typeof item.module !== "string" || item.module.length < 1 ||
        item.module.length > 240 ||
        !["external", "dynamic", "not-found", "ambiguous", "unsupported"].includes(item.reason)) {
      throw new Error("Unresolved import is malformed or references an unknown source file");
    }
    return Object.freeze({ ...item });
  });

  const candidates: BoundCrossFileCandidate[] = [];
  const seen = new Set<string>();
  for (const observation of input.observations) {
    if (!observation || typeof observation !== "object" || !ALLOWED_KINDS.has(observation.kind) ||
        typeof observation.remediation !== "string" || observation.remediation.length < 1 ||
        observation.remediation.length > 500) {
      throw new Error("Cross-file observation is malformed");
    }
    const sourceFile = byPath.get(observation.sourceFile);
    const sinkFile = byPath.get(observation.sinkFile);
    if (!sourceFile || !sinkFile) throw new Error("Cross-file observation references an unknown file");
    if (!lineMatches(sourceFile.source, observation.sourceLine, observation.sourceExcerpt) ||
        !lineMatches(sinkFile.source, observation.sinkLine, observation.sinkExcerpt)) {
      throw new Error("Cross-file observation excerpt does not match exact source provenance");
    }
    if (!hasDirectedPath(adjacency, observation.sourceFile, observation.sinkFile)) {
      throw new Error("Cross-file observation has no resolved import path between source and sink files");
    }
    const key = [observation.kind, observation.sourceFile, observation.sourceLine,
      observation.sinkFile, observation.sinkLine].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    const evidenceRef = "source://sha256/" + sourceFile.digest + "/" +
      encodeURIComponent(observation.sourceFile) + "#L" + observation.sourceLine +
      "->sha256/" + sinkFile.digest + "/" + encodeURIComponent(observation.sinkFile) +
      "#L" + observation.sinkLine;
    candidates.push(Object.freeze({
      ...observation,
      sourceSha256: sourceFile.digest,
      sinkSha256: sinkFile.digest,
      evidenceRef,
      status: "unverified",
      classification: "cross-file-static-review-signal"
    }));
  }

  const partial = frozenUnresolved.length > 0;
  return Object.freeze({
    files: Object.freeze(files),
    resolvedImports: Object.freeze(edges),
    unresolvedImports: Object.freeze(frozenUnresolved),
    candidates: Object.freeze(candidates),
    completeness: partial ? "partial" : "complete",
    totalSourceBytes,
    authorized: false,
    sourceExecuted: false,
    vulnerabilityConfirmed: false,
    notes: Object.freeze([
      "This module binds externally proposed observations; it does not resolve imports or compute cross-file data flow.",
      "Every endpoint is rebound to its own exact file digest and source excerpt.",
      "Resolved import edges are evidence supplied by the caller, not proof of runtime reachability or call semantics.",
      "All candidates remain unverified; no source was executed and no target was contacted.",
      ...(partial ? ["Unresolved imports make the manifest partial; missing signals are not evidence of absence."] : [])
    ])
  });
}
