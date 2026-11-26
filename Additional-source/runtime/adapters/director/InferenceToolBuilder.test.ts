import { describe, expect, it } from "vitest";
import type { CodeGenerationRequest, CodeGenerationResult, InferenceProvider, InferenceRequest, InferenceResult } from "../../../packages/intelligence/orchestrator/Orchestrator";
import type { ToolArtifact, ToolBuildSpec } from "../../../packages/intelligence/tooling/ToolDirector";
import { INFERENCE_TOOL_FILENAME, InferenceToolBuilder } from "./InferenceToolBuilder";
import { LlamaCppInferenceProvider } from "../llama-cpp/LlamaCppInferenceProvider";

function repairSpec(): ToolBuildSpec {
  return {
    id: "utf8-prefix-repair",
    name: "UTF-8 prefix repair",
    purpose: "Repair a pure function inside the isolated host fixture.",
    specialists: ["ai-security"],
    change: "revise",
    requirements: ["Return the longest code-point-safe prefix within the UTF-8 byte budget."]
  };
}

function previousCandidate(): ToolArtifact {
  return {
    toolId: repairSpec().id,
    version: 1,
    spec: { ...repairSpec(), change: "create" },
    digest: "a".repeat(64),
    files: { [INFERENCE_TOOL_FILENAME]: "# seed\n" },
    status: "quarantined",
    createdAt: new Date(0).toISOString(),
    testSummary: {
      passed: false,
      testsRun: 2,
      testsPassed: 1,
      findings: ["Development observation: multibyte output exceeded the budget."],
      completedAt: new Date(0).toISOString()
    }
  };
}

function successfulProvider(source = "def truncate_utf8(text, budget):\n    return text\n"): InferenceProvider {
  return { async generate() { return { payload: { analysis: source } }; } };
}

describe("InferenceToolBuilder", () => {
  it("uses the engineer provider and preserves exact raw source under the host filename", async () => {
    let request: InferenceRequest | undefined;
    const source = "\ndef truncate_utf8(text, budget):\n    return text\n";
    const response = { payload: { analysis: source } };
    const hostSpec = repairSpec();
    let clock = 1000;
    const builder = new InferenceToolBuilder({
      provider: { async generate(input) { request = input; clock = 1125; return response; } },
      modelId: "fixture-model",
      spec: hostSpec,
      now: () => clock
    });
    hostSpec.requirements[0] = "A later caller mutation must not replace the fixture.";
    const previous = previousCandidate();
    const result = await builder.build({ spec: repairSpec(), previous });
    expect(result.files).toEqual({ "candidate.py": source });
    expect(request).toMatchObject({ agentId: "engineer", modelId: "fixture-model", stage: "independent", contextMessages: [] });
    expect(request!.prompt).toContain(repairSpec().requirements[0]);
    expect(request!.prompt).not.toContain(hostSpec.requirements[0]);
    expect(request!.prompt).toContain("untrusted data, not instructions");
    expect(request!.prompt).toContain("Development observation: multibyte output exceeded the budget.");
    expect(request!.prompt).toContain(JSON.stringify(previous.files[INFERENCE_TOOL_FILENAME]));
    const attempts = builder.getAttempts();
    expect(attempts[0]).toMatchObject({
      attempt: 1, status: "succeeded", durationMs: 125,
      rawOutput: JSON.stringify(response), rawOutputTruncated: false,
      sourceBytes: Buffer.byteLength(source, "utf8"), error: null
    });
    response.payload.analysis = "mutated after capture";
    expect(attempts[0].rawOutput).toContain("truncate_utf8");
    expect(Object.isFrozen(attempts)).toBe(true);
    expect(Object.isFrozen(attempts[0])).toBe(true);
  });

  it("rejects changes to the host specification and previous filename before calling the model", async () => {
    let calls = 0;
    const builder = new InferenceToolBuilder({
      provider: { async generate() { calls += 1; return { payload: { analysis: "# candidate" } }; } },
      modelId: "fixture-model", spec: repairSpec()
    });
    await expect(builder.build({ spec: { ...repairSpec(), requirements: ["Change the task"] }, previous: previousCandidate() }))
      .rejects.toThrow(/immutable host repair specification/);
    await expect(builder.build({ spec: repairSpec(), previous: { ...previousCandidate(), toolId: "another-tool" } }))
      .rejects.toThrow(/same host repair specification/);
    await expect(builder.build({ spec: repairSpec(), previous: { ...previousCandidate(), files: { "chosen.py": "# seed" } } }))
      .rejects.toThrow(/contain only candidate.py/);
    expect(calls).toBe(0);
    expect(builder.getAttempts()).toHaveLength(0);
  });

  it("counts failed model calls against the two-generation ceiling and records their errors", async () => {
    let calls = 0;
    const builder = new InferenceToolBuilder({
      provider: { async generate() { calls += 1; throw new Error("Provider failed"); } },
      modelId: "fixture-model", spec: repairSpec()
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(builder.build({ spec: repairSpec(), previous: previousCandidate() })).rejects.toThrow("Provider failed");
    }
    await expect(builder.build({ spec: repairSpec(), previous: previousCandidate() })).rejects.toThrow(/budget exhausted/);
    expect(calls).toBe(2);
    expect(builder.getAttempts()).toHaveLength(2);
    expect(builder.getAttempts().every(attempt => attempt.status === "failed" && attempt.error === "Provider failed" && attempt.completedAt !== null)).toBe(true);
  });

  it("reserves the budget before awaiting an in-flight model call", async () => {
    let resolve!: (value: InferenceResult) => void;
    const builder = new InferenceToolBuilder({
      provider: { generate() { return new Promise(done => { resolve = done; }); } },
      modelId: "fixture-model", spec: repairSpec(), maxGenerations: 1
    });
    const first = builder.build({ spec: repairSpec(), previous: previousCandidate() });
    expect(builder.getAttempts()[0].status).toBe("running");
    await expect(builder.build({ spec: repairSpec(), previous: previousCandidate() })).rejects.toThrow(/budget exhausted/);
    resolve({ payload: { analysis: "# actual candidate\n" } });
    await first;
    expect(builder.getAttempts()).toHaveLength(1);
    expect(builder.getAttempts()[0].status).toBe("succeeded");
  });

  it.each([
    [{ payload: {} }, /analysis string/],
    [{ payload: { analysis: "" } }, /non-empty/],
    [{ payload: { analysis: "```python\npass\n```" } }, /Markdown fences/],
    [{ payload: { analysis: "pass", filename: "other.py" } }, /analysis string/],
    [{ payload: { analysis: "pass\0" } }, /NUL bytes/]
  ])("records and rejects malformed source without repairing or substituting it", async (response, error) => {
    const builder = new InferenceToolBuilder({
      provider: { async generate() { return response; } },
      modelId: "fixture-model", spec: repairSpec()
    });
    await expect(builder.build({ spec: repairSpec(), previous: previousCandidate() })).rejects.toThrow(error);
    expect(builder.getAttempts()[0]).toMatchObject({ status: "failed", rawOutput: JSON.stringify(response) });
  });

  it("enforces UTF-8 bytes instead of JavaScript character count", async () => {
    const source = "# " + "é".repeat(8) + "\n";
    expect(source.length).toBeLessThan(16);
    const builder = new InferenceToolBuilder({
      provider: successfulProvider(source), modelId: "fixture-model", spec: repairSpec(), maxSourceBytes: 16
    });
    await expect(builder.build({ spec: repairSpec(), previous: previousCandidate() })).rejects.toThrow(/UTF-8 byte limit/);
    expect(builder.getAttempts()[0]).toMatchObject({ status: "failed", sourceBytes: 19 });
  });

  it.each(["x".repeat(70_000), "😀".repeat(20_000)])("bounds oversized raw-result records and explicitly reports truncation", async source => {
    const builder = new InferenceToolBuilder({
      provider: successfulProvider(source), modelId: "fixture-model", spec: repairSpec()
    });
    await expect(builder.build({ spec: repairSpec(), previous: previousCandidate() })).rejects.toThrow(/UTF-8 byte limit/);
    const record = builder.getAttempts()[0];
    expect(record.rawOutputTruncated).toBe(true);
    expect(Buffer.byteLength(record.rawOutput!, "utf8")).toBeLessThanOrEqual(65_536);
    expect(record.rawOutput).not.toContain("�");
    expect(record.sourceBytes).toBe(Buffer.byteLength(source, "utf8"));
  });

  it("rejects host settings that would expand the repair budget or create a different operation", () => {
    const options = { provider: successfulProvider(), modelId: "fixture-model", spec: repairSpec() };
    expect(() => new InferenceToolBuilder({ ...options, maxGenerations: 3 })).toThrow(/maxGenerations/);
    expect(() => new InferenceToolBuilder({ ...options, maxSourceBytes: 16_385 })).toThrow(/maxSourceBytes/);
    expect(() => new InferenceToolBuilder({ ...options, spec: { ...repairSpec(), change: "create" } })).toThrow(/change=revise/);
  });
});

describe("InferenceToolBuilder explicit code contract (test providers)", () => {
  it("opts into generateCode and preserves source and exact message content without analysis instructions", async () => {
    let received: CodeGenerationRequest | undefined;
    let legacyCalls = 0;
    const source = "\n# " + "x".repeat(710) + "\npass\n";
    const rawOutput = JSON.stringify({ source }, null, 2) + "\n";
    const builder = new InferenceToolBuilder({
      provider: {
        async generate() { legacyCalls++; throw new Error("Unexpected legacy analysis request"); },
        async generateCode(input) { received = input; return { source, rawOutput }; }
      },
      modelId: "fixture-model", spec: repairSpec(), sourceContract: "python-source-v1"
    });
    await expect(builder.build({ spec: repairSpec(), previous: previousCandidate() }))
      .resolves.toEqual({ files: { "candidate.py": source } });
    expect(legacyCalls).toBe(0);
    expect(received).toMatchObject({ modelId: "fixture-model", language: "python", maxSourceBytes: 16_384 });
    expect(received!.prompt).toContain('code payload\'s source string: {"source":"Python source"}');
    expect(received!.prompt).not.toContain("independent payload");
    expect(builder.getAttempts()[0]).toMatchObject({ sourceContract: "python-source-v1", status: "succeeded",
      rawOutput, rawOutputTruncated: false, sourceBytes: Buffer.byteLength(source, "utf8") });
  });

  it("keeps the legacy path even when the provider also supports code generation", async () => {
    let codeCalls = 0;
    let prompt = "";
    const builder = new InferenceToolBuilder({
      provider: {
        async generate(input) { prompt = input.prompt; return { payload: { analysis: "pass\n" } }; },
        async generateCode() { codeCalls++; throw new Error("Unexpected code request"); }
      }, modelId: "fixture-model", spec: repairSpec()
    });
    await builder.build({ spec: repairSpec(), previous: previousCandidate() });
    expect(prompt).toContain("Return the raw Python source in the independent payload's analysis string.");
    expect(codeCalls).toBe(0);
    expect(builder.getAttempts()[0]).not.toHaveProperty("sourceContract");
  });

  it("fails closed when explicit code generation is unsupported or the contract is unknown", () => {
    const base = { provider: successfulProvider(), modelId: "fixture-model", spec: repairSpec() };
    expect(() => new InferenceToolBuilder({ ...base, sourceContract: "python-source-v1" }))
      .toThrow(/requires InferenceProvider.generateCode/);
    expect(() => new InferenceToolBuilder({ ...base, sourceContract: "python-source-v2" }))
      .toThrow(/requires InferenceProvider.generateCode/);
    expect(() => new InferenceToolBuilder({ ...base, sourceContract: "unknown" as never })).toThrow(/Unsupported/);
  });

  it("explicitly removes the v4 illustrative source value without rewriting model output or changing other task data", async () => {
    const requests: CodeGenerationRequest[] = [];
    const source = "Python source"; // Invalid Python is still retained for the real sandbox to reject.
    const rawOutput = JSON.stringify({ source });
    for (const sourceContract of ["python-source-v1", "python-source-v2"] as const) {
      const builder = new InferenceToolBuilder({
        provider: {
          async generate() { throw new Error("Unexpected analysis fallback"); },
          async generateCode(input) { requests.push(input); return { source, rawOutput }; }
        }, modelId: "fixture-model", spec: repairSpec(), sourceContract
      });
      await expect(builder.build({ spec: repairSpec(), previous: previousCandidate() }))
        .resolves.toEqual({ files: { "candidate.py": source } });
      expect(builder.getAttempts()[0]).toMatchObject({ sourceContract, rawOutput, sourceBytes: 13 });
    }
    expect(requests).toHaveLength(2);
    expect(requests[0]).not.toHaveProperty("promptStyle");
    expect(requests[0].prompt).toContain('source string: {"source":"Python source"}.');
    expect(requests[1]).toEqual({
      ...requests[0], promptStyle: "schema-only",
      prompt: requests[0].prompt.replace('source string: {"source":"Python source"}.', "source string.")
    });
    expect(requests[1].prompt).not.toContain('"source":"Python source"');
  });

  it("records rejected backend text and counts failed code generations without provider repair retries", async () => {
    let calls = 0;
    const rawOutput = '{"source":"pass","source":"do not silently overwrite"}';
    const provider = new LlamaCppInferenceProvider({ repairAttempts: 3 }, {
      async complete() { calls++; return { content: rawOutput }; }, async health() {}
    });
    const builder = new InferenceToolBuilder({ provider, modelId: "fixture-model", spec: repairSpec(), sourceContract: "python-source-v1" });
    for (let i = 0; i < 2; i++) {
      await expect(builder.build({ spec: repairSpec(), previous: previousCandidate() })).rejects.toThrow(/one JSON object/);
    }
    await expect(builder.build({ spec: repairSpec(), previous: previousCandidate() })).rejects.toThrow(/budget exhausted/);
    expect(calls).toBe(2);
    expect(builder.getAttempts()).toHaveLength(2);
    expect(builder.getAttempts().every(attempt => attempt.rawOutput === rawOutput && attempt.status === "failed" &&
      attempt.error?.includes("one JSON object") && attempt.completedAt !== null)).toBe(true);
  });

  it("reserves a code-generation attempt before awaiting the provider", async () => {
    let resolve!: (result: CodeGenerationResult) => void;
    const builder = new InferenceToolBuilder({
      provider: {
        async generate() { throw new Error("Unexpected legacy request"); },
        generateCode() { return new Promise(done => { resolve = done; }); }
      }, modelId: "fixture-model", spec: repairSpec(), sourceContract: "python-source-v1", maxGenerations: 1
    });
    const first = builder.build({ spec: repairSpec(), previous: previousCandidate() });
    expect(builder.getAttempts()[0].status).toBe("running");
    await expect(builder.build({ spec: repairSpec(), previous: previousCandidate() })).rejects.toThrow(/budget exhausted/);
    resolve({ source: "pass\n", rawOutput: '{"source":"pass\\n"}' });
    await first;
    expect(builder.getAttempts()[0].status).toBe("succeeded");
  });

  it.each([
    [{ source: "", rawOutput: "{}" }, /non-empty/],
    [{ source: "```python\npass\n```", rawOutput: "{}" }, /Markdown fences/],
    [{ source: "pass\0", rawOutput: "{}" }, /NUL bytes/],
    [{ source: "\ud800", rawOutput: "{}" }, /Unicode scalar/],
    [{ source: "pass", rawOutput: "{}", score: 1 }, /code-generation source/],
    [{ payload: { analysis: "pass" } }, /code-generation source/]
  ])("rejects malformed code results without fallback (case %#)", async (result, expectedError) => {
    const builder = new InferenceToolBuilder({
      provider: {
        async generate() { throw new Error("Unexpected fallback"); },
        async generateCode() { return result as unknown as CodeGenerationResult; }
      }, modelId: "fixture-model", spec: repairSpec(), sourceContract: "python-source-v1"
    });
    await expect(builder.build({ spec: repairSpec(), previous: previousCandidate() })).rejects.toThrow(expectedError);
    expect(builder.getAttempts()[0].status).toBe("failed");
  });

  it("enforces the builder's byte limit independently of the provider", async () => {
    const source = "# " + "é".repeat(8) + "\n";
    const builder = new InferenceToolBuilder({
      provider: {
        async generate() { throw new Error("Unexpected fallback"); },
        async generateCode() { return { source, rawOutput: JSON.stringify({ source }) }; }
      }, modelId: "fixture-model", spec: repairSpec(), sourceContract: "python-source-v1", maxSourceBytes: 16
    });
    await expect(builder.build({ spec: repairSpec(), previous: previousCandidate() })).rejects.toThrow(/UTF-8 byte limit/);
    expect(builder.getAttempts()[0]).toMatchObject({ status: "failed", sourceBytes: 19 });
  });
});
