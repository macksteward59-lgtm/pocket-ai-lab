import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { allowedDownloadHost, assertPin, modelDestination, sha256File } from "./lib.mjs";

export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function approvedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !allowedDownloadHost(url.hostname) ||
      url.username || url.password || url.port || url.hash) {
    throw new Error("GGUF download URL must use approved Hugging Face HTTPS without credentials, ports or fragments");
  }
  return url;
}

// Cancellation must not let a broken injected stream hold cleanup open forever.
// Native fetch also receives the abort signal, so its underlying socket closes.
function cancelBody(body, reason) {
  try {
    Promise.resolve(body?.cancel(reason)).catch(() => {});
  } catch {
    // A locked/already-closed body can no longer be canceled through this handle.
  }
}

function abortable(operation, signal, onLateValue) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (!settled) {
        settled = true;
        reject(signal.reason);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      signal.removeEventListener("abort", onAbort);
      return;
    }
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation();
    }).then(value => {
      signal.removeEventListener("abort", onAbort);
      if (settled) {
        onLateValue?.(value);
      } else {
        settled = true;
        resolve(value);
      }
    }, error => {
      signal.removeEventListener("abort", onAbort);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

async function fetchResponse(sourceUrl, { fetchImpl, signal, maxRedirects, checkDeadline }) {
  let url = approvedUrl(sourceUrl);
  for (let redirects = 0; ; redirects += 1) {
    checkDeadline();
    // Revalidate immediately before every request; no caller-provided headers,
    // cookies, Authorization or redirect credentials are carried to the next hop.
    approvedUrl(url.href);
    const response = await abortable(() => fetchImpl(url.href, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/octet-stream", "Accept-Encoding": "identity" },
      signal
    }), signal, lateResponse => cancelBody(lateResponse?.body, signal.reason));
    try {
      const finalUrl = approvedUrl(response.url);
      if (response.redirected || finalUrl.href !== url.href) {
        throw new Error("GGUF fetch followed an unvalidated redirect");
      }
      if (!REDIRECT_STATUSES.has(response.status)) {
        if (response.status !== 200) throw new Error("GGUF download failed with HTTP " + response.status);
        if (!response.body || typeof response.body.getReader !== "function") {
          throw new Error("GGUF download has no readable byte stream");
        }
        return response;
      }
      if (redirects >= maxRedirects) throw new Error("GGUF download exceeded the redirect limit");
      const location = response.headers.get("location");
      if (!location) throw new Error("GGUF redirect has no location");
      url = approvedUrl(new URL(location, url).href);
    } catch (error) {
      cancelBody(response?.body, error);
      throw error;
    }
    cancelBody(response.body, new Error("Following validated GGUF redirect"));
  }
}

/**
 * Download an immutable GGUF pin with bounded network time and memory.
 * The destination changes only at the atomic rename after size/hash validation.
 * Options deliberately expose no headers or credentials to forward across hosts.
 */
export async function downloadPinnedModel(pin, {
  destination,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  maxRedirects = 5,
  signal: callerSignal
} = {}) {
  // Capture primitive pin fields before any asynchronous operation.
  pin = { ...assertPin(pin) };
  destination ??= modelDestination(pin);
  if (typeof destination !== "string" || !destination.trim()) throw new Error("GGUF destination must be a path");
  destination = path.resolve(destination);
  if (typeof fetchImpl !== "function") throw new Error("GGUF fetch implementation must be a function");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_DOWNLOAD_TIMEOUT_MS) {
    throw new Error("GGUF timeout must be between 1 ms and 60 minutes");
  }
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
    throw new Error("GGUF redirect limit must be between 0 and 10");
  }
  if (callerSignal !== undefined && !(callerSignal instanceof AbortSignal)) {
    throw new Error("GGUF signal must be an AbortSignal");
  }

  const controller = new AbortController();
  const signal = controller.signal;
  const timeoutError = new Error("GGUF download timed out after " + timeoutMs + " ms");
  timeoutError.name = "TimeoutError";
  const deadline = performance.now() + timeoutMs;
  const checkDeadline = () => {
    if (performance.now() >= deadline) controller.abort(timeoutError);
    signal.throwIfAborted();
  };
  const forwardAbort = () => controller.abort(callerSignal.reason);
  callerSignal?.addEventListener("abort", forwardAbort, { once: true });
  if (callerSignal?.aborted) forwardAbort();
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  let temporary;
  let file;
  let reader;
  let committed = false;
  let failure;

  try {
    checkDeadline();
    try {
      const existing = await lstat(destination);
      if (!existing.isFile()) throw new Error("GGUF destination must be a regular file");
      if (existing.size === pin.bytes &&
          await sha256File(destination, { signal, maxBytes: pin.bytes }) === pin.sha256) {
        checkDeadline();
        return { path: destination, verified: true, downloaded: false, sha256: pin.sha256 };
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    checkDeadline();
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    checkDeadline();
    const candidate = path.join(path.dirname(destination), ".pocket-gguf-" + randomUUID() + ".partial");
    file = await open(candidate, "wx", 0o600);
    temporary = candidate;

    const response = await fetchResponse(pin.sourceUrl, { fetchImpl, signal, maxRedirects, checkDeadline });
    reader = response.body.getReader();
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && (!/^\d+$/.test(contentLength) || BigInt(contentLength) !== BigInt(pin.bytes))) {
      throw new Error("GGUF Content-Length does not match the pinned size");
    }

    const hash = createHash("sha256");
    let bytes = 0;
    while (true) {
      checkDeadline();
      const { value, done } = await abortable(() => reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error("GGUF download stream yielded non-byte data");
      if (value.byteLength > pin.bytes - bytes) throw new Error("GGUF download exceeds the pinned size");
      // No response-wide Buffer/arrayBuffer: at most one stream chunk is held.
      for (let offset = 0; offset < value.byteLength;) {
        checkDeadline();
        const { bytesWritten } = await file.write(value, offset, value.byteLength - offset);
        if (bytesWritten === 0) throw new Error("GGUF temporary file write made no progress");
        offset += bytesWritten;
      }
      hash.update(value);
      bytes += value.byteLength;
    }
    if (bytes !== pin.bytes) throw new Error("GGUF download size " + bytes + " does not match the pin");
    const digest = hash.digest("hex");
    if (digest !== pin.sha256) throw new Error("GGUF checksum mismatch");
    checkDeadline();
    await file.sync();
    await file.close();
    file = undefined;
    checkDeadline();
    // The temporary file is on the same filesystem. Nothing can fail validation
    // after this commit point, and a failed rename leaves the destination intact.
    await rename(temporary, destination);
    committed = true;
    temporary = undefined;
    return { path: destination, verified: true, downloaded: true, sha256: digest,
      bytes: pin.bytes, license: pin.license, revision: pin.revision };
  } catch (error) {
    failure = signal.aborted ? signal.reason : error;
    throw failure;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", forwardAbort);
    controller.abort(failure ?? new Error("GGUF transfer finished"));
    if (reader) {
      try {
        Promise.resolve(reader.cancel(signal.reason)).catch(() => {});
        reader.releaseLock();
      } catch {
        // Abort also closes native fetch when a pending read still owns the lock.
      }
    }
    try {
      await file?.close();
    } finally {
      if (temporary && !committed) await rm(temporary, { force: true });
    }
  }
}
