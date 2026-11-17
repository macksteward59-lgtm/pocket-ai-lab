/**
 * Quarantine-only artifact provenance envelope.
 *
 * This module validates metadata only. It never reads files, fetches targets,
 * verifies content hashes, verifies APEX decisions, or authorizes analysis.
 */

export type ArtifactSourceKind =
  | "user_upload"
  | "authorized_repository"
  | "authorized_web_asset"
  | "local_export"
  | "package_snapshot";

export type ArtifactRetention = "ephemeral" | "project" | "restricted";

export interface ArtifactCandidateInput {
  schemaVersion: 1;
  artifactId: string;
  content: {
    sha256: string;
    byteLength: number;
    mediaType: string;
  };
  source: {
    kind: ArtifactSourceKind;
    sourceRef: string;
    revision?: string;
  };
  collectedAt: string;
  collectorId: string;
  scopeBinding: {
    manifestSha256: string;
    exactTargetId: string;
  };
  authorizationReference?: {
    decisionId: string;
    evidenceSha256?: string;
  };
  handling: {
    secretsRedacted: true;
    retention: ArtifactRetention;
  };
}

export interface QuarantinedArtifactCandidate {
  readonly schemaVersion: 1;
  readonly artifactId: string;
  readonly content: Readonly<{
    sha256: string;
    byteLength: number;
    mediaType: string;
    digestVerification: "unverified";
  }>;
  readonly source: Readonly<{
    kind: ArtifactSourceKind;
    sourceRef: string;
    revision?: string;
  }>;
  readonly collectedAt: string;
  readonly collectorId: string;
  readonly scopeBinding: Readonly<{
    manifestSha256: string;
    exactTargetId: string;
  }>;
  readonly authorizationReference: Readonly<{
    decisionId: string;
    evidenceSha256?: string;
    verification: "unverified";
  }> | null;
  readonly handling: Readonly<{
    state: "quarantined_candidate";
    secretsRedacted: true;
    retention: ArtifactRetention;
  }>;
  readonly authorizationGranted: false;
  readonly eligibleForAnalysis: false;
}

export type ArtifactCandidateResult =
  | { ok: true; value: QuarantinedArtifactCandidate }
  | { ok: false; issues: string[] };

const SHA256 = /^[a-f0-9]{64}$/;
const ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/;
const SOURCE_KINDS: readonly ArtifactSourceKind[] = [
  "user_upload",
  "authorized_repository",
  "authorized_web_asset",
  "local_export",
  "package_snapshot",
];
const RETENTION: readonly ArtifactRetention[] = ["ephemeral", "project", "restricted"];
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
    });
  } catch {
    return false;
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isBoundedText(value: unknown, max: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= max
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSafeSourceRef(value: unknown): value is string {
  if (!isBoundedText(value, 512) || /[?#]/.test(value)) return false;
  if (/^https:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return url.protocol === "https:"
        && url.username === ""
        && url.password === ""
        && url.search === ""
        && url.hash === ""
        && url.hostname === url.hostname.toLowerCase();
    } catch {
      return false;
    }
  }
  const scheme = value.slice(0, value.indexOf(":")).toLowerCase();
  return ["repo", "upload", "package", "local"].includes(scheme)
    && /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(value);
}

function isExactScopeTargetId(value: unknown): value is string {
  if (!isBoundedText(value, 512) || /[?*\s]/.test(value)) return false;
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return false;
  const kind = value.slice(0, separator);
  const target = value.slice(separator + 1);

  switch (kind) {
    case "artifact_sha256":
      return SHA256.test(target);
    case "hostname":
      return target.length <= 253
        && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(target);
    case "repository":
      return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(target);
    case "package":
      return target.length >= 3 && target.length <= 512 && !target.includes("..");
    default:
      return false;
  }
}

function isCanonicalUtc(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

/**
 * Parse an artifact metadata envelope. A successful result is still only a
 * quarantined candidate: declared hashes and APEX references remain unverified.
 */
export function parseArtifactCandidate(input: unknown): ArtifactCandidateResult {
  const issues: string[] = [];
  if (!isRecord(input)) return { ok: false, issues: ["candidate must be an object"] };

  if (!hasOnlyKeys(input, [
    "schemaVersion", "artifactId", "content", "source", "collectedAt",
    "collectorId", "scopeBinding", "authorizationReference", "handling",
  ])) issues.push("candidate contains unknown fields");
  if (input.schemaVersion !== 1) issues.push("schemaVersion must equal 1");
  if (typeof input.artifactId !== "string" || !ARTIFACT_ID.test(input.artifactId)) {
    issues.push("artifactId must be a bounded stable identifier");
  }

  const content = input.content;
  if (!isRecord(content)) {
    issues.push("content must be an object");
  } else {
    if (!hasOnlyKeys(content, ["sha256", "byteLength", "mediaType"])) {
      issues.push("content contains unknown fields");
    }
    if (typeof content.sha256 !== "string" || !SHA256.test(content.sha256)) {
      issues.push("content.sha256 must be a lowercase SHA-256 hex digest");
    }
    if (typeof content.byteLength !== "number"
      || !Number.isSafeInteger(content.byteLength)
      || content.byteLength < 1
      || content.byteLength > MAX_ARTIFACT_BYTES) {
      issues.push("content.byteLength must be between 1 byte and 100 MiB");
    }
    if (typeof content.mediaType !== "string" || !MEDIA_TYPE.test(content.mediaType)) {
      issues.push("content.mediaType must be a lowercase type/subtype");
    }
  }

  const source = input.source;
  if (!isRecord(source)) {
    issues.push("source must be an object");
  } else {
    if (!hasOnlyKeys(source, ["kind", "sourceRef", "revision"])) {
      issues.push("source contains unknown fields");
    }
    if (typeof source.kind !== "string" || !SOURCE_KINDS.includes(source.kind as ArtifactSourceKind)) {
      issues.push("source.kind is unsupported");
    }
    if (!isSafeSourceRef(source.sourceRef)) {
      issues.push("source.sourceRef must be a stable reference without query strings or fragments");
    }
    if (source.revision !== undefined && !isBoundedText(source.revision, 128)) {
      issues.push("source.revision must be bounded text");
    }
  }

  if (!isCanonicalUtc(input.collectedAt)) issues.push("collectedAt must be canonical UTC ISO-8601");
  if (!isBoundedText(input.collectorId, 64)) issues.push("collectorId must be bounded text");

  const scope = input.scopeBinding;
  if (!isRecord(scope)) {
    issues.push("scopeBinding must be an object");
  } else {
    if (!hasOnlyKeys(scope, ["manifestSha256", "exactTargetId"])) {
      issues.push("scopeBinding contains unknown fields");
    }
    if (typeof scope.manifestSha256 !== "string" || !SHA256.test(scope.manifestSha256)) {
      issues.push("scopeBinding.manifestSha256 must be a lowercase SHA-256 digest");
    }
    if (!isExactScopeTargetId(scope.exactTargetId)) {
      issues.push("scopeBinding.exactTargetId must match a canonical exact scope target identifier");
    }
  }

  const authorization = input.authorizationReference;
  if (authorization !== undefined) {
    if (!isRecord(authorization)) {
      issues.push("authorizationReference must be an object when supplied");
    } else {
      if (!hasOnlyKeys(authorization, ["decisionId", "evidenceSha256"])) {
        issues.push("authorizationReference contains unknown fields");
      }
      if (!isBoundedText(authorization.decisionId, 128)) {
        issues.push("authorizationReference.decisionId must be bounded text");
      }
      if (authorization.evidenceSha256 !== undefined
        && (typeof authorization.evidenceSha256 !== "string" || !SHA256.test(authorization.evidenceSha256))) {
        issues.push("authorizationReference.evidenceSha256 must be a lowercase SHA-256 digest");
      }
    }
  }

  const handling = input.handling;
  if (!isRecord(handling)) {
    issues.push("handling must be an object");
  } else {
    if (!hasOnlyKeys(handling, ["secretsRedacted", "retention"])) {
      issues.push("handling contains unknown fields");
    }
    if (handling.secretsRedacted !== true) issues.push("secrets must be redacted before candidate registration");
    if (typeof handling.retention !== "string" || !RETENTION.includes(handling.retention as ArtifactRetention)) {
      issues.push("handling.retention is unsupported");
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  const c = content as Record<string, unknown>;
  const s = source as Record<string, unknown>;
  const scopeValue = scope as Record<string, unknown>;
  const h = handling as Record<string, unknown>;
  const a = authorization as Record<string, unknown> | undefined;

  const authorizationReference = a ? Object.freeze({
    decisionId: a.decisionId as string,
    ...(a.evidenceSha256 === undefined ? {} : { evidenceSha256: a.evidenceSha256 as string }),
    verification: "unverified" as const,
  }) : null;

  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: 1 as const,
      artifactId: input.artifactId as string,
      content: Object.freeze({
        sha256: c.sha256 as string,
        byteLength: c.byteLength as number,
        mediaType: c.mediaType as string,
        digestVerification: "unverified" as const,
      }),
      source: Object.freeze({
        kind: s.kind as ArtifactSourceKind,
        sourceRef: s.sourceRef as string,
        ...(s.revision === undefined ? {} : { revision: s.revision as string }),
      }),
      collectedAt: input.collectedAt as string,
      collectorId: input.collectorId as string,
      scopeBinding: Object.freeze({
        manifestSha256: scopeValue.manifestSha256 as string,
        exactTargetId: scopeValue.exactTargetId as string,
      }),
      authorizationReference,
      handling: Object.freeze({
        state: "quarantined_candidate" as const,
        secretsRedacted: true as const,
        retention: h.retention as ArtifactRetention,
      }),
      authorizationGranted: false as const,
      eligibleForAnalysis: false as const,
    }),
  };
}
