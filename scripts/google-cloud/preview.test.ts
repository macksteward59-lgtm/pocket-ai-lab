import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { previewFromInput, readSelectedTextInput } from "./preview.mts";

const ENV = {
  POCKET_VERTEX_PROJECT: "fixture-project", POCKET_VERTEX_LOCATION: "us-central1", POCKET_VERTEX_MODEL: "gemini-fixture",
  POCKET_CLOUD_AGENT_RELEASE_ID: "fixture-release", POCKET_CLOUD_AGENT_COMMIT_SHA: "a".repeat(40),
  POCKET_CLOUD_AGENT_ARTIFACT_SHA256: "b".repeat(64), POCKET_VERTEX_MAX_OUTPUT_TOKENS: "128"
};
const INPUT = { task_id: "task-fixture", purpose: "test-summary", selected_text: "Tests: 8 passed and 1 failed." };

describe("Offline operator preview", () => {
  it("never requests credentials or fetches a network resource", () => {
    const fetch = vi.fn(() => { throw new Error("network forbidden"); });
    vi.stubGlobal("fetch", fetch);
    try {
      const preview = previewFromInput(INPUT, ENV, 1_800_000_000_000, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
      expect(preview.taskID).toBe(INPUT.task_id);
      expect(preview.requestBody.contents[0].parts[0].text).toBe(INPUT.selected_text);
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("runs the real entrypoint from bounded stdin using explicit configuration", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/google-cloud/preview.mts"], {
      cwd: process.cwd(), env: { ...process.env, ...ENV }, input: JSON.stringify(INPUT), encoding: "utf8", timeout: 10_000
    });
    expect(result.status).toBe(0);
    const preview = JSON.parse(result.stdout);
    expect(preview.destination.location).toBe("us-central1");
    expect(preview.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.providerID).toBe("google-vertex");
  });

  it("does not disclose invalid input or environment data in failures", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/google-cloud/preview.mts"], {
      cwd: process.cwd(), env: { ...process.env, ...ENV, POCKET_VERTEX_PROJECT: "sensitive-invalid-value/" },
      input: JSON.stringify(INPUT), encoding: "utf8", timeout: 10_000
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('{"error":"invalid_configuration","remoteOutcome":"not_started"}\n');
    expect(result.stdout).toBe("");
  });

  it("requires project, region, model and release provenance without defaults", () => {
    for (const key of Object.keys(ENV).filter(key => key !== "POCKET_VERTEX_MAX_OUTPUT_TOKENS")) {
      const env = { ...ENV } as NodeJS.ProcessEnv;
      delete env[key];
      expect(() => previewFromInput(INPUT, env)).toThrow("invalid_configuration");
    }
    expect(() => previewFromInput(INPUT, { ...ENV, POCKET_VERTEX_MAX_OUTPUT_TOKENS: "512\n" })).toThrow("invalid_configuration");
  });

  it("bounds actual stdin bytes and rejects malformed UTF-8", async () => {
    async function* bytes(value: Uint8Array) { yield value; }
    await expect(readSelectedTextInput(bytes(new Uint8Array(32 * 1024 + 1)))).rejects.toThrow("invalid_request");
    await expect(readSelectedTextInput(bytes(new Uint8Array([0xff, 0xfe])))).rejects.toThrow("invalid_request");
    expect(await readSelectedTextInput(bytes(Buffer.from(JSON.stringify(INPUT))))).toEqual(INPUT);
  });
});
