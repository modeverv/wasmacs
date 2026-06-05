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

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
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
