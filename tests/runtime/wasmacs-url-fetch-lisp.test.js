import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

test("wasmacs url.el loader is an overlay, not a vendor/emacs patch", async () => {
  const source = await readFile(join(repoRoot, "src/emacs-lisp/wasmacs-url-fetch.el"), "utf8");

  assert.match(source, /\(provide 'wasmacs-url-fetch\)/);
  assert.match(source, /\(defun wasmacs-url-fetch-enable/);
  assert.match(source, /puthash "http"/);
  assert.match(source, /puthash "https"/);
  assert.match(source, /'loader 'wasmacs-url-fetch/);
  assert.doesNotMatch(source, /'loader #'wasmacs-url-fetch/);
  assert.match(source, /wasmacs-url-fetch-function/);
  assert.match(source, /wasmacs-os-network-fetch-json/);
  assert.match(source, /body-base64/);
  assert.match(source, /url-scheme-registry/);
  assert.doesNotMatch(source, /\(make-network-process\b/);
  assert.doesNotMatch(source, /\(open-network-stream\b/);
});

test("Emacs patch script registers the host network fetch primitive", async () => {
  const source = await readFile(join(repoRoot, "tools/scripts/patch-emacs-host-entrypoint-spike.sh"), "utf8");

  assert.match(source, /EM_JS \(const char \*, wasmacs_host_network_fetch_json/);
  assert.match(source, /DEFUN \("wasmacs-os-network-fetch-json"/);
  assert.match(source, /Swasmacs_os_network_fetch_json/);
  assert.match(source, /wasmacs_os_url_fetch_loader_state/);
  assert.match(source, /function returnJson/);
  assert.match(source, /_malloc\(size\)/);
  assert.match(source, /stringToUTF8\(json, ptr, size\)/);
  assert.match(source, /function proxyFetch/);
  assert.match(source, /__wasmacs_network_fetch/);
  assert.match(source, /xfree \(\(void \*\) response\)/);
  assert.doesNotMatch(source, /stringToNewUTF8/);
});

test("checked-in Emacs C patch carries the host network fetch primitive", async () => {
  const source = await readFile(
    join(repoRoot, "src/c/patches/0001-wasmacs-host-entrypoint-and-terminal.patch"),
    "utf8",
  );

  assert.match(source, /EM_JS \(const char \*, wasmacs_host_network_fetch_json/);
  assert.match(source, /DEFUN \("wasmacs-os-network-fetch-json"/);
  assert.match(source, /wasmacs_os_url_fetch_loader_state/);
  assert.match(source, /function returnJson/);
  assert.match(source, /_malloc\(size\)/);
  assert.match(source, /stringToUTF8\(json, ptr, size\)/);
  assert.match(source, /function proxyFetch/);
  assert.match(source, /__wasmacs_network_fetch/);
  assert.match(source, /xfree \(\(void \*\) response\)/);
  assert.doesNotMatch(source, /stringToNewUTF8/);
});

test("system Lisp image builder copies the wasmacs Lisp overlay", async () => {
  const source = await readFile(join(repoRoot, "src/build/build-system-lisp-image.sh"), "utf8");

  assert.match(source, /src\/emacs-lisp/);
  assert.match(source, /\$staging_root\/system\/lisp/);
  assert.match(source, /--include='\*\.el'/);
});

test("Atomics pdump browser builder preloads the wasmacs Lisp overlay", async () => {
  const source = await readFile(
    join(repoRoot, "src/build/build-emacs-browser-atomics-pdump-profile.sh"),
    "utf8",
  );

  assert.match(source, /src\/emacs-lisp/);
  assert.match(source, /\$\{pdump_src\}\/lisp/);
  assert.match(source, /--include='\*\.el'/);
  assert.match(source, /--preload-file \$\{pdump_src\}\/lisp@\/usr\/local\/share\/emacs\/30\.2\/lisp/);
});

test("Atomics pdump browser runtime enables fetch-backed url.el by default", async () => {
  const source = await readFile(
    join(repoRoot, "src/wasm/src/emacs-atomics-pdump-worker.js"),
    "utf8",
  );

  assert.match(source, /WASMACS_DEFAULT_LISP_INIT/);
  assert.match(source, /\(require 'wasmacs-url-fetch\)/);
  assert.match(source, /\(wasmacs-url-fetch-enable\)/);
  assert.match(source, /WASMACS-URL-FETCH=%S/);
  assert.match(source, /"--eval", WASMACS_DEFAULT_LISP_INIT/);
});

test("Atomics pdump worker suppresses Emscripten run dependency stderr spam", async () => {
  const source = await readFile(
    join(repoRoot, "src/wasm/src/emacs-atomics-pdump-worker.js"),
    "utf8",
  );

  assert.match(source, /function createRunDependencyLogFilter/);
  assert.match(source, /still waiting on run dependencies:/);
  assert.match(source, /text\.startsWith\("dependency: "\)/);
  assert.match(source, /loading Emacs preload data\.\.\. \(\$\{pendingCount\} pending files\)/);
  assert.match(source, /if \(!shouldPostStderr\(String\(text\)\)\) return/);
});

test("dev server exposes the local host network fetch proxy", async () => {
  const source = await readFile(join(repoRoot, "tools/scripts/serve-app.mjs"), "utf8");

  assert.match(source, /__wasmacs_network_fetch/);
  assert.match(source, /handleNetworkFetchProxy/);
  assert.match(source, /normalizeProxyHeaders/);
  assert.match(source, /bodyBase64/);
  assert.match(source, /unsupported URL scheme/);
});

test("Pages CI pins the Emscripten version used for browser artifacts", async () => {
  const source = await readFile(join(repoRoot, ".github/workflows/ci.yml"), "utf8");

  assert.match(source, /mymindstorm\/setup-emsdk@v14/);
  assert.match(source, /version: "5\.0\.7"/);
  assert.doesNotMatch(source, /version: "latest"/);
});
