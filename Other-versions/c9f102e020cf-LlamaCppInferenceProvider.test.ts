import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import type { InferenceProvider, InferenceRequest } from "../../../packages/intelligence/orchestrator/Orchestrator";
import type { LlamaCppBackend } from "./backend";
import { LLAMA_CPP_DEFAULTS } from "./config";
import { LlamaCppInferenceError } from "./errors";
import {
  createLlamaCppInferenceProvider,
  LLAMA_CPP_PROVIDER_ID,
  LlamaCppInferenceProvider,
  registerLlamaCppInferenceProvider
} from "./index";

const REVISION_ID = "00000000-0000-4000-8000-00000000000a";

type Pr1InferenceProvider = {
  generate(request: {
    agentId: string;
    modelId: string;
    prompt: string;
    stage: "independent" | "cross-review" | "challenge" | "revision" | "verification" | "synthesis";
    contextMessages: InferenceRequest["contextMessages"];
  }): Promise<{ payload: unknown; evidenceRefs?: string[] }>;
};

function baseRequest(overrides: Partial<InferenceRequest> = {}): InferenceRequest {
  return {
    agentId: "reasoner",
    modelId: "registry-model",
    prompt: "Explain the trust boundary in one sentence.",
    stage: "independent",
    contextMessages: [{
      messageId: "00000000-0000-4000-8000-000000000001",
      taskId: "task-1",
      conversationId: "task-1",
      senderAgentId: "critic",
      recipientAgentId: "broadcast",
      messageType: "counterargument",
      payload: { claim: "boundary", objection: "too vague", evidenceRefs: [] },
      evidenceRefs: [],
      createdAt: "2026-11-02T08:35:00.000Z",
      sequence: 0
    }],
    ...overrides
  };
}

function stubBackend(content: string | ((params: { prompt: string; model: string }) => string)): {
  backend: LlamaCppBackend;
  calls: Array<{ prompt: string; model: string; temperature: number; maxTokens: number; stop?: readonly string[]; seed?: number }>;
} {
  const calls: Array<{ prompt: string; model: string; temperature: number; maxTokens: number; stop?: readonly string[]; seed?: number }> = [];
  return {
    calls,
    backend: {
      async complete(params, signal) {
        if (signal.aborted) {
          throw signal.reason instanceof Error
            ? signal.reason
            : new DOMException("aborted", "AbortError");
        }
        calls.push(params);
        const text = typeof content === "function" ? content(params) : content;
        return { content: text };
      },
      async health(signal) {
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
      }
    }
  };
}

interface CapturedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

async function withServer(
  handler: (captured: CapturedRequest, response: ServerResponse) => void | Promise<void>,
  run: (baseUrl: string, captured: CapturedRequest[]) => Promise<void>
): Promise<void> {
  const captured: CapturedRequest[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const record: CapturedRequest = {
      method: request.method ?? "",
      url: request.url ?? "",
      headers: request.headers,
      body: Buffer.concat(chunks).toString("utf8")
    };
    captured.push(record);
    await handler(record, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`, captured);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

function send(response: ServerResponse, status: number, body: string, contentType = "application/json"): void {
  response.writeHead(status, { "content-type": contentType, "content-length": Buffer.byteLength(body) });
  response.end(body);
}

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  return port;
}

describe("llama.cpp config", () => {
  it("applies loopback defaults", () => {
    const provider = createLlamaCppInferenceProvider();
    expect(provider.config).toMatchObject({
      baseUrl: LLAMA_CPP_DEFAULTS.baseUrl,
      timeoutMs: 120_000,
      temperature: 0.2,
      maxTokens: 1024,
      api: "completion"
    });
    expect(provider.config.modelAlias).toBeUndefined();
    expect(provider.config.seed).toBeUndefined();
    expect(provider.config.stop).toBeUndefined();
  });

  it("copies caller arrays and accepts a normalized base URL", () => {
    const stop = ["END"];
    const provider = createLlamaCppInferenceProvider({
      baseUrl: "http://127.0.0.1:8081/",
      modelAlias: " local-gguf ",
      timeoutMs: 5000,
      temperature: 0,
      maxTokens: 32,
      stop,
      seed: 7,
      api: "openai-chat"
    });
    stop.push("MUTATED");
    expect(provider.config).toMatchObject({
      baseUrl: "http://127.0.0.1:8081",
      modelAlias: "local-gguf",
      timeoutMs: 5000,
      temperature: 0,
      maxTokens: 32,
      seed: 7,
      api: "openai-chat"
    });
    expect(provider.config.stop).toEqual(["END"]);
    expect(Object.isFrozen(provider.config)).toBe(true);
  });

  it.each([
    [{ baseUrl: "ftp://127.0.0.1:8080" }, /http or https/],
    [{ baseUrl: "not a url" }, /not a valid URL/],
    [{ baseUrl: "" }, /not a valid URL/],
    [{ modelAlias: "  " }, /modelAlias/],
    [{ timeoutMs: 0 }, /timeoutMs/],
    [{ timeoutMs: 1.5 }, /timeoutMs/],
    [{ temperature: -0.1 }, /temperature/],
    [{ temperature: 2.1 }, /temperature/],
    [{ temperature: Number.NaN }, /temperature/],
    [{ maxTokens: 0 }, /maxTokens/],
    [{ maxTokens: 1.2 }, /maxTokens/],
    [{ seed: -1 }, /seed/],
    [{ seed: 1.2 }, /seed/],
    [{ api: "chat" as never }, /api must be/],
    [{ stop: "END" as never }, /stop must be an array/],
    [{ stop: [""] }, /stop\[0\]/]
  ])("rejects invalid config %j", (input, pattern) => {
    expect(() => createLlamaCppInferenceProvider(input)).toThrow(LlamaCppInferenceError);
    try {
      createLlamaCppInferenceProvider(input);
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_config" });
      expect((error as Error).message).toMatch(pattern);
    }
  });
});

describe("llama.cpp registration", () => {
  it("is assignable to the main and PR #1 provider contracts", () => {
    const provider = createLlamaCppInferenceProvider();
    const onMain: InferenceProvider = provider;
    const onPr1: Pr1InferenceProvider = provider;
    expect(onMain).toBe(provider);
    expect(onPr1).toBe(provider);
  });

  it("registers a factory without the orchestrator importing the adapter", () => {
    const factories = new Map<string, () => InferenceProvider>();
    registerLlamaCppInferenceProvider({
      register(id, factory) {
        factories.set(id, factory);
      }
    }, { temperature: 0.4 });
    const created = factories.get(LLAMA_CPP_PROVIDER_ID)?.();
    expect(created).toBeInstanceOf(LlamaCppInferenceProvider);
    expect((created as LlamaCppInferenceProvider).config.temperature).toBe(0.4);
  });
});

describe("llama.cpp generation with a stub backend", () => {
  const stages: Array<{ stage: InferenceRequest["stage"]; payload: Record<string, unknown> }> = [
    { stage: "independent", payload: { analysis: "Distinct roles remain.", confidence: 0.25 } },
    { stage: "cross-review", payload: { question: "Which boundary is enforced?" } },
    {
      stage: "challenge",
      payload: { claim: "It holds", objection: "Receipt semantics are unclear", evidenceRefs: ["ref-1"] }
    },
    {
      stage: "revision",
      payload: { revision: "Receipts stay independent.", addressesMessageIds: [REVISION_ID] }
    },
    {
      stage: "verification",
      payload: { claim: "No self-approval", verified: false, reason: "Validator has not signed" }
    },
    {
      stage: "synthesis",
      payload: { synthesis: "Agents propose; APEX authorizes.", evidenceRefs: ["ref-2"] }
    }
  ];

  it.each(stages)("parses a $stage payload without rewriting the backend text", async ({ stage, payload }) => {
    const raw = JSON.stringify(payload);
    const { backend, calls } = stubBackend(raw);
    const provider = createLlamaCppInferenceProvider({ temperature: 0.3, maxTokens: 64, seed: 3, stop: ["END"] }, backend);
    const result = await provider.generate(baseRequest({ stage }));
    expect(result.text).toBe(raw);
    expect(result.payload).toEqual(payload);
    if (Array.isArray(payload.evidenceRefs)) {
      expect(result.evidenceRefs).toEqual(payload.evidenceRefs);
    }
    if (typeof payload.confidence === "number") {
      expect(result.confidence).toBe(payload.confidence);
    }
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.payload)).toBe(true);
    expect(calls[0]?.prompt).toContain("Explain the trust boundary in one sentence.");
    expect(calls[0]?.prompt).toContain("too vague");
    expect(calls[0]?.prompt).toContain("not permission, approval, or an authorization receipt");
    expect(calls[0]?.prompt).toContain(`Stage: ${stage}`);
    expect(calls[0]?.model).toBe("registry-model");
    expect(calls[0]?.temperature).toBe(0.3);
    expect(calls[0]?.maxTokens).toBe(64);
    expect(calls[0]?.seed).toBe(3);
    expect(calls[0]?.stop).toEqual(["END"]);
  });

  it("keeps a negative validation flag instead of treating it as success or failure", async () => {
    const raw = JSON.stringify({ claim: "unchecked", verified: false });
    const { backend } = stubBackend(raw);
    const result = await createLlamaCppInferenceProvider({}, backend).generate(baseRequest({
      stage: "verification",
      agentId: "validator"
    }));
    expect(result.payload).toEqual({ claim: "unchecked", verified: false });
    expect(result.text).toBe(raw);
  });

  it("unwraps one json fence and copies confidence only when the model sent it", async () => {
    const raw = "```json\n{\"analysis\":\"fenced\"}\n```";
    const { backend } = stubBackend(raw);
    const result = await createLlamaCppInferenceProvider({}, backend).generate(baseRequest());
    expect(result.text).toBe(raw);
    expect(result.payload).toEqual({ analysis: "fenced" });
    expect("confidence" in result).toBe(false);
    expect("evidenceRefs" in result).toBe(false);
  });

  it("applies the challenge schema default for omitted evidence refs", async () => {
    const raw = JSON.stringify({ claim: "claim", objection: "objection" });
    const { backend } = stubBackend(raw);
    const result = await createLlamaCppInferenceProvider({}, backend).generate(baseRequest({ stage: "challenge" }));
    expect(result.payload).toEqual({ claim: "claim", objection: "objection", evidenceRefs: [] });
    expect(result.evidenceRefs).toEqual([]);
  });

  it("uses the configured model alias on the backend call", async () => {
    const { backend, calls } = stubBackend(JSON.stringify({ analysis: "alias path" }));
    await createLlamaCppInferenceProvider({ modelAlias: "gguf-alias" }, backend).generate(baseRequest());
    expect(calls[0]?.model).toBe("gguf-alias");
    expect(calls[0]?.prompt).toContain("Registry model id: registry-model");
    expect(calls[0]?.prompt).toContain("Server model alias: gguf-alias");
  });

  it.each([
    ["", "empty_output"],
    ["   \n", "empty_output"],
    ["not json", "malformed_response"],
    ["[]", "malformed_response"],
    ["null", "malformed_response"],
    [JSON.stringify(JSON.stringify({ analysis: "x" })), "malformed_response"],
    [JSON.stringify({ question: "wrong shape" }), "malformed_response"],
    [JSON.stringify({ analysis: "ok", extra: true }), "malformed_response"],
    [JSON.stringify({ analysis: "" }), "malformed_response"],
    [JSON.stringify({ revision: "updated", addressesMessageIds: ["not-a-uuid"] }), "malformed_response"]
  ])("rejects %j as %s and does not return a result", async (content, code) => {
    const stage = content.includes("addressesMessageIds") ? "revision" : "independent";
    const { backend } = stubBackend(content);
    const provider = createLlamaCppInferenceProvider({}, backend);
    await expect(provider.generate(baseRequest({ stage }))).rejects.toMatchObject({
      name: "LlamaCppInferenceError",
      code
    });
  });

  it("does not coerce an out-of-range confidence or a string verification flag", async () => {
    const providerFor = (content: string) =>
      createLlamaCppInferenceProvider({}, stubBackend(content).backend);
    await expect(providerFor(JSON.stringify({ analysis: "ok", confidence: 1.5 })).generate(baseRequest()))
      .rejects.toMatchObject({ code: "malformed_response" });
    await expect(providerFor(JSON.stringify({ claim: "x", verified: "true" })).generate(baseRequest({
      stage: "verification",
      agentId: "validator"
    }))).rejects.toMatchObject({ code: "malformed_response" });
  });

  it("does not call the backend for an invalid request or a pre-cancelled call", async () => {
    const { backend, calls } = stubBackend(JSON.stringify({ analysis: "unused" }));
    const provider = createLlamaCppInferenceProvider({}, backend);
    await expect(provider.generate(baseRequest({ prompt: "  " }))).rejects.toMatchObject({ code: "invalid_request" });
    await expect(provider.generate(baseRequest({ stage: "planning" }))).rejects.toMatchObject({ code: "invalid_request" });
    await expect(provider.generate({ ...baseRequest(), contextMessages: undefined as never })).rejects.toMatchObject({
      code: "invalid_request"
    });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.generate(baseRequest(), { signal: controller.signal })).rejects.toMatchObject({
      code: "cancelled"
    });
    expect(calls).toHaveLength(0);
  });

  it("classifies an abort during the backend call as cancelled", async () => {
    const backend: LlamaCppBackend = {
      async complete(_params, signal) {
        return await new Promise((_resolve, reject) => {
          const abort = () => reject(new DOMException("aborted", "AbortError"));
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      },
      async health() {}
    };
    const provider = createLlamaCppInferenceProvider({ timeoutMs: 5000 }, backend);
    const controller = new AbortController();
    const pending = provider.generate(baseRequest(), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("llama.cpp HTTP backend", () => {
  it("posts native /completion generation params and parses content", async () => {
    await withServer(async (captured, response) => {
      const request = JSON.parse(captured.body);
      expect(captured.method).toBe("POST");
      expect(captured.url).toBe("/completion");
      expect(captured.headers["content-type"]).toContain("application/json");
      expect(request).toMatchObject({
        temperature: 0.1,
        n_predict: 40,
        stream: false,
        stop: ["STOP"],
        seed: 11
      });
      expect(request.prompt).toContain("Explain the trust boundary in one sentence.");
      expect(request.prompt).toContain("too vague");
      expect(request.prompt).toContain("Agent: reasoner");
      expect(request).not.toHaveProperty("model");
      send(response, 200, JSON.stringify({
        content: JSON.stringify({ analysis: "Local model text.", confidence: 0.5 })
      }));
    }, async baseUrl => {
      const provider = createLlamaCppInferenceProvider({
        baseUrl,
        temperature: 0.1,
        maxTokens: 40,
        stop: ["STOP"],
        seed: 11
      });
      const result = await provider.generate(baseRequest());
      expect(result.text).toBe(JSON.stringify({ analysis: "Local model text.", confidence: 0.5 }));
      expect(result.payload).toEqual({ analysis: "Local model text.", confidence: 0.5 });
      expect(result.confidence).toBe(0.5);
    });
  });

  it("posts OpenAI-compatible chat completions and reads message content", async () => {
    await withServer(async (captured, response) => {
      expect(captured.url).toBe("/v1/chat/completions");
      const request = JSON.parse(captured.body);
      expect(request).toMatchObject({
        model: "gguf-alias",
        temperature: 0.2,
        max_tokens: 1024,
        stream: false
      });
      expect(request.messages).toEqual([
        { role: "user", content: expect.stringContaining("Stage: cross-review") }
      ]);
      expect(request).not.toHaveProperty("seed");
      expect(request).not.toHaveProperty("stop");
      send(response, 200, JSON.stringify({
        choices: [{ message: { role: "assistant", content: JSON.stringify({ question: "Where is the receipt?" }) } }]
      }));
    }, async baseUrl => {
      const provider = createLlamaCppInferenceProvider({ baseUrl, api: "openai-chat", modelAlias: "gguf-alias" });
      const result = await provider.generate(baseRequest({ stage: "cross-review" }));
      expect(result.payload).toEqual({ question: "Where is the receipt?" });
    });
  });

  it("uses the registry model id when no alias is configured", async () => {
    await withServer(async (captured, response) => {
      expect(JSON.parse(captured.body).model).toBe("registry-model");
      send(response, 200, JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ analysis: "routed" }) } }]
      }));
    }, async baseUrl => {
      const provider = createLlamaCppInferenceProvider({ baseUrl, api: "openai-chat" });
      const result = await provider.generate(baseRequest());
      expect(result.payload).toEqual({ analysis: "routed" });
    });
  });

  it.each([
    [500, JSON.stringify({ content: JSON.stringify({ analysis: "do not use this" }) }), "http_error"],
    [404, "{\"error\":\"missing\"}", "http_error"],
    [200, "not-json", "malformed_response"],
    [200, "{}", "malformed_response"],
    [200, JSON.stringify({ content: "" }), "empty_output"],
    [200, JSON.stringify({ content: "   " }), "empty_output"],
    [200, JSON.stringify({ content: "hello prose" }), "malformed_response"]
  ])("fails closed on HTTP %s / %s (%s)", async (status, body, code) => {
    await withServer(async (_captured, response) => {
      send(response, status, body);
    }, async baseUrl => {
      const provider = createLlamaCppInferenceProvider({ baseUrl, timeoutMs: 2000 });
      try {
        await provider.generate(baseRequest());
        throw new Error("expected inference to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(LlamaCppInferenceError);
        expect(error).toMatchObject({
          code,
          ...(code === "http_error" ? { status } : {})
        });
        expect(error).not.toHaveProperty("text");
        expect(error).not.toHaveProperty("payload");
        expect((error as Error).message).not.toContain("do not use this");
      }
    });
  });

  it("rejects an event stream instead of reading a partial token", async () => {
    await withServer(async (_captured, response) => {
      send(response, 200, "data: {\"content\":\"partial\"}\n\n", "text/event-stream");
    }, async baseUrl => {
      const provider = createLlamaCppInferenceProvider({ baseUrl });
      await expect(provider.generate(baseRequest())).rejects.toMatchObject({ code: "malformed_response" });
    });
  });

  it("rejects a chat response with no string content", async () => {
    await withServer(async (_captured, response) => {
      send(response, 200, JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "nope" }] } }] }));
    }, async baseUrl => {
      const provider = createLlamaCppInferenceProvider({ baseUrl, api: "openai-chat" });
      await expect(provider.generate(baseRequest())).rejects.toMatchObject({ code: "malformed_response" });
    });
  });

  it("times out when response headers arrive but the body never finishes", async () => {
    await withServer(async (_captured, response) => {
      response.writeHead(200, { "content-type": "application/json" });
    }, async baseUrl => {
      const provider = createLlamaCppInferenceProvider({ baseUrl, timeoutMs: 100 });
      await expect(provider.generate(baseRequest())).rejects.toMatchObject({ code: "timeout" });
    });
  });

  it("times out when the server never answers", async () => {
    await withServer(async () => {
      await new Promise(() => {});
    }, async baseUrl => {
      const provider = createLlamaCppInferenceProvider({ baseUrl, timeoutMs: 100 });
      await expect(provider.generate(baseRequest())).rejects.toMatchObject({ code: "timeout" });
    });
  });

  it("cancels an in-flight HTTP request", async () => {
    await withServer(async () => {
      await new Promise(() => {});
    }, async baseUrl => {
      const provider = createLlamaCppInferenceProvider({ baseUrl, timeoutMs: 5000 });
      const controller = new AbortController();
      const pending = provider.generate(baseRequest(), { signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    });
  });

  it("reports an unreachable backend", async () => {
    const port = await closedPort();
    const provider = createLlamaCppInferenceProvider({
      baseUrl: `http://127.0.0.1:${port}`,
      timeoutMs: 2000
    });
    await expect(provider.generate(baseRequest())).rejects.toMatchObject({ code: "backend_unreachable" });
  });

  it("accepts a healthy server and rejects a server that is not ready", async () => {
    await withServer(async (captured, response) => {
      expect(captured.method).toBe("GET");
      expect(captured.url).toBe("/health");
      send(response, 200, JSON.stringify({ status: "ok" }));
    }, async baseUrl => {
      await expect(createLlamaCppInferenceProvider({ baseUrl }).checkHealth()).resolves.toBeUndefined();
    });

    await withServer(async (_captured, response) => {
      send(response, 200, "ok", "text/plain");
    }, async baseUrl => {
      await expect(createLlamaCppInferenceProvider({ baseUrl }).checkHealth()).resolves.toBeUndefined();
    });

    await withServer(async (_captured, response) => {
      send(response, 503, JSON.stringify({ status: "loading" }));
    }, async baseUrl => {
      await expect(createLlamaCppInferenceProvider({ baseUrl }).checkHealth()).rejects.toMatchObject({
        code: "http_error",
        status: 503
      });
    });

    await withServer(async (_captured, response) => {
      send(response, 200, JSON.stringify({ status: "loading" }));
    }, async baseUrl => {
      await expect(createLlamaCppInferenceProvider({ baseUrl }).checkHealth()).rejects.toMatchObject({
        code: "malformed_response"
      });
    });

    const port = await closedPort();
    await expect(createLlamaCppInferenceProvider({
      baseUrl: `http://127.0.0.1:${port}`,
      timeoutMs: 2000
    }).checkHealth()).rejects.toMatchObject({ code: "backend_unreachable" });

    const controller = new AbortController();
    controller.abort();
    const { backend } = stubBackend("{}");
    await expect(createLlamaCppInferenceProvider({}, backend).checkHealth(controller.signal)).rejects.toMatchObject({
      code: "cancelled"
    });
  });
});

const liveBaseUrl = process.env.LLAMACPP_BASE_URL;
describe.skipIf(!liveBaseUrl)("llama.cpp live server", () => {
  it("generates an independent analysis against LLAMACPP_BASE_URL", async () => {
    const api = process.env.LLAMACPP_API === "openai-chat" ? "openai-chat" : "completion";
    const provider = createLlamaCppInferenceProvider({
      baseUrl: liveBaseUrl,
      api,
      modelAlias: process.env.LLAMACPP_MODEL,
      timeoutMs: 120_000,
      temperature: 0
    });
    await provider.checkHealth();
    const result = await provider.generate({
      agentId: "reasoner",
      modelId: process.env.LLAMACPP_MODEL || "local",
      prompt: "State that agents propose and APEX authorizes. Return only the required JSON object.",
      stage: "independent",
      contextMessages: []
    });
    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(result.payload).toMatchObject({ analysis: expect.any(String) });
  }, 130_000);
});
