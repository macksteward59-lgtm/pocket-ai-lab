/**
 * Offline replay of fabricated scanner exports.
 * The fetch implementation never leaves this process. Hosts are example.com only.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MessageBus } from "../../packages/intelligence/message-bus/MessageBus";
import { PolicyChecker } from "../../packages/intelligence/security/PolicyChecker";
import { SourceFormat } from "../../packages/intelligence/security/reviewTypes";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");
const sidecarSrc = path.resolve(here, "../../services/ai-integrator-automator/src");

export interface SimulationCase {
  name: SourceFormat;
  in_scope: number;
  violations: number;
  state: string;
  authorized: false;
  envelope: {
    authorized: false;
    review_package: { authorized: false; findings: unknown[]; state: string };
    boundary_violations: unknown[];
    evidence_markdown: string;
  };
}

export interface SimulationReport {
  authorized: false;
  allowlist: string[];
  cases: SimulationCase[];
}

export function replayFixtures(python = "python3"): SimulationReport {
  const child = spawnSync(python, ["-m", "ai_integrator.replay", fixturesDir], {
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH: sidecarSrc + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : ""),
      GOVERNANCE_AUTHORIZED: "false"
    }
  });
  if (child.status !== 0) {
    throw new Error(child.stderr || "offline replay failed");
  }
  const report = JSON.parse(child.stdout) as SimulationReport;
  if (report.authorized !== false) throw new Error("replay must keep authorized false");
  return report;
}

export async function runOfflineSimulation(python = "python3"): Promise<SimulationReport> {
  const report = replayFixtures(python);
  if (report.allowlist.join(",") !== "app.example.com") {
    throw new Error("simulation allowlist must stay on app.example.com");
  }
  for (const item of report.cases) {
    if (item.authorized !== false || item.envelope.authorized !== false) {
      throw new Error(item.name + " set authorized");
    }
    if (item.in_scope !== 1 || item.violations !== 1 || item.state !== "REVIEW_READY") {
      throw new Error(item.name + " expected 1 in-scope finding and 1 boundary violation");
    }
    if (!item.envelope.evidence_markdown.includes("authorized: false")) {
      throw new Error(item.name + " markdown must keep authorized false");
    }
    if (item.envelope.evidence_markdown.toLowerCase().includes("payload")) {
      throw new Error(item.name + " markdown must not carry a payload");
    }
    const calls: string[] = [];
    const checker = new PolicyChecker({
      baseUrl: "http://127.0.0.1:9",
      bus: new MessageBus(),
      taskId: "simulation-" + item.name,
      fetchImpl: async request => {
        const target = String(request);
        calls.push(target);
        if (!target.startsWith("http://127.0.0.1:9/")) {
          throw new Error("simulation refused a non-loopback request: " + target);
        }
        return new Response(JSON.stringify(item.envelope), { status: 200 });
      }
    });
    const reviewed = await checker.submitTelemetryForReview({
      sourceFormat: item.name,
      content: "fixture"
    });
    if (reviewed.package.authorized !== false) throw new Error("PolicyChecker accepted an authorization");
    if (reviewed.package.findings.length !== 1) throw new Error(item.name + " PolicyChecker dropped the in-scope finding");
    if (reviewed.violations.length !== 1) throw new Error(item.name + " PolicyChecker dropped the boundary violation");
    if (calls.length !== 1) throw new Error(item.name + " contacted something other than the injected review");
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOfflineSimulation().then(report => {
    process.stdout.write("offline simulation passed; cases=" + report.cases.length + "; authorized=false\n");
  }).catch(error => {
    process.stderr.write((error instanceof Error ? error.message : "simulation failed") + "\n");
    process.exitCode = 1;
  });
}
