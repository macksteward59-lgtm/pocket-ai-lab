import { createHash } from "node:crypto";
import { StaticAnalysisOrchestratorBridge, type StaticDataFlowSignal } from "../orchestrator/StaticAnalysisOrchestratorBridge";
import { ingestStaticAnalysis, type SourceEvidenceReport } from "./SourceEvidenceAdapter";

export interface BoundSourceDataFlow extends StaticDataFlowSignal {
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
  dataFlows: {
    parserStatus: "parsed" | "syntax-error" | "unsupported" | "truncated" | "not-applicable";
    signals: readonly Readonly<BoundSourceDataFlow>[];
    limitations: readonly string[];
  };
  authorized: false;
  sourceExecuted: false;
}

/**
 * Connects loopback static analysis to provenance-bound research candidates.
 * AST paths are re-bound to exact submitted source lines before being exposed.
 */
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
    const sourceLines = input.source.split(/\r?\n/);
    const boundFlows = analysis.dataFlows.signals.map(signal => {
      if (!Number.isSafeInteger(signal.sourceLine) || signal.sourceLine < 1 ||
          signal.sourceLine > sourceLines.length || !Number.isSafeInteger(signal.sinkLine) ||
          signal.sinkLine < 1 || signal.sinkLine > sourceLines.length ||
          sourceLines[signal.sourceLine - 1].trim().slice(0, 240) !== signal.sourceExcerpt ||
          sourceLines[signal.sinkLine - 1].trim().slice(0, 240) !== signal.sinkExcerpt) {
        throw new Error("AST data-flow provenance does not exactly match submitted source lines");
      }
      const evidenceRef = "source://sha256/" + evidence.sourceSha256 + "/" +
        encodeURIComponent(input.filename) + "#L" + signal.sourceLine + "-L" + signal.sinkLine;
      return Object.freeze({
        ...signal,
        filename: input.filename,
        sourceSha256: evidence.sourceSha256,
        evidenceRef,
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
