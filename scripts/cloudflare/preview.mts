/** Offline preview only. This entrypoint cannot authenticate, deploy, or submit work. */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { prepareCloudflareAnalysis, validateCloudflareDestination, CloudflareJobFailure } from "../../packages/intelligence/cloud/cloudflare/contracts";
import { CLOUD_ANALYSIS_LIMITS } from "../../packages/intelligence/serverless/cloud-analysis/types";
import { readBoundedSelectedTextInput } from "../cloud/shared/readSelectedTextInput.mjs";

export function previewFromInput(input: unknown, environment: NodeJS.ProcessEnv, now = Date.now(), attemptID = randomUUID()) {
  const cap = environment.POCKET_CLOUDFLARE_MAX_OUTPUT_TOKENS ?? "512";
  if (/^[0-9]{1,3}$/.exec(cap)?.[0] !== cap) throw new CloudflareJobFailure("invalid_configuration");
  return prepareCloudflareAnalysis(input, {
    attemptID: environment.POCKET_CLOUD_AGENT_ATTEMPT_ID ?? attemptID,
    destination: validateCloudflareDestination({
      accountID: environment.POCKET_CLOUDFLARE_ACCOUNT_ID ?? "",
      modelID: environment.POCKET_CLOUDFLARE_MODEL ?? ""
    }),
    release: {
      releaseID: environment.POCKET_CLOUD_AGENT_RELEASE_ID ?? "",
      commitSHA: environment.POCKET_CLOUD_AGENT_COMMIT_SHA ?? "",
      artifactSHA256: environment.POCKET_CLOUD_AGENT_ARTIFACT_SHA256 ?? ""
    },
    consentExpiresAt: now + CLOUD_ANALYSIS_LIMITS.consentLifetimeMs,
    maxOutputTokens: Number(cap), now
  });
}

export function readSelectedTextInput(stream: AsyncIterable<Uint8Array>): Promise<unknown> {
  return readBoundedSelectedTextInput(stream, () => new CloudflareJobFailure("invalid_request"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).length !== 0) {
    process.stderr.write("Usage: node --import tsx scripts/cloudflare/preview.mts < selected-text.json\n");
    process.exitCode = 1;
  } else {
    try {
      const preview = previewFromInput(await readSelectedTextInput(process.stdin), process.env);
      process.stdout.write(JSON.stringify(preview, null, 2) + "\n");
    } catch (error) {
      const code = error instanceof CloudflareJobFailure ? error.code : "invalid_request";
      process.stderr.write(JSON.stringify({ error: code, remoteOutcome: "not_started" }) + "\n");
      process.exitCode = 1;
    }
  }
}
