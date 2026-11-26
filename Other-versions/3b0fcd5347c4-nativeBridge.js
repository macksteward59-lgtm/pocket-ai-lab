(() => {
  "use strict";

  const allowedFields = Object.freeze({
    getRuntimeStatus: [],
    listModels: [],
    checkReadiness: ["sessionId"],
    authorizeGeneration: ["sessionId", "requestId"],
    generate: [
      "sessionId", "prompt", "requestId", "conversationRequestId",
      "attemptId", "challengeNonce", "maxTokens", "temperature"
    ],
    cancelGeneration: ["sessionId", "requestId"]
  });

  function makeError(code, message) {
    const error = new Error(message || code || "Native bridge request failed.");
    error.code = code || "native_bridge_error";
    return error;
  }

  function uuid() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") {
      throw makeError("secure_random_unavailable", "Secure random UUID generation is unavailable.");
    }
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" +
      hex.slice(16, 20) + "-" + hex.slice(20);
  }

  function handler() {
    return globalThis.webkit &&
      globalThis.webkit.messageHandlers &&
      globalThis.webkit.messageHandlers.pocketAILab;
  }

  function isAvailable() {
    const target = handler();
    return !!target && typeof target.postMessage === "function";
  }

  async function request(action, fields = {}) {
    const target = handler();
    if (!target || typeof target.postMessage !== "function") {
      throw makeError("native_bridge_unavailable", "This workspace is not running inside the Pocket AI Lab iOS app.");
    }
    const permitted = allowedFields[action];
    if (!permitted) throw makeError("unsupported_action", "The native bridge action is not supported.");
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      throw makeError("invalid_fields", "Native bridge request fields must be an object.");
    }
    for (const key of Object.keys(fields)) {
      if (!permitted.includes(key)) {
        throw makeError("invalid_fields", "Unexpected native bridge field: " + key);
      }
    }
    const id = uuid();
    const message = Object.assign({ id, action }, fields);
    let response;
    try {
      response = await target.postMessage(message);
    } catch (error) {
      throw makeError("native_bridge_transport_error", error && error.message);
    }
    if (!response || response.id !== id || typeof response.ok !== "boolean") {
      throw makeError("invalid_native_response", "The native bridge returned an invalid response.");
    }
    if (!response.ok) {
      throw makeError(response.error, response.detail || response.error || "Native bridge request was rejected.");
    }
    if (!response.data || typeof response.data !== "object") {
      throw makeError("invalid_native_response", "The native bridge response did not contain data.");
    }
    return response.data;
  }

  async function generate(prompt, options = {}) {
    if (typeof prompt !== "string" || !prompt.trim()) {
      throw makeError("invalid_prompt", "Enter a message before sending.");
    }
    if (new TextEncoder().encode(prompt).length > 32_768) {
      throw makeError("prompt_too_large", "The message is larger than the native runtime limit.");
    }
    const maxTokens = options.maxTokens === undefined ? 256 : options.maxTokens;
    const temperature = options.temperature === undefined ? 0.7 : options.temperature;
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 32_768 ||
        typeof temperature !== "number" || !Number.isFinite(temperature) ||
        temperature < 0 || temperature > 2) {
      throw makeError("invalid_generation_options", "Generation settings are outside the native runtime limits.");
    }

    const status = await request("getRuntimeStatus");
    if (!status.runtimeAvailable) {
      throw makeError("native_runtime_unavailable", "The app-scoped iPhone runtime is unavailable.");
    }
    const catalog = await request("listModels");
    const selected = Array.isArray(catalog.models)
      ? catalog.models.find(model => model && model.selected === true)
      : undefined;
    if (!selected || typeof selected.id !== "string") {
      throw makeError("model_not_selected", "Select an imported model in the Local AI tab first.");
    }
    const activeSessions = Array.isArray(status.activeLocalSessions) ? status.activeLocalSessions : [];
    const active = activeSessions.find(session =>
      session && session.modelId === selected.id && typeof session.sessionId === "string"
    );
    if (!active) {
      throw makeError("model_not_loaded", "Load the selected model in the Local AI tab before using Workspace.");
    }

    const sessionId = active.sessionId;
    const readiness = await request("checkReadiness", { sessionId });
    if (readiness.canGenerate !== true || readiness.sessionId !== sessionId) {
      throw makeError("runtime_not_ready", "The native model did not pass its readiness check.");
    }

    const requestId = uuid();
    const authorization = await request("authorizeGeneration", { sessionId, requestId });
    if (authorization.sessionId !== sessionId ||
        authorization.requestId !== requestId ||
        typeof authorization.challengeNonce !== "string" ||
        authorization.challengeNonce.length < 16) {
      throw makeError("invalid_generation_challenge", "The native host did not issue a valid generation challenge.");
    }

    const signal = options.signal;
    if (signal && signal.aborted) {
      throw makeError("generation_cancelled", "Generation was cancelled before native inference started.");
    }

    let abortListener;
    let abortPromise;
    if (signal && typeof signal.addEventListener === "function") {
      abortPromise = new Promise((resolve, reject) => {
        abortListener = async () => {
          try {
            await cancelGeneration(sessionId, requestId);
            reject(makeError("generation_cancelled", "Native generation was cancelled and drained."));
          } catch (error) {
            reject(makeError("generation_cancel_failed", error && error.message));
          }
        };
        signal.addEventListener("abort", abortListener, { once: true });
      });

      // Close the check/listener race before dispatching native inference.
      if (signal.aborted) {
        signal.removeEventListener("abort", abortListener);
        throw makeError("generation_cancelled", "Generation was cancelled before native inference started.");
      }
    }

    let record;
    try {
      // Dispatch the native request before invoking onRequest. The abort listener
      // is already installed, so synchronous cancellation from onRequest cannot
      // be lost and will cancel this exact native request.
      const generationPromise = request("generate", {
        sessionId,
        prompt,
        requestId,
        conversationRequestId: uuid(),
        attemptId: uuid(),
        challengeNonce: authorization.challengeNonce,
        maxTokens,
        temperature
      });
      if (typeof options.onRequest === "function") {
        options.onRequest({ sessionId, requestId });
      }
      record = abortPromise
        ? await Promise.race([generationPromise, abortPromise])
        : await generationPromise;

      // If generation wins the race after AbortSignal fires, still wait for the
      // native cancellation response. The host response represents completion
      // of the native drain; never surface output from a cancelled request.
      if (signal && signal.aborted && abortPromise) {
        await abortPromise;
      }
    } finally {
      if (signal && abortListener) {
        signal.removeEventListener("abort", abortListener);
      }
    }
    if (record.runtimeSessionId !== sessionId || typeof record.output !== "string") {
      throw makeError("runtime_session_mismatch", "The generation result did not match the active native session.");
    }
    return record;
  }

  async function cancelGeneration(sessionId, requestId) {
    if (typeof sessionId !== "string" || typeof requestId !== "string") {
      throw makeError("invalid_request", "A runtime session and request UUID are required for cancellation.");
    }
    return request("cancelGeneration", { sessionId, requestId });
  }

  Object.defineProperty(globalThis, "PocketAILabNativeBridge", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      isAvailable,
      request,
      getRuntimeStatus: () => request("getRuntimeStatus"),
      listModels: () => request("listModels"),
      generate,
      cancelGeneration
    })
  });
})();
