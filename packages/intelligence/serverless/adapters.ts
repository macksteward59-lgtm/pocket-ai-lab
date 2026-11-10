/**
 * Platform adapters. Each one only translates request/response shapes; the
 * actual routing and business logic lives in handler.ts. Add a new platform
 * by writing one function here, not by touching the handler.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GenericRequest, GenericResponse, Handler } from "./types";

function parseQuery(search: string): Record<string, string> {
  const query: Record<string, string> = {};
  new URLSearchParams(search).forEach((value, key) => { query[key] = value; });
  return query;
}

function safeJsonParse(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Node's built-in http server (works unchanged on a dedicated server too). */
export function toNodeHandler(handler: Handler, opts: { maxBodyBytes?: number } = {}) {
  const maxBodyBytes = opts.maxBodyBytes ?? 256 * 1024;
  return async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    let total = 0;
    let oversized = false;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > maxBodyBytes) { oversized = true; break; }
      chunks.push(chunk as Buffer);
    }
    if (oversized) {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Request body too large" }));
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers[key.toLowerCase()] = value;
      else if (Array.isArray(value)) headers[key.toLowerCase()] = value.join(", ");
    }

    const result = await handler({
      method: req.method ?? "GET",
      path: url.pathname,
      headers,
      query: parseQuery(url.search),
      body: safeJsonParse(Buffer.concat(chunks).toString("utf8")),
      clientKey: req.socket?.remoteAddress ?? ""
    });

    res.writeHead(result.status, { "content-type": "application/json", ...result.headers });
    res.end(JSON.stringify(result.body));
  };
}

/** Standard Fetch API: Cloudflare Workers, Deno Deploy, and Vercel/Next Edge functions all accept this shape. */
export function toFetchHandler(handler: Handler) {
  return async function onFetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });

    let body: unknown;
    if (request.method !== "GET" && request.method !== "HEAD") {
      body = safeJsonParse(await request.text());
    }

    const result = await handler({
      method: request.method,
      path: url.pathname,
      headers,
      query: parseQuery(url.search),
      body,
      clientKey: headers["cf-connecting-ip"] ?? headers["x-forwarded-for"] ?? ""
    });

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json", ...result.headers }
    });
  };
}

/** Minimal shapes for AWS API Gateway HTTP API (payload format 2.0); avoids a hard dependency on @types/aws-lambda. */
export interface LambdaHttpEvent {
  requestContext?: { http?: { method?: string; sourceIp?: string }; domainName?: string };
  rawPath?: string;
  rawQueryString?: string;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
}
export interface LambdaHttpResult {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

export function toLambdaHandler(handler: Handler) {
  return async function onInvoke(event: LambdaHttpEvent): Promise<LambdaHttpResult> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(event.headers ?? {})) headers[key.toLowerCase()] = value;

    const rawBody = event.body
      ? (event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body)
      : "";

    const result = await handler({
      method: event.requestContext?.http?.method ?? "GET",
      path: event.rawPath ?? "/",
      headers,
      query: parseQuery(event.rawQueryString ? "?" + event.rawQueryString : ""),
      body: safeJsonParse(rawBody),
      clientKey: event.requestContext?.http?.sourceIp ?? ""
    });

    return { statusCode: result.status, headers: { "content-type": "application/json", ...result.headers }, body: JSON.stringify(result.body) };
  };
}
