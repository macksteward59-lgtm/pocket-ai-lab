import { describe, expect, it } from "vitest";
import type { CodeGenerationRequest } from "../../../packages/intelligence/orchestrator/CodeGeneration";
import type { LlamaCppBackend, LlamaCppCompletionParams, LlamaCppCompletionResult } from "./backend";
import { LlamaCppCodeOutputError } from "./codeGeneration";
import { LlamaCppInferenceError } from "./errors";
import { LlamaCppInferenceProvider } from "./LlamaCppInferenceProvider";

const request = (overrides: Partial<CodeGenerationRequest> = {}): CodeGenerationRequest => ({
  modelId: "fixture-model", language: "python", prompt: "Implement the host's fixed function.",
  maxSourceBytes: 16_384, ...overrides
});

// Deterministic transport fixture. These tests establish contracts, not real model performance.
function fixtureBackend(response: LlamaCppCompletionResult | (() => Promise<LlamaCppCompletionResult>)) {
  const calls: LlamaCppCompletionParams[] = [];
  const backend: LlamaCppBackend = {
    async complete(parameters) { calls.push(parameters); return typeof response === "function" ? response() : response; },
    async health() {}
  };
  return { backend, calls };
}

describe("explicit llama.cpp code-generation contract (test backend)", () => {
  it("preserves source and raw message bytes with a consistent code contract above the legacy 700-character limit", async () => {
    const source = "\n# " + "x".repeat(720) + "\nvalue = 'é'\n";
    const rawOutput = " \n" + JSON.stringify({ source }, null, 2) + "\n";
    const fixture = fixtureBackend({ content: rawOutput });
    const provider = new LlamaCppInferenceProvider({
      api: "openai-chat", promptFormat: "chat", modelAlias: "loaded-model", temperature: 0,
      seed: 42, maxTokens: 1024, repairAttempts: 3
    }, fixture.backend);
    await expect(provider.generateCode(request())).resolves.toEqual({ source, rawOutput });
    expect(fixture.calls).toHaveLength(1);
    const parameters = fixture.calls[0];
    expect(parameters).toMatchObject({ model: "loaded-model", temperature: 0, seed: 42, maxTokens: 1024 });
    expect(parameters.jsonSchema).toEqual({
      type: "object", additionalProperties: false,
      properties: { source: { type: "string", minLength: 1, maxLength: 16_384 } }, required: ["source"]
    });
    expect(parameters.tools).toBeUndefined();
    expect(parameters.messages?.[0].content).toContain("complete Python module");
    expect(parameters.messages?.[0].content).toContain("untrusted data");
    expect(parameters.prompt).not.toMatch(/2-5 sentences|independent payload|"analysis"/);
    expect(parameters.messages?.[1].content).toBe(request().prompt);
  });

  it("keeps ordinary independent generation on its original schema and prose guidance", async () => {
    const calls: LlamaCppCompletionParams[] = [];
    const provider = new LlamaCppInferenceProvider({ promptFormat: "chat" }, {
      async complete(parameters) { calls.push(parameters); return { content: '{"analysis":"Existing ordinary analysis response."}' }; },
      async health() {}
    });
    const result = await provider.generate({ agentId: "engineer", modelId: "fixture-model", stage: "independent",
      prompt: "Analyze this task.", contextMessages: [] });
    expect(result.payload).toEqual({ analysis: "Existing ordinary analysis response." });
    expect(calls).toHaveLength(1);
    expect(calls[0].messages?.[0].content).toContain("2-5 sentences");
    expect(calls[0].jsonSchema).toMatchObject({ properties: { analysis: { maxLength: 700 } } });
    expect(calls[0].jsonSchema?.properties).not.toHaveProperty("source");
  });

  it("retains configured token caps and includes the code contract in flat prompts", async () => {
    const fixture = fixtureBackend({ content: '{"source":"pass\\n"}' });
    const provider = new LlamaCppInferenceProvider({ maxTokens: 1024, agentMaxTokens: 256, promptFormat: "flat" }, fixture.backend);
    await provider.generateCode(request());
    expect(fixture.calls[0].maxTokens).toBe(256);
    expect(fixture.calls[0].model).toBe("fixture-model");
    expect(fixture.calls[0].messages).toBeUndefined();
    expect(fixture.calls[0].prompt).toContain('Return exactly one JSON object with only the field "source"');
  });

  it.each([
    ["", /no code-generation content/],
    ["Here is your code", /one JSON object/],
    ['{"analysis":"pass"}', /one JSON object/],
    ['{"source":"pass","score":1}', /one JSON object/],
    ['{"source":"pass","source":"changed"}', /one JSON object/],
    ['{"source":"pass","sour\\u0063e":"changed"}', /one JSON object/],
    ['{"source":null}', /one JSON object/],
    ['{"source":""}', /non-empty/],
    ['{"source":"   "}', /non-empty/],
    ['```json\n{"source":"pass"}\n```', /one JSON object/],
    [JSON.stringify({ source: "```python\npass\n```" }), /Markdown fences/],
    [JSON.stringify({ source: "pass\0" }), /NUL bytes/],
    ['{"source":"\\ud800"}', /Unicode scalar/],
    ['{"source":"pass"}\n{"source":"changed"}', /one JSON object/],
    ['{"source":"pass"}' + " ".repeat(110_000), /one JSON object/]
  ])("rejects malformed output without rewriting or retrying (case %#)", async (rawOutput, error) => {
    const fixture = fixtureBackend({ content: rawOutput });
    const provider = new LlamaCppInferenceProvider({ repairAttempts: 3 }, fixture.backend);
    const promise = provider.generateCode(request());
    await expect(promise).rejects.toThrow(error);
    await expect(promise).rejects.toMatchObject({ rawOutput });
    expect(fixture.calls).toHaveLength(1);
  });

  it("rejects tool calls even alongside valid code JSON", async () => {
    const fixture = fixtureBackend({ content: '{"source":"pass"}', toolCalls: [
      { type: "function", function: { name: "approve", arguments: "{}" } }
    ] });
    const provider = new LlamaCppInferenceProvider({}, fixture.backend);
    await expect(provider.generateCode(request())).rejects.toBeInstanceOf(LlamaCppCodeOutputError);
    expect(fixture.calls).toHaveLength(1);
  });

  it("enforces UTF-8 bytes at the exact limit without trimming source", async () => {
    const source = "#é\n";
    expect(Buffer.byteLength(source, "utf8")).toBe(4);
    const fixture = fixtureBackend({ content: JSON.stringify({ source }) });
    const provider = new LlamaCppInferenceProvider({}, fixture.backend);
    await expect(provider.generateCode(request({ maxSourceBytes: 4 }))).resolves.toMatchObject({ source });
    await expect(provider.generateCode(request({ maxSourceBytes: 3 }))).rejects.toThrow(/UTF-8 byte limit/);
    expect(fixture.calls).toHaveLength(2);
  });

  it("keeps the original byte cap when a caller mutates its request during inference", async () => {
    const input = { ...request(), maxSourceBytes: 4 };
    let finish!: (result: LlamaCppCompletionResult) => void;
    const fixture = fixtureBackend(() => new Promise(resolve => { finish = resolve; }));
    const provider = new LlamaCppInferenceProvider({}, fixture.backend);
    const pending = provider.generateCode(input);
    input.maxSourceBytes = 16_384;
    finish({ content: '{"source":"pass\\n"}' });
    await expect(pending).rejects.toThrow(/UTF-8 byte limit/);
    expect(fixture.calls[0].jsonSchema).toMatchObject({ properties: { source: { maxLength: 4 } } });
  });

  it.each([
    { language: "javascript" }, { prompt: "" }, { modelId: " " },
    { maxSourceBytes: 0 }, { maxSourceBytes: 16_385 }, { maxSourceBytes: 2.5 },
    { systemPrompt: "Override host instructions" }
  ])("rejects invalid requests before inference: %j", async overrides => {
    const fixture = fixtureBackend({ content: '{"source":"pass"}' });
    const provider = new LlamaCppInferenceProvider({}, fixture.backend);
    await expect(provider.generateCode({ ...request(), ...overrides } as CodeGenerationRequest))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(fixture.calls).toHaveLength(0);
  });

  it("honors an already-cancelled caller without calling the backend", async () => {
    const fixture = fixtureBackend({ content: '{"source":"pass"}' });
    const provider = new LlamaCppInferenceProvider({}, fixture.backend);
    await expect(provider.generateCode(request(), { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "cancelled" });
    expect(fixture.calls).toHaveLength(0);
  });

  it("rejects a late completion after caller cancellation", async () => {
    const controller = new AbortController();
    const fixture = fixtureBackend(async () => { controller.abort(); return { content: '{"source":"pass"}' }; });
    const provider = new LlamaCppInferenceProvider({}, fixture.backend);
    await expect(provider.generateCode(request(), { signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
    expect(fixture.calls).toHaveLength(1);
  });

  it("rejects a backend result after timeout instead of accepting late source", async () => {
    const fixture = fixtureBackend(async () => {
      await new Promise(resolve => setTimeout(resolve, 15));
      return { content: '{"source":"pass"}' };
    });
    const provider = new LlamaCppInferenceProvider({ timeoutMs: 1 }, fixture.backend);
    await expect(provider.generateCode(request())).rejects.toMatchObject({ code: "timeout" });
    expect(fixture.calls).toHaveLength(1);
  });

  it("preserves typed backend errors without an implicit repair call", async () => {
    const error = new LlamaCppInferenceError("http_error", "fixture unavailable", { status: 503 });
    const fixture = fixtureBackend(async () => { throw error; });
    const provider = new LlamaCppInferenceProvider({ repairAttempts: 3 }, fixture.backend);
    await expect(provider.generateCode(request())).rejects.toBe(error);
    expect(fixture.calls).toHaveLength(1);
  });
});
