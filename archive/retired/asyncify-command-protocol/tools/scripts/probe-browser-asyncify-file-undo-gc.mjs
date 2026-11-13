import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;
const artifactDir = process.env.WASMACS_ARTIFACT_DIR ?? `${repoRoot}/build/artifacts/emacs-browser-asyncify-spike`;
const logPath = process.env.WASMACS_LOG_PATH ?? `${repoRoot}/logs/wasm-browser-asyncify-file-undo-gc.txt`;
const path = "/home/user/projects/asyncify-file-undo.txt";

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
    throw new Error(`asyncify file undo GC probe failed; see ${logPath}`);
  }
  console.log(combined || "browser asyncify file undo GC probe passed");
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

function fileUndoEval(commandForm, pointIndex = 0, options = {}) {
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
context.Module.FS_createDataFile("/home/user/projects", "asyncify-file-undo.txt", new TextEncoder().encode(""), true, true, true);

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

function runStep(name, commandForm, pointIndex = 0, options = {}) {
  const status = context.Module.ccall(
    "wasmacs_eval_string",
    "number",
    ["string"],
    [fileUndoEval(commandForm, pointIndex, options)],
  );
  const readbackText = context.Module.ccall("wasmacs_last_result", "string", [], []);
  const readback = parseReadback(readbackText);
  lines.push(`${name.toUpperCase()}_STATUS:${status}`);
  lines.push(`${name.toUpperCase()}_READBACK:${readbackText}`);
  return { status, readback };
}

const insertA = runStep("insert_a", `(insert ${quote("A")})`, 0);
await flushLog();
const insertX = runStep("insert_x", `(insert ${quote("X")})`, 1);
await flushLog();
const undoX = runStep("undo_x", "(undo-only 1)", 2, { save: false });
await flushLog();
const redoX = runStep("redo_x", "(undo-redo 1)", 1, { save: false });
await flushLog();

const beforeGcState = context.Module.ccall("wasmacs_entrypoint_state", "string", [], []);
const gcStatus = context.Module.ccall("wasmacs_garbage_collect", "number", [], []);
const gcReadback = context.Module.ccall("wasmacs_last_result", "string", [], []);
const afterGcState = context.Module.ccall("wasmacs_entrypoint_state", "string", [], []);
const afterGcRead = runStep("after_gc_read", "(progn)", 2, { boundary: false, save: false });
const insertZ = runStep("insert_z_after_gc", `(insert ${quote("Z")})`, 2, { save: false });
const undoZ = runStep("undo_z_after_gc", "(undo-only 1)", 3, { save: false });
const fileText = context.Module.FS_readFile(path, { encoding: "utf8" });

lines.push("BEFORE_GC_ENTRYPOINT_STATE_BEGIN");
lines.push(beforeGcState.trimEnd());
lines.push("BEFORE_GC_ENTRYPOINT_STATE_END");
lines.push(`GC_STATUS:${gcStatus}`);
lines.push(`GC_READBACK:${gcReadback}`);
lines.push("AFTER_GC_ENTRYPOINT_STATE_BEGIN");
lines.push(afterGcState.trimEnd());
lines.push("AFTER_GC_ENTRYPOINT_STATE_END");
lines.push(`FILE_TEXT:${fileText}`);

await writeFile(logPath, `${lines.join("\n")}\n`);

for (const [name, step] of Object.entries({
  insertA,
  insertX,
  undoX,
  redoX,
  afterGcRead,
  insertZ,
  undoZ,
})) {
  if (step.status !== 0) {
    throw new Error(`expected ${name} status 0, got ${step.status}; see ${logPath}`);
  }
  if (step.readback.path !== path) {
    throw new Error(`expected ${name} to stay in ${path}, got ${JSON.stringify(step.readback)}; see ${logPath}`);
  }
  if (!step.readback.undoUsable) {
    throw new Error(`expected ${name} to keep usable undo list; see ${logPath}`);
  }
}

if (insertA.readback.text !== "A\n") throw new Error(`expected A newline, got ${JSON.stringify(insertA.readback)}; see ${logPath}`);
if (insertX.readback.text !== "AX\n") throw new Error(`expected AX newline, got ${JSON.stringify(insertX.readback)}; see ${logPath}`);
if (undoX.readback.text !== "A") throw new Error(`expected undo to leave A, got ${JSON.stringify(undoX.readback)}; see ${logPath}`);
if (redoX.readback.text !== "AX\n") throw new Error(`expected redo to restore AX, got ${JSON.stringify(redoX.readback)}; see ${logPath}`);
if (gcStatus !== 0) throw new Error(`expected explicit GC status 0, got ${gcStatus}; see ${logPath}`);
if (!afterGcState.includes("pending-asyncify-command:false\n")) {
  throw new Error(`expected no pending asyncify command after GC; see ${logPath}`);
}
if (!afterGcState.includes("gc-inhibit-depth:0\n") || !afterGcState.includes("emacs-gc-inhibited:0\n")) {
  throw new Error(`expected GC inhibition restored after file undo GC; see ${logPath}`);
}
if (afterGcRead.readback.text !== "AX\n") throw new Error(`expected post-GC read AX newline, got ${JSON.stringify(afterGcRead.readback)}; see ${logPath}`);
if (insertZ.readback.text !== "AXZ\n") throw new Error(`expected post-GC insert AXZ newline, got ${JSON.stringify(insertZ.readback)}; see ${logPath}`);
if (undoZ.readback.text !== "AX\n") throw new Error(`expected post-GC undo to leave AX newline, got ${JSON.stringify(undoZ.readback)}; see ${logPath}`);
if (fileText !== "AX\n") throw new Error(`expected backing file to retain saved AX newline, got ${JSON.stringify(fileText)}; see ${logPath}`);

console.log("browser asyncify file undo GC probe passed");
