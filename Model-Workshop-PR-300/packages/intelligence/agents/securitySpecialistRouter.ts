/**
 * Backward-compatible wrapper. The routing logic now lives in
 * security/routing.ts (weighted, whole-word matching with risk signals);
 * this returns just the matching template ids.
 */
import type { SecuritySpecialistId } from "./AgentManager";
import { routeSecurityTask } from "../security/routing";

export function matchSecuritySpecialists(taskDescription: string): SecuritySpecialistId[] {
  return routeSecurityTask(taskDescription).matches.map(match => match.id);
}
