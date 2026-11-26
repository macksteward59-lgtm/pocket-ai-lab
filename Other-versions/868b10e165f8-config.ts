/**
 * Validated settings for a local llama-server (or a future native backend).
 * Defaults target a loopback llama-server and do not open a cloud account.
 */

import { LlamaCppInferenceError } from "./errors";

export type LlamaCppApiMode = "completion" | "openai-chat";

export interface LlamaCppProviderConfigInput {
  /** llama-server origin, for example http://127.0.0.1:8080 */
  baseUrl?: string;
  /**
   * Name sent as the HTTP `model` field for the OpenAI-compatible API.
   * When omitted, the InferenceRequest modelId is used so routing stays
   * outside this adapter. The native /completion API uses the model loaded
   * by llama-server and ignores this alias.
   */
  modelAlias?: string;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  stop?: readonly string[];
  /** Non-negative integer. Omit for the server's random seed. */
  seed?: number;
  /**
   * `completion` posts to llama-server `/completion`.
   * `openai-chat` posts to `/v1/chat/completions`.
   */
  api?: LlamaCppApiMode;
}

export interface LlamaCppProviderConfig {
  baseUrl: string;
  modelAlias?: string;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  stop?: readonly string[];
  seed?: number;
  api: LlamaCppApiMode;
}

export const LLAMA_CPP_DEFAULTS = Object.freeze({
  baseUrl: "http://127.0.0.1:8080",
  timeoutMs: 120_000,
  temperature: 0.2,
  maxTokens: 1024,
  api: "completion" as const
});

const API_MODES: readonly LlamaCppApiMode[] = ["completion", "openai-chat"];
const MAX_TIMEOUT_MS = 600_000;
const MAX_TOKENS = 32_768;
const MAX_STOP = 16;
const MAX_SEED = 2_147_483_647;

export function normalizeLlamaCppConfig(
  input: LlamaCppProviderConfigInput = {}
): LlamaCppProviderConfig {
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? LLAMA_CPP_DEFAULTS.baseUrl);
  const modelAlias = normalizeModelAlias(input.modelAlias);
  const timeoutMs = requireInt(input.timeoutMs ?? LLAMA_CPP_DEFAULTS.timeoutMs, "timeoutMs", 1, MAX_TIMEOUT_MS);
  const temperature = requireTemperature(input.temperature ?? LLAMA_CPP_DEFAULTS.temperature);
  const maxTokens = requireInt(input.maxTokens ?? LLAMA_CPP_DEFAULTS.maxTokens, "maxTokens", 1, MAX_TOKENS);
  const stop = normalizeStop(input.stop);
  const seed = input.seed === undefined ? undefined : requireInt(input.seed, "seed", 0, MAX_SEED);
  const api = normalizeApi(input.api ?? LLAMA_CPP_DEFAULTS.api);

  return Object.freeze({
    baseUrl,
    modelAlias,
    timeoutMs,
    temperature,
    maxTokens,
    stop: stop ? Object.freeze(stop) : undefined,
    seed,
    api
  });
}

function normalizeBaseUrl(value: string): string {
  if (typeof value !== "string") {
    throw configError("baseUrl must be an http(s) URL");
  }
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw configError(`baseUrl is not a valid URL: ${trimmed || "(empty)"}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw configError(`baseUrl must use http or https, received ${url.protocol || "(none)"}`);
  }
  if (!url.hostname) {
    throw configError("baseUrl must include a host");
  }
  url.hash = "";
  url.search = "";
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path || "/";
  return url.toString().replace(/\/$/, "");
}

function normalizeModelAlias(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw configError("modelAlias must be a non-empty string when provided");
  }
  const alias = value.trim();
  if (alias.length > 256) {
    throw configError("modelAlias must be at most 256 characters");
  }
  return alias;
}

function normalizeApi(value: string): LlamaCppApiMode {
  if ((API_MODES as readonly string[]).includes(value)) return value as LlamaCppApiMode;
  throw configError(`api must be "completion" or "openai-chat", received ${JSON.stringify(value)}`);
}

function normalizeStop(value: readonly string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw configError("stop must be an array of strings");
  if (value.length > MAX_STOP) throw configError(`stop accepts at most ${MAX_STOP} strings`);
  const stop = value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw configError(`stop[${index}] must be a non-empty string`);
    }
    if (entry.length > 200) throw configError(`stop[${index}] must be at most 200 characters`);
    return entry;
  });
  return stop.length > 0 ? stop : undefined;
}

function requireTemperature(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2) {
    throw configError("temperature must be a finite number from 0 through 2");
  }
  return value;
}

function requireInt(value: number, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw configError(`${name} must be an integer from ${min} through ${max}`);
  }
  return value;
}

function configError(message: string): LlamaCppInferenceError {
  return new LlamaCppInferenceError("invalid_config", message);
}
