import assert from "node:assert/strict";
import test from "node:test";
import {
  checkScopeConstraints,
  validateScopeManifest,
  type ScopeManifest,
} from "../scopeManifest";

const NOW = new Date("2026-11-17T18:00:00.000Z");

function fixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    schema_version: "1.0",
    manifest_id: "scope-test-0001",
    owner: "Example Asset Owner",
    approved_by: "Example Human",
    created_at: "2026-11-17T17:00:00.000Z",
    expires_at: "2026-11-17T19:00:00.000Z",
    purpose: "Local synthetic regression fixture",
    targets: [{ kind: "artifact_sha256", value: "a".repeat(64) }],
    environments: ["local-synthetic-fixture"],
    permitted_operations: ["artifact.read_local", "static.analysis", "test.local_fixture"],
    excluded_targets: ["hostname:prod.example.invalid"],
    collection_limits: {
      max_artifact_bytes: 1024,
      max_files: 10,
      max_depth: 4,
      max_concurrency: 1,
      max_runtime_seconds: 30,
    },
    data_handling: {
      allowed_classes: ["synthetic"],
      secret_redaction_required: true,
      retention_days: 7,
      external_disclosure_allowed: false,
    },
    approval_reference: "EXAMPLE-ONLY",
    integrity: { canonicalization: "RFC8785", sha256: "b".repeat(64) },
    ...overrides,
  };
}

function validManifest(): ScopeManifest {
  const result = validateScopeManifest(fixture(), NOW);
  if (!result.valid) throw new Error(result.errors.join("; "));
  return result.manifest;
}

const request = {
  target: { kind: "artifact_sha256" as const, value: "a".repeat(64) },
  operation: "static.analysis" as const,
  environment: "local-synthetic-fixture",
  requestedAt: NOW,
};

test("accepts a well-formed, unexpired manifest as input only", () => {
  const result = validateScopeManifest(fixture(), NOW);
  assert.equal(result.valid, true);
});

test("rejects expired manifests", () => {
  const result = validateScopeManifest(fixture({ expires_at: "2026-11-17T17:59:59.000Z" }), NOW);
  assert.equal(result.valid, false);
});

test("rejects wildcard hostnames", () => {
  const result = validateScopeManifest(fixture({
    targets: [{ kind: "hostname", value: "*.example.invalid" }],
  }), NOW);
  assert.equal(result.valid, false);
});

test("rejects malformed hashes and unknown fields", () => {
  const result = validateScopeManifest(fixture({
    targets: [{ kind: "artifact_sha256", value: "not-a-hash" }],
    can_execute: true,
  }), NOW);
  assert.equal(result.valid, false);
});

test("denies a target that is not an exact manifest entry", () => {
  const result = checkScopeConstraints(validManifest(), {
    ...request,
    target: { kind: "artifact_sha256", value: "c".repeat(64) },
  });
  assert.equal(result.constraintsSatisfied, false);
  assert.equal(result.authorizationGranted, false);
});

test("denies an operation absent from the manifest", () => {
  const result = checkScopeConstraints(validManifest(), {
    ...request,
    operation: "test.staging",
  });
  assert.equal(result.constraintsSatisfied, false);
  assert.equal(result.authorizationGranted, false);
});

test("denies an environment absent from the manifest", () => {
  const result = checkScopeConstraints(validManifest(), {
    ...request,
    environment: "production",
  });
  assert.equal(result.constraintsSatisfied, false);
});

test("a matching manifest still requires an independent APEX decision", () => {
  const result = checkScopeConstraints(validManifest(), request);
  assert.equal(result.constraintsSatisfied, true);
  assert.equal(result.authorizationGranted, false);
  assert.equal(result.status, "apex_decision_required");
  assert.equal(result.reason, "A_VALID_MANIFEST_IS_NOT_AN_AUTHORIZATION");
});

test("denies a manifest that is expired at validation time even when requestedAt is backdated", () => {
  const manifest = validManifest();
  const result = checkScopeConstraints(
    manifest,
    {
      ...request,
      requestedAt: new Date("2026-11-17T17:30:00.000Z"),
    },
    new Date("2026-11-17T20:00:00.000Z"),
  );
  assert.equal(result.constraintsSatisfied, false);
  assert.equal(result.authorizationGranted, false);
  assert.deepEqual(
    result.status === "denied" ? result.reasons : [],
    ["manifest_expired"],
  );
});

test("rejects an unusable validation clock", () => {
  const result = checkScopeConstraints(validManifest(), request, new Date(Number.NaN));
  assert.equal(result.constraintsSatisfied, false);
  assert.equal(result.authorizationGranted, false);
  assert.deepEqual(
    result.status === "denied" ? result.reasons : [],
    ["invalid_validation_time"],
  );
});
