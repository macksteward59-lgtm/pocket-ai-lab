/**
 * Scan-export intake. Scope is decided by the sidecar.
 * In-scope findings are described to the security analyst and the archivist.
 * Out-of-scope findings are not given a specialist.
 */
import { AgentManager } from "../agents/AgentManager";
import { withGovernanceInvariant } from "../agents/specialists/dynamicCatalog";
import { TeamExpansionDenied, TeamExpansionPlanner } from "../agents/TeamExpansionPlanner";
import { MemoryManager } from "../memory/MemoryManager";
import { ContextIngester } from "../memory/ContextIngester";
import { MessageBus } from "../message-bus/MessageBus";
import type { SecurityDivision } from "../security/SecurityDivision";
import { AuditLedger } from "../security/AuditLedger";
import { ComplianceReport, mapCompliance } from "../security/ComplianceMapper";
import { EvidenceDocument, synthesizeEvidence } from "../security/EvidenceSynthesizer";
import { PolicyChecker } from "../security/PolicyChecker";
import {
  SecurityBoundaryViolation,
  SourceFormat,
  TelemetryReviewPackage
} from "../security/reviewTypes";

interface ReviewHost {
  bus: MessageBus;
  agents: AgentManager;
  memory: MemoryManager;
  security: SecurityDivision;
}

export interface GovernanceUploadInput {
  taskId: string;
  sourceFormat: SourceFormat;
  content: string;
  sidecarUrl: string;
  ledger: AuditLedger;
  fetchImpl?: typeof fetch;
  ingester?: ContextIngester;
}

export interface GovernanceUploadResult {
  reviewPackage: TelemetryReviewPackage;
  violations: SecurityBoundaryViolation[];
  evidence: EvidenceDocument;
  specialistIds: string[];
  compliance: ComplianceReport;
  authorized: false;
}

export async function handleScanTelemetryUpload(
  orchestrator: ReviewHost,
  input: GovernanceUploadInput
): Promise<GovernanceUploadResult> {
  const checker = new PolicyChecker({
    baseUrl: input.sidecarUrl,
    bus: orchestrator.bus,
    taskId: input.taskId,
    fetchImpl: input.fetchImpl
  });
  const reviewed = await checker.submitTelemetryForReview({
    sourceFormat: input.sourceFormat,
    content: input.content
  });
  const inScope = reviewed.package.findings.filter(finding => finding.asset.is_in_scope === true);
  const dropped = reviewed.package.findings.filter(finding => finding.asset.is_in_scope !== true);
  const violations = [...reviewed.violations];
  for (const finding of dropped) {
    if (violations.some(item => item.finding_id === finding.finding_id)) continue;
    const violation: SecurityBoundaryViolation = {
      event: "SecurityBoundaryViolation",
      event_id: crypto.randomUUID(),
      reason: "Target is outside the operator allowlist",
      finding_id: finding.finding_id,
      asset: { ...finding.asset, is_in_scope: false },
      authorized: false
    };
    violations.push(violation);
    publishViolation(orchestrator, input.taskId, violation);
  }
  const retained: TelemetryReviewPackage = {
    ...reviewed.package,
    findings: inScope,
    state: inScope.length ? "REVIEW_READY" : "REJECTED",
    authorized: false,
    requires_human_approval: true
  };
  const compliance = mapCompliance(inScope);
  for (const warning of compliance.criticalWarnings) {
    await input.ledger.append({ kind: "compliance-warning", taskId: input.taskId, warning });
    publishAnalysis(orchestrator, input.taskId, "security", warning);
  }
  const planner = new TeamExpansionPlanner({ division: orchestrator.security });
  const ingester = input.ingester ?? new ContextIngester(orchestrator.memory);
  const specialistIds: string[] = [];
  if (retained.state === "REVIEW_READY") {
    for (const finding of inScope) {
      try {
        const team = await planner.expandForInScopeReview({
          taskId: input.taskId,
          inScope: true,
          title: finding.title + " " + finding.vulnerability_type
        });
        specialistIds.push(...team.members.map(member => member.agentId));
      } catch (error) {
        if (!(error instanceof TeamExpansionDenied)) throw error;
      }
      const summary = withGovernanceInvariant("Finding: " + finding.title + " (" + finding.severity + ").");
      publishAnalysis(orchestrator, input.taskId, "security", "Security Analyst review: " + summary);
      publishAnalysis(orchestrator, input.taskId, "archivist", "Archivist record: " + summary);
      await ingester.ingest({
        taskId: input.taskId,
        title: finding.title,
        summary: finding.reproduction_checklists.join(" "),
        sourceRef: finding.finding_id
      });
    }
  }
  const evidence = synthesizeEvidence({
    packageId: retained.package_id,
    sourceFormat: retained.source_format,
    findings: inScope
  });
  await input.ledger.append({
    kind: "evidence",
    taskId: input.taskId,
    fingerprint: evidence.fingerprint,
    findingCount: inScope.length
  });
  return {
    reviewPackage: retained,
    violations,
    evidence,
    specialistIds,
    compliance,
    authorized: false
  };
}

function publishAnalysis(orchestrator: ReviewHost, taskId: string, recipient: string, analysis: string): void {
  orchestrator.bus.publish({
    messageId: crypto.randomUUID(),
    taskId,
    conversationId: taskId,
    senderAgentId: "director",
    recipientAgentId: recipient,
    messageType: "analysis",
    payload: { analysis },
    evidenceRefs: [],
    createdAt: new Date().toISOString(),
    sequence: orchestrator.bus.getThread(taskId).length
  });
}

function publishViolation(orchestrator: ReviewHost, taskId: string, violation: SecurityBoundaryViolation): void {
  orchestrator.bus.publish({
    messageId: crypto.randomUUID(),
    taskId,
    conversationId: taskId,
    senderAgentId: "security",
    recipientAgentId: "broadcast",
    messageType: "security_boundary_violation",
    payload: {
      event: "SecurityBoundaryViolation",
      reason: violation.reason,
      findingId: violation.finding_id || violation.event_id,
      targetUri: violation.asset.target_uri
    },
    evidenceRefs: [],
    createdAt: new Date().toISOString(),
    sequence: orchestrator.bus.getThread(taskId).length
  });
}
