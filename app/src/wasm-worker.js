/**
 * wasm-worker.js — LEGACY old command bridge (persistent-spike artifact)
 *
 * STATUS: legacy / diagnostic-only
 *   - Uses emacs-browser-persistent-spike artifact (batch --eval mode)
 *   - JS constructs Lisp command forms via buildEval() / buildCommandForm()
 *   - Calls wasmacs_eval_string() per editing command (JS owns command semantics)
 *   - wasmacs_last_result() for readback
 *
 * This path is NOT the product editing path.
 * Product editing path: asyncify-minibuffer-worker.js + xterm.js (emacs-input-bytes / terminal-output-bytes)
 *
 * Do NOT call this worker for product input. Use asyncify-minibuffer-worker.js.
 * wasmacs_eval_string / wasmacs_last_result may be retained for diagnostic readback only.
 */

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

let emacsModule;
let emacsReady;

self.onmessage = async (event) => {
  if (event.data?.type === "os-diagnostic-snapshot") {
    await runOsDiagnosticSnapshot(event.data.entries || []);
    return;
  }
  if (event.data?.type === "run-buffer-command") {
    await runEmacsCommand(event.data.entries, event.data.command);
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
  } catch {
    // Existing directories are fine for this materialization pass.
  }
}

function materializeUserImage(module, entries, options = {}) {
  const skipFilePaths = new Set(options.skipFilePaths || []);
  for (const entry of entries.filter((candidate) => candidate.kind === "directory")) {
    ensureDirectory(module, entry.path);
  }
  for (const entry of entries.filter((candidate) => candidate.kind === "file")) {
    if (skipFilePaths.has(entry.path)) continue;
    ensureDirectory(module, parentPath(entry.path));
    try {
      module.FS.unlink(entry.path);
    } catch {
      // Missing files are expected on the first materialization pass.
    }
    try {
      module.FS_createDataFile(parentPath(entry.path), entry.path.slice(entry.path.lastIndexOf("/") + 1), entry.bytes, true, true, true);
    } catch {
      module.FS.writeFile(entry.path, entry.bytes);
    }
  }
}

async function ensureEmacs(userEntries, options = {}) {
  if (emacsReady) {
    await emacsReady;
    materializeUserImage(emacsModule, userEntries, options);
    return emacsModule;
  }

  post("status", { text: "loading persistent emacs package" });
  emacsReady = new Promise((resolve, reject) => {
    var Module = {
      noInitialRun: true,
      thisProgram: "temacs",
      locateFile(path) {
        return `/artifacts/emacs-browser-persistent-spike/${path}`;
      },
      print(text) {
        post("stdout", { text });
      },
      printErr(text) {
        post("stderr", { text });
      },
      onRuntimeInitialized() {
        emacsModule = Module;
        post("status", { text: "persistent emacs runtime initialized" });
        resolve(Module);
      },
    };

    self.Module = Module;

    try {
      importScripts("/artifacts/emacs-browser-persistent-spike/temacs");
    } catch (error) {
      reject(error);
    }
  });

  const module = await emacsReady;
  post("status", { text: "mounting user image" });
  materializeUserImage(module, userEntries);
  const bootCode = module.callMain(["--batch", "--eval", '(princ "boot\\n")']);
  if (bootCode !== 0) throw new Error(`persistent emacs boot exited ${bootCode}`);
  post("status", { text: "persistent emacs booted" });
  return module;
}

async function runEmacsCommand(userEntries, command) {
  try {
    if (command?.type === "process-probe") {
      throw new Error("host.process is unavailable in the browser MVP");
    }
    if (
      command?.type === "clipboard-copy" ||
      command?.type === "clipboard-cut" ||
      command?.type === "clipboard-yank"
    ) {
      throw new Error("clipboard/kill-ring requires GUI clipboard protocol plus persistent region and kill-ring state");
    }
    if (command?.type === "find-file" || command?.type === "switch-buffer") {
      const error = "minibuffer requires persistent Emacs command loop, minibuffer window state, and completion UI";
      postPendingCommand(command, "starting", {
        minibuffer: command.type === "find-file" ? "Find file: " : "Switch to buffer: ",
      });
      postPendingCommand(command, "unavailable", { error });
      throw new Error(error);
    }
    const module = await ensureEmacs(userEntries, { skipFilePaths: [command?.path].filter(Boolean) });
    const evalStatus = module.ccall(
      "wasmacs_eval_string",
      "number",
      ["string"],
      [buildEval(command)],
    );
    if (evalStatus !== 0) {
      const lastResult = module.ccall("wasmacs_last_result", "string", [], []);
      throw new Error(`wasmacs_eval_string returned ${evalStatus}: ${lastResult}`);
    }
    post("sync-file", parseReadback(module.ccall("wasmacs_last_result", "string", [], [])));
    post("exit", { code: 0 });
  } catch (error) {
    post("error", { text: error && error.stack ? error.stack : String(error) });
  }
}

async function runOsDiagnosticSnapshot(userEntries) {
  try {
    const module = await ensureEmacs(userEntries);
    post("os-diagnostic-snapshot", {
      snapshot: readOsDiagnosticSnapshot(module),
    });
  } catch (error) {
    post("error", { text: error && error.stack ? error.stack : String(error) });
  }
}

function readOsDiagnosticSnapshot(module) {
  return {
    lifecycle: parseDiagnosticJson(module.ccall("wasmacs_os_lifecycle_state", "string", [], [])),
    stack: parseDiagnosticJson(module.ccall("wasmacs_os_stack_bounds_probe", "string", [], [])),
    gc: parseDiagnosticJson(module.ccall("wasmacs_os_gc_permission_state", "string", [], [])),
    rootSafety: parseDiagnosticJson(module.ccall("wasmacs_os_root_safety_probe", "string", [], [])),
  };
}

function parseDiagnosticJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return {
      diagnostic: true,
      parseError: String(error),
      raw: String(raw),
    };
  }
}

function buildEval(command = { type: "ensure-marker", path: "/home/user/notes.txt" }) {
  const path = command?.path ?? "/home/user/notes.txt";
  const commandForm = buildCommandForm(command);
  const boundaryForm = needsUndoBoundary(command) ? "    (undo-boundary)" : "";
  const saveForm = shouldSaveBuffer(command) ? "    (when (buffer-modified-p) (save-buffer))" : "";
  return [
    `(let ((path ${quoteElispString(path)}))`,
    "  (find-file path)",
    commandForm,
    boundaryForm,
    saveForm,
    "    (concat path",
    `            ${quoteElispString("\n")}`,
    "            (number-to-string (1- (point)))",
    `            ${quoteElispString("\n")}`,
    "            (buffer-string))))",
  ].filter(Boolean).join(" ");
}

function buildCommandForm(command) {
  const pointForm = `(goto-char (min (point-max) (+ (point-min) ${Math.max(0, Number(command?.pointIndex) || 0)})))`;
  if (command?.type === "insert-text") {
    return `${pointForm} (insert ${quoteElispString(command.text)})`;
  }
  if (command?.type === "backspace") {
    return `${pointForm} (unless (bobp) (delete-char -1))`;
  }
  if (command?.type === "move-point" && command.direction === "left") {
    return `${pointForm} (unless (bobp) (backward-char 1))`;
  }
  if (command?.type === "move-point" && command.direction === "right") {
    return `${pointForm} (unless (eobp) (forward-char 1))`;
  }
  if (command?.type === "save-buffer") {
    return `${pointForm} (save-buffer)`;
  }
  if (command?.type === "undo") {
    return `${pointForm} (undo-only 1)`;
  }
  if (command?.type === "redo") {
    return `${pointForm} (undo-redo 1)`;
  }
  return [
    "(goto-char (point-min))",
    `(unless (search-forward ${quoteElispString("Saved by Emacs core.")} nil t)`,
    "  (goto-char (point-max))",
    `  (insert ${quoteElispString("\nSaved by Emacs core.\n")}))`,
  ].join(" ");
}

function needsUndoBoundary(command) {
  return (
    command?.type === "insert-text" ||
    command?.type === "backspace" ||
    command?.type === "undo" ||
    command?.type === "redo" ||
    command?.type === "ensure-marker"
  );
}

function shouldSaveBuffer(command) {
  return (
    command?.type !== "move-point" &&
    command?.type !== "undo" &&
    command?.type !== "redo"
  );
}

function quoteElispString(value) {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")}"`;
}

function parseReadback(text) {
  const firstNewline = text.indexOf("\n");
  const secondNewline = text.indexOf("\n", firstNewline + 1);
  if (firstNewline < 0 || secondNewline < 0) {
    throw new Error("invalid persistent emacs readback");
  }

  return {
    path: text.slice(0, firstNewline),
    pointIndex: Number.parseInt(text.slice(firstNewline + 1, secondNewline), 10),
    text: text.slice(secondNewline + 1),
  };
}
