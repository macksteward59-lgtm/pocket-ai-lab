/**
 * Forward source text to the sidecar's static review.
 * The source is not evaluated in this process.
 */
import { PolicyCheckError, assertLoopback } from "../security/PolicyChecker";

export interface StaticAnalysisReport {
  filename: string;
  observations: Array<{ kind: string; line: number; excerpt: string; remediation: string }>;
  context: { imports: string[]; functions: string[]; classes: string[] };
  authorized: false;
  executes: false;
}

export class StaticAnalysisOrchestratorBridge {
  constructor(private readonly opts: { baseUrl: string; fetchImpl?: typeof fetch }) {}

  async analyzeSource(input: { filename: string; source: string }): Promise<StaticAnalysisReport> {
    const url = assertLoopback(this.opts.baseUrl);
    url.pathname = "/api/v1/governance/analyze-source";
    url.search = "";
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: input.filename, source: input.source })
    });
    if (!response.ok) throw new PolicyCheckError("Static analysis sidecar returned " + response.status);
    const body = await response.json() as Record<string, unknown>;
    if (body.authorized !== false || body.executes !== false) {
      throw new PolicyCheckError("Static analysis must stay non-executing and unauthorized");
    }
    const context = isRecord(body.context) ? body.context : {};
    return {
      filename: typeof body.filename === "string" ? body.filename : input.filename,
      observations: Array.isArray(body.observations) ? body.observations as StaticAnalysisReport["observations"] : [],
      context: {
        imports: stringList(context.imports),
        functions: stringList(context.functions),
        classes: stringList(context.classes)
      },
      authorized: false,
      executes: false
    };
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
