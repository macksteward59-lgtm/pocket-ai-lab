import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { downloadPinnedModel } from "./download.mjs";

const payload = Buffer.from("GGUF fixture: verified bytes across several chunks.");
const previous = Buffer.from("An existing destination must survive a failed download.");

function makePin(bytes = payload) {
  const repo = "example/model-GGUF";
  const revision = "0123456789abcdef0123456789abcdef01234567";
  const filename = "model-Q4_K_M.gguf";
  return {
    id: "test-fixture", repo, revision, filename,
    sourceUrl: `https://huggingface.co/${repo}/resolve/${revision}/${filename}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length, license: "mit", baseModel: "example/model", purpose: "unit test only"
  };
}

async function fixture(t, existing = previous) {
  const directory = await mkdtemp(path.join(tmpdir(), "gguf-download-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, "model.gguf");
  if (existing !== null) await writeFile(destination, existing);
  return { directory, destination };
}

function byteStream(parts, { onPull, onCancel, error } = {}) {
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      await onPull?.(index);
      if (index < parts.length) controller.enqueue(parts[index++]);
      else if (error) controller.error(error);
      else controller.close();
    },
    cancel(reason) { return onCancel?.(reason); }
  }, { highWaterMark: 0 });
}

function response(url, body, { status = 200, headers = {}, redirected = false } = {}) {
  const result = new Response(body, { status, headers });
  Object.defineProperties(result, {
    url: { value: url },
    redirected: { value: redirected },
    arrayBuffer: { value() { throw new Error("Whole-response buffering is forbidden"); } }
  });
  return result;
}

async function assertPreserved(directory, destination, existing = previous) {
  if (existing === null) {
    await assert.rejects(readFile(destination), { code: "ENOENT" });
    assert.deepEqual(await readdir(directory), []);
  } else {
    assert.deepEqual(await readFile(destination), existing);
    assert.deepEqual(await readdir(directory), [path.basename(destination)]);
  }
}

test("streams multiple chunks into a private file before atomically replacing the destination", async t => {
  const { directory, destination } = await fixture(t);
  const chunks = Array.from({ length: 5 }, (_, index) => Buffer.alloc(64 * 1024, index + 1));
  const expected = Buffer.concat(chunks);
  const pin = makePin(expected);
  let observedPartial = false;
  const fetchImpl = async url => response(url, byteStream(chunks, {
    async onPull(index) {
      if (index !== 1) return;
      const partials = (await readdir(directory)).filter(name => name.endsWith(".partial"));
      assert.equal(partials.length, 1);
      const partial = await stat(path.join(directory, partials[0]));
      assert.equal(partial.size, chunks[0].length);
      assert.equal(partial.mode & 0o077, 0);
      assert.deepEqual(await readFile(destination), previous);
      observedPartial = true;
    }
  }), { headers: { "Content-Length": String(expected.length) } });
  const result = await downloadPinnedModel(pin, { destination, fetchImpl });
  assert.equal(observedPartial, true);
  assert.deepEqual(result, {
    path: destination, verified: true, downloaded: true, sha256: pin.sha256,
    bytes: pin.bytes, license: pin.license, revision: pin.revision
  });
  await assertPreserved(directory, destination, expected);
});

test("a verified cache entry returns the existing CLI shape without fetching", async t => {
  const { directory, destination } = await fixture(t, payload);
  const pin = makePin();
  const result = await downloadPinnedModel(pin, {
    destination,
    fetchImpl() { assert.fail("A valid cache entry must not fetch"); }
  });
  assert.deepEqual(result, { path: destination, verified: true, downloaded: false, sha256: pin.sha256 });
  await assertPreserved(directory, destination, payload);
});

test("an invalid cache of the expected size is replaced only by verified bytes", async t => {
  const { directory, destination } = await fixture(t, Buffer.alloc(payload.length));
  let calls = 0;
  await downloadPinnedModel(makePin(), {
    destination,
    fetchImpl: async url => {
      calls += 1;
      return response(url, byteStream([payload.subarray(0, 8), payload.subarray(8)]));
    }
  });
  assert.equal(calls, 1);
  await assertPreserved(directory, destination, payload);
});

for (const existing of [previous, null]) {
  for (const [name, parts, error, expectedError] of [
    ["short body", [payload.subarray(0, 9)], undefined, /size .* does not match/],
    ["oversized body", [payload, Buffer.from("extra"), payload], undefined, /exceeds the pinned size/],
    ["wrong digest", [Buffer.alloc(payload.length)], undefined, /checksum mismatch/],
    ["stream error", [payload.subarray(0, 9)], new Error("connection interrupted"), /connection interrupted/]
  ]) {
    test(`${name} cleans temporary files and ${existing ? "preserves" : "does not create"} the destination`, async t => {
      const { directory, destination } = await fixture(t, existing);
      let fetchSignal;
      await assert.rejects(downloadPinnedModel(makePin(), {
        destination,
        fetchImpl: async (url, options) => {
          fetchSignal = options.signal;
          return response(url, byteStream(parts, { error }));
        }
      }), expectedError);
      assert.equal(fetchSignal.aborted, true);
      await assertPreserved(directory, destination, existing);
    });
  }
}

test("an oversized chunk is canceled before exceeding the pinned file size", async t => {
  const { directory, destination } = await fixture(t);
  let canceled = false;
  let requested = 0;
  await assert.rejects(downloadPinnedModel(makePin(), {
    destination,
    fetchImpl: async url => response(url, byteStream([payload, payload, payload], {
      onPull() { requested += 1; },
      onCancel() { canceled = true; }
    }))
  }), /exceeds the pinned size/);
  assert.equal(requested, 2);
  assert.equal(canceled, true);
  await assertPreserved(directory, destination);
});

test("Content-Length mismatch cancels the unread body", async t => {
  const { directory, destination } = await fixture(t);
  let canceled = false;
  await assert.rejects(downloadPinnedModel(makePin(), {
    destination,
    fetchImpl: async url => response(url, byteStream([payload], {
      onCancel() { canceled = true; },
      onPull() { assert.fail("A mismatching declared size must not be read"); }
    }), { headers: { "Content-Length": String(payload.length + 1) } })
  }), /Content-Length/);
  assert.equal(canceled, true);
  await assertPreserved(directory, destination);
});

test("HTTP errors cancel the body and preserve the destination", async t => {
  const { directory, destination } = await fixture(t);
  let canceled = false;
  await assert.rejects(downloadPinnedModel(makePin(), {
    destination,
    fetchImpl: async url => response(url, byteStream([payload], {
      onCancel() { canceled = true; }
    }), { status: 503 })
  }), /HTTP 503/);
  assert.equal(canceled, true);
  await assertPreserved(directory, destination);
});

test("manual HTTPS redirects validate each host and send no credentials", async t => {
  const { directory, destination } = await fixture(t);
  const pin = makePin();
  const urls = [pin.sourceUrl, "https://cdn-lfs.huggingface.co/model", "https://cas-bridge.xethub.hf.co/artifact?signature=fixture"];
  const calls = [];
  let canceled = 0;
  const result = await downloadPinnedModel(pin, {
    destination,
    fetchImpl: async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, "manual");
      assert.equal(options.credentials, "omit");
      assert.equal(options.referrerPolicy, "no-referrer");
      assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "Accept-Encoding"]);
      const index = urls.indexOf(url);
      assert.notEqual(index, -1);
      return index === urls.length - 1
        ? response(url, byteStream([payload.subarray(0, 11), payload.subarray(11)]))
        : response(url, byteStream([], { onCancel() { canceled += 1; } }), {
          status: index === 0 ? 302 : 307,
          headers: { Location: urls[index + 1], "Set-Cookie": "must-not-be-forwarded=1" }
        });
    }
  });
  assert.equal(result.downloaded, true);
  assert.deepEqual(calls, urls);
  assert.equal(canceled, 2);
  await assertPreserved(directory, destination, payload);
});

for (const location of [
  "http://cdn-lfs.huggingface.co/model", "https://example.com/model", "https://hf.co.example.com/model",
  "https://user:password@cdn-lfs.huggingface.co/model", "https://huggingface.co:8443/model",
  "https://huggingface.co/model#fragment"
]) {
  test(`rejects an unsafe redirect before requesting ${new URL(location).hostname}`, async t => {
    const { directory, destination } = await fixture(t);
    let calls = 0;
    let canceled = false;
    await assert.rejects(downloadPinnedModel(makePin(), {
      destination,
      fetchImpl: async url => {
        calls += 1;
        return response(url, byteStream([], { onCancel() { canceled = true; } }), {
          status: 302, headers: { Location: location }
        });
      }
    }), /approved Hugging Face HTTPS/);
    assert.equal(calls, 1);
    assert.equal(canceled, true);
    await assertPreserved(directory, destination);
  });
}

test("relative redirects resolve before validation and redirect loops are bounded", async t => {
  const { directory, destination } = await fixture(t);
  const calls = [];
  let canceled = 0;
  await assert.rejects(downloadPinnedModel(makePin(), {
    destination, maxRedirects: 2,
    fetchImpl: async url => {
      calls.push(url);
      return response(url, byteStream([], { onCancel() { canceled += 1; } }), {
        status: 308, headers: { Location: "/loop" }
      });
    }
  }), /redirect limit/);
  assert.deepEqual(calls.slice(1), ["https://huggingface.co/loop", "https://huggingface.co/loop"]);
  assert.equal(calls.length, 3);
  assert.equal(canceled, 3);
  await assertPreserved(directory, destination);
});

for (const [finalUrl, redirected, expected] of [
  ["https://example.com/unexpected", false, /approved Hugging Face HTTPS/],
  ["https://cdn-lfs.huggingface.co/unexpected", false, /unvalidated redirect/],
  [makePin().sourceUrl, true, /unvalidated redirect/]
]) {
  test("rejects a fetch implementation that followed an unvalidated final redirect", async t => {
    const { directory, destination } = await fixture(t);
    let canceled = false;
    await assert.rejects(downloadPinnedModel(makePin(), {
      destination,
      fetchImpl: async () => response(finalUrl, byteStream([payload], {
        onCancel() { canceled = true; }
      }), { redirected })
    }), expected);
    assert.equal(canceled, true);
    await assertPreserved(directory, destination);
  });
}

test("a deadline bounds fetch even when it ignores abort, and cancels a late response", { timeout: 3000 }, async t => {
  const { directory, destination } = await fixture(t);
  let resolveFetch;
  let fetchSignal;
  const deferred = new Promise(resolve => { resolveFetch = resolve; });
  const started = performance.now();
  await assert.rejects(downloadPinnedModel(makePin(), {
    destination, timeoutMs: 60,
    fetchImpl: (_url, options) => { fetchSignal = options.signal; return deferred; }
  }), /timed out/);
  assert.ok(performance.now() - started < 1500);
  assert.equal(fetchSignal.aborted, true);
  await assertPreserved(directory, destination);
  let canceled = false;
  resolveFetch(response(makePin().sourceUrl, byteStream([payload], { onCancel() { canceled = true; } })));
  await nextTurn();
  assert.equal(canceled, true);
});

test("a deadline cancels a stalled stream without waiting for a broken cancel promise", { timeout: 3000 }, async t => {
  const { directory, destination } = await fixture(t);
  let canceled = false;
  let fetchSignal;
  await assert.rejects(downloadPinnedModel(makePin(), {
    destination, timeoutMs: 60,
    fetchImpl: async (url, options) => {
      fetchSignal = options.signal;
      return response(url, new ReadableStream({
        pull() { return new Promise(() => {}); },
        cancel() { canceled = true; return new Promise(() => {}); }
      }, { highWaterMark: 0 }));
    }
  }), /timed out/);
  assert.equal(fetchSignal.aborted, true);
  assert.equal(canceled, true);
  await assertPreserved(directory, destination);
});

test("caller cancellation cleans a partially written download", async t => {
  const { directory, destination } = await fixture(t);
  const controller = new AbortController();
  await assert.rejects(downloadPinnedModel(makePin(), {
    destination, signal: controller.signal,
    fetchImpl: async url => response(url, byteStream([payload.subarray(0, 8), payload.subarray(8)], {
      onPull(index) { if (index === 1) controller.abort(new Error("caller canceled")); }
    }))
  }), /caller canceled/);
  await assertPreserved(directory, destination);
});

test("already-aborted callers and invalid limits fail before fetching", async t => {
  const { directory, destination } = await fixture(t);
  const fetchImpl = () => assert.fail("Invalid options must not fetch");
  for (const timeoutMs of [0, Infinity, 3_600_001]) {
    await assert.rejects(downloadPinnedModel(makePin(), { destination, fetchImpl, timeoutMs }), /timeout/);
  }
  for (const maxRedirects of [-1, 11, 1.5]) {
    await assert.rejects(downloadPinnedModel(makePin(), { destination, fetchImpl, maxRedirects }), /redirect limit/);
  }
  await assert.rejects(downloadPinnedModel(makePin(), {
    destination, fetchImpl, signal: AbortSignal.abort(new Error("already canceled"))
  }), /already canceled/);
  await assertPreserved(directory, destination);
});

test("concurrent downloads use distinct temporary files", async t => {
  const { directory, destination } = await fixture(t);
  let release;
  const bothStarted = new Promise(resolve => { release = resolve; });
  let started = 0;
  const fetchImpl = async url => {
    started += 1;
    if (started === 2) {
      const partials = (await readdir(directory)).filter(name => name.endsWith(".partial"));
      assert.equal(partials.length, 2);
      assert.notEqual(partials[0], partials[1]);
      release();
    }
    await bothStarted;
    return response(url, byteStream([payload]));
  };
  const results = await Promise.all([
    downloadPinnedModel(makePin(), { destination, fetchImpl }),
    downloadPinnedModel(makePin(), { destination, fetchImpl })
  ]);
  assert.equal(results.every(result => result.downloaded), true);
  await assertPreserved(directory, destination, payload);
});

test("a symlink destination and its target are preserved without fetching", async t => {
  const { directory, destination } = await fixture(t, null);
  const target = path.join(directory, "target.gguf");
  await writeFile(target, payload);
  await symlink(target, destination);
  await assert.rejects(downloadPinnedModel(makePin(), {
    destination, fetchImpl: () => assert.fail("A symlink destination must not fetch")
  }), /regular file/);
  assert.deepEqual(await readFile(target), payload);
  assert.deepEqual((await readdir(directory)).sort(), ["model.gguf", "target.gguf"]);
});
