/**
 * Optional read-only GET client for Microsoft Graph or Azure Resource Manager.
 *
 * Off unless a host passes `enabled: true`. The only method is `get`.
 * POST, PUT, PATCH, and DELETE do not exist. Paths outside the audit
 * allowlist are rejected before any request. The default reviewer never
 * constructs this client; it reads a static export instead.
 *
 * The full Graph and ARM SDKs are not dependencies. Those SDKs can call
 * write APIs. This wrapper cannot.
 */

export class ReadOnlyCloudError extends Error {}

export type CloudService = "graph" | "arm";

const GRAPH_PREFIXES = [
  "/v1.0/organization",
  "/v1.0/directoryRoles",
  "/v1.0/applications",
  "/v1.0/servicePrincipals"
];

const ARM_PREFIX = /^\/subscriptions\/[0-9a-fA-F-]{36}(?:\/resourcegroups(?:\/[^/]+)?)?(?:\/providers\/microsoft\.(?:authorization\/roleassignments|storage\/storageaccounts)(?:\/[^/]+)?)?$/i;

const BLOCKED_SEGMENTS = ["resetpassword", "runcommand", "invoke", "delete", "write", "grant", "attack", "payload"];

export interface ReadOnlyCloudOptions {
  /** Must be exactly true. The client is off otherwise. */
  enabled: true;
  service: CloudService;
  /** Origin only, for example https://graph.microsoft.com. No path. */
  baseUrl: string;
  /** Host-supplied token. Never read from the environment and never written to disk here. */
  accessToken?: string;
  fetchImpl: typeof fetch;
}

export class DisabledReadOnlyCloud {
  async get(_path?: string): Promise<never> {
    throw new ReadOnlyCloudError("Read-only cloud access is off. Review a static JSON or CSV export instead.");
  }
}

export class ReadOnlyCloudClient {
  private readonly baseUrl: string;
  private readonly accessToken?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly service: CloudService;

  constructor(opts: ReadOnlyCloudOptions) {
    if (opts?.enabled !== true) {
      throw new ReadOnlyCloudError("Read-only cloud access is off unless enabled is true");
    }
    if (opts.service !== "graph" && opts.service !== "arm") {
      throw new ReadOnlyCloudError("service must be graph or arm");
    }
    let origin: URL;
    try {
      origin = new URL(opts.baseUrl);
    } catch {
      throw new ReadOnlyCloudError("baseUrl must be an absolute URL");
    }
    if (origin.protocol !== "https:") throw new ReadOnlyCloudError("baseUrl must use https");
    if (origin.pathname !== "/" || origin.search || origin.username) {
      throw new ReadOnlyCloudError("baseUrl must be an origin with no path, query, or userinfo");
    }
    if (typeof opts.fetchImpl !== "function") throw new ReadOnlyCloudError("fetchImpl is required");
    this.baseUrl = origin.origin;
    this.accessToken = opts.accessToken;
    this.fetchImpl = opts.fetchImpl;
    this.service = opts.service;
  }

  async get(path: string): Promise<unknown> {
    const url = allowlistedGetUrl(this.service, this.baseUrl, path);
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.accessToken) headers.authorization = "Bearer " + this.accessToken;
    const response = await this.fetchImpl(url, { method: "GET", headers });
    if (!response.ok) {
      throw new ReadOnlyCloudError("Read-only request failed with status " + response.status);
    }
    return response.json();
  }
}

/** Used by tests and hosts to prove a non-GET never becomes a request. */
export function allowlistedGetUrl(service: CloudService, baseUrl: string, path: string): string {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new ReadOnlyCloudError("path must start with /");
  }
  let url: URL;
  try {
    url = new URL(path, baseUrl);
  } catch {
    throw new ReadOnlyCloudError("path is not a valid URL path");
  }
  if (url.origin !== new URL(baseUrl).origin) throw new ReadOnlyCloudError("path must stay on the configured origin");
  const lowered = url.pathname.toLowerCase();
  if (BLOCKED_SEGMENTS.some(segment => lowered.split("/").includes(segment))) {
    throw new ReadOnlyCloudError("path is not a read-only audit request");
  }
  const allowed = service === "graph"
    ? GRAPH_PREFIXES.some(prefix => url.pathname === prefix || url.pathname.startsWith(prefix + "/"))
    : ARM_PREFIX.test(url.pathname);
  if (!allowed) throw new ReadOnlyCloudError("path is outside the read-only audit allowlist");
  for (const [key, value] of url.searchParams) {
    if (key === "$select") continue;
    if (key === "$top") {
      const top = Number(value);
      if (!Number.isInteger(top) || top < 1 || top > 100) {
        throw new ReadOnlyCloudError("$top must be an integer from 1 to 100");
      }
      continue;
    }
    throw new ReadOnlyCloudError("Only $select and $top query parameters are accepted");
  }
  return url.toString();
}
