/**
 * emacs-atomics-worker.js
 *
 * Web Worker for Emacs wasm using SharedArrayBuffer + Atomics.wait.
 * With .wasifs user filesystem overlay for persistence.
 */
const ARTIFACT_DIR = "/artifacts/emacs-browser-atomics";
const USER_WASIFS_KEY = "wasmacs:user-filesystem.wasifs:v1";
const USER_WASIFS_URL = "/artifacts/user-filesystem-empty.wasifs";

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

// ── SharedArrayBuffer setup ─────────────────────────────────────
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
  if (event.data?.type === "terminal-resize") {
    updateTerminalSize(event.data);
    post("terminal-resized", {
      rows: globalThis.__wasmacsTerminalRows,
      cols: globalThis.__wasmacsTerminalCols,
    });
  }
  if (event.data?.type === "start") {
    updateTerminalSize(event.data.terminalSize);
    await startEmacs(event.data.args ?? [ "--quick", "--no-splash", "--nw", "--eval", "(setq uniquify-trailing-separator-p nil)", "--eval", "(setq create-lockfiles nil)" ]);
  }
  if (event.data?.type === "export-wasifs") {
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
  if (event.data?.type === "import-wasifs") {
    try {
      const bytes = new Uint8Array(event.data.bytes);
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
// .wasifs filesystem layer (tar-compatible user image)
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

// macOS `tar` embeds extended-attribute metadata as `PaxHeader/<name>` (PAX
// extended header) and `._<name>` (AppleDouble resource fork) entries. These
// are not real user files/directories and must not be mounted, or a bogus
// "PaxHeader" directory shows up in /home/user.
function isMacTarMetadata(cleanEntry) {
  const base = cleanEntry.slice(cleanEntry.lastIndexOf("/") + 1);
  return cleanEntry === "PaxHeader" || cleanEntry.startsWith("PaxHeader/")
    || cleanEntry.includes("/PaxHeader/") || base.startsWith("._");
}

/** Parse tar bytes, return Map of "/home/user/..." → Uint8Array */
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

    // Map "home/user/xxx" → "/home/user/xxx"
    const cleanEntry = entry.replace(/\/$/, "");
    if ((cleanEntry === "home/user" || cleanEntry.startsWith("home/user/")) && !isMacTarMetadata(cleanEntry)) {
      const isDir = type === "5" || entry.endsWith("/");
      const path = cleanEntry === "home/user" ? "/home/user" : "/" + cleanEntry;
      nodes.set(path, {
        isDir,
        data: isDir ? null : bytes.slice(dstart, dstart + size),
      });
    }
    off = dstart + padLen(size);
  }
  return nodes;
}

/** Load user .wasifs from IDB, fallback to empty image */
async function loadUserImage() {
  const stored = await loadWasifsFromIDB();
  if (stored) {
    post("status", { text: "loading user image from IDB..." });
    return parseUserTar(stored instanceof Uint8Array ? stored : new Uint8Array(stored));
  }
  // Load empty image from server
  post("status", { text: "fetching empty user image..." });
  const resp = await fetch(USER_WASIFS_URL);
  if (!resp.ok) throw new Error(`Failed to fetch user image: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  post("status", { text: "user image loaded (empty)" });
  return parseUserTar(new Uint8Array(buf));
}

/** Mount user image nodes into emscripten MEMFS */
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
  // Create directories
  for (const d of [...dirs].sort()) {
    try { FS.mkdir(d); } catch (_) {}
  }
  // Create files
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

/** Read all files under /home/user from MEMFS, return tar bytes */
function exportUserImage(FS) {
  const nodes = new Map();
  nodes.set("/home/user", { isDir: true, data: null });
  walkFS(FS, "/home/user", nodes);
  return createUserTar(nodes);
}
function walkFS(FS, dir, nodes) {
  try {
    const entries = FS.readdir(dir).filter(n => n !== "." && n !== "..");
    for (const name of entries) {
      const path = dir === "/" ? "/" + name : dir + "/" + name;
      try {
        const stat = FS.stat(path);
        if (FS.isDir(stat.mode)) {
          nodes.set(path, { isDir: true, data: null });
          walkFS(FS, path, nodes);
        } else {
          const data = FS.readFile(path, { encoding: "binary" });
          nodes.set(path, { isDir: false, data: new Uint8Array(data) });
        }
      } catch (_) {}
    }
  } catch (_) {}
}

/** Serialize nodes to tar bytes */
function createUserTar(nodes) {
  const chunks = [];
  const paths = [...nodes.keys()].filter(p => p === "/home/user" || p.startsWith("/home/user/")).sort();
  for (const path of paths) {
    const node = nodes.get(path);
    const isDir = node.isDir;
    // tar path: strip leading "/"
    const tarpath = (isDir ? path.replace(/^\//, "") + "/" : path.replace(/^\//, ""));
    const content = isDir ? new Uint8Array() : (node.data || new Uint8Array());
    const h = new Uint8Array(BLOCK);
    const enc = (off, len, str) => { h.fill(0, off, off + len); const b = te.encode(str.slice(0, len)); h.set(b.subarray(0, len), off); };
    const octal = (off, len, val) => { const s = val.toString(8).padStart(len - 1, "0").slice(-(len - 1)); enc(off, len, s); };
    enc(0, 100, tarpath);
    octal(100, 8, isDir ? 0o755 : 0o644);
    octal(108, 8, 0);
    octal(116, 8, 0);
    octal(124, 12, content.length);
    octal(136, 12, Math.floor(Date.now() / 1000));
    h.fill(32, 148, 156);
    h[156] = isDir ? 53 : 48;
    enc(257, 6, "ustar");
    enc(263, 2, "00");
    const cksum = h.reduce((s, b) => s + b, 0);
    octal(148, 7, cksum);
    h[155] = 0;
    chunks.push(h);
    if (!isDir) {
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

let userImageDirty = false;
let lastSaveBytes = 0;

async function startEmacs(args) {
  post("ready", { sab: INPUT_SAB, terminalSizeSAB: TERMINAL_SIZE_SAB });
  post("status", { text: "loading user image..." });

  // Load user filesystem image
  const userNodes = await loadUserImage();

  post("status", { text: "loading Emacs wasm..." });

  let emacsModule;
  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });

  const Module = {
    noInitialRun: true,
    thisProgram: "emacs",
    locateFile(path) { return `${ARTIFACT_DIR}/${path}`; },
    print(text) { post("stdout", { text }); },
    printErr(text) {
      console.warn("[emacs printErr]", text);
      post("stderr", { text });
    },
    onAbort(what) { post("session-ended", { error: `abort: ${what}` }); },
    onExit(status) {
      console.trace("[atomics worker] Module.onExit called with status=" + status);
    },
    preRun: [function () {
      // Mount user filesystem BEFORE Emacs starts
      try {
          try { Module.FS.mkdir("/tmp"); } catch (_) {}
      try { Module.FS.mkdir("/home"); } catch (_) {}
      try { Module.FS.mkdir("/home/user"); } catch (_) {}
      try { Module.FS.mkdir("/home/user/.emacs.d"); } catch (_) {}
      try { Module.FS.mkdir("/home/user/projects"); } catch (_) {}
      mountUserImage(Module.FS, userNodes);
        post("status", { text: "user filesystem mounted" });
      } catch (e) {
        console.warn("[atomics worker] user image mount failed:", e);
      }
    }],
    onRuntimeInitialized() {
      emacsModule = Module;
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
          c_iflag:0, c_oflag:0, c_cflag:2237, c_lflag:0,
          c_cc:[3,28,127,21,4,0,1,0,17,19,26,0,18,15,23,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
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
            console.log(`[atomics worker] TTY ops patched for fd=${fd}`);
          }
        }
      } catch(e) {
        console.warn("[atomics worker] TTY patch failed:", e);
      }
      post("status", { text: "Emacs runtime initialized" });
      resolveReady();
    },
  };

  self.Module = Module;

  try {
    importScripts(`${ARTIFACT_DIR}/temacs`);
  } catch (err) {
    post("session-ended", { error: String(err) });
    return;
  }

  await ready;
  post("status", { text: "starting Emacs..." });

  // Save user image periodically (polled by interval)
  // During Atomics.wait the interval won't fire, but after each wakeup it catches up.
  const saveUserImage = () => {
    try {
      const bytes = exportUserImage(Module.FS);
      if (bytes.length !== lastSaveBytes) {
        lastSaveBytes = bytes.length;
        saveWasifsToIDB(bytes);
        userImageDirty = false;
        post("status", { text: `saved user image (${bytes.length} bytes)` });
      }
    } catch (e) {
      console.warn("[atomics worker] save failed:", e);
    }
  };

  // Periodically save + diagnostic
  let lastDiagSave = 0;
  const checkInterval = setInterval(() => {
    const now = Date.now();
    // Save every 3 seconds if dirty
    if (userImageDirty && now - lastDiagSave > 3000) {
      saveUserImage();
      lastDiagSave = now;
    }
  }, 1000);

  // Mark dirty on file writes via FS.write monitoring is complex;
  // Instead, save on explicit user request or on session end.
  // For now, save every 30 seconds unconditionally.
  setInterval(() => {
    saveUserImage();
  }, 5000);

  post("status", { text: "calling callMain..." });

  try {
    console.log("[atomics worker] calling callMain...");

    const origCallMain = Module.callMain.bind(Module);
    Module.callMain = function patchedCallMain(a) {
      try { return origCallMain(a); }
      catch (e) {
        if (e?.name === "ExitStatus") {
          console.error("[atomics worker] ExitStatus thrown, status=", e.status);
        }
        throw e;
      }
    };

    const status = Module.callMain(args);
    clearInterval(checkInterval);

    // Final save
    saveUserImage();

    console.log("[atomics worker] callMain returned:", status);
    post("session-ended", { status });
  } catch (err) {
    clearInterval(checkInterval);
    saveUserImage();
    if (err?.name !== "ExitStatus") {
      console.error("[atomics worker] callMain threw non-ExitStatus:", err);
    }
    const status = err?.status ?? 1;
    post("session-ended", { status, error: err?.message });
  }
}
