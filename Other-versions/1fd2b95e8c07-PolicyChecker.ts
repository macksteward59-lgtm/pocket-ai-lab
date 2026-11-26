/**
 * Posts an operator export to the loopback review sidecar.
 * Each boundary violation is published on the message bus.
 * This client does not contact the scanned target.
 */
import { MessageBus } from "../message-bus/MessageBus";
import {
  AssetContext,
  ReviewEnvelope,
  SecurityBoundaryViolation,
  SourceFormat,
  TelemetryReviewPackage
} from "./reviewTypes";

export class PolicyCheckError extends Error {}

export class PolicyChecker {
  constructor(private readonly opts: {
    baseUrl: string;
    bus: MessageBus;
    taskId: string;
    fetchImpl?: typeof fetch;
  }) {}

  async submitTelemetryForReview(input: {
    sourceFormat: SourceFormat;
    content: string;
  }): Promise<{ package: TelemetryReviewPackage; violations: SecurityBoundaryViolation[] }> {
    if (!this.opts.taskId.trim()) throw new PolicyCheckError("taskId is required");
    const url = assertLoopback(this.opts.baseUrl);
    url.pathname = "/api/v1/governance/review";
    url.search = "";
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_format: input.sourceFormat,
        content: input.content
      })
    });
    if (!response.ok) {
      throw new PolicyCheckError("Review sidecar returned " + response.status);
    }
    const body = await response.json() as unknown;
    const envelope = parseEnvelope(body);
    for (const violation of envelope.boundary_violations) {
      this.publishViolation(violation);
    }
    return { package: envelope.review_package, violations: envelope.boundary_violations };
  }

  private publishViolation(violation: SecurityBoundaryViolation): void {
    const sequence = this.opts.bus.getThread(this.opts.taskId).length;
    this.opts.bus.publish({
      messageId: crypto.randomUUID(),
      taskId: this.opts.taskId,
      conversationId: this.opts.taskId,
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
      sequence
    });
  }
}

export function assertLoopback(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new PolicyCheckError("Sidecar URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PolicyCheckError("Sidecar URL must be http or https");
  }
  const host = url.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new PolicyCheckError("Sidecar URL must be loopback");
  }
  return url;
}

function parseEnvelope(value: unknown): ReviewEnvelope {
  if (!isRecord(value)) throw new PolicyCheckError("Review response is missing");
  if (value.authorized !== false) throw new PolicyCheckError("Review response must keep authorized false");
  const reviewPackage = parsePackage(value.review_package);
  const violations = Array.isArray(value.boundary_violations)
    ? value.boundary_violations.map(parseViolation)
    : [];
  return {
    review_package: reviewPackage,
    boundary_violations: violations,
    authorized: false
  };
}

function parsePackage(value: unknown): TelemetryReviewPackage {
  if (!isRecord(value)) throw new PolicyCheckError("Review package is missing");
  if (value.authorized !== false) throw new PolicyCheckError("Review package must keep authorized false");
  if (value.requires_human_approval !== true) {
    throw new PolicyCheckError("Review package requires human approval");
  }
  const sourceFormat = value.source_format;
  if (sourceFormat !== "burp" && sourceFormat !== "nessus" && sourceFormat !== "zap") {
    throw new PolicyCheckError("Review package source format is unsupported");
  }
  const state = value.state;
  if (state !== "TELEMETRY_INGESTED" && state !== "SCOPE_EVALUATED" && state !== "REVIEW_READY" && state !== "REJECTED") {
    throw new PolicyCheckError("Review package state is unsupported");
  }
  const findings = Array.isArray(value.findings) ? value.findings.map(parseFinding) : [];
  if (state === "REVIEW_READY" && !findings.some(finding => finding.asset.is_in_scope === true)) {
    throw new PolicyCheckError("REVIEW_READY requires an in-scope finding");
  }
  return {
    package_id: requiredString(value.package_id, "package_id"),
    timestamp: requiredString(value.timestamp, "timestamp"),
    source_format: sourceFormat,
    findings,
    audit_trail_logs: stringList(value.audit_trail_logs),
    state,
    authorized: false,
    requires_human_approval: true
  };
}

function parseFinding(value: unknown) {
  if (!isRecord(value)) throw new PolicyCheckError("Finding is malformed");
  if (value.authorized !== false && value.authorized !== undefined) {
    throw new PolicyCheckError("Finding must keep authorized false");
  }
  return {
    finding_id: requiredString(value.finding_id, "finding_id"),
    title: requiredString(value.title, "title"),
    vulnerability_type: requiredString(value.vulnerability_type, "vulnerability_type"),
    severity: requiredString(value.severity, "severity"),
    confidence_level: requiredString(value.confidence_level, "confidence_level"),
    raw_traffic_context: typeof value.raw_traffic_context === "string" ? value.raw_traffic_context : null,
    affected_parameters: stringList(value.affected_parameters),
    reproduction_checklists: stringList(value.reproduction_checklists),
    asset: parseAsset(value.asset),
    authorized: false as const
  };
}

function parseAsset(value: unknown): AssetContext {
  if (!isRecord(value)) throw new PolicyCheckError("Asset is malformed");
  return {
    target_uri: requiredString(value.target_uri, "target_uri"),
    base_domain: requiredString(value.base_domain, "base_domain"),
    ip_address: typeof value.ip_address === "string" ? value.ip_address : null,
    port: typeof value.port === "number" ? value.port : null,
    is_in_scope: value.is_in_scope === true
  };
}

function parseViolation(value: unknown): SecurityBoundaryViolation {
  if (!isRecord(value)) throw new PolicyCheckError("Boundary violation is malformed");
  if (value.event !== "SecurityBoundaryViolation") {
    throw new PolicyCheckError("Boundary violation event is unsupported");
  }
  if (value.authorized !== false) throw new PolicyCheckError("Boundary violation must keep authorized false");
  return {
    event: "SecurityBoundaryViolation",
    event_id: requiredString(value.event_id, "event_id"),
    reason: requiredString(value.reason, "reason"),
    finding_id: typeof value.finding_id === "string" ? value.finding_id : null,
    asset: parseAsset(value.asset),
    authorized: false
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new PolicyCheckError(name + " is required");
  return value;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
