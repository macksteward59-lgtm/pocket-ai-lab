import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(path.join(root, "index.html"), "utf8");
const script = readFileSync(path.join(root, "app.js"), "utf8");

function element() {
  return {
    value: "",
    textContent: "",
    className: "",
    disabled: false,
    dataset: {},
    classList: {
      toggle() {},
      add() {},
      remove() {},
      contains(name) { return name === "ready" && this.ready === true; },
      ready: false
    },
    lastChild: { textContent: "" },
    append() {},
    replaceChildren() {},
    scrollIntoView() {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    listeners: {},
    requestSubmit() {}
  };
}

test("app.js loads against index.html and reaches health plus the service worker", async () => {
  assert.equal(html.includes("\\n"), false);
  assert.equal(html.includes('id="endpoint"'), false);
  assert.equal(html.includes('id="model"'), false);

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const byId = new Map(ids.map(id => [id, element()]));
  const fetches = [];
  const registrations = [];
  const windowListeners = {};

  function buttons(attribute) {
    const found = [];
    for (const match of html.matchAll(/<button\b([^>]*)>/g)) {
      const value = new RegExp(attribute + '="([^"]*)"').exec(match[1]);
      if (!value) continue;
      const node = element();
      node.dataset[attribute.slice(5)] = value[1];
      found.push(node);
    }
    return found;
  }

  const document = {
    getElementById(id) {
      return byId.get(id) ?? null;
    },
    querySelector(selector) {
      if (selector === ".privacy-hint") return element();
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-view]") return buttons("data-view");
      if (selector === "[data-prompt]") return buttons("data-prompt");
      return [];
    }
  };
  const windowObject = {
    addEventListener(type, fn) {
      (windowListeners[type] ||= []).push(fn);
    }
  };
  const context = {
    document,
    window: windowObject,
    navigator: {
      serviceWorker: {
        register(url) {
          registrations.push(url);
          return Promise.resolve();
        }
      }
    },
    fetch: async (url) => {
      fetches.push(String(url));
      return {
        ok: true,
        json: async () => ({ configured: false, reachable: false, loopback: true, model: null })
      };
    },
    console
  };
  vm.createContext(context);
  vm.runInContext(script, context, { filename: "app.js" });
  for (const fn of windowListeners.load || []) fn();
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.ok(fetches.includes("/api/health"));
  assert.deepEqual(registrations, ["/sw.js"]);
  assert.equal(typeof byId.get("settings-form").listeners.submit, "function");
  assert.equal(typeof byId.get("test-connection").listeners.click, "function");
  assert.equal(typeof byId.get("memory-form").listeners.submit, "function");
  assert.equal(typeof byId.get("memory-refresh").listeners.click, "function");
  assert.match(script, /method:\s*"PUT"/);
  assert.match(script, /memory-editor/);
  assert.equal(byId.has("endpoint"), false);
});
