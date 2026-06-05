import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;
const artifactDir = process.env.WASMACS_ARTIFACT_DIR ?? `${repoRoot}/build/artifacts/emacs-browser-asyncify-spike`;
const logPath = process.env.WASMACS_LOG_PATH ?? `${repoRoot}/logs/wasm-browser-asyncify-minibuffer-cancel.txt`;
const require = createRequire(import.meta.url);

if (!process.argv.includes("--child")) {
  const result = spawnSync(
    process.execPath,
    ["--stack-size=65500", fileURLToPath(import.meta.url), "--child"],
    {
      encoding: "utf8",
      timeout: 240_000,
    },
  );
  const combined = `${result.stdout || ""}${result.stderr || ""}`.trimEnd();
  await writeFile(logPath, [
    "CASE:minibuffer-cancel",
    `STATUS:${result.status === 0 ? "PASS" : "FAIL"}`,
    `EXIT_STATUS:${result.status}`,
    `SIGNAL:${result.signal}`,
    combined,
    "",
  ].join("\n"));

  if (result.status !== 0) {
    throw new Error(`minibuffer cancel probe failed; see ${logPath}`);
  }

  console.log("browser asyncify minibuffer cancel probe passed");
  process.exit(0);
}

const code = await readFile(`${artifactDir}/temacs`, "utf8");
const lines = ["CASE:minibuffer-cancel"];
const flushLog = async () => {
  await writeFile(logPath, `${lines.join("\n")}\n`);
  console.log(`CHECKPOINT:${lines.at(-1) ?? ""}`);
};
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

const boot = context.Module.callMain(["--batch", "--eval", '(princ "boot\\n")']);
lines.push(`BOOT_EXIT:${boot}`);
await flushLog();
if (boot !== 0) {
  throw new Error(`expected boot exit 0, got ${boot}`);
}

const pending = context.Module.ccall(
  "wasmacs_command_begin_minibuffer_force_probe",
  "number",
  [],
  [],
  { async: true },
);

let waitCount = 0;
for (let attempt = 0; attempt < 200; attempt += 1) {
  waitCount = context.__wasmacsHostWaitForInputCount || 0;
  if (waitCount > 0 && context.__wasmacsHostWaitForInputPending) break;
  await new Promise((resolve) => setTimeout(resolve, 10));
}

lines.push(`WAIT_FOR_INPUT_COUNT:${waitCount}`);
lines.push(`WAIT_FOR_INPUT_PENDING:${context.__wasmacsHostWaitForInputPending ? "true" : "false"}`);
await flushLog();
if (waitCount < 1 || !context.__wasmacsHostWaitForInputPending) {
  throw new Error(`expected forced minibuffer read to suspend at host waitpoint; see ${logPath}`);
}

const beforeState = context.Module.ccall("wasmacs_minibuffer_state", "string", [], []);
const cancelStatus = context.Module.ccall("wasmacs_input_cancel", "number", [], []);
lines.push("BEFORE_CANCEL_STATE_BEGIN");
lines.push(beforeState.trimEnd());
lines.push("BEFORE_CANCEL_STATE_END");
lines.push(`INPUT_CANCEL_STATUS:${cancelStatus}`);
await flushLog();

if (cancelStatus !== 0) {
  throw new Error(`expected cancel input injection to return 0; see ${logPath}`);
}

if (typeof context.__wasmacsResolveHostInputWait !== "function") {
  await flushLog();
  throw new Error(`expected host input wait resolver to be available; see ${logPath}`);
}

context.__wasmacsResolveHostInputWait();
lines.push("WAIT_RESOLVED:true");
await flushLog();

const result = await Promise.race([
  pending.then((status) => ({ kind: "completed", status })),
  new Promise((resolve) => setTimeout(() => resolve({ kind: "timeout" }), 3000)),
]);

lines.push(`RESUME_RESULT:${result.kind}`);
if (result.kind !== "completed") {
  await flushLog();
  throw new Error(`minibuffer cancel did not complete; see ${logPath}`);
}

const readback = context.Module.ccall("wasmacs_last_result", "string", [], []);
const afterState = context.Module.ccall("wasmacs_minibuffer_state", "string", [], []);
const afterCommandState = context.Module.ccall("wasmacs_command_state", "string", [], []);
lines.push(`COMPLETED_STATUS:${result.status}`);
lines.push(`READBACK:${readback}`);
lines.push(`AFTER_COMMAND_STATE:${afterCommandState}`);
lines.push("AFTER_MINIBUFFER_STATE_BEGIN");
lines.push(afterState.trimEnd());
lines.push("AFTER_MINIBUFFER_STATE_END");
await flushLog();

if (result.status !== 1) {
  throw new Error(`expected cancel to complete with caught error status 1; see ${logPath}`);
}
if (!readback.includes("quit")) {
  throw new Error(`expected cancel readback to include quit; see ${logPath}`);
}
if (afterCommandState !== "idle") {
  throw new Error(`expected command state idle after cancel; see ${logPath}`);
}
if (!afterState.includes("active:false\n") || !afterState.includes("depth:0\n")) {
  throw new Error(`expected inactive minibuffer after cancel; see ${logPath}`);
}

console.log("browser asyncify minibuffer cancel probe completed read abort");
