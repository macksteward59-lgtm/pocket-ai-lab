import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArtifactCandidate } from "../artifactCandidate";

const digest = "a".repeat(64);
const validCandidate = () => ({
  schemaVersion: 1,
  artifactId: "artifact:sample-001",
  content: { sha256: digest, byteLength: 4096, mediaType: "application/octet-stream" },
  source: {
    kind: "authorized_repository",
    sourceRef: "repo:owner/project",
    revision: "0123456789abcdef0123456789abcdef01234567",
  },
  collectedAt: "2026-11-17T18:00:00.000Z",
  collectorId: "local-collector",
  scopeBinding: { manifestSha256: digest, exactTargetId: "repository:owner/project" },
  authorizationReference: { decisionId: "apex-decision-123", evidenceSha256: digest },
  handling: { secretsRedacted: true, retention: "restricted" },
});

test("valid metadata yields only a frozen quarantined candidate", () => {
  const result = parseArtifactCandidate(validCandidate());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.handling.state, "quarantined_candidate");
  assert.equal(result.value.authorizationGranted, false);
  assert.equal(result.value.eligibleForAnalysis, false);
  assert.equal(result.value.content.digestVerification, "unverified");
  assert.equal(result.value.authorizationReference?.verification, "unverified");
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.content), true);
});

test("an authorization reference never grants authorization", () => {
  const result = parseArtifactCandidate(validCandidate());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.authorizationGranted, false);
  assert.equal(result.value.eligibleForAnalysis, false);
});

test("unknown top-level fields are rejected", () => {
  const candidate = { ...validCandidate(), trusted: true };
  const result = parseArtifactCandidate(candidate);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.includes("candidate contains unknown fields"));
});

test("uppercase or malformed content digests are rejected", () => {
  const candidate = validCandidate();
  candidate.content.sha256 = "A".repeat(64);
  const result = parseArtifactCandidate(candidate);
  assert.equal(result.ok, false);
});

test("wildcard and ambiguous target identifiers are rejected", () => {
  const candidate = validCandidate();
  candidate.scopeBinding.exactTargetId = "repo:owner/*";
  const result = parseArtifactCandidate(candidate);
  assert.equal(result.ok, false);
});

test("scope manifest digest must be a lowercase SHA-256 digest", () => {
  const candidate = validCandidate();
  candidate.scopeBinding.manifestSha256 = "not-a-digest";
  const result = parseArtifactCandidate(candidate);
  assert.equal(result.ok, false);
});

test("unredacted candidate metadata is rejected", () => {
  const candidate = validCandidate();
  candidate.handling.secretsRedacted = false as unknown as true;
  const result = parseArtifactCandidate(candidate);
  assert.equal(result.ok, false);
});

test("non-canonical timestamps are rejected", () => {
  const candidate = validCandidate();
  candidate.collectedAt = "2026-11-17T13:00:00-05:00";
  const result = parseArtifactCandidate(candidate);
  assert.equal(result.ok, false);
});

test("artifact sizes are bounded to 100 MiB", () => {
  const candidate = validCandidate();
  candidate.content.byteLength = 100 * 1024 * 1024 + 1;
  const result = parseArtifactCandidate(candidate);
  assert.equal(result.ok, false);
});

test("source references containing query strings or fragments are rejected", () => {
  const candidate = validCandidate();
  candidate.source.sourceRef = "https://example.test/app.js?token=secret";
  const result = parseArtifactCandidate(candidate);
  assert.equal(result.ok, false);
});

test("HTTPS source references with embedded credentials are rejected", () => {
  const candidate = validCandidate();
  candidate.source.sourceRef = "https://user:password@example.test/app.js";
  const result = parseArtifactCandidate(candidate);
  assert.equal(result.ok, false);
});

test("unsupported source kinds and retention classes are rejected", () => {
  const candidate = validCandidate();
  candidate.source.kind = "arbitrary_remote";
  candidate.handling.retention = "public";
  const result = parseArtifactCandidate(candidate);
  assert.equal(result.ok, false);
});

test("candidate cannot carry a malformed APEX evidence digest", () => {
  const candidate = validCandidate();
  candidate.authorizationReference.evidenceSha256 = "unverified-but-not-a-hash";
  const result = parseArtifactCandidate(candidate);
  assert.equal(result.ok, false);
});

test("candidate without an authorization reference remains quarantined", () => {
  const candidate = validCandidate();
  delete (candidate as { authorizationReference?: unknown }).authorizationReference;
  const result = parseArtifactCandidate(candidate);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.authorizationReference, null);
  assert.equal(result.value.authorizationGranted, false);
});

test("unsupported opaque source schemes are rejected", () => {
  const candidate = validCandidate();
  candidate.source.sourceRef = "javascript:alert(1)";
  const result = parseArtifactCandidate(candidate);
  assert.equal(result.ok, false);
});

test("scope target identifiers use the scope manifest target-kind contract", () => {
  const candidate = validCandidate();
  candidate.scopeBinding.exactTargetId = "repo:owner/project";
  assert.equal(parseArtifactCandidate(candidate).ok, false);
  candidate.scopeBinding.exactTargetId = "repository:owner/project";
  assert.equal(parseArtifactCandidate(candidate).ok, true);
});

test("hostname scope targets must be canonical lowercase DNS names", () => {
  const candidate = validCandidate();
  candidate.scopeBinding.exactTargetId = "hostname:Example.COM";
  assert.equal(parseArtifactCandidate(candidate).ok, false);
  candidate.scopeBinding.exactTargetId = "hostname:example.com";
  assert.equal(parseArtifactCandidate(candidate).ok, true);
});

test("artifact hash scope targets require an exact SHA-256 identifier", () => {
  const candidate = validCandidate();
  candidate.scopeBinding.exactTargetId = "artifact_sha256:not-a-digest";
  assert.equal(parseArtifactCandidate(candidate).ok, false);
  candidate.scopeBinding.exactTargetId = "artifact_sha256:" + digest;
  assert.equal(parseArtifactCandidate(candidate).ok, true);
});

test("unsupported scope target kinds are rejected", () => {
  const candidate = validCandidate();
  candidate.scopeBinding.exactTargetId = "wildcard:owner/project";
  assert.equal(parseArtifactCandidate(candidate).ok, false);
});

test("custom-prototype objects are rejected instead of reading inherited fields", () => {
  const candidate = validCandidate() as Record<string, unknown>;
  delete candidate.schemaVersion;
  Object.setPrototypeOf(candidate, { schemaVersion: 1 });
  assert.equal(parseArtifactCandidate(candidate).ok, false);
});

test("nested custom-prototype metadata objects are rejected", () => {
  const candidate = validCandidate();
  const inheritedSource = Object.assign(
    Object.create({ kind: "authorized_repository" }),
    { sourceRef: "repo:owner/project", revision: "0123456789abcdef0123456789abcdef01234567" },
  );
  candidate.source = inheritedSource;
  assert.equal(parseArtifactCandidate(candidate).ok, false);
});

test("accessor-backed candidate properties are rejected without invoking getters", () => {
  const candidate = validCandidate();
  Object.defineProperty(candidate, "artifactId", {
    enumerable: true,
    configurable: true,
    get() { throw new Error("getter must not run"); },
  });
  assert.equal(parseArtifactCandidate(candidate).ok, false);
});

test("proxy reflection failures fail closed", () => {
  const candidate = new Proxy(validCandidate(), {
    ownKeys() { throw new Error("reflection denied"); },
  });
  assert.equal(parseArtifactCandidate(candidate).ok, false);
});
