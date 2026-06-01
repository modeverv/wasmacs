import { BrowserUserImage } from "./browser-wasifs.js";
import { coalesceBufferCommand } from "./command-queue.js";
import { keyEventToBufferCommand, validateBufferCommand } from "./input-protocol.js";
import { textToGridDrawMessage, validateTextGridDrawMessage } from "./redisplay-protocol.js";

const output = document.querySelector("#output");
const status = document.querySelector("#status");
const runButton = document.querySelector("#run");
const saveButton = document.querySelector("#save");
const reloadButton = document.querySelector("#reload-buffer");
const exportButton = document.querySelector("#export-image");
const importInput = document.querySelector("#import-image");
const editor = document.querySelector("#editor");
const bufferState = document.querySelector("#buffer-state");
const frameGrid = document.querySelector("#frame-grid");

const bufferPath = "/home/user/notes.txt";
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

async function loadBuffer() {
  if (!userImage) userImage = await loadUserImage();
  savedText = userImage.readText(bufferPath, defaultText);
  if (savedText === defaultText) {
    userImage.writeText(bufferPath, savedText);
  }
  editor.value = savedText;
  pointIndex = savedText.length;
  renderTextGrid(textToGridDrawMessage({ path: bufferPath, pointIndex, text: savedText }));
  setBufferState("loaded");
}

function saveBuffer() {
  userImage.writeText(bufferPath, editor.value);
  localStorage.setItem(storageKey, userImage.toBase64());
  savedText = editor.value;
  pointIndex = Math.min(pointIndex, savedText.length);
  renderTextGrid(textToGridDrawMessage({ path: bufferPath, pointIndex, text: savedText }));
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
  await loadBuffer();
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
  if (!validateBufferCommand(command)) {
    throw new Error("invalid buffer command");
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
  stopWorker();
  output.textContent = "";
  setStatus("running emacs command");
  setBufferState(commandQueue.length > 0 ? `running command (${commandQueue.length} queued)` : "running command");
  runButton.disabled = true;

  worker = new Worker("/app/src/wasm-worker.js", { type: "classic" });
  worker.onmessage = (event) => {
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
        setBufferState("synced from emacs");
      }
    }
    if (message.type === "exit") {
      setStatus(message.code === 0 ? "emacs core exited cleanly" : `emacs core exited ${message.code}`);
      commandInFlight = false;
      runButton.disabled = commandQueue.length > 0;
      runNextBufferCommand();
      if (commandQueue.length === 0 && !commandInFlight) runButton.disabled = false;
    }
    if (message.type === "error") {
      setStatus("worker error");
      appendLine(message.text);
      commandInFlight = false;
      runButton.disabled = false;
    }
  };
  worker.onerror = (event) => {
    setStatus("worker error");
    appendLine(event.message);
    commandInFlight = false;
    runButton.disabled = false;
  };
  worker.postMessage({
    type: "run-buffer-command",
    command,
    entries: userImage.entries(),
  });
}

runButton.addEventListener("click", () => enqueueBufferCommand());
saveButton.addEventListener("click", saveBuffer);
reloadButton.addEventListener("click", async () => {
  userImage = await loadUserImage();
  await loadBuffer();
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
frameGrid.addEventListener("keydown", (event) => {
  const command = keyEventToBufferCommand({
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    isComposing: event.isComposing,
    key: event.key,
    metaKey: event.metaKey,
    path: bufferPath,
    pointIndex,
  });
  if (!command) return;

  event.preventDefault();
  enqueueBufferCommand(command);
});

await loadBuffer();
enqueueBufferCommand();
