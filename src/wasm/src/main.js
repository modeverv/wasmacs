import { createXtermEmacsTerminal, xtermDataToBytes } from "./xterm-emacs-terminal.js";
import { BrowserUserImage } from "./browser-wasifs.js";
import { isEditorModified } from "./buffer-dirty.js";
import { coalesceBufferCommand } from "./command-queue.js";
import { keyEventToBufferCommand, nextPointIndexForCommand, validateBufferCommand } from "./input-protocol.js";
import { minibufferTextForPrefix, minibufferTextForWorkerError } from "./minibuffer-view.js";
import { pendingCommandStatusText, validatePendingCommandMessage } from "./pending-command-protocol.js";
import { textToGridDrawMessage, validateTextGridDrawMessage } from "./redisplay-protocol.js";
import { createBrowserSmallOsCoordinator } from "./small-os-runtime.js";
import { SmallOsOperations } from "./small-os-services.js";
import { userFileLabel, visibleUserFilePaths } from "./user-file-list.js";
import { normalizeUserPath } from "./user-path.js";

const output = document.querySelector("#output");
const status = document.querySelector("#status");
const runButton = document.querySelector("#run");
const openButton = document.querySelector("#open-file");
const saveButton = document.querySelector("#save");
const reloadButton = document.querySelector("#reload-buffer");
const processProbeButton = document.querySelector("#process-probe");
const exportButton = document.querySelector("#export-image");
const importInput = document.querySelector("#import-image");
const filePathInput = document.querySelector("#file-path");
const editor = document.querySelector("#editor");
const bufferPathLabel = document.querySelector("#buffer-path");
const bufferState = document.querySelector("#buffer-state");
const fileList = document.querySelector("#file-list");
const frameGrid = document.querySelector("#frame-grid");
const minibuffer = document.querySelector("#minibuffer");

const xtermContainer = document.querySelector("#xterm-container");
const xtermStatusEl = document.querySelector("#xterm-status");
const startXtermSessionButton = document.querySelector("#start-xterm-session");

let xtermWorker = null;
let xtermTerminal = null;

function setXtermStatus(text) {
  if (xtermStatusEl) xtermStatusEl.textContent = text;
}

function startXtermSession() {
  if (xtermWorker) return;
  if (!xtermTerminal) {
    try {
      xtermTerminal = createXtermEmacsTerminal(xtermContainer);
      xtermTerminal.onData((data) => {
        if (!xtermWorker) return;
        xtermWorker.postMessage({ type: "emacs-input-bytes", bytes: xtermDataToBytes(data) });
      });
    } catch (err) {
      setXtermStatus(`xterm init failed: ${err.message}`);
      return;
    }
  }

  xtermWorker = new Worker("/app/src/asyncify-minibuffer-worker.js");
  setXtermStatus("loading…");

  xtermWorker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === "terminal-output-bytes" && xtermTerminal) {
      xtermTerminal.writeBytes(msg.bytes);
      // First output bytes → session is live; update status if not yet interactive
      const cur = xtermStatusEl?.textContent ?? "";
      if (cur.startsWith("loading") || cur.startsWith("starting Emacs") || cur.startsWith("loadup:")) {
        setXtermStatus("running");
      }
    }
    if (msg.type === "status") setXtermStatus(msg.text);
    if (msg.type === "xterm-session-started") setXtermStatus("loading…");
    if (msg.type === "xterm-session-at-wait") setXtermStatus("interactive");
    if (msg.type === "stderr" && /^Loading /.test(msg.text ?? "")) {
      setXtermStatus(`loadup: ${(msg.text ?? "").slice(8, 60)}`);
    }
    if (msg.type === "xterm-session-returned") {
      const err = msg.error ? ` — ${msg.error.slice(0, 80)}` : "";
      setXtermStatus(`session ended (status ${msg.status ?? "?"}${err}`);
      xtermWorker = null;
      if (startXtermSessionButton) startXtermSessionButton.disabled = false;
    }
    if (msg.type === "xterm-session-error") {
      setXtermStatus(`session error: ${(msg.error ?? "unknown").slice(0, 80)}`);
    }
  };

  xtermWorker.onerror = (event) => {
    setXtermStatus(`worker error: ${event.message}`);
    xtermWorker = null;
    if (startXtermSessionButton) startXtermSessionButton.disabled = false;
  };

  xtermWorker.postMessage({ type: "start-xterm-session" });
  if (startXtermSessionButton) startXtermSessionButton.disabled = true;
}

if (startXtermSessionButton) {
  startXtermSessionButton.addEventListener("click", startXtermSession);
}

const defaultBufferPath = "/home/user/notes.txt";
const storageKey = "wasmacs:user-filesystem.wasifs:v1";
const defaultText = [
  "Welcome to wasmacs.",
  "",
  "This is the first browser-hosted buffer adapter.",
  "It is backed by /home/user/notes.txt in the MVP host filesystem shim.",
  "",
].join("\n");

const searchParams = new URLSearchParams(window.location.search);
if (searchParams.has("clear-storage")) {
  localStorage.removeItem(storageKey);
}

let worker;
let savedText = "";
let userImage;
let commandInFlight = false;
let commandQueue = [];
let pendingWorkerSyncFile;
let pointIndex = 0;
let bufferPath = defaultBufferPath;
let keyPrefix;
let lastRealUndoSmoke;
let lastRepeatedUndoSmoke;
let lastRedoSmoke;
let lastAsyncifyMinibufferReadSmoke;
let lastAsyncifyNoLoadupBootSmoke;
let pendingCommandEvents = [];
const smallOs = createBrowserSmallOsCoordinator();
const idleWaiters = [];

async function loadUserImage() {
  const saved = localStorage.getItem(storageKey);
  if (saved) return BrowserUserImage.fromBase64(saved);

  const response = await fetch("/artifacts/user-filesystem-empty.wasifs");
  if (!response.ok) throw new Error(`failed to load user image: ${response.status}`);
  return BrowserUserImage.fromBytes(new Uint8Array(await response.arrayBuffer()));
}

function setBufferState(text) {
  bufferState.textContent = text;
}

function userFilePaths() {
  return visibleUserFilePaths(userImage.entries());
}

function renderUserFileList() {
  if (!userImage) return;
  const paths = userFilePaths();
  if (paths.length === 0) {
    fileList.replaceChildren();
    return;
  }

  fileList.replaceChildren(...paths.map((path) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = userFileLabel(path);
    button.dataset.path = path;
    if (path === bufferPath) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => switchBuffer(path));
    return button;
  }));
}

function defaultTextForPath(path) {
  return path === defaultBufferPath ? defaultText : "";
}

async function loadBuffer(path = bufferPath) {
  if (!userImage) userImage = await loadUserImage();
  bufferPath = normalizeUserPath(path);
  filePathInput.value = bufferPath;
  bufferPathLabel.textContent = bufferPath;
  savedText = userImage.readText(bufferPath, defaultTextForPath(bufferPath));
  if (savedText === defaultTextForPath(bufferPath)) {
    userImage.writeText(bufferPath, savedText);
  }
  editor.value = savedText;
  pointIndex = savedText.length;
  renderTextGrid(textToGridDrawMessage({ path: bufferPath, pointIndex, text: savedText }));
  renderUserFileList();
  setMinibuffer("");
  setBufferState("loaded");
}

function persistEditorIfModified() {
  if (!userImage || !isEditorModified(savedText, editor.value)) return false;
  userImage.writeText(bufferPath, editor.value);
  localStorage.setItem(storageKey, userImage.toBase64());
  savedText = editor.value;
  pointIndex = Math.min(pointIndex, savedText.length);
  renderUserFileList();
  setBufferState("autosaved");
  return true;
}

async function switchBuffer(path) {
  persistEditorIfModified();
  commandQueue = [];
  await loadBuffer(path);
}

async function openBufferFromInput() {
  try {
    persistEditorIfModified();
    await loadBuffer(filePathInput.value);
    commandQueue = [];
  } catch (error) {
    setStatus("open failed");
    appendLine(error && error.message ? error.message : String(error));
  }
}

function saveBuffer() {
  userImage.writeText(bufferPath, editor.value);
  localStorage.setItem(storageKey, userImage.toBase64());
  savedText = editor.value;
  pointIndex = Math.min(pointIndex, savedText.length);
  renderTextGrid(textToGridDrawMessage({ path: bufferPath, pointIndex, text: savedText }));
  renderUserFileList();
  setBufferState("saved");
}

function exportUserImage() {
  saveBuffer();
  const blob = new Blob([userImage.toBytes()], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "user-filesystem.wasifs";
  link.click();
  URL.revokeObjectURL(url);
}

async function importUserImage(file) {
  userImage = BrowserUserImage.fromBytes(new Uint8Array(await file.arrayBuffer()));
  localStorage.setItem(storageKey, userImage.toBase64());
  await loadBuffer(bufferPath);
}

function appendLine(line) {
  output.textContent += `${line}\n`;
  output.scrollTop = output.scrollHeight;
}

function setStatus(text) {
  status.textContent = text;
}

function setMinibuffer(text = "") {
  minibuffer.textContent = text;
}

function notifyIdleWaiters() {
  if (commandInFlight || commandQueue.length > 0) return;
  while (idleWaiters.length > 0) {
    idleWaiters.shift()();
  }
}

function waitForIdle(timeoutMs = 300_000) {
  if (!commandInFlight && commandQueue.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = idleWaiters.indexOf(done);
      if (index >= 0) idleWaiters.splice(index, 1);
      reject(new Error("timed out waiting for wasmacs command queue to become idle"));
    }, timeoutMs);
    function done() {
      clearTimeout(timeout);
      resolve();
    }
    idleWaiters.push(done);
  });
}

function renderTextGrid(message) {
  if (!validateTextGridDrawMessage(message)) {
    throw new Error("invalid text grid draw message");
  }
  const rows = message.rows.map((row, index) => {
    const line = document.createElement("div");
    line.className = "frame-row";
    if (index === message.point.row) {
      const before = row.slice(0, message.point.column);
      const cursorChar = row[message.point.column] || " ";
      const after = row.slice(message.point.column + 1);
      line.append(before);
      const cursor = document.createElement("span");
      cursor.className = "frame-cursor";
      cursor.textContent = cursorChar;
      line.append(cursor, after);
    } else {
      line.textContent = row || " ";
    }
    return line;
  });
  frameGrid.replaceChildren(...rows);
  frameGrid.dataset.modeLine = message.modeLine;
}

function stopWorker() {
  if (worker) worker.terminate();
  worker = undefined;
}

function enqueueBufferCommand(command = { type: "ensure-marker", path: bufferPath }) {
  if (command.type === "key-prefix") {
    keyPrefix = command.prefix;
    setStatus(command.prefix);
    setMinibuffer(minibufferTextForPrefix(command.prefix));
    setBufferState(`prefix ${command.prefix}`);
    return;
  }
  if (!validateBufferCommand(command)) {
    throw new Error("invalid buffer command");
  }
  keyPrefix = undefined;
  if (command.type === "keyboard-quit") {
    commandQueue = [];
    setMinibuffer("Quit");
    setStatus("keyboard quit");
    setBufferState(commandInFlight ? "keyboard quit (after current command)" : "keyboard quit");
    runButton.disabled = commandInFlight;
    return;
  }
  commandQueue = coalesceBufferCommand(commandQueue, command);
  runNextBufferCommand();
}

function runNextBufferCommand() {
  if (commandInFlight || commandQueue.length === 0) return;
  const command = commandQueue.shift();
  commandInFlight = true;
  runWorkerCommand(command);
}

// [LEGACY] runWorkerCommand uses browser-runtime-worker.js (old command bridge).
// JS constructs Lisp command forms; this path is retained for the textarea/frame-grid legacy UI.
// Product editing: use the xterm pane (startXtermSession → asyncify-minibuffer-worker.js).
function runWorkerCommand(command) {
  output.textContent = "";
  if (command.type !== "key-prefix") setMinibuffer("");
  setStatus("running emacs command");
  setBufferState(commandQueue.length > 0 ? `running command (${commandQueue.length} queued)` : "running command");
  runButton.disabled = true;
  smallOs.beginCommand(command, SmallOsOperations.filesystemReverseSync.id);
  pendingWorkerSyncFile = undefined;

  if (!worker) {
    worker = new Worker("/app/src/browser-runtime-worker.js", { type: "classic" });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = handleWorkerError;
  }
  worker.postMessage({
    type: "run-buffer-command",
    command,
    entries: userImage.entries(),
  });
}

function handleWorkerMessage(event) {
  const message = event.data;
  if (message.type === "status") setStatus(message.text);
  if (message.type === "stdout") appendLine(message.text);
  if (message.type === "stderr") appendLine(message.text);
  if (message.type === "pending-command") handlePendingCommandMessage(message);
  if (message.type === "sync-file") {
    pendingWorkerSyncFile = message;
  }
  if (message.type === "exit") {
    let exitError;
    let didSync = false;
    try {
      smallOs.finishCommand({ allowReverseSync: message.code === 0 });
      if (message.code === 0 && pendingWorkerSyncFile) {
        applyWorkerSyncFile(pendingWorkerSyncFile);
        didSync = true;
      }
    } catch (error) {
      exitError = error;
      appendLine(`worker exit handling failed: ${error && error.message ? error.message : String(error)}`);
    } finally {
      pendingWorkerSyncFile = undefined;
      commandInFlight = false;
    }
    setStatus(exitError ? "worker exit handling failed" : message.code === 0 ? "emacs command completed" : `emacs command exited ${message.code}`);
    if (exitError) setBufferState("worker exit handling failed");
    else if (!didSync) setBufferState(message.code === 0 ? "emacs command completed" : `emacs command exited ${message.code}`);
    runButton.disabled = commandQueue.length > 0;
    runNextBufferCommand();
    if (commandQueue.length === 0 && !commandInFlight) runButton.disabled = false;
    notifyIdleWaiters();
  }
  if (message.type === "error") {
    const undoUnavailable = message.text.includes("undo requires persistent Emacs buffers");
    const clipboardUnavailable = message.text.includes("clipboard/kill-ring requires GUI clipboard protocol");
    const minibufferUnavailable = message.text.includes("minibuffer requires persistent Emacs command loop");
    const processUnavailable = message.text.includes("host.process");
    setMinibuffer(minibufferTextForWorkerError(message.text));
    setStatus(undoUnavailable ? "undo unavailable" : clipboardUnavailable ? "clipboard unavailable" : minibufferUnavailable ? "minibuffer unavailable" : processUnavailable ? "process unavailable" : "worker error");
    setBufferState(undoUnavailable ? "undo unavailable" : clipboardUnavailable ? "clipboard unavailable" : minibufferUnavailable ? "minibuffer unavailable" : processUnavailable ? "process unavailable" : "worker error");
    appendLine(message.text);
    smallOs.failCommand(new Error(message.text));
    pendingWorkerSyncFile = undefined;
    commandInFlight = false;
    runButton.disabled = false;
    stopWorker();
    notifyIdleWaiters();
  }
}

function handlePendingCommandMessage(message) {
  if (!validatePendingCommandMessage(message)) return;
  if (message.state === "pending-input") smallOs.enterPendingInput();
  if (message.state === "resuming") smallOs.resumeCommand();
  if (["completed", "cancelled", "failed", "unavailable"].includes(message.state)) {
    smallOs.finishCommand({ allowReverseSync: false, diagnostic: message.error });
  }
  pendingCommandEvents.push({
    id: message.id,
    commandType: message.commandType,
    path: message.path,
    state: message.state,
    minibuffer: message.minibuffer,
    result: message.result,
    error: message.error,
  });
  setStatus(pendingCommandStatusText(message));
  if (message.minibuffer) setMinibuffer(message.minibuffer);
  if (message.state === "unavailable" && message.error) {
    setMinibuffer(minibufferTextForWorkerError(message.error));
  }
}

function applyWorkerSyncFile(message) {
  smallOs.assertReverseSyncAllowed();
  userImage.writeText(message.path, message.text);
  localStorage.setItem(storageKey, userImage.toBase64());
  if (message.path === bufferPath) {
    savedText = message.text;
    editor.value = message.text;
    pointIndex = Number.isInteger(message.pointIndex) ? message.pointIndex : message.text.length;
    renderTextGrid(textToGridDrawMessage({ path: message.path, pointIndex, text: message.text }));
    renderUserFileList();
    setBufferState("synced from emacs");
  }
}

function handleWorkerError(event) {
  setStatus("worker error");
  appendLine(event.message);
  commandInFlight = false;
  runButton.disabled = false;
  stopWorker();
  notifyIdleWaiters();
}

runButton.addEventListener("click", () => enqueueBufferCommand());
openButton.addEventListener("click", openBufferFromInput);
filePathInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  openBufferFromInput();
});
saveButton.addEventListener("click", saveBuffer);
reloadButton.addEventListener("click", async () => {
  userImage = await loadUserImage();
  await loadBuffer(bufferPath);
});
processProbeButton.addEventListener("click", () => {
  enqueueBufferCommand({ type: "process-probe", path: bufferPath, pointIndex });
});
exportButton.addEventListener("click", exportUserImage);
importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  if (!file) return;
  await importUserImage(file);
  importInput.value = "";
});
editor.addEventListener("input", () => {
  setBufferState(editor.value === savedText ? "saved" : "modified");
});

function handleFrameKey(event) {
  const command = keyEventToBufferCommand({
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    isComposing: event.isComposing,
    key: event.key,
    metaKey: event.metaKey,
    path: bufferPath,
    pointIndex,
    prefix: keyPrefix,
  });
  if (!command) return;

  event.preventDefault();
  enqueueBufferCommand(command);
  pointIndex = nextPointIndexForCommand(pointIndex, command, savedText.length);
}

frameGrid.addEventListener("keydown", handleFrameKey);

window.addEventListener("message", (event) => {
  if (event.data?.type !== "wasmacs-smoke-key") return;
  handleFrameKey({
    altKey: Boolean(event.data.altKey),
    ctrlKey: Boolean(event.data.ctrlKey),
    isComposing: Boolean(event.data.isComposing),
    key: event.data.key,
    metaKey: Boolean(event.data.metaKey),
    preventDefault() {},
  });
});

window.__wasmacsSmoke = {
  async resetFile(path, text = "") {
    if (!userImage) userImage = await loadUserImage();
    const normalizedPath = normalizeUserPath(path);
    userImage.writeText(normalizedPath, text);
    localStorage.setItem(storageKey, userImage.toBase64());
    await loadBuffer(normalizedPath);
    return this.state();
  },
  async open(path) {
    persistEditorIfModified();
    commandQueue = [];
    await loadBuffer(path);
    userImage.writeText(bufferPath, savedText);
    localStorage.setItem(storageKey, userImage.toBase64());
    renderUserFileList();
    return this.state();
  },
  async switchBuffer(path) {
    await switchBuffer(path);
    return this.state();
  },
  setTextarea(text) {
    editor.value = text;
    setBufferState(editor.value === savedText ? "saved" : "modified");
    return this.state();
  },
  save() {
    saveBuffer();
    return this.state();
  },
  async reload() {
    userImage = await loadUserImage();
    await loadBuffer(bufferPath);
    return this.state();
  },
  async ensureMarker() {
    enqueueBufferCommand();
    await this.waitForIdle();
    return this.state();
  },
  async processProbe() {
    enqueueBufferCommand({ type: "process-probe", path: bufferPath, pointIndex });
    await this.waitForIdle();
    return this.state();
  },
  files() {
    return Array.from(fileList.querySelectorAll("button")).map((button) => ({
      current: button.getAttribute("aria-current") === "true",
      path: button.dataset.path,
      text: button.textContent,
    }));
  },
  keydown(event) {
    handleFrameKey({
      altKey: Boolean(event?.altKey),
      ctrlKey: Boolean(event?.ctrlKey),
      isComposing: Boolean(event?.isComposing),
      key: event?.key,
      metaKey: Boolean(event?.metaKey),
      preventDefault() {},
    });
  },
  pendingCommandEvents() {
    return pendingCommandEvents.slice();
  },
  clearPendingCommandEvents() {
    pendingCommandEvents = [];
    return pendingCommandEvents;
  },
  async waitForIdle(timeoutMs) {
    await waitForIdle(timeoutMs);
    return this.state();
  },
  async realUndoSmoke() {
    const path = `/home/user/projects/real-undo-ui-${Date.now()}.txt`;
    await this.resetFile(path, "");
    this.keydown({ key: "U" });
    await this.waitForIdle();
    const afterInsert = this.state();
    this.keydown({ ctrlKey: true, key: "/" });
    await this.waitForIdle();
    const afterUndo = this.state();
    lastRealUndoSmoke = {
      afterInsert,
      afterUndo,
      passed: (afterInsert.text === "U" || afterInsert.text === "U\n") &&
        afterInsert.status === "emacs command completed" &&
        afterUndo.text === "" &&
        afterUndo.status === "emacs command completed" &&
        afterUndo.state === "synced from emacs",
    };
    appendLine(`REAL_UNDO_UI_SMOKE:${lastRealUndoSmoke.passed ? "PASS" : "FAIL"}`);
    return lastRealUndoSmoke;
  },
  async repeatedUndoSmoke() {
    const path = `/home/user/projects/repeated-undo-ui-${Date.now()}.txt`;
    await this.resetFile(path, "");
    this.keydown({ key: "A" });
    await this.waitForIdle();
    const afterInsertA = this.state();
    this.keydown({ key: "B" });
    await this.waitForIdle();
    const afterInsertB = this.state();
    this.keydown({ ctrlKey: true, key: "/" });
    await this.waitForIdle();
    const afterUndo1 = this.state();
    this.keydown({ ctrlKey: true, key: "/" });
    await this.waitForIdle();
    const afterUndo2 = this.state();
    lastRepeatedUndoSmoke = {
      afterInsertA,
      afterInsertB,
      afterUndo1,
      afterUndo2,
      passed: (afterInsertA.text === "A" || afterInsertA.text === "A\n") &&
        (afterInsertB.text === "AB" || afterInsertB.text === "AB\n") &&
        (afterUndo1.text === "A" || afterUndo1.text === "A\n") &&
        afterUndo1.status === "emacs command completed" &&
        afterUndo2.text === "" &&
        afterUndo2.status === "emacs command completed" &&
        afterUndo2.state === "synced from emacs",
    };
    appendLine(`REPEATED_UNDO_UI_SMOKE:${lastRepeatedUndoSmoke.passed ? "PASS" : "FAIL"}`);
    return lastRepeatedUndoSmoke;
  },
  async redoSmoke() {
    const path = `/home/user/projects/redo-ui-${Date.now()}.txt`;
    await this.resetFile(path, "");
    this.keydown({ key: "A" });
    await this.waitForIdle();
    const afterInsert = this.state();
    this.keydown({ ctrlKey: true, key: "/" });
    await this.waitForIdle();
    const afterUndo = this.state();
    this.keydown({ ctrlKey: true, key: "?" });
    await this.waitForIdle();
    const afterRedo = this.state();
    lastRedoSmoke = {
      afterInsert,
      afterUndo,
      afterRedo,
      passed: (afterInsert.text === "A" || afterInsert.text === "A\n") &&
        afterUndo.text === "" &&
        afterUndo.status === "emacs command completed" &&
        (afterRedo.text === "A" || afterRedo.text === "A\n") &&
        afterRedo.status === "emacs command completed" &&
        afterRedo.state === "synced from emacs",
    };
    appendLine(`REDO_UI_SMOKE:${lastRedoSmoke.passed ? "PASS" : "FAIL"}`);
    return lastRedoSmoke;
  },
	  async asyncifyMinibufferReadSmoke(text = "wasmacs-input.txt") {
	    pendingCommandEvents = [];
	    setStatus("starting asyncify minibuffer");
	    setMinibuffer("");
	    smallOs.beginCommand(
	      { type: "minibuffer-read", path: bufferPath, pointIndex },
	      SmallOsOperations.pendingCommandProtocol.id,
	    );
	    const asyncifyWorker = new Worker("/app/src/asyncify-minibuffer-worker.js");
	    let inputSent = false;
    lastAsyncifyMinibufferReadSmoke = await new Promise((resolve) => {
	      const timeout = setTimeout(() => {
	        asyncifyWorker.terminate();
	        smallOs.failCommand(new Error("timed out waiting for asyncify minibuffer read"));
	        resolve({
	          passed: false,
          error: "timed out waiting for asyncify minibuffer read",
          events: pendingCommandEvents.slice(),
        });
      }, 300_000);

      asyncifyWorker.onmessage = (event) => {
        const message = event.data;
        if (message.type === "stdout") appendLine(message.text);
        if (message.type === "stderr") appendLine(message.text);
        if (message.type === "status") {
          setStatus(message.text);
          appendLine(`ASYNCIFY_INTERACTIVE_LOOP_STATUS:${message.text}`);
        }
        if (message.type === "pending-command") {
          handlePendingCommandMessage(message);
          if (message.state === "pending-input" && !inputSent) {
            inputSent = true;
            asyncifyWorker.postMessage({ type: "input-text", text });
          }
        }
        if (message.type === "asyncify-minibuffer-result") {
          clearTimeout(timeout);
          asyncifyWorker.terminate();
          resolve({
            ...message,
            events: pendingCommandEvents.slice(),
            state: this.state(),
          });
        }
      };

	      asyncifyWorker.onerror = (event) => {
	        clearTimeout(timeout);
	        asyncifyWorker.terminate();
	        smallOs.failCommand(new Error(event.message));
	        resolve({
          passed: false,
          error: event.message,
          events: pendingCommandEvents.slice(),
        });
      };

      asyncifyWorker.postMessage({
        type: "start-minibuffer-read",
        command: { type: "minibuffer-read", path: bufferPath, pointIndex },
      });
    });
    appendLine(`ASYNCIFY_MINIBUFFER_READ_SMOKE:${lastAsyncifyMinibufferReadSmoke.passed ? "PASS" : "FAIL"}`);
    return lastAsyncifyMinibufferReadSmoke;
  },
  async asyncifyNoLoadupBootSmoke() {
    const asyncifyWorker = new Worker("/app/src/asyncify-minibuffer-worker.js");
    lastAsyncifyNoLoadupBootSmoke = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        asyncifyWorker.terminate();
        resolve({ passed: false, error: "timed out waiting for asyncify no-loadup boot probe" });
      }, 120_000);

      asyncifyWorker.onmessage = (event) => {
        const message = event.data;
        if (message.type === "stdout") appendLine(message.text);
        if (message.type === "stderr") appendLine(message.text);
        if (message.type === "status") {
          setStatus(message.text);
          appendLine(`ASYNCIFY_INTERACTIVE_SEMANTICS_STATUS:${message.text}`);
        }
        if (message.type === "asyncify-boot-probe-result") {
          clearTimeout(timeout);
          asyncifyWorker.terminate();
          resolve(message);
        }
      };

      asyncifyWorker.onerror = (event) => {
        clearTimeout(timeout);
        asyncifyWorker.terminate();
        resolve({ passed: false, error: event.message });
      };

      asyncifyWorker.postMessage({ type: "boot-probe", noLoadup: true });
    });
    appendLine(`ASYNCIFY_NO_LOADUP_BOOT_SMOKE:${lastAsyncifyNoLoadupBootSmoke.passed ? "PASS" : "FAIL"}`);
    return lastAsyncifyNoLoadupBootSmoke;
  },
  async asyncifyInteractiveLoopProbeSmoke() {
    const asyncifyWorker = new Worker("/app/src/asyncify-minibuffer-worker.js");
    const result = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        asyncifyWorker.terminate();
        resolve({ passed: false, error: "timed out waiting for asyncify interactive loop probe" });
      }, 120_000);

      asyncifyWorker.onmessage = (event) => {
        const message = event.data;
        if (message.type === "stdout") appendLine(message.text);
        if (message.type === "stderr") appendLine(message.text);
        if (message.type === "status") setStatus(message.text);
        if (message.type === "asyncify-interactive-loop-probe-result") {
          clearTimeout(timeout);
          asyncifyWorker.terminate();
          resolve(message);
        }
      };

      asyncifyWorker.onerror = (event) => {
        clearTimeout(timeout);
        asyncifyWorker.terminate();
        resolve({ passed: false, error: event.message });
      };

      asyncifyWorker.postMessage({ type: "interactive-loop-probe" });
    });
    appendLine(`ASYNCIFY_INTERACTIVE_LOOP_PROBE:${result.passed ? "PASS" : "FAIL"}`);
    return result;
  },
  async asyncifyInteractiveSemanticsProbeSmoke() {
    const asyncifyWorker = new Worker("/app/src/asyncify-minibuffer-worker.js");
    const result = await new Promise((resolve) => {
      const terminalBytes = [];
      const outputLines = [];
      const steps = [];
      const script = [
        { name: "insert-printable", bytes: "abc" },
        { name: "undo", bytes: [31] },
        { name: "find-file-prefix", bytes: [24, 6] },
        { name: "find-file-submit", bytes: "wasmacs-real-route.txt\r" },
        { name: "split-window", bytes: [24, 50] },
      ];
      let waitEvents = 0;
      let finished = false;

      const terminalText = () => String.fromCharCode(...terminalBytes.slice(-40000));
      const finish = (message) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        asyncifyWorker.terminate();
        resolve(message);
      };
      const completeIfDone = () => {
        if (waitEvents <= script.length) return;
        const text = terminalText();
        const afterInsert = steps.find((step) => step.name === "after-insert-printable");
        const afterUndo = steps.find((step) => step.name === "after-undo");
        const afterFindFile = steps.find((step) => step.name === "after-find-file-submit");
        const afterSplit = steps.find((step) => step.name === "after-split-window");
        const abortOutput = outputLines.filter((line) => /Aborted|OOM/i.test(line));
        const checks = {
          commandLoopReached: waitEvents >= 1 && /\*scratch\*/.test(text),
          printableInserted: /abc/.test(afterInsert?.text || text),
          undoRedisplayed: (afterUndo?.byteCount || 0) > (afterInsert?.byteCount || 0),
          minibufferOwnedByEmacs: /Find file:/.test(text),
          findFileSelectedBuffer: /wasmacs-real-route\.txt/.test(afterFindFile?.text || text),
          splitWindowRedisplayed: (afterSplit?.byteCount || 0) > (afterFindFile?.byteCount || 0),
          terminalOutputObserved: terminalBytes.length > 0,
          noAbort: abortOutput.length === 0,
        };
        finish({
          type: "asyncify-interactive-semantics-probe-result",
          passed: Object.values(checks).every(Boolean),
          checks,
          waitEvents,
          steps,
          abortOutput,
          terminalTextTail: text.slice(-2000),
          terminalBytes: terminalBytes.slice(-240),
          output: outputLines.slice(-80),
          note: "main thread drove terminal bytes through the real Emacs command loop; browser did not emulate minibuffer, undo, buffer, or window semantics",
        });
      };

      const timeout = setTimeout(() => {
        finish({
          passed: false,
          error: "timed out waiting for asyncify interactive semantics probe",
          waitEvents,
          steps,
          terminalTextTail: terminalText().slice(-2000),
          output: outputLines.slice(-80),
        });
      }, 300_000);

      asyncifyWorker.onmessage = (event) => {
        const message = event.data;
        if (message.type === "stdout") appendLine(message.text);
        if (message.type === "stderr") appendLine(message.text);
        if (message.type === "stdout") outputLines.push(`OUT:${message.text}`);
        if (message.type === "stderr") {
          outputLines.push(`ERR:${message.text}`);
          if (/Aborted|OOM/i.test(message.text)) {
            finish({
              passed: false,
              error: `asyncify interactive semantics aborted: ${message.text}`,
              waitEvents,
              steps,
              terminalTextTail: terminalText().slice(-2000),
              output: outputLines.slice(-80),
            });
          }
        }
        if (message.type === "terminal-output") {
          terminalBytes.push(...(message.bytes || []));
        }
        if (message.type === "status") {
          setStatus(message.text);
          outputLines.push(`STATUS:${message.text}`);
        }
        if (message.type === "interactive-command-loop-returned") {
          outputLines.push(`RETURNED:${JSON.stringify(message)}`);
        }
        if (message.type === "emacs-waiting") {
          waitEvents += 1;
          const previousStep = script[waitEvents - 2];
          if (previousStep) {
            steps.push({
              name: `after-${previousStep.name}`,
              waitEvents,
              byteCount: terminalBytes.length,
              text: terminalText().slice(-2000),
            });
          } else {
            steps.push({
              name: "initial-command-loop",
              waitEvents,
              byteCount: terminalBytes.length,
              text: terminalText().slice(-2000),
            });
          }
          if (waitEvents <= script.length) {
            asyncifyWorker.postMessage({
              type: "terminal-input",
              bytes: script[waitEvents - 1].bytes,
            });
            return;
          }
          completeIfDone();
        }
      };

      asyncifyWorker.onerror = (event) => {
        finish({ passed: false, error: event.message, waitEvents, output: outputLines.slice(-80) });
      };

      asyncifyWorker.postMessage({ type: "start-interactive-command-loop" });
    });
    appendLine(`ASYNCIFY_INTERACTIVE_SEMANTICS_PROBE:${result.passed ? "PASS" : "FAIL"}`);
    return result;
  },
  lastRealUndoSmoke() {
    return lastRealUndoSmoke;
  },
  lastRepeatedUndoSmoke() {
    return lastRepeatedUndoSmoke;
  },
  lastRedoSmoke() {
    return lastRedoSmoke;
  },
  lastAsyncifyMinibufferReadSmoke() {
    return lastAsyncifyMinibufferReadSmoke;
  },
  lastAsyncifyNoLoadupBootSmoke() {
    return lastAsyncifyNoLoadupBootSmoke;
  },
	  state() {
	    return {
	      path: bufferPath,
	      pointIndex,
	      minibuffer: minibuffer.textContent,
	      state: bufferState.textContent,
	      status: status.textContent,
	      text: editor.value,
	      smallOs: smallOs.snapshot(),
	    };
	  },
};

await loadBuffer();
if (
  !searchParams.has("real-undo-smoke") &&
  !searchParams.has("repeated-undo-smoke") &&
  !searchParams.has("redo-smoke")
) {
  enqueueBufferCommand();
}
if (searchParams.has("real-undo-smoke")) {
  waitForIdle()
    .then(() => window.__wasmacsSmoke.realUndoSmoke())
    .catch((error) => {
      lastRealUndoSmoke = { passed: false, error: error && error.message ? error.message : String(error) };
      appendLine(`REAL_UNDO_UI_SMOKE:FAIL ${lastRealUndoSmoke.error}`);
    });
}
if (searchParams.has("repeated-undo-smoke")) {
  waitForIdle()
    .then(() => window.__wasmacsSmoke.repeatedUndoSmoke())
    .catch((error) => {
      lastRepeatedUndoSmoke = { passed: false, error: error && error.message ? error.message : String(error) };
      appendLine(`REPEATED_UNDO_UI_SMOKE:FAIL ${lastRepeatedUndoSmoke.error}`);
    });
}
if (searchParams.has("redo-smoke")) {
  waitForIdle()
    .then(() => window.__wasmacsSmoke.redoSmoke())
    .catch((error) => {
      lastRedoSmoke = { passed: false, error: error && error.message ? error.message : String(error) };
      appendLine(`REDO_UI_SMOKE:FAIL ${lastRedoSmoke.error}`);
    });
}
