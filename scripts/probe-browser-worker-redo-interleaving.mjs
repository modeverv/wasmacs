import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-worker-redo-interleaving.txt`;
const path = "/home/user/worker-redo-interleaving.txt";

const quote = (value) => `"${String(value)
  .replace(/\\/g, "\\\\")
  .replace(/"/g, '\\"')
  .replace(/\n/g, "\\n")}"`;

function workerLikeEval(commandForm, pointIndex = 0) {
  const pointForm = `(goto-char (min (point-max) (+ (point-min) ${pointIndex})))`;
  return [
    `(let ((path ${quote(path)}))`,
    "  (find-file path)",
    pointForm,
    commandForm,
    "  (undo-boundary)",
    "  (when (buffer-modified-p) (save-buffer))",
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
context.Module.FS_createDataFile("/home/user", "worker-redo-interleaving.txt", new TextEncoder().encode(""), true, true, true);

const boot = context.Module.callMain(["--batch", "--eval", '(princ "boot\\n")']);

function runStep(name, commandForm, pointIndex) {
  const status = context.Module.ccall(
    "wasmacs_eval_string",
    "number",
    ["string"],
    [workerLikeEval(commandForm, pointIndex)],
  );
  const readback = context.Module.ccall("wasmacs_last_result", "string", [], []);
  lines.push(`${name.toUpperCase()}_STATUS:${status}`);
  lines.push(`${name.toUpperCase()}_READBACK:${readback}`);
  return { status, readback };
}

const insertA = runStep("insert_a", `(insert ${quote("A")})`, 0);
const insertB = runStep("insert_b", `(insert ${quote("B")})`, 1);
const undoB = runStep("undo_b", "(undo-only 1)", 2);
const redoB = runStep("redo_b", "(undo-redo 1)", 1);
const knownBlocker = redoB.status === 1 && redoB.readback.includes("No undone changes to redo");

lines.push(`BOOT_EXIT:${boot}`);
lines.push(knownBlocker ? "KNOWN_BLOCKER:multi-edit redo currently loses undone-change state" : "KNOWN_BLOCKER:absent");
await writeFile(logPath, `${lines.join("\n")}\n`);

if (boot !== 0) throw new Error(`expected boot exit 0, got ${boot}`);
for (const [name, step] of Object.entries({ insertA, insertB, undoB })) {
  if (step.status !== 0) throw new Error(`expected ${name} status 0, got ${step.status}`);
}
if (!knownBlocker && redoB.status !== 0) {
  throw new Error(`unexpected redo interleaving failure; see ${logPath}`);
}

console.log(
  knownBlocker
    ? "browser worker redo interleaving probe recorded known blocker"
    : "browser worker redo interleaving probe passed",
);
