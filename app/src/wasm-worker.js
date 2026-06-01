function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

const syncPath = "/home/user/notes.txt";
const syncBegin = "WASMACS_SYNC_BEGIN";
const syncEnd = "WASMACS_SYNC_END";
const pointMarker = "WASMACS_POINT:";

let stdoutText = "";

self.onmessage = (event) => {
  if (event.data?.type === "run-buffer-command") {
    startEmacs(event.data.entries, event.data.command);
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

function materializeUserImage(module, entries) {
  for (const entry of entries.filter((candidate) => candidate.kind === "directory")) {
    ensureDirectory(module, entry.path);
  }
  for (const entry of entries.filter((candidate) => candidate.kind === "file")) {
    ensureDirectory(module, parentPath(entry.path));
    try {
      module.FS_createDataFile(parentPath(entry.path), entry.path.slice(entry.path.lastIndexOf("/") + 1), entry.bytes, true, true, true);
    } catch {
      // The current proof starts once per worker, so collisions should only
      // happen after retries inside the same worker.
    }
  }
}

function startEmacs(userEntries, command) {
  post("status", { text: "loading emacs package" });
  stdoutText = "";

  var Module = {
    arguments: [
      "--batch",
      "--eval",
      buildEval(command),
    ],
    thisProgram: "temacs",
    locateFile(path) {
      return `/artifacts/emacs-browser-spike/${path}`;
    },
    preRun: [
      () => {
        post("status", { text: "mounting user image" });
        materializeUserImage(Module, userEntries);
      },
    ],
    print(text) {
      stdoutText += `${text}\n`;
      post("stdout", { text });
    },
    printErr(text) {
      post("stderr", { text });
    },
    onRuntimeInitialized() {
      post("status", { text: "emacs runtime initialized" });
    },
    onExit(code) {
      const synced = parseSyncedFile(stdoutText);
      if (synced) post("sync-file", synced);
      post("exit", { code });
    },
  };

  self.Module = Module;

  try {
    importScripts("/artifacts/emacs-browser-spike/temacs");
  } catch (error) {
    post("error", { text: error && error.stack ? error.stack : String(error) });
  }
}

function buildEval(command = { type: "ensure-marker", path: syncPath }) {
  const commandForm = buildCommandForm(command);
  return [
    `(let ((path ${quoteElispString(syncPath)}))`,
    "  (with-temp-buffer",
    "    (insert-file-contents path)",
    commandForm,
    "    (write-region (point-min) (point-max) path nil 'silent)",
    `    (princ ${quoteElispString(`WASMACS_SYNC_FILE:${syncPath}\n`)})`,
    `    (princ ${quoteElispString(pointMarker)})`,
    "    (princ (number-to-string (1- (point))))",
    `    (princ ${quoteElispString("\n")})`,
    `    (princ ${quoteElispString(`${syncBegin}\n`)})`,
    "    (princ (buffer-string))",
    `    (princ ${quoteElispString(`${syncEnd}\n`)})))`,
  ].join(" ");
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
  return [
    "(goto-char (point-min))",
    `(unless (search-forward ${quoteElispString("Saved by Emacs core.")} nil t)`,
    "  (goto-char (point-max))",
    `  (insert ${quoteElispString("\nSaved by Emacs core.\n")}))`,
  ].join(" ");
}

function quoteElispString(value) {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")}"`;
}

function parseSyncedFile(text) {
  const fileMarker = `WASMACS_SYNC_FILE:${syncPath}`;
  const fileIndex = text.indexOf(fileMarker);
  const beginIndex = text.indexOf(`${syncBegin}\n`, fileIndex);
  const endIndex = text.indexOf(syncEnd, beginIndex);
  const pointIndex = parsePointIndex(text, fileIndex);
  if (fileIndex < 0 || beginIndex < 0 || endIndex < 0) return undefined;

  return {
    path: syncPath,
    pointIndex,
    text: text.slice(beginIndex + syncBegin.length + 1, endIndex),
  };
}

function parsePointIndex(text, fileIndex) {
  const markerIndex = text.indexOf(pointMarker, fileIndex);
  if (markerIndex < 0) return undefined;
  const lineEnd = text.indexOf("\n", markerIndex);
  const raw = text.slice(markerIndex + pointMarker.length, lineEnd < 0 ? undefined : lineEnd);
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
