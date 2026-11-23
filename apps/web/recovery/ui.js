import { verifyReviewEvidence } from "./verify.js";

const field = name => document.getElementById("recovery-" + name);
const nav = document.querySelector('[data-view="recovery"]');
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("pocket-review-session") : null;
let owner = null;
let selected = null;
let operation = null;
let pendingCreate = null;
let pendingCorrection = null;
let signingOut = null;

function status(text) {
  field("status").textContent = text;
}

function clearDetail() {
  selected = null;
  pendingCorrection = null;
  field("details").hidden = true;
  field("details").removeAttribute("data-task-id");
  field("evidence").hidden = true;
  field("passage").parentElement.open = false;
  for (const name of ["selected-title", "state", "passage", "excerpt", "attempt-id", "execution-count", "verdict", "corrections"]) {
    field(name).replaceChildren();
  }
  field("correction-form").reset();
}

function clearPrivate() {
  owner = null;
  pendingCreate = null;
  clearDetail();
  field("owner").textContent = "";
  field("auth").reset();
  field("create-form").reset();
  field("tasks").replaceChildren();
  field("workspace").hidden = true;
  field("auth").hidden = Boolean(signingOut);
  field("logout-retry").hidden = !signingOut;
  status("");
}

function requireCurrent(ticket) {
  if (operation !== ticket) throw new Error("The account or task changed.");
}

function invalidate() {
  operation?.abort();
  operation = null;
}

function disableControls(disabled) {
  // Sign out remains available while a task or verification is running.
  for (const control of field("view").querySelectorAll("button, input, textarea")) {
    if (control !== field("logout")) control.disabled = disabled;
  }
}

async function perform(work) {
  if (operation) return;
  const ticket = new AbortController();
  operation = ticket;
  disableControls(true);
  try {
    await work(ticket);
  } catch (error) {
    if (operation !== ticket) return;
    if (error.code === "account_changed" || (error.status === 401 && owner)) {
      signingOut = null;
      clearPrivate();
    }
    status(error.message || "The local review service could not be reached.");
  } finally {
    if (operation === ticket) {
      operation = null;
      disableControls(false);
    }
  }
}

async function request(ticket, action, data = {}) {
  requireCurrent(ticket);
  const response = await fetch("/api/recovery", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...(owner ? {expectedOwner: owner} : {}), ...data }),
    signal: ticket.signal
  });
  const body = await response.json();
  requireCurrent(ticket);
  if (!response.ok) {
    throw Object.assign(new Error(body.error || "The local review service returned an error."), {
      status: response.status, code: body.code
    });
  }
  return body;
}

function showOwner(username) {
  if (owner !== username) clearPrivate();
  owner = username;
  field("owner").textContent = username;
  field("auth").hidden = true;
  field("workspace").hidden = false;
}

function showTask(task) {
  clearDetail();
  selected = task;
  field("details").hidden = false;
  field("details").dataset.taskId = task.id;
  field("selected-title").textContent = task.title;
  field("passage").textContent = task.source;
  field("excerpt").textContent = task.quote;
  const completed = task.status === "completed";
  field("run").hidden = completed;
  field("evidence").hidden = !completed;
  field("state").textContent = completed ? "Completed" : "Saved. Resume to record this excerpt.";
  if (!completed) return;

  const payload = task.evidence.payload;
  field("attempt-id").textContent = payload.attemptId;
  field("execution-count").textContent = String(payload.executionCount);
  for (const correction of payload.corrections) {
    const item = document.createElement("li");
    item.textContent = correction.note;
    field("corrections").append(item);
  }
  field("verdict").textContent = "Evidence awaits verification.";
}

async function loadTasks(ticket) {
  const {tasks} = await request(ticket, "list");
  const list = field("tasks");
  list.replaceChildren();
  if (!tasks.length) {
    const empty = document.createElement("li");
    empty.textContent = "No saved review tasks.";
    list.append(empty);
  }
  for (const task of tasks) {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button";
    button.textContent = task.title;
    button.addEventListener("click", () => perform(async current => {
      const result = await request(current, "get", {id: task.id});
      showTask(result.task);
      status("");
      field("details").scrollIntoView({block: "nearest"});
    }));
    const state = document.createElement("span");
    state.textContent = task.status === "completed" ? "Completed" : "Ready to resume";
    row.append(button, state);
    list.append(row);
  }
}

function refreshSession() {
  if (signingOut || field("view").classList.contains("hidden")) return;
  return perform(async ticket => {
    const {username} = await request(ticket, "session");
    if (!username) {
      if (owner) clearPrivate();
      return;
    }
    showOwner(username);
    await loadTasks(ticket);
  });
}

field("auth").addEventListener("submit", event => {
  event.preventDefault();
  const action = event.submitter?.value || "login";
  perform(async ticket => {
    const password = field("password").value;
    field("password").value = "";
    const {username} = await request(ticket, action, {username: field("username").value, password});
    showOwner(username);
    channel?.postMessage("changed");
    await loadTasks(ticket);
    status("Signed in.");
  });
});

function signOut() {
  signingOut ??= owner;
  invalidate();
  clearPrivate();
  status("Signing out…");
  perform(async ticket => {
    await request(ticket, "logout", {expectedOwner: signingOut});
    signingOut = null;
    clearPrivate();
    channel?.postMessage("changed");
    status("Signed out.");
  });
}
field("logout").addEventListener("click", signOut);
field("logout-retry").addEventListener("click", signOut);
field("refresh").addEventListener("click", refreshSession);
nav.addEventListener("click", refreshSession);

channel?.addEventListener("message", () => {
  invalidate();
  signingOut = null;
  clearPrivate();
  disableControls(false);
  refreshSession();
});

window.addEventListener("pagehide", () => {
  invalidate();
  clearPrivate();
});
window.addEventListener("pageshow", event => {
  if (event.persisted) {
    disableControls(false);
    refreshSession();
  }
});

field("create-form").addEventListener("submit", event => {
  event.preventDefault();
  perform(async ticket => {
    const input = { title: field("title").value, source: field("source").value, quote: field("quote").value };
    const inputs = JSON.stringify(input);
    if (pendingCreate?.inputs !== inputs) pendingCreate = {id: crypto.randomUUID(), inputs};
    const {task} = await request(ticket, "create", {id: pendingCreate.id, ...input});
    pendingCreate = null;
    field("create-form").reset();
    showTask(task);
    await loadTasks(ticket);
    status("Task saved. You can leave and resume it later.");
    field("details").scrollIntoView({block: "nearest"});
  });
});

field("run").addEventListener("click", () => perform(async ticket => {
  const {task} = await request(ticket, "run", {id: selected.id});
  showTask(task);
  await loadTasks(ticket);
  status("Review completed.");
}));

field("correction-form").addEventListener("submit", event => {
  event.preventDefault();
  perform(async ticket => {
    const note = field("note").value;
    if (pendingCorrection?.note !== note) pendingCorrection = {id: crypto.randomUUID(), note};
    const result = await request(ticket, "correct", {id: selected.id, correctionId: pendingCorrection.id, note});
    showTask(result.task);
    status("Correction saved. Verify the updated evidence.");
  });
});

field("verify").addEventListener("click", () => perform(async ticket => {
  field("verdict").textContent = "Verifying…";
  try {
    const {key} = await request(ticket, "publicKey");
    const verified = await verifyReviewEvidence(selected.evidence, key, {taskId: selected.id, owner});
    requireCurrent(ticket);
    if (verified.title !== selected.title || verified.source !== selected.source || verified.quote !== selected.quote) {
      throw new Error("The displayed review differs from its signed evidence.");
    }
    field("verdict").textContent = "Evidence verified. The signature, excerpt and recorded corrections match.";
  } catch (error) {
    requireCurrent(ticket);
    field("verdict").textContent = "Evidence verification failed.";
    throw error;
  }
}));

function downloadJson(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: "application/json"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

field("export").addEventListener("click", () => {
  if (owner && selected?.evidence) downloadJson("review-" + selected.id + ".json", selected.evidence);
});
field("key").addEventListener("click", () => perform(async ticket => {
  const {key} = await request(ticket, "publicKey");
  downloadJson("pocket-review-public-key.json", key);
}));
