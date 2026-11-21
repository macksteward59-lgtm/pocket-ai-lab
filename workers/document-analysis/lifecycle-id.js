// Keep the deployed status lookup compatible with existing Durable Object snapshots.
export function documentLifecycleID(attemptID) {
  return "cloudflare-analysis:" + attemptID;
}
