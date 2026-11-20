import type { AgentProfile } from "../../agents/AgentManager";

/** Logical identity survives worker restarts; it is not a credential or grant. */
export const GOOGLE_CLOUD_AGENT_ID = "pocket-google-cloud-analyst";
export const GOOGLE_CLOUD_COMPONENT_ID = "google-cloud-text-analysis";
export const GOOGLE_CLOUD_PURPOSES = ["documentation", "test-summary", "design-review"] as const;
export type GoogleCloudPurpose = typeof GOOGLE_CLOUD_PURPOSES[number];

/** Explicit registration is left to the existing local task owner. */
export function googleCloudAgentProfile(): AgentProfile {
  return {
    id: GOOGLE_CLOUD_AGENT_ID,
    role: "Google Cloud Analysis Agent",
    description: "Builds the text-analysis component and runs independently approved selected-text jobs for that component.",
    capabilities: [...GOOGLE_CLOUD_PURPOSES],
    permanent: true,
    permissions: []
  };
}
