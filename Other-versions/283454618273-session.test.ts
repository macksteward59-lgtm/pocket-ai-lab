import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import type { LlamaCppBackend } from "../adapters/llama-cpp/backend";
import { createLlamaCppInferenceProvider } from "../adapters/llama-cpp/index";
import { assertLoopbackBaseUrl, startLabServer } from "./server";
import { runLabSession } from "./session";

function contentFor(prompt: string): string {
  const stage = /Stage: ([^\n]+)/.exec(prompt)?.[1] ?? "";
  const ids = [...prompt.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi)].map(match => match[0]);
  if (stage === "independent") return JSON.stringify({ analysis: "Keep the proposal separate from permission.", confidence: 0.4 });
  if (stage === "cross-review") return JSON.stringify({ question: "Who is allowed to authorize this?" });
  if (stage === "challenge") {
    return JSON.stringify({
      claim: "The proposal is not an approval",
      objection: "A model cannot authorize its own idea",
      evidenceRefs: []
    });
  }
  if (stage === "revision") {
    return JSON.stringify({
      revision: "State that only APEX can authorize the action.",
      addressesMessageIds: ids
    });
  }
  if (stage === "verification") {
    return JSON.stringify({ claim: "Still unauthorized", verified: false, reason: "No APEX receipt was presented" });
  }
  if (stage === "synthesis") {
    return JSON.stringify({
      synthesis: "The agents proposed a boundary. Nothing was authorized.",
      evidenceRefs: []
    });
  }
  throw new Error(`unexpected stage ${stage}`);
}

function stubBackend(reply: (prompt: string) => string): LlamaCppBackend {
  return {
    async complete(params) {
      return { content: reply(params.prompt) };
    },
    async health() {}
  };
}

describe("lab session", () => {
  it("runs every deliberation stage and refuses to authorize the result", async () => {
    const provider = createLlamaCppInferenceProvider({}, stubBackend(contentFor));
    const result = await runLabSession({
      objective: "Decide whether the lab may approve its own proposal.",
      provider
    });
    expect(result.error).toBeUndefined();
    expect(result.messages.length).toBeGreaterThanOrEqual(13);
    expect(result.messages.some(message => message.messageType === "counterargument")).toBe(true);
    expect(result.messages.at(-1)?.agentId).toBe("director");
    expect(result.synthesis).toBe("The agents proposed a boundary. Nothing was authorized.");
    expect(result.engineConsensus).toBe(false);
    expect(result.authorized).toBe(false);
    expect(result.memoryVerified).toBe(false);
    expect(result.memoryId).toEqual(expect.any(String));
    expect(result.disclaimer).toMatch(/not permission/i);
  });

  it("does not invent a completion when inference fails", async () => {
    const provider = createLlamaCppInferenceProvider({}, stubBackend((prompt) => {
      if (prompt.includes("Stage: synthesis")) return "not json";
      return contentFor(prompt);
    }));
    const result = await runLabSession({ objective: "Trace a failure.", provider });
    expect(result.synthesis).toBeNull();
    expect(result.authorized).toBe(false);
    expect(result.memoryId).toBeNull();
    expect(result.error?.code).toBe("malformed_response");
    expect(result.messages.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("Synthesized result from multi-agent deliberation");
  });

  it("rejects an empty objective before calling the model", async () => {
    let calls = 0;
    const provider = createLlamaCppInferenceProvider({}, {
      async complete() {
        calls += 1;
        return { content: "{}" };
      },
      async health() {}
    });
    const result = await runLabSession({ objective: "   ", provider });
    expect(result.error?.code).toBe("invalid_request");
    expect(calls).toBe(0);
  });
});

describe("lab server", () => {
  it("rejects a non-loopback llama-server URL", () => {
    expect(() => assertLoopbackBaseUrl("http://example.com:8080")).toThrow(/this machine/);
    expect(assertLoopbackBaseUrl("http://127.0.0.1:8080/")).toBe("http://127.0.0.1:8080");
  });

  it("serves the page and a completed task from a fake llama-server", async () => {
    const llama = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString("utf8");
      if (request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "ok" }));
        return;
      }
      const prompt = JSON.parse(body).prompt as string;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ content: contentFor(prompt) }));
    });
    await new Promise<void>((resolve, reject) => {
      llama.once("error", reject);
      llama.listen(0, "127.0.0.1", () => resolve());
    });
    const llamaPort = (llama.address() as AddressInfo).port;
    const lab = await startLabServer({ port: 0 });
    try {
      const page = await fetch(lab.url);
      expect(await page.text()).toContain("Pocket AI Lab");
      const health = await fetch(`${lab.url}/api/health?baseUrl=${encodeURIComponent(`http://127.0.0.1:${llamaPort}`)}`);
      expect(health.status).toBe(200);
      const blocked = await fetch(`${lab.url}/api/health?baseUrl=${encodeURIComponent("http://example.com")}`);
      expect(blocked.status).toBe(502);
      const task = await fetch(`${lab.url}/api/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objective: "Show the trust boundary in the harness.",
          baseUrl: `http://127.0.0.1:${llamaPort}`
        })
      });
      const stream = await task.text();
      expect(stream).toContain("Nothing was authorized");
      expect(stream).toContain('"authorized":false');
    } finally {
      await lab.close();
      await new Promise<void>((resolve, reject) => llama.close(error => error ? reject(error) : resolve()));
    }
  });
});
