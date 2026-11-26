import { describe, expect, it } from "vitest";
import { validateDeviceEvidenceCandidate } from "../../director/src/lib/compliance/evidence-submission";
import type { DeviceEvidence } from "../../director/src/lib/compliance/contract";

const attempt = {
  conversation_request_id: "request-1",
  attempt_id: "attempt-1",
  model_file_hash: "model-hash",
  runtime_session_id: "runtime-1",
  device_id: "device-1",
};

const evidence: DeviceEvidence = {
  conversation_request_id: "request-1",
  attempt_id: "attempt-1",
  model_id: "model-1",
  model_file_hash: "model-hash",
  runtime_session_id: "runtime-1",
  runtime_version: "runtime-version",
  device_id: "device-1",
  challenge_nonce: "nonce-1",
  generation_result_hash: "result-hash",
  attested_at: "2026-11-02T12:00:00.000Z",
};

function rejectionReason(input: unknown, rows: Array<{ attempt_id: string; challenge_nonce: string }> = []) {
  const result = validateDeviceEvidenceCandidate(input, attempt, rows);
  return result.ok ? undefined : result.reason;
}

describe("DeviceEvidence candidate validation", () => {
  it("accepts evidence bound to the exact attempt without granting authorization", () => {
    expect(validateDeviceEvidenceCandidate(evidence, attempt, [])).toEqual({
      ok: true,
      status: "candidate_only",
      evidence,
    });
  });

  it("rejects non-object, array, missing, empty, and unexpected fields", () => {
    expect(rejectionReason(null)).toBe("invalid_shape");
    expect(rejectionReason([])).toBe("invalid_shape");
    const { runtime_version: _runtimeVersion, ...missing } = evidence;
    expect(rejectionReason(missing)).toBe("invalid_shape");
    expect(rejectionReason({ ...evidence, model_id: "" })).toBe("invalid_shape");
    expect(rejectionReason({ ...evidence, extra: "ignored?" })).toBe("invalid_shape");
  });

  it.each([
    ["conversation_request_id", "other-request"],
    ["attempt_id", "other-attempt"],
    ["model_file_hash", "other-model-hash"],
    ["runtime_session_id", "other-runtime"],
    ["device_id", "other-device"],
  ] as const)("rejects evidence with mismatched %s", (field, value) => {
    expect(rejectionReason({ ...evidence, [field]: value })).toBe("attempt_mismatch");
  });

  it("rejects a nonce already used by a different attempt", () => {
    expect(rejectionReason(evidence, [
      { attempt_id: "attempt-previous", challenge_nonce: "nonce-1" },
    ])).toBe("nonce_reuse");
  });

  it("does not reject nonce history belonging to the same attempt, matching the contract", () => {
    expect(validateDeviceEvidenceCandidate(evidence, attempt, [
      { attempt_id: "attempt-1", challenge_nonce: "nonce-1" },
    ]).ok).toBe(true);
  });
});
