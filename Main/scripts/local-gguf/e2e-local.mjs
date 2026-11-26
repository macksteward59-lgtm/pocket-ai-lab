import { createServer } from "../../apps/web/server.mjs";
import { acceptAnalysisText } from "./lib.mjs";

if (process.env.POCKET_E2E !== "1") {
  console.error("Set POCKET_E2E=1 to run the loopback app against a local llama-server.");
  process.exit(2);
}

const memoryDir = process.env.POCKET_MEMORY_DIR;
if (!memoryDir) {
  console.error("Set POCKET_MEMORY_DIR to an empty temporary directory.");
  process.exit(2);
}

const server = createServer();
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const base = "http://127.0.0.1:" + address.port;

async function post(pathname, payload) {
  const response = await fetch(base + pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  return { status: response.status, text };
}

const health = await fetch(base + "/api/health");
const healthBody = await health.json();
const chat = await post("/api/chat", { message: "Say that model text is not permission." });
let chatJson = null;
try { chatJson = JSON.parse(chat.text); } catch { chatJson = null; }
const analysis = chatJson && typeof chatJson.reply === "string" ? acceptAnalysisText(JSON.stringify({ analysis: chatJson.reply })) : { ok: false, reason: "no_reply" };
const saved = await post("/api/memory", { content: "Explicit note from the local loop. Unverified.", source: "e2e" });
const listed = await fetch(base + "/api/memory");
const listBody = await listed.json();
const agentResponse = await fetch(base + "/api/agent-tasks", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ objective: "State that nothing was authorized." })
});
const agentText = await agentResponse.text();
const doneLine = agentText.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).find(line => line.includes('"type":"done"') || line.includes('"type": "done"'));
let agentDone = null;
try { agentDone = doneLine ? JSON.parse(doneLine) : null; } catch { agentDone = null; }
const record = {
  kind: "local-app-e2e",
  hardwareAcceptance: false,
  health: { status: health.status, reachable: healthBody.reachable, loopback: healthBody.loopback },
  chat: {
    status: chat.status,
    authorized: chatJson ? chatJson.authorized : null,
    schemaAccepted: analysis.ok === true,
    reply: chatJson ? chatJson.reply : chat.text
  },
  memory: {
    saveStatus: saved.status,
    listStatus: listed.status,
    count: Array.isArray(listBody.entries) ? listBody.entries.length : 0,
    verified: Array.isArray(listBody.entries) ? listBody.entries.some(entry => entry.provenance?.verified === true) : null
  },
  agent: {
    status: agentResponse.status,
    authorized: agentDone?.result?.authorized ?? null,
    error: agentDone?.result?.error ?? null,
    hasDone: Boolean(agentDone)
  }
};
console.log(JSON.stringify(record));
server.close();
const passed = record.health.reachable === true
  && record.health.loopback === true
  && record.chat.status === 200
  && record.chat.authorized === false
  && record.chat.schemaAccepted === true
  && record.memory.saveStatus === 201
  && record.memory.count === 1
  && record.memory.verified === false
  && record.agent.authorized === false;
process.exit(passed ? 0 : 1);
