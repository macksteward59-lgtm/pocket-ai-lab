import { createHash } from "node:crypto";

const MAX_SOURCE_BYTES = 1_000_000;
const MAX_OBSERVATIONS = 100;
const MAX_FILENAME = 200;
const ALLOWED_KINDS = new Set([
  "dynamic-exec",
  "process-spawn",
  "deserialization",
  "network-client"
]);

export interface StaticObservationInput {
  kind: string;
  line: number;
  excerpt: string;
  remediation: string;
}

export interface StaticAnalysisInput {
  filename: string;
  source: string;
  observations: readonly StaticObservationInput[];
  authorized: false;
  executes: false;
  truncated?: boolean;
}

export interface SourceEvidenceCandidate {
  id: string;
  kind: string;
  filename: string;
  line: number;
  excerpt: string;
  remediation: string;
  sourceSha256: string;
  evidenceRef: string;
  confidence: 0.2;
  status: "unverified";
  classification: "static-review-signal";
}

export interface SourceEvidenceReport {
  filename: string;
  sourceSha256: string;
  sourceBytes: number;
  completeness: "complete" | "partial";
  candidates: readonly Readonly<SourceEvidenceCandidate>[];
  authorized: false;
  sourceExecuted: false;
  vulnerabilityConfirmed: false;
  notes: readonly string[];
}

/**
 * Binds non-executing static-review observations to the exact supplied source
 * bytes. It does not interpret a pattern match as a vulnerability or as proof
 * that a call is reachable.
 */
export function ingestStaticAnalysis(input: StaticAnalysisInput): SourceEvidenceReport {
  if (!input || typeof input !== "object") throw new Error("Static analysis input is required");
  if (input.authorized !== false || input.executes !== false) {
    throw new Error("Source evidence ingestion requires unauthorized, non-executing analysis");
  }
  if (typeof input.filename !== "string" || input.filename.length < 1 ||
      input.filename.length > MAX_FILENAME || input.filename.startsWith("/") ||
      input.filename.includes("\\") || input.filename.split("/").some(part => part === ".." || part === "." || part === "")) {
    throw new Error("Filename must be a bounded relative path without traversal segments");
  }
  if (typeof input.source !== "string") throw new Error("Source must be text");
  const sourceBytes = Buffer.byteLength(input.source, "utf8");
  if (sourceBytes > MAX_SOURCE_BYTES) throw new Error("Source exceeds the 1 MB ingestion limit");
  if (!Array.isArray(input.observations) || input.observations.length > MAX_OBSERVATIONS) {
    throw new Error("Observation list exceeds the 100-item ingestion limit");
  }
  if (input.truncated !== undefined && typeof input.truncated !== "boolean") {
    throw new Error("Truncation flag must be boolean");
  }

  const lines = input.source.split(/\r?\n/);
  const sourceSha256 = createHash("sha256").update(input.source, "utf8").digest("hex");
  const seen = new Set<string>();
  const candidates: SourceEvidenceCandidate[] = [];

  for (const observation of input.observations) {
    if (!observation || typeof observation !== "object") throw new Error("Malformed static observation");
    if (!ALLOWED_KINDS.has(observation.kind)) throw new Error("Unsupported static observation kind");
    if (!Number.isSafeInteger(observation.line) || observation.line < 1 || observation.line > lines.length) {
      throw new Error("Observation line is outside the supplied source");
    }
    if (typeof observation.excerpt !== "string" || observation.excerpt.length < 1 || observation.excerpt.length > 180) {
      throw new Error("Observation excerpt must be a bounded non-empty string");
    }
    if (typeof observation.remediation !== "string" || observation.remediation.length < 1 || observation.remediation.length > 500) {
      throw new Error("Observation remediation must be a bounded non-empty string");
    }
    const sourceLine = lines[observation.line - 1].trim();
    if (!sourceLine.startsWith(observation.excerpt)) {
      throw new Error("Observation excerpt does not match its claimed source line");
    }
    const key = [observation.kind, observation.line, observation.excerpt].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    const evidenceRef = "source://sha256/" + sourceSha256 + "/" +
      encodeURIComponent(input.filename) + "#L" + observation.line;
    candidates.push(Object.freeze({
      id: "source-signal:" + sourceSha256.slice(0, 16) + ":" + observation.line + ":" + observation.kind,
      kind: observation.kind,
      filename: input.filename,
      line: observation.line,
      excerpt: observation.excerpt,
      remediation: observation.remediation,
      sourceSha256,
      evidenceRef,
      confidence: 0.2,
      status: "unverified",
      classification: "static-review-signal"
    }));
  }

  const partial = input.truncated === true;
  return Object.freeze({
    filename: input.filename,
    sourceSha256,
    sourceBytes,
    completeness: partial ? "partial" : "complete",
    candidates: Object.freeze(candidates),
    authorized: false,
    sourceExecuted: false,
    vulnerabilityConfirmed: false,
    notes: Object.freeze([
      "Static pattern matches are review signals, not confirmed vulnerabilities.",
      "This adapter binds observations to supplied source lines and a SHA-256 digest.",
      "No source code was executed and no target was contacted.",
      ...(partial ? ["The upstream analyzer reported truncated input; absence of observations is not evidence of absence."] : [])
    ])
  });
}
