export { SecurityWorldModel } from "./SecurityWorldModel";
export { checkTenantIsolation } from "./FiniteStateSecurityChecker";
export { generateHypotheses } from "./HypothesisEngine";
export { planExperiments } from "./ExperimentPlanner";
export { runResearchPoc } from "./ResearchPoc";
export type {
  SecurityAction,
  GuardState,
  WorldComponent,
  WorldIdentity,
  WorldResource,
  WorldOperation,
  WorldInvariant,
  WorldFact,
  SecurityWorldModelInput,
  Counterexample,
  ModelCheckResult,
  ResearchHypothesis,
  ExperimentProposal,
  ResearchPocReport
} from "./types";

export { ingestStaticAnalysis } from "./SourceEvidenceAdapter";
export type { StaticObservationInput, StaticAnalysisInput, SourceEvidenceCandidate, SourceEvidenceReport } from "./SourceEvidenceAdapter";

export { SourceResearchPipeline, type SourceResearchResult } from "./SourceResearchPipeline";

export { runResearchBenchmark, type ResearchBenchmarkCase, type ResearchBenchmarkReport } from "./ResearchBenchmark";

export { bindMultiFileEvidence } from "./MultiFileSourceEvidence";
export type { MultiFileSource, ResolvedImportEdge, UnresolvedImport, CrossFileFlowObservation, MultiFileEvidenceInput, BoundCrossFileCandidate, MultiFileEvidenceReport } from "./MultiFileSourceEvidence";
