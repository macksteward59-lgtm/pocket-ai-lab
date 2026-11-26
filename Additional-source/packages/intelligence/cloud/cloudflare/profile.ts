import type { AgentProfile } from "../../agents/AgentManager";
import { SELECTED_TEXT_PURPOSES } from "../shared/selectedTextContract";

/** Logical identity is separate from the selected hosting/model provider and credentials. */
export const CLOUDFLARE_AGENT_ID = "pocket-cloud-analyst";
export const CLOUDFLARE_COMPONENT_ID = "cloud-text-analysis";

export function cloudflareAgentProfile(): AgentProfile {
  return {
    id: CLOUDFLARE_AGENT_ID,
    role: "Cloud Analysis Agent",
    description: "Maintains the selected-text analysis component and returns independently approved supplemental analysis.",
    capabilities: [...SELECTED_TEXT_PURPOSES],
    permanent: true,
    permissions: []
  };
}
