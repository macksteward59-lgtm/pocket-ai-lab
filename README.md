# Pocket AI Lab

**Hybrid offline-first multi-agent intelligence platform.** Agents collaborate to determine what should happen; APEX/East authorization and evidence infrastructure determines what is permitted to happen.

## Consumer prototype (web/PWA)

The first usable application shell lives in `apps/web/`. It includes a responsive workspace, chat UI, model connection status, settings and transparent agent/memory/activity sections. It can send real chat requests to a server-configured OpenAI-compatible local inference endpoint; when no model is configured it fails closed and does not invent a response.

### Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm run start:web
```

Open `http://localhost:4173`.

To connect a local llama.cpp server, configure the app host environment:

```bash
LLM_BASE_URL=http://127.0.0.1:8080/v1
LLM_MODEL=your-loaded-model
# Optional; keep credentials server-side only.
LLM_API_KEY=your-local-provider-key
npm run start:web
```

The server calls the configured OpenAI-compatible `/chat/completions` endpoint. Provider URLs and credentials are controlled by the server environment, not browser storage. Do not expose a network-reachable app server without authentication, TLS, and deployment hardening.

```bash
npm test
npm run build
```

The PWA caches its static shell for offline launch. Inference still requires a reachable local or configured provider.

## Architecture principles

1. **Model independence** — Agents are roles, instructions, and permission profiles, not tied to a single model.
2. **Collective intelligence** — Independent analysis → challenge → revision → validation → synthesis.
3. **Governed autonomy** — Permanent core team + dynamic specialists; consequential actions must pass the independent APEX authorization path.
4. **Honest product states** — A role is not represented as an active inference agent until a real provider call occurs. Model text is not verification or authorization.

## Implementation status

| Area | Status |
|---|---|
| Architecture and trust invariants | Documented |
| Multi-agent TypeScript foundation | Implemented; requires integration and production hardening |
| llama.cpp provider | HTTP adapter integrated on this branch; automated tests and independent review pending |
| Consumer web/PWA shell | Merged into `main`; responsive chat shell, local-model proxy, and PWA shell |
| Real chat through configured local endpoint | Merged into `main`; server-side provider proxy with automated tests |
| Agent collaboration UI and live multi-agent execution | Local developer harness integrated; consumer UI connection pending |
| Durable, governed memory | Session-only harness memory; durable persistence not yet connected |
| East/APEX runtime integration | Not yet complete; consequential action execution remains disabled |
| Native iOS local inference | Placeholder; not consumer-ready |
| Production deployment, auth, telemetry, release pipeline | Not yet complete; hosted deployment is not safe yet |

## Local multi-agent lab harness

The separate `runtime/lab` harness runs the real agent roles against a local llama.cpp server. It is a developer/validation surface, not the consumer-facing web app. It binds to `127.0.0.1` by default, streams each agent turn, and explicitly reports `authorized: false` and unverified memory.

Start llama.cpp and then run:

```bash
llama-server -m ./models/model.gguf --host 127.0.0.1 --port 8080 -c 4096
npm run lab
```

Open `http://127.0.0.1:8787`. Keep the llama server on loopback. The lab refuses non-loopback model endpoints unless the operator explicitly sets `POCKET_LAB_ALLOW_REMOTE_LLAMA=1`. The harness is for local testing; it is not a substitute for APEX authorization or a production security boundary.

## Trust invariants (must never break)

- A model cannot grant itself permission.
- An agent cannot approve its own consequential action.
- Agent messages are not authorization receipts.
- Individual generation evidence is preserved; parent task evidence references it.
- Unauthorized actions are denied by APEX.
- Repair operations require independent authorization.

See `docs/architecture/Pocket-AI-Lab-Multi-Agent-Intelligence-Architecture-v1.0.md` and `docs/implementation/consumer-prototype-acceptance.md` for the architecture and measurable product acceptance criteria.
