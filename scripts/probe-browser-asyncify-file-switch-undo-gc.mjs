import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = process.env.WASMACS_ARTIFACT_DIR ?? `${repoRoot}/artifacts/emacs-browser-asyncify-spike`;
const logPath = process.env.WASMACS_LOG_PATH ?? `${repoRoot}/logs/wasm-browser-asyncify-file-switch-undo-gc.txt`;
const pathA = "/home/user/projects/asyncify-switch-a.txt";
const pathB = "/home/user/projects/asyncify-switch-b.txt";

if (!process.argv.includes("--child")) {
  const result = spawnSync(
    process.execPath,
    ["--stack-size=65500", fileURLToPath(import.meta.url), "--child"],
    {
      encoding: "utf8",
      timeout: 180_000,
    },
  );
  const combined = `${result.stdout || ""}${result.stderr || ""}`.trimEnd();
  if (result.status !== 0) {
    if (combined) console.error(combined);
    throw new Error(`asyncify file-switch undo GC probe failed; see ${logPath}`);
  }
  console.log(combined || "browser asyncify file-switch undo GC probe passed");
  process.exit(0);
}

const quote = (value) => `"${String(value)
  .replace(/\\/g, "\\\\")
  .replace(/"/g, '\\"')
  .replace(/\n/g, "\\n")}"`;

function parseReadback(text) {
  const first = text.indexOf("\n");
  const second = text.indexOf("\n", first + 1);
  const third = text.indexOf("\n", second + 1);
  return {
    path: text.slice(0, first),
    point: Number.parseInt(text.slice(first + 1, second), 10),
    undoUsable: text.slice(second + 1, third) === "undo-usable:true",
    text: text.slice(third + 1),
  };
}

function fileSwitchEval(path, commandForm, pointIndex = 0, options = {}) {
  const pointForm = `(goto-char (min (point-max) (+ (point-min) ${pointIndex})))`;
  return [
    `(let ((path ${quote(path)}))`,
    "  (find-file path)",
    pointForm,
    commandForm,
    options.boundary === false ? "" : "  (undo-boundary)",
    options.save === false ? "" : "  (when (buffer-modified-p) (save-buffer))",
    "  (concat (or buffer-file-name \"\")",
    '          "\\n"',
    "          (number-to-string (1- (point)))",
    '          "\\n"',
    "          (if (eq buffer-undo-list t) \"undo-usable:false\" \"undo-usable:true\")",
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
const flushLog = async () => {
  await writeFile(logPath, `${lines.join("\n")}\n`);
};

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
context.Module.FS_createDataFile("/home/user/projects", "asyncify-switch-a.txt", new TextEncoder().encode(""), true, true, true);
context.Module.FS_createDataFile("/home/user/projects", "asyncify-switch-b.txt", new TextEncoder().encode(""), true, true, true);

const boot = context.Module.callMain(["--batch", "--eval", '(princ "boot\\n")']);
lines.push(`BOOT_EXIT:${boot}`);
await flushLog();
if (boot !== 0) {
  throw new Error(`expected boot exit 0, got ${boot}`);
}

const pinStatus = context.Module.ccall("wasmacs_pin_specpdl_backtrace_args", "number", [], []);
const pinReadback = context.Module.ccall("wasmacs_last_result", "string", [], []);
const afterPinState = context.Module.ccall("wasmacs_entrypoint_state", "string", [], []);
lines.push(`PIN_BACKTRACE_ARGS_STATUS:${pinStatus}`);
lines.push(`PIN_BACKTRACE_ARGS_READBACK:${pinReadback}`);
lines.push("AFTER_PIN_ENTRYPOINT_STATE_BEGIN");
lines.push(afterPinState.trimEnd());
lines.push("AFTER_PIN_ENTRYPOINT_STATE_END");
await flushLog();
if (pinStatus !== 0) {
  throw new Error(`expected backtrace pin status 0, got ${pinStatus}`);
}

function runStep(name, path, commandForm, pointIndex = 0, options = {}) {
  const status = context.Module.ccall(
    "wasmacs_eval_string",
    "number",
    ["string"],
    [fileSwitchEval(path, commandForm, pointIndex, options)],
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
const bInsertY = runStep("b_insert_y", pathB, `(insert ${quote("Y")})`, 1);
await flushLog();

const beforeGcState = context.Module.ccall("wasmacs_entrypoint_state", "string", [], []);
const gcStatus = context.Module.ccall("wasmacs_garbage_collect", "number", [], []);
const gcReadback = context.Module.ccall("wasmacs_last_result", "string", [], []);
const afterGcState = context.Module.ccall("wasmacs_entrypoint_state", "string", [], []);

const afterGcReadA = runStep("after_gc_read_a", pathA, "(progn)", 2, { boundary: false, save: false });
const afterGcReadB = runStep("after_gc_read_b", pathB, "(progn)", 2, { boundary: false, save: false });
const aUndoX = runStep("a_undo_x_after_gc", pathA, "(undo-only 1)", 2, { save: false });
const bUndoY = runStep("b_undo_y_after_gc", pathB, "(undo-only 1)", 2, { save: false });
const aRedoX = runStep("a_redo_x_after_gc", pathA, "(undo-redo 1)", 1, { save: false });
const bRedoY = runStep("b_redo_y_after_gc", pathB, "(undo-redo 1)", 1, { save: false });
const fileTextA = context.Module.FS_readFile(pathA, { encoding: "utf8" });
const fileTextB = context.Module.FS_readFile(pathB, { encoding: "utf8" });

lines.push("BEFORE_GC_ENTRYPOINT_STATE_BEGIN");
lines.push(beforeGcState.trimEnd());
lines.push("BEFORE_GC_ENTRYPOINT_STATE_END");
lines.push(`GC_STATUS:${gcStatus}`);
lines.push(`GC_READBACK:${gcReadback}`);
lines.push("AFTER_GC_ENTRYPOINT_STATE_BEGIN");
lines.push(afterGcState.trimEnd());
lines.push("AFTER_GC_ENTRYPOINT_STATE_END");
lines.push(`FILE_TEXT_A:${fileTextA}`);
lines.push(`FILE_TEXT_B:${fileTextB}`);

await writeFile(logPath, `${lines.join("\n")}\n`);

for (const [name, step] of Object.entries({
  aInsertA,
  aInsertX,
  bInsertB,
  bInsertY,
  afterGcReadA,
  afterGcReadB,
  aUndoX,
  bUndoY,
  aRedoX,
  bRedoY,
})) {
  if (step.status !== 0) {
    throw new Error(`expected ${name} status 0, got ${step.status}; see ${logPath}`);
  }
  if (!step.readback.undoUsable) {
    throw new Error(`expected ${name} to keep usable undo list; see ${logPath}`);
  }
}

if (aInsertA.readback.path !== pathA || aInsertA.readback.text !== "A\n") {
  throw new Error(`expected A insert state, got ${JSON.stringify(aInsertA.readback)}; see ${logPath}`);
}
if (aInsertX.readback.path !== pathA || aInsertX.readback.text !== "AX\n") {
  throw new Error(`expected AX insert state, got ${JSON.stringify(aInsertX.readback)}; see ${logPath}`);
}
if (bInsertB.readback.path !== pathB || bInsertB.readback.text !== "B\n") {
  throw new Error(`expected B insert state, got ${JSON.stringify(bInsertB.readback)}; see ${logPath}`);
}
if (bInsertY.readback.path !== pathB || bInsertY.readback.text !== "BY\n") {
  throw new Error(`expected BY insert state, got ${JSON.stringify(bInsertY.readback)}; see ${logPath}`);
}
if (gcStatus !== 0) throw new Error(`expected explicit GC status 0, got ${gcStatus}; see ${logPath}`);
if (!afterGcState.includes("pending-asyncify-command:false\n")) {
  throw new Error(`expected no pending asyncify command after GC; see ${logPath}`);
}
if (!afterGcState.includes("gc-inhibit-depth:0\n") || !afterGcState.includes("emacs-gc-inhibited:0\n")) {
  throw new Error(`expected GC inhibition restored after file-switch undo GC; see ${logPath}`);
}
if (afterGcReadA.readback.path !== pathA || afterGcReadA.readback.text !== "AX\n") {
  throw new Error(`expected post-GC A read AX newline, got ${JSON.stringify(afterGcReadA.readback)}; see ${logPath}`);
}
if (afterGcReadB.readback.path !== pathB || afterGcReadB.readback.text !== "BY\n") {
  throw new Error(`expected post-GC B read BY newline, got ${JSON.stringify(afterGcReadB.readback)}; see ${logPath}`);
}
if (aUndoX.readback.path !== pathA || aUndoX.readback.text !== "A") {
  throw new Error(`expected post-GC A undo to leave A, got ${JSON.stringify(aUndoX.readback)}; see ${logPath}`);
}
if (bUndoY.readback.path !== pathB || bUndoY.readback.text !== "B") {
  throw new Error(`expected post-GC B undo to leave B, got ${JSON.stringify(bUndoY.readback)}; see ${logPath}`);
}
if (aRedoX.readback.path !== pathA || aRedoX.readback.text !== "AX\n") {
  throw new Error(`expected post-GC A redo to restore AX newline, got ${JSON.stringify(aRedoX.readback)}; see ${logPath}`);
}
if (bRedoY.readback.path !== pathB || bRedoY.readback.text !== "BY\n") {
  throw new Error(`expected post-GC B redo to restore BY newline, got ${JSON.stringify(bRedoY.readback)}; see ${logPath}`);
}
if (fileTextA !== "AX\n") throw new Error(`expected backing file A to retain saved AX newline, got ${JSON.stringify(fileTextA)}; see ${logPath}`);
if (fileTextB !== "BY\n") throw new Error(`expected backing file B to retain saved BY newline, got ${JSON.stringify(fileTextB)}; see ${logPath}`);

console.log("browser asyncify file-switch undo GC probe passed");
