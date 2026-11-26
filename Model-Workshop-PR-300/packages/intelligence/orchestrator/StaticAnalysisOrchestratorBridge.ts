/**
 * Forward source text to the loopback-only, non-executing static-analysis sidecar.
 * Sidecar output is untrusted and is shape-checked before it enters research.
 */
import { PolicyCheckError, assertLoopback } from "../security/PolicyChecker";

export interface StaticDataFlowSignal {
  analysisScope: "intraprocedural" | "interprocedural";
  kind: string;
  sourceLine: number;
  sinkLine: number;
  sourceExpression: string;
  sinkExpression: string;
  sinkName: string;
  variables: string[];
  sourceExcerpt: string;
  sinkExcerpt: string;
}

export interface StaticDataFlowReport {
  parserStatus: "parsed" | "syntax-error" | "unsupported" | "truncated" | "not-applicable";
  signals: StaticDataFlowSignal[];
  limitations: string[];
}

export interface StaticAuthorizationRoute {
  path: string | null;
  methods: string[];
  function: string;
  line: number;
  guardStatus: "local-guard-observed" | "no-local-guard-observed" | "indeterminate";
  guardSignals: string[];
  excerpt: string;
}

export interface StaticAuthorizationSurface {
  parserStatus: "parsed" | "syntax-error" | "unsupported" | "truncated" | "not-applicable";
  routes: StaticAuthorizationRoute[];
  limitations: string[];
}

export interface StaticAnalysisReport {
  filename: string;
  observations: Array<{ kind: string; line: number; excerpt: string; remediation: string }>;
  context: { imports: string[]; functions: string[]; classes: string[] };
  dataFlows: StaticDataFlowReport;
  authorizationSurface: StaticAuthorizationSurface;
  truncated: boolean;
  authorized: false;
  executes: false;
}

const DATA_FLOW_KINDS = new Set([
  "dynamic-exec", "process-spawn", "deserialization", "sql-query", "network-client"
]);
const PARSER_STATUSES = new Set(["parsed", "syntax-error", "unsupported", "truncated"]);
const OBSERVATION_KINDS = new Set(["dynamic-exec", "process-spawn", "deserialization", "network-client"]);

export class StaticAnalysisOrchestratorBridge {
  constructor(private readonly opts: { baseUrl: string; fetchImpl?: typeof fetch }) {}

  async analyzeSource(input: { filename: string; source: string }): Promise<StaticAnalysisReport> {
    const url = assertLoopback(this.opts.baseUrl);
    url.pathname = "/api/v1/governance/analyze-source";
    url.search = "";
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: input.filename, source: input.source })
    });
    if (!response.ok) throw new PolicyCheckError("Static analysis sidecar returned " + response.status);
    const body = await response.json() as Record<string, unknown>;
    if (body.authorized !== false || body.executes !== false) {
      throw new PolicyCheckError("Static analysis must stay non-executing and unauthorized");
    }
    if (body.filename !== undefined && body.filename !== input.filename) {
      throw new PolicyCheckError("Static analysis filename does not match the submitted source");
    }
    if (typeof body.truncated !== "boolean") {
      throw new PolicyCheckError("Static analysis must report whether the input was truncated");
    }
    const context = isRecord(body.context) ? body.context : {};
    const dataFlows = parseDataFlows(body.data_flows);
    const authorizationSurface = parseAuthorizationSurface(body.authorization_surface);
    return {
      filename: input.filename,
      observations: parseObservations(body.observations),
      context: {
        imports: stringList(context.imports),
        functions: stringList(context.functions),
        classes: stringList(context.classes)
      },
      dataFlows,
      authorizationSurface,
      truncated: body.truncated || dataFlows.parserStatus === "truncated" || authorizationSurface.parserStatus === "truncated",
      authorized: false,
      executes: false
    };
  }
}

function parseObservations(value: unknown): StaticAnalysisReport["observations"] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new PolicyCheckError("Static analysis observation list is malformed or exceeds its limit");
  }
  return value.map(item => {
    if (!isRecord(item) || typeof item.kind !== "string" || !OBSERVATION_KINDS.has(item.kind) ||
        !Number.isSafeInteger(item.line) || (item.line as number) < 1 ||
        typeof item.excerpt !== "string" || item.excerpt.length < 1 || item.excerpt.length > 180 ||
        typeof item.remediation !== "string" || item.remediation.length < 1 || item.remediation.length > 500) {
      throw new PolicyCheckError("Static analysis observation is malformed");
    }
    return {
      kind: item.kind,
      line: item.line as number,
      excerpt: item.excerpt,
      remediation: item.remediation
    };
  });
}

function parseDataFlows(value: unknown): StaticDataFlowReport {
  if (value === undefined || value === null) {
    return { parserStatus: "not-applicable", signals: [], limitations: ["The sidecar did not provide AST data-flow results."] };
  }
  if (!isRecord(value) || typeof value.parser_status !== "string" ||
      !PARSER_STATUSES.has(value.parser_status) || value.authorized !== false || value.executes !== false ||
      !Array.isArray(value.signals) || value.signals.length > 100 ||
      !Array.isArray(value.limitations) || value.limitations.length > 20) {
    throw new PolicyCheckError("Static AST data-flow report failed schema or trust-boundary validation");
  }
  const signals = value.signals.map(item => {
    if (!isRecord(item) || typeof item.kind !== "string" || !DATA_FLOW_KINDS.has(item.kind) ||
        (item.analysis_scope !== undefined && item.analysis_scope !== "intraprocedural" && item.analysis_scope !== "interprocedural") ||
        !Number.isSafeInteger(item.source_line) || (item.source_line as number) < 1 ||
        !Number.isSafeInteger(item.sink_line) || (item.sink_line as number) < 1 ||
        typeof item.source_expression !== "string" || item.source_expression.length > 240 ||
        typeof item.sink_expression !== "string" || item.sink_expression.length > 240 ||
        typeof item.sink_name !== "string" || item.sink_name.length > 128 ||
        !Array.isArray(item.variables) || item.variables.length > 100 ||
        !item.variables.every(x => typeof x === "string" && x.length <= 128) ||
        typeof item.source_excerpt !== "string" || item.source_excerpt.length > 240 ||
        typeof item.sink_excerpt !== "string" || item.sink_excerpt.length > 240) {
      throw new PolicyCheckError("Static AST data-flow signal is malformed");
    }
    return {
      analysisScope: (item.analysis_scope === "interprocedural" ? "interprocedural" : "intraprocedural") as StaticDataFlowSignal["analysisScope"],
      kind: item.kind,
      sourceLine: item.source_line as number,
      sinkLine: item.sink_line as number,
      sourceExpression: item.source_expression,
      sinkExpression: item.sink_expression,
      sinkName: item.sink_name,
      variables: item.variables as string[],
      sourceExcerpt: item.source_excerpt,
      sinkExcerpt: item.sink_excerpt
    };
  });
  if (!value.limitations.every(x => typeof x === "string" && x.length <= 500)) {
    throw new PolicyCheckError("Static AST data-flow limitations are malformed");
  }
  return {
    parserStatus: value.parser_status as StaticDataFlowReport["parserStatus"],
    signals,
    limitations: value.limitations as string[]
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAuthorizationSurface(value: unknown): StaticAuthorizationSurface {
  if (value === undefined || value === null) {
    return { parserStatus: "not-applicable", routes: [], limitations: ["The sidecar did not provide an authorization route inventory."] };
  }
  if (!isRecord(value) || typeof value.parser_status !== "string" ||
      !PARSER_STATUSES.has(value.parser_status) || value.authorized !== false || value.executes !== false ||
      !Array.isArray(value.routes) || value.routes.length > 200 ||
      !Array.isArray(value.limitations) || value.limitations.length > 20) {
    throw new PolicyCheckError("Authorization surface report failed schema or trust-boundary validation");
  }
  const routes = value.routes.map(item => {
    const statuses = ["local-guard-observed", "no-local-guard-observed", "indeterminate"];
    if (!isRecord(item) || (item.path !== null && (typeof item.path !== "string" || item.path.length > 500)) ||
        !Array.isArray(item.methods) || item.methods.length > 8 ||
        !item.methods.every(x => typeof x === "string" && x.length <= 16) ||
        typeof item.function !== "string" || item.function.length > 128 ||
        !Number.isSafeInteger(item.line) || (item.line as number) < 1 ||
        typeof item.guard_status !== "string" || !statuses.includes(item.guard_status) ||
        !Array.isArray(item.guard_signals) || item.guard_signals.length > 20 ||
        !item.guard_signals.every(x => typeof x === "string" && x.length <= 128) ||
        typeof item.excerpt !== "string" || item.excerpt.length > 240) {
      throw new PolicyCheckError("Authorization route record is malformed");
    }
    return {
      path: item.path as string | null,
      methods: item.methods as string[],
      function: item.function,
      line: item.line as number,
      guardStatus: item.guard_status as StaticAuthorizationRoute["guardStatus"],
      guardSignals: item.guard_signals as string[],
      excerpt: item.excerpt
    };
  });
  if (!value.limitations.every(x => typeof x === "string" && x.length <= 500)) {
    throw new PolicyCheckError("Authorization surface limitations are malformed");
  }
  return {
    parserStatus: value.parser_status as StaticAuthorizationSurface["parserStatus"],
    routes,
    limitations: value.limitations as string[]
  };
}
