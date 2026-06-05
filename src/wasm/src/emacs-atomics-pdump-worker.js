/**
 * emacs-atomics-pdump-worker.js
 *
 * Web Worker for Emacs wasm booting from bootstrap-emacs.pdmp.
 * Uses SharedArrayBuffer + Atomics.wait for input blocking.
 *
 * Architecture identical to emacs-atomics-worker.js except:
 *   - ARTIFACT_DIR points to emacs-browser-atomics-pdump (pdumper-enabled)
 *   - thisProgram: "/temacs"  (leading slash fixes load_pdump --dump-file path)
 *   - Accepts { type: "start", pdmpBytes: ArrayBuffer } to load from pdmp
 *
 * Boot sequence:
 *   1. Module loads + TTY patched
 *   2. pdmpBytes written to MEMFS at /bootstrap-emacs.pdmp
 *   3. callMain(["--dump-file=/bootstrap-emacs.pdmp", "--quick", "--no-splash", "-nw"])
 *   4. Emacs enters command loop, Atomics.wait blocks at input
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

// ── SharedArrayBuffer ────────────────────────────────────────────
const INPUT_SAB = new SharedArrayBuffer(264);
const TERMINAL_SIZE_SAB = new SharedArrayBuffer(12);
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

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg?.type === "terminal-resize") {
    updateTerminalSize(msg);
    post("terminal-resized", {
      rows: globalThis.__wasmacsTerminalRows,
      cols: globalThis.__wasmacsTerminalCols,
    });
  }
  if (msg?.type === "start") {
    updateTerminalSize(msg.terminalSize);
    const pdmpBytes = msg.pdmpBytes ? new Uint8Array(msg.pdmpBytes) : null;
    await startEmacs(pdmpBytes);
  }
  if (msg?.type === "export-wasifs") {
    try {
      const bytes = exportUserImage(self.Module?.FS);
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
      if (self.Module?.FS) {
        mountUserImage(self.Module.FS, nodes);
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
    const req = indexedDB.open(WASIFS_IDB_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(WASIFS_IDB_STORE);
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
    if (cleanEntry === "home/user" || cleanEntry.startsWith("home/user/")) {
      const isDir = type === "5" || entry.endsWith("/");
      const path = cleanEntry === "home/user" ? "/home/user" : "/" + cleanEntry;
      nodes.set(path, { isDir, data: isDir ? null : bytes.slice(dstart, dstart + size) });
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
    }
  }
  post("status", { text: `mounted ${nodes.size} user paths` });
}

function exportUserImage(FS) {
  const nodes = new Map();
  nodes.set("/home/user", { isDir: true, data: null });
  walkFS(FS, "/home/user", nodes);
  return createUserTar(nodes);
}
function postUserImageSnapshot(FS, reason) {
  if (!FS || globalThis.__wasmacsExportingUserImage) return;
  globalThis.__wasmacsExportingUserImage = true;
  try {
    const bytes = exportUserImage(FS);
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
function walkFS(FS, startDir, nodes) {
  const queue = [startDir];
  while (queue.length > 0) {
    const dir = queue.pop();
    try {
      for (const name of FS.readdir(dir).filter(n => n !== "." && n !== "..")) {
        const path = dir === "/" ? "/" + name : dir + "/" + name;
        try {
          const stat = FS.stat(path);
          if (FS.isDir(stat.mode)) {
            nodes.set(path, { isDir: true, data: null });
            if (!path.includes("/.local/")) queue.push(path);
          } else {
            nodes.set(path, { isDir: false, data: new Uint8Array(FS.readFile(path, { encoding: "binary" })) });
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
}

const WASMACS_XTERM_TERM_SHIM = `
;;; xterm.el --- wasmacs browser xterm shim -*- lexical-binding: t; -*-
;; Keep TERM=xterm-256color while avoiding the full GNU term/xterm.el startup
;; path in browser Workers with small JavaScript stacks.  Termcap has already
;; installed cursor-key sequences from ku/kd/kr/kl in src/term.c.

(require 'term/tty-colors)

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

(defun wasmacs-xterm-register-256-colors ()
  "Register xterm's 256-color palette without running full xterm probes."
  (let ((ncolors (display-color-cells)))
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
  (wasmacs-xterm-register-256-colors)
  (when (fboundp 'tty-set-up-initial-frame-faces)
    (tty-set-up-initial-frame-faces))
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

function createUserTar(nodes) {
  const chunks = [];
  const paths = [...nodes.keys()].filter(p => p === "/home/user" || p.startsWith("/home/user/")).sort();
  for (const path of paths) {
    const node = nodes.get(path);
    const tarpath = node.isDir ? path.replace(/^\//, "") + "/" : path.replace(/^\//, "");
    const content = node.isDir ? new Uint8Array() : (node.data || new Uint8Array());
    const h = new Uint8Array(BLOCK);
    const enc = (off, len, str) => { h.fill(0, off, off + len); h.set(te.encode(str.slice(0, len)).subarray(0, len), off); };
    const octal = (off, len, val) => enc(off, len, val.toString(8).padStart(len - 1, "0").slice(-(len - 1)));
    enc(0, 100, tarpath); octal(100, 8, node.isDir ? 0o755 : 0o644);
    octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, content.length);
    octal(136, 12, Math.floor(Date.now() / 1000));
    h.fill(32, 148, 156); h[156] = node.isDir ? 53 : 48;
    enc(257, 6, "ustar"); enc(263, 2, "00");
    octal(148, 7, h.reduce((s, b) => s + b, 0)); h[155] = 0;
    chunks.push(h);
    if (!node.isDir) {
      chunks.push(content);
      const p = padLen(content.length) - content.length;
      if (p > 0) chunks.push(new Uint8Array(p));
    }
  }
  chunks.push(new Uint8Array(BLOCK * 2));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ═══════════════════════════════════════════════════════════════
// Emacs bootstrap
// ═══════════════════════════════════════════════════════════════

async function startEmacs(pdmpBytes) {
  post("ready", { sab: INPUT_SAB, terminalSizeSAB: TERMINAL_SIZE_SAB });

  const userNodes = await loadUserImage();

  post("status", { text: "loading Emacs wasm (pdump profile)..." });

  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });

  const Module = {
    noInitialRun: true,
    // "/temacs" (leading slash): find_emacs_executable takes the strchr branch,
    // returns "/temacs" even if not found via realpath, so --dump-file is not nulled.
    thisProgram: "/temacs",
    locateFile(path) { return `${ARTIFACT_DIR}/${path}?v=${ARTIFACT_CACHE_BUST}`; },
    print(text) { post("stdout", { text }); },
    printErr(text) {
      console.warn("[pdump worker]", text);
      post("stderr", { text });
    },
    onAbort(what) { post("session-ended", { error: `abort: ${what}` }); },
    preRun: [function() {
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

  try {
    const originalAtomicsWait = Atomics.wait.bind(Atomics);
    Atomics.wait = function wasmacsSnapshottingAtomicsWait(...args) {
      postUserImageSnapshot(Module.FS, "before-wait");
      return originalAtomicsWait(...args);
    };
  } catch (_) {}

  try {
    ENV.LANG = "C";
    ENV.LC_ALL = "C";
    ENV.HOME = "/home/user";
    ENV.USER = "user";
    ENV.LOGNAME = "user";
  } catch (_) {}

  installXtermTermShim(Module.FS);

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

  const COMMON_EVALS = [
    "--eval", "(setq uniquify-trailing-separator-p nil)",
    "--eval", "(setq create-lockfiles nil)",
    "--eval", "(setq auto-save-timeout nil)",
    "--eval", "(progn (require 'ls-lisp) (setq ls-lisp-use-insert-directory-program nil insert-directory-program nil))",
    "--eval", "(progn (require 'xt-mouse) (xterm-mouse-mode 1) (message \"WASMACS-XTERM-MOUSE=%S\" xterm-mouse-mode))",
  ];
  const bootArgs = pdmpBytes
    ? ["--dump-file=/bootstrap-emacs.pdmp", "--quick", "--no-splash", "-nw", ...COMMON_EVALS]
    : ["--quick", "--no-splash", "-nw", ...COMMON_EVALS];

  post("status", { text: `boot: ${bootArgs.join(" ")}` });
  post("stderr", { text: `JS-BEFORE-CALLMAIN: args=${JSON.stringify(bootArgs)} callMain=${typeof Module.callMain}` });

  try {
    post("stderr", { text: "JS-CALLMAIN-START" });
    const status = Module.callMain(bootArgs);
    post("stderr", { text: `JS-CALLMAIN-RETURNED: ${status}` });
    if (status) postTerminalTail(`status=${status}`);
    postUserImageSnapshot(Module.FS, "session-ended");
    post("session-ended", { status });
  } catch (err) {
    postTerminalTail("throw");
    postUserImageSnapshot(Module.FS, "session-error");
    if (err?.name !== "ExitStatus") {
      console.error("[pdump worker] callMain threw:", err);
    }
    post("session-ended", { status: err?.status ?? 1, error: err?.message });
  }
}
