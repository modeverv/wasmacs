import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-worker-real-undo.txt`;
const path = "/home/user/worker-real-undo.txt";

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
    "  (undo-boundary)",
    options.save === false ? "" : "  (when (buffer-modified-p) (save-buffer))",
    "  (concat path",
    '          "\\n"',
    "          (number-to-string (1- (point)))",
    '          "\\n"',
    "          (buffer-string)))",
  ].join(" ");
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
context.Module.FS_createDataFile("/home/user", "worker-real-undo.txt", new TextEncoder().encode(""), true, true, true);

const boot = context.Module.callMain(["--batch", "--eval", '(princ "boot\\n")']);
const insertEval = context.Module.ccall(
  "wasmacs_eval_string",
  "number",
  ["string"],
  [workerLikeEval(`(insert ${quote("U")})`)],
);
const insertReadback = context.Module.ccall("wasmacs_last_result", "string", [], []);
const undoEval = context.Module.ccall(
  "wasmacs_eval_string",
  "number",
  ["string"],
  [workerLikeEval("(undo-only 1)", 1, { save: false })],
);
const undoReadback = context.Module.ccall("wasmacs_last_result", "string", [], []);
const fileText = context.Module.FS_readFile(path, { encoding: "utf8" });
const insertParsed = parseReadback(insertReadback);
const undoParsed = parseReadback(undoReadback);

lines.push(`BOOT_EXIT:${boot}`);
lines.push(`INSERT_EVAL_STATUS:${insertEval}`);
lines.push(`INSERT_READBACK:${insertReadback}`);
lines.push(`UNDO_EVAL_STATUS:${undoEval}`);
lines.push(`UNDO_READBACK:${undoReadback}`);
lines.push(`FILE_TEXT:${fileText}`);

await writeFile(logPath, `${lines.join("\n")}\n`);

if (boot !== 0) throw new Error(`expected boot exit 0, got ${boot}`);
if (insertEval !== 0) throw new Error(`expected insert eval 0, got ${insertEval}`);
if (insertParsed.text !== "U\n") throw new Error(`expected insert readback text U newline, got ${JSON.stringify(insertParsed)}`);
if (undoEval !== 0) throw new Error(`expected undo eval 0, got ${undoEval}`);
if (undoParsed.text !== "") throw new Error(`expected undo readback empty text, got ${JSON.stringify(undoParsed)}`);
if (fileText !== "U\n") throw new Error(`expected backing file to retain last save, got ${JSON.stringify(fileText)}`);

console.log("browser worker real undo probe passed");
