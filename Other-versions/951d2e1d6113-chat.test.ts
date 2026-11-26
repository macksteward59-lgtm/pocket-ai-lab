import { describe, expect, it } from "vitest";
import type { InferenceRequest } from "../../../packages/intelligence/orchestrator/Orchestrator";
import type { LlamaCppBackend, LlamaCppCompletionParams } from "./backend";
import { LlamaCppInferenceProvider, parsePlainChatOutput, StreamingFieldPreview } from "./LlamaCppInferenceProvider";
import { buildLlamaCppMessages } from "./prompt";

const ID_A = "00000000-0000-4000-8000-00000000000a";

function chat(overrides: Partial<InferenceRequest> = {}): InferenceRequest {
  return { agentId: "chat", modelId: "local", prompt: "What is my name?", stage: "independent", contextMessages: [], ...overrides };
}

function stubBackend(outputs: string[], calls: LlamaCppCompletionParams[]): LlamaCppBackend {
  return {
    async complete(params) {
      calls.push(params);
      return { content: outputs[Math.min(calls.length - 1, outputs.length - 1)] };
    },
    async health() {},
    async completeStream(params, _signal, onDelta) {
      calls.push(params);
      const content = outputs[Math.min(calls.length - 1, outputs.length - 1)];
      for (let i = 0; i < content.length; i += 4) onDelta(content.slice(i, i + 4));
      return { content };
    }
  };
}

describe("chat messages", () => {
  it("puts guidance in a system message and replays history in order", () => {
    const messages = buildLlamaCppMessages(chat({
      conversation: [{ role: "user", content: "I am Mack." }, { role: "assistant", content: "Hi Mack." }],
      memoryContext: [{ id: "m1", content: "Mack builds desktop apps." }]
    }));
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Mack builds desktop apps.");
    expect(messages.slice(1)).toEqual([
      { role: "user", content: "I am Mack." },
      { role: "assistant", content: JSON.stringify({ analysis: "Hi Mack." }) },
      { role: "user", content: "What is my name?" }
    ]);
  });

  it("plain chat replays assistant turns as prose and drops the JSON instruction", () => {
    const messages = buildLlamaCppMessages(chat({ conversation: [{ role: "assistant", content: "Hi Mack." }] }), undefined, { plainChat: true });
    expect(messages[0].content).toContain("plain text");
    expect(messages[0].content).not.toContain("single JSON object");
    expect(messages[1]).toEqual({ role: "assistant", content: "Hi Mack." });
  });

  it("names the stage for agent turns", () => {
    const messages = buildLlamaCppMessages(chat({ agentId: "critic", stage: "challenge" }));
    expect(messages[0].content).toContain("Stage: challenge");
    expect(messages[0].content).toContain("What to do now:");
    expect(messages[1].role).toBe("user");
  });
});

describe("streaming previews and plain output", () => {
  it("decodes a partial JSON string field including escapes", () => {
    const preview = new StreamingFieldPreview("analysis");
    expect(preview.push('{"anal')).toBeUndefined();
    expect(preview.push('ysis": "Line one\\nsay \\"hi')).toBe('Line one\nsay "hi');
    expect(preview.push('\\u0021"}')).toBe('Line one\nsay "hi!');
  });

  it("wraps prose, unwraps stray JSON, and fails closed on empty text", () => {
    expect(parsePlainChatOutput("  Hello there.  ").payload).toEqual({ analysis: "Hello there." });
    expect(parsePlainChatOutput('{"analysis":"From JSON"}').payload).toEqual({ analysis: "From JSON" });
    expect(() => parsePlainChatOutput("   ")).toThrow(/empty output/);
  });
});

describe("provider behavior", () => {
  it("retries once with the rejection reason, then succeeds", async () => {
    const calls: LlamaCppCompletionParams[] = [];
    const provider = new LlamaCppInferenceProvider({ repairAttempts: 1 }, stubBackend(["not json", '{"analysis":"ok"}'], calls));
    const result = await provider.generate(chat());
    expect(result.payload).toEqual({ analysis: "ok" });
    expect(calls).toHaveLength(2);
    expect(calls[1].prompt).toContain("Your previous output was rejected");
  });

  it("still fails closed when every attempt is malformed", async () => {
    const calls: LlamaCppCompletionParams[] = [];
    const provider = new LlamaCppInferenceProvider({ repairAttempts: 2 }, stubBackend(["nope"], calls));
    await expect(provider.generate(chat())).rejects.toMatchObject({ code: "malformed_response" });
    expect(calls).toHaveLength(3);
  });

  it("uses a long chat schema in JSON mode", async () => {
    const calls: LlamaCppCompletionParams[] = [];
    const provider = new LlamaCppInferenceProvider({}, stubBackend(['{"analysis":"hi"}'], calls));
    await provider.generate(chat());
    expect(calls[0].jsonSchema).toMatchObject({ properties: { analysis: { maxLength: 6000 } } });
  });

  it("plain-text chat sends no schema and streams the prose", async () => {
    const calls: LlamaCppCompletionParams[] = [];
    const seen: string[] = [];
    const provider = new LlamaCppInferenceProvider({ chatOutput: "text", promptFormat: "chat" }, stubBackend(["Your name is Mack."], calls));
    const result = await provider.generateStream(chat(), { onPreview: text => seen.push(text) });
    expect(calls[0].jsonSchema).toBeUndefined();
    expect(calls[0].messages?.[0].role).toBe("system");
    expect(result.payload).toEqual({ analysis: "Your name is Mack." });
    expect(seen.at(-1)).toBe("Your name is Mack.");
  });

  it("caps agent-stage tokens and pins evidence refs to real message ids", async () => {
    const calls: LlamaCppCompletionParams[] = [];
    const provider = new LlamaCppInferenceProvider({ maxTokens: 2000, agentMaxTokens: 500 },
      stubBackend([JSON.stringify({ synthesis: "Final answer text.", evidenceRefs: [ID_A] })], calls));
    await provider.generate(chat({
      agentId: "synthesizer",
      stage: "synthesis",
      contextMessages: [{
        messageId: ID_A, taskId: "t", conversationId: "t", senderAgentId: "reasoner", recipientAgentId: "broadcast",
        messageType: "analysis", payload: { analysis: "x" }, evidenceRefs: [], createdAt: "2026-11-08T00:00:00.000Z", sequence: 0
      }]
    }));
    expect(calls[0].maxTokens).toBe(500);
    expect(calls[0].jsonSchema).toMatchObject({ properties: { evidenceRefs: { items: { enum: [ID_A] } } } });
  });
});

describe("substantive stage output", () => {
  const revision = (text: string) => JSON.stringify({ revision: text, addressesMessageIds: [ID_A] });
  const request = chat({ agentId: "reasoner", stage: "revision" });

  it("rejects an id pasted into the revision text, then accepts a real retry", async () => {
    const calls: LlamaCppCompletionParams[] = [];
    const provider = new LlamaCppInferenceProvider({ requireSubstantive: true, repairAttempts: 1 },
      stubBackend([revision("address" + ID_A), revision("Ship with a few smoke tests and add unit tests after launch.")], calls));
    const result = await provider.generate(request);
    expect(calls).toHaveLength(2);
    expect(calls[1].prompt).toContain("no usable revision text");
    expect((result.payload as { revision: string }).revision).toMatch(/smoke tests/);
  });

  it("fails closed when every attempt is unusable and is off unless enabled", async () => {
    const provider = new LlamaCppInferenceProvider({ requireSubstantive: true }, stubBackend([revision("0")], []));
    await expect(provider.generate(request)).rejects.toMatchObject({ code: "malformed_response" });
    const lenient = new LlamaCppInferenceProvider({}, stubBackend([revision("0")], []));
    await expect(lenient.generate(request)).resolves.toBeTruthy();
  });
});

describe("message id aliases", () => {
  it("shows short labels to the model and maps them back to real ids", async () => {
    const calls: LlamaCppCompletionParams[] = [];
    const provider = new LlamaCppInferenceProvider({ aliasMessageIds: true, promptFormat: "chat" },
      stubBackend([JSON.stringify({ addressesMessageIds: ["M1"], revision: "Keep a few smoke tests and ship." })], calls));
    const result = await provider.generate(chat({
      agentId: "reasoner",
      stage: "revision",
      prompt: "Address these counterargument message IDs exactly: " + ID_A,
      contextMessages: [{
        messageId: ID_A, taskId: "t", conversationId: "t", senderAgentId: "critic", recipientAgentId: "broadcast",
        messageType: "counterargument", payload: { claim: "a", objection: "b", evidenceRefs: [] }, evidenceRefs: [],
        createdAt: "2026-11-08T00:00:00.000Z", sequence: 0
      }]
    }));
    const sent = JSON.stringify([calls[0].prompt, calls[0].messages, calls[0].jsonSchema]);
    expect(sent).not.toContain(ID_A);
    expect(calls[0].jsonSchema).toMatchObject({ properties: { addressesMessageIds: { items: { enum: ["M1"] } } } });
    expect(result.payload).toEqual({ revision: "Keep a few smoke tests and ship.", addressesMessageIds: [ID_A] });
  });

  it("rejects output that repeats the instructions", async () => {
    const provider = new LlamaCppInferenceProvider({ requireSubstantive: true },
      stubBackend([JSON.stringify({ question: "What to do now: Read the analyses above and ask." })], []));
    await expect(provider.generate(chat({ agentId: "critic", stage: "cross-review" }))).rejects.toMatchObject({ code: "malformed_response" });
  });
});
