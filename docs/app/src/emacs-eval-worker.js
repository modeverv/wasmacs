/**
 * emacs-eval-worker.js
 *
 * Emacs as a Lisp engine in a Web Worker: a request/response service
 * (emacs-eval-core.js) instead of an editor.  The page talks to it through
 * emacs-eval-client.js.
 *
 *   -> { type: "start" }
 *   <- { type: "ready", version, bootMs, cached, files }   | { type: "failed", error }
 *      files: "on demand" (each of Emacs's files is fetched when Emacs
 *      reads it) or "all" (they were downloaded before the start)
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
 *
 * Emacs itself (temacs.wasm, the pdmp) is downloaded before the start.  Its
 * lisp/ and etc/, 146 MB, are not: a file is fetched when Emacs reads it,
 * as a range of the published package (see "the files of Emacs" below).
 * Where the server does not answer range requests, the package is
 * downloaded whole, as the editor does.
 *
 * What was downloaded is kept in the browser's Cache Storage under the
 * build id of the published site (../eval-build-id.json, written by
 * src/build/build-site.mjs).  A later start asks the network only for that
 * id and takes everything else from the cache; a new build has a new id, is
 * downloaded once, and replaces the old one.  "ready" says whether this
 * start came from the cache.
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

// ---- the files of Emacs, cached by build -------------------------------------

const CACHE_PREFIX = "wasmacs-eval-";
let cache = null;         // Cache of this build, or null: everything from the network
let downloads = 0;        // files that were not in the cache

// Open the cache of the published build and drop those of older builds.
// Without a build id (a development server) or without Cache Storage
// (an insecure origin) nothing is cached.
async function openBuildCache() {
  try {
    const { id } = JSON.parse(new TextDecoder().decode(await fetchBytes(`${resolveRuntimeUrl("../eval-build-id.json")}?v=${CACHE_BUST}`)));
    if (!id || typeof caches === "undefined") return;
    cache = await caches.open(`${CACHE_PREFIX}${id}`);
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== `${CACHE_PREFIX}${id}`) await caches.delete(name);
    }
  } catch (_) {
    cache = null;
  }
}

// The bytes of URL: from the cache of this build, else from the network
// (and into the cache).
async function loadBytes(url) {
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) return new Uint8Array(await hit.arrayBuffer());
    } catch (_) { /* fall through to the network */ }
  }
  const bytes = await fetchBytes(`${url}?v=${CACHE_BUST}`);
  downloads += 1;
  if (cache) {
    // Not awaited: storing must not delay the start.  A failure (quota)
    // only means another download next time.
    cache.put(url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } })).catch(() => {});
  }
  return bytes;
}

// importScripts for a script that comes through loadBytes.
async function importCached(url) {
  const blobUrl = URL.createObjectURL(new Blob([await loadBytes(url)], { type: "text/javascript" }));
  try {
    importScripts(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

// ---- the files of Emacs --------------------------------------------------------
//
// temacs.files.json (src/build/emacs-packages.mjs) says where each file of
// Emacs's lisp/ and etc/ is in the published package.  With it, the files
// are installed empty and read on demand (WasmacsEvalFiles in
// emacs-eval-core.js): a synchronous request for the range of the package
// that holds the file, which a worker may make.  A site that carries the
// core package has an index of those files only.
//
// A file that was read is kept in the cache of the build and is in place
// before Emacs starts next time, so a later visit asks for nothing.

const INDEX_URL = `${ARTIFACT_DIR}/temacs.files.json`;
const READ_FILES_URL = `${ARTIFACT_DIR}/temacs.files/`;   // names in the cache, not on the server
const READ_LIST_URL = `${READ_FILES_URL}.list`;
const RANGES_URL = `${READ_FILES_URL}.ranges`;
let filesMode = "all";
const readNow = new Map();     // name -> bytes: read in this session, not in the cache yet
const readStored = new Set();  // names in the cache

// The index, or null: a copy of the site from before there was one.
async function loadIndex() {
  try {
    const index = JSON.parse(new TextDecoder().decode(await loadBytes(INDEX_URL)));
    return index.version === 1 && Array.isArray(index.files) ? index : null;
  } catch (_) {
    return null;
  }
}

// Does the server send a range of a file when asked?  (Python's http.server
// sends the whole file.)  Asked of the index, which is small.  What was
// found once is remembered with the build.
async function serverSendsRanges() {
  try {
    if (cache && await cache.match(RANGES_URL)) return true;
    const response = await fetch(`${INDEX_URL}?v=${CACHE_BUST}`, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
    const ok = response.status === 206 && (await response.arrayBuffer()).byteLength === 1;
    if (!ok) response.body?.cancel().catch(() => {});
    if (ok && cache) cache.put(RANGES_URL, new Response("yes")).catch(() => {});
    return ok;
  } catch (_) {
    return false;   // also: another origin whose server refuses the preflight some browsers send
  }
}

function fetchRangeSync(url, from, to) {
  const request = new XMLHttpRequest();
  request.open("GET", `${url}?v=${CACHE_BUST}`, false);
  request.responseType = "arraybuffer";
  request.setRequestHeader("Range", `bytes=${from}-${to - 1}`);
  request.send();
  if (request.status !== 206) throw new Error(`${url}: HTTP ${request.status} for bytes ${from}-${to - 1}`);
  downloads += 1;
  return new Uint8Array(request.response);
}

// What earlier sessions read: Map name -> bytes.
async function storedFiles() {
  const have = new Map();
  if (!cache) return have;
  try {
    const list = await cache.match(READ_LIST_URL);
    await Promise.all((list ? await list.json() : []).map(async (name) => {
      const hit = await cache.match(`${READ_FILES_URL}${name}`);
      if (!hit) return;
      have.set(name, new Uint8Array(await hit.arrayBuffer()));
      readStored.add(name);
    }));
  } catch (_) { /* they are read again */ }
  return have;
}

// Keep what this session read.  Called when a request is answered: the
// worker is idle then.
let storing = Promise.resolve();
function storeReadFiles() {
  if (!cache || readNow.size === 0) return;
  const batch = [...readNow];
  readNow.clear();
  storing = storing.then(async () => {
    for (const [name, bytes] of batch) {
      await cache.put(`${READ_FILES_URL}${name}`, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
      readStored.add(name);
    }
    await cache.put(READ_LIST_URL, new Response(JSON.stringify([...readStored]), { headers: { "Content-Type": "application/json" } }));
  }).catch(() => { /* they are read again next time */ });
}

// How Emacs gets the files of INDEX: the arguments of
// WasmacsEvalFiles.installFiles, without the file system.
async function openPackage(index) {
  const urls = index.container.parts.map((name) => `${ARTIFACT_DIR}/${name}`);
  const onError = (name, error) => post("log", { text: `error reading ${index.root}${name}: ${error?.message || error}` });
  if (await serverSendsRanges()) {
    filesMode = "on demand";
    return {
      index, onError,
      have: await storedFiles(),
      read: self.WasmacsEvalFiles.containerReader(index.container, (part, from, to) => fetchRangeSync(urls[part], from, to)),
      onRead(name, bytes) { readNow.set(name, bytes); },
    };
  }
  const parts = await Promise.all(urls.map((url) => loadBytes(url)));
  return {
    index, onError,
    read: self.WasmacsEvalFiles.containerReader(index.container, (part, from, to) => parts[part].subarray(from, to)),
  };
}

// Without an index: temacs.data whole, as the glue expects it.  It is
// published in parts (GitHub Pages file size limit); the same
// layout as in emacs-atomics-pdump-worker.js.
async function fetchSplitPreloadedPackage(packageName, expectedSize) {
  const packageUrl = new URL(packageName, SCRIPT_URL);
  packageUrl.search = "";
  const partsUrl = `${packageUrl.href}.parts`;
  const manifest = JSON.parse(new TextDecoder().decode(await loadBytes(`${partsUrl}/manifest.json`)));
  if (manifest.size !== expectedSize) {
    throw new Error(`split preload size mismatch: manifest=${manifest.size} expected=${expectedSize}`);
  }
  const parts = await Promise.all(manifest.parts.map(async (part) => {
    const bytes = await loadBytes(`${partsUrl}/${part.name}`);
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
  await openBuildCache();
  const [pdmp, lisp, wasmBinary, files] = await Promise.all([
    loadBytes(`${ARTIFACT_DIR}/bootstrap-emacs.pdmp`),
    loadBytes(resolveRuntimeUrl("./wasmacs-eval-service.el")),
    loadBytes(`${ARTIFACT_DIR}/temacs.wasm`),
    importCached(resolveRuntimeUrl("./emacs-eval-core.js"))
      .then(loadIndex).then((index) => index && openPackage(index)),
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
    wasmBinary,
    locateFile(path) { return `${ARTIFACT_DIR}/${path}`; },
    getPreloadedPackage(packageName, packageSize) {
      if (!String(packageName).includes("temacs.data")) return null;
      // An empty package makes the glue create every file empty; they get
      // their contents below.
      return files ? new ArrayBuffer(0) : fetchSplitPreloadedPackage(packageName, packageSize);
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
  await importCached(`${ARTIFACT_DIR}/temacs.js`);
  await ready;

  const FS = Module.FS;
  if (files) self.WasmacsEvalFiles.installFiles({ FS, ...files });
  for (const dir of ["/tmp", "/home", "/home/user"]) { try { FS.mkdir(dir); } catch (_) { /* exists */ } }
  FS.writeFile("/temacs", new Uint8Array([0]));
  FS.chmod("/temacs", 0o755);
  FS.createDataFile("/", "bootstrap-emacs.pdmp", pdmp, true, true, true);

  service = self.WasmacsEvalService.create({ Module, lisp: new TextDecoder().decode(lisp) });
  const info = service.start();
  post("ready", { version: info.version, bootMs: Math.round(performance.now() - t0),
                  cached: Boolean(cache) && downloads === 0, files: filesMode });
  storeReadFiles();
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
  storeReadFiles();
};
