import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const wasmSource = join(repoRoot, "src", "wasm");
const screenshotSource = join(repoRoot, "src", "assets", "screenshots");
const buildArtifacts = join(repoRoot, "build", "artifacts");
const docsRoot = join(repoRoot, "docs");
const docsApp = join(docsRoot, "app");
const docsArtifacts = join(docsRoot, "artifacts");
const docsScreenshots = join(docsRoot, "screenshots");
const pagesIndexTarget = join(docsRoot, "index.html");
const pagesEntrypoint = "./app/xterm-atomics-pdump.html";

await import("./generate-host-abi-wit.mjs");

async function copyIfExists(from, to) {
  if (!existsSync(from)) return;
  await cp(from, to, { recursive: true });
}

async function splitLargeDataFile(filePath, chunkSize = 32 * 1024 * 1024) {
  if (!existsSync(filePath)) return;
  const bytes = await readFile(filePath);
  const partsDir = `${filePath}.parts`;
  await rm(partsDir, { recursive: true, force: true });
  await mkdir(partsDir, { recursive: true });

  const parts = [];
  for (let offset = 0, index = 0; offset < bytes.length; offset += chunkSize, index += 1) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    const name = `part-${String(index).padStart(3, "0")}`;
    await writeFile(join(partsDir, name), chunk);
    parts.push({
      name,
      size: chunk.length,
      sha256: createHash("sha256").update(chunk).digest("hex"),
    });
  }

  await writeFile(
    join(partsDir, "manifest.json"),
    JSON.stringify({
      file: "temacs.data",
      size: bytes.length,
      chunkSize,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      parts,
    }, null, 2),
  );
  await rm(filePath, { force: true });
}

async function patchTemacsJsForAsyncPreload(filePath) {
  if (!existsSync(filePath)) return;
  const source = await readFile(filePath, "utf8");
  const patched = source.replace(
    "      if (!fetched) {\n        fetched = await fetchPromise;\n      }\n      processPackageData(fetched);",
    "      if (!fetched) {\n        fetched = await fetchPromise;\n      } else {\n        fetched = await fetched;\n      }\n      processPackageData(fetched);",
  );
  const awaited = patched.replace(
    "      processPackageData(fetched);",
    "      await processPackageData(fetched);",
  );
  if (awaited !== source) await writeFile(filePath, awaited);
}

function replaceFunction(source, functionName, replacement) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  if (start < 0) return source;
  const open = source.indexOf("{", start);
  if (open < 0) return source;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(0, start) + replacement + source.slice(index + 1);
      }
    }
  }
  return source;
}

async function patchTemacsJsForHostNetworkRelay(filePath) {
  if (!existsSync(filePath)) return;
  const source = await readFile(filePath, "utf8");
  const replacement = `function wasmacs_host_network_fetch_json(request_json) {
  function returnJson(value) {
    var json = JSON.stringify(value);
    var size = lengthBytesUTF8(json) + 1;
    var ptr = _malloc(size);
    if (!ptr) return 0;
    stringToUTF8(json, ptr, size);
    return ptr;
  }
  function fail(message) { return returnJson({ error: String(message) }); }
  try {
    if (typeof self === "undefined" || typeof self.postMessage !== "function") {
      return fail("host.network.fetch relay requires a worker postMessage host");
    }
    if (typeof SharedArrayBuffer !== "function" || typeof Atomics === "undefined") {
      return fail("host.network.fetch relay requires SharedArrayBuffer and Atomics");
    }
    var requestJson = UTF8ToString(request_json);
    var responseSAB = globalThis.__wasmacsNetworkResponseSAB;
    if (!responseSAB) {
      responseSAB = new SharedArrayBuffer(64 * 1024 * 1024);
      globalThis.__wasmacsNetworkResponseSAB = responseSAB;
    }
    var signal = new Int32Array(responseSAB, 0, 4);
    var data = new Uint8Array(responseSAB, 16);
    Atomics.store(signal, 0, 1);
    Atomics.store(signal, 1, 0);
    self.postMessage({
      type: "host-network-fetch",
      requestJson: requestJson,
      responseSAB: responseSAB
    });
    var waitResult = Atomics.wait(signal, 0, 1, 120000);
    if (waitResult === "timed-out") {
      return fail("host.network.fetch main-thread relay timed out");
    }
    var length = Atomics.load(signal, 1);
    if (!Number.isFinite(length) || length <= 0 || length > data.length) {
      return fail("host.network.fetch main-thread relay returned invalid length " + length);
    }
    var text = new TextDecoder().decode(new Uint8Array(data.subarray(0, length)));
    Atomics.store(signal, 0, 0);
    Atomics.store(signal, 1, 0);
    try {
      return returnJson(JSON.parse(text));
    } catch (parseError) {
      return fail("host.network.fetch main-thread relay returned invalid JSON: " + parseError.message);
    }
  } catch (error) {
    return fail(error && error.message ? error.message : error);
  }
}`;
  const patched = replaceFunction(source, "wasmacs_host_network_fetch_json", replacement);
  if (patched !== source) await writeFile(filePath, patched);
}

await mkdir(docsRoot, { recursive: true });
await rm(docsApp, { recursive: true, force: true });
await rm(docsArtifacts, { recursive: true, force: true });
await rm(docsScreenshots, { recursive: true, force: true });
await rm(pagesIndexTarget, { force: true });
await rm(join(docsRoot, "coi-serviceworker.js"), { force: true });
await cp(wasmSource, docsApp, { recursive: true });
await cp(join(wasmSource, "coi-serviceworker.js"), join(docsRoot, "coi-serviceworker.js"));
await copyIfExists(screenshotSource, docsScreenshots);

const pagesIndex = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="0; url=${pagesEntrypoint}" />
    <title>wasmacs</title>
    <script>
      location.replace(${JSON.stringify(pagesEntrypoint)} + location.search + location.hash);
    </script>
  </head>
  <body>
    <p><a href="${pagesEntrypoint}">Open wasmacs</a></p>
  </body>
</html>
`;
await writeFile(pagesIndexTarget, pagesIndex);
await copyIfExists(buildArtifacts, docsArtifacts);

const docsAtomicsPdump = join(docsArtifacts, "emacs-browser-atomics-pdump");
const docsTemacs = join(docsAtomicsPdump, "temacs");
const docsTemacsJs = join(docsAtomicsPdump, "temacs.js");
if (existsSync(docsTemacs) && !existsSync(docsTemacsJs)) {
  await cp(docsTemacs, docsTemacsJs);
}
await patchTemacsJsForAsyncPreload(docsTemacsJs);
await patchTemacsJsForHostNetworkRelay(docsTemacsJs);
await splitLargeDataFile(join(docsAtomicsPdump, "temacs.data"));

console.log("Built docs GitHub Pages bundle.");
