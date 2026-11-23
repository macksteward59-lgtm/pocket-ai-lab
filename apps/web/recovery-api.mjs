import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const sessionCookie = "pocketReviewSession";
const cookieOptions = "Path=/api/recovery; HttpOnly; SameSite=Strict";

function sessionFromCookie(header = "") {
  const matches = header.split(";").map(part => part.trim()).filter(part => part.startsWith(sessionCookie + "="));
  return matches.length === 1 ? matches[0].slice(sessionCookie.length + 1) : "";
}

// Resolve existing ancestors too, so a configured symlink cannot put the database under the static site.
function resolvedLocation(directory) {
  if (existsSync(directory)) return realpathSync(directory);
  return path.join(resolvedLocation(path.dirname(directory)), path.basename(directory));
}

export function recoveryApi(staticRoot) {
  let opened;
  async function store() {
    if (!opened) {
      const directory = process.env.POCKET_RECOVERY_DIR || path.join(homedir(), ".pocket-ai-lab", "review-accounts");
      if (!path.isAbsolute(directory)) throw new Error("Invalid recovery directory");
      const real = resolvedLocation(path.resolve(directory));
      const web = realpathSync(staticRoot);
      if (real === web || real.startsWith(web + path.sep) || web.startsWith(real + path.sep) || real === path.parse(real).root) {
        throw new Error("Recovery storage needs a private directory outside the web root.");
      }
      opened = import("./recovery/store.mjs").then(({ openRecoveryStore }) => openRecoveryStore(directory));
      opened.catch(() => { opened = undefined; });
    }
    return opened;
  }

  async function dispatch(input, cookieHeader) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw Object.assign(new Error("Expected a review request."), { status: 400 });
    }
    const token = sessionFromCookie(cookieHeader);
    const { action } = input;
    if (action === "session" && !token) return { data: { username: null } };
    const db = await store();
    if (action === "login" || action === "register") {
      const session = await db[action](input.username, input.password);
      if (token) await db.logout(token);
      return {
        data: { username: session.username },
        headers: { "set-cookie": sessionCookie + "=" + session.token + "; " + cookieOptions }
      };
    }
    const owner = token ? await db.username(token) : null;
    if (action === "session") return { data: { username: owner } };
    if (input.expectedOwner !== undefined && owner && input.expectedOwner !== owner) {
      throw Object.assign(new Error("Your signed-in account changed. Reopen Review tasks."), { status: 409, code: "account_changed" });
    }
    if (action === "logout") {
      if (token) await db.logout(token);
      return { data: { ok: true }, headers: { "set-cookie": sessionCookie + "=; Max-Age=0; " + cookieOptions } };
    }
    if (!owner) throw Object.assign(new Error("Sign in to review your tasks."), { status: 401 });
    switch (action) {
      case "publicKey": return { data: { key: await db.publicKey() } };
      case "list": return { data: { tasks: await db.list(owner) } };
      case "create": return { data: { task: await db.create(owner, input) } };
      case "get": return { data: { task: await db.get(owner, input.id) } };
      case "run": return { data: { task: await db.run(owner, input.id) } };
      case "correct": return { data: { task: await db.correct(owner, input.id, { id: input.correctionId, note: input.note }) } };
      default: throw Object.assign(new Error("Unknown review action."), { status: 400 });
    }
  }
  return { dispatch, close() { if (opened) opened.then(db => db.close()).catch(() => {}); } };
}
