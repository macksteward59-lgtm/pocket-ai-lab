import { describe, expect, it } from "vitest";
import { LlamaCppInferenceProvider } from "./LlamaCppInferenceProvider";
import type {
  LlamaCppBackend,
  LlamaCppCompletionParams,
  LlamaCppCompletionResult
} from "./backend";
import { LlamaCppInferenceError } from "./errors";

class RecordingBackend implements LlamaCppBackend {
  params?: LlamaCppCompletionParams;
  content: string;

  constructor(content: string) {
    this.content = content;
  }

  async complete(params: LlamaCppCompletionParams, _signal: AbortSignal): Promise<LlamaCppCompletionResult> {
    this.params = params;
    return { content: this.content };
  }

  async health(_signal: AbortSignal): Promise<void> {}
}

function request(responseContract?: "bug-bounty-policy-review") {
  return {
    agentId: "critic",
    modelId: "local-review-model",
    stage: "independent" as const,
    ...(responseContract ? { responseContract } : {}),
    contextMessages: [],
    prompt: "Review the supplied policy snapshot independently."
  };
}

describe("llama.cpp policy-review response contract", () => {
  it("accepts the review envelope and sends its matching constrained JSON schema", async () => {
    const backend = new RecordingBackend(JSON.stringify({
      summary: "The supplied policy lines were independently reviewed.",
      findings: []
    }));
    const provider = new LlamaCppInferenceProvider({ repairAttempts: 0 }, backend);

    const result = await provider.generate(request("bug-bounty-policy-review"));

    expect(result.payload).toEqual({
      summary: "The supplied policy lines were independently reviewed.",
      findings: []
    });
    expect(backend.params?.jsonSchema).toMatchObject({
      required: ["summary", "findings"],
      additionalProperties: false,
      properties: {
        summary: { type: "string", minLength: 1, maxLength: 4000 },
        findings: { type: "array", maxItems: 100 }
      }
    });
  });

  it("rejects extra top-level fields instead of silently accepting a permission claim", async () => {
    const backend = new RecordingBackend(JSON.stringify({
      summary: "Review completed.",
      findings: [],
      authorized: true
    }));
    const provider = new LlamaCppInferenceProvider({ repairAttempts: 0 }, backend);

    await expect(provider.generate(request("bug-bounty-policy-review")))
      .rejects.toMatchObject({ code: "malformed_response" });
  });

  it("preserves the existing independent-stage analysis schema when no response contract is requested", async () => {
    const backend = new RecordingBackend(JSON.stringify({
      analysis: "The source policy requires an independent review."
    }));
    const provider = new LlamaCppInferenceProvider({ repairAttempts: 0 }, backend);

    const result = await provider.generate(request());

    expect(result.payload).toEqual({
      analysis: "The source policy requires an independent review."
    });
    expect(backend.params?.jsonSchema).toMatchObject({
      required: ["analysis"],
      additionalProperties: false
    });
  });

  it("rejects a response contract used with a non-independent stage", async () => {
    const backend = new RecordingBackend(JSON.stringify({
      summary: "Review completed.",
      findings: []
    }));
    const provider = new LlamaCppInferenceProvider({ repairAttempts: 0 }, backend);
    const invalid = { ...request("bug-bounty-policy-review"), stage: "synthesis" as const };

    await expect(provider.generate(invalid))
      .rejects.toBeInstanceOf(LlamaCppInferenceError);
    expect(backend.params).toBeUndefined();
  });
});
