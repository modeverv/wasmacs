import { createReadStream, existsSync } from "node:fs";
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

// The canonical app page.  "/" redirects here, like docs/index.html does on Pages.
const appEntrypoint = "/app/xterm-atomics-pdump.html";

// /artifacts/* is served from the Pages bundle (docs/artifacts: patched temacs.js
// and split temacs.data, produced by src/build/build-site.mjs) and falls back to
// build/artifacts for files that are not part of the bundle.  The two must not be
// mixed for the same runtime, so rebuild the bundle (npm run build) after a wasm
// rebuild.
function resolvePath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath);
  let sourcePath = decodedPath;
  if (decodedPath.startsWith("/artifacts/")) {
    const artifactPath = decodedPath.slice("/artifacts/".length);
    const docsArtifact = join(repoRoot, "docs", "artifacts", artifactPath);
    if (docsArtifact.startsWith(repoRoot) && existsSync(docsArtifact)) {
      return docsArtifact;
    }
    sourcePath = `/build/artifacts/${artifactPath}`;
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
    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.writeHead(302, {
        "Cache-Control": "no-store",
        Location: `${appEntrypoint}${url.search}`,
      });
      response.end();
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

    const headers = {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
      // Required for SharedArrayBuffer (Atomics.wait in Workers)
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    };
    // The eval service reads Emacs's files as ranges of the package, as
    // from GitHub Pages.
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range || "");
    if (range && Number(range[1]) <= Number(range[2]) && Number(range[1]) < info.size) {
      const start = Number(range[1]);
      const end = Math.min(Number(range[2]), info.size - 1);
      response.writeHead(206, { ...headers, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${info.size}` });
      createReadStream(filePath, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, { ...headers, "Content-Length": info.size });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`wasmacs app serving at http://127.0.0.1:${port}/`);
});
