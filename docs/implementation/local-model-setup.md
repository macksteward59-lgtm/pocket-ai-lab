# Local model setup

1. Start llama-server on loopback. Example: `llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8080 -c 4096`.
2. Start Pocket AI Lab with `LLAMACPP_BASE_URL=http://127.0.0.1:8080 npm run start:web`. The default API is llama-server `/completion`. Set `LLAMACPP_API=openai-chat` to use `/v1/chat/completions` instead. Chat asks the model for one JSON object with an `analysis` string and shows only that string.
3. Open `http://127.0.0.1:4173`. The status says "Local model ready" only after this app's server receives `{"status":"ok"}` from loopback `/health`.
4. Keep both servers bound to loopback for local-only use. A non-loopback model URL is not labeled private.

The app accepts the chat request, enforces a 12,000-character prompt limit and a 60-second provider timeout, and does not put an API key in the browser or on the local llama.cpp request. It does not yet provide user accounts, multi-tenant isolation, rate limiting beyond the body limit, remote-provider consent flows, or production-grade CSRF/authentication. Those remain release blockers for a hosted consumer service. Memory and activity stay disconnected from durable storage. Agent output and chat text are untrusted and do not authorize anything.
