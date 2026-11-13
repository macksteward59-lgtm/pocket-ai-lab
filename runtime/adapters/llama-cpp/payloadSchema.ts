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

/**
 * Upper bound on generated tokens for one agent stage. Stage payloads are
 * capped by maxLength, so anything longer is a runaway (for example an
 * endless evidenceRefs array) and should stop early instead of burning time.
 * Suggested value for the provider's agentMaxTokens option.
 */
export const LLAMA_CPP_AGENT_STAGE_MAX_TOKENS = 768;

/** Consumer chat replies can be long; the agent-stage limits stay compact. */
export const LLAMA_CPP_CHAT_ANALYSIS_MAX_LENGTH = 6000;

/**
 * JSON Schema sent to llama-server as `json_schema` when that field is supported.
 * The server may constrain decoding. Zod still validates the returned text.
 * A constraint does not make model text an authorization.
 */
export const LLAMA_CPP_STAGE_JSON_SCHEMAS: Record<LlamaCppDeliberationStage, Record<string, unknown>> = {
  independent: {
    type: "object",
    properties: {
      analysis: { type: "string", minLength: 12, maxLength: 700 }
    },
    required: ["analysis"],
    additionalProperties: false
  },
  "cross-review": {
    type: "object",
    properties: { question: { type: "string", minLength: 12, maxLength: 500 } },
    required: ["question"],
    additionalProperties: false
  },
  challenge: {
    type: "object",
    properties: {
      claim: { type: "string", minLength: 8, maxLength: 400 },
      objection: { type: "string", minLength: 12, maxLength: 600 },
      evidenceRefs: { type: "array", maxItems: 6, items: { type: "string", maxLength: 120 } }
    },
    required: ["claim", "objection"],
    additionalProperties: false
  },
  revision: {
    type: "object",
    properties: {
      // Ids first: small models otherwise paste an id into the revision text.
      addressesMessageIds: { type: "array", maxItems: 8, items: { type: "string" } },
      revision: { type: "string", minLength: 12, maxLength: 700 }
    },
    required: ["revision", "addressesMessageIds"],
    additionalProperties: false
  },
  verification: {
    type: "object",
    properties: {
      claim: { type: "string", minLength: 8, maxLength: 400 },
      verified: { type: "boolean" },
      reason: { type: "string", maxLength: 400 }
    },
    required: ["claim", "verified"],
    additionalProperties: false
  },
  synthesis: {
    type: "object",
    properties: {
      synthesis: { type: "string", minLength: 12, maxLength: 1600 },
      evidenceRefs: { type: "array", maxItems: 8, items: { type: "string", maxLength: 120 } }
    },
    required: ["synthesis", "evidenceRefs"],
    additionalProperties: false
  }
};

/**
 * Specialized advisory policy-review payload. The adapter validates the
 * envelope; the review coordinator independently validates every finding
 * against the immutable policy snapshot and exact source offsets.
 */
const POLICY_REVIEW_FINDING_CODES = [
  "omitted-condition",
  "misclassified-clause",
  "ambiguous-permission",
  "conflicting-policy",
  "unsupported-value",
  "evidence-mismatch",
  "other"
] as const;
const POLICY_REVIEW_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

export const LLAMA_CPP_POLICY_REVIEW_PAYLOAD_SCHEMA = z.object({
  summary: z.string().min(1).max(4000),
  findings: z.array(z.object({
    code: z.enum(POLICY_REVIEW_FINDING_CODES),
    severity: z.enum(POLICY_REVIEW_SEVERITIES),
    clauseId: z.string().optional(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
    sourceText: z.string().min(1),
    explanation: z.string().min(1).max(2000)
  }).strict()).max(100)
}).strict();

export const LLAMA_CPP_POLICY_REVIEW_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 4000 },
    findings: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        properties: {
          code: { type: "string", enum: POLICY_REVIEW_FINDING_CODES },
          severity: { type: "string", enum: POLICY_REVIEW_SEVERITIES },
          clauseId: { type: "string" },
          startOffset: { type: "integer", minimum: 0 },
          endOffset: { type: "integer", minimum: 1 },
          sourceText: { type: "string", minLength: 1 },
          explanation: { type: "string", minLength: 1, maxLength: 2000 }
        },
        required: ["code", "severity", "startOffset", "endOffset", "sourceText", "explanation"],
        additionalProperties: false
      }
    }
  },
  required: ["summary", "findings"],
  additionalProperties: false
};
