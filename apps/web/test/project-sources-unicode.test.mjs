import assert from "node:assert/strict";
import test from "node:test";
import { openProjectSources } from "../project-sources.mjs";

test("project-source lookup measures the query limit in Unicode code points", t => {
  const index = openProjectSources();
  t.after(() => index.close());
  const query = "neurons " + "😀".repeat(292);
  assert.equal([...query].length, 300);
  assert.ok(index.lookup(query).some(source => source.id === "CF-QUOTA"));
  assert.throws(() => index.lookup(query + "😀"), RangeError);
});
