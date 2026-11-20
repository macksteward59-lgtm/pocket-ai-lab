/** Explicit operator entrypoint. No server is started by importing a product module. */
import { DeepSeekAnalysisProvider, type DeepSeekAnalysisModel } from "../../packages/intelligence/serverless/cloud-analysis/DeepSeekAnalysisProvider";
import { createCloudAnalysisHandler } from "../../packages/intelligence/serverless/cloud-analysis/gateway";
import { createBearerAuthenticator, createCloudAnalysisNodeServer } from "../../packages/intelligence/serverless/cloud-analysis/nodeServer";

function start(): void {
  if (process.env.POCKET_CLOUD_ANALYSIS_ENABLED !== "true") {
    throw new Error("Set POCKET_CLOUD_ANALYSIS_ENABLED=true to start the optional gateway.");
  }
  const applicationToken = process.env.POCKET_CLOUD_ANALYSIS_APP_TOKEN ?? "";
  const providerKey = process.env.DEEPSEEK_API_KEY ?? "";
  if (applicationToken === providerKey) throw new Error("Application and provider credentials must be distinct.");
  const authenticate = createBearerAuthenticator(applicationToken);
  const model = process.env.POCKET_CLOUD_ANALYSIS_MODEL as DeepSeekAnalysisModel;
  const profileID = process.env.POCKET_CLOUD_ANALYSIS_PROFILE ?? "";
  const portText = process.env.POCKET_CLOUD_ANALYSIS_PORT ?? "8787";
  const port = Number(portText);
  if (!portText || /[^0-9]/.test(portText) || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Invalid gateway port.");
  }
  const provider = new DeepSeekAnalysisProvider({ enabled: true, apiKey: providerKey, model });
  const handler = createCloudAnalysisHandler({ enabled: true, profile: { profileID, model }, provider, authenticate });
  const server = createCloudAnalysisNodeServer({ handler });
  server.on("error", () => { process.stderr.write("Cloud analysis gateway failed to listen.\n"); process.exitCode = 1; });
  // A reviewed HTTPS/authenticated deployment boundary is required for a remote phone.
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(JSON.stringify({ ready: true, origin: `http://127.0.0.1:${port}`, mode: "loopback-reference-host" }) + "\n");
  });
  const stop = () => { server.close(); server.closeAllConnections(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

try { start(); }
catch {
  // Configuration errors never print a key, input value, or provider response.
  process.stderr.write("Cloud analysis gateway configuration is unavailable or invalid.\n");
  process.exitCode = 1;
}
