import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import type { DirectorTaskHistoryEntry } from "../../../packages/intelligence/director/DirectorTaskRunner";
import type { LlamaCppBackend, LlamaCppCompletionParams, LlamaCppCompletionResult } from "./backend";
import { LlamaCppDirectorCommandProvider } from "./DirectorCommandProvider";
import { LlamaCppInferenceError } from "./errors";

const COMMAND = { kind: "research", query: "inspect isolated execution" };

function makeInput(history: readonly DirectorTaskHistoryEntry[] = []) {
  return {
    taskId: "director-task-1",
    objective: "Research isolated execution options",
    availableCommands: ["research", "analyze-project", "complete", "blocked", "needs-input"],
    history,
    remainingSteps: 4
  };
}

function toolCall(argumentsValue: string, name = "director_command") {
  return {
    id: "call-1",
    type: "function" as const,
    function: { name, arguments: argumentsValue }
  };
}

function fakeBackend(result: LlamaCppCompletionResult, onParams?: (params: LlamaCppCompletionParams) => void): LlamaCppBackend {
  return {
    async complete(params) {
      onParams?.(params);
      return result;
    },
    async health() {}
  };
}

describe("LlamaCppDirectorCommandProvider", () => {
  it("uses a required native function call and returns its untrusted structured arguments", async () => {
    let captured: LlamaCppCompletionParams | undefined;
    const provider = new LlamaCppDirectorCommandProvider(
      { api: "openai-chat", modelAlias: "local-test-model" },
      fakeBackend({ content: "", toolCalls: [toolCall(JSON.stringify(COMMAND))] }, params => { captured = params; })
    );
    const history = Array.from({ length: 10 }, (_, index) => ({
      step: index + 1,
      commandKind: "research",
      trust: "untrusted-tool-output" as const,
      result: { excerpt: "result-" + index }
    }));
    const proposal = await provider.propose(makeInput(history));

    expect(proposal).toEqual(COMMAND);
    expect(captured?.model).toBe("local-test-model");
    expect(captured?.toolChoice).toEqual({ type: "function", function: { name: "director_command" } });
    expect(captured?.tools).toHaveLength(1);
    expect(captured?.tools?.[0].function.name).toBe("director_command");
    expect(captured?.tools?.[0].function.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: { kind: { enum: makeInput().availableCommands } }
    });
    const prompt = captured?.messages?.[1].content ?? "";
    expect(prompt).toContain("result-9");
    expect(prompt).toContain("result-2");
    expect(prompt).not.toContain("result-0");
    expect(prompt).toContain("untrusted-tool-output");
  });

  it("rejects absent, multiple, unexpected, malformed, and unavailable tool calls", async () => {
    const make = (result: LlamaCppCompletionResult) =>
      new LlamaCppDirectorCommandProvider({ api: "openai-chat", modelAlias: "local-test-model" }, fakeBackend(result));

    await expect(make({ content: "I will research now." }).propose(makeInput()))
      .rejects.toThrow(/exactly one function call/);
    await expect(make({ content: "", toolCalls: [toolCall(JSON.stringify(COMMAND)), toolCall(JSON.stringify(COMMAND))] }).propose(makeInput()))
      .rejects.toThrow(/exactly one function call/);
    await expect(make({ content: "", toolCalls: [toolCall(JSON.stringify(COMMAND), "shell")] }).propose(makeInput()))
      .rejects.toThrow(/unexpected function name/);
    await expect(make({ content: "", toolCalls: [toolCall("{not-json")] }).propose(makeInput()))
      .rejects.toThrow(/not valid JSON/);
    await expect(make({ content: "", toolCalls: [toolCall(JSON.stringify({ kind: "shell", command: "unsafe" }))] }).propose(makeInput()))
      .rejects.toThrow(/unavailable command kind/);
    await expect(make({ content: "", toolCalls: [toolCall(JSON.stringify({ kind: "research", query: "x", extra: "unexpected" }))] }).propose(makeInput()))
      .rejects.toThrow(/outside the selected command contract/);
  });

  it("requires the OpenAI-compatible chat route and an explicit loaded-model alias", () => {
    expect(() => new LlamaCppDirectorCommandProvider({ api: "completion", modelAlias: "model" }))
      .toThrow(/api=openai-chat/);
    expect(() => new LlamaCppDirectorCommandProvider({ api: "openai-chat" }))
      .toThrow(/requires modelAlias/);
  });

  it("sends tool definitions and parses tool_calls through the real HTTP backend", async () => {
    let received: Record<string, unknown> | undefined;
    const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [toolCall(JSON.stringify(COMMAND))]
          }
        }]
      }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as AddressInfo;
      const provider = new LlamaCppDirectorCommandProvider({
        api: "openai-chat",
        modelAlias: "http-test-model",
        baseUrl: `http://127.0.0.1:${address.port}`
      });
      await expect(provider.propose(makeInput())).resolves.toEqual(COMMAND);
      expect(received?.model).toBe("http-test-model");
      expect(received?.tool_choice).toEqual({ type: "function", function: { name: "director_command" } });
      expect(received?.tools).toMatchObject([{
        type: "function",
        function: { name: "director_command" }
      }]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it("rejects invalid task input before calling the backend", async () => {
    let called = false;
    const provider = new LlamaCppDirectorCommandProvider(
      { api: "openai-chat", modelAlias: "local-test-model" },
      fakeBackend({ content: "", toolCalls: [toolCall(JSON.stringify(COMMAND))] }, () => { called = true; })
    );
    await expect(provider.propose({ ...makeInput(), availableCommands: ["shell"] }))
      .rejects.toBeInstanceOf(LlamaCppInferenceError);
    expect(called).toBe(false);
  });
});
