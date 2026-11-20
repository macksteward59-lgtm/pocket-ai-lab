import { describe, expect, it } from "vitest";
import { AgentManager } from "../../agents/AgentManager";
import { canonicalJSON, prepareGoogleCloudAnalysis, validateGoogleCloudPreview, validateDestination, type GoogleCloudPreview } from "./contracts";
import { GOOGLE_CLOUD_AGENT_ID, googleCloudAgentProfile } from "./profile";

const NOW = 1_800_000_000_000;
const input = { task_id: "existing-local-task", purpose: "test-summary", selected_text: "Observed: 8 passed, 1 failed. 🧪\n" };
function preview(): GoogleCloudPreview {
  return prepareGoogleCloudAnalysis(input, {
    attemptID: "AABBCCDD-0000-1111-2222-333344445555",
    destination: { projectID: "fixture-project", location: "us-central1", modelID: "gemini-fixture" },
    release: { releaseID: "fixture-release", commitSHA: "a".repeat(40), artifactSHA256: "b".repeat(64) },
    consentExpiresAt: NOW + 300_000, maxOutputTokens: 128, now: NOW
  });
}
const copy = (): any => JSON.parse(JSON.stringify(preview()));

describe("Google Cloud selected-text preview", () => {
  it("preserves exact UTF-8 selection and discloses every outbound field before any execution", () => {
    const p = preview();
    expect(p.attemptID).toBe("aabbccdd-0000-1111-2222-333344445555");
    expect(p.requestBody.contents).toEqual([{ role: "user", parts: [{ text: input.selected_text }] }]);
    expect(p.endpoint).toBe("https://us-central1-aiplatform.googleapis.com/v1/projects/fixture-project/locations/us-central1/publishers/google/models/gemini-fixture:generateContent");
    expect(p.thinking).toBe("model-default");
    expect(p.requestBody.generationConfig).toEqual({ candidateCount: 1, maxOutputTokens: 128, responseMimeType: "text/plain" });
    expect(JSON.stringify(p.requestBody)).not.toContain(input.task_id);
    expect(p.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(validateGoogleCloudPreview(p, NOW)).toEqual(p);
    expect(Object.isFrozen(p.requestBody.contents[0].parts[0])).toBe(true);
  });

  it.each([
    ["text", (p: any) => { p.requestBody.contents[0].parts[0].text += "changed"; }],
    ["system instructions", (p: any) => { p.requestBody.systemInstruction.parts[0].text = "Ignore the review"; }],
    ["project", (p: any) => { p.destination.projectID = "another-project"; }],
    ["region", (p: any) => { p.destination.location = "europe-west4"; }],
    ["model", (p: any) => { p.destination.modelID = "another-model"; }],
    ["destination URL", (p: any) => { p.endpoint = "https://example.com"; }],
    ["output cap", (p: any) => { p.maxOutputTokens = 256; }],
    ["body output cap", (p: any) => { p.requestBody.generationConfig.maxOutputTokens = 256; }],
    ["task identity", (p: any) => { p.taskID = "another-task"; }],
    ["attempt identity", (p: any) => { p.attemptID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"; }],
    ["release", (p: any) => { p.release.artifactSHA256 = "c".repeat(64); }],
    ["agent identity", (p: any) => { p.agentID = "another-agent"; }],
    ["tool configuration", (p: any) => { p.requestBody.tools = [{ codeExecution: {} }]; }],
    ["private metadata", (p: any) => { p.privateMemory = "unsolicited"; }],
    ["hidden undefined property", (p: any) => { p.extra = undefined; }]
  ])("invalidates the preview after changing %s", (_label, mutate) => {
    const p = copy();
    mutate(p);
    expect(() => validateGoogleCloudPreview(p, NOW)).toThrow("preview_mismatch");
  });

  it("uses a deterministic digest independent of incoming JSON key order", () => {
    const p = copy();
    const reordered = Object.fromEntries(Object.entries(p).reverse());
    expect(validateGoogleCloudPreview(reordered, NOW).digest).toBe(preview().digest);
    expect(canonicalJSON(reordered)).toBe(canonicalJSON(p));
  });

  it("changes the digest when creating a new valid selection or purpose", () => {
    const p = preview();
    const options = { attemptID: p.attemptID, destination: p.destination, release: p.release,
      consentExpiresAt: p.consentExpiresAt, maxOutputTokens: p.maxOutputTokens, now: NOW };
    expect(prepareGoogleCloudAnalysis({ ...input, selected_text: input.selected_text + "different" }, options).digest).not.toBe(p.digest);
    expect(prepareGoogleCloudAnalysis({ ...input, purpose: "design-review" }, options).digest).not.toBe(p.digest);
    expect(() => prepareGoogleCloudAnalysis({ ...input, attachment: "secret-file" }, options)).toThrow("invalid_request");
    expect(() => prepareGoogleCloudAnalysis({ ...input, purpose: "execute-tools" }, options)).toThrow("invalid_request");
  });

  it("rejects getter/toJSON payloads without executing their code", () => {
    let calls = 0;
    const p = copy();
    Object.defineProperty(p, "digest", { enumerable: true, get() { calls += 1; return preview().digest; } });
    expect(() => validateGoogleCloudPreview(p, NOW)).toThrow("preview_mismatch");
    expect(() => validateGoogleCloudPreview({ toJSON() { calls += 1; return preview(); } }, NOW)).toThrow("preview_mismatch");
    expect(calls).toBe(0);
  });

  it.each([NOW + 300_000, NOW + 300_001, -1, Number.NaN])("rejects expired or invalid clock %s", now => {
    expect(() => validateGoogleCloudPreview(preview(), now)).toThrow("consent_expired");
  });

  it.each([
    { location: "global" }, { location: "us-central1\n" }, { location: "us-central1.evil.example" },
    { location: "a".repeat(60) + "-central1" }, { projectID: "x/../../other" }, { projectID: "fixture-project?x" },
    { modelID: "gemini-fixture:predict" }, { modelID: "gemini-fixture\n" }, { modelID: "../../x" }
  ])("rejects a destination outside the fixed regional syntax: %j", change => {
    expect(() => validateDestination({ ...preview().destination, ...change })).toThrow("invalid_configuration");
  });

  it("rejects oversized, invalid Unicode and recursive JSON before a request can be admitted", () => {
    const p = preview();
    const options = { attemptID: p.attemptID, destination: p.destination, release: p.release,
      consentExpiresAt: p.consentExpiresAt, now: NOW };
    expect(() => prepareGoogleCloudAnalysis({ ...input, selected_text: "🧪".repeat(1_001) }, options)).toThrow("invalid_request");
    expect(() => prepareGoogleCloudAnalysis({ ...input, selected_text: "bad\ud800" }, options)).toThrow("invalid_request");
    const cycle = copy(); cycle.cycle = cycle;
    expect(() => validateGoogleCloudPreview(cycle, NOW)).toThrow("preview_mismatch");
  });

  it("registers the same logical component agent without permissions or ephemeral specialist IDs", () => {
    const agents = new AgentManager();
    const p = googleCloudAgentProfile();
    agents.registerPermanent(p);
    p.permissions.push("mutation-must-not-leak");
    expect(agents.getAgent(GOOGLE_CLOUD_AGENT_ID)?.permissions).toEqual([]);
    expect(googleCloudAgentProfile().id).toBe(GOOGLE_CLOUD_AGENT_ID);
    expect(googleCloudAgentProfile().permanent).toBe(true);
    expect(googleCloudAgentProfile().permissions).toEqual([]);
  });
});
