const DEFAULT_ALLOWED_SCHEMES = new Set(["http:", "https:"]);

export class HostNetworkPermissionError extends Error {
  constructor(message) {
    super(message);
    this.name = "HostNetworkPermissionError";
  }
}

export function normalizeFetchHeaders(headers) {
  if (!headers) return [];
  if (Array.isArray(headers)) {
    return headers.map(([name, value]) => [String(name).toLowerCase(), String(value)]);
  }
  if (typeof headers.entries === "function") {
    return Array.from(headers.entries()).map(([name, value]) => [String(name).toLowerCase(), String(value)]);
  }
  return Object.entries(headers).map(([name, value]) => [String(name).toLowerCase(), String(value)]);
}

export function createNetworkPolicy({
  allowedSchemes = DEFAULT_ALLOWED_SCHEMES,
  allowedOrigins = ["*"],
} = {}) {
  const schemeSet = new Set(allowedSchemes);
  const originSet = new Set(allowedOrigins);
  return {
    allows(url) {
      const parsed = new URL(url);
      if (!schemeSet.has(parsed.protocol)) return false;
      return originSet.has("*") || originSet.has(parsed.origin);
    },
    assertAllowed(url) {
      if (!this.allows(url)) {
        throw new HostNetworkPermissionError(`network access is not permitted for ${url}`);
      }
    },
  };
}

export async function fetchUrlWithPolicy(request, {
  fetchImpl = globalThis.fetch,
  policy = createNetworkPolicy(),
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("host.network.fetch requires a fetch implementation");
  }

  const url = String(request?.url ?? "");
  policy.assertAllowed(url);

  const method = String(request?.method ?? "GET").toUpperCase();
  const headers = request?.headers ? Object.fromEntries(request.headers) : undefined;
  const response = await fetchImpl(url, {
    method,
    headers,
    body: request?.body ?? undefined,
    redirect: "follow",
  });
  const body = new Uint8Array(await response.arrayBuffer());

  return {
    url: response.url || url,
    status: response.status,
    statusText: response.statusText || "",
    headers: normalizeFetchHeaders(response.headers),
    body,
  };
}
