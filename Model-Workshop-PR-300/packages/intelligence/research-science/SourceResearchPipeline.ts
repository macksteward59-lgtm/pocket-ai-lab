import { StaticAnalysisOrchestratorBridge, type StaticDataFlowSignal } from "../orchestrator/StaticAnalysisOrchestratorBridge";
import { ingestStaticAnalysis, type SourceEvidenceReport } from "./SourceEvidenceAdapter";

export interface BoundSourceDataFlow extends StaticDataFlowSignal {
  filename: string;
  sourceSha256: string;
  evidenceRef: string;
  status: "unverified";
}

export interface BoundAuthorizationRoute {
  path: string | null;
  methods: readonly string[];
  function: string;
  line: number;
  guardStatus: "local-guard-observed" | "no-local-guard-observed" | "indeterminate";
  guardSignals: readonly string[];
  excerpt: string;
  filename: string;
  sourceSha256: string;
  evidenceRef: string;
  status: "unverified";
}

export interface SourceResearchResult {
  evidence: SourceEvidenceReport;
  context: {
    imports: readonly string[];
    functions: readonly string[];
    classes: readonly string[];
  };
  authorizationSurface: {
    parserStatus: "parsed" | "syntax-error" | "unsupported" | "truncated" | "not-applicable";
    routes: readonly Readonly<BoundAuthorizationRoute>[];
    limitations: readonly string[];
  };
  dataFlows: {
    parserStatus: "parsed" | "syntax-error" | "unsupported" | "truncated" | "not-applicable";
    signals: readonly Readonly<BoundSourceDataFlow>[];
    limitations: readonly string[];
  };
  authorized: false;
  sourceExecuted: false;
}

/** Loopback static analysis; all source claims are rebound to exact submitted lines. */
export class SourceResearchPipeline {
  constructor(private readonly bridge: StaticAnalysisOrchestratorBridge) {}

  async analyze(input: { filename: string; source: string }): Promise<SourceResearchResult> {
    const analysis = await this.bridge.analyzeSource(input);
    if (analysis.filename !== input.filename) {
      throw new Error("Static analysis filename does not match the submitted source");
    }
    const evidence = ingestStaticAnalysis({
      filename: input.filename,
      source: input.source,
      observations: analysis.observations,
      authorized: analysis.authorized,
      executes: analysis.executes,
      truncated: analysis.truncated
    });
    const sourceLines = input.source.split(/\r\n|\n|\r/);
    const boundRoutes = analysis.authorizationSurface.routes.map(route => {
      if (!Number.isSafeInteger(route.line) || route.line < 1 || route.line > sourceLines.length ||
          sourceLines[route.line - 1].trim().slice(0, 240) !== route.excerpt) {
        throw new Error("Authorization route provenance does not exactly match submitted source lines");
      }
      return Object.freeze({
        ...route,
        filename: input.filename,
        sourceSha256: evidence.sourceSha256,
        evidenceRef: "source://sha256/" + evidence.sourceSha256 + "/" +
          encodeURIComponent(input.filename) + "#L" + route.line,
        status: "unverified" as const
      });
    });
    const boundFlows = analysis.dataFlows.signals.map(signal => {
      if (!Number.isSafeInteger(signal.sourceLine) || signal.sourceLine < 1 ||
          signal.sourceLine > sourceLines.length || !Number.isSafeInteger(signal.sinkLine) ||
          signal.sinkLine < 1 || signal.sinkLine > sourceLines.length ||
          sourceLines[signal.sourceLine - 1].trim().slice(0, 240) !== signal.sourceExcerpt ||
          sourceLines[signal.sinkLine - 1].trim().slice(0, 240) !== signal.sinkExcerpt) {
        throw new Error("AST data-flow provenance does not exactly match submitted source lines");
      }
      return Object.freeze({
        ...signal,
        filename: input.filename,
        sourceSha256: evidence.sourceSha256,
        evidenceRef: "source://sha256/" + evidence.sourceSha256 + "/" +
          encodeURIComponent(input.filename) + "#L" + signal.sourceLine + "-L" + signal.sinkLine,
        status: "unverified" as const
      });
    });
    return Object.freeze({
      evidence,
      context: Object.freeze({
        imports: Object.freeze([...analysis.context.imports]),
        functions: Object.freeze([...analysis.context.functions]),
        classes: Object.freeze([...analysis.context.classes])
      }),
      authorizationSurface: Object.freeze({
        parserStatus: analysis.authorizationSurface.parserStatus,
        routes: Object.freeze(boundRoutes),
        limitations: Object.freeze([...analysis.authorizationSurface.limitations])
      }),
      dataFlows: Object.freeze({
        parserStatus: analysis.dataFlows.parserStatus,
        signals: Object.freeze(boundFlows),
        limitations: Object.freeze([...analysis.dataFlows.limitations])
      }),
      authorized: false,
      sourceExecuted: false
    });
  }
}
