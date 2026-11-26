# iOS LlamaEngine Gate 1

`runtime/ios/` is the on-device inference boundary. This slice makes a missing backend fail closed. It does not grant APEX authorization, and it does not claim that Metal ran.

Gate 2 links a pinned llama.cpp and is described in `docs/implementation/ios-llamaengine-gate2.md`. The fail-closed rules below still hold. `LlamaEngineSupport.validateModel` now also rejects a context length above 8192.

## Behavior

`LlamaEngineError` is the typed failure. `PlaceholderLlamaEngine.load` and `generate` throw `backendUnavailable`. They do not return a session and they do not yield `[placeholder inference]` or any other invented token.

`LlamaCppMetalBackend` throws `backendUnavailable` when llama.cpp is not linked or Metal cannot be created. Gate 2 is the linked build. Linux Node CI still does not execute Metal.

`LoopbackLlamaEngine` is optional. It accepts only an `http` or `https` origin on `127.0.0.1`, `localhost`, or `::1`, with an explicit port and no credentials, query, or fragment. `load` calls `GET /health` and continues only when the status is 200 and the JSON `status` is `ok`. `generate` posts one `/completion` body (`prompt`, `n_predict`, `temperature`, `stream: false`) and yields a single token whose text is the server's non-empty `content` string. Missing content, empty content, a non-success status, and an unreachable server throw `backendFailed` or `cancelled`. The engine does not run the agent loop and does not decide authorization.

`cancel` drops the session generation and cancels the active task when that task was retained. `unload` does the same and forgets the session.

## Test plan

The Node CI image does not compile Swift. Gate 2 adds the Swift package, the macOS workflow, and the checks below. On an unlinked build, item 3 is still the Metal result:

1. `PlaceholderLlamaEngine.load` throws `backendUnavailable` for a normal `ModelDescriptor`.
2. `PlaceholderLlamaEngine.generate` throws `backendUnavailable` and the stream is never created.
3. `LlamaCppMetalBackend.load` and `generate` throw `backendUnavailable` when the backend is not linked or Metal is unavailable.
4. `LlamaEngineSupport.isLoopbackHost` accepts `127.0.0.1`, `localhost`, and `::1`, and rejects `0.0.0.0` and `10.0.0.8`.
5. `validateLoopbackBaseURL` rejects a missing port, userinfo, a query, a fragment, and a non-loopback host.
6. `healthIsReady` is true only for JSON `{"status":"ok"}`.
7. `completionContent` returns a non-empty `content` string and throws `backendFailed` for `{}`, a non-object, and `"content":""`.
8. A loopback engine pointed at a closed port fails `load` without returning a session.
9. A fake loopback server that returns `{"content":"hello"}` yields one token, `text == "hello"`, `isComplete == true`.
10. A test does not treat a simulator probe as a physical iPhone run. Gate 2 records the host offload line separately.

Model text from the loopback server remains untrusted proposal text.
