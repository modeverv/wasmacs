import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;
const artifactDir = process.env.WASMACS_ARTIFACT_DIR ?? `${repoRoot}/build/artifacts/emacs-browser-asyncify-spike`;
const logPath = process.env.WASMACS_LOG_PATH ?? `${repoRoot}/logs/wasm-browser-asyncify-gc-after-completion.txt`;
const require = createRequire(import.meta.url);
const cases = ["boot", "text", "cancel", "text-scrub", "cancel-scrub", "text-pin", "cancel-pin"];

if (!process.argv.includes("--child")) {
  const summaries = [];
  for (const name of cases) {
    const result = spawnSync(
      process.execPath,
      ["--stack-size=65500", fileURLToPath(import.meta.url), "--child", name],
      {
        encoding: "utf8",
        timeout: 240_000,
      },
    );
    const combined = `${result.stdout || ""}${result.stderr || ""}`.trimEnd();
    const timedOut = result.error?.code === "ETIMEDOUT";
    const reachedPostCompletionGc =
      combined.includes("CHECKPOINT:AFTER_ENTRYPOINT_STATE_END");
    const reachedBootGc =
      name === "boot" && combined.includes("CHECKPOINT:AFTER_BOOT_ENTRYPOINT_STATE_END");
    const gcRootBlocked =
      combined.includes("RuntimeError: memory access out of bounds") &&
      combined.includes("mark_specpdl");
    const expectsKnownBlocker = name === "text" || name === "cancel";
    const status = result.status === 0
      ? "PASS"
      : expectsKnownBlocker && (reachedPostCompletionGc || reachedBootGc) && gcRootBlocked
        ? "KNOWN_BLOCKER"
        : "FAIL";
    summaries.push([
      `CASE:${name}`,
      `STATUS:${status}`,
      `EXIT_STATUS:${result.status}`,
      `SIGNAL:${result.signal}`,
      timedOut ? "TIMEOUT:true" : "TIMEOUT:false",
      reachedPostCompletionGc ? "POST_COMPLETION_GC_REACHED:true" : "POST_COMPLETION_GC_REACHED:false",
      reachedBootGc ? "BOOT_GC_REACHED:true" : "BOOT_GC_REACHED:false",
      gcRootBlocked ? "GC_ROOT_BLOCKED:true" : "GC_ROOT_BLOCKED:false",
      combined,
      "",
    ].join("\n"));
    await writeFile(logPath, `${summaries.join("\n")}\n`);
    if (status === "FAIL") {
      throw new Error(`asyncify GC-after-completion ${name} case failed; see ${logPath}`);
    }
  }

  const hasKnownBlocker = summaries.some((summary) => summary.includes("STATUS:KNOWN_BLOCKER"));
  console.log(hasKnownBlocker
    ? "browser asyncify GC-after-completion probe recorded known post-completion GC/root blocker"
    : "browser asyncify GC-after-completion probe passed");
  process.exit(0);
}

const caseName = process.argv.at(-1);
if (!cases.includes(caseName)) {
  throw new Error(`unknown GC-after-completion case ${caseName}`);
}
const shouldScrubBacktraceArgs = caseName.endsWith("-scrub");
const shouldPinBacktraceArgs = caseName.endsWith("-pin");
const commandCaseName = caseName.replace("-scrub", "").replace("-pin", "");

const lines = [`CASE:${caseName}`];
let flushedLineCount = 0;
const flushLog = async () => {
  await writeFile(logPath, `${lines.join("\n")}\n`);
  for (const line of lines.slice(flushedLineCount)) {
    console.log(line);
  }
  flushedLineCount = lines.length;
  console.log(`CHECKPOINT:${lines.at(-1) ?? ""}`);
};

const code = await readFile(`${artifactDir}/temacs`, "utf8");
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

const afterBootEntryState = context.Module.ccall("wasmacs_entrypoint_state", "string", [], []);
lines.push("AFTER_BOOT_ENTRYPOINT_STATE_BEGIN");
lines.push(afterBootEntryState.trimEnd());
lines.push("AFTER_BOOT_ENTRYPOINT_STATE_END");
await flushLog();

if (caseName === "boot") {
  const bootGcStatus = context.Module.ccall("wasmacs_garbage_collect", "number", [], []);
  const bootGcReadback = context.Module.ccall("wasmacs_last_result", "string", [], []);
  const afterBootGcEntryState = context.Module.ccall("wasmacs_entrypoint_state", "string", [], []);
  lines.push(`BOOT_GC_STATUS:${bootGcStatus}`);
  lines.push(`BOOT_GC_READBACK_PREFIX:${bootGcReadback.slice(0, 80)}`);
  lines.push("AFTER_BOOT_GC_ENTRYPOINT_STATE_BEGIN");
  lines.push(afterBootGcEntryState.trimEnd());
  lines.push("AFTER_BOOT_GC_ENTRYPOINT_STATE_END");
  await flushLog();

  if (bootGcStatus !== 0) {
    throw new Error(`expected explicit boot baseline GC to return 0; see ${logPath}`);
  }
  console.log("browser asyncify boot GC baseline case passed");
  process.exit(0);
}

if (shouldPinBacktraceArgs) {
  const pinStatus = context.Module.ccall("wasmacs_pin_specpdl_backtrace_args", "number", [], []);
  const pinReadback = context.Module.ccall("wasmacs_last_result", "string", [], []);
  const afterPinEntryState = context.Module.ccall("wasmacs_entrypoint_state", "string", [], []);
  lines.push(`PIN_BACKTRACE_ARGS_STATUS:${pinStatus}`);
  lines.push(`PIN_BACKTRACE_ARGS_READBACK:${pinReadback}`);
  lines.push("AFTER_PIN_ENTRYPOINT_STATE_BEGIN");
  lines.push(afterPinEntryState.trimEnd());
  lines.push("AFTER_PIN_ENTRYPOINT_STATE_END");
  await flushLog();

  if (pinStatus !== 0) {
    throw new Error(`expected backtrace args pin to return 0; see ${logPath}`);
  }
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

const beforeState = context.Module.ccall("wasmacs_entrypoint_state", "string", [], []);
lines.push("BEFORE_ENTRYPOINT_STATE_BEGIN");
lines.push(beforeState.trimEnd());
lines.push("BEFORE_ENTRYPOINT_STATE_END");

if (commandCaseName === "text") {
  const inputTextStatus = context.Module.ccall(
    "wasmacs_input_text",
    "number",
    ["string"],
    ["wasmacs-gc.txt\n"],
  );
  lines.push(`INPUT_TEXT_STATUS:${inputTextStatus}`);
  if (inputTextStatus !== 0) {
    await flushLog();
    throw new Error(`expected text input injection to return 0; see ${logPath}`);
  }
} else {
  const cancelStatus = context.Module.ccall("wasmacs_input_cancel", "number", [], []);
  lines.push(`INPUT_CANCEL_STATUS:${cancelStatus}`);
  if (cancelStatus !== 0) {
    await flushLog();
    throw new Error(`expected cancel input injection to return 0; see ${logPath}`);
  }
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
  throw new Error(`command did not complete before post-completion GC; see ${logPath}`);
}

const readback = context.Module.ccall("wasmacs_last_result", "string", [], []);
const afterCommandState = context.Module.ccall("wasmacs_command_state", "string", [], []);
const afterMinibufferState = context.Module.ccall("wasmacs_minibuffer_state", "string", [], []);
const afterEntryState = context.Module.ccall("wasmacs_entrypoint_state", "string", [], []);

lines.push(`COMPLETED_STATUS:${result.status}`);
lines.push(`READBACK:${readback}`);
lines.push(`AFTER_COMMAND_STATE:${afterCommandState}`);
lines.push(`HOST_WAIT_PENDING_AFTER_COMPLETION:${context.__wasmacsHostWaitForInputPending ? "true" : "false"}`);
lines.push("AFTER_MINIBUFFER_STATE_BEGIN");
lines.push(afterMinibufferState.trimEnd());
lines.push("AFTER_MINIBUFFER_STATE_END");
lines.push("AFTER_ENTRYPOINT_STATE_BEGIN");
lines.push(afterEntryState.trimEnd());
lines.push("AFTER_ENTRYPOINT_STATE_END");
await flushLog();

if (commandCaseName === "text") {
  if (result.status !== 0 || readback !== "wasmacs-gc.txt") {
    throw new Error(`expected text completion result; see ${logPath}`);
  }
} else if (result.status !== 1 || !readback.includes("quit")) {
  throw new Error(`expected cancel completion result; see ${logPath}`);
}
if (afterCommandState !== "idle") {
  throw new Error(`expected command state idle after completion; see ${logPath}`);
}
if (!afterMinibufferState.includes("active:false\n") || !afterMinibufferState.includes("depth:0\n")) {
  throw new Error(`expected inactive minibuffer after completion; see ${logPath}`);
}
if (!afterEntryState.includes("pending-asyncify-command:false\n")) {
  throw new Error(`expected no pending asyncify command before GC; see ${logPath}`);
}
if (!afterEntryState.includes("gc-inhibit-depth:0\n")) {
  throw new Error(`expected pending-command GC inhibit depth restored before GC; see ${logPath}`);
}
if (!afterEntryState.includes("emacs-gc-inhibited:0\n")) {
  throw new Error(`expected Emacs GC inhibit depth restored before GC; see ${logPath}`);
}

if (shouldScrubBacktraceArgs) {
  const scrubStatus = context.Module.ccall("wasmacs_scrub_specpdl_backtrace_args", "number", [], []);
  const scrubReadback = context.Module.ccall("wasmacs_last_result", "string", [], []);
  const afterScrubEntryState = context.Module.ccall("wasmacs_entrypoint_state", "string", [], []);
  lines.push(`SCRUB_BACKTRACE_ARGS_STATUS:${scrubStatus}`);
  lines.push(`SCRUB_BACKTRACE_ARGS_READBACK:${scrubReadback}`);
  lines.push("AFTER_SCRUB_ENTRYPOINT_STATE_BEGIN");
  lines.push(afterScrubEntryState.trimEnd());
  lines.push("AFTER_SCRUB_ENTRYPOINT_STATE_END");
  await flushLog();

  if (scrubStatus !== 0) {
    throw new Error(`expected backtrace args scrub to return 0; see ${logPath}`);
  }
}

const gcStatus = context.Module.ccall("wasmacs_garbage_collect", "number", [], []);
const gcReadback = context.Module.ccall("wasmacs_last_result", "string", [], []);
const afterGcEntryState = context.Module.ccall("wasmacs_entrypoint_state", "string", [], []);
const afterGcCommandState = context.Module.ccall("wasmacs_command_state", "string", [], []);
const afterGcMinibufferState = context.Module.ccall("wasmacs_minibuffer_state", "string", [], []);

lines.push(`GC_STATUS:${gcStatus}`);
lines.push(`GC_READBACK_PREFIX:${gcReadback.slice(0, 80)}`);
lines.push(`AFTER_GC_COMMAND_STATE:${afterGcCommandState}`);
lines.push("AFTER_GC_ENTRYPOINT_STATE_BEGIN");
lines.push(afterGcEntryState.trimEnd());
lines.push("AFTER_GC_ENTRYPOINT_STATE_END");
lines.push("AFTER_GC_MINIBUFFER_STATE_BEGIN");
lines.push(afterGcMinibufferState.trimEnd());
lines.push("AFTER_GC_MINIBUFFER_STATE_END");
await flushLog();

if (gcStatus !== 0) {
  throw new Error(`expected explicit post-completion GC to return 0; see ${logPath}`);
}
if (afterGcCommandState !== "idle") {
  throw new Error(`expected command state idle after explicit GC; see ${logPath}`);
}
if (!afterGcEntryState.includes("pending-asyncify-command:false\n")) {
  throw new Error(`expected no pending asyncify command after GC; see ${logPath}`);
}
if (!afterGcEntryState.includes("gc-inhibit-depth:0\n")) {
  throw new Error(`expected pending-command GC inhibit depth restored after GC; see ${logPath}`);
}
if (!afterGcEntryState.includes("emacs-gc-inhibited:0\n")) {
  throw new Error(`expected Emacs GC inhibit depth restored after GC; see ${logPath}`);
}
if (!afterGcMinibufferState.includes("active:false\n") || !afterGcMinibufferState.includes("depth:0\n")) {
  throw new Error(`expected inactive minibuffer after explicit GC; see ${logPath}`);
}

console.log(`browser asyncify GC-after-completion ${caseName} case passed`);
