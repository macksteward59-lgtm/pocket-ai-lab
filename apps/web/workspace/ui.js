import { openWorkspace } from "./store.js";
import { readerReference, restoreReader } from "./reader-ref.js";
import { recentConversation, boundedChatRequest, draftAuthoringPrompt, parseResourceDraft } from "./chat-context.js";

const $ = id => document.getElementById(id);
const titles = { tool: "Tools", agent: "Agents", team: "Teams" };
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

export async function initializeWorkspace(hooks) {
  const store = await openWorkspace();
  let snapshot, activeId, loaded, selectedReader, readerFailure = "", resourceKind = "tool";
  let navigation = 0, draftTimer, dirty = false, nameAction, resourceEdit, reviewOrigin;
  let navigationLocked = false, readerLoading = false, readerGeneration = 0, ownViewChange = false;
  const known = new Map(), queues = new Map(), requests = new Map(), extras = new Map();
  const conflicts = new Set();
  let activeView = "chat";

  function notice(text = "Saved in this browser. Long-term Memory is separate.", error = false) {
    $("workspace-ready-status").textContent = text;
    $("workspace-ready-status").parentElement.classList.toggle("error", error);
    $("workspace-save-copy").hidden = !error || !(conflicts.has(activeId) || $("prompt").value || $("chat-reader-source").value);
  }
  function fail(error) { notice(error.message || String(error), true); }
  function setWorkspaceView(view) {
    ownViewChange = true;
    try { hooks.setView(view); } finally { ownViewChange = false; }
  }
  function navigationControls() {
    $("prompt").readOnly = navigationLocked;
    $("chat-reader-source").readOnly = navigationLocked;
    for (const id of ["chat-create-kind", "chat-choose-reader", "chat-use-default"]) $(id).disabled = navigationLocked;
    $("workspace-shell").dataset.navigating = String(navigationLocked);
    updateControls();
  }
  function beginNavigation() {
    const token = ++navigation;
    navigationLocked = true;
    navigationControls();
    return token;
  }
  function endNavigation(token) {
    if (token !== navigation) return;
    navigationLocked = false;
    navigationControls();
  }
  function enqueue(id, action) {
    const result = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(action);
    queues.set(id, result);
    return result;
  }
  const projectName = id => snapshot?.projects.find(project => project.id === id)?.name ?? "Unavailable project";
  const currentProject = () => known.get(activeId)?.projectId ?? null;
  const scopeName = id => id === null ? "Personal workspace" : "Project · " + projectName(id);
  function reconcileConversation(saved) {
    const previous = known.get(saved.id);
    const changed = previous && ["title", "draft", "source", "draftKind", "modelRef"].some(key => JSON.stringify(previous[key]) !== JSON.stringify(saved[key]));
    if (saved.id === activeId && (conflicts.has(saved.id) || changed)) {
      // A completion may include a newer edit made by another tab. Do not give
      // the old visible form its new revision and thereby authorize overwriting it.
      conflicts.add(saved.id);
      known.set(saved.id, { ...previous, pendingRequestId: saved.pendingRequestId, nextSequence: saved.nextSequence });
      const localEdits = Object.entries(formSnapshot()).some(([key, value]) => previous[key] !== value);
      notice(localEdits
        ? "This conversation changed in another tab. Your unsaved edits are preserved. Choose Keep draft in a new chat, then reopen the original conversation from the sidebar."
        : "This conversation changed in another tab. Reopen this chat from the sidebar to read the saved changes. Keep draft in a new chat preserves a separate copy of the visible form.", true);
    } else known.set(saved.id, saved);
  }

  function formSnapshot() {
    return { draft: $("prompt").value, source: $("chat-reader-source").value, draftKind: $("chat-create-kind").value };
  }
  async function flushDraft() {
    clearTimeout(draftTimer);
    const id = activeId;
    if (!id) return;
    const patch = formSnapshot();
    return enqueue(id, async () => {
      const chat = known.get(id);
      if (!chat) throw Error("This conversation is unavailable. Your draft remains on screen.");
      if (Object.keys(patch).every(key => chat[key] === patch[key])) {
        if (activeId === id && JSON.stringify(formSnapshot()) === JSON.stringify(patch)) dirty = false;
        return chat;
      }
      if (conflicts.has(id)) throw Error("Another tab changed this conversation. Keep this draft in a new chat before reopening the saved conversation.");
      const saved = await store.updateConversation(id, chat.revision, patch);
      known.set(id, saved);
      if (activeId === id && JSON.stringify(formSnapshot()) === JSON.stringify(patch)) {
        dirty = false;
        notice();
      }
      return saved;
    });
  }
  function scheduleDraft() {
    dirty = true;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => flushDraft().catch(fail), 180);
  }

  async function refreshSidebar() {
    snapshot = await store.snapshot();
    const projects = $("workspace-projects"), chats = $("workspace-chats");
    projects.replaceChildren(); chats.replaceChildren();
    function chatButton(chat, destination) {
      const button = element("button", chat.title, "workspace-chat");
      button.type = "button";
      button.dataset.conversationId = chat.id;
      button.dataset.pending = String(Boolean(chat.pendingRequestId));
      if (chat.id === activeId) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => activate(chat.id).catch(fail));
      destination.append(button);
    }
    for (const project of snapshot.projects) {
      const row = element("div", undefined, "workspace-tree-row");
      const button = element("button", "▱ " + project.name);
      button.type = "button"; button.dataset.projectId = project.id;
      button.addEventListener("click", () => openProject(project.id).catch(fail));
      const rename = element("button", "···", "workspace-project-rename");
      rename.type = "button"; rename.setAttribute("aria-label", "Rename project " + project.name);
      rename.addEventListener("click", () => openName({ type: "project-rename", project }));
      row.append(button, rename); projects.append(row);
      const children = element("div", undefined, "workspace-project-chats");
      for (const chat of snapshot.conversations.filter(chat => chat.projectId === project.id)) chatButton(chat, children);
      projects.append(children);
    }
    for (const chat of snapshot.conversations.filter(chat => chat.projectId === null)) chatButton(chat, chats);
    if (!snapshot.projects.length) projects.append(element("p", "Keep related work together.", "workspace-empty"));
    if (!chats.children.length) chats.append(element("p", "Conversations outside projects.", "workspace-empty"));
    if (snapshot.issues.length) notice("Some saved workspace records could not be read. They were preserved. Other conversations remain available.", true);
  }

  async function persistSelection(chat, token) {
    // Navigation is a preference, not a replacement for another tab's chat data.
    for (let attempt = 0; attempt < 2; attempt++) {
      const latest = await store.snapshot();
      if (token !== navigation) return;
      if (!latest.selection) throw Error("Saved navigation metadata is damaged. Your records were preserved; close this page and repair or restore the workspace before changing navigation.");
      try {
        return await store.setSelection({ projectId: chat.projectId, conversationId: chat.id }, latest.selection.revision);
      } catch (error) { if (error.code !== "conflict" || attempt) throw error; }
    }
  }

  function renderMessages() {
    $("messages").replaceChildren();
    for (const message of loaded.messages) {
      const pending = requests.get(message.requestId)?.unsaved;
      const text = message.role === "assistant" && pending ? pending.text : message.text;
      const body = hooks.appendMessage(message.role, text || (message.status === "pending" ? "Reply pending…" : ""), message.attribution);
      const row = body.closest("article");
      row.dataset.messageId = message.id;
      row.classList.toggle("pending", message.status === "pending");
      row.classList.toggle("unsaved", Boolean(pending));
      if (message.role === "assistant" && pending) {
        const label = element("p", "This reply is not saved yet. Retrying saves this result without requesting another reply.", "status-text");
        const retry = element("button", "Retry saving reply", "secondary-button");
        retry.type = "button";
        retry.addEventListener("click", () => saveResult(message.requestId).catch(fail));
        body.after(label, retry);
      }
      const extra = extras.get(message.id);
      if (extra && message.status === "complete") hooks.readerExtras(body, extra.reader, extra.result, extra.passage, extra.question, extra.generation);
    }
    $("welcome").classList.toggle("hidden", loaded.messages.length > 0);
  }

  function updateControls() {
    const chat = known.get(activeId);
    const pending = chat?.pendingRequestId;
    const local = pending && requests.get(pending);
    $("send").disabled = !chat || navigationLocked || readerLoading || Boolean(pending) || Boolean(readerFailure) || conflicts.has(activeId);
    $("chat-stop").hidden = !local || Boolean(local.unsaved);
    $("chat-stop").textContent = "Stop waiting";
    $("workspace-pending").hidden = !pending || Boolean(local);
    $("workspace-pending-text").textContent = "This conversation has an unfinished reply from an earlier page or another tab. Its execution state is unknown. Marking it interrupted will keep the message and will not send it again.";
    if (readerFailure) notice(readerFailure + " Choose a model explicitly to continue.", true);
  }

  async function reloadMessages(id) {
    const latest = await store.loadConversation(id);
    reconcileConversation(latest.conversation);
    if (activeId === id) {
      loaded = latest;
      $("conversation-title").textContent = latest.conversation.title;
      renderMessages(); updateControls();
    }
    await refreshSidebar();
  }

  async function activate(id, { skipFlush = false, token = beginNavigation() } = {}) {
    try {
      if (token !== navigation) return;
      if (!skipFlush) await flushDraft();
      if (token !== navigation) return;
      const next = await store.loadConversation(id);
      if (token !== navigation) return;
      await persistSelection(next.conversation, token);
      if (token !== navigation) return;
      activeId = id; loaded = next; known.set(id, next.conversation); conflicts.delete(id);
      dirty = false; selectedReader = null; readerFailure = "";
      readerLoading = Boolean(next.conversation.modelRef);
      const readerToken = ++readerGeneration;
      $("prompt").value = next.conversation.draft;
      $("chat-reader-source").value = next.conversation.source;
      $("chat-create-kind").value = next.conversation.draftKind;
      $("prompt").placeholder = next.conversation.draftKind ? "Describe the " + next.conversation.draftKind + " you want to create…" : "Message Pocket AI Lab…";
      $("conversation-title").textContent = next.conversation.title;
      $("workspace-scope").textContent = next.conversation.projectId === null ? "Individual chat" : "Project · " + projectName(next.conversation.projectId);
      hooks.clearReader(); setWorkspaceView("chat");
      renderMessages(); notice();
      // Lock only the old form's flush/switch. The newly opened draft remains
      // editable while its exact model is being restored.
      endNavigation(token);
      try {
        if (next.conversation.modelRef) {
          const reader = await restoreReader(next.conversation.modelRef);
          if (activeId !== id || readerToken !== readerGeneration) return;
          selectedReader = reader;
          hooks.displayReader(reader);
        }
      } catch (error) {
        if (activeId !== id || readerToken !== readerGeneration) return;
        readerFailure = error.message;
        $("chat-reader-context").hidden = false;
        $("chat-reader-label").textContent = "Selected model is unavailable";
      } finally {
        if (readerToken === readerGeneration) { readerLoading = false; updateControls(); }
      }
      if (token !== navigation) return;
      await refreshSidebar();
    } finally { endNavigation(token); }
  }

  async function newConversation(projectId = currentProject(), { token = beginNavigation() } = {}) {
    try {
      await flushDraft();
      if (token !== navigation) return;
      const chat = await store.createConversation({ projectId, title: "New conversation", modelRef: null });
      await refreshSidebar();
      if (token !== navigation) return chat;
      await activate(chat.id, { skipFlush: true, token });
      if (token === navigation && activeId === chat.id) $("prompt").focus();
      return chat;
    } finally { endNavigation(token); }
  }
  async function openProject(projectId) {
    const token = beginNavigation();
    try {
      await flushDraft(); await refreshSidebar();
      if (token !== navigation) return;
      const existing = snapshot.conversations.find(chat => chat.projectId === projectId);
      if (existing) await activate(existing.id, { skipFlush: true, token });
      else await newConversation(projectId, { token });
    } finally { endNavigation(token); }
  }

  async function selectReader(reader, question, passage) {
    if (navigationLocked) throw Error("Finish opening this conversation before selecting its model.");
    const id = activeId;
    const form = formSnapshot();
    const ref = readerReference(reader);
    const proposed = { draft: form.draft || question || "", source: passage ?? form.source };
    const readerToken = ++readerGeneration;
    readerLoading = true; updateControls();
    // The existing workshop hands a selection to Chat synchronously. Reflect
    // that choice immediately, but keep inference disabled until it is saved.
    const priorDraftSave = flushDraft();
    // Reserve this write before yielding so a later navigation flush cannot
    // overtake the choice and restore its previous model reference.
    const selectionSave = enqueue(id, async () => {
      await priorDraftSave;
      if (conflicts.has(id)) throw Error("Reopen the saved conversation before changing its model.");
      const current = known.get(id);
      const patch = { modelRef: ref,
        draft: current.draft === form.draft ? proposed.draft : current.draft,
        source: current.source === form.source ? proposed.source : current.source };
      const updated = await store.updateConversation(id, current.revision, patch);
      known.set(id, updated);
      return updated;
    });
    if (reader) hooks.displayReader(reader); else hooks.clearReader();
    $("prompt").value = proposed.draft;
    $("chat-reader-source").value = proposed.source;
    dirty = true;
    setWorkspaceView("chat");
    notice("Saving the selected model and draft…");
    $("prompt").focus();
    try {
      const saved = await selectionSave;
      if (id !== activeId || readerToken !== readerGeneration) return;
      selectedReader = reader; readerFailure = "";
      // Preserve input typed while the catalog/transaction was pending.
      if ($("prompt").value === proposed.draft) $("prompt").value = saved.draft;
      if ($("chat-reader-source").value === proposed.source) $("chat-reader-source").value = saved.source;
      if (Object.entries(formSnapshot()).every(([key, value]) => saved[key] === value)) { dirty = false; notice(); }
      else scheduleDraft();
    } catch (error) {
      if (id === activeId && readerToken === readerGeneration) {
        readerFailure = "The selected model could not be saved. " + error.message;
        $("chat-reader-context").hidden = false;
        $("chat-reader-label").textContent = "Selected model was not saved";
      }
      throw error;
    } finally { if (readerToken === readerGeneration) { readerLoading = false; updateControls(); } }
  }

  async function saveResult(requestId) {
    const pending = requests.get(requestId);
    if (!pending?.unsaved) return;
    const result = pending.unsaved;
    await enqueue(pending.conversationId, async () => {
      const saved = await store.finishTurn(requestId, { status: result.status, text: result.text, attribution: result.attribution });
      reconcileConversation(saved.conversation);
      if (result.extra) extras.set(saved.assistantMessage.id, result.extra);
    });
    pending.unsaved = null;
    requests.delete(requestId);
    try { await reloadMessages(pending.conversationId); }
    catch (error) { fail(Error("The reply was saved, but the view could not refresh. Reopen this conversation. " + error.message)); return; }
    if (activeId === pending.conversationId && !conflicts.has(activeId)) notice();
  }

  async function send(raw) {
    const text = raw;
    if (!text.trim() || !activeId || navigationLocked || readerLoading) return;
    const id = activeId, reader = selectedReader, draftKind = $("chat-create-kind").value;
    const failure = readerFailure;
    await flushDraft();
    const chat = known.get(id);
    if (conflicts.has(id)) throw Error("This conversation changed in another tab. Reopen it or save your draft in a new chat.");
    if (chat.pendingRequestId) return;
    if (failure) throw Error(failure + " Choose a model explicitly.");
    if (draftKind !== chat.draftKind) throw Error("The requested action changed before the message was saved. Send it again from its conversation.");
    if (draftKind && chat.modelRef) throw Error("Definition drafting needs the configured chat model. Choose it explicitly using Use configured chat model; your reader selection has been preserved.");
    const modelRef = readerReference(reader);
    const context = await store.loadConversation(id);
    const history = draftKind ? { conversation: [], contextMessageIds: [], omittedExchanges: 0 } : recentConversation(context);
    const outgoing = boundedChatRequest(draftKind ? draftAuthoringPrompt(draftKind, text) : text, history);
    const requestId = crypto.randomUUID(), controller = new AbortController();
    const generation = hooks.reviewGeneration();
    const begun = await enqueue(id, () => {
      const current = known.get(id);
      if (current.source !== chat.source || current.draftKind !== draftKind || JSON.stringify(current.modelRef) !== JSON.stringify(modelRef)) {
        throw Error("The model, source, or requested action changed before sending. Review the conversation and send again.");
      }
      return store.beginTurn(id, current.revision, { requestId, text, modelRef, contextMessageIds: outgoing.contextMessageIds,
        kind: draftKind ? "resource-draft" : reader ? "reader" : "chat" });
    });
    known.set(id, begun.conversation);
    const ticket = { conversationId: id, controller, cancelled: false, unsaved: null };
    requests.set(requestId, ticket);
    if (activeId === id && $("prompt").value === text) { $("prompt").value = ""; dirty = false; }
    if (chat.title === "New conversation") {
      await enqueue(id, async () => {
        const saved = await store.updateConversation(id, known.get(id).revision, { title: text.trim().slice(0, 70) });
        known.set(id, saved);
      }).catch(fail);
    }
    await reloadMessages(id);
    if (outgoing.omittedExchanges && activeId === id) notice("Earlier messages remain saved. This reply uses the most recent conversation that fits the context limit.");
    let result;
    try {
      if (reader) {
        const answer = await reader.answer(text, begun.turn.source);
        result = { status: "complete", text: answer.answer,
          attribution: reader.label + (reader.location === "host" ? " · LOCAL TRAINING HOST" : " · LOCAL DOCUMENT READER"),
          extra: { reader, result: answer, passage: begun.turn.source, question: text, generation } };
      } else {
        const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: outgoing.body, signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "The configured model request failed.");
        if (typeof data.reply !== "string" || !data.reply.trim()) throw Error("The model returned no usable reply.");
        result = { status: "complete", text: data.reply, attribution: "POCKET AI LAB · " + (data.model || "CONFIGURED MODEL") };
        if (draftKind && !ticket.cancelled) {
          try {
            const definition = parseResourceDraft(data.reply);
            const resource = await store.createResourceDraft({ ...definition, kind: draftKind, projectId: chat.projectId, createdBy: "assistant", requestId });
            result.text = "Created a " + draftKind + " draft: " + resource.name + ".\n\n" + resource.description + "\n\n" + resource.instructions + "\n\nSaved under " + titles[draftKind] + " · " + scopeName(chat.projectId) + ". This definition is a draft; it is not activated and has not run.";
          } catch (error) {
            result.text = data.reply + "\n\nDraft was not saved: " + error.message;
          }
        }
      }
    } catch (error) {
      if (ticket.cancelled) return;
      result = { status: "failed", text: "I couldn't complete this reply. " + error.message + "\n\nYour message is saved. No simulated answer was generated.", attribution: "POCKET AI LAB · REQUEST FAILED" };
    }
    if (ticket.cancelled) return;
    ticket.unsaved = result;
    try { await saveResult(requestId); }
    catch (error) {
      if (activeId === id) { renderMessages(); updateControls(); fail(Error("The reply arrived but could not be saved. " + error.message)); }
    }
  }

  async function stopReply() {
    const chat = known.get(activeId), ticket = requests.get(chat?.pendingRequestId);
    if (!ticket || ticket.unsaved) return;
    ticket.cancelled = true; ticket.controller.abort();
    ticket.unsaved = { status: "cancelled", text: "Stopped waiting for this reply. The message is saved; server cancellation has not been independently confirmed.", attribution: "POCKET AI LAB · STOPPED WAITING" };
    try { await saveResult(chat.pendingRequestId); }
    catch (error) { renderMessages(); updateControls(); throw error; }
  }

  function openName(action) {
    nameAction = action;
    $("workspace-name-heading").textContent = action.type === "project-create" ? "New project" : action.type === "project-rename" ? "Rename project" : "Rename conversation";
    $("workspace-name-input").value = action.project?.name ?? action.chat?.title ?? "";
    $("workspace-name-error").textContent = "";
    $("workspace-name-save").disabled = false;
    $("workspace-name-dialog").showModal(); $("workspace-name-input").focus();
  }
  $("workspace-name-form").addEventListener("submit", async event => {
    event.preventDefault(); $("workspace-name-save").disabled = true;
    const action = nameAction;
    try {
      const name = $("workspace-name-input").value.trim();
      if (action.type === "project-create") {
        await flushDraft();
        action.created ??= await store.createProject({ name });
        await refreshSidebar();
        if (nameAction === action) {
          nameAction = null; $("workspace-name-dialog").close();
          await openProject(action.created.id);
        }
      } else if (action.type === "project-rename") {
        await store.renameProject(action.project.id, action.project.revision, { name });
        await refreshSidebar();
        $("workspace-scope").textContent = currentProject() === null ? "Individual chat" : "Project · " + projectName(currentProject());
      } else {
        await flushDraft();
        const id = action.chat.id;
        await enqueue(id, async () => known.set(id, await store.updateConversation(id, known.get(id).revision, { title: name })));
        await reloadMessages(id);
      }
      if (nameAction === action) $("workspace-name-dialog").close();
    } catch (error) { if (nameAction === action) $("workspace-name-error").textContent = error.message; }
    finally { if (nameAction === action) $("workspace-name-save").disabled = false; }
  });

  async function showResources(kind) {
    const token = beginNavigation();
    try {
    await flushDraft(); await refreshSidebar();
    if (token !== navigation) return;
    resourceKind = kind;
    setWorkspaceView("resources"); $("page-name").textContent = titles[kind];
    $("resource-heading").textContent = titles[kind];
    $("resource-intro").textContent = kind === "tool" ? "Design the operations your assistant can use." : kind === "agent" ? "Define specialists for the work you want to do." : "Organize specialists into a team with clear responsibilities.";
    $("resource-scope").textContent = scopeName(currentProject());
    const list = $("resource-list"); list.replaceChildren();
    const resources = snapshot.resources.filter(resource => resource.kind === kind && (resource.projectId === null || resource.projectId === currentProject()));
    for (const resource of resources) {
      const card = element("article", undefined, "resource-card");
      card.dataset.resourceId = resource.id;
      card.append(element("h2", resource.name), element("p", resource.description));
      card.append(element("p", "Draft · version " + resource.version + " · " + (resource.createdBy === "assistant" ? "Created by assistant" : "Created by you") + " · " + scopeName(resource.projectId), "resource-meta"));
      const details = element("details"); details.append(element("summary", "Instructions and configuration"), element("pre", resource.instructions));
      const edit = element("button", "Edit draft", "secondary-button"); edit.type = "button";
      edit.addEventListener("click", () => openResource(resource));
      card.append(details, edit); list.append(card);
    }
    if (!resources.length) list.append(element("div", "No " + kind + " drafts in this workspace yet. Create one or ask the assistant to help.", "empty-state"));
    document.querySelectorAll("[data-resource-kind]").forEach(button => button.classList.toggle("active", button.dataset.resourceKind === kind));
    } finally { endNavigation(token); }
  }
  function openResource(resource) {
    resourceEdit = resource ? structuredClone(resource) : { kind: resourceKind, projectId: currentProject() };
    $("resource-dialog-heading").textContent = (resource ? "Edit " : "Create ") + resourceEdit.kind + " draft";
    $("resource-dialog-scope").textContent = scopeName(resourceEdit.projectId);
    for (const name of ["name", "description", "instructions"]) $("resource-" + name).value = resource?.[name] ?? "";
    $("resource-error").textContent = ""; $("resource-save").disabled = false;
    $("resource-dialog").showModal(); $("resource-name").focus();
  }
  $("resource-form").addEventListener("submit", async event => {
    event.preventDefault(); $("resource-save").disabled = true;
    const editing = resourceEdit;
    const value = Object.fromEntries(["name", "description", "instructions"].map(name => [name, $("resource-" + name).value]));
    try {
      if (editing.id) await store.updateResourceDraft(editing.id, editing.revision, value);
      else await store.createResourceDraft({ ...value, kind: editing.kind, projectId: editing.projectId, createdBy: "user" });
      if (resourceEdit === editing) { $("resource-dialog").close(); await showResources(editing.kind); }
    } catch (error) { if (resourceEdit === editing) $("resource-error").textContent = error.message; }
    finally { if (resourceEdit === editing) $("resource-save").disabled = false; }
  });

  for (const id of ["prompt", "chat-reader-source"]) $(id).addEventListener("input", scheduleDraft);
  $("chat-create-kind").addEventListener("change", () => {
    scheduleDraft();
    $("prompt").placeholder = $("chat-create-kind").value ? "Describe the " + $("chat-create-kind").value + " you want to create…" : "Message Pocket AI Lab…";
  });
  $("new-project").addEventListener("click", () => openName({ type: "project-create" }));
  $("conversation-rename").addEventListener("click", () => openName({ type: "chat-rename", chat: known.get(activeId) }));
  $("new-standalone-chat").addEventListener("click", () => newConversation(null).catch(fail));
  $("chat-stop").addEventListener("click", () => stopReply().catch(fail));
  $("workspace-interrupt").addEventListener("click", async () => {
    const id = activeId, requestId = known.get(id)?.pendingRequestId;
    if (!requestId) return;
    try { await enqueue(id, () => store.recoverPending([requestId])); await reloadMessages(id); }
    catch (error) { fail(error); }
  });
  $("workspace-save-copy").addEventListener("click", async () => {
    const token = beginNavigation();
    const values = formSnapshot(), ref = known.get(activeId)?.modelRef ?? null;
    clearTimeout(draftTimer);
    try {
      const chat = await store.createConversation({ projectId: currentProject(), title: "Recovered draft", modelRef: ref });
      const saved = await store.updateConversation(chat.id, chat.revision, values);
      known.set(chat.id, saved);
      if (token === navigation) await activate(chat.id, { skipFlush: true, token });
    } catch (error) { fail(error); }
    finally { endNavigation(token); }
  });
  document.querySelectorAll("[data-resource-kind]").forEach(button => button.addEventListener("click", () => showResources(button.dataset.resourceKind).catch(fail)));
  $("resource-create").addEventListener("click", () => openResource());
  $("resource-ask").addEventListener("click", async () => {
    setWorkspaceView("chat"); $("chat-create-kind").value = resourceKind;
    $("prompt").placeholder = "Describe the " + resourceKind + " you want to create…";
    scheduleDraft(); $("prompt").focus();
  });
  document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => $(button.dataset.closeDialog).close()));
  $("workspace-name-dialog").addEventListener("close", () => { nameAction = null; });
  $("resource-dialog").addEventListener("close", () => { resourceEdit = null; });
  window.addEventListener("pocket-view-change", event => {
    if (!ownViewChange && navigationLocked) endNavigation(++navigation);
    activeView = event.detail;
    if (activeView !== "resources") document.querySelectorAll("[data-resource-kind]").forEach(button => button.classList.remove("active"));
  });
  window.addEventListener("focus", () => refreshSidebar().catch(fail));
  window.addEventListener("beforeunload", event => {
    if (dirty || [...requests.values()].some(request => request.unsaved)) { event.preventDefault(); event.returnValue = ""; }
  });

  await refreshSidebar();
  if (!snapshot.selection) throw Error("Saved workspace selection is damaged. Its records were preserved; no empty replacement was created.");
  let initial = snapshot.conversations.find(chat => chat.id === snapshot.selection.conversationId);
  if (!initial && snapshot.conversations.length) initial = snapshot.conversations[0];
  if (!initial && snapshot.issues.length) throw Error("Saved workspace records could not be read. They have been preserved; no empty replacement was created.");
  if (!initial) initial = await store.createConversation({ projectId: null, title: "New conversation", modelRef: null });
  await activate(initial.id, { skipFlush: true });
  $("workspace-shell").dataset.ready = "true";
  return {
    send, newConversation, selectReader, reportError: fail,
    captureReviewOrigin() { reviewOrigin = activeId; },
    async returnToReviewOrigin() { if (reviewOrigin && reviewOrigin !== activeId) await activate(reviewOrigin); }
  };
}
