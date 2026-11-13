import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64.js";
import {
  DEFAULT_OPTIONS,
  hasExactTargetOrigin,
  isCallerOriginAllowed,
  isPrivateNetworkTarget,
  isTargetUrlAllowed,
  normalizeOptions,
} from "./allowlist.js";
import { appendAuditEntry, storageGet } from "./audit-log.js";
import { ErrorCodes, makeError, proxyErrorResponse } from "./errors.js";
import { makePong, validateBridgeMessage } from "./protocol.js";

const CHANNEL = "WASMACS_COMPANION";
const activeRequests = new Map();
const SAFE_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-type",
  "content-encoding",
  "if-none-match",
  "if-modified-since",
  "range",
  "git-protocol",
  "authorization",
]);
const RESPONSE_HEADERS = new Set([
  "content-type",
  "content-length",
  "etag",
  "last-modified",
  "cache-control",
  "expires",
  "location",
  "www-authenticate",
  "retry-after",
]);

export async function handleRuntimeMessage(envelope, deps = {}) {
  const storage = deps.storage ?? globalThis.chrome?.storage?.local;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch?.bind(globalThis);

  if (!envelope || envelope.channel !== CHANNEL) {
    return proxyErrorResponse(null, makeError(ErrorCodes.BAD_MESSAGE, "Bad extension channel"));
  }

  const { callerOrigin, message } = envelope;
  const requestId = message?.requestId;
  const validationError = validateBridgeMessage(message);
  if (validationError) {
    return proxyErrorResponse(
      requestId,
      validationError,
      responseType(message),
    );
  }

  // A cancellation belongs to one page/document, not merely to an origin.
  const key = JSON.stringify([deps.sender?.tab?.id, deps.sender?.documentId,
    deps.sender?.frameId, callerOrigin, requestId]);
  // Register before storage yields, so a fast cancellation cannot overtake
  // request setup and leave an unwanted POST running after the page gave up.
  let active;
  if (message.type === "WASMACS_PROXY_REQUEST") {
    if (activeRequests.has(key)) {
      return proxyErrorResponse(requestId, makeError(ErrorCodes.BAD_MESSAGE, "requestId is already active"));
    }
    active = { controller: new AbortController(), cancelled: false, timedOut: false };
    activeRequests.set(key, active);
  }
  try {
    const options = normalizeOptions(await loadOptions(storage));
    if (!isCallerOriginAllowed(callerOrigin, options.allowedCallerOrigins)) {
      return proxyErrorResponse(requestId,
        makeError(ErrorCodes.CALLER_NOT_ALLOWED, "Caller origin is not allowed", { callerOrigin }), responseType(message));
    }
    if (message.type === "WASMACS_PROXY_PING") return makePong(requestId);
    if (message.type === "WASMACS_PROXY_CANCEL") {
      const pending = activeRequests.get(key);
      if (pending) {
        pending.cancelled = true;
        pending.controller.abort();
      }
      return { type: "WASMACS_PROXY_CANCELLED", version: 1, requestId, ok: true, cancelled: Boolean(pending) };
    }
    return await handleProxyRequest({ message, callerOrigin, options, fetchImpl, storage, active });
  } finally {
    if (active) activeRequests.delete(key);
  }
}

function responseType(message) {
  return message?.type === "WASMACS_PROXY_PING" ? "WASMACS_PROXY_PONG"
    : message?.type === "WASMACS_PROXY_CANCEL" ? "WASMACS_PROXY_CANCELLED" : "WASMACS_PROXY_RESPONSE";
}

async function handleProxyRequest({ message, callerOrigin, options, fetchImpl, storage, active }) {
  const { requestId, request } = message;
  const method = String(request.method || "GET").toUpperCase();
  let parsed;
  try {
    parsed = new URL(request.url);
  } catch {
    return proxyErrorResponse(requestId, makeError(ErrorCodes.BAD_MESSAGE, "Invalid request URL"));
  }
  const hadUrlCredentials = Boolean(parsed.username || parsed.password);
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  const url = parsed.href;
  const auditUrl = `${parsed.origin}${parsed.pathname}`;
  const credentials = request.credentials || "omit";
  const started = new Date().toISOString();

  const fail = async (error, status = null, bytes = 0) => {
    await audit(storage, options, {
      time: started,
      callerOrigin,
      method,
      url: auditUrl,
      status,
      bytes,
      credentials,
      result: error.code,
    });
    return proxyErrorResponse(requestId, error);
  };

  if (hadUrlCredentials) {
    return fail(makeError(ErrorCodes.CREDENTIALS_NOT_ALLOWED, "Use an explicit Authorization header instead of credentials in URLs"));
  }
  if (method !== "GET" && method !== "HEAD" && method !== "POST") {
    return fail(makeError(ErrorCodes.METHOD_NOT_ALLOWED, "Only GET, HEAD and Git RPC POST are supported", { method }));
  }
  if (!options.allowPrivateNetworkTargets && isPrivateNetworkTarget(url)) {
    return fail(makeError(ErrorCodes.PRIVATE_NETWORK_BLOCKED, "Private network targets are disabled", { url }));
  }
  if (!isTargetUrlAllowed(url, options.targetAllowlist)) {
    return fail(makeError(ErrorCodes.TARGET_NOT_ALLOWED, "Target URL is not in the allowlist", { url }));
  }
  if (!fetchImpl) {
    return fail(makeError(ErrorCodes.INTERNAL_ERROR, "No fetch implementation is available"));
  }

  let headers;
  try {
    headers = filterRequestHeaders(request.headers || {});
  } catch (error) {
    return fail(error);
  }

  const authenticated = credentials === "include" || Object.hasOwn(headers, "authorization");
  if (authenticated && (!options.allowCredentials || !hasExactTargetOrigin(url, options.targetAllowlist))) {
    return fail(makeError(ErrorCodes.CREDENTIALS_NOT_ALLOWED, "Credentials require permission and an exact allowed target origin", { url }));
  }
  if (Object.hasOwn(headers, "authorization") && parsed.protocol !== "https:") {
    return fail(makeError(ErrorCodes.CREDENTIALS_NOT_ALLOWED, "Authorization headers require HTTPS"));
  }
  let body;
  try {
    if (Object.hasOwn(headers, "content-encoding")
        && (method !== "POST" || headers["content-encoding"].trim().toLowerCase() !== "gzip")) {
      return fail(makeError(ErrorCodes.HEADER_NOT_ALLOWED, "Content-Encoding is allowed only as gzip for Git RPC POST"));
    }
    if (method === "POST") {
      const rpc = parsed.pathname.match(/\/(git-upload-pack|git-receive-pack)$/)?.[1];
      const contentType = (headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
      if (!rpc || contentType !== `application/x-${rpc}-request`) {
        return fail(makeError(ErrorCodes.METHOD_NOT_ALLOWED, "POST is restricted to Git RPC URLs and matching Git request content types"));
      }
      if (request.bodyBase64 == null) {
        return fail(makeError(ErrorCodes.BAD_MESSAGE, "Git POST requires bodyBase64"));
      }
      body = decodeRequestBody(request.bodyBase64, options.maxRequestBytes);
    } else if (request.bodyBase64) {
      return fail(makeError(ErrorCodes.BAD_MESSAGE, "GET and HEAD cannot have a request body"));
    }
  } catch (error) {
    return fail(error);
  }

  const timeoutMs = Math.min(Number(request.timeoutMs || options.timeoutMs), options.timeoutMs);
  const { controller } = active;
  const timeout = setTimeout(() => {
    active.timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    controller.signal.throwIfAborted();
    const response = await fetchImpl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      credentials,
      cache: "no-store",
      // Fetch's manual redirects are opaque in Chrome. Never replay a write or
      // forward credentials to another URL; use a canonical Git remote URL.
      redirect: method === "POST" || authenticated ? "error" : "follow",
      signal: controller.signal,
    });

    const finalUrl = response.url || url;
    if ((!options.allowPrivateNetworkTargets && isPrivateNetworkTarget(finalUrl))
        || !isTargetUrlAllowed(finalUrl, options.targetAllowlist)) {
      controller.abort();
      return fail(makeError(ErrorCodes.TARGET_NOT_ALLOWED, "Redirect target is not allowed"));
    }
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status <= 399
        && response.status !== 304)) {
      controller.abort();
      return fail(makeError(ErrorCodes.REDIRECT_NOT_ALLOWED, "Use the canonical remote URL; redirect was not followed"));
    }

    const contentLength = Number(response.headers?.get?.("content-length") || 0);
    if (contentLength > options.maxResponseBytes) {
      controller.abort();
      return fail(
        makeError(ErrorCodes.RESPONSE_TOO_LARGE, "Response exceeds configured size limit", {
          maxResponseBytes: options.maxResponseBytes,
          contentLength,
        }),
        response.status,
        0,
      );
    }

    const buffer = method === "HEAD" ? new ArrayBuffer(0)
      : await readResponseBody(response, options.maxResponseBytes, controller);
    controller.signal.throwIfAborted();

    const result = {
      type: "WASMACS_PROXY_RESPONSE",
      version: 1,
      requestId,
      ok: true,
      response: {
        url: finalUrl,
        status: response.status,
        statusText: response.statusText,
        headers: filterResponseHeaders(response.headers),
        bodyBase64: method === "HEAD" ? null : arrayBufferToBase64(buffer),
        bodyText: null,
      },
      error: null,
    };
    await audit(storage, options, {
      time: started,
      callerOrigin,
      method,
      url: auditUrl,
      status: response.status,
      bytes: buffer.byteLength,
      credentials,
      result: "ok",
    });
    return result;
  } catch (error) {
    if (error?.code === ErrorCodes.RESPONSE_TOO_LARGE) return fail(error);
    const code = active.cancelled ? ErrorCodes.FETCH_ABORTED
      : active.timedOut ? ErrorCodes.FETCH_TIMEOUT : ErrorCodes.FETCH_FAILED;
    return fail(makeError(code, error?.message || "Fetch failed", { url }));
  } finally {
    clearTimeout(timeout);
  }
}

function decodeRequestBody(value, maxBytes) {
  if (value.length > 4 * Math.ceil(maxBytes / 3)) {
    throw makeError(ErrorCodes.REQUEST_TOO_LARGE, "Request exceeds configured size limit", { maxRequestBytes: maxBytes });
  }
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw makeError(ErrorCodes.BAD_MESSAGE, "Invalid base64 request body");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if (value.length / 4 * 3 - padding > maxBytes) {
    throw makeError(ErrorCodes.REQUEST_TOO_LARGE, "Request exceeds configured size limit", { maxRequestBytes: maxBytes });
  }
  return base64ToArrayBuffer(value);
}

async function readResponseBody(response, maxBytes, controller) {
  const tooLarge = () => makeError(ErrorCodes.RESPONSE_TOO_LARGE,
    "Response exceeds configured size limit", { maxResponseBytes: maxBytes });
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      controller.abort();
      throw tooLarge();
    }
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        controller.abort();
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

async function loadOptions(storage) {
  if (!storage) {
    return DEFAULT_OPTIONS;
  }
  const stored = await storageGet(storage, [
    "allowedCallerOrigins",
    "targetAllowlist",
    "maxRequestBytes",
    "maxResponseBytes",
    "timeoutMs",
    "allowCredentials",
    "allowPrivateNetworkTargets",
    "auditLogLimit",
  ]);
  return { ...DEFAULT_OPTIONS, ...stored };
}

function filterRequestHeaders(headers) {
  const accepted = {};
  for (const [name, value] of Array.isArray(headers) ? headers : Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (!SAFE_REQUEST_HEADERS.has(normalized) || normalized.startsWith("sec-")) {
      throw makeError(ErrorCodes.HEADER_NOT_ALLOWED, "Request header is not allowed", { header: name });
    }
    if (normalized === "authorization" && Object.hasOwn(accepted, normalized)) {
      throw makeError(ErrorCodes.HEADER_NOT_ALLOWED, "Duplicate Authorization header");
    }
    accepted[normalized] = String(value);
  }
  return accepted;
}

function filterResponseHeaders(headers) {
  const filtered = {};
  if (!headers?.forEach) {
    return filtered;
  }
  headers.forEach((value, name) => {
    const normalized = name.toLowerCase();
    if (RESPONSE_HEADERS.has(normalized)) {
      filtered[normalized] = value;
    }
  });
  return filtered;
}

async function audit(storage, options, entry) {
  await appendAuditEntry(storage, entry, options.auditLogLimit);
}

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((envelope, sender, sendResponse) => {
    handleRuntimeMessage(envelope, { sender }).then(sendResponse, (error) => {
      sendResponse(proxyErrorResponse(null, makeError(ErrorCodes.INTERNAL_ERROR, error.message)));
    });
    return true;
  });
}
