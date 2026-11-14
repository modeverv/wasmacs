/**
 * emacs-atomics-pdump-worker.js
 *
 * The system worker: it boots the process kernel and starts init on it.
 *
 *   init = "emacs" (default)   GNU Emacs from bootstrap-emacs.pdmp, as pid 1
 *   init = a command line      that program as pid 1 on the console terminal
 *                              ("/bin/sh", "vi", "python3", ...); Emacs is
 *                              not loaded at all
 *
 * Boot sequence (the order is the same for both):
 *   1. /home/user is read from IndexedDB (the last asynchronous step but for
 *      loading modules).
 *   2. The system module loads and provides the filesystem: Emacs's module
 *      (temacs.js), or the base module (wasmacs-base.js) without Emacs.
 *   3. WasmacsBoot.boot() creates the kernel on that filesystem, connected to
 *      the console (SharedArrayBuffer keyboard, terminal output) and to the
 *      program loader.  /home/user and the userland (/bin, /etc) are mounted.
 *   4. Init starts.  Emacs: callMain(["--dump-file=/bootstrap-emacs.pdmp",
 *      "--quick", "--no-splash", "-nw"]); Emacs attaches to the kernel as the
 *      host process and blocks in Atomics.wait at its command loop.  Another
 *      program: WasmacsBoot.runInit() runs it on a pseudoterminal.
 *
 * From step 4 on the worker never returns to its event loop.
 *
 * Emacs notes: thisProgram is "/temacs" (the leading slash fixes the
 * load_pdump --dump-file path).
 */
function resolveRuntimeUrl(relativePath, fallbackPath) {
  if (typeof URL !== "undefined" && self.location?.href) {
    return new URL(relativePath, self.location.href).toString();
  }
  return fallbackPath;
}

const ARTIFACT_DIR = resolveRuntimeUrl(
  "../../artifacts/emacs-browser-atomics-pdump/",
  "/artifacts/emacs-browser-atomics-pdump/",
).replace(/\/$/, "");
const ARTIFACT_CACHE_BUST = Date.now().toString(36);
const USER_WASIFS_KEY = "wasmacs:user-filesystem.wasifs:v1";
const USER_WASIFS_URL = resolveRuntimeUrl(
  "../../artifacts/user-filesystem-empty.wasifs",
  "/artifacts/user-filesystem-empty.wasifs",
);

// The process service: the kernel and its boot code (wasmacs-kernel.js,
// wasmacs-boot.js), the base system module, and the userland: program images
// (busybox, git, ...) plus manifest.json and wasmacs-userland.js.  Built by
// src/userland/build.sh.
const USERLAND_DIR = resolveRuntimeUrl(
  "../../artifacts/userland/",
  "/artifacts/userland/",
).replace(/\/$/, "");

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

function postTerminalTail(reason) {
  try {
    const bytes = globalThis.__wasmacsTerminalOutputBytes || [];
    const tail = bytes.slice(Math.max(0, bytes.length - 2000));
    post("stderr", { text: `${reason} terminal-tail: ${new TextDecoder().decode(new Uint8Array(tail))}` });
  } catch (_) {}
}

function queueTerminalControlSequence(text) {
  try {
    const bytes = new TextEncoder().encode(text);
    const out = globalThis.__wasmacsTerminalOutputBytes;
    if (Array.isArray(out)) out.push(...bytes);
  } catch (_) {}
}

function createRunDependencyLogFilter() {
  let pendingCount = 0;
  let suppressing = false;

  return function shouldPostStderr(text) {
    if (text === "still waiting on run dependencies:") {
      suppressing = true;
      pendingCount = 0;
      return false;
    }
    if (suppressing && text.startsWith("dependency: ")) {
      pendingCount += 1;
      return false;
    }
    if (suppressing && text === "(end of list)") {
      post("status", { text: `loading Emacs preload data... (${pendingCount} pending files)` });
      suppressing = false;
      pendingCount = 0;
      return false;
    }
    suppressing = false;
    pendingCount = 0;
    return true;
  };
}

async function fetchSplitPreloadedPackage(packageName, expectedSize) {
  const packageUrl = new URL(packageName, self.location.href);
  packageUrl.search = "";
  const manifestUrl = new URL(`${packageUrl.pathname}.parts/manifest.json`, packageUrl);
  manifestUrl.searchParams.set("v", ARTIFACT_CACHE_BUST);

  const manifestResponse = await fetch(manifestUrl, { cache: "no-store" });
  if (!manifestResponse.ok) {
    throw new Error(`split preload manifest failed: ${manifestResponse.status} ${manifestUrl}`);
  }
  const manifest = await manifestResponse.json();
  if (manifest.size !== expectedSize) {
    throw new Error(`split preload size mismatch: manifest=${manifest.size} expected=${expectedSize}`);
  }

  const partBuffers = await Promise.all(manifest.parts.map(async (part) => {
    const partUrl = new URL(`${packageUrl.pathname}.parts/${part.name}`, packageUrl);
    partUrl.searchParams.set("v", ARTIFACT_CACHE_BUST);
    const response = await fetch(partUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`split preload part failed: ${response.status} ${partUrl}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== part.size) {
      throw new Error(`split preload part size mismatch: ${part.name}`);
    }
    return buffer;
  }));

  const bytes = new Uint8Array(manifest.size);
  let offset = 0;
  for (const buffer of partBuffers) {
    bytes.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  post("status", { text: `loaded split preload data (${manifest.parts.length} parts)` });
  return bytes.buffer;
}

// ── SharedArrayBuffer ────────────────────────────────────────────
const INPUT_SAB = new SharedArrayBuffer(264);
const TERMINAL_SIZE_SAB = new SharedArrayBuffer(12);
const NETWORK_RESPONSE_SAB = new SharedArrayBuffer(64 * 1024 * 1024);
globalThis.__wasmacsInputSAB = INPUT_SAB;
globalThis.__wasmacsTerminalSizeSAB = TERMINAL_SIZE_SAB;
globalThis.__wasmacsTerminalOutputBytes = [];
globalThis.__wasmacsTerminalInputBytes = [];
globalThis.__wasmacsSentOutputCount = 0;
globalThis.__wasmacsTerminalRows = 24;
globalThis.__wasmacsTerminalCols = 80;
globalThis.__wasmacsTerminalResizeSeen = 0;

function updateTerminalSize(size = {}) {
  const cols = Number.isInteger(size.cols) ? size.cols : globalThis.__wasmacsTerminalCols;
  const rows = Number.isInteger(size.rows) ? size.rows : globalThis.__wasmacsTerminalRows;
  globalThis.__wasmacsTerminalCols = Math.max(20, cols);
  globalThis.__wasmacsTerminalRows = Math.max(3, rows);
  const signal = new Int32Array(TERMINAL_SIZE_SAB);
  Atomics.store(signal, 1, globalThis.__wasmacsTerminalCols);
  Atomics.store(signal, 2, globalThis.__wasmacsTerminalRows);
  Atomics.add(signal, 0, 1);
}

function injectTerminalInput(bytes = []) {
  const signal = new Int32Array(INPUT_SAB, 0, 2);
  const data = new Uint8Array(INPUT_SAB, 8);
  const chunk = Array.from(bytes).slice(0, data.length);
  data.fill(0);
  data.set(chunk);
  Atomics.store(signal, 1, chunk.length);
  Atomics.add(signal, 0, 1);
  Atomics.notify(signal, 0, 1);
}

function installMainThreadNetworkFetchBridge() {
  if (typeof UTF8ToString !== "function"
      || typeof lengthBytesUTF8 !== "function"
      || typeof stringToUTF8 !== "function"
      || typeof _malloc !== "function") {
    return false;
  }

  function returnJson(value) {
    const json = JSON.stringify(value);
    const size = lengthBytesUTF8(json) + 1;
    const ptr = _malloc(size);
    if (!ptr) return 0;
    stringToUTF8(json, ptr, size);
    return ptr;
  }

  const bridgedFetch = function bridgedHostNetworkFetchJson(requestJsonPtr) {
    const requestJson = UTF8ToString(requestJsonPtr);
    const signal = new Int32Array(NETWORK_RESPONSE_SAB, 0, 4);
    const data = new Uint8Array(NETWORK_RESPONSE_SAB, 16);
    Atomics.store(signal, 0, 1);
    Atomics.store(signal, 1, 0);
    self.postMessage({
      type: "host-network-fetch",
      requestJson,
      responseSAB: NETWORK_RESPONSE_SAB,
    });
    const waitResult = Atomics.wait(signal, 0, 1, 120000);
    if (waitResult === "timed-out") {
      return returnJson({ error: "host.network.fetch main-thread relay timed out" });
    }
    const length = Atomics.load(signal, 1);
    if (!Number.isFinite(length) || length <= 0 || length > data.length) {
      return returnJson({ error: `host.network.fetch main-thread relay returned invalid length ${length}` });
    }
    const text = new TextDecoder().decode(new Uint8Array(data.subarray(0, length)));
    try {
      return returnJson(JSON.parse(text));
    } catch (error) {
      return returnJson({ error: `host.network.fetch main-thread relay returned invalid JSON: ${error.message}` });
    } finally {
      Atomics.store(signal, 0, 0);
      Atomics.store(signal, 1, 0);
    }
  };

  globalThis.wasmacs_host_network_fetch_json = bridgedFetch;
  try { wasmacs_host_network_fetch_json = bridgedFetch; } catch (_) {}
  return true;
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg?.type === "terminal-resize") {
    updateTerminalSize(msg);
    try {
      const signal = new Int32Array(INPUT_SAB, 0, 2);
      Atomics.add(signal, 0, 1);
      Atomics.notify(signal, 0, 1);
    } catch (_) {}
    post("terminal-resized", {
      rows: globalThis.__wasmacsTerminalRows,
      cols: globalThis.__wasmacsTerminalCols,
    });
  }
  if (msg?.type === "emacs-input-bytes") {
    injectTerminalInput(msg.bytes || []);
  }
  if (msg?.type === "start") {
    updateTerminalSize(msg.terminalSize);
    const debugOptions = msg.debugOptions || {};
    globalThis.__wasmacsDiagnosticLog = debugOptions.debugLog === true;
    post("ready", { sab: INPUT_SAB, terminalSizeSAB: TERMINAL_SIZE_SAB });
    const init = typeof msg.init === "string" && msg.init.trim() ? msg.init.trim() : "emacs";
    const userNodes = await loadUserImage();
    loadKernelScripts(debugOptions);
    if (init === "emacs") {
      const pdmpBytes = msg.pdmpBytes ? new Uint8Array(msg.pdmpBytes) : null;
      await startEmacs(pdmpBytes, userNodes, debugOptions);
    } else {
      await startInit(init, userNodes);
    }
  }
  if (msg?.type === "export-wasifs") {
    try {
      const bytes = exportUserImage(systemFS);
      self.postMessage({
        type: "wasifs-export-data",
        bytes: bytes.buffer,
        filename: "user-filesystem.wasifs",
      }, [bytes.buffer]);
    } catch (e) {
      post("stderr", { text: "export failed: " + e });
    }
  }
  if (msg?.type === "import-wasifs") {
    try {
      const bytes = new Uint8Array(msg.bytes);
      const nodes = parseUserTar(bytes);
      if (systemFS) {
        mountUserImage(systemFS, nodes);
        saveToLocalStorage(bytes);
        post("wasifs-imported", {});
      }
    } catch (e) {
      post("stderr", { text: "import failed: " + e });
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// .wasifs filesystem (tar-compatible user image — same as emacs-atomics-worker.js)
// ═══════════════════════════════════════════════════════════════

const BLOCK = 512;
const td = new TextDecoder();
const te = new TextEncoder();

// ── IndexedDB wasifs store (Workers can use IDB; localStorage is unavailable) ──
const WASIFS_IDB_DB    = "wasmacs-wasifs";
const WASIFS_IDB_STORE = "snapshots";

function openWasifsIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(WASIFS_IDB_DB, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(WASIFS_IDB_STORE)) {
        req.result.createObjectStore(WASIFS_IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
function saveWasifsToIDB(bytes) {
  openWasifsIDB().then(db => {
    const tx = db.transaction(WASIFS_IDB_STORE, "readwrite");
    tx.objectStore(WASIFS_IDB_STORE).put(bytes, USER_WASIFS_KEY);
    tx.oncomplete = () => db.close();
    tx.onerror    = () => db.close();
  }).catch(() => {});
}
async function loadWasifsFromIDB() {
  try {
    const db = await openWasifsIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(WASIFS_IDB_STORE, "readonly");
      const req = tx.objectStore(WASIFS_IDB_STORE).get(USER_WASIFS_KEY);
      req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
      req.onerror   = () => { db.close(); resolve(null); };
    });
  } catch (_) { return null; }
}

function trimNulls(bytes) {
  const zero = bytes.indexOf(0);
  return td.decode(bytes.subarray(0, zero === -1 ? bytes.length : zero)).trim();
}
function parseOctal(bytes) {
  const text = trimNulls(bytes).trim();
  return text.length === 0 ? 0 : Number.parseInt(text, 8);
}
function padLen(n) { return Math.ceil(n / BLOCK) * BLOCK; }
function loadBase64(_key) { return null; } // localStorage unavailable in workers
function saveToLocalStorage(bytes) { saveWasifsToIDB(bytes); }
function saveBase64(__key, __val) { /* no-op: use IDB instead */ }
function b64decode(text) {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function b64encode(bytes) {
  let bin = "";
  const sz = 0x8000;
  for (let o = 0; o < bytes.length; o += sz)
    bin += String.fromCharCode(...bytes.subarray(o, o + sz));
  return btoa(bin);
}

// macOS `tar` embeds extended-attribute metadata as `PaxHeader/<name>` (PAX
// extended header) and `._<name>` (AppleDouble resource fork) entries. These
// are not real user files/directories and must not be mounted, or a bogus
// "PaxHeader" directory shows up in /home/user.
function isMacTarMetadata(cleanEntry) {
  const base = cleanEntry.slice(cleanEntry.lastIndexOf("/") + 1);
  return cleanEntry === "PaxHeader" || cleanEntry.startsWith("PaxHeader/")
    || cleanEntry.includes("/PaxHeader/") || base.startsWith("._");
}

function parseUserTar(bytes) {
  const nodes = new Map();
  let off = 0;
  while (off + BLOCK <= bytes.length) {
    const h = bytes.subarray(off, off + BLOCK);
    if (h.every(b => b === 0)) break;
    const name = trimNulls(h.subarray(0, 100));
    const prefix = trimNulls(h.subarray(345, 500));
    const entry = prefix ? prefix + "/" + name : name;
    const size = parseOctal(h.subarray(124, 136));
    const type = String.fromCharCode(h[156] || 48);
    const dstart = off + BLOCK;
    const cleanEntry = entry.replace(/\/$/, "");
    if ((cleanEntry === "home/user" || cleanEntry.startsWith("home/user/")) && !isMacTarMetadata(cleanEntry)) {
      const isDir = type === "5" || entry.endsWith("/");
      const path = cleanEntry === "home/user" ? "/home/user" : "/" + cleanEntry;
      nodes.set(path, {
        isDir,
        data: isDir ? null : bytes.slice(dstart, dstart + size),
        mode: parseOctal(h.subarray(100, 108)) & 0o7777,
        mtime: parseOctal(h.subarray(136, 148)),
      });
    }
    off = dstart + padLen(size);
  }
  return nodes;
}

async function loadUserImage() {
  const stored = await loadWasifsFromIDB();
  if (stored) {
    post("status", { text: "loading user image from IDB..." });
    return parseUserTar(stored instanceof Uint8Array ? stored : new Uint8Array(stored));
  }
  post("status", { text: "fetching empty user image..." });
  const resp = await fetch(USER_WASIFS_URL);
  if (!resp.ok) throw new Error(`Failed to fetch user image: ${resp.status}`);
  return parseUserTar(new Uint8Array(await resp.arrayBuffer()));
}

function mountUserImage(FS, nodes) {
  const dirs = new Set();
  for (const [path, node] of nodes) {
    const parts = path.split("/").filter(Boolean);
    const directoryDepth = node.isDir ? parts.length : parts.length - 1;
    for (let i = 0; i < directoryDepth; i++) {
      const d = "/" + parts.slice(0, i + 1).join("/");
      if (d !== "/") dirs.add(d);
    }
  }
  for (const d of [...dirs].sort()) { try { FS.mkdir(d); } catch (_) {} }
  for (const [path, node] of nodes) {
    if (!node.isDir && node.data) {
      const slash = path.lastIndexOf("/");
      const parent = slash <= 0 ? "/" : path.slice(0, slash);
      const name = path.slice(slash + 1);
      try { FS.unlink(path); } catch (_) {}
      try { FS.rmdir(path); } catch (_) {}
      FS.createDataFile(parent, name, node.data, true, true);
      // The executable bit (scripts, git hooks) and the modification time
      // (git compares it with its index) survive a reload.
      try {
        if (node.mode && typeof FS.chmod === "function") FS.chmod(path, node.mode);
        if (node.mtime && typeof FS.utime === "function") FS.utime(path, node.mtime * 1000, node.mtime * 1000);
      } catch (_) {}
    }
  }
  post("status", { text: `mounted ${nodes.size} user paths` });
}

function exportUserImage(FS) {
  return createUserTar(readUserTree(FS, listUserTree(FS)));
}

// /home/user is saved before every idle wait of Emacs.  Walking the tree
// (names, sizes, modes, times) is cheap; reading every file, building the
// tar and storing it is not, so that only happens when the walk found a
// difference to what was saved last.
let savedUserTreeSignature = null;
function postUserImageSnapshot(FS, reason) {
  if (!FS || globalThis.__wasmacsExportingUserImage) return;
  globalThis.__wasmacsExportingUserImage = true;
  try {
    const listing = listUserTree(FS);
    if (listing.signature === savedUserTreeSignature) return;
    const bytes = createUserTar(readUserTree(FS, listing));
    savedUserTreeSignature = listing.signature;
    self.postMessage(
      { type: "wasifs-snapshot", bytes: bytes.buffer, reason },
      [bytes.buffer],
    );
  } catch (_) {
    // Snapshot export must never break the Emacs input wait boundary.
  } finally {
    globalThis.__wasmacsExportingUserImage = false;
  }
}

// The user tree without file contents: [{ path, isDir, mode, size, mtime }]
// plus a signature that changes whenever an entry is added, removed, resized,
// rewritten (MEMFS stamps every write) or gets another mode.
function listUserTree(FS, startDir = "/home/user") {
  const entries = [{ path: startDir, isDir: true, mode: 0o755, size: 0, mtime: 0 }];
  // Two independent 32-bit FNV-1a hashes over the entry descriptions.
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const mix = (text) => {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ c, 0x85ebca6b) + 0x9e3779b9 | 0;
    }
  };
  const queue = [startDir];
  while (queue.length > 0) {
    const dir = queue.pop();
    let names;
    try { names = FS.readdir(dir); } catch (_) { continue; }
    for (const name of names) {
      if (name === "." || name === "..") continue;
      const path = dir === "/" ? "/" + name : dir + "/" + name;
      try {
        const stat = FS.stat(path);
        const isDir = FS.isDir(stat.mode);
        const mtime = stat.mtime instanceof Date ? stat.mtime.getTime() : Number(stat.mtime) || 0;
        entries.push({ path, isDir, mode: stat.mode & 0o7777, size: isDir ? 0 : stat.size, mtime });
        // A directory's own time changes with every file created in it; the
        // entries themselves already say what is there.
        mix(isDir ? `${path}/${stat.mode & 0o7777}\n` : `${path}:${stat.mode & 0o7777}:${stat.size}:${mtime}\n`);
        if (isDir) queue.push(path);
      } catch (_) {}
    }
  }
  return { entries, signature: `${entries.length}:${h1 >>> 0}:${h2 >>> 0}` };
}

// Map(path -> { isDir, data, mode, mtime }) for createUserTar.
function readUserTree(FS, listing) {
  const nodes = new Map();
  for (const entry of listing.entries) {
    if (entry.isDir) {
      nodes.set(entry.path, { isDir: true, data: null, mode: entry.mode, mtime: Math.floor(entry.mtime / 1000) });
      continue;
    }
    try {
      nodes.set(entry.path, {
        isDir: false,
        data: new Uint8Array(FS.readFile(entry.path, { encoding: "binary" })),
        mode: entry.mode,
        mtime: Math.floor(entry.mtime / 1000),
      });
    } catch (_) {}
  }
  return nodes;
}

const WASMACS_XTERM_TERM_SHIM = `
;;; xterm.el --- wasmacs browser xterm shim -*- lexical-binding: t; -*-
;; Keep TERM=xterm-256color while avoiding the full GNU term/xterm.el startup
;; path in browser Workers with small JavaScript stacks.  Termcap has already
;; installed cursor-key sequences from ku/kd/kr/kl in src/term.c.

(require 'term/tty-colors)
(require 'cl-lib)

(defcustom xterm-max-cut-length 100000
  \"Maximum number of bytes to cut into xterm using the OSC 52 sequence.\"
  :type 'natnum
  :group 'xterm)

(defun xterm--selection-char (type)
  (pcase type
    ('PRIMARY \"p\")
    ('CLIPBOARD \"c\")
    (_ (error \"Invalid selection type: %S\" type))))

(cl-defmethod gui-backend-set-selection
    (type data
     &context (window-system nil)
              ((terminal-parameter nil 'xterm--set-selection) (eql t)))
  \"Copy DATA to the system clipboard using the OSC 52 escape sequence.\"
  (let* ((bytes (encode-coding-string data 'utf-8-unix))
         (base-64 (base64-encode-string bytes :no-line-break))
         (length (length base-64)))
    (if (> length xterm-max-cut-length)
        (warn \"Selection too long to send to terminal: %d bytes\" length)
      (send-string-to-terminal
       (concat \"\\e]52;\" (xterm--selection-char type) \";\" base-64 \"\\a\")))))

(defvar xterm-standard-colors
  '((\"black\"          0 (  0   0   0))
    (\"red\"            1 (205   0   0))
    (\"green\"          2 (  0 205   0))
    (\"yellow\"         3 (205 205   0))
    (\"blue\"           4 (  0   0 238))
    (\"magenta\"        5 (205   0 205))
    (\"cyan\"           6 (  0 205 205))
    (\"white\"          7 (229 229 229))
    (\"brightblack\"    8 (127 127 127))
    (\"brightred\"      9 (255   0   0))
    (\"brightgreen\"   10 (  0 255   0))
    (\"brightyellow\"  11 (255 255   0))
    (\"brightblue\"    12 ( 92  92 255))
    (\"brightmagenta\" 13 (255   0 255))
    (\"brightcyan\"    14 (  0 255 255))
    (\"brightwhite\"   15 (255 255 255))))

(defun xterm-rgb-convert-to-16bit (prim)
  (logior prim (ash prim 8)))

(defun wasmacs-xterm-register-colors ()
  "Register xterm's palette without running full xterm probes."
  (let* ((cells (display-color-cells))
         (ncolors (if (= cells 16777216) 256 cells)))
    (when (> ncolors 0)
      (tty-color-clear))
    (dolist (color xterm-standard-colors)
      (when (> ncolors 0)
        (tty-color-define (car color) (cadr color)
                          (mapcar #'xterm-rgb-convert-to-16bit
                                  (car (cddr color))))
        (setq ncolors (1- ncolors))))
    (when (= ncolors 240)
      (let ((r 0) (g 0) (b 0))
        (while (> ncolors 24)
          (tty-color-define (format \"color-%d\" (- 256 ncolors))
                            (- 256 ncolors)
                            (mapcar #'xterm-rgb-convert-to-16bit
                                    (list (if (zerop r) 0 (+ (* r 40) 55))
                                          (if (zerop g) 0 (+ (* g 40) 55))
                                          (if (zerop b) 0 (+ (* b 40) 55)))))
          (setq b (1+ b))
          (when (> b 5) (setq g (1+ g) b 0))
          (when (> g 5) (setq r (1+ r) g 0))
          (setq ncolors (1- ncolors))))
      (while (> ncolors 0)
        (let ((gray (xterm-rgb-convert-to-16bit
                     (+ 8 (* (- 24 ncolors) 10)))))
          (tty-color-define (format \"color-%d\" (- 256 ncolors))
                            (- 256 ncolors)
                            (list gray gray gray)))
        (setq ncolors (1- ncolors))))
    (clear-face-cache)))

(defun terminal-init-xterm ()
  "Initialize the wasmacs xterm tty without probing browser-hostile features."
  (wasmacs-xterm-register-colors)
  (when (fboundp 'tty-set-up-initial-frame-faces)
    (tty-set-up-initial-frame-faces))
  (set-terminal-parameter nil 'xterm--set-selection t)
  (run-hooks 'terminal-init-xterm-hook))

(provide 'term/xterm)
;;; xterm.el ends here
`.trimStart();

function installXtermTermShim(FS) {
  const termDir = "/usr/local/share/emacs/30.2/lisp/term";
  try {
    try { FS.mkdir("/usr"); } catch (_) {}
    try { FS.mkdir("/usr/local"); } catch (_) {}
    try { FS.mkdir("/usr/local/share"); } catch (_) {}
    try { FS.mkdir("/usr/local/share/emacs"); } catch (_) {}
    try { FS.mkdir("/usr/local/share/emacs/30.2"); } catch (_) {}
    try { FS.mkdir("/usr/local/share/emacs/30.2/lisp"); } catch (_) {}
    try { FS.mkdir(termDir); } catch (_) {}
    try { FS.unlink(`${termDir}/xterm.elc`); } catch (_) {}
    FS.writeFile(`${termDir}/xterm.el`, WASMACS_XTERM_TERM_SHIM);
    post("status", { text: "installed wasmacs xterm terminal shim" });
  } catch (e) {
    post("stderr", { text: `xterm terminal shim install failed: ${e}` });
  }
}

// ustar keeps a path as name (100 bytes) plus prefix (155 bytes), split at a
// slash.  Returns null for a path that does not fit.
function splitTarPath(tarpath) {
  if (te.encode(tarpath).length <= 100) return { name: tarpath, prefix: "" };
  for (let slash = tarpath.indexOf("/"); slash !== -1; slash = tarpath.indexOf("/", slash + 1)) {
    const prefix = tarpath.slice(0, slash);
    const name = tarpath.slice(slash + 1);
    if (name.length > 0 && te.encode(prefix).length <= 155 && te.encode(name).length <= 100) return { name, prefix };
  }
  return null;
}

function createUserTar(nodes) {
  const chunks = [];
  const paths = [...nodes.keys()].filter(p => p === "/home/user" || p.startsWith("/home/user/")).sort();
  const now = Math.floor(Date.now() / 1000);
  const skipped = [];
  for (const path of paths) {
    const node = nodes.get(path);
    const tarpath = node.isDir ? path.replace(/^\//, "") + "/" : path.replace(/^\//, "");
    const split = splitTarPath(tarpath);
    if (!split) { skipped.push(path); continue; }
    const content = node.isDir ? new Uint8Array() : (node.data || new Uint8Array());
    const h = new Uint8Array(BLOCK);
    const enc = (off, len, str) => { h.fill(0, off, off + len); h.set(te.encode(str).subarray(0, len), off); };
    const octal = (off, len, val) => enc(off, len, val.toString(8).padStart(len - 1, "0").slice(-(len - 1)));
    enc(0, 100, split.name);
    octal(100, 8, (node.mode ?? (node.isDir ? 0o755 : 0o644)) & 0o7777);
    octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, content.length);
    octal(136, 12, node.mtime || now);
    h.fill(32, 148, 156); h[156] = node.isDir ? 53 : 48;
    enc(257, 6, "ustar"); enc(263, 2, "00");
    enc(345, 155, split.prefix);
    octal(148, 7, h.reduce((s, b) => s + b, 0)); h[155] = 0;
    chunks.push(h);
    if (!node.isDir) {
      chunks.push(content);
      const p = padLen(content.length) - content.length;
      if (p > 0) chunks.push(new Uint8Array(p));
    }
  }
  if (skipped.length > 0 && !globalThis.__wasmacsWarnedLongPaths) {
    // Once per session: these files exist now but will be gone after a reload.
    globalThis.__wasmacsWarnedLongPaths = true;
    post("stderr", { text: `user image: ${skipped.length} path(s) are too long to be saved (ustar limit), e.g. ${skipped[0]}` });
  }
  chunks.push(new Uint8Array(BLOCK * 2));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ═══════════════════════════════════════════════════════════════
// Process kernel and userland
// ═══════════════════════════════════════════════════════════════
// The kernel (src/runtime/process/wasmacs-kernel.js) is booted on the
// filesystem of the system module before init starts.  The programs are
// separate images; the worker makes them visible in the filesystem (/bin/sh,
// /bin/git, ... marker files) and tells the kernel how to load an image when
// one is executed.

// The filesystem of the system module, once it is loaded.
let systemFS = null;

// Load wasmacs-kernel.js and wasmacs-boot.js.  Without them Emacs still runs,
// with no subprocesses.
function loadKernelScripts(debugOptions = {}) {
  try {
    // Development aid (see the page): a kernel under development.
    const kernelUrl = typeof debugOptions.processKernelUrl === "string"
      ? debugOptions.processKernelUrl
      : `${USERLAND_DIR}/wasmacs-kernel.js?v=${ARTIFACT_CACHE_BUST}`;
    importScripts(kernelUrl);
    importScripts(`${USERLAND_DIR}/wasmacs-boot.js?v=${ARTIFACT_CACHE_BUST}`);
    if (typeof debugOptions.processKernelUrl === "string") {
      post("status", { text: `process kernel from ${debugOptions.processKernelUrl}` });
    }
    return true;
  } catch (e) {
    post("stderr", { text: `process kernel not available: ${e}` });
    return false;
  }
}

function kernelLog(msg) {
  const diagnostic = globalThis.__wasmacsDiagnosticLog || globalThis.__wasmacsProcessDebug;
  if (diagnostic) console.warn(msg);
  if (diagnostic || /killed by signal|cannot load|failed/.test(String(msg))) {
    post("stderr", { text: String(msg) });
  }
}

// Create the kernel on FS, for INIT ("emacs", or the program the console task
// will start).  Returns null when the kernel scripts could not be loaded.
function bootKernel(FS, init, views = null) {
  systemFS = FS;
  if (!self.WasmacsKernel || !self.WasmacsBoot) return null;
  const kernel = self.WasmacsBoot.boot({
    FS,
    init,
    views,
    console: self.WasmacsBoot.createConsole({ post: (message) => self.postMessage(message) }),
    debug: !!globalThis.__wasmacsProcessDebug,
    log: kernelLog,
    loadProgram(name) {
      const load = globalThis.__wasmacsLoadProgram;
      if (typeof load !== "function") throw new Error("no program loader is installed");
      return load(name);
    },
  });
  post("status", { text: `kernel booted (init: ${init})` });
  return kernel;
}

async function installProcessUserland(FS) {
  let manifest;
  try {
    importScripts(`${USERLAND_DIR}/wasmacs-userland.js?v=${ARTIFACT_CACHE_BUST}`);
    const response = await fetch(`${USERLAND_DIR}/manifest.json?v=${ARTIFACT_CACHE_BUST}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`manifest.json: HTTP ${response.status}`);
    manifest = await response.json();
  } catch (e) {
    post("status", { text: "process userland not available (subprocesses are disabled)" });
    if (globalThis.__wasmacsDiagnosticLog) post("stderr", { text: `process userland: ${e}` });
    return null;
  }
  const commandCount = self.WasmacsUserland.install(FS, manifest);
  if (manifest.programs?.["git-http"]) {
    importScripts(`${USERLAND_DIR}/wasmacs-http.js?v=${ARTIFACT_CACHE_BUST}`);
    globalThis.__wasmacsStartProcessHttp = self.WasmacsHttp.createClient({
      postMessage: (message) => self.postMessage(message),
      wakeSAB: INPUT_SAB,
    });
  }
  installProgramLoader(FS, manifest);
  post("status", { text: `process userland ready (${commandCount} commands)` });
  return manifest;
}

// The kernel calls this while Emacs is blocked inside a system call (the
// worker's event loop is not running), so loading has to be synchronous:
// a synchronous XHR for the wasm binary and importScripts for its glue.
function installProgramLoader(FS, manifest) {
  const images = new Map();
  globalThis.__wasmacsLoadProgram = function wasmacsLoadProgram(name) {
    if (images.has(name)) return images.get(name);
    if (!manifest.programs || !manifest.programs[name]) {
      throw new Error(`unknown program image: ${name}`);
    }
    post("status", { text: `loading ${name}...` });
    const base = `${USERLAND_DIR}/${name}`;
    const xhr = new XMLHttpRequest();
    xhr.open("GET", `${base}.wasm?v=${ARTIFACT_CACHE_BUST}`, false);
    xhr.responseType = "arraybuffer";
    xhr.send();
    if (xhr.status !== 200 || !xhr.response) {
      throw new Error(`${name}.wasm: HTTP ${xhr.status}`);
    }
    const wasm = new WebAssembly.Module(xhr.response);
    importScripts(`${base}.js?v=${ARTIFACT_CACHE_BUST}`);
    const factory = self[`wasmacsProgram_${name.replace(/-/g, "_")}`];
    if (typeof factory !== "function") {
      throw new Error(`${name}.js did not define wasmacsProgram_${name}`);
    }
    self.WasmacsUserland.installProgramFiles(FS, manifest, name, (source) => {
      const data = new XMLHttpRequest();
      data.open("GET", `${USERLAND_DIR}/${source}?v=${ARTIFACT_CACHE_BUST}`, false);
      data.responseType = "arraybuffer";
      data.send();
      if (data.status !== 200 || !data.response) throw new Error(`${source}: HTTP ${data.status}`);
      return new Uint8Array(data.response);
    });
    const image = { factory, wasm };
    images.set(name, image);
    post("status", { text: `loaded ${name} (${(xhr.response.byteLength / 1024 / 1024).toFixed(1)} MB)` });
    return image;
  };
}

// ═══════════════════════════════════════════════════════════════
// Emacs bootstrap
// ═══════════════════════════════════════════════════════════════

async function startEmacs(pdmpBytes, userNodes, debugOptions = {}) {
  post("status", { text: "loading Emacs wasm (pdump profile)..." });

  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });
  const shouldPostStderr = createRunDependencyLogFilter();

  const Module = {
    noInitialRun: true,
    // "/temacs" (leading slash): find_emacs_executable takes the strchr branch,
    // returns "/temacs" even if not found via realpath, so --dump-file is not nulled.
    thisProgram: "/temacs",
    locateFile(path) { return `${ARTIFACT_DIR}/${path}?v=${ARTIFACT_CACHE_BUST}`; },
    getPreloadedPackage(packageName, packageSize) {
      if (String(packageName).includes("temacs.data")) {
        return fetchSplitPreloadedPackage(packageName, packageSize);
      }
      return null;
    },
    print(text) { post("stdout", { text }); },
    printErr(text) {
      if (!shouldPostStderr(String(text))) return;
      if (globalThis.__wasmacsDiagnosticLog) {
        console.warn("[pdump worker]", text);
        post("stderr", { text });
      } else if (/error|failed|abort|panic/i.test(String(text))) {
        post("stderr", { text });
      }
    },
    onAbort(what) { post("session-ended", { error: `abort: ${what}` }); },
    preRun: [function() {
      // The C environment is captured when the static constructors run, right
      // after preRun.  PATH and SHELL point Emacs (exec-path, shell-file-name)
      // and its subprocesses at the process userland; keep them in sync with
      // WasmacsUserland.ENVIRONMENT (src/runtime/process/wasmacs-userland.js).
      try {
        ENV.PATH = "/bin:/usr/bin";
        ENV.SHELL = "/bin/sh";
      } catch (_) {}
      try {
        try { Module.FS.mkdir("/tmp"); } catch (_) {}
        try { Module.FS.mkdir("/home"); } catch (_) {}
        try { Module.FS.mkdir("/home/user"); } catch (_) {}
        try { Module.FS.mkdir("/home/user/.emacs.d"); } catch (_) {}
        try { Module.FS.mkdir("/home/user/projects"); } catch (_) {}
        mountUserImage(Module.FS, userNodes);
      } catch (e) {
        console.warn("[pdump worker] user mount failed:", e);
      }
    }],
    onRuntimeInitialized() {
      // Patch TTY ops on each fd (belt-and-suspenders alongside js-library __postset)
      try {
        const FS = Module.FS;
        const putChar = (_tty, val) => {
          if (val === null) return;
          globalThis.__wasmacsTerminalOutputBytes.push(val & 255);
        };
        const getChar = () => {
          const q = globalThis.__wasmacsTerminalInputBytes || [];
          return q.length ? q.shift() : undefined;
        };
        const ioctl_tcgets = () => ({
          c_iflag: 0, c_oflag: 0, c_cflag: 2237, c_lflag: 0,
          c_cc: [3,28,127,21,4,0,1,0,17,19,26,0,18,15,23,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        });
        for (let fd = 0; fd <= 2; fd++) {
          const stream = FS.getStream(fd);
          if (stream?.tty) {
            stream.tty.ops.put_char = putChar;
            stream.tty.ops.get_char = getChar;
            stream.tty.ops.fsync = () => {};
            stream.tty.ops.ioctl_tcgets = ioctl_tcgets;
            stream.tty.ops.ioctl_tcsets = () => 0;
            stream.tty.ops.ioctl_tiocgwinsz = () =>
              [globalThis.__wasmacsTerminalRows || 24, globalThis.__wasmacsTerminalCols || 80];
          }
        }
      } catch (e) {
        console.warn("[pdump worker] TTY patch failed:", e);
      }
      post("binary-info", {
        artifactDir: ARTIFACT_DIR,
        thisProgram: Module.thisProgram,
        callMainType: typeof Module.callMain,
        terminalRows: globalThis.__wasmacsTerminalRows,
        terminalCols: globalThis.__wasmacsTerminalCols,
      });
      post("status", { text: "runtime initialized" });
      resolveReady();
    },
  };

  self.Module = Module;

  try {
    importScripts(`${ARTIFACT_DIR}/temacs.js?v=${ARTIFACT_CACHE_BUST}`);
  } catch (err) {
    post("session-ended", { error: String(err) });
    return;
  }

  await ready;

  // The kernel comes first: Emacs is its init and attaches to it (as the host
  // process, pid 1) with its first process system call.
  bootKernel(Module.FS, "emacs");

  try {
    const originalAtomicsWait = Atomics.wait.bind(Atomics);
    Atomics.wait = function wasmacsSnapshottingAtomicsWait(...args) {
      postUserImageSnapshot(Module.FS, "before-wait");
      return originalAtomicsWait(...args);
    };
  } catch (_) {}

  if (installMainThreadNetworkFetchBridge()) {
    post("status", { text: "host.network.fetch relay ready" });
  }

  try {
    ENV.LANG = "C";
    ENV.LC_ALL = "C";
    ENV.HOME = "/home/user";
    ENV.USER = "user";
    ENV.LOGNAME = "user";
    ENV.TERM = "xterm-256color";
    ENV.COLORTERM = "truecolor";
    ENV.TERMCAP = "xterm-256color:co#80:li#24:Co#16777216:cl=\\E[H\\E[2J:cm=\\E[%i%d;%dH:up=\\E[A:do=\\E[B:nd=\\E[C:le=\\b:bs:ku=\\E[A:kd=\\E[B:kr=\\E[C:kl=\\E[D:kh=\\E[H:@7=\\E[F:kD=\\E[3~:ks=\\E[?1h\\E=:ke=\\E[?1l\\E>:vi=\\E[?25l:ve=\\E[?25h:vs=\\E[?25h:ti=\\E[?1049h:te=\\E[?1049l:so=\\E[7m:se=\\E[27m:us=\\E[4m:ue=\\E[24m:md=\\E[1m:mr=\\E[7m:me=\\E[0m:AF=\\E[38;5;%dm:AB=\\E[48;5;%dm:op=\\E[39;49m:";
  } catch (_) {}

  installXtermTermShim(Module.FS);

  // Subprocesses: /bin, /etc and the program loader (PATH and SHELL were set
  // in preRun).
  const processUserland = await installProcessUserland(Module.FS);

  // Write pdmp to MEMFS AFTER runtime is ready
  if (pdmpBytes) {
    try {
      Module.FS.writeFile("/temacs", new Uint8Array([0]));
      Module.FS.chmod("/temacs", 0o755);
      Module.FS.createDataFile("/", "bootstrap-emacs.pdmp", pdmpBytes, true, true, true);
      post("status", { text: `pdmp materialized (${(pdmpBytes.length / 1024 / 1024).toFixed(1)} MB)` });
      post("pdmp-materialized", { size: pdmpBytes.length });
    } catch (e) {
      post("stderr", { text: `pdmp MEMFS write failed: ${e}` });
    }
  }

  const WASMACS_DEFAULT_LISP_INIT = [
    "(progn",
    "  (require 'wasmacs-url-fetch)",
    "  (wasmacs-url-fetch-enable)",
    "  (message \"WASMACS-URL-FETCH=%S\" (featurep 'wasmacs-url-fetch)))",
  ].join("\n");

  const COMMON_EVALS = [
    "--eval", "(setq uniquify-trailing-separator-p nil)",
    "--eval", "(setq create-lockfiles nil)",
    "--eval", "(setq auto-save-timeout nil)",
    "--eval", "(progn (require 'ls-lisp) (setq ls-lisp-use-insert-directory-program nil insert-directory-program nil))",
    "--eval", "(progn (require 'xt-mouse) (xterm-mouse-mode 1) (message \"WASMACS-XTERM-MOUSE=%S\" xterm-mouse-mode))",
  ];
  if (!debugOptions.noDefaultInit) {
    COMMON_EVALS.splice(8, 0, "--eval", WASMACS_DEFAULT_LISP_INIT);
  }
  // Settings that go with the process userland (no ptys, GNU grep, ...); see
  // EMACS_SETTINGS in src/runtime/process/wasmacs-userland.js.
  for (const expr of (processUserland && self.WasmacsUserland.EMACS_SETTINGS) || []) {
    COMMON_EVALS.push("--eval", expr);
  }
  for (const expr of debugOptions.extraEvals || []) {
    if (typeof expr === "string" && expr.length > 0) COMMON_EVALS.push("--eval", expr);
  }
  queueTerminalControlSequence("\u001b[?1000h\u001b[?1003h\u001b[?1006h");
  const bootArgs = pdmpBytes
    ? ["--dump-file=/bootstrap-emacs.pdmp", "--quick", "--no-splash", "-nw", ...COMMON_EVALS]
    : ["--quick", "--no-splash", "-nw", ...COMMON_EVALS];

  post("status", { text: `boot: ${bootArgs.join(" ")}` });
  if (globalThis.__wasmacsDiagnosticLog)
    post("stderr", { text: `JS-BEFORE-CALLMAIN: args=${JSON.stringify(bootArgs)} callMain=${typeof Module.callMain}` });

  try {
    if (globalThis.__wasmacsDiagnosticLog) post("stderr", { text: "JS-CALLMAIN-START" });
    const status = Module.callMain(bootArgs);
    if (globalThis.__wasmacsDiagnosticLog) post("stderr", { text: `JS-CALLMAIN-RETURNED: ${status}` });
    if (status) postTerminalTail(`status=${status}`);
    postUserImageSnapshot(Module.FS, "session-ended");
    post("session-ended", { status });
  } catch (err) {
    postTerminalTail("throw");
    postUserImageSnapshot(Module.FS, "session-error");
    if (err?.name !== "ExitStatus") {
      console.error("[pdump worker] callMain threw:", err);
    }
    if (err?.stack) {
      post("stderr", { text: `callMain stack: ${err.stack}` });
    }
    post("session-ended", { status: err?.status ?? 1, error: err?.message, stack: err?.stack });
  }
}

// ═══════════════════════════════════════════════════════════════
// Another init: a userland program on the console
// ═══════════════════════════════════════════════════════════════
// ?init=sh (or vi, python3, any command line of the userland).  Emacs is not
// loaded: the base module provides the filesystem, init runs as pid 1 on a
// pseudoterminal, and the kernel's console task connects that terminal to
// the page.  When init exits the system halts.

async function startInit(commandLine, userNodes) {
  const halt = (status, error) => post("session-ended", error ? { status, error } : { status });
  if (!self.WasmacsKernel || !self.WasmacsBoot) {
    halt(1, "the process kernel is not available");
    return;
  }
  let base;
  try {
    post("status", { text: "loading the base system..." });
    importScripts(`${USERLAND_DIR}/wasmacs-base.js?v=${ARTIFACT_CACHE_BUST}`);
    base = await self.wasmacsBase({
      locateFile(path) { return `${USERLAND_DIR}/${path}?v=${ARTIFACT_CACHE_BUST}`; },
      print(text) { post("stdout", { text }); },
      printErr(text) { post("stderr", { text: String(text) }); },
    });
  } catch (e) {
    halt(1, `base system: ${e}`);
    return;
  }
  const FS = base.FS;
  const kernel = bootKernel(FS, commandLine,
    () => ({ HEAPU8: base.HEAPU8, HEAP32: base.HEAP32, HEAP16: base.HEAP16 }));
  try { mountUserImage(FS, userNodes); } catch (e) { post("stderr", { text: `user mount failed: ${e}` }); }
  const manifest = await installProcessUserland(FS);
  if (!manifest) {
    halt(1, "the process userland is not available");
    return;
  }

  const argv = commandLine.split(/\s+/).filter(Boolean);
  if (!argv[0].includes("/")) argv[0] = `${self.WasmacsUserland.BIN_DIR}/${argv[0]}`;
  const cons = kernel.console;
  try {
    FS.lookupPath(argv[0], { follow: true });
  } catch (_) {
    cons.writeText(`wasmacs: init: ${argv[0]}: not found\r\n`);
    cons.flushTerminalOutput();
    halt(127, `init ${argv[0]} not found`);
    return;
  }
  const environment = {
    ...self.WasmacsUserland.ENVIRONMENT,
    HOME: "/home/user", USER: "user", LOGNAME: "user", LANG: "C",
    TERM: "xterm-256color", COLORTERM: "truecolor",
  };
  post("binary-info", { artifactDir: USERLAND_DIR, thisProgram: argv[0], callMainType: "init" });
  post("status", { text: `init: ${argv.join(" ")}` });
  let status;
  let lastSnapshot = -Infinity;
  try {
    status = self.WasmacsBoot.runInit(kernel, {
      argv,
      env: Object.keys(environment).map((name) => `${name}=${environment[name]}`),
      cwd: "/home/user",
      // Save /home/user when the system goes idle, at most once a second: a
      // program that polls (Python's REPL) goes idle many times a second.
      beforeIdle() {
        const now = performance.now();
        if (now - lastSnapshot < 1000) return;
        lastSnapshot = now;
        postUserImageSnapshot(FS, "before-wait");
      },
    });
  } catch (err) {
    postUserImageSnapshot(FS, "session-error");
    console.error("[system worker] init failed:", err);
    halt(1, err?.message || String(err));
    return;
  }
  postUserImageSnapshot(FS, "session-ended");
  const signal = status & 0x7f;
  const code = signal ? 128 + signal : (status >> 8) & 0xff;
  cons.writeText(`\r\n[init ${argv[0]} ${signal ? `was killed by signal ${signal}` : `exited with status ${code}`}: system halted]\r\n`);
  cons.flushTerminalOutput();
  halt(code);
}
