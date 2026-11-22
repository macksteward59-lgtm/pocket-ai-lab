import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { openProjectSources } from "../../apps/web/project-sources.mjs";
import { makeBundle, publishBundle, readPublishedRegister } from "./register.mjs";

const endpoint = "https://pocket-ai-lab-preview.macksteward59.workers.dev/mcp";

export function handoffTransport(key, send = fetch) {
  if (!/^[0-9a-f]{64}$/.test(key ?? "")) throw Error("Configure the preview note-editor credential in MCP_NOTE_WRITE_KEY.");
  async function call(name, args) {
    const response = await send(endpoint, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(12000),
      headers: { authorization: "Bearer " + key, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-03-26" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
    });
    if (!response.ok) throw Error("Cloudflare handoff HTTP " + response.status);
    const rpc = await response.json();
    if (rpc.jsonrpc !== "2.0" || rpc.id !== 1 || rpc.result?.isError || !rpc.result?.structuredContent) {
      throw Error("Cloudflare did not confirm " + name);
    }
    return rpc.result.structuredContent;
  }
  return {
    read: attemptID => call("document_handoff_read", { attemptID }),
    create: note => call("document_handoff_save", { ...note, expectedRevision: 0 })
  };
}

export function evaluateCases(index, cases) {
  return cases.map(({id, question, support}) => {
    const returned = index.lookup(question).map(result => result.id);
    const position = returned.indexOf(support);
    return { id, support, rank: position < 0 ? null : position + 1, returned };
  });
}

async function run([command, ...words]) {
  const bundle = makeBundle();
  if (command === "plan" && !words.length) return bundle;
  if (!["publish", "search", "evaluate"].includes(command) || (command === "search" ? !words.length : words.length)) {
    throw Error("Usage: node tools/source-handoff/cli.mjs plan | publish | search <question> | evaluate");
  }
  const transport = handoffTransport(process.env.MCP_NOTE_WRITE_KEY);
  if (command === "publish") return publishBundle(bundle, transport);
  const register = await readPublishedRegister(bundle, transport.read);
  const index = openProjectSources(register);
  try {
    if (command === "search") return { indexID: bundle.index.attemptID, candidates: index.lookup(words.join(" ")) };
    const { cases } = JSON.parse(readFileSync(new URL("./recall-cases.json", import.meta.url)));
    return { indexID: bundle.index.attemptID, rows: evaluateCases(index, cases) };
  } finally {
    index.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then(value => console.log(JSON.stringify(value, null, 2))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
