/**
 * Stage payload schemas mirrored from codex/gate-0-1-agent-engine
 * (PR #1 tip 449f4ab9bf31486f62e34c39f67f8f09a9a79724) MessageBus PayloadSchemas.
 *
 * The orchestrator on that branch maps:
 *   independent   -> analysis
 *   cross-review  -> question
 *   challenge     -> counterargument
 *   revision      -> revision
 *   verification  -> validation
 *   synthesis     -> completion
 *
 * This module does not import MessageBus, so the adapter does not drift onto
 * main's looser schemas and does not edit the shared contract. Model output
 * that fails the schema is rejected. Nothing is filled in except the schema's
 * own default empty evidenceRefs array on a challenge payload.
 */

import { z } from "zod";

export const LLAMA_CPP_STAGE_PAYLOAD_SCHEMAS = {
  independent: z.object({
    analysis: z.string().min(1),
    confidence: z.number().min(0).max(1).optional()
  }).strict(),
  "cross-review": z.object({
    question: z.string().min(1)
  }).strict(),
  challenge: z.object({
    claim: z.string().min(1),
    objection: z.string().min(1),
    evidenceRefs: z.array(z.string()).default([])
  }).strict(),
  revision: z.object({
    revision: z.string().min(1),
    addressesMessageIds: z.array(z.string().uuid())
  }).strict(),
  verification: z.object({
    claim: z.string().min(1),
    verified: z.boolean(),
    reason: z.string().optional()
  }).strict(),
  synthesis: z.object({
    synthesis: z.string().min(1),
    evidenceRefs: z.array(z.string())
  }).strict()
} as const;

export type LlamaCppDeliberationStage = keyof typeof LLAMA_CPP_STAGE_PAYLOAD_SCHEMAS;

export const LLAMA_CPP_STAGE_HINTS: Record<LlamaCppDeliberationStage, string> = {
  independent: 'Required JSON object: {"analysis": string, "confidence"?: number from 0 through 1}',
  "cross-review": 'Required JSON object: {"question": string}',
  challenge: 'Required JSON object: {"claim": string, "objection": string, "evidenceRefs"?: string[]}',
  revision: 'Required JSON object: {"revision": string, "addressesMessageIds": string[] of uuids}',
  verification: 'Required JSON object: {"claim": string, "verified": boolean, "reason"?: string}',
  synthesis: 'Required JSON object: {"synthesis": string, "evidenceRefs": string[]}'
};

export function isLlamaCppDeliberationStage(stage: string): stage is LlamaCppDeliberationStage {
  return Object.prototype.hasOwnProperty.call(LLAMA_CPP_STAGE_PAYLOAD_SCHEMAS, stage);
}
