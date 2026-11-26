import { runResearchPoc } from "../packages/intelligence/research-science/ResearchPoc";
import { SYNTHETIC_TENANT_ISOLATION_FIXTURE } from "../packages/intelligence/research-science/fixtures/synthetic-tenant-isolation";

const report = runResearchPoc(SYNTHETIC_TENANT_ISOLATION_FIXTURE);
console.log(JSON.stringify(report, null, 2));
