# Serverless Deployment v1.0

## 1. The core constraint: why this is a split, not a lift-and-shift
A serverless function (Lambda, Cloudflare Workers, Vercel Edge) has a small
code package, little or no writable disk for a multi-gigabyte GGUF file,
no guaranteed persistent memory between invocations, and a hard execution
timeout. Loading a local model and holding it in memory across requests does
not fit that environment. Claiming otherwise would just mean the first real
request times out or runs out of disk.

The practical split:
- **Control plane (serverless-friendly):** request routing, rate limiting,
  and calls into injected security and expansion ports. None of this holds a
  model in memory or runs for long. The ports are not started here.
- **Inference host (stays on a persistent box):** the actual GGUF model,
  loaded once, serving requests. This package does not deploy that host.

## 2. How they connect
```
request --> [serverless control plane] --> RemoteInferenceProvider --> [inference host]
              routing, rate limit,            HTTP, POST /v1/generate      GGUF model
              injected ports                  only if enabled: true        not deployed here
```
`RemoteInferenceProvider` implements `InferenceProvider` over HTTP only when
a host constructs it with `enabled: true` and a base URL. The consumer web
server does not import it. Returned model text is untrusted and does not
set `authorized`. The default local path is unchanged.

## 3. Code map
- `packages/intelligence/serverless/types.ts` -- `GenericRequest`/`GenericResponse`, the shape every adapter normalizes to.
- `packages/intelligence/serverless/handler.ts` -- `createAgencyHandler()`. All routing and validation lives here, once, so behavior is identical across platforms.
- `packages/intelligence/serverless/adapters.ts` -- `toNodeHandler`, `toFetchHandler` (Cloudflare Workers / Deno Deploy / Vercel Edge), `toLambdaHandler` (API Gateway HTTP API v2). Adding a platform means writing one more of these, not touching the handler.
- `packages/intelligence/serverless/rateLimitStore.ts` -- `RateLimitStore` interface + `InMemoryRateLimitStore`.
- `packages/intelligence/serverless/RemoteInferenceProvider.ts` -- HTTP-based `InferenceProvider`.

This is additive and off by default. `apps/web/server.mjs` does not import
it, and no listener starts unless a host calls `createServer` or a platform
entry point itself. `createAgencyHandler` decides; it does not execute tools.
`/security/tool-use` returns 501.

## 4. The one thing that does NOT travel for free: rate limiting
`apps/web/server.mjs`'s existing limiter keeps counts in an in-memory `Map`,
which only works correctly with exactly one process. Most serverless
platforms run several concurrent instances with no shared memory, so
`InMemoryRateLimitStore` under-counts across instances -- each instance
enforces the limit independently, so the *effective* limit is roughly
(configured limit) x (concurrent instances). For a platform that scales to
multiple instances, inject a `RateLimitStore` backed by something shared
(Redis/Upstash, Cloudflare KV or Durable Objects, DynamoDB). This package
has no network access to pick one for you or implement it; the interface is
the seam.

## 5. What ships here vs. what you still configure
Ships:
- The handler, its three routes (`/security/assemble`, `/security/release`,
  `/director/expand-team`), `/health`, and the three adapters.
- Request validation, body-size limits, and per-client, per-route-group rate
  limiting (in-memory by default).
Does not ship:
- A `RateLimitStore` backed by a real shared store (see Section 4).
- A deployed inference host, a model downloader, or any import from the
  consumer web server. Remote inference stays off until a host passes
  `enabled: true`.
- `/security/tool-use` is intentionally a 501 in the generic handler: a live
  `SecurityTeam` object isn't a serializable thing to hand back and forth
  across stateless requests, so a host wiring this up needs its own
  task/team lookup (a database row, a cache) before this route can do
  anything. Faking a response here would be worse than refusing one.
