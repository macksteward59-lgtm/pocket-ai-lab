function isLoopback(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function cloudProviderConfig(env = process.env) {
  const rawBaseUrl = String(env.POCKET_CLOUD_BASE_URL || "").trim();
  const apiKey = String(env.POCKET_CLOUD_API_KEY || "").trim();
  const model = String(env.POCKET_CLOUD_MODEL || "").trim();
  let baseUrl = "";
  let validUrl = false;
  try {
    const url = new URL(rawBaseUrl);
    const secure = url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url.hostname));
    if (secure && !url.username && !url.password && !url.search && !url.hash) {
      url.pathname = url.pathname.replace(/\/+$/, "") || "/v1";
      if (!url.pathname.endsWith("/v1")) url.pathname += "/v1";
      baseUrl = url.toString().replace(/\/$/, "");
      validUrl = true;
    }
  } catch {
    // Invalid host configuration is unavailable, never guessed.
  }
  return { baseUrl, model: model || undefined, apiKey, configured: validUrl && Boolean(apiKey) && Boolean(model) };
}

export function createCloudChatProvider({ config, fetchImpl = fetch } = {}) {
  if (!config?.configured || !config.apiKey || !config.model || !config.baseUrl) {
    throw Object.assign(new Error("Cloud provider is not completely configured."), { code: "invalid_config" });
  }
  return {
    async generate(message, { signal } = {}) {
      if (typeof message !== "string" || !message.trim()) {
        throw Object.assign(new Error("A non-empty message is required."), { code: "invalid_request" });
      }
      let response;
      try {
        response = await fetchImpl(config.baseUrl + "/chat/completions", {
          method: "POST",
          redirect: "error",
          headers: { authorization: "Bearer " + config.apiKey, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ model: config.model, messages: [{ role: "user", content: message }] }),
          signal
        });
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        throw Object.assign(new Error("The configured cloud provider could not be reached."), { code: "backend_unreachable" });
      }
      if (!response.ok) throw Object.assign(new Error("The configured cloud provider rejected the request."), { code: "http_error" });
      let data;
      try { data = await response.json(); }
      catch { throw Object.assign(new Error("The cloud provider returned an invalid response."), { code: "invalid_response" }); }
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw Object.assign(new Error("The cloud provider returned no usable message."), { code: "invalid_response" });
      }
      let analysis = content.trim();
      try {
        const structured = JSON.parse(analysis);
        if (structured && typeof structured.analysis === "string" && structured.analysis.trim()) analysis = structured.analysis.trim();
      } catch {
        // Plain-text chat output is valid.
      }
      return { payload: { analysis }, modelId: config.model };
    }
  };
}
