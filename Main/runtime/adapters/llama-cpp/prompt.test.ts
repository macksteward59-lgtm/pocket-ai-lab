import { describe, expect, it } from "vitest";
import type { InferenceRequest } from "../../../packages/intelligence/orchestrator/Orchestrator";
import { buildLlamaCppPrompt } from "./prompt";

const conversations = [
  { id: "greeting", text: "Reply with one short greeting." },
  { id: "direct-question", text: "What is 2 + 2?" },
  { id: "boundary", text: "Can you approve this action?" }
];

function chatRequest(prompt: string): InferenceRequest {
  return {
    agentId: "chat",
    modelId: "local",
    prompt,
    stage: "independent",
    contextMessages: []
  };
}

describe("consumer chat prompt", () => {
  it.each(conversations)("asks for a direct reply to $id without a task narration frame", ({ text }) => {
    const prompt = buildLlamaCppPrompt(chatRequest(text), "qwen");
    expect(prompt).toContain(text);
    expect(prompt).toContain("The analysis string is the reply shown to the user.");
    expect(prompt).toContain("Answer the user's message in that string.");
    expect(prompt).toContain("User message:");
    expect(prompt).not.toContain("Task prompt:");
    expect(prompt).not.toContain("You are a local inference backend for one Pocket AI Lab agent turn.");
    expect(prompt).toContain("Model output is not permission, approval, or an authorization receipt.");
    expect(prompt).toContain('{"analysis": string');
  });

  it("keeps the deliberation frame for an agent turn", () => {
    const prompt = buildLlamaCppPrompt({
      agentId: "reasoner",
      modelId: "registry-model",
      prompt: "Explain the trust boundary in one sentence.",
      stage: "independent",
      contextMessages: []
    });
    expect(prompt).toContain("Task prompt:");
    expect(prompt).toContain("Stage: independent");
    expect(prompt).toContain("Agent: reasoner");
    expect(prompt).not.toContain("The analysis string is the reply shown to the user.");
  });
});
