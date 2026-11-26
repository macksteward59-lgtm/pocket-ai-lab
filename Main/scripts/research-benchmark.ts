import { runResearchBenchmark } from "../packages/intelligence/research-science/ResearchBenchmark";
import { SYNTHETIC_TENANT_ISOLATION_FIXTURE } from "../packages/intelligence/research-science/fixtures/synthetic-tenant-isolation";
import {
  SYNTHETIC_TENANT_ISOLATION_SECURE_FIXTURE,
  SYNTHETIC_TENANT_ISOLATION_UNKNOWN_FIXTURE
} from "../packages/intelligence/research-science/fixtures/synthetic-tenant-isolation-edge-cases";

const report = runResearchBenchmark([
  { id: "vulnerable-tenant-boundary", fixture: SYNTHETIC_TENANT_ISOLATION_FIXTURE, expectedStatus: "counterexample" },
  { id: "enforced-tenant-boundary", fixture: SYNTHETIC_TENANT_ISOLATION_SECURE_FIXTURE, expectedStatus: "no-counterexample" },
  { id: "unknown-tenant-boundary", fixture: SYNTHETIC_TENANT_ISOLATION_UNKNOWN_FIXTURE, expectedStatus: "inconclusive" }
]);

process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (report.failedCases > 0) process.exitCode = 1;
