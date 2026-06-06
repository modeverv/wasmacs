import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const port = Number.parseInt(process.env.PORT || "5173", 10);

const types = new Map([
  [".css", "text/css; charset=utf-8"],
  [".data", "application/octet-stream"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".wasm", "application/wasm"],
]);

function resolvePath(urlPath) {
  const decodedPath = urlPath === "/" ? "/src/wasm/index.html" : decodeURIComponent(urlPath);
  let sourcePath = decodedPath;
  if (decodedPath.startsWith("/artifacts/")) {
    sourcePath = `/build/artifacts/${decodedPath.slice("/artifacts/".length)}`;
  } else if (decodedPath === "/coi-serviceworker.js") {
    sourcePath = "/src/wasm/coi-serviceworker.js";
  } else if (decodedPath.startsWith("/app/")) {
    sourcePath = `/src/wasm/${decodedPath.slice("/app/".length)}`;
  }

  const normalized = normalize(sourcePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(repoRoot, normalized);
  if (!filePath.startsWith(repoRoot)) return undefined;
  return filePath;
}

function readRequestBody(request, limit = 16 * 1024 * 1024) {
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

function normalizeProxyHeaders(headers) {
  const blocked = new Set([
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
  const normalized = {};
  const source = Array.isArray(headers)
    ? headers
    : headers && typeof headers === "object"
      ? Object.entries(headers)
      : [];
  for (const item of source) {
    const name = String(Array.isArray(item) ? item[0] : item?.name || "").toLowerCase();
    if (!name || blocked.has(name)) continue;
    const value = Array.isArray(item) ? item[1] : item.value;
    normalized[name] = String(value ?? "");
  }
  return normalized;
}

async function handleNetworkFetchProxy(request, response) {
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" });
    response.end("method not allowed");
    return;
  }

  try {
    const payload = JSON.parse(await readRequestBody(request));
    const target = new URL(String(payload.url || ""));
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error(`unsupported URL scheme: ${target.protocol}`);
    }

    const method = String(payload.method || "GET").toUpperCase();
    const upstream = await fetch(target, {
      method,
      headers: normalizeProxyHeaders(payload.headers),
      body: payload.body == null || method === "GET" || method === "HEAD"
        ? undefined
        : String(payload.body),
      redirect: "follow",
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    const json = JSON.stringify({
      url: upstream.url,
      status: upstream.status,
      statusText: upstream.statusText,
      headers: Array.from(upstream.headers.entries()).map(([name, value]) => ({ name, value })),
      bodyBase64: body.toString("base64"),
    });
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(json),
      "Content-Type": "application/json; charset=utf-8",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    });
    response.end(json);
  } catch (error) {
    const json = JSON.stringify({ error: error?.message || String(error) });
    response.writeHead(400, {
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(json),
      "Content-Type": "application/json; charset=utf-8",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    });
    response.end(json);
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/__wasmacs_network_fetch") {
      await handleNetworkFetchProxy(request, response);
      return;
    }

    const filePath = resolvePath(url.pathname);
    if (!filePath) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }

    const info = await stat(filePath);
    if (!info.isFile()) {
      response.writeHead(404);
      response.end("not found");
      return;
    }

    const contentType = basename(filePath) === "temacs"
      ? "text/javascript; charset=utf-8"
      : types.get(extname(filePath)) || "application/octet-stream";

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": info.size,
      "Content-Type": contentType,
      // Required for SharedArrayBuffer (Atomics.wait in Workers)
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`wasmacs app serving at http://127.0.0.1:${port}/`);
});
