/**
 * llama-server HTTP transport.
 * Speaks the native /completion API and the OpenAI-compatible chat API.
 * No cloud SDK and no native addon.
 */

import type { LlamaCppBackend, LlamaCppCompletionParams, LlamaCppCompletionResult } from "./backend";
import type { LlamaCppProviderConfig } from "./config";
import { isAbortError, LlamaCppInferenceError } from "./errors";

const MAX_RESPONSE_BYTES = 2_000_000;

export class HttpLlamaCppBackend implements LlamaCppBackend {
  constructor(private readonly config: Pick<LlamaCppProviderConfig, "baseUrl" | "api">) {}

  async complete(params: LlamaCppCompletionParams, signal: AbortSignal): Promise<LlamaCppCompletionResult> {
    const path = this.config.api === "openai-chat" ? "/v1/chat/completions" : "/completion";
    const response = await this.post(path, buildBody(this.config.api, params), signal);
    const body = await readCheckedBody(response, signal, path);
    return { content: readContent(this.config.api, body) };
  }

  async health(signal: AbortSignal): Promise<void> {
    const url = endpoint(this.config.baseUrl, "/health");
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        signal,
        headers: { accept: "application/json, text/plain" }
      });
    } catch (error) {
      throw mapTransportError(error, url);
    }
    const body = await readCheckedBody(response, signal, "/health");
    if (!isHealthyBody(body)) {
      throw new LlamaCppInferenceError(
        "malformed_response",
        "llama.cpp health check did not report status ok"
      );
    }
  }

  private async post(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const url = endpoint(this.config.baseUrl, path);
    try {
      return await fetch(url, {
        method: "POST",
        signal,
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw mapTransportError(error, url);
    }
  }
}

function buildBody(
  api: LlamaCppProviderConfig["api"],
  params: LlamaCppCompletionParams
): Record<string, unknown> {
  if (api === "openai-chat") {
    const body: Record<string, unknown> = {
      model: params.model,
      messages: [{ role: "user", content: params.prompt }],
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: false
    };
    if (params.stop && params.stop.length > 0) body.stop = [...params.stop];
    if (params.seed !== undefined) body.seed = params.seed;
    return body;
  }

  const body: Record<string, unknown> = {
    prompt: params.prompt,
    temperature: params.temperature,
    n_predict: params.maxTokens,
    stream: false
  };
  if (params.stop && params.stop.length > 0) body.stop = [...params.stop];
  if (params.seed !== undefined) body.seed = params.seed;
  return body;
}

function readContent(api: LlamaCppProviderConfig["api"], body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new LlamaCppInferenceError(
      "malformed_response",
      "llama.cpp backend response is not JSON",
      { cause: error }
    );
  }
  if (api === "openai-chat") return readChatContent(parsed);
  return readCompletionContent(parsed);
}

function readCompletionContent(parsed: unknown): string {
  if (!isRecord(parsed) || typeof parsed.content !== "string") {
    throw new LlamaCppInferenceError(
      "malformed_response",
      "llama.cpp /completion response is missing string content"
    );
  }
  return parsed.content;
}

function readChatContent(parsed: unknown): string {
  if (!isRecord(parsed) || !Array.isArray(parsed.choices) || parsed.choices.length === 0) {
    throw new LlamaCppInferenceError(
      "malformed_response",
      "llama.cpp /v1/chat/completions response is missing choices"
    );
  }
  const choice = parsed.choices[0];
  const message = isRecord(choice) ? choice.message : undefined;
  if (!isRecord(message) || typeof message.content !== "string") {
    throw new LlamaCppInferenceError(
      "malformed_response",
      "llama.cpp /v1/chat/completions response is missing message content"
    );
  }
  return message.content;
}

function isHealthyBody(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed === "ok") return true;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) && parsed.status === "ok";
  } catch {
    return false;
  }
}

async function readCheckedBody(response: Response, signal: AbortSignal, path: string): Promise<string> {
  let consumed = false;
  try {
    if (!response.ok) {
      throw new LlamaCppInferenceError(
        "http_error",
        `llama.cpp backend returned HTTP ${response.status} for ${path}`,
        { status: response.status }
      );
    }
    if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
      throw new LlamaCppInferenceError(
        "malformed_response",
        "llama.cpp backend returned an event stream; this adapter requires a single JSON response"
      );
    }
    const declared = response.headers.get("content-length");
    if (declared && Number(declared) > MAX_RESPONSE_BYTES) {
      throw new LlamaCppInferenceError(
        "malformed_response",
        `llama.cpp response exceeded ${MAX_RESPONSE_BYTES} bytes`
      );
    }
    const body = await readBody(response, signal);
    consumed = true;
    if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
      throw new LlamaCppInferenceError(
        "malformed_response",
        `llama.cpp response exceeded ${MAX_RESPONSE_BYTES} bytes`
      );
    }
    return body;
  } finally {
    if (!consumed) await response.body?.cancel().catch(() => undefined);
  }
}

function readBody(response: Response, signal: AbortSignal): Promise<string> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(abortReason(signal));
      void response.body?.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    response.text().then(
      value => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener("abort", onAbort);
        reject(isAbortError(error) ? abortReason(signal) : error);
      }
    );
  });
}

function abortReason(signal: AbortSignal): unknown {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException("aborted", "AbortError");
}

function mapTransportError(error: unknown, url: string): unknown {
  if (isAbortError(error)) return error;
  if (error instanceof LlamaCppInferenceError) return error;
  const detail = error instanceof Error ? error.message : "request failed";
  return new LlamaCppInferenceError(
    "backend_unreachable",
    `llama.cpp backend unreachable at ${url}: ${detail}`,
    { cause: error }
  );
}

function endpoint(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ""), base).toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
