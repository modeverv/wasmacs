/**
 * emacs-eval-worker.js
 *
 * Emacs as a Lisp engine in a Web Worker: a request/response service
 * (emacs-eval-core.js) instead of an editor.  The page talks to it through
 * emacs-eval-client.js.
 *
 *   -> { type: "start" }
 *   <- { type: "ready", version, bootMs }            | { type: "failed", error }
 *   -> { type: "eval", id, source, format }          format: "json" | "lisp"
 *   -> { type: "call", id, name, args, format }
 *   <- { type: "result", id, ok, value | error, output, ms }
 *      with fatal: true when the engine itself failed (a JavaScript stack
 *      overflow, out of memory, kill-emacs): the worker is of no use then
 *
 * It uses the product's Emacs build (artifacts/emacs-browser-atomics-pdump)
 * unchanged.  No terminal, no command loop, no process kernel: Emacs runs
 * only while a request is being evaluated, and the worker's event loop is
 * free in between.  Nothing here needs SharedArrayBuffer, so the page does
 * not have to be cross-origin isolated, and the page may be on another
 * origin than these files (they are fetched with CORS).
 */
// Where this script is served from.  A page on another origin cannot start a
// worker from here directly; the client then starts a blob worker that
// imports this script and names its real location (self.location is the
// blob then).
const SCRIPT_URL = self.__wasmacsEvalWorkerUrl || self.location.href;
function resolveRuntimeUrl(relativePath) {
  return new URL(relativePath, SCRIPT_URL).toString().replace(/\/$/, "");
}

const ARTIFACT_DIR = resolveRuntimeUrl("../../artifacts/emacs-browser-atomics-pdump/");
const CACHE_BUST = Date.now().toString(36);
let service = null;

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

async function fetchBytes(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

// temacs.data is published in parts (GitHub Pages file size limit); the same
// layout as in emacs-atomics-pdump-worker.js.
async function fetchSplitPreloadedPackage(packageName, expectedSize) {
  const packageUrl = new URL(packageName, SCRIPT_URL);
  packageUrl.search = "";
  const partsUrl = `${packageUrl.href}.parts`;
  const manifest = JSON.parse(new TextDecoder().decode(await fetchBytes(`${partsUrl}/manifest.json?v=${CACHE_BUST}`)));
  if (manifest.size !== expectedSize) {
    throw new Error(`split preload size mismatch: manifest=${manifest.size} expected=${expectedSize}`);
  }
  const parts = await Promise.all(manifest.parts.map(async (part) => {
    const bytes = await fetchBytes(`${partsUrl}/${part.name}?v=${CACHE_BUST}`);
    if (bytes.length !== part.size) throw new Error(`split preload part size mismatch: ${part.name}`);
    return bytes;
  }));
  const bytes = new Uint8Array(manifest.size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes.buffer;
}

async function start() {
  const t0 = performance.now();
  importScripts(`${resolveRuntimeUrl("./emacs-eval-core.js")}?v=${CACHE_BUST}`);
  const [pdmp, lisp] = await Promise.all([
    fetchBytes(`${ARTIFACT_DIR}/bootstrap-emacs.pdmp?v=${CACHE_BUST}`),
    fetchBytes(`${resolveRuntimeUrl("./wasmacs-eval-service.el")}?v=${CACHE_BUST}`),
  ]);

  // Emacs writes to its terminal; the core collects that as request output.
  globalThis.__wasmacsTerminalOutputBytes = [];
  globalThis.__wasmacsTerminalInputBytes = [];
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const Module = {
    noInitialRun: true,
    // "/temacs" with the slash: see emacs-atomics-pdump-worker.js.
    thisProgram: "/temacs",
    locateFile(path) { return `${ARTIFACT_DIR}/${path}?v=${CACHE_BUST}`; },
    getPreloadedPackage(packageName, packageSize) {
      return String(packageName).includes("temacs.data") ? fetchSplitPreloadedPackage(packageName, packageSize) : null;
    },
    printErr(text) {
      if (/error|failed|abort|panic/i.test(String(text))) post("log", { text: String(text) });
    },
    onAbort(what) { post("failed", { error: `abort: ${what}` }); },
    preRun: [function () {
      // The C environment is captured right after preRun.
      Object.assign(ENV, { HOME: "/home/user", USER: "user", LOGNAME: "user", LANG: "C", LC_ALL: "C" });
    }],
    onRuntimeInitialized() { resolveReady(); },
  };
  self.Module = Module;
  importScripts(`${ARTIFACT_DIR}/temacs.js?v=${CACHE_BUST}`);
  await ready;

  const FS = Module.FS;
  for (const dir of ["/tmp", "/home", "/home/user"]) { try { FS.mkdir(dir); } catch (_) { /* exists */ } }
  FS.writeFile("/temacs", new Uint8Array([0]));
  FS.chmod("/temacs", 0o755);
  FS.createDataFile("/", "bootstrap-emacs.pdmp", pdmp, true, true, true);

  service = self.WasmacsEvalService.create({ Module, lisp: new TextDecoder().decode(lisp) });
  const info = service.start();
  post("ready", { version: info.version, bootMs: Math.round(performance.now() - t0) });
}

self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === "start") {
    start().catch((error) => post("failed", { error: error?.message || String(error) }));
    return;
  }
  if (msg.type !== "eval" && msg.type !== "call") return;
  const t0 = performance.now();
  let reply;
  try {
    if (!service) throw new Error("the eval service is not ready");
    reply = msg.type === "eval"
      ? service.eval(String(msg.source), { format: msg.format })
      : service.call(String(msg.name), msg.args || [], { format: msg.format });
  } catch (error) {
    // The engine itself failed (out of memory, a crash in wasm): it cannot
    // be trusted any more.
    reply = { ok: false, fatal: true, error: { symbol: "host-error", message: error?.message || String(error), data: "" }, output: "" };
  }
  post("result", { id: msg.id, ...reply, ms: performance.now() - t0 });
};
