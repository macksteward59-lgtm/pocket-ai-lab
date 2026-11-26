import { describe, expect, it, vi } from "vitest";
import { TavilyResearchProvider } from "./TavilyResearchProvider";

describe("TavilyResearchProvider", () => {
  it("uses the fixed search endpoint and returns validated, bounded sources", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      results: [
        { title: "Allowed", url: "https://docs.example.com/page", content: "Useful result" },
        { title: "Not allowed", url: "https://other.test/page", content: "Outside allowlist" },
        { title: "Unsafe", url: "javascript:alert(1)", content: "Unsafe scheme" }
      ]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new TavilyResearchProvider({ apiKey: "test-key", fetchImpl });
    const result = await provider.search({ query: "  director runtime  ", maxSources: 3, allowedDomains: ["example.com"] });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.tavily.com/search");
    expect(fetchImpl.mock.calls[0][1]?.redirect).toBe("error");
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ api_key: "test-key", query: "director runtime", max_results: 3, include_domains: ["example.com"] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: "Allowed", url: "https://docs.example.com/page", excerpt: "Useful result" });
    expect(result[0].retrievedAt).toBeTruthy();
  });

  it("rejects invalid requests and failed provider responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("unavailable", { status: 503 }));
    const provider = new TavilyResearchProvider({ apiKey: "test-key", fetchImpl });
    await expect(provider.search({ query: "   " })).rejects.toThrow(/query/);
    await expect(provider.search({ query: "valid" })).rejects.toThrow(/HTTP 503/);
  });

  it("stops a chunked response as soon as the 1 MB limit is exceeded", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700_000));
        controller.enqueue(new Uint8Array(300_001));
      }
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, { status: 200 }));
    const provider = new TavilyResearchProvider({ apiKey: "test-key", fetchImpl });

    await expect(provider.search({ query: "bounded response" })).rejects.toThrow(/1 MB limit/);
    expect(fetchImpl.mock.calls[0][1]?.redirect).toBe("error");
  });
});
