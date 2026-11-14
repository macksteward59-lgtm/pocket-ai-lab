import { StaticAnalysisOrchestratorBridge } from "../orchestrator/StaticAnalysisOrchestratorBridge";
import { ingestStaticAnalysis, type SourceEvidenceReport } from "./SourceEvidenceAdapter";

export interface SourceResearchResult {
  evidence: SourceEvidenceReport;
  context: {
    imports: readonly string[];
    functions: readonly string[];
    classes: readonly string[];
  };
  authorized: false;
  sourceExecuted: false;
}

/**
 * Connects the existing non-executing sidecar to provenance-bound research
 * candidates. It intentionally stops before hypothesis promotion or testing.
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

    return Object.freeze({
      evidence,
      context: Object.freeze({
        imports: Object.freeze([...analysis.context.imports]),
        functions: Object.freeze([...analysis.context.functions]),
        classes: Object.freeze([...analysis.context.classes])
      }),
      authorized: false,
      sourceExecuted: false
    });
  }
}
