/**
 * Security task routing.
 *
 * Pure and side-effect free: maps untrusted task text to candidate specialist
 * template ids plus risk signals. It never creates agents, grants permissions,
 * or authorizes anything. Task text is treated as untrusted input, so the only
 * thing this module can do with it is *add* friction (flag a task as
 * operational); nothing in the text can lower a flag or widen a result.
 */
import { SECURITY_SPECIALIST_IDS, type SecuritySpecialistId } from "../agents/AgentManager";

/** Term weight: 3 = strong domain signal, 2 = moderate, 1 = ambiguous/weak. */
interface Term { term: string; weight: 1 | 2 | 3 }

const t = (weight: 1 | 2 | 3, ...terms: string[]): Term[] => terms.map(term => ({ term, weight }));

const ROUTING_TERMS: Record<SecuritySpecialistId, Term[]> = {
  "microsoft-cloud": [
    ...t(3, "entra id", "entra", "entraid", "azure", "azure ad", "arm template", "microsoft 365", "m365", "office 365", "conditional access", "managed identity", "key vault"),
    ...t(2, "tenant", "service principal", "rbac", "intune", "defender for cloud", "subscription"),
    ...t(1, "cloud", "microsoft")
  ],
  "identity-security": [
    ...t(3, "jwt", "oauth", "oauth2", "oidc", "openid connect", "saml", "sso", "single sign on"),
    ...t(2, "access token", "refresh token", "id token", "claims", "identity provider", "idp", "iam", "mfa", "authentication flow"),
    ...t(1, "token", "login", "session", "identity")
  ],
  "windows-internals": [
    ...t(3, "windows internals", "windows kernel", "lsass", "credential guard", "token architecture", "etw"),
    ...t(2, "kernel", "driver", "process architecture", "integrity level", "wdac", "applocker"),
    ...t(1, "windows", "win32", "registry")
  ],
  "reverse-engineering": [
    ...t(3, "reverse engineering", "disassembly", "decompile", "decompilation", "ghidra", "ida pro", "static analysis"),
    ...t(2, "binary", "assembly", "firmware", "pe file", "elf", "malware analysis"),
    ...t(1, "reverse", "symbols")
  ],
  "ai-security": [
    ...t(3, "prompt injection", "indirect prompt injection", "copilot", "rag", "retrieval augmented generation", "jailbreak", "llm security"),
    ...t(2, "llm", "guardrails", "vector store", "embedding", "model poisoning", "data leakage"),
    ...t(1, "ai", "prompt", "model", "agent")
  ],
  "network-protocols": [
    ...t(3, "kerberos", "smb", "ntlm", "tls", "rpc", "dns", "ldap", "dcerpc"),
    ...t(2, "packet capture", "pcap", "wireshark", "tshark", "handshake", "certificate", "network protocol", "netlogon"),
    ...t(1, "network", "traffic", "protocol")
  ]
};

/**
 * Action-oriented phrases that suggest the task asks to *do* something to a
 * target rather than analyze it. Deliberately limited to actions; topic terms
 * like "privilege escalation" or "lateral movement" appear constantly in
 * defensive work and are only noted, not escalated.
 */
const OPERATIONAL_SIGNALS = [
  "exploit", "weaponize", "weaponise", "payload", "exfiltrate", "exfiltration",
  "dump credentials", "dump hashes", "pass the hash", "brute force", "bruteforce",
  "phish", "ransomware", "c2", "command and control", "backdoor", "attack"
];
const SENSITIVE_TOPICS = ["privilege escalation", "lateral movement", "credential theft", "persistence", "token theft"];

export type TaskIntent = "analysis" | "operational";

export interface SpecialistMatch {
  id: SecuritySpecialistId;
  score: number;
  /** 0..1, saturating at a score of 6 (e.g. two strong terms). */
  confidence: number;
  matchedTerms: string[];
}

export interface SecurityRoute {
  matches: SpecialistMatch[];
  /** True when nothing cleared the threshold; callers should use the core "security" agent. */
  fallbackToCore: boolean;
  intent: TaskIntent;
  operationalSignals: string[];
  sensitiveTopics: string[];
}

export interface RouteOptions {
  /** Minimum total score for a specialist to be considered. Default 2. */
  minScore?: number;
  /** Maximum specialists returned. Default 3. */
  maxSpecialists?: number;
  /**
   * A lower-ranked specialist must score at least this fraction of the top
   * score to be included. Default 0.4. Prevents padding a team with a weak
   * second match when one domain clearly dominates.
   */
  relativeCutoff?: number;
}

/** Lowercases and collapses everything non-alphanumeric to single spaces, padded for whole-word search. */
function normalize(text: string): string {
  return " " + text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
}

function containsTerm(padded: string, term: string): boolean {
  const normalizedTerm = normalize(term).trim();
  // Whole-word match, tolerating a simple plural ("tokens", "tenants").
  return padded.includes(" " + normalizedTerm + " ") || padded.includes(" " + normalizedTerm + "s ");
}

export function routeSecurityTask(taskDescription: string, options: RouteOptions = {}): SecurityRoute {
  const minScore = options.minScore ?? 2;
  const maxSpecialists = Math.max(1, options.maxSpecialists ?? 3);
  const relativeCutoff = options.relativeCutoff ?? 0.4;
  const padded = normalize(String(taskDescription ?? ""));

  const scored: SpecialistMatch[] = SECURITY_SPECIALIST_IDS.map(id => {
    const matchedTerms: string[] = [];
    let score = 0;
    for (const { term, weight } of ROUTING_TERMS[id]) {
      if (containsTerm(padded, term)) {
        matchedTerms.push(term);
        score += weight;
      }
    }
    return { id, score, confidence: Math.min(1, score / 6), matchedTerms };
  });

  const qualifying = scored
    .filter(match => match.score >= minScore)
    // Stable sort: ties keep template declaration order.
    .sort((a, b) => b.score - a.score);
  const topScore = qualifying[0]?.score ?? 0;
  const matches = qualifying
    .filter(match => match.score >= topScore * relativeCutoff)
    .slice(0, maxSpecialists);

  const operationalSignals = OPERATIONAL_SIGNALS.filter(signal => containsTerm(padded, signal));
  const sensitiveTopics = SENSITIVE_TOPICS.filter(topic => containsTerm(padded, topic));

  return {
    matches,
    fallbackToCore: matches.length === 0,
    intent: operationalSignals.length > 0 ? "operational" : "analysis",
    operationalSignals,
    sensitiveTopics
  };
}
