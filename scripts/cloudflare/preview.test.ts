import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { previewFromInput, readSelectedTextInput } from "./preview.mts";

const ENV = {
  POCKET_CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), POCKET_CLOUDFLARE_MODEL: "@cf/openai/gpt-oss-120b",
  POCKET_CLOUD_AGENT_RELEASE_ID: "fixture-release", POCKET_CLOUD_AGENT_COMMIT_SHA: "b".repeat(40),
  POCKET_CLOUD_AGENT_ARTIFACT_SHA256: "c".repeat(64), POCKET_CLOUDFLARE_MAX_OUTPUT_TOKENS: "128"
};
const INPUT = { task_id: "task-fixture", purpose: "test-summary", selected_text: "Tests: 8 passed and 1 failed." };

describe("Cloudflare offline preview entrypoint", () => {
  it("prepares without fetching or reading credentials", () => {
    const network = vi.fn(() => { throw new Error("network forbidden"); });
    vi.stubGlobal("fetch", network);
    try {
      const env = { ...ENV };
      Object.defineProperty(env, "CLOUDFLARE_API_TOKEN", { get() { throw new Error("credential read"); } });
      const result = previewFromInput(INPUT, env, 1_800_000_000_000, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
      expect(result.providerID).toBe("cloudflare-workers-ai");
      expect(result.requestBody.messages[1].content).toBe(INPUT.selected_text);
      expect(network).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("runs the real CLI and returns a destination-bound preview", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/cloudflare/preview.mts"], {
      cwd: process.cwd(), env: { ...process.env, ...ENV }, input: JSON.stringify(INPUT), encoding: "utf8", timeout: 10_000
    });
    expect(result.status).toBe(0);
    const preview = JSON.parse(result.stdout);
    expect(preview.endpoint).toBe(`https://api.cloudflare.com/client/v4/accounts/${ENV.POCKET_CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`);
    expect(preview.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.requestBody.max_tokens).toBe(128);
  });

  it("requires account, model and release settings without guessing from a login", () => {
    for (const key of Object.keys(ENV).filter(key => key !== "POCKET_CLOUDFLARE_MAX_OUTPUT_TOKENS")) {
      const env = { ...ENV } as NodeJS.ProcessEnv;
      delete env[key];
      expect(() => previewFromInput(INPUT, env)).toThrow("invalid_configuration");
    }
    expect(() => previewFromInput(INPUT, { ...ENV, POCKET_CLOUDFLARE_MAX_OUTPUT_TOKENS: "512\n" })).toThrow("invalid_configuration");
  });

  it("sanitizes invalid settings and has no submit operation", () => {
    const failed = spawnSync(process.execPath, ["--import", "tsx", "scripts/cloudflare/preview.mts"], {
      cwd: process.cwd(), env: { ...process.env, ...ENV, POCKET_CLOUDFLARE_ACCOUNT_ID: "sensitive/invalid" },
      input: JSON.stringify(INPUT), encoding: "utf8", timeout: 10_000
    });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toBe('{"error":"invalid_configuration","remoteOutcome":"not_started"}\n');
    expect(failed.stdout).toBe("");
    const submit = spawnSync(process.execPath, ["--import", "tsx", "scripts/cloudflare/preview.mts", "submit"], {
      cwd: process.cwd(), env: { ...process.env, ...ENV }, input: JSON.stringify(INPUT), encoding: "utf8", timeout: 10_000
    });
    expect(submit.status).toBe(1);
    expect(submit.stdout).toBe("");
  });

  it("bounds input bytes and rejects malformed UTF-8", async () => {
    async function* bytes(value: Uint8Array) { yield value; }
    await expect(readSelectedTextInput(bytes(new Uint8Array(32 * 1024 + 1)))).rejects.toThrow("invalid_request");
    await expect(readSelectedTextInput(bytes(new Uint8Array([0xff, 0xfe])))).rejects.toThrow("invalid_request");
    expect(await readSelectedTextInput(bytes(Buffer.from(JSON.stringify(INPUT))))).toEqual(INPUT);
  });
});
