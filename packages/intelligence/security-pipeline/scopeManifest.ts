import { z } from "zod";

/**
 * Scope-manifest validation is a preflight utility only.
 *
 * A well-formed, unexpired manifest does NOT grant permission. This module
 * deliberately has no signing keys, network clients, target discovery, or
 * execution hooks. APEX must make a separate, action-bound authorization
 * decision before any protected operation is dispatched.
 */

export const SCOPE_OPERATIONS = [
  "artifact.read_local",
  "repository.read_authorized",
  "passive.metadata",
  "static.analysis",
  "decompile.local",
  "test.local_fixture",
  "test.staging",
  "disclose.finding",
] as const;

export type ScopeOperation = (typeof SCOPE_OPERATIONS)[number];

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "Expected lowercase SHA-256 hex");

const hostnameSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/, "Hostname must be canonical lowercase ASCII without wildcards or trailing dots");

const scopeTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("artifact_sha256"), value: sha256Schema }).strict(),
  z.object({ kind: z.literal("hostname"), value: hostnameSchema }).strict(),
  z.object({ kind: z.literal("repository"), value: z.string().regex(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/, "Repository must be exact owner/repository notation") }).strict(),
  z.object({ kind: z.literal("package"), value: z.string().min(3).max(512).refine((v) => !v.includes("*"), "Package coordinates cannot contain wildcards") }).strict(),
]);

const manifestSchema = z.object({
  schema_version: z.literal("1.0"),
  manifest_id: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  owner: z.string().trim().min(1).max(256),
  approved_by: z.string().trim().min(1).max(256),
  created_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
  purpose: z.string().trim().min(1).max(2000),
  targets: z.array(scopeTargetSchema).min(1).max(100),
  environments: z.array(z.string().trim().min(1).max(128)).min(1).max(32),
  permitted_operations: z.array(z.enum(SCOPE_OPERATIONS)).min(1),
  excluded_targets: z.array(z.string().trim().min(1).max(512)).max(200),
  collection_limits: z.object({
    max_artifact_bytes: z.number().int().positive().max(1_073_741_824),
    max_files: z.number().int().positive().max(100_000),
    max_depth: z.number().int().positive().max(128),
    max_concurrency: z.number().int().positive().max(64),
    max_runtime_seconds: z.number().int().positive().max(86_400),
  }).strict(),
  data_handling: z.object({
    allowed_classes: z.array(z.enum(["synthetic", "public", "owner_provided"])).min(1),
    secret_redaction_required: z.literal(true),
    retention_days: z.number().int().min(1).max(3650),
    external_disclosure_allowed: z.boolean(),
  }).strict(),
  approval_reference: z.string().trim().min(1).max(512),
  integrity: z.object({
    canonicalization: z.literal("RFC8785"),
    sha256: sha256Schema,
  }).strict(),
}).strict();

export type ScopeManifest = z.infer<typeof manifestSchema>;
export type ScopeTarget = z.infer<typeof scopeTargetSchema>;

export type ManifestValidation =
  | { valid: true; manifest: ScopeManifest }
  | { valid: false; errors: string[] };

export function validateScopeManifest(input: unknown, now: Date = new Date()): ManifestValidation {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`),
    };
  }

  const createdAt = Date.parse(parsed.data.created_at);
  const expiresAt = Date.parse(parsed.data.expires_at);
  const nowMs = now.getTime();
  const errors: string[] = [];

  if (!Number.isFinite(nowMs)) errors.push("clock: invalid validation time");
  if (createdAt > nowMs + 5 * 60 * 1000) errors.push("created_at: manifest creation time is in the future");
  if (expiresAt <= createdAt) errors.push("expires_at: expiry must be later than creation");
  if (expiresAt <= nowMs) errors.push("expires_at: manifest is expired");
  if (new Set(parsed.data.environments).size !== parsed.data.environments.length) {
    errors.push("environments: duplicate environment entries are not allowed");
  }
  if (new Set(parsed.data.permitted_operations).size !== parsed.data.permitted_operations.length) {
    errors.push("permitted_operations: duplicate operations are not allowed");
  }
  const targetKeys = parsed.data.targets.map((target) => `${target.kind}:${target.value}`);
  if (new Set(targetKeys).size !== targetKeys.length) errors.push("targets: duplicate target entries are not allowed");

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, manifest: parsed.data };
}

export interface ScopeActionRequest {
  target: ScopeTarget;
  operation: ScopeOperation;
  environment: string;
  requestedAt: Date;
}

export type ScopePreflightResult =
  | {
      constraintsSatisfied: true;
      authorizationGranted: false;
      status: "apex_decision_required";
      manifestId: string;
      declaredDigestUnverified: string;
      reason: "A_VALID_MANIFEST_IS_NOT_AN_AUTHORIZATION";
    }
  | {
      constraintsSatisfied: false;
      authorizationGranted: false;
      status: "denied";
      reasons: string[];
    };

/**
 * Checks only local manifest constraints. It never grants or implies authority.
 * Callers must obtain a fresh APEX decision bound to this exact request.
 */
export function checkScopeConstraints(
  manifest: ScopeManifest,
  request: ScopeActionRequest,
): ScopePreflightResult {
  const reasons: string[] = [];
  const requestTime = request.requestedAt.getTime();

  if (!Number.isFinite(requestTime)) reasons.push("invalid_request_time");
  if (Date.parse(manifest.expires_at) <= requestTime) reasons.push("manifest_expired");
  if (!manifest.permitted_operations.includes(request.operation)) reasons.push("operation_not_in_manifest");
  if (!manifest.environments.includes(request.environment)) reasons.push("environment_not_in_manifest");

  const exactTargetIncluded = manifest.targets.some(
    (target) => target.kind === request.target.kind && target.value === request.target.value,
  );
  if (!exactTargetIncluded) reasons.push("target_not_exactly_in_manifest");

  if (manifest.excluded_targets.includes(`${request.target.kind}:${request.target.value}`)) {
    reasons.push("target_explicitly_excluded");
  }

  if (reasons.length > 0) {
    return { constraintsSatisfied: false, authorizationGranted: false, status: "denied", reasons };
  }

  return {
    constraintsSatisfied: true,
    authorizationGranted: false,
    status: "apex_decision_required",
    manifestId: manifest.manifest_id,
    declaredDigestUnverified: manifest.integrity.sha256,
    reason: "A_VALID_MANIFEST_IS_NOT_AN_AUTHORIZATION",
  };
}
