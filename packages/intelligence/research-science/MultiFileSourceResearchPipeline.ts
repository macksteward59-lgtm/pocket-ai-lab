/**
 * End-to-end loopback bridge for bounded multi-file Python source research.
 * Sidecar output is untrusted: shape validation is followed by independent
 * per-file digest and excerpt binding before candidates enter research.
 */
import { PolicyCheckError, assertLoopback } from "../security/PolicyChecker";
import {
  bindMultiFileEvidence,
  type MultiFileSource,
  type MultiFileEvidenceReport,
  type ResolvedImportEdge,
  type UnresolvedImport
} from "./MultiFileSourceEvidence";

export interface MultiFileSourceResearchResult {
  analysisStatus: "parsed" | "partial" | "syntax-error" | "unsupported" | "truncated";
  filesAnalyzed: number;
  nodesVisited: number;
  evidence: MultiFileEvidenceReport;
  limitations: readonly string[];
  authorized: false;
  sourceExecuted: false;
}

const STATUSES = new Set(["parsed", "partial", "syntax-error", "unsupported", "truncated"]);
const KINDS = new Set(["dynamic-exec", "process-spawn", "deserialization", "sql-query", "network-client"]);
const IMPORT_REASONS = new Set(["external", "dynamic", "not-found", "ambiguous", "unsupported"]);

export class MultiFileSourceResearchPipeline {
  constructor(private readonly opts: { baseUrl: string; fetchImpl?: typeof fetch }) {}

  async analyze(files: readonly MultiFileSource[]): Promise<MultiFileSourceResearchResult> {
    if (!Array.isArray(files) || files.length < 1 || files.length > 50) {
      throw new PolicyCheckError("Project analysis requires between 1 and 50 files");
    }
    const url = assertLoopback(this.opts.baseUrl);
    url.pathname = "/api/v1/governance/analyze-project";
    url.search = "";
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files })
    });
    if (!response.ok) throw new PolicyCheckError("Project analysis sidecar returned " + response.status);
    const body = await response.json() as unknown;
    if (!isRecord(body) || body.authorized !== false || body.executes !== false) {
      throw new PolicyCheckError("Project analysis must remain unauthorized and non-executing");
    }
    if (typeof body.parser_status !== "string" || !STATUSES.has(body.parser_status)) {
      throw new PolicyCheckError("Project analysis parser status is malformed");
    }
    if (!Number.isSafeInteger(body.files_analyzed) || (body.files_analyzed as number) < 0 ||
        !Number.isSafeInteger(body.nodes_visited) || (body.nodes_visited as number) < 0) {
      throw new PolicyCheckError("Project analysis counters are malformed");
    }
    if (!Array.isArray(body.limitations) || body.limitations.length > 30 ||
        !body.limitations.every(item => typeof item === "string" && item.length <= 500)) {
      throw new PolicyCheckError("Project analysis limitations are malformed");
    }
    const resolvedImports = parseResolvedImports(body.resolved_imports);
    const unresolvedImports = parseUnresolvedImports(body.unresolved_imports);
    const observations = parseObservations(body.observations);
    const evidence = bindMultiFileEvidence({
      files,
      resolvedImports,
      unresolvedImports,
      observations,
      analysisPartial: body.parser_status !== "parsed"
    });
    return Object.freeze({
      analysisStatus: body.parser_status as MultiFileSourceResearchResult["analysisStatus"],
      filesAnalyzed: body.files_analyzed as number,
      nodesVisited: body.nodes_visited as number,
      evidence,
      limitations: Object.freeze([...body.limitations] as string[]),
      authorized: false,
      sourceExecuted: false
    });
  }
}

function parseResolvedImports(value: unknown): ResolvedImportEdge[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw new PolicyCheckError("Resolved import list is malformed or exceeds its limit");
  }
  return value.map(item => {
    if (!isRecord(item) || typeof item.from_file !== "string" || item.from_file.length > 240 ||
        typeof item.to_file !== "string" || item.to_file.length > 240 ||
        typeof item.module !== "string" || item.module.length < 1 || item.module.length > 240 ||
        (item.symbol !== undefined && (typeof item.symbol !== "string" || item.symbol.length > 128))) {
      throw new PolicyCheckError("Resolved import edge is malformed");
    }
    return {
      from: item.from_file,
      to: item.to_file,
      symbol: item.symbol as string | undefined
    };
  });
}

function parseUnresolvedImports(value: unknown): UnresolvedImport[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw new PolicyCheckError("Unresolved import list is malformed or exceeds its limit");
  }
  return value.map(item => {
    if (!isRecord(item) || typeof item.from_file !== "string" || item.from_file.length > 240 ||
        typeof item.module !== "string" || item.module.length < 1 || item.module.length > 240 ||
        typeof item.reason !== "string" || !IMPORT_REASONS.has(item.reason)) {
      throw new PolicyCheckError("Unresolved import is malformed");
    }
    return {
      from: item.from_file,
      module: item.module,
      reason: item.reason as UnresolvedImport["reason"]
    };
  });
}

function parseObservations(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new PolicyCheckError("Cross-file observation list is malformed or exceeds its limit");
  }
  return value.map(item => {
    if (!isRecord(item) || typeof item.kind !== "string" || !KINDS.has(item.kind) ||
        typeof item.source_file !== "string" || item.source_file.length > 240 ||
        typeof item.sink_file !== "string" || item.sink_file.length > 240 ||
        !Number.isSafeInteger(item.source_line) || (item.source_line as number) < 1 ||
        !Number.isSafeInteger(item.sink_line) || (item.sink_line as number) < 1 ||
        typeof item.source_excerpt !== "string" || item.source_excerpt.length < 1 || item.source_excerpt.length > 240 ||
        typeof item.sink_excerpt !== "string" || item.sink_excerpt.length < 1 || item.sink_excerpt.length > 240 ||
        typeof item.source_expression !== "string" || item.source_expression.length > 240 ||
        typeof item.sink_expression !== "string" || item.sink_expression.length > 240 ||
        typeof item.imported_symbol !== "string" || item.imported_symbol.length > 128) {
      throw new PolicyCheckError("Cross-file observation is malformed");
    }
    return {
      kind: item.kind,
      sourceFile: item.source_file,
      sourceLine: item.source_line as number,
      sourceExcerpt: item.source_excerpt,
      sinkFile: item.sink_file,
      sinkLine: item.sink_line as number,
      sinkExcerpt: item.sink_excerpt,
      remediation: "Review the cross-file source-to-sink path and independently validate reachability, authorization, and sanitization."
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
