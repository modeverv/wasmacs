import { BrowserUserImage } from "./browser-wasifs.js";
import { isEditorModified } from "./buffer-dirty.js";
import { coalesceBufferCommand } from "./command-queue.js";
import { keyEventToBufferCommand, nextPointIndexForCommand, validateBufferCommand } from "./input-protocol.js";
import { textToGridDrawMessage, validateTextGridDrawMessage } from "./redisplay-protocol.js";
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

const defaultBufferPath = "/home/user/notes.txt";
const storageKey = "wasmacs:user-filesystem.wasifs:v1";
const defaultText = [
  "Welcome to wasmacs.",
  "",
  "This is the first browser-hosted buffer adapter.",
  "It is backed by /home/user/notes.txt in the MVP host filesystem shim.",
  "",
].join("\n");

let worker;
let savedText = "";
let userImage;
let commandInFlight = false;
let commandQueue = [];
let pointIndex = 0;
let bufferPath = defaultBufferPath;
let keyPrefix;

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
    setBufferState(`prefix ${command.prefix}`);
    return;
  }
  if (!validateBufferCommand(command)) {
    throw new Error("invalid buffer command");
  }
  keyPrefix = undefined;
  if (command.type === "keyboard-quit") {
    commandQueue = [];
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

function runWorkerCommand(command) {
  output.textContent = "";
  setStatus("running emacs command");
  setBufferState(commandQueue.length > 0 ? `running command (${commandQueue.length} queued)` : "running command");
  runButton.disabled = true;

  if (!worker) {
    worker = new Worker("/app/src/wasm-worker.js", { type: "classic" });
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
  if (message.type === "sync-file") {
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
  if (message.type === "exit") {
    setStatus(message.code === 0 ? "emacs command completed" : `emacs command exited ${message.code}`);
    commandInFlight = false;
    runButton.disabled = commandQueue.length > 0;
    runNextBufferCommand();
    if (commandQueue.length === 0 && !commandInFlight) runButton.disabled = false;
  }
  if (message.type === "error") {
    const undoUnavailable = message.text.includes("undo requires persistent Emacs buffers");
    const clipboardUnavailable = message.text.includes("clipboard/kill-ring requires GUI clipboard protocol");
    const minibufferUnavailable = message.text.includes("minibuffer requires persistent Emacs command loop");
    const processUnavailable = message.text.includes("host.process");
    setStatus(undoUnavailable ? "undo unavailable" : clipboardUnavailable ? "clipboard unavailable" : minibufferUnavailable ? "minibuffer unavailable" : processUnavailable ? "process unavailable" : "worker error");
    setBufferState(undoUnavailable ? "undo unavailable" : clipboardUnavailable ? "clipboard unavailable" : minibufferUnavailable ? "minibuffer unavailable" : processUnavailable ? "process unavailable" : "worker error");
    appendLine(message.text);
    commandInFlight = false;
    runButton.disabled = false;
    stopWorker();
  }
}

function handleWorkerError(event) {
  setStatus("worker error");
  appendLine(event.message);
  commandInFlight = false;
  runButton.disabled = false;
  stopWorker();
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
  state() {
    return {
      path: bufferPath,
      pointIndex,
      state: bufferState.textContent,
      status: status.textContent,
      text: editor.value,
    };
  },
};

await loadBuffer();
enqueueBufferCommand();
