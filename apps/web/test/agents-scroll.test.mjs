import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(path.join(root, "index.html"), "utf8");
const css = readFileSync(path.join(root, "styles.css"), "utf8");

test("the Agents view has one scrollport and the transcript is not a nested scroller", () => {
  assert.match(html, /id="agents-view"[^>]*tabindex="0"/);
  assert.match(css, /\.app-shell\{height:100vh;max-height:100vh;overflow:hidden\}/);
  assert.match(css, /\.main\{min-height:0;overflow:hidden\}/);
  assert.match(css, /#agents-view\{overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch\}/);
  const override = css.lastIndexOf(".agent-transcript{max-height:none;overflow:visible}");
  const nested = css.indexOf(".agent-transcript{list-style:none");
  assert.ok(override > nested);
  assert.match(css.slice(override), /max-height:none;overflow:visible/);
});
