/** Real HTTP -> production gateway -> production provider with an explicit fake upstream. */
import { rename, writeFile } from "node:fs/promises";
import { DeepSeekAnalysisProvider } from "../../packages/intelligence/serverless/cloud-analysis/DeepSeekAnalysisProvider";
import { createCloudAnalysisHandler } from "../../packages/intelligence/serverless/cloud-analysis/gateway";
import { createBearerAuthenticator, createCloudAnalysisNodeServer } from "../../packages/intelligence/serverless/cloud-analysis/nodeServer";

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--ready-file" || !args[1])) {
  throw new Error("Usage: fixture-server.mts [--ready-file path]");
}
let upstreamCalls = 0;
const fakeFetch: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body));
  upstreamCalls += 1;
  if (body.model !== "deepseek-flash" || body.messages?.length !== 1 || body.messages[0].role !== "user" ||
      body.reasoning_effort !== "none" || body.stream !== false || body.tool_choice !== "none" ||
      !Number.isSafeInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 512) {
    throw new Error("Fixture rejected a changed provider contract.");
  }
  return new Response(JSON.stringify({
    id: "fixture-response-" + upstreamCalls,
    object: "chat.completion",
    model: "fixture-deepseek-flash",
    choices: [{ index: 0, finish_reason: "stop", message: {
      role: "assistant",
      content: "This fixture result keeps its cloud model identity so the local task history can attribute the analysis correctly."
    } }],
    usage: { prompt_tokens: 16, completion_tokens: Math.min(body.max_tokens, 24), total_tokens: 16 + Math.min(body.max_tokens, 24) }
  }), { headers: { "content-type": "application/json" } });
};
const provider = new DeepSeekAnalysisProvider({
  enabled: true,
  apiKey: "fixture-provider-key-never-sent-to-a-network",
  model: "deepseek-flash",
  acceptedResponseModels: ["fixture-deepseek-flash"],
  fetchImpl: fakeFetch
});
const handler = createCloudAnalysisHandler({
  enabled: true,
  profile: { profileID: "pocket-analysis-v1", model: "deepseek-flash" },
  provider,
  authenticate: createBearerAuthenticator("fixture-app-token-at-least-32-characters")
});
const server = createCloudAnalysisNodeServer({ handler });
server.on("error", () => { process.stderr.write("Cloud fixture failed to listen.\n"); process.exitCode = 1; });
server.listen(0, "127.0.0.1", () => {
  void (async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture port unavailable.");
    const ready = { origin: `http://127.0.0.1:${address.port}`, ready: true, upstream: "injected-fixture" };
    if (args[1]) {
      const temporary = args[1] + "." + process.pid + ".tmp";
      await writeFile(temporary, JSON.stringify(ready) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, args[1]);
    }
    process.stdout.write(JSON.stringify(ready) + "\n");
  })().catch(() => { process.stderr.write("Cloud fixture readiness failed.\n"); server.close(); process.exitCode = 1; });
});
const stop = () => {
  process.stdout.write(JSON.stringify({ event: "fixture-stopped", upstreamCalls }) + "\n");
  server.close();
  server.closeAllConnections();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
