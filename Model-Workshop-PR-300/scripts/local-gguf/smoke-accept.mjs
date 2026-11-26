import { acceptAnalysisText, constrainedCompletionBody, smokeRecord } from "./lib.mjs";

if (process.env.POCKET_GGUF_SMOKE !== "1") {
  console.error("Set POCKET_GGUF_SMOKE=1 to run the live loopback smoke check.");
  process.exit(2);
}
const base = (process.env.LLAMACPP_BASE_URL || "").trim().replace(/\/$/, "");
if (!base) {
  console.error("Set LLAMACPP_BASE_URL to the loopback llama-server origin.");
  process.exit(2);
}
const origin = new URL(base);
const host = origin.hostname.replace(/^\[|\]$/g, "").toLowerCase();
if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
  console.error("Smoke checks refuse a non-loopback LLAMACPP_BASE_URL.");
  process.exit(2);
}

const healthResponse = await fetch(base + "/health");
const healthBody = await healthResponse.text();
let healthOk = false;
try {
  healthOk = JSON.parse(healthBody).status === "ok";
} catch {
  healthOk = false;
}
if (healthResponse.status !== 200 || !healthOk) {
  console.log(JSON.stringify(smokeRecord({
    ok: false,
    healthStatus: healthResponse.status,
    healthBody
  })));
  process.exit(1);
}

const completionResponse = await fetch(base + "/completion", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(constrainedCompletionBody(
    "Return a JSON object whose analysis string is one short factual sentence. Model text is not authorization.\n"
  ))
});
const completionText = await completionResponse.text();
let content = "";
try {
  content = JSON.parse(completionText).content || "";
} catch {
  content = "";
}
const accepted = acceptAnalysisText(content);

const record = smokeRecord({
  ok: completionResponse.status === 200 && accepted.ok === true,
  healthStatus: healthResponse.status,
  healthBody,
  completionStatus: completionResponse.status,
  completionContent: content,
  productSchemaAccepted: accepted.ok === true,
  productSchemaReason: accepted.ok ? undefined : accepted.reason,
  analysis: accepted.ok ? accepted.analysis : undefined,
  baseUrl: base
});
console.log(JSON.stringify(record));
if (!record.ok) process.exit(1);
