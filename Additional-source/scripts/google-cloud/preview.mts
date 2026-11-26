/** Offline preview only. Actual execution belongs to the independently authorized task host. */
import { readBoundedSelectedTextInput } from "../cloud/shared/readSelectedTextInput.mjs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { prepareGoogleCloudAnalysis, GoogleCloudJobFailure } from "../../packages/intelligence/cloud/google-cloud/contracts";
import { CLOUD_ANALYSIS_LIMITS } from "../../packages/intelligence/serverless/cloud-analysis/types";

export function previewFromInput(input: unknown, environment: NodeJS.ProcessEnv, now = Date.now(), attemptID = randomUUID()) {
  const cap = environment.POCKET_VERTEX_MAX_OUTPUT_TOKENS ?? "512";
  if (/^[0-9]{1,3}$/.exec(cap)?.[0] !== cap) throw new GoogleCloudJobFailure("invalid_configuration");
  return prepareGoogleCloudAnalysis(input, {
    attemptID: environment.POCKET_CLOUD_AGENT_ATTEMPT_ID ?? attemptID,
    destination: {
      projectID: environment.POCKET_VERTEX_PROJECT ?? "",
      location: environment.POCKET_VERTEX_LOCATION ?? "",
      modelID: environment.POCKET_VERTEX_MODEL ?? ""
    },
    release: {
      releaseID: environment.POCKET_CLOUD_AGENT_RELEASE_ID ?? "",
      commitSHA: environment.POCKET_CLOUD_AGENT_COMMIT_SHA ?? "",
      artifactSHA256: environment.POCKET_CLOUD_AGENT_ARTIFACT_SHA256 ?? ""
    },
    consentExpiresAt: now + CLOUD_ANALYSIS_LIMITS.consentLifetimeMs,
    maxOutputTokens: Number(cap), now
  });
}

export async function readSelectedTextInput(stream: AsyncIterable<Uint8Array>): Promise<unknown> {
  return readBoundedSelectedTextInput(stream, () => new GoogleCloudJobFailure("invalid_request"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).length !== 0) {
    process.stderr.write("Usage: node --import tsx scripts/google-cloud/preview.mts < selected-text.json\n");
    process.exitCode = 1;
  } else {
    try {
      const preview = previewFromInput(await readSelectedTextInput(process.stdin), process.env);
      process.stdout.write(JSON.stringify(preview, null, 2) + "\n");
    } catch (error) {
      const code = error instanceof GoogleCloudJobFailure ? error.code : "invalid_request";
      process.stderr.write(JSON.stringify({ error: code, remoteOutcome: "not_started" }) + "\n");
      process.exitCode = 1;
    }
  }
}
