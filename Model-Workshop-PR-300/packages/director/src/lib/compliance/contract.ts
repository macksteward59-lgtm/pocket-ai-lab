export type AttemptPhase = "created" | "dispatched" | "running" | "completed" | "failed" | "interrupted" | "cancelled" | "timeout";

const terminal = new Set<AttemptPhase>(["completed", "failed", "interrupted", "cancelled", "timeout"]);

const allowed: Record<"created" | "dispatched" | "running", AttemptPhase[]> = {
  created: ["dispatched", "failed", "cancelled"],
  dispatched: ["running", "failed", "cancelled", "timeout"],
  running: ["completed", "failed", "interrupted", "cancelled", "timeout"],
};

export function nextPhase(from: AttemptPhase, to: AttemptPhase): "ok" | "terminal" | "illegal" {
  if (terminal.has(from)) return "terminal";
  if (from !== "created" && from !== "dispatched" && from !== "running") return "illegal";
  return allowed[from].includes(to) ? "ok" : "illegal";
}

export function lifecyclePath(status: "completed" | "failed" | "interrupted" | "cancelled" | "timeout"): AttemptPhase[] {
  if (status === "completed" || status === "interrupted" || status === "timeout") return ["created", "dispatched", "running", status];
  if (status === "cancelled") return ["created", "cancelled"];
  return ["created", "failed"];
}

export type DeviceEvidence = {
  conversation_request_id: string;
  attempt_id: string;
  model_id: string;
  model_file_hash: string;
  runtime_session_id: string;
  runtime_version: string;
  device_id: string;
  challenge_nonce: string;
  generation_result_hash: string;
  attested_at: string;
};

export function evidenceFits(
  attempt: { conversation_request_id: string; attempt_id: string; model_file_hash: string | null; runtime_session_id: string | null; device_id: string | null },
  evidence: DeviceEvidence,
): boolean {
  return (
    evidence.conversation_request_id === attempt.conversation_request_id &&
    evidence.attempt_id === attempt.attempt_id &&
    evidence.model_file_hash === attempt.model_file_hash &&
    evidence.runtime_session_id === attempt.runtime_session_id &&
    evidence.device_id === attempt.device_id &&
    evidence.model_id.length > 0 &&
    evidence.runtime_version.length > 0 &&
    evidence.challenge_nonce.length > 0 &&
    evidence.generation_result_hash.length > 0 &&
    evidence.attested_at.length > 0
  );
}

export function reusedNonce(existing: { attempt_id: string; challenge_nonce: string }[], evidence: DeviceEvidence): boolean {
  return existing.some((row) => row.challenge_nonce === evidence.challenge_nonce && row.attempt_id !== evidence.attempt_id);
}

export function retryDecision(input: { existingKey: string | null; incomingKey: string; newUserMessage: boolean }): "return_existing" | "new_attempt" | "new_request" {
  if (input.newUserMessage) return "new_request";
  if (input.existingKey && input.existingKey === input.incomingKey) return "return_existing";
  return "new_attempt";
}
