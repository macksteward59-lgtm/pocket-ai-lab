import { createHash } from "node:crypto";
import type { ResearchProvider, ResearchRequest, ResearchSource } from "../../../packages/intelligence/director/DirectorCapabilities";

export interface TavilyResearchProviderOptions {
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Fixed-origin, query-only Tavily adapter. It never accepts arbitrary request URLs. */
export class TavilyResearchProvider implements ResearchProvider {
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TavilyResearchProviderOptions) {
    if (!options || typeof options.apiKey !== "string" || !options.apiKey.trim()) {
      throw new Error("A Tavily API key is required");
    }
    const timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
      throw new Error("Tavily timeout must be between 1,000 and 60,000 milliseconds");
    }
    this.apiKey = options.apiKey.trim();
    this.timeoutMs = timeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(request: ResearchRequest): Promise<ResearchSource[]> {
    if (!request || typeof request.query !== "string" || !request.query.trim() || request.query.length > 8_000) {
      throw new Error("Research query must be a non-empty string of at most 8,000 characters");
    }
    const maxResults = request.maxSources ?? 8;
    if (!Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > 20) {
      throw new Error("Research maxSources must be between 1 and 20");
    }
    const domains = request.allowedDomains;
    if (domains !== undefined && (!Array.isArray(domains) || domains.length > 30 ||
        domains.some(domain => typeof domain !== "string" || !/^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/i.test(domain)))) {
      throw new Error("Research domain allowlist is invalid");
    }

    const response = await this.fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query: request.query.trim(),
        search_depth: "basic",
        max_results: maxResults,
        include_answer: false,
        ...(domains && domains.length > 0 ? { include_domains: [...domains] } : {})
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error("Tavily research request failed with HTTP " + response.status);
    const advertisedBytes = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(advertisedBytes) && advertisedBytes > 1_000_000) {
      throw new Error("Tavily research response exceeds the 1 MB limit");
    }
    const responseText = await response.text();
    if (new TextEncoder().encode(responseText).byteLength > 1_000_000) {
      throw new Error("Tavily research response exceeds the 1 MB limit");
    }
    let payload: unknown;
    try { payload = JSON.parse(responseText); } catch {
      throw new Error("Tavily returned invalid JSON");
    }
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
      throw new Error("Tavily returned an invalid research response");
    }

    const retrievedAt = new Date().toISOString();
    const sources: ResearchSource[] = [];
    for (const item of payload.results.slice(0, maxResults)) {
      if (!isRecord(item) || typeof item.url !== "string" || typeof item.title !== "string" ||
          typeof item.content !== "string") continue;
      let url: URL;
      try { url = new URL(item.url); } catch { continue; }
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
      const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
      if (domains?.length && !domains.some(domain => hostname === domain.toLowerCase() ||
          hostname.endsWith("." + domain.toLowerCase()))) continue;
      const canonicalUrl = url.toString();
      sources.push({
        id: createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 24),
        title: item.title.slice(0, 500),
        url: canonicalUrl,
        excerpt: item.content.slice(0, 8_000),
        retrievedAt
      });
    }
    return sources;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
