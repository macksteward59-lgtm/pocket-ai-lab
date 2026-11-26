import { describe, expect, it } from "vitest";
import { RemoteInferenceProvider, RemoteInferenceError } from "../serverless/RemoteInferenceProvider";

function fakeFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response): typeof fetch {
  return (async (url: string, init?: RequestInit) => impl(url, init ?? {})) as unknown as typeof fetch;
}

describe("RemoteInferenceProvider", () => {
  it("stays off unless the host opts in, and still requires a baseUrl", () => {
    expect(() => new RemoteInferenceProvider({ baseUrl: "https://infer.example.com" } as never)).toThrow(/enabled/);
    expect(() => new RemoteInferenceProvider({ enabled: true, baseUrl: "" })).toThrow(/baseUrl/);
  });

  it("posts to <baseUrl>/v1/generate with the bearer token and returns the payload", async () => {
    let seenUrl = "", seenAuth = "";
    const provider = new RemoteInferenceProvider({
      enabled: true, baseUrl: "https://infer.example.com/", apiKey: "secret",
      fetchImpl: fakeFetch((url, init) => {
        seenUrl = url;
        seenAuth = (init.headers as Record<string, string>).authorization;
        return new Response(JSON.stringify({ payload: { ok: true }, evidenceRefs: ["e1"] }), { status: 200 });
      })
    });
    const result = await provider.generate({ agentId: "a", stage: "independent" as never, taskDescription: "t" } as never);
    expect(seenUrl).toBe("https://infer.example.com/v1/generate");
    expect(seenAuth).toBe("Bearer secret");
    expect(result.payload).toEqual({ ok: true });
    expect(result.evidenceRefs).toEqual(["e1"]);
    expect(result).not.toHaveProperty("authorized");
  });

  it("throws RemoteInferenceError on a non-OK response", async () => {
    const provider = new RemoteInferenceProvider({
      enabled: true, baseUrl: "https://infer.example.com",
      fetchImpl: fakeFetch(() => new Response("server error", { status: 500 }))
    });
    await expect(provider.generate({} as never)).rejects.toThrow(/returned 500/);
    let threw: unknown;
    try { await provider.generate({} as never); } catch (e) { threw = e; }
    expect(threw instanceof RemoteInferenceError).toBe(true);
  });

  it("throws when the response has no payload field", async () => {
    const provider = new RemoteInferenceProvider({
      enabled: true, baseUrl: "https://infer.example.com",
      fetchImpl: fakeFetch(() => new Response(JSON.stringify({ nope: true }), { status: 200 }))
    });
    await expect(provider.generate({} as never)).rejects.toThrow(/missing a payload/);
  });

  it("times out and raises RemoteInferenceError rather than hanging", async () => {
    const provider = new RemoteInferenceProvider({
      enabled: true, baseUrl: "https://infer.example.com", timeoutMs: 5,
      fetchImpl: fakeFetch((_url, init) => new Promise((_resolve, reject) => {
        // Mirrors real fetch: reject with an AbortError once the signal fires, instead of hanging forever.
        init.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      }))
    });
    await expect(provider.generate({} as never)).rejects.toThrow(/did not respond within/);
  });
});
