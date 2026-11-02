# Local model setup

1. Start a llama.cpp server with an OpenAI-compatible chat completions endpoint. Example: `llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8080`.
2. Start Pocket AI Lab with `LLM_BASE_URL=http://127.0.0.1:8080/v1` and `LLM_MODEL=<the-loaded-model-name>`.
3. Open `http://localhost:4173`, wait for the model status to become ready, and send a prompt.
4. Keep the server bound to loopback for local-only use. Do not expose the prototype server to the public internet.

The prototype proxy accepts only the app's chat request, enforces a 12,000-character prompt limit, applies a 60-second upstream timeout, and keeps the optional API key on the server. It does not yet provide user accounts, multi-tenant isolation, rate limiting, streaming, remote-provider consent flows, or production-grade CSRF/authentication. Those are release blockers for a hosted consumer service.
