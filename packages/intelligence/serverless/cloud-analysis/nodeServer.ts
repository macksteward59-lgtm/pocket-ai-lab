import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { CLOUD_ANALYSIS_LIMITS } from "./types";
import { cloudAnalysisError, type CloudAnalysisHandler } from "./gateway";

export function createBearerAuthenticator(applicationToken: string): (header: string | undefined) => boolean {
  if (typeof applicationToken !== "string" || applicationToken.length < 32 || applicationToken.length > 512 ||
      /^[A-Za-z0-9._~+/-]+$/.exec(applicationToken)?.[0] !== applicationToken) {
    throw new Error("A bounded application bearer token of at least 32 characters is required.");
  }
  const expected = Buffer.from("Bearer " + applicationToken, "utf8");
  return header => {
    if (typeof header !== "string") return false;
    const supplied = Buffer.from(header, "utf8");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  };
}

async function send(response: Response, target: ServerResponse): Promise<void> {
  if (target.destroyed || target.writableEnded) return;
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  // The production handler has already bounded and serialized this response.
  const body = await response.text();
  if (target.destroyed || target.writableEnded) return;
  target.writeHead(response.status, headers);
  target.end(body);
}

/** A listener adapter only. Caller must bind explicitly; reference CLI binds loopback. */
export function createCloudAnalysisNodeServer(options: { handler: CloudAnalysisHandler }): http.Server {
  if (typeof options?.handler !== "function") throw new Error("A cloud analysis handler is required.");
  const server = http.createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const controller = new AbortController();
    const onAborted = () => controller.abort();
    const onClosed = () => { if (!response.writableEnded) controller.abort(); };
    request.once("aborted", onAborted);
    response.once("close", onClosed);
    try {
      const chunks: Buffer[] = [];
      let byteCount = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteCount += bytes.length;
        if (byteCount > CLOUD_ANALYSIS_LIMITS.requestBytes) {
          response.setHeader("connection", "close");
          request.resume();
          await send(cloudAnalysisError("payload_too_large"), response);
          return;
        }
        chunks.push(bytes);
      }
      if (controller.signal.aborted || response.destroyed) return;
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === "string") headers.set(name, value);
        else if (Array.isArray(value)) headers.set(name, value.join(", "));
      }
      const method = request.method ?? "GET";
      const incoming = new Request(new URL(request.url ?? "/", "http://127.0.0.1"), {
        method,
        headers,
        ...(method === "GET" || method === "HEAD" ? {} : { body: new Uint8Array(Buffer.concat(chunks)) }),
        signal: controller.signal
      });
      await send(await options.handler(incoming), response);
    } catch {
      if (!response.destroyed && !response.writableEnded) await send(cloudAnalysisError("internal_error"), response);
    } finally {
      request.removeListener("aborted", onAborted);
      response.removeListener("close", onClosed);
    }
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  server.setTimeout(CLOUD_ANALYSIS_LIMITS.timeoutMs + 1_000, socket => socket.destroy());
  return server;
}
