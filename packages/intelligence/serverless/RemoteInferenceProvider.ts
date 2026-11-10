/**
 * An InferenceProvider (see orchestrator/Orchestrator.ts) that calls out to a
 * separately hosted inference server over HTTP, instead of loading a GGUF
 * model in-process.
 *
 * Why: a serverless function (Lambda, Workers, Vercel Edge) has a small code
 * package size, little or no writable disk for a multi-gigabyte model file,
 * limited/no persistent memory between invocations, and a hard execution
 * timeout. Loading and running a local GGUF model does not fit that
 * environment. The practical split is: run the control plane (routing,
 * rate limiting, security governance, orchestration) serverless, and run
 * model inference on a normal long-lived host (a container, a GPU box, a
 * managed inference service) that this class talks to as a plain HTTP API.
 * This class does not choose or load a model. It is not constructed by the
 * consumer app. Model output it returns is untrusted.
 */
import type { InferenceProvider, InferenceRequest, InferenceResult } from "../orchestrator/Orchestrator";

export interface RemoteInferenceOptions {
  /**
   * Must be exactly true. Remote inference is off unless a host opts in.
   * Constructing this class is the only way it runs; nothing in the app
   * imports it by default.
   */
  enabled: true;
  /** Base URL of the inference host, e.g. "https://inference.internal.example.com". No trailing slash. */
  baseUrl: string;
  /** Sent as a bearer token; the inference host is expected to require it. */
  apiKey?: string;
  /** Aborts a request after this many ms. Default 30s -- generous for a request/response LLM call, but finite. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class RemoteInferenceError extends Error {}

export class RemoteInferenceProvider implements InferenceProvider {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: RemoteInferenceOptions) {
    if (opts?.enabled !== true) {
      throw new RemoteInferenceError("Remote inference is off unless enabled is true");
    }
    if (!opts.baseUrl?.trim()) throw new RemoteInferenceError("baseUrl is required");
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    const impl = opts.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
    if (!impl) throw new RemoteInferenceError("No fetch implementation available; pass fetchImpl explicitly");
    this.fetchImpl = impl;
  }

  async generate(request: InferenceRequest): Promise<InferenceResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.baseUrl + "/v1/generate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: "Bearer " + this.apiKey } : {})
        },
        body: JSON.stringify(request),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new RemoteInferenceError(`Inference host returned ${response.status}: ${await safeText(response)}`);
      }
      const data = (await response.json()) as Partial<InferenceResult>;
      if (!("payload" in data)) {
        throw new RemoteInferenceError("Inference host response is missing a payload field");
      }
      return { payload: data.payload, evidenceRefs: Array.isArray(data.evidenceRefs) ? data.evidenceRefs : undefined };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new RemoteInferenceError(`Inference host did not respond within ${this.timeoutMs}ms`);
      }
      if (err instanceof RemoteInferenceError) throw err;
      throw new RemoteInferenceError(`Inference request failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable response body>";
  }
}
