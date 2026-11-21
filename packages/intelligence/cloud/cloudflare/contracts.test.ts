import { describe, expect, it, vi } from "vitest";
import { PURPOSE_INSTRUCTIONS } from "../shared/selectedTextContract";
import {
  CLOUDFLARE_ANALYSIS_MODELS, prepareCloudflareAnalysis, validateCloudflarePreview,
  type CloudflareDestination
} from "./contracts";
import { CLOUDFLARE_AGENT_ID, CLOUDFLARE_COMPONENT_ID, cloudflareAgentProfile } from "./profile";

const NOW = 1_800_000_000_000;
const DESTINATION: CloudflareDestination = { accountID: "a".repeat(32), modelID: CLOUDFLARE_ANALYSIS_MODELS[0] };
const INPUT = { task_id: "fixture-task", purpose: "documentation", selected_text: "Selected fixture text." };
const OPTIONS = {
  attemptID: "00000000-0000-4000-8000-000000000001", destination: DESTINATION,
  release: { releaseID: "fixture-release", commitSHA: "1".repeat(40), artifactSHA256: "2".repeat(64) },
  consentExpiresAt: NOW + 300_000, maxOutputTokens: 128, now: NOW
};

describe("Cloudflare selected-text preview", () => {
  it("prepares exact immutable request and disclosure without network or credential setup", () => {
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("unexpected network"); });
    try {
      const preview = prepareCloudflareAnalysis(INPUT, OPTIONS);
      expect(network).not.toHaveBeenCalled();
      expect(preview.endpoint).toBe(`https://api.cloudflare.com/client/v4/accounts/${DESTINATION.accountID}/ai/v1/chat/completions`);
      expect(preview.requestBody).toEqual({
        model: "@cf/openai/gpt-oss-120b",
        messages: [{ role: "system", content: PURPOSE_INSTRUCTIONS.documentation }, { role: "user", content: INPUT.selected_text }],
        reasoning_effort: "low", max_tokens: 128, stream: false
      });
      expect(preview).toMatchObject({ agentID: CLOUDFLARE_AGENT_ID, componentID: CLOUDFLARE_COMPONENT_ID,
        providerID: "cloudflare-workers-ai", reasoning: "low", reasoningBudgetSemantics: "unverified" });
      expect(Object.isFrozen(preview.requestBody.messages[1])).toBe(true);
      expect(validateCloudflarePreview(JSON.parse(JSON.stringify(preview)), NOW)).toEqual(preview);
      expect(prepareCloudflareAnalysis(INPUT, OPTIONS)).toEqual(preview);
    } finally { network.mockRestore(); }
  });

  it("keeps logical identity independent of provider credentials and grants no action permissions", () => {
    expect(cloudflareAgentProfile()).toMatchObject({ id: "pocket-cloud-analyst", permanent: true, permissions: [] });
    expect(cloudflareAgentProfile()).toEqual(cloudflareAgentProfile());
    expect(Object.isFrozen(CLOUDFLARE_ANALYSIS_MODELS)).toBe(true);
    expect(() => { (CLOUDFLARE_ANALYSIS_MODELS as any)[0] = "@cf/other/model"; }).toThrow();
  });

  it.each(["test-summary", "design-review"] as const)("binds %s instructions and purpose", purpose => {
    const preview = prepareCloudflareAnalysis({ ...INPUT, purpose }, OPTIONS);
    expect(preview.requestBody.messages[0].content).toBe(PURPOSE_INSTRUCTIONS[purpose]);
    expect(preview.digest).not.toBe(prepareCloudflareAnalysis(INPUT, OPTIONS).digest);
  });

  it.each([
    ["task", (p: any) => { p.taskID = "different-task"; }],
    ["attempt", (p: any) => { p.attemptID = "00000000-0000-4000-8000-000000000002"; }],
    ["account", (p: any) => { p.destination.accountID = "b".repeat(32); }],
    ["model", (p: any) => { p.destination.modelID = "@cf/other/model"; }],
    ["endpoint", (p: any) => { p.endpoint = "https://example.invalid/chat/completions"; }],
    ["text", (p: any) => { p.requestBody.messages[1].content += " extra"; }],
    ["system instruction", (p: any) => { p.requestBody.messages[0].content = "Do something else"; }],
    ["cap", (p: any) => { p.requestBody.max_tokens = 512; }],
    ["reasoning", (p: any) => { p.reasoning = "none"; }],
    ["expiry", (p: any) => { p.consentExpiresAt -= 1; }],
    ["release", (p: any) => { p.release.commitSHA = "3".repeat(40); }],
    ["tool declaration", (p: any) => { p.requestBody.tools = []; }]
  ])("rejects tampered %s", (_name, mutate) => {
    const changed = JSON.parse(JSON.stringify(prepareCloudflareAnalysis(INPUT, OPTIONS)));
    mutate(changed);
    expect(() => validateCloudflarePreview(changed, NOW)).toThrow("preview_mismatch");
  });

  it("rejects hooks and hidden additions without invoking supplied code", () => {
    const preview = prepareCloudflareAnalysis(INPUT, OPTIONS);
    const getter = vi.fn(() => "hidden");
    const toJSON = vi.fn(() => preview);
    const accessor = { ...preview };
    Object.defineProperty(accessor, "extra", { get: getter, enumerable: true });
    for (const value of [accessor, { ...preview, toJSON }, { ...preview, extra: undefined }, { ...preview, [Symbol()]: true }]) {
      expect(() => validateCloudflarePreview(value, NOW)).toThrow("preview_mismatch");
    }
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  it.each(["", "a".repeat(31), "a".repeat(33), "g".repeat(32), "A".repeat(32), "a".repeat(32) + "\n"])("rejects invalid account identity %j", accountID => {
    expect(() => prepareCloudflareAnalysis(INPUT, { ...OPTIONS, destination: { ...DESTINATION, accountID } })).toThrow("invalid_configuration");
  });

  it("accepts the explicit namespaced model without widening task identifier rules", () => {
    expect(prepareCloudflareAnalysis(INPUT, OPTIONS).destination.modelID).toBe("@cf/openai/gpt-oss-120b");
    expect(() => prepareCloudflareAnalysis({ ...INPUT, task_id: "@cf/task/name" }, OPTIONS)).toThrow("invalid_request");
    expect(() => prepareCloudflareAnalysis(INPUT, { ...OPTIONS, destination: { ...DESTINATION, modelID: "@cf/other/model" as any } })).toThrow("invalid_configuration");
  });

  it.each([0, 513, 1.5, NaN])("rejects unsupported output parameter %s", maxOutputTokens => {
    expect(() => prepareCloudflareAnalysis(INPUT, { ...OPTIONS, maxOutputTokens })).toThrow("invalid_request");
  });

  it("enforces byte, Unicode, expiry and exact input/release boundaries", () => {
    expect(prepareCloudflareAnalysis({ ...INPUT, selected_text: "é".repeat(2_000) }, OPTIONS).requestBody.messages[1].content).toHaveLength(2_000);
    for (const selected_text of ["é".repeat(2_001), "broken\ud800", " "]) {
      expect(() => prepareCloudflareAnalysis({ ...INPUT, selected_text }, OPTIONS)).toThrow("invalid_request");
    }
    expect(() => prepareCloudflareAnalysis({ ...INPUT, history: [] }, OPTIONS)).toThrow("invalid_request");
    for (const consentExpiresAt of [NOW, NOW - 1, NOW + 300_001]) {
      expect(() => prepareCloudflareAnalysis(INPUT, { ...OPTIONS, consentExpiresAt })).toThrow("consent_expired");
    }
    expect(() => prepareCloudflareAnalysis(INPUT, { ...OPTIONS, release: { ...OPTIONS.release, artifactSHA256: "invalid" } })).toThrow("invalid_configuration");
  });
});
