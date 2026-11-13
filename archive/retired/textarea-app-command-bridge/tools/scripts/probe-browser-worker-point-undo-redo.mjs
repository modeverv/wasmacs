import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/build/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-worker-point-undo-redo.txt`;
const path = "/home/user/worker-point-undo-redo.txt";

const quote = (value) => `"${String(value)
  .replace(/\\/g, "\\\\")
  .replace(/"/g, '\\"')
  .replace(/\n/g, "\\n")}"`;

function parseReadback(text) {
  const first = text.indexOf("\n");
  const second = text.indexOf("\n", first + 1);
  return {
    path: text.slice(0, first),
    point: Number.parseInt(text.slice(first + 1, second), 10),
    text: text.slice(second + 1),
  };
}

function workerLikeEval(commandForm, pointIndex = 0, options = {}) {
  const pointForm = `(goto-char (min (point-max) (+ (point-min) ${pointIndex})))`;
  return [
    `(let ((path ${quote(path)}))`,
    "  (find-file path)",
    pointForm,
    commandForm,
    options.boundary === false ? "" : "  (undo-boundary)",
    options.save === false ? "" : "  (when (buffer-modified-p) (save-buffer))",
    "  (concat path",
    '          "\\n"',
    "          (number-to-string (1- (point)))",
    '          "\\n"',
    "          (buffer-string)))",
  ].filter(Boolean).join(" ");
}

const require = createRequire(import.meta.url);
const code = await readFile(`${artifactDir}/temacs`, "utf8");
const lines = [];
let resolveReady;
const ready = new Promise((resolve) => {
  resolveReady = resolve;
});

const context = {
  Module: {
    noInitialRun: true,
    thisProgram: "temacs",
    locateFile(filePath) {
      return `${artifactDir}/${filePath}`;
    },
    print(text) {
      lines.push(`OUT:${text}`);
    },
    printErr(text) {
      lines.push(`ERR:${text}`);
    },
    onRuntimeInitialized() {
      lines.push("READY");
      resolveReady();
    },
  },
  Buffer,
  TextDecoder,
  TextEncoder,
  URL,
  WebAssembly,
  __dirname: artifactDir,
  __filename: `${artifactDir}/temacs`,
  clearTimeout,
  console,
  performance,
  process,
  require,
  setTimeout,
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(code, context, { filename: "temacs" });
await ready;

context.Module.FS_createPath("/", "home", true, true);
context.Module.FS_createPath("/home", "user", true, true);
context.Module.FS_createDataFile("/home/user", "worker-point-undo-redo.txt", new TextEncoder().encode(""), true, true, true);

const boot = context.Module.callMain(["--batch", "--eval", '(princ "boot\\n")']);

function runStep(name, commandForm, pointIndex, options = {}) {
  const status = context.Module.ccall(
    "wasmacs_eval_string",
    "number",
    ["string"],
    [workerLikeEval(commandForm, pointIndex, options)],
  );
  const readbackText = context.Module.ccall("wasmacs_last_result", "string", [], []);
  const readback = parseReadback(readbackText);
  lines.push(`${name.toUpperCase()}_STATUS:${status}`);
  lines.push(`${name.toUpperCase()}_READBACK:${readbackText}`);
  return { status, readback };
}

const insertA = runStep("insert_a", `(insert ${quote("A")})`, 0);
const insertB = runStep("insert_b", `(insert ${quote("B")})`, 1);
const moveLeft = runStep("move_left", "(unless (bobp) (backward-char 1))", 2, { boundary: false, save: false });
const insertX = runStep("insert_x", `(insert ${quote("X")})`, 1);
const undoX = runStep("undo_x", "(undo-only 1)", 2, { save: false });
const redoX = runStep("redo_x", "(undo-redo 1)", 1, { save: false });
const fileText = context.Module.FS_readFile(path, { encoding: "utf8" });

lines.push(`BOOT_EXIT:${boot}`);
lines.push(`FILE_TEXT:${fileText}`);
await writeFile(logPath, `${lines.join("\n")}\n`);

if (boot !== 0) throw new Error(`expected boot exit 0, got ${boot}`);
for (const [name, step] of Object.entries({ insertA, insertB, moveLeft, insertX, undoX, redoX })) {
  if (step.status !== 0) throw new Error(`expected ${name} status 0, got ${step.status}`);
}
if (insertA.readback.text !== "A\n") throw new Error(`expected A newline, got ${JSON.stringify(insertA.readback)}`);
if (insertB.readback.text !== "AB\n") throw new Error(`expected AB newline, got ${JSON.stringify(insertB.readback)}`);
if (moveLeft.readback.point !== 1 || moveLeft.readback.text !== "AB\n") {
  throw new Error(`expected move-left point 1 over AB newline, got ${JSON.stringify(moveLeft.readback)}`);
}
if (insertX.readback.point !== 2 || insertX.readback.text !== "AXB\n") {
  throw new Error(`expected middle insert to leave AXB newline at point 2, got ${JSON.stringify(insertX.readback)}`);
}
if (undoX.readback.text !== "AB\n") throw new Error(`expected undo to remove X, got ${JSON.stringify(undoX.readback)}`);
if (redoX.readback.text !== "AXB\n") throw new Error(`expected redo to restore X, got ${JSON.stringify(redoX.readback)}`);
if (fileText !== "AXB\n") throw new Error(`expected backing file to retain last saved AXB newline, got ${JSON.stringify(fileText)}`);

console.log("browser worker point undo/redo probe passed");
