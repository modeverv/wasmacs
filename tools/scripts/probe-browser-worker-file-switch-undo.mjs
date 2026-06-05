import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/build/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-worker-file-switch-undo.txt`;
const pathA = "/home/user/projects/worker-switch-a.txt";
const pathB = "/home/user/projects/worker-switch-b.txt";

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

function workerLikeEval(path, commandForm, pointIndex = 0, options = {}) {
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
context.Module.FS_createPath("/home/user", "projects", true, true);
context.Module.FS_createDataFile("/home/user/projects", "worker-switch-a.txt", new TextEncoder().encode(""), true, true, true);
context.Module.FS_createDataFile("/home/user/projects", "worker-switch-b.txt", new TextEncoder().encode(""), true, true, true);

const boot = context.Module.callMain(["--batch", "--eval", '(princ "boot\\n")']);

function runStep(name, path, commandForm, pointIndex, options = {}) {
  const status = context.Module.ccall(
    "wasmacs_eval_string",
    "number",
    ["string"],
    [workerLikeEval(path, commandForm, pointIndex, options)],
  );
  const readbackText = context.Module.ccall("wasmacs_last_result", "string", [], []);
  const readback = parseReadback(readbackText);
  lines.push(`${name.toUpperCase()}_STATUS:${status}`);
  lines.push(`${name.toUpperCase()}_READBACK:${readbackText}`);
  return { status, readback };
}

const aInsertA = runStep("a_insert_a", pathA, `(insert ${quote("A")})`, 0);
const aInsertX = runStep("a_insert_x", pathA, `(insert ${quote("X")})`, 1);
const bInsertB = runStep("b_insert_b", pathB, `(insert ${quote("B")})`, 0);
const aUndoX = runStep("a_undo_x", pathA, "(undo-only 1)", 2, { save: false });
const bUndoB = runStep("b_undo_b", pathB, "(undo-only 1)", 1, { save: false });
const aRedoX = runStep("a_redo_x", pathA, "(undo-redo 1)", 1, { save: false });
const bRedoB = runStep("b_redo_b", pathB, "(undo-redo 1)", 0, { save: false });
const fileTextA = context.Module.FS_readFile(pathA, { encoding: "utf8" });
const fileTextB = context.Module.FS_readFile(pathB, { encoding: "utf8" });

lines.push(`BOOT_EXIT:${boot}`);
lines.push(`FILE_TEXT_A:${fileTextA}`);
lines.push(`FILE_TEXT_B:${fileTextB}`);
await writeFile(logPath, `${lines.join("\n")}\n`);

if (boot !== 0) throw new Error(`expected boot exit 0, got ${boot}`);
for (const [name, step] of Object.entries({ aInsertA, aInsertX, bInsertB, aUndoX, bUndoB, aRedoX, bRedoB })) {
  if (step.status !== 0) throw new Error(`expected ${name} status 0, got ${step.status}`);
}
if (aInsertA.readback.text !== "A\n") throw new Error(`expected A newline, got ${JSON.stringify(aInsertA.readback)}`);
if (aInsertX.readback.text !== "AX\n") throw new Error(`expected AX newline, got ${JSON.stringify(aInsertX.readback)}`);
if (bInsertB.readback.text !== "B\n") throw new Error(`expected B newline, got ${JSON.stringify(bInsertB.readback)}`);
if (aUndoX.readback.path !== pathA || aUndoX.readback.text !== "A") {
  throw new Error(`expected undo in A to leave only A, got ${JSON.stringify(aUndoX.readback)}`);
}
if (bUndoB.readback.path !== pathB || bUndoB.readback.text !== "") {
  throw new Error(`expected undo in B to leave empty text, got ${JSON.stringify(bUndoB.readback)}`);
}
if (aRedoX.readback.path !== pathA || aRedoX.readback.text !== "AX\n") {
  throw new Error(`expected redo in A to restore AX, got ${JSON.stringify(aRedoX.readback)}`);
}
if (bRedoB.readback.path !== pathB || bRedoB.readback.text !== "B") {
  throw new Error(`expected redo in B to restore B, got ${JSON.stringify(bRedoB.readback)}`);
}
if (fileTextA !== "AX\n") throw new Error(`expected backing file A to retain last saved AX newline, got ${JSON.stringify(fileTextA)}`);
if (fileTextB !== "B\n") throw new Error(`expected backing file B to retain last saved B newline, got ${JSON.stringify(fileTextB)}`);

console.log("browser worker file switch undo probe passed");
