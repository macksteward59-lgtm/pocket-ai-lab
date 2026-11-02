import { evidenceFits, reusedNonce, type DeviceEvidence } from "./contract";

export type EvidenceAttemptBinding = {
  conversation_request_id: string;
  attempt_id: string;
  model_file_hash: string | null;
  runtime_session_id: string | null;
  device_id: string | null;
};

export type EvidenceSubmissionResult =
  | { ok: true; status: "candidate_only"; evidence: DeviceEvidence }
  | { ok: false; reason: "invalid_shape" | "attempt_mismatch" | "nonce_reuse" };

/**
 * Validates that a device-evidence candidate is well-formed, bound to the
 * supplied attempt, and does not reuse another attempt's challenge nonce.
 *
 * This is deliberately not an APEX authorization decision. It does not verify
 * signatures, issue receipts, persist evidence, or authorize execution.
 */
export function validateDeviceEvidenceCandidate(
  input: unknown,
  attempt: EvidenceAttemptBinding,
  existing: Array<{ attempt_id: string; challenge_nonce: string }>,
): EvidenceSubmissionResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "invalid_shape" };
  }

  const record = input as Record<string, unknown>;
  const fields: Array<keyof DeviceEvidence> = [
    "conversation_request_id",
    "attempt_id",
    "model_id",
    "model_file_hash",
    "runtime_session_id",
    "runtime_version",
    "device_id",
    "challenge_nonce",
    "generation_result_hash",
    "attested_at",
  ];

  if (
    Object.keys(record).length !== fields.length ||
    fields.some((field) => typeof record[field] !== "string" || (record[field] as string).length === 0) ||
    Object.keys(record).some((field) => !fields.includes(field as keyof DeviceEvidence))
  ) {
    return { ok: false, reason: "invalid_shape" };
  }

  const evidence = record as unknown as DeviceEvidence;
  if (!evidenceFits(attempt, evidence)) {
    return { ok: false, reason: "attempt_mismatch" };
  }

  if (reusedNonce(existing, evidence)) {
    return { ok: false, reason: "nonce_reuse" };
  }

  return { ok: true, status: "candidate_only", evidence };
}
