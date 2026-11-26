/**
 * Default skill catalog: Layers 1-5 of the Agency Security Skills matrix.
 * Data only. Each entry names a capability and the topics it covers; none of
 * it grants tool access. Lab-only skills may be exercised only inside the
 * isolated research environment, and every tool request still goes through
 * the delegation gate.
 */
import { SkillRegistry, type Ecosystem, type Skill, type SkillLayer } from "./SkillRegistry";
import type { SecuritySpecialistId } from "../agents/AgentManager";

type Opts = { core?: string[]; eco?: Ecosystem; lab?: boolean };

const skill = (
  layer: SkillLayer,
  id: string,
  title: string,
  knowledge: string[],
  specialists: SecuritySpecialistId[],
  opts: Opts = {}
): Skill => ({
  id, layer, title, knowledge, specialists,
  coreAgents: opts.core ?? [],
  ecosystem: opts.eco ?? "general",
  labOnly: opts.lab ?? false
});

const MS: Opts = { eco: "microsoft" };
const LAB: Opts = { lab: true };

export const SKILL_CATALOG: Skill[] = [
  // Layer 1: core foundations
  skill(1, "network-fundamentals", "Networking fundamentals", ["DNS", "TCP/IP", "TLS/SSL", "SMB", "RPC", "Kerberos"], ["network-protocols"]),
  skill(1, "protocol-conformance-review", "Protocol conformance review", ["Protocol conformance review"], ["network-protocols"]),
  skill(1, "tls-fingerprinting", "TLS fingerprinting", ["TLS/SSL fingerprinting"], ["network-protocols"]),
  skill(1, "operating-system-fundamentals", "Operating system fundamentals", ["Windows", "Linux", "processes", "memory", "permissions"], ["windows-internals"], { core: ["security"] }),
  skill(1, "programming-foundations", "Programming foundations", ["C", "C++", "C#", "Python", "JavaScript", "TypeScript"], ["reverse-engineering"], { core: ["engineer"] }),
  skill(1, "automation-foundations", "Automation", ["PowerShell", "Python scripting", "testing automation"], [], { core: ["engineer"] }),
  skill(1, "development-practices", "Development practices", ["Git", "debugging", "APIs", "source-code analysis"], [], { core: ["engineer"] }),
  skill(1, "security-fundamentals", "Security fundamentals", ["authentication", "authorization", "encryption", "threat modeling"], ["identity-security"], { core: ["security"] }),

  // Layer 2: cloud and enterprise security
  skill(2, "azure-architecture", "Azure architecture", ["Microsoft Azure architecture"], ["microsoft-cloud"], MS),
  skill(2, "entra-id-assessment", "Entra ID assessment", ["Microsoft Entra ID"], ["microsoft-cloud", "identity-security"], MS),
  skill(2, "azure-arm", "Azure Resource Manager", ["Azure Resource Manager"], ["microsoft-cloud"], MS),
  skill(2, "m365-security", "Microsoft 365 security", ["Microsoft 365"], ["microsoft-cloud"], MS),
  skill(2, "oauth-analysis", "OAuth 2.0 analysis", ["OAuth 2.0"], ["identity-security"]),
  skill(2, "oidc-analysis", "OpenID Connect analysis", ["OpenID Connect"], ["identity-security"]),
  skill(2, "saml-assessment", "SAML assessment", ["SAML"], ["identity-security"]),
  skill(2, "jwt-verification", "JWT security", ["JWT security"], ["identity-security"]),
  skill(2, "iam-review", "Identity and access management review", ["Identity and Access Management"], ["identity-security", "microsoft-cloud"]),
  skill(2, "cloud-data-store-security", "Cloud data store security", ["Azure storage security", "Cosmos DB security"], ["microsoft-cloud"], MS),
  skill(2, "api-security", "API and web vulnerability classes", ["REST and GraphQL API security", "OWASP Top 10", "SSRF", "IDOR"], ["identity-security", "microsoft-cloud"]),
  skill(2, "tenant-isolation", "Cross-tenant isolation", ["Cross-tenant isolation"], ["microsoft-cloud"], MS),
  skill(2, "cloud-privilege-escalation-analysis", "Cloud privilege escalation analysis", ["Cloud privilege escalation"], ["microsoft-cloud"], MS),

  // Layer 3: Windows and operating system security
  skill(3, "windows-internals-knowledge", "Windows internals", ["Windows internals", "Windows Registry", "Process and thread architecture"], ["windows-internals"], MS),
  skill(3, "token-architecture-research", "Access token architecture", ["Handles and access tokens"], ["windows-internals"], MS),
  skill(3, "windows-authentication-review", "Windows authentication review", ["LSASS security", "Windows authentication"], ["windows-internals"], MS),
  skill(3, "kernel-analysis", "Kernel and memory architecture", ["Kernel-mode architecture", "User-mode architecture", "Windows memory management"], ["windows-internals"], MS),
  skill(3, "windows-driver-analysis", "Windows driver analysis", ["Windows drivers"], ["windows-internals"], MS),
  skill(3, "hyperv-isolation-research", "Hyper-V and virtualization isolation", ["Hyper-V", "Virtualization isolation"], ["windows-internals"], { eco: "microsoft", lab: true }),
  skill(3, "reverse-engineering-foundations", "Reverse engineering", ["Reverse engineering"], ["reverse-engineering"]),
  skill(3, "binary-static-analysis", "Binary and static analysis", ["Binary analysis", "Static analysis"], ["reverse-engineering"]),
  skill(3, "assembly-review", "C/C++ and assembly review", ["C/C++ and assembly"], ["reverse-engineering"]),

  // Layer 4: reverse engineering and vulnerability research (isolated, authorized environments only)
  skill(4, "analysis-tooling", "Analysis tooling proficiency", ["Ghidra", "IDA Pro", "Radare2", "WinDbg", "Sysinternals"], ["reverse-engineering", "windows-internals"]),
  skill(4, "dynamic-analysis", "Dynamic analysis and debugging", ["Dynamic analysis", "Debugging"], ["reverse-engineering", "windows-internals"], LAB),
  skill(4, "memory-corruption-research", "Memory corruption research", ["Memory corruption research"], ["reverse-engineering"], LAB),
  skill(4, "vulnerability-reproduction", "Vulnerability reproduction", ["Vulnerability reproduction"], ["reverse-engineering"], { core: ["validator"], lab: true }),
  skill(4, "fuzzing", "Fuzzing", ["Fuzzing"], ["reverse-engineering"], LAB),
  skill(4, "exploit-mitigation-analysis", "Exploit mitigation analysis", ["Exploit mitigation analysis", "ASLR, DEP and CFG"], ["reverse-engineering", "windows-internals"], { eco: "microsoft", lab: true }),
  skill(4, "appcontainer-isolation", "AppContainer isolation", ["AppContainer isolation"], ["windows-internals"], { eco: "microsoft", lab: true }),

  // Layer 5: artificial intelligence and application security
  skill(5, "prompt-injection-defense", "LLM security and prompt-injection defense", ["LLM security", "Prompt injection"], ["ai-security"]),
  skill(5, "indirect-prompt-injection-analysis", "Indirect prompt-injection analysis", ["Indirect prompt injection"], ["ai-security"]),
  skill(5, "rag-leakage-prevention", "RAG and data-leakage prevention", ["Retrieval-Augmented Generation", "AI data leakage"], ["ai-security"]),
  skill(5, "model-supply-chain-security", "Model, plugin and connector security", ["Training data poisoning", "Model and plugin security", "Third-party connector security"], ["ai-security"]),
  skill(5, "copilot-surface-review", "Copilot architecture review", ["Microsoft Copilot architecture"], ["ai-security"], MS),
  skill(5, "browser-security", "Browser security", ["Browser sandbox architecture", "Chromium security", "V8 engine security"], ["ai-security"]),
  skill(5, "web-application-security", "Web application security", ["Web application security"], ["ai-security", "identity-security"])
];

export function createDefaultSkillRegistry(): SkillRegistry {
  return new SkillRegistry(SKILL_CATALOG);
}
