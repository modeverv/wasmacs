import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = process.env.WASMACS_ARTIFACT_DIR ?? `${repoRoot}/artifacts/emacs-browser-asyncify-spike`;
const textLogPath = process.env.WASMACS_TEXT_LOG_PATH ?? `${repoRoot}/logs/wasm-browser-os-resume-memory-root.txt`;
const jsonlLogPath = process.env.WASMACS_JSONL_LOG_PATH ?? `${repoRoot}/logs/wasm-browser-os-resume-memory-root.jsonl`;
const require = createRequire(import.meta.url);

if (!process.argv.includes("--child")) {
  writeFileSync(textLogPath, "CASE:os-resume-memory-root\n");
  writeFileSync(jsonlLogPath, "");
  const result = spawnSync(
    process.execPath,
    ["--stack-size=65500", fileURLToPath(import.meta.url), "--child"],
    {
      encoding: "utf8",
      timeout: Number(process.env.WASMACS_OS_RESUME_MEMORY_ROOT_TIMEOUT_MS ?? 240_000),
    },
  );

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  appendFileSync(textLogPath, [
    `EXIT_STATUS:${result.status}`,
    `SIGNAL:${result.signal}`,
    result.error?.code === "ETIMEDOUT" ? "TIMEOUT:true" : "TIMEOUT:false",
    "STDOUT_BEGIN",
    stdout.trimEnd(),
    "STDOUT_END",
    "STDERR_BEGIN",
    stderr.trimEnd(),
    "STDERR_END",
    "",
  ].join("\n"));

  const snapshots = parseJsonl(await readFile(jsonlLogPath, "utf8"));
  const checkpointNames = new Set(snapshots.map((snapshot) => snapshot.checkpoint));
  const hasAfterBoot = checkpointNames.has("after-boot");
  const hasWait = checkpointNames.has("pending-input") || checkpointNames.has("before-asyncify-wait");
  const hasResumeOrFailure =
    checkpointNames.has("after-resume") ||
    checkpointNames.has("failure") ||
    checkpointNames.has("after-command-complete");
  const allSnapshotsStructured = snapshots.every((snapshot) => (
    snapshot.lifecycle &&
    snapshot.stack &&
    snapshot.gc &&
    snapshot.rootSafety
  ));
  const status = hasAfterBoot && hasWait && hasResumeOrFailure && allSnapshotsStructured
    ? "PASS"
    : "FAIL";
  const summary = {
    status,
    exitStatus: result.status,
    signal: result.signal,
    checkpoints: [...checkpointNames],
    snapshotCount: snapshots.length,
    lastCheckpoint: snapshots.at(-1)?.checkpoint,
  };
  appendFileSync(textLogPath, [
    "SUMMARY_BEGIN",
    JSON.stringify(summary, null, 2),
    "SUMMARY_END",
    "",
  ].join("\n"));

  if (status !== "PASS") {
    throw new Error(`OS resume memory/root probe did not capture required checkpoints; see ${textLogPath}`);
  }

  console.log("browser OS resume memory/root probe captured diagnostic checkpoints");
  process.exit(0);
}

const code = await readFile(`${artifactDir}/temacs`, "utf8");
let sequence = 0;
let resolveReady;
const childLines = [];
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
      childLines.push(`OUT:${text}`);
    },
    printErr(text) {
      childLines.push(`ERR:${text}`);
    },
    onAbort(what) {
      recordCheckpoint("failure", { failureKind: "abort", what });
    },
    onRuntimeInitialized() {
      childLines.push("READY");
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

try {
  vm.createContext(context);
  vm.runInContext(code, context, { filename: "temacs" });
  await ready;

  const boot = context.Module.callMain(["--batch", "--eval", '(princ "boot\\n")']);
  appendText(`BOOT_EXIT:${boot}`);
  recordCheckpoint("after-boot", { bootStatus: boot });
  if (boot !== 0) {
    throw new Error(`expected boot exit 0, got ${boot}`);
  }

  recordCheckpoint("before-asyncify-wait", { operation: "wasmacs_command_begin_minibuffer_force_probe" });
  const pending = context.Module.ccall(
    "wasmacs_command_begin_minibuffer_force_probe",
    "number",
    [],
    [],
    { async: true },
  );

  await waitForHostInput(2000);
  recordCheckpoint("pending-input", {
    minibufferState: context.Module.ccall("wasmacs_minibuffer_state", "string", [], []),
    commandState: context.Module.ccall("wasmacs_command_state", "string", [], []),
  });

  recordCheckpoint("before-input-injection", { inputTextBytes: "wasmacs-resume-memory-root.txt\n".length });
  const inputStatus = context.Module.ccall(
    "wasmacs_input_text",
    "number",
    ["string"],
    ["wasmacs-resume-memory-root.txt\n"],
  );
  recordCheckpoint("after-input-injection-before-resume", { inputStatus });
  if (inputStatus !== 0) {
    throw new Error(`expected input injection status 0, got ${inputStatus}`);
  }

  if (typeof context.__wasmacsResolveHostInputWait !== "function") {
    throw new Error("host input wait resolver is unavailable after input injection");
  }
  context.__wasmacsResolveHostInputWait();

  const resumeResult = await Promise.race([
    pending.then((status) => ({ kind: "completed", status })),
    new Promise((resolve) => setTimeout(() => resolve({ kind: "timeout" }), 5000)),
  ]);
  recordCheckpoint("after-resume", { resumeResult });
  if (resumeResult.kind !== "completed") {
    throw new Error(`command did not complete after resume: ${resumeResult.kind}`);
  }

  const readback = context.Module.ccall("wasmacs_last_result", "string", [], []);
  const commandState = context.Module.ccall("wasmacs_command_state", "string", [], []);
  const minibufferState = context.Module.ccall("wasmacs_minibuffer_state", "string", [], []);
  recordCheckpoint("after-command-complete", {
    completedStatus: resumeResult.status,
    readback,
    commandState,
    minibufferState,
  });

  const gcStatus = context.Module.ccall("wasmacs_garbage_collect", "number", [], []);
  const gcReadback = context.Module.ccall("wasmacs_last_result", "string", [], []);
  recordCheckpoint("after-explicit-gc", {
    gcStatus,
    gcReadbackPrefix: String(gcReadback).slice(0, 120),
    commandState: context.Module.ccall("wasmacs_command_state", "string", [], []),
    minibufferState: context.Module.ccall("wasmacs_minibuffer_state", "string", [], []),
  });
} catch (error) {
  recordCheckpoint("failure", {
    failureKind: "exception",
    error: error && error.stack ? error.stack : String(error),
  });
  throw error;
}

function recordCheckpoint(checkpoint, details = {}) {
  flushChildLines();
  const snapshot = {
    checkpoint,
    sequence: ++sequence,
    timestamp: new Date().toISOString(),
    monotonicMs: Math.round(performance.now() * 1000) / 1000,
    asyncify: {
      waitActive: Boolean(context.__wasmacsHostWaitForInputPending),
      waitCount: context.__wasmacsHostWaitForInputCount || 0,
      inputQueueBytes: (context.__wasmacsTerminalInputBytes || []).length,
      outputByteCount: (context.__wasmacsTerminalOutputBytes || []).length,
    },
    memory: {},
    pendingCommandState: safeCcallString("wasmacs_os_pending_command_state"),
    lifecycle: readDiagnosticJson("wasmacs_os_lifecycle_state"),
    stack: readDiagnosticJson("wasmacs_os_stack_bounds_probe"),
    gc: readDiagnosticJson("wasmacs_os_gc_permission_state"),
    rootSafety: readDiagnosticJson("wasmacs_os_root_safety_probe"),
    details,
  };
  appendFileSync(jsonlLogPath, `${JSON.stringify(snapshot)}\n`);
  appendText(`CHECKPOINT:${checkpoint}`);
}

function readMemorySnapshot() {
  return {
    heapBytes: context.Module?.HEAPU8?.length,
    heapMiB: context.Module?.HEAPU8?.length
      ? Math.round(context.Module.HEAPU8.length / 1024 / 1024)
      : undefined,
  };
}

function readDiagnosticJson(entrypoint) {
  const raw = safeCcallString(entrypoint);
  try {
    return JSON.parse(raw);
  } catch (error) {
    return {
      diagnostic: true,
      parseError: String(error),
      raw,
    };
  }
}

function safeCcallString(entrypoint) {
  try {
    return context.Module.ccall(entrypoint, "string", [], []);
  } catch (error) {
    return `error:${String(error)}`;
  }
}

function appendText(line) {
  appendFileSync(textLogPath, `${line}\n`);
  console.log(line);
}

function flushChildLines() {
  while (childLines.length > 0) {
    appendText(childLines.shift());
  }
}

async function waitForHostInput(attempts = 500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (context.__wasmacsHostWaitForInputPending) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for asyncify host input waitpoint");
}

function parseJsonl(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
