import { createServer } from "node:http";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://elpa.gnu.org",
  "https://melpa.org",
  "https://stable.melpa.org",
];

const BLOCKED_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "origin",
  "referer",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "transfer-encoding",
]);

function allowedOrigins() {
  const raw = process.env.WASMACS_PROXY_ALLOWED_ORIGINS || "";
  return new Set((raw ? raw.split(",") : DEFAULT_ALLOWED_ORIGINS).map((item) => item.trim()).filter(Boolean));
}

function assertAllowedUrl(rawUrl) {
  const target = new URL(String(rawUrl || ""));
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`unsupported URL scheme: ${target.protocol}`);
  }
  if (!allowedOrigins().has(target.origin)) {
    throw new Error(`URL origin is not allowed: ${target.origin}`);
  }
  return target;
}

function normalizeHeaders(headers) {
  const source = Array.isArray(headers)
    ? headers
    : headers && typeof headers === "object"
      ? Object.entries(headers)
      : [];
  const normalized = {};
  for (const item of source) {
    const name = String(Array.isArray(item) ? item[0] : item?.name || "").toLowerCase();
    if (!name || BLOCKED_HEADERS.has(name)) continue;
    normalized[name] = String(Array.isArray(item) ? item[1] : item?.value ?? "");
  }
  return normalized;
}

function readBody(request, limit = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function requestBody(payload, method) {
  if (method === "GET" || method === "HEAD") return undefined;
  if (typeof payload.bodyBase64 === "string") return Buffer.from(payload.bodyBase64, "base64");
  if (payload.body == null) return undefined;
  return String(payload.body);
}

function writeJson(response, status, payload) {
  const json = JSON.stringify(payload);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(json),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(json);
}

export async function handleProxyRequest(request, response) {
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" });
    response.end("method not allowed");
    return;
  }

  try {
    const payload = JSON.parse(await readBody(request));
    const target = assertAllowedUrl(payload.url);
    const method = String(payload.method || "GET").toUpperCase();
    const upstream = await fetch(target, {
      method,
      headers: normalizeHeaders(payload.headers),
      body: requestBody(payload, method),
      redirect: "follow",
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    writeJson(response, 200, {
      url: upstream.url || target.href,
      status: upstream.status,
      statusText: upstream.statusText || "",
      headers: Array.from(upstream.headers.entries()).map(([name, value]) => ({ name, value })),
      bodyBase64: body.toString("base64"),
    });
  } catch (error) {
    writeJson(response, 400, { error: error?.message || String(error) });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number.parseInt(process.env.PORT || "8787", 10);
  createServer(handleProxyRequest).listen(port, "127.0.0.1", () => {
    console.log(`wasmacs fetch proxy listening at http://127.0.0.1:${port}/`);
  });
}

