/**
 * Static checks for the governance stack.
 * Confirms the trust placeholder is unchanged and authorized is not assigned true.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const REQUIRED = [
  "services/ai-integrator-automator/src/ai_integrator/ports/telemetry_port.py",
  "services/ai-integrator-automator/src/ai_integrator/adapters/policy_secrets.py",
  "services/ai-integrator-automator/src/ai_integrator/application/services.py",
  "packages/intelligence/security/PolicyChecker.ts",
  "packages/intelligence/security/EvidenceSynthesizer.ts",
  "packages/intelligence/security/AuditLedger.ts",
  "packages/intelligence/agents/TeamExpansionPlanner.ts",
  "packages/intelligence/agents/specialists/dynamicCatalog.ts",
  "packages/intelligence/orchestrator/governanceReview.ts",
  "scripts/desktop/TelemetryWatcher.ts",
  "scripts/desktop/governance-dashboard/index.html",
  "docs/architecture/Autonomous-Governance-Review-Framework-v1.0.md",
  "docs/implementation/governance-as-review.md",
  ".env.example"
];

const SCAN_ROOTS = [
  "services/ai-integrator-automator/src",
  "packages/intelligence/security/PolicyChecker.ts",
  "packages/intelligence/security/EvidenceSynthesizer.ts",
  "packages/intelligence/security/AuditLedger.ts",
  "packages/intelligence/security/ComplianceMapper.ts",
  "packages/intelligence/orchestrator/governanceReview.ts",
  "packages/intelligence/orchestrator/StaticAnalysisOrchestratorBridge.ts",
  "packages/intelligence/memory/ContextIngester.ts",
  "packages/intelligence/governance",
  "scripts/desktop/TelemetryWatcher.ts",
  "scripts/desktop/governance-dashboard"
];

export async function verifyGovernanceStack(root) {
  const failures = [];
  for (const relative of REQUIRED) {
    try {
      await stat(path.join(root, relative));
    } catch {
      failures.push("missing " + relative);
    }
  }
  const trust = await readFile(path.join(root, "packages/director/src/lib/apex/trust.ts"), "utf8");
  if (trust.trim() !== "PLACEHOLDER_TRUST_CONTENT_WILL_BE_REPLACED") {
    failures.push("packages/director/src/lib/apex/trust.ts changed");
  }
  const example = await readFile(path.join(root, ".env.example"), "utf8");
  if (!example.includes("GOVERNANCE_AUTHORIZED=false") || !/^GOVERNANCE_FERNET_KEY=\s*$/m.test(example)) {
    failures.push(".env.example must keep authorized false and an empty Fernet key");
  }
  const parser = await readFile(path.join(root, "services/ai-integrator-automator/src/ai_integrator/ports/telemetry_port.py"), "utf8");
  if (!parser.includes("defusedxml")) failures.push("Burp XML parser must use defusedxml");
  const secrets = await readFile(path.join(root, "services/ai-integrator-automator/src/ai_integrator/adapters/policy_secrets.py"), "utf8");
  if (!secrets.includes("Fernet")) failures.push("policy encryption must use Fernet");
  if (/def\s+xor_|function\s+xorEncrypt/.test(secrets)) failures.push("XOR cipher implementation is not allowed");
  const files = await collect(root, SCAN_ROOTS);
  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (/authorized\s*[:=]\s*true\b/.test(text)) failures.push("authorized true in " + path.relative(root, file));
  }
  return { ok: failures.length === 0, failures };
}

async function collect(root, relatives) {
  const found = [];
  for (const relative of relatives) await walk(path.join(root, relative), found);
  return found;
}

async function walk(target, found) {
  const { readdir } = await import("node:fs/promises");
  const info = await stat(target);
  if (info.isFile()) {
    if (/\.(py|ts|js|mjs)$/.test(target)) found.push(target);
    return;
  }
  const entries = await readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    await walk(path.join(target, entry.name), found);
  }
}

if (process.argv[1]?.endsWith("verify-governance-stack.mjs")) {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
  verifyGovernanceStack(root).then(result => {
    if (!result.ok) {
      for (const failure of result.failures) console.error(failure);
      process.exitCode = 1;
      return;
    }
    console.log("governance stack verified; authorized stays false");
  }).catch(error => {
    console.error(error instanceof Error ? error.message : "verify failed");
    process.exitCode = 1;
  });
}
