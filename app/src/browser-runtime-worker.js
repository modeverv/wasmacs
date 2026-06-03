/**
 * browser-runtime-worker.js — LEGACY old command bridge (pdump-profile artifact)
 *
 * STATUS: legacy / diagnostic-only
 *   - Uses emacs-browser-pdump-profile artifact
 *   - JS builds Lisp eval strings per editing command (JS owns command semantics)
 *   - Calls wasmacs_eval_string() for insert/delete/move/save/undo
 *   - Calls wasmacs_last_result() for buffer readback
 *   - checkMinibufferState() / fetchBufferState() are JS-driven state polling
 *
 * This path is NOT the product editing path.
 * Product editing path: asyncify-minibuffer-worker.js + xterm.js (emacs-input-bytes / terminal-output-bytes)
 *
 * main.js routes frame-grid keydown → this worker for the legacy textarea editor UI.
 * The xterm pane routes keydown → asyncify-minibuffer-worker.js (new path).
 *
 * wasmacs_eval_string / wasmacs_last_result are retained in this file for legacy compatibility.
 * Do NOT add new product editing commands here.
 */

const ARTIFACT_DIR = "/artifacts/emacs-browser-pdump-profile";

class BrowserWorkerHost {
  constructor({ fs, env = {}, cwd = "/home/user", postMessage }) {
    this.fs = fs;
    this.env = { ...env };
    this.currentDirectory = cwd;
    this.postMessage = postMessage;
    this.textDecoder = new TextDecoder();
  }

  wallNowMs() { return Date.now(); }
  monotonicNowMs() { return Math.floor(performance.now()); }
  randomBytes(length) {
    const bytes = new Uint8Array(length);
    self.crypto.getRandomValues(bytes);
    return bytes;
  }
  getenv(name) { return this.env[name]; }
  environ() { return Object.entries(this.env).map(([name, value]) => ({ name, value })); }
  cwd() { return this.currentDirectory; }
  setCwd(path) { this.fs.stat(path); this.currentDirectory = path; }
  stdout(bytes) {
    const text = typeof bytes === "string" ? bytes : this.textDecoder.decode(bytes);
    this.postMessage({ type: "stdout", text });
  }
  stderr(bytes) {
    const text = typeof bytes === "string" ? bytes : this.textDecoder.decode(bytes);
    this.postMessage({ type: "stderr", text });
  }
  debugLog(level, message) { this.postMessage({ type: "debug-log", level, message }); }
  processUnavailable() { return "host.process is unavailable in the browser MVP"; }
}

let emacsModule = null;
let emacsReady;
let emacsBootReady;
let host = null;

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

function postPendingCommand(command, state, details = {}) {
  post("pending-command", {
    id: details.id ?? `${command?.type ?? "command"}:${command?.path ?? ""}`,
    commandType: command?.type ?? "unknown",
    path: command?.path,
    pointIndex: command?.pointIndex,
    state,
    minibuffer: details.minibuffer ?? "",
    result: details.result,
    error: details.error,
  });
}

self.onmessage = async (event) => {
  const { type, command, text, entries } = event.data || {};
  if (type === "run-buffer-command") {
    await runCommand(command, entries);
  }
  if (type === "input-text") {
    injectInputText(text);
  }
  if (type === "emacs-waiting") {
    checkMinibufferState();
  }
};

function parentPath(path) {
  if (path === "/") return "/";
  const index = path.lastIndexOf("/");
  return index === 0 ? "/" : path.slice(0, index);
}

function ensureDirectory(module, path) {
  if (path === "/") return;
  ensureDirectory(module, parentPath(path));
  try {
    module.FS_createPath(parentPath(path), path.slice(path.lastIndexOf("/") + 1), true, true);
  } catch {}
}

function materializeUserImage(module, entries, options = {}) {
  const skipFilePaths = new Set(options.skipFilePaths || []);
  for (const entry of entries.filter((candidate) => candidate.kind === "directory")) {
    ensureDirectory(module, entry.path);
  }
  for (const entry of entries.filter((candidate) => candidate.kind === "file")) {
    if (skipFilePaths.has(entry.path)) continue;
    ensureDirectory(module, parentPath(entry.path));
    try { module.FS.unlink(entry.path); } catch {}
    try {
      module.FS_createDataFile(parentPath(entry.path), entry.path.slice(entry.path.lastIndexOf("/") + 1), entry.bytes, true, true, true);
    } catch {
      module.FS.writeFile(entry.path, entry.bytes);
    }
  }
}

async function ensureEmacs(entries) {
  if (emacsBootReady) {
    await emacsBootReady;
    if (entries) materializeUserImage(emacsModule, entries);
    return emacsModule;
  }

  post("status", { text: "loading emacs package" });
  
  host = new BrowserWorkerHost({
    fs: { stat: () => {} }, // Mock FS for MVP
    env: { HOME: "/home/user" },
    postMessage: (msg) => {
      self.postMessage(msg);
      if (msg.type === "emacs-waiting") {
        checkMinibufferState();
      }
    },
  });

  emacsReady = new Promise((resolve, reject) => {
    var Module = {
      noInitialRun: true,
      thisProgram: "temacs",
      locateFile(path) { return `${ARTIFACT_DIR}/${path}`; },
      print(text) { host.stdout(text); },
      printErr(text) { host.stderr(text); },
      onRuntimeInitialized() {
        emacsModule = Module;
        post("status", { text: "emacs runtime initialized" });
        resolve(Module);
      },
    };
    self.Module = Module;
    try {
      importScripts(`${ARTIFACT_DIR}/temacs`);
    } catch (error) {
      reject(error);
    }
  });

  const module = await emacsReady;
  
  if (entries) materializeUserImage(module, entries);
  
  emacsBootReady = (async () => {
    post("status", { text: "booting emacs..." });
    const bootCode = await module.callMain([
        "--dump-file=/bootstrap-emacs.pdmp",
        "--batch",
        "--eval", '(princ "boot\\n")'
      ]);
    if (bootCode !== 0) throw new Error(`emacs boot exited ${bootCode}`);
    post("status", { text: "emacs booted in batch mode" });
  })();
  try {
    await emacsBootReady;
  } catch (err) {
    post("error", { text: `boot failed: ${err}` });
    throw err;
  }

  return module;
}

function checkMinibufferState() {
  if (!emacsModule) return;
  const minibufferState = emacsModule.ccall("wasmacs_minibuffer_state", "string", [], []);
  const commandState = emacsModule.ccall("wasmacs_command_state", "string", [], []);
  
  if (minibufferState.includes("active:true")) {
    const promptMatch = minibufferState.match(/prompt:(.*?)\n/);
    const inputMatch = minibufferState.match(/input:(.*?)\n/);
    const prompt = promptMatch ? promptMatch[1] : "";
    const input = inputMatch ? inputMatch[1] : "";
    post("pending-command", {
      state: "pending-input",
      minibuffer: prompt + input,
      commandType: "minibuffer-read"
    });
  } else if (commandState === "idle") {
    fetchBufferState();
    post("exit", { code: 0 });
  }
}

function fetchBufferState() {
  if (!emacsModule) return;
  const code = `
    (concat (or (buffer-file-name) "unknown") "\\n"
            (number-to-string (1- (point))) "\\n"
            (buffer-string))
  `;
  const status = emacsModule.ccall("wasmacs_eval_string", "number", ["string"], [code]);
  if (status === 0) {
    const readback = emacsModule.ccall("wasmacs_last_result", "string", [], []);
    const a = readback.indexOf("\n");
    const b = readback.indexOf("\n", a + 1);
    if (a >= 0 && b >= 0) {
      const path = readback.slice(0, a);
      if (!path.startsWith("/home/user/")) return;
      post("sync-file", {
        path,
        pointIndex: parseInt(readback.slice(a + 1, b), 10),
        text: readback.slice(b + 1)
      });
    }
  }
}

function injectInputText(text = "") {
  if (!emacsModule) return;
  const status = emacsModule.ccall(
    "wasmacs_input_text",
    "number",
    ["string"],
    [text]
  );
  if (status === 0 && typeof self.__wasmacsResolveHostInputWait === "function") {
    self.__wasmacsResolveHostInputWait();
  } else if (status !== 0) {
    post("error", { text: `wasmacs_input_text returned ${status}` });
  }
}

async function runCommand(command, entries) {
  try {
    await ensureEmacs(entries);
    
    if (command?.type === "process-probe") {
      throw new Error("host.process is unavailable in the browser MVP");
    }
    if (
      command?.type === "clipboard-copy" ||
      command?.type === "clipboard-cut" ||
      command?.type === "clipboard-yank"
    ) {
      throw new Error("clipboard/kill-ring requires GUI clipboard protocol");
    }
    if (command?.type === "find-file" || command?.type === "switch-buffer") {
      const error = "minibuffer requires persistent Emacs command loop";
      postPendingCommand(command, "starting", {
        minibuffer: command.type === "find-file" ? "Find file: " : "Switch to buffer: "
      });
      postPendingCommand(command, "unavailable", { error });
      throw new Error(error);
    }
    
    if (command?.type === "ensure-marker") {
      fetchBufferState();
      post("exit", { code: 0 });
      return;
    }
    
    let code = "";
    const pt = `(goto-char (min (point-max) (+ (point-min) ${Math.max(0, Number(command?.pointIndex) || 0)})))`;
    if (command?.type === "insert-text") code = `(progn ${pt} (insert "${command.text.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"))`;
    else if (command?.type === "backspace") code = `(progn ${pt} (unless (bobp) (delete-char -1)))`;
    else if (command?.type === "move-point" && command.direction === "left") code = `(progn ${pt} (unless (bobp) (backward-char 1)))`;
    else if (command?.type === "move-point" && command.direction === "right") code = `(progn ${pt} (unless (eobp) (forward-char 1)))`;
    else if (command?.type === "save-buffer") code = `(progn ${pt} (save-buffer))`;
    else if (command?.type === "undo") code = `(progn ${pt} (undo-only 1))`;
    
    if (code) {
      emacsModule.ccall("wasmacs_eval_string", "number", ["string"], [code]);
      fetchBufferState();
      post("exit", { code: 0 });
    } else {
      post("error", { text: `unsupported command ${command?.type}` });
    }
  } catch (error) {
    post("error", { text: error && error.stack ? error.stack : String(error) });
  }
}
