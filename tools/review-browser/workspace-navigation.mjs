import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { createServer } from "../../apps/web/server.mjs";

const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const FAKE_MODEL = "workspace-fake-provider";
const ENV_KEYS = ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY", "LLAMACPP_BASE_URL", "LLAMACPP_API",
  "LLAMACPP_MODEL_ALIAS", "POCKET_MEMORY_DIR", "HOST"];
const question = "Does an array preserve the order of its values?";
const passage = "Values in a JSON array have a defined order.\nA JSON object groups name/value pairs without defining an order for those pairs.";

async function closeServer(server) {
  if (!server?.listening) return;
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections();
  await closed;
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return "http://127.0.0.1:" + server.address().port;
}

// This is a deterministic fake provider, not evidence of language-model quality.
// Requests still traverse the real browser UI, /api/chat route and llama.cpp adapter.
async function fixture(t, engine, contextOptions = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "pocket-workspace-browser-"));
  const previous = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  const providerRequests = [], chatRequests = [], held = [];
  let browser, app;
  const provider = createHttpServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
      res.writeHead(404); res.end(); return;
    }
    let body = "";
    for await (const part of req) body += part;
    const request = JSON.parse(body);
    providerRequests.push(request);
    const prompt = request.messages.at(-1).content;
    const send = analysis => {
      if (res.destroyed) return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: FAKE_MODEL,
        choices: [{ message: { role: "assistant", content: JSON.stringify({ analysis, confidence: 0.5 }) } }] }));
    };
    // The existing adapter emits a flat prompt containing earlier turns. Only
    // the final current-request marker may control this deterministic fixture.
    if (prompt.trimEnd().endsWith("hold-origin-reply")) {
      held.push(() => send("Fake provider held reply for the originating chat"));
      return;
    }
    const kind = ["tool", "agent", "team"].find(kind => prompt.trimEnd().endsWith("create-" + kind + "-fixture"));
    if (kind) {
      send(JSON.stringify({ name: "AI " + kind + " fixture", description: "Draft returned by the fake-provider test fixture.",
        instructions: "Review source evidence and report it to the front assistant. This test draft grants no capabilities." }));
      return;
    }
    send("Fake provider reply " + providerRequests.length);
  });
  t.after(async () => {
    held.splice(0).forEach(release => release());
    await browser?.close();
    await closeServer(app);
    await closeServer(provider);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });
  const providerUrl = await listen(provider);
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, { LLAMACPP_BASE_URL: providerUrl, LLAMACPP_API: "openai-chat",
    LLAMACPP_MODEL_ALIAS: FAKE_MODEL, POCKET_MEMORY_DIR: path.join(dir, "memory") });
  app = createServer();
  // Observe actual HTTP requests, including requests initiated under a service worker.
  app.on("request", req => {
    if (req.url !== "/api/chat" || req.method !== "POST") return;
    let raw = "";
    req.on("data", bytes => { raw += bytes; });
    req.on("end", () => { chatRequests.push(JSON.parse(raw)); });
  });
  const url = await listen(app);
  async function launch() {
    browser = await engine.launchPersistentContext(path.join(dir, "profile"), { ...mobile, ...contextOptions });
    const page = browser.pages()[0] ?? await browser.newPage();
    page.setDefaultTimeout(12000);
    await page.goto(url);
    await page.locator('#workspace-shell[data-ready="true"]').waitFor();
    return page;
  }
  const page = await launch();
  return { page, url, providerRequests, chatRequests,
    async waitHeld() {
      // Wait for the actual adapter request, not just an optimistic pending slot.
      for (let attempts = 0; !held.length; attempts++) {
        assert.ok(attempts < 600, "the delayed request reached the fake provider");
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    },
    releaseHeld() { assert.ok(held.length, "the fake provider has an originating request to release"); held.splice(0).forEach(release => release()); },
    async restartOffline() {
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      await browser.close(); browser = undefined;
      // The restarted app must load from its actual service-worker cache.
      await closeServer(app);
      return launch();
    },
  };
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const { openWorkspace } = await import("/workspace/store.js");
    const store = await openWorkspace();
    try { return await store.snapshot(); } finally { store.close(); }
  });
}

async function conversation(page, id) {
  return page.evaluate(async id => {
    const { openWorkspace } = await import("/workspace/store.js");
    const store = await openWorkspace();
    try { return await store.loadConversation(id); } finally { store.close(); }
  }, id);
}

async function waitForAsync(page, predicate, argument, description = "asynchronous browser condition") {
  // Playwright 1.57's waitForFunction tests the returned Promise for truthiness
  // before it resolves. Evaluate and await each boolean explicitly instead.
  const deadline = Date.now() + 12000;
  while (true) {
    if (await page.evaluate(predicate, argument) === true) return;
    assert.ok(Date.now() < deadline, "Timed out waiting for " + description);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

async function waitSelection(page, expected) {
  await waitForAsync(page, async expected => {
    const { openWorkspace } = await import("/workspace/store.js");
    const store = await openWorkspace();
    try {
      const { selection, conversations, projects } = await store.snapshot();
      const selected = conversations.find(item => item.id === selection?.conversationId);
      const project = projects.find(item => item.id === expected.projectId);
      const scope = document.getElementById("workspace-scope").textContent;
      return selected && selected.projectId === expected.projectId &&
        (!expected.id || selected.id === expected.id) && (!expected.differentFrom || selected.id !== expected.differentFrom) &&
        (project ? scope.includes(project.name) : /individual/i.test(scope)) &&
        document.getElementById("workspace-shell").dataset.navigating !== "true" &&
        document.getElementById("conversation-title").textContent === selected.title;
    } finally { store.close(); }
  }, expected, "the selected conversation and its displayed form");
  const state = await snapshot(page);
  return state.conversations.find(item => item.id === state.selection.conversationId);
}

async function waitSaved(page, id, expected) {
  await waitForAsync(page, async ({ id, expected }) => {
    const { openWorkspace } = await import("/workspace/store.js");
    const store = await openWorkspace();
    try {
      const { conversation } = await store.loadConversation(id);
      return Object.entries(expected).every(([key, value]) => JSON.stringify(conversation[key]) === JSON.stringify(value));
    } finally { store.close(); }
  }, { id, expected }, "saved conversation fields: " + Object.keys(expected).join(", "));
}

async function openMenu(page) {
  const menu = page.locator("#mobile-menu");
  if (await menu.isVisible() && !(await page.locator("#sidebar").getAttribute("class")).split(/\s+/).includes("open")) await menu.click();
}

async function createProject(page, name) {
  await openMenu(page);
  await page.locator("#new-project").click();
  await page.locator("#workspace-name-input").fill(name);
  await page.locator("#workspace-name-save").click();
  await page.locator("#workspace-name-dialog").waitFor({ state: "hidden" });
  const project = page.locator("#workspace-projects button[data-project-id]").filter({ hasText: name }).first();
  await project.waitFor({ state: "attached" });
  const id = await project.getAttribute("data-project-id");
  return { id, chat: await waitSelection(page, { projectId: id }) };
}

async function newChat(page, projectId, standalone = false) {
  const previous = (await snapshot(page)).selection?.conversationId;
  await openMenu(page);
  await page.locator(standalone ? "#new-standalone-chat" : "#new-chat").click();
  return waitSelection(page, { projectId, differentFrom: previous });
}

async function selectChat(page, chat) {
  await openMenu(page);
  await page.locator('[data-conversation-id="' + chat.id + '"]').click();
  return waitSelection(page, { projectId: chat.projectId, id: chat.id });
}

async function renameChat(page, name) {
  await page.locator("#conversation-rename").click();
  await page.locator("#workspace-name-input").fill(name);
  await page.locator("#workspace-name-save").click();
  await page.locator("#conversation-title").filter({ hasText: name }).waitFor();
}

async function send(page, prompt, answer) {
  await page.locator("#prompt").fill(prompt);
  await page.locator("#send:enabled").click();
  if (answer) await page.locator("#messages .message.assistant .message-body").filter({ hasText: answer }).waitFor();
}

async function captureEvidence(page, engine, name) {
  if (!process.env.WORKSPACE_EVIDENCE_DIR) return;
  const dir = path.resolve(process.env.WORKSPACE_EVIDENCE_DIR);
  await mkdir(dir, { recursive: true });
  if (name === "mobile-sidebar") {
    assert.ok((await page.locator("#sidebar").getAttribute("class")).split(/\s+/).includes("open"));
    await page.locator("#new-project").scrollIntoViewIfNeeded();
  }
  await page.screenshot({ path: path.join(dir, engine.name() + "-workspace-" + name + ".png"), fullPage: true, animations: "disabled" });
}

for (const engine of [chromium, webkit]) {
  test(engine.name() + " preserves a drawer or Models view opened before workspace initialization", { timeout: 60000 }, async t => {
    // Each fresh page holds only the actual dynamic workspace import. Blocking
    // service workers makes that network gate deterministic without faking app logic.
    const f = await fixture(t, engine, { serviceWorkers: "block" });
    const initial = (await snapshot(f.page)).selection.conversationId;
    await f.page.locator("#prompt").fill("Keep this saved draft while the workspace opens.");
    await waitSaved(f.page, initial, { draft: "Keep this saved draft while the workspace opens." });
    for (const choice of ["drawer", "models"]) {
      const savedDraft = (await conversation(f.page, initial)).conversation.draft;
      const page = await f.page.context().newPage();
      page.setDefaultTimeout(12000);
      let releaseImport;
      const gate = new Promise(resolve => { releaseImport = resolve; });
      const pendingRoutes = [];
      const pattern = "**/workspace/ui.js";
      const holdImport = route => {
        const pending = gate.then(() => route.continue());
        pendingRoutes.push(pending);
        return pending;
      };
      await page.route(pattern, holdImport);
      try {
        const requested = page.waitForRequest(pattern);
        await page.goto(f.url, { waitUntil: "domcontentloaded" });
        await requested;
        assert.equal(await page.locator("#workspace-shell").getAttribute("data-ready"), "false");
        assert.ok(await page.locator("#send").isDisabled());
        assert.ok(await page.locator("#new-chat").isDisabled());
        assert.ok(!(await page.locator("#prompt").isEditable()));
        assert.equal(await page.locator("#chat-reader-source").evaluate(node => node.readOnly), true);
        assert.ok(await page.locator("#chat-create-kind").isDisabled());
        await page.evaluate(() => {
          const shell = document.getElementById("workspace-shell"), send = document.getElementById("send");
          const observed = { earlySendEnabled: false };
          const check = () => { if (shell.dataset.ready !== "true" && !send.disabled) observed.earlySendEnabled = true; };
          const observer = new MutationObserver(check);
          observer.observe(shell, { attributes: true, attributeFilter: ["data-ready"] });
          observer.observe(send, { attributes: true, attributeFilter: ["disabled"] });
          check();
          globalThis.__workspaceStartupObservation = { observed, stop: () => observer.disconnect() };
        });
        // Exercise the actual form path independently of the disabled button.
        // Its draft already exists in storage, so startup can preserve it exactly.
        await page.evaluate(text => {
          document.getElementById("prompt").value = text;
          document.getElementById("composer").requestSubmit();
        }, savedDraft);
        assert.equal(await page.locator("#prompt").inputValue(), savedDraft);
        await openMenu(page);
        await page.locator("#sidebar.open").waitFor();
        let readerId;
        if (choice === "models") {
          await page.locator('[data-view="models"]').click();
          await page.locator("#models-view:not(.hidden)").waitFor();
          assert.equal(await page.locator("#page-name").textContent(), "Model workshop");
          await page.locator("#reader-use:enabled").waitFor();
          readerId = await page.locator("#reader-use").inputValue();
          await page.locator("#reader-question").fill(question);
          await page.locator("#reader-sentences").fill(passage);
          await page.locator("#reader-chat:enabled").click();
          await page.locator("#reader-status").filter({ hasText: /Saved chats are still opening\. Choose this model again/ }).waitFor();
          assert.ok(await page.locator("#models-view").isVisible());
          assert.equal(await page.locator("#prompt").inputValue(), savedDraft);
        }
        assert.equal(await page.locator("#workspace-shell").getAttribute("data-ready"), "false");
        assert.ok(await page.locator("#send").isDisabled());
        assert.equal(f.chatRequests.length, 0);
        releaseImport();
        await page.locator('#workspace-shell[data-ready="true"]').waitFor();
        const earlySendEnabled = await page.evaluate(() => {
          const observation = globalThis.__workspaceStartupObservation;
          observation.stop();
          delete globalThis.__workspaceStartupObservation;
          return observation.observed.earlySendEnabled;
        });
        assert.equal(earlySendEnabled, false, "Send stays disabled throughout initialization");
        assert.ok(await page.locator("#send").isEnabled());
        assert.ok(await page.locator("#new-chat").isEnabled());
        assert.equal(await page.locator("#prompt").inputValue(), savedDraft);
        assert.equal((await conversation(page, initial)).conversation.modelRef, null,
          "a pre-ready reader action is not deferred into the restored chat");
        if (choice === "drawer") {
          assert.ok((await page.locator("#sidebar").getAttribute("class")).split(/\s+/).includes("open"));
          assert.ok(await page.locator("#chat-view").isVisible());
          await page.locator('[data-view="chat"]').click();
        } else {
          assert.ok(await page.locator("#models-view").isVisible());
          assert.ok(await page.locator("#chat-view").isHidden());
          assert.equal(await page.locator("#page-name").textContent(), "Model workshop");
          assert.ok(!(await page.locator("#sidebar").getAttribute("class")).split(/\s+/).includes("open"));
          // A deliberate new selection works once startup has completed.
          await page.locator("#reader-chat:enabled").click();
          await page.locator("#chat-view:not(.hidden)").waitFor();
          await page.locator("#send:enabled").waitFor();
          assert.equal((await conversation(page, initial)).conversation.modelRef.id, readerId);
          assert.equal(await page.locator("#prompt").inputValue(), savedDraft);
        }
        // Complete a real post-startup save before checking absence of queued
        // submissions; do not close the page immediately after data-ready flips.
        const nextDraft = savedDraft + " Ready for " + choice + ".";
        await page.locator("#prompt").fill(nextDraft);
        await waitSaved(page, initial, { draft: nextDraft, pendingRequestId: null });
        const restored = await conversation(page, initial);
        assert.equal(restored.messages.length, 0);
        assert.equal(restored.turns.length, 0);
        assert.equal(f.chatRequests.length, 0, "native pre-ready submit never becomes a deferred request");
        assert.equal(f.providerRequests.length, 0);
      } finally {
        releaseImport();
        await page.unroute(pattern, holdImport);
        await Promise.all(pendingRoutes);
        await page.close();
      }
    }
    assert.equal(f.chatRequests.length, 0, "startup navigation does not queue a chat request");
    assert.equal(f.providerRequests.length, 0);
  });

  test(engine.name() + " keeps project and standalone drafts, exact models and offline reader replies", { timeout: 90000 }, async t => {
    const f = await fixture(t, engine);
    let page = f.page;
    const alpha = await createProject(page, "Alpha project");
    await renameChat(page, "Alpha notes");
    await page.locator("#prompt").fill("Alpha unsent draft");
    await waitSaved(page, alpha.chat.id, { draft: "Alpha unsent draft" });
    await page.locator("#chat-choose-reader").click();
    await page.locator("#reader-use:enabled").waitFor();
    const readerId = await page.locator("#reader-use").inputValue();
    await page.locator("#reader-question").fill(question);
    await page.locator("#reader-sentences").fill(passage);
    await page.locator("#reader-chat").click();
    await page.locator("#chat-reader-context").waitFor({ state: "visible" });
    await waitForAsync(page, async ({ id, readerId }) => {
      const { openWorkspace } = await import("/workspace/store.js");
      const store = await openWorkspace();
      try { return (await store.loadConversation(id)).conversation.modelRef?.id === readerId; }
      finally { store.close(); }
    }, { id: alpha.chat.id, readerId }, "the exact reader selection to be saved");
    const selected = (await conversation(page, alpha.chat.id)).conversation.modelRef;
    assert.equal(selected.id, readerId);
    assert.equal(selected.location, "browser");
    await waitSaved(page, alpha.chat.id, { source: passage, modelRef: selected, draft: "Alpha unsent draft" });

    const beta = await createProject(page, "Beta project");
    await renameChat(page, "Beta notes");
    await page.locator("#prompt").fill("Beta unsent draft");
    await page.locator("#chat-create-kind").selectOption("agent");
    await waitSaved(page, beta.chat.id, { draft: "Beta unsent draft", draftKind: "agent", modelRef: null });
    const extra = await newChat(page, beta.id);
    assert.equal(extra.projectId, beta.id);
    const standalone = await newChat(page, null, true);
    await renameChat(page, "Individual notes");
    await page.locator("#prompt").fill("Standalone unsent draft");
    await waitSaved(page, standalone.id, { draft: "Standalone unsent draft", modelRef: null });

    await selectChat(page, alpha.chat);
    assert.equal(await page.locator("#prompt").inputValue(), "Alpha unsent draft");
    assert.equal(await page.locator("#chat-reader-source").inputValue(), passage);
    await page.reload();
    await page.locator('#workspace-shell[data-ready="true"]').waitFor();
    await waitSelection(page, { projectId: alpha.id, id: alpha.chat.id });
    assert.equal(await page.locator("#prompt").inputValue(), "Alpha unsent draft");
    assert.deepEqual((await conversation(page, alpha.chat.id)).conversation.modelRef, selected);

    page = await f.restartOffline();
    await waitSelection(page, { projectId: alpha.id, id: alpha.chat.id });
    assert.equal(await page.locator("#prompt").inputValue(), "Alpha unsent draft");
    assert.equal(await page.locator("#chat-reader-source").inputValue(), passage);
    await send(page, question);
    await page.locator("#messages .message.assistant .message-label").filter({ hasText: /LOCAL DOCUMENT READER/ }).waitFor();
    assert.match(await page.locator("#messages .message.assistant .message-body").innerText(), /Values in a JSON array have a defined order\./);
    assert.equal(f.chatRequests.length, 0, "document reader replies never fall back to /api/chat");
    await captureEvidence(page, engine, "mobile-chat");
    await openMenu(page);
    await captureEvidence(page, engine, "mobile-sidebar");
    await selectChat(page, beta.chat);
    assert.equal(await page.locator("#prompt").inputValue(), "Beta unsent draft");
    assert.equal(await page.locator("#chat-create-kind").inputValue(), "agent");
    assert.equal(await page.locator("#prompt").getAttribute("placeholder"), "Describe the agent you want to create…");
    assert.ok(await page.locator("#chat-reader-context").isHidden());
    await selectChat(page, standalone);
    assert.equal(await page.locator("#prompt").inputValue(), "Standalone unsent draft");
    assert.equal(await page.locator("#prompt").getAttribute("placeholder"), "Message Pocket AI Lab…");
    assert.equal((await snapshot(page)).projects.length, 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });

  test(engine.name() + " binds delayed replies and real provider context to their originating chat", { timeout: 90000 }, async t => {
    const f = await fixture(t, engine), page = f.page;
    const alpha = await createProject(page, "Context Alpha");
    await send(page, "alpha-context-marker", "Fake provider reply 1");
    const beta = await createProject(page, "Context Beta");
    await send(page, "beta-context-marker", "Fake provider reply 2");
    assert.deepEqual(f.chatRequests[1].conversation, []);
    assert.ok(!JSON.stringify(f.providerRequests[1]).includes("alpha-context-marker"));

    await selectChat(page, alpha.chat);
    await send(page, "hold-origin-reply");
    await waitForAsync(page, async id => {
      const { openWorkspace } = await import("/workspace/store.js");
      const store = await openWorkspace();
      try { return Boolean((await store.loadConversation(id)).conversation.pendingRequestId); } finally { store.close(); }
    }, alpha.chat.id, "the originating pending request");
    await selectChat(page, beta.chat);
    assert.equal(await page.locator("#messages .message").count(), 2);
    await f.waitHeld();
    f.releaseHeld();
    await waitForAsync(page, async id => {
      const { openWorkspace } = await import("/workspace/store.js");
      const store = await openWorkspace();
      try { return (await store.loadConversation(id)).messages.some(message => message.role === "assistant" &&
        message.status === "complete" && message.text === "Fake provider held reply for the originating chat"); }
      finally { store.close(); }
    }, alpha.chat.id, "the completed reply in its originating conversation");
    assert.equal(await page.locator("#messages .message").count(), 2);
    assert.ok(!(await page.locator("#messages").innerText()).includes("held reply"));
    await selectChat(page, alpha.chat);
    await page.locator("#messages").getByText("Fake provider held reply for the originating chat", { exact: true }).waitFor();
    await send(page, "alpha-follow-up-marker", "Fake provider reply 4");
    const request = f.chatRequests.find(request => request.message === "alpha-follow-up-marker");
    assert.deepEqual(request.conversation, [
      { role: "user", content: "alpha-context-marker" }, { role: "assistant", content: "Fake provider reply 1" },
      { role: "user", content: "hold-origin-reply" }, { role: "assistant", content: "Fake provider held reply for the originating chat" },
    ]);
    const actual = f.providerRequests.at(-1);
    assert.equal(actual.model, FAKE_MODEL);
    assert.equal(actual.messages.length, 1, "the existing flat provider format remains unchanged");
    assert.equal(actual.messages[0].role, "user");
    assert.ok(actual.messages[0].content.includes("alpha-context-marker"));
    assert.ok(actual.messages[0].content.includes("Fake provider reply 1"));
    assert.ok(actual.messages[0].content.includes("hold-origin-reply"));
    assert.ok(actual.messages[0].content.trimEnd().endsWith("alpha-follow-up-marker"));
    assert.ok(!actual.messages[0].content.includes("beta-context-marker"));
    assert.equal((await conversation(page, beta.chat.id)).messages.length, 2);
  });

  test(engine.name() + " preserves raw whitespace and never resurrects a submitted draft after reload", { timeout: 90000 }, async t => {
    const f = await fixture(t, engine), page = f.page;
    const project = await createProject(page, "Whitespace preservation");
    const raw = "  \tPreserve this leading whitespace.\n    Keep this indentation too.  \n";
    await page.locator("#prompt").fill(raw);
    await waitSaved(page, project.chat.id, { draft: raw });
    await page.reload();
    await page.locator('#workspace-shell[data-ready="true"]').waitFor();
    assert.equal(await page.locator("#prompt").inputValue(), raw);

    await send(page, raw, "Fake provider reply 1");
    await waitSaved(page, project.chat.id, { draft: "", pendingRequestId: null });
    let saved = await conversation(page, project.chat.id);
    assert.equal(saved.messages.find(message => message.role === "user").text, raw);
    assert.equal(await page.locator("#messages .message.user .message-body").textContent(), raw);
    assert.equal(f.chatRequests[0].message, raw);
    assert.ok(f.providerRequests[0].messages[0].content.endsWith(raw), "the actual provider prompt keeps the raw current request");
    assert.equal(await page.locator("#prompt").inputValue(), "");

    await page.reload();
    await page.locator('#workspace-shell[data-ready="true"]').waitFor();
    await waitSelection(page, { projectId: project.id, id: project.chat.id });
    assert.equal(await page.locator("#prompt").inputValue(), "");
    saved = await conversation(page, project.chat.id);
    assert.equal(saved.conversation.draft, "");
    assert.equal(saved.messages.filter(message => message.role === "user").length, 1);
    assert.equal(saved.messages.find(message => message.role === "user").text, raw);
    assert.equal(f.chatRequests.length, 1, "reload never resends the submitted message");
  });

  test(engine.name() + " preserves another tab's newer draft when a delayed reply completes", { timeout: 90000 }, async t => {
    const f = await fixture(t, engine), first = f.page;
    const project = await createProject(first, "Concurrent draft review");
    await send(first, "hold-origin-reply");
    await f.waitHeld();
    assert.equal(await first.locator("#prompt").inputValue(), "");

    // Both tabs use the real app and separate live IDB connections to one profile.
    const second = await first.context().newPage();
    second.setDefaultTimeout(12000);
    await second.goto(f.url);
    await second.locator('#workspace-shell[data-ready="true"]').waitFor();
    await waitSelection(second, { projectId: project.id, id: project.chat.id });
    await second.locator("#workspace-pending").waitFor({ state: "visible" });
    await second.locator("#prompt").fill("B newer saved draft");
    await waitSaved(second, project.chat.id, { draft: "B newer saved draft" });
    f.releaseHeld();

    await first.locator("#messages .message.assistant .message-body").filter({ hasText: "Fake provider held reply for the originating chat" }).waitFor();
    await first.locator("#workspace-ready-status").filter({ hasText: /changed in another tab/ }).waitFor();
    assert.equal(await first.locator("#prompt").inputValue(), "", "completion preserves the first tab's visible form");
    assert.equal((await conversation(first, project.chat.id)).conversation.draft, "B newer saved draft");

    // An unchanged old form can explicitly reopen the saved conversation without
    // being forced to create a copy or replacing the other tab's newer text.
    const countBeforeReopen = (await snapshot(first)).conversations.length;
    await selectChat(first, project.chat);
    assert.equal(await first.locator("#prompt").inputValue(), "B newer saved draft");
    assert.ok(await first.locator("#send").isEnabled());
    assert.equal((await snapshot(first)).conversations.length, countBeforeReopen);

    // Repeat the actual concurrent-completion path, then preserve a divergent
    // first-tab draft through explicit copy recovery.
    await send(first, "hold-origin-reply");
    await f.waitHeld();
    const nextReply = (await conversation(first, project.chat.id)).turns.at(-1).assistantMessageId;
    await selectChat(second, project.chat);
    await second.locator("#workspace-pending").waitFor({ state: "visible" });
    await second.locator("#prompt").fill("B newest saved draft");
    await waitSaved(second, project.chat.id, { draft: "B newest saved draft" });
    f.releaseHeld();
    await first.locator('[data-message-id="' + nextReply + '"] .message-body').filter({ hasText: "Fake provider held reply for the originating chat" }).waitFor();
    await first.locator("#workspace-ready-status").filter({ hasText: /changed in another tab/ }).waitFor();
    await first.locator("#prompt").fill("A unsaved copy");
    // Wait for the attempted debounced save to report a conflict; do not rely on a sleep.
    await first.locator("#workspace-ready-status").filter({ hasText: /Keep this draft in a new chat before reopening/ }).waitFor();
    assert.equal((await conversation(first, project.chat.id)).conversation.draft, "B newest saved draft");
    assert.equal(await first.locator("#prompt").inputValue(), "A unsaved copy");
    await first.locator("#workspace-save-copy").click();
    const recovered = await waitSelection(first, { projectId: project.id, differentFrom: project.chat.id });
    await waitSaved(first, recovered.id, { draft: "A unsaved copy" });
    assert.equal(await first.locator("#prompt").inputValue(), "A unsaved copy");
    const original = await conversation(first, project.chat.id);
    assert.equal(original.conversation.draft, "B newest saved draft");
    assert.equal(original.conversation.pendingRequestId, null);
    assert.equal(original.messages.length, 4);
    assert.ok(original.messages.filter(message => message.role === "assistant").every(message =>
      message.text === "Fake provider held reply for the originating chat"));
    assert.equal((await conversation(first, recovered.id)).messages.length, 0);
    assert.equal(f.chatRequests.length, 2, "the two deliberate requests complete without a conflict-recovery retry");
    await selectChat(second, project.chat);
    assert.equal(await second.locator("#prompt").inputValue(), "B newest saved draft");
  });

  test(engine.name() + " keeps newly typed text while the exact browser reader restores slowly", { timeout: 90000 }, async t => {
    // Only this timing test blocks service workers so the real catalog fetch can
    // be held deterministically. Its response still comes from the actual server.
    const f = await fixture(t, engine, { serviceWorkers: "block" }), page = f.page;
    const project = await createProject(page, "Slow model restoration");
    await renameChat(page, "Reader return");
    await page.locator("#chat-choose-reader").click();
    await page.locator("#reader-use:enabled").waitFor();
    const readerId = await page.locator("#reader-use").inputValue();
    await page.locator("#reader-question").fill(question);
    await page.locator("#reader-sentences").fill(passage);
    await page.locator("#reader-chat").click();
    await page.locator("#chat-reader-context").waitFor({ state: "visible" });
    await page.locator("#send:enabled").waitFor();
    await page.locator("#prompt").fill("Saved reader draft");
    await waitSaved(page, project.chat.id, { draft: "Saved reader draft", source: passage });
    const readerRef = (await conversation(page, project.chat.id)).conversation.modelRef;
    assert.equal(readerRef.id, readerId);
    const other = await newChat(page, null, true);
    await renameChat(page, "Other chat");
    await page.locator("#prompt").fill("Other chat's independent draft");
    await waitSaved(page, other.id, { draft: "Other chat's independent draft" });

    let releaseAsset;
    const gate = new Promise(resolve => { releaseAsset = resolve; });
    const pattern = "**/model-workshop/hard.json";
    const holdAsset = async route => { await gate; await route.continue(); };
    await page.route(pattern, holdAsset);
    try {
      const requested = page.waitForRequest(pattern);
      await openMenu(page);
      await page.locator('[data-conversation-id="' + project.chat.id + '"]').click();
      await requested;
      assert.equal(await page.locator("#conversation-title").textContent(), "Reader return");
      assert.equal(await page.locator("#prompt").inputValue(), "Saved reader draft");
      await page.locator("#prompt").fill("Typed while the exact reader was restoring");
      assert.ok(await page.locator("#send").isDisabled(), "an unresolved exact model cannot be used yet");
      assert.equal(await page.locator("#prompt").inputValue(), "Typed while the exact reader was restoring");
      releaseAsset();
      await page.locator("#send:enabled").waitFor();
      assert.equal(await page.locator("#prompt").inputValue(), "Typed while the exact reader was restoring");
      assert.equal(await page.locator("#chat-reader-source").inputValue(), passage);
      await waitSaved(page, project.chat.id, { draft: "Typed while the exact reader was restoring", modelRef: readerRef });
    } finally {
      releaseAsset();
      await page.unroute(pattern, holdAsset);
    }
    await page.reload();
    await page.locator('#workspace-shell[data-ready="true"]').waitFor();
    assert.equal(await page.locator("#prompt").inputValue(), "Typed while the exact reader was restoring");
    assert.deepEqual((await conversation(page, project.chat.id)).conversation.modelRef, readerRef);
    assert.equal((await conversation(page, other.id)).conversation.draft, "Other chat's independent draft");
    assert.equal(f.chatRequests.length, 0);
  });

  test(engine.name() + " completes one reply when a presentation read fails after the turn commits", { timeout: 45000 }, async t => {
    const f = await fixture(t, engine), page = f.page;
    const project = await createProject(page, "Transient presentation read");
    try {
      await page.evaluate(id => {
        const prototype = IDBObjectStore.prototype;
        const get = Object.getOwnPropertyDescriptor(prototype, "get");
        const put = Object.getOwnPropertyDescriptor(prototype, "put");
        const fault = { pendingPutSeen: false, committed: false, armed: false, injected: 0, requestId: null };
        globalThis.__workspaceOneShotReadFault = fault;
        fault.restore = () => {
          Object.defineProperty(prototype, "get", get);
          Object.defineProperty(prototype, "put", put);
          delete globalThis.__workspaceOneShotReadFault;
        };
        const target = store => store.name === "conversations" &&
          store.transaction.db.name === "pocket-ai-lab-conversational-workspace";
        Object.defineProperty(prototype, "put", { ...put, value: function (...args) {
          const request = Reflect.apply(put.value, this, args);
          const value = args[0];
          if (!fault.pendingPutSeen && target(this) && this.transaction.mode === "readwrite" &&
              value?.id === id && typeof value.pendingRequestId === "string") {
            fault.pendingPutSeen = true;
            fault.requestId = value.pendingRequestId;
            // Observe the native transaction. Only the later readonly get fails;
            // beginTurn's real writes and completion handler remain intact.
            this.transaction.addEventListener("complete", () => { fault.committed = true; fault.armed = true; }, { once: true });
          }
          return request;
        } });
        Object.defineProperty(prototype, "get", { ...get, value: function (...args) {
          if (fault.armed && !fault.injected && target(this) && this.transaction.mode === "readonly" && args[0] === id) {
            fault.armed = false;
            fault.injected++;
            throw new DOMException("Synthetic one-shot conversation presentation read failure", "UnknownError");
          }
          return Reflect.apply(get.value, this, args);
        } });
      }, project.chat.id);
      // Leave the default conversation title in place: its normal title-write
      // transaction also completes before the presentation read under test.
      await send(page, "Continue the committed request after one transient view-read failure.");
      await page.waitForFunction(() => globalThis.__workspaceOneShotReadFault?.injected === 1);
      await page.locator("#messages .message.assistant .message-body").filter({ hasText: "Fake provider reply 1" }).waitFor();
      const injected = await page.evaluate(() => {
        const { pendingPutSeen, committed, injected, requestId } = globalThis.__workspaceOneShotReadFault;
        return { pendingPutSeen, committed, injected, requestId };
      });
      assert.equal(injected.pendingPutSeen, true);
      assert.equal(injected.committed, true);
      assert.equal(injected.injected, 1);
      assert.equal(f.chatRequests.length, 1, "the saved request is dispatched exactly once despite the read failure");
      assert.equal(f.providerRequests.length, 1, "the actual configured-provider adapter is invoked exactly once");
      const saved = await conversation(page, project.chat.id);
      assert.equal(saved.conversation.pendingRequestId, null);
      assert.equal(saved.turns.length, 1);
      assert.equal(saved.turns[0].requestId, injected.requestId);
      assert.equal(saved.turns[0].status, "complete");
      assert.equal(saved.messages.length, 2);
      assert.equal(saved.messages.find(message => message.role === "assistant").text, "Fake provider reply 1");
      assert.ok(saved.messages.every(message => message.status === "complete"));
      assert.equal(await page.locator("#messages .message.pending").count(), 0);
      assert.ok(await page.locator("#workspace-pending").isHidden());
      assert.ok(await page.locator("#send").isEnabled());
    } finally {
      if (!page.isClosed()) await page.evaluate(() => globalThis.__workspaceOneShotReadFault?.restore());
    }
  });

  test(engine.name() + " performs revision checks across two real IndexedDB connections", { timeout: 45000 }, async t => {
    const { page } = await fixture(t, engine);
    const result = await page.evaluate(async () => {
      const { openWorkspace } = await import("/workspace/store.js");
      const left = await openWorkspace(), right = await openWorkspace();
      try {
        const chat = await left.createConversation({ projectId: null, title: "Concurrent writer fixture", modelRef: null });
        const [a, b] = await Promise.all([left.loadConversation(chat.id), right.loadConversation(chat.id)]);
        const writes = await Promise.allSettled([
          left.updateConversation(chat.id, a.conversation.revision, { draft: "Left writer" }),
          right.updateConversation(chat.id, b.conversation.revision, { draft: "Right writer" }),
        ]);
        const saved = await right.loadConversation(chat.id);
        const afterReload = await left.updateConversation(chat.id, saved.conversation.revision, { draft: "Explicit update after reload" });
        return { initial: [a.conversation.revision, b.conversation.revision],
          writes: writes.map(result => result.status === "fulfilled" ? { status: result.status, draft: result.value.draft }
            : { status: result.status, code: result.reason.code }), saved: saved.conversation, afterReload };
      } finally { left.close(); right.close(); }
    });
    assert.deepEqual(result.initial, [1, 1]);
    assert.equal(result.writes.filter(result => result.status === "fulfilled").length, 1);
    assert.deepEqual(result.writes.find(result => result.status === "rejected"), { status: "rejected", code: "conflict" });
    assert.equal(result.saved.revision, 2);
    assert.equal(result.saved.draft, result.writes.find(result => result.status === "fulfilled").draft);
    assert.equal(result.afterReload.revision, 3);
    assert.equal(result.afterReload.draft, "Explicit update after reload");
  });

  test(engine.name() + " creates scoped user and fake-provider-assisted tool, agent and team drafts", { timeout: 90000 }, async t => {
    const f = await fixture(t, engine), page = f.page;
    const manual = await createProject(page, "Manual definitions");
    for (const kind of ["tool", "agent", "team"]) {
      await openMenu(page);
      await page.locator('[data-resource-kind="' + kind + '"]').click();
      await page.locator("#resource-create").click();
      await page.locator("#resource-name").fill("Manual " + kind + " fixture");
      await page.locator("#resource-description").fill("A user-authored " + kind + " definition.");
      await page.locator("#resource-instructions").fill("Review evidence and return a proposal. This draft has no execution permissions.");
      await page.locator("#resource-save").click();
      await page.locator("#resource-dialog").waitFor({ state: "hidden" });
      const card = page.locator("#resource-list .resource-card").filter({ has: page.locator("h2", { hasText: "Manual " + kind + " fixture" }) });
      await card.waitFor();
      assert.match(await card.locator(".resource-meta").innerText(), /Draft.*Created by you/);
    }
    let saved = await snapshot(page);
    assert.equal(saved.resources.length, 3);
    for (const resource of saved.resources) {
      assert.equal(resource.projectId, manual.id);
      assert.equal(resource.createdBy, "user");
      assert.equal(resource.state, "draft");
      assert.equal(resource.requestId, undefined);
    }
    assert.equal(f.providerRequests.length, 0, "manual definitions do not call a model");

    const assisted = await createProject(page, "Assistant definitions");
    for (const kind of ["tool", "agent", "team"]) {
      await openMenu(page);
      await page.locator('[data-resource-kind="' + kind + '"]').click();
      assert.ok(!(await page.locator("#resource-list").innerText()).includes("Manual " + kind + " fixture"));
      await page.locator("#resource-ask").click();
      assert.equal(await page.locator("#chat-create-kind").inputValue(), kind);
      await send(page, "create-" + kind + "-fixture", "Created a " + kind + " draft: AI " + kind + " fixture");
      await openMenu(page);
      await page.locator('[data-resource-kind="' + kind + '"]').click();
      const card = page.locator("#resource-list .resource-card").filter({ has: page.locator("h2", { hasText: "AI " + kind + " fixture" }) });
      await card.waitFor();
      assert.match(await card.locator(".resource-meta").innerText(), /Draft.*Created by assistant/);
      const state = await snapshot(page);
      const resource = state.resources.find(resource => resource.name === "AI " + kind + " fixture");
      assert.equal(resource.kind, kind);
      assert.equal(resource.projectId, assisted.id);
      assert.equal(resource.createdBy, "assistant");
      assert.equal(resource.state, "draft");
      const origin = await conversation(page, assisted.chat.id);
      const turn = origin.turns.find(turn => turn.requestId === resource.requestId);
      assert.equal(turn.kind, "resource-draft");
      assert.equal(turn.resourceKind, kind);
      assert.equal(turn.projectId, assisted.id);
      assert.equal(turn.status, "complete");
      const request = f.chatRequests.find(request => request.message.includes("create-" + kind + "-fixture"));
      assert.deepEqual(request.conversation, [], "draft-authoring requests do not replay ordinary chat context");
    }
    assert.equal(f.providerRequests.length, 3, "each assistant draft traversed the actual configured-provider adapter");
    assert.ok(f.providerRequests.every(request => request.model === FAKE_MODEL));
    await captureEvidence(page, engine, "resources");

    await selectChat(page, manual.chat);
    await openMenu(page);
    await page.locator('[data-resource-kind="tool"]').click();
    assert.ok(!(await page.locator("#resource-list").innerText()).includes("AI tool fixture"));
    const manualTool = page.locator("#resource-list .resource-card").filter({ hasText: "Manual tool fixture" });
    await manualTool.getByRole("button", { name: "Edit draft" }).click();
    await page.locator("#resource-instructions").fill("User revised this definition after reviewing its intended inputs and outputs.");
    await page.locator("#resource-save").click();
    await page.locator("#resource-dialog").waitFor({ state: "hidden" });
    saved = await snapshot(page);
    const updated = saved.resources.find(resource => resource.name === "Manual tool fixture");
    assert.equal(updated.revision, 2);
    assert.equal(updated.createdBy, "user");
    assert.equal(updated.state, "draft");
    assert.match(updated.instructions, /User revised/);

    await selectChat(page, assisted.chat);
    await page.reload();
    await page.locator('#workspace-shell[data-ready="true"]').waitFor();
    assert.equal(await page.locator("#chat-create-kind").inputValue(), "team");
    assert.equal(await page.locator("#prompt").getAttribute("placeholder"), "Describe the team you want to create…");
    saved = await snapshot(page);
    assert.equal(saved.resources.length, 6);
    assert.ok(saved.resources.every(resource => resource.state === "draft" && resource.version === 1));
    assert.equal(saved.resources.filter(resource => resource.createdBy === "assistant").length, 3);
  });
}
