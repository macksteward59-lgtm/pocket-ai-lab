/**
 * Shared shapes for a non-executing governance review.
 * `authorized` is the constant false. Callers cannot widen it.
 */

export type SourceFormat = "burp" | "nessus" | "zap";

export interface AssetContext {
  target_uri: string;
  base_domain: string;
  ip_address?: string | null;
  port?: number | null;
  is_in_scope: boolean;
}

export interface NormalizedFinding {
  finding_id: string;
  title: string;
  vulnerability_type: string;
  severity: string;
  confidence_level: string;
  raw_traffic_context?: string | null;
  affected_parameters: string[];
  reproduction_checklists: string[];
  asset: AssetContext;
  authorized: false;
}

export interface TelemetryReviewPackage {
  package_id: string;
  timestamp: string;
  source_format: SourceFormat;
  findings: NormalizedFinding[];
  audit_trail_logs: string[];
  state: "TELEMETRY_INGESTED" | "SCOPE_EVALUATED" | "REVIEW_READY" | "REJECTED";
  authorized: false;
  requires_human_approval: true;
}

export interface SecurityBoundaryViolation {
  event: "SecurityBoundaryViolation";
  event_id: string;
  reason: string;
  finding_id?: string | null;
  asset: AssetContext;
  authorized: false;
}

export interface ReviewEnvelope {
  review_package: TelemetryReviewPackage;
  boundary_violations: SecurityBoundaryViolation[];
  authorized: false;
}
