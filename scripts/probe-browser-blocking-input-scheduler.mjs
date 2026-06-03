import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = process.env.WASMACS_ARTIFACT_DIR ?? `${repoRoot}/artifacts/emacs-browser-asyncify-spike`;
const requestedMode = process.env.WASMACS_WAIT_IMPORT_MODE ?? "compare";
const childModeArg = process.argv.find((arg) => arg.startsWith("--mode="));
const waitImportMode = childModeArg ? childModeArg.slice("--mode=".length) : requestedMode;
const defaultLogStem = `${repoRoot}/logs/wasm-browser-blocking-input-scheduler`;
const textLogPath = process.env.WASMACS_TEXT_LOG_PATH ?? (
  waitImportMode === "compare" ? `${defaultLogStem}.txt` : `${defaultLogStem}-${waitImportMode.toLowerCase()}.txt`
);
const jsonlLogPath = process.env.WASMACS_JSONL_LOG_PATH ?? (
  waitImportMode === "compare" ? `${defaultLogStem}.jsonl` : `${defaultLogStem}-${waitImportMode.toLowerCase()}.jsonl`
);
const require = createRequire(import.meta.url);

if (!process.argv.includes("--child")) {
  const modes = requestedMode === "compare"
    ? ["async-wrapper", "handleAsync"]
    : [requestedMode];
  const summaries = [];
  let failed = false;
  for (const mode of modes) {
    const result = runParentMode(mode);
    summaries.push(result.summary);
    if (result.summary.status !== "PASS") failed = true;
  }

  if (modes.length > 1) {
    writeFileSync(`${defaultLogStem}-compare.txt`, [
      "CASE:blocking-input-scheduler-compare",
      "SUMMARY_BEGIN",
      JSON.stringify({ status: failed ? "FAIL" : "PASS", modes: summaries }, null, 2),
      "SUMMARY_END",
      "",
    ].join("\n"));
  }

  if (failed) {
    throw new Error("blocking input scheduler comparison did not capture required checkpoints");
  }

  console.log("browser blocking input scheduler probe captured diagnostic checkpoints");
  process.exit(0);
}

function runParentMode(mode) {
  const modeTextLogPath = process.env.WASMACS_TEXT_LOG_PATH ?? `${defaultLogStem}-${mode.toLowerCase()}.txt`;
  const modeJsonlLogPath = process.env.WASMACS_JSONL_LOG_PATH ?? `${defaultLogStem}-${mode.toLowerCase()}.jsonl`;
  writeFileSync(modeTextLogPath, `CASE:blocking-input-scheduler\nMODE:${mode}\n`);
  writeFileSync(modeJsonlLogPath, "");
  const result = spawnSync(
    process.execPath,
    ["--stack-size=65500", fileURLToPath(import.meta.url), "--child", `--mode=${mode}`],
    {
      encoding: "utf8",
      timeout: Number(process.env.WASMACS_BLOCKING_INPUT_SCHEDULER_TIMEOUT_MS ?? 240_000),
      env: {
        ...process.env,
        WASMACS_WAIT_IMPORT_MODE: mode,
        WASMACS_TEXT_LOG_PATH: modeTextLogPath,
        WASMACS_JSONL_LOG_PATH: modeJsonlLogPath,
      },
    },
  );

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  appendFileSync(modeTextLogPath, [
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

  let snapshots = parseJsonl(require("node:fs").readFileSync(modeJsonlLogPath, "utf8"));
  if (
    result.error?.code === "ETIMEDOUT" &&
    snapshots.length > 0 &&
    snapshots.at(-1).checkpoint !== "failure"
  ) {
    const last = snapshots.at(-1);
    const failure = {
      ...last,
      checkpoint: "failure",
      sequence: last.sequence + 1,
      timestamp: new Date().toISOString(),
      monotonicMs: undefined,
      details: {
        failureKind: "parent-timeout",
        lastCheckpoint: last.checkpoint,
        reason: "child did not regain JS control after wait resolve before parent timeout",
      },
    };
    appendFileSync(modeJsonlLogPath, `${JSON.stringify(failure)}\n`);
    snapshots = [...snapshots, failure];
  }
  const checkpointNames = new Set(snapshots.map((snapshot) => snapshot.checkpoint));
  const requiredBase = [
    "after-boot",
    "before-tty-read",
    "before-asyncify-wait",
    "pending-input",
    "before-input-queue",
    "after-input-queue-before-resolve",
  ];
  const required = mode === "handleAsync"
    ? [...requiredBase, "before-wait-resolver-call", "after-promise-then-poll"]
    : [...requiredBase, "before-wait-resolver-call", "after-wait-resolve-before-resume"];
  const hasRequired = required.every((checkpoint) => checkpointNames.has(checkpoint));
  const hasResumeEvidence =
    checkpointNames.has("after-resume") ||
    checkpointNames.has("after-next-wait") ||
    checkpointNames.has("after-command-complete") ||
    checkpointNames.has("failure");
  const allSnapshotsStructured = snapshots.every((snapshot) => (
    snapshot.scheduler &&
    Object.hasOwn(snapshot.scheduler, "waitActive") &&
    Object.hasOwn(snapshot.scheduler, "waitCount") &&
    Object.hasOwn(snapshot.scheduler, "queuedBytes") &&
    Object.hasOwn(snapshot.scheduler, "resolverPresent") &&
    snapshot.lifecycle &&
    snapshot.gc &&
    snapshot.rootSafety
  ));
  const queuedWasConsumed = snapshots.some((snapshot) => (
    (snapshot.checkpoint === "after-resume" ||
     snapshot.checkpoint === "after-next-wait" ||
     snapshot.checkpoint === "after-command-complete") &&
    snapshot.scheduler.queuedBytes === 0
  ));
  const resolverCleared = snapshots.some((snapshot) => (
    snapshot.checkpoint === "after-wait-resolve-before-resume" &&
    snapshot.scheduler.resolverPresent === false
  ));
  const modeSpecificEvidence = mode === "handleAsync"
    ? snapshots.some((snapshot) => snapshot.scheduler.boundarySeen?.jsImportHandleAsyncEnter)
    : resolverCleared;
  const status = hasRequired && hasResumeEvidence && allSnapshotsStructured && modeSpecificEvidence
    ? "PASS"
    : "FAIL";
  const summary = {
    status,
    mode,
    exitStatus: result.status,
    signal: result.signal,
    checkpoints: [...checkpointNames],
    schedulerEventLabels: [
      ...new Set(snapshots.flatMap((snapshot) => (
        snapshot.scheduler.recentEvents || []
      ).map((event) => event.label))),
    ],
    snapshotCount: snapshots.length,
    lastCheckpoint: snapshots.at(-1)?.checkpoint,
    queuedWasConsumed,
    resolverCleared,
    cKeyboardAfterWaitReturnBeforeResolver: eventBefore(snapshots, "c-keyboard-after-wait-return", "js-import-resolver-called"),
    cKeyboardAfterWaitReturnAfterResolver: eventAfter(snapshots, "c-keyboard-after-wait-return", "js-import-resolver-called"),
    reachedHandleAsync: snapshots.some((snapshot) => snapshot.scheduler.boundarySeen?.jsImportHandleAsyncEnter),
    reachedSysdepBeforeWait: snapshots.some((snapshot) => snapshot.scheduler.boundarySeen?.cSysdepBeforeWait),
    reachedByteDequeue: snapshots.some((snapshot) => snapshot.scheduler.boundarySeen?.jsTerminalReadByteDequeue),
    waitCountStart: snapshots.find((snapshot) => snapshot.checkpoint === "pending-input")?.scheduler.waitCount,
    waitCountEnd: snapshots.at(-1)?.scheduler?.waitCount,
    promiseThenFired: snapshots.find((s) => s.checkpoint === "after-promise-then-poll")?.details?.promiseThenFired ?? null,
    asyncifyStateAfterResolve: snapshots.find((s) => s.checkpoint === "after-promise-then-poll")?.details?.asyncifyOuterState ?? null,
    callMainReturnedPromise: snapshots.find((s) => s.checkpoint === "before-asyncify-wait")?.details?.callMainReturnedPromise ?? null,
    asyncifyStateAfterCallMain: snapshots.find((s) => s.checkpoint === "before-asyncify-wait")?.asyncify?.outerState ?? null,
  };
  appendFileSync(modeTextLogPath, [
    "SUMMARY_BEGIN",
    JSON.stringify(summary, null, 2),
    "SUMMARY_END",
    "",
  ].join("\n"));

  return { summary, snapshots };
}

const code = await readFile(`${artifactDir}/temacs`, "utf8");
let sequence = 0;
let schedulerPhase = "runtime-loading";
let lastInjectedInput;
let lastResolvedWaitId = 0;
let repeatedWaitCount = 0;
let lastObservedWaitCount = 0;
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
context.__wasmacsWaitImportMode = waitImportMode;

try {
  vm.createContext(context);
  vm.runInContext(code, context, { filename: "temacs" });
  await ready;

  schedulerPhase = "runtime-ready";
  recordCheckpoint("after-boot", { note: "runtime initialized before Emacs main; lifecycle is expected to be uninitialized" });

  const args = ["--quick", "--no-splash", "--nw"];
  schedulerPhase = "starting-tty-read";
  recordCheckpoint("before-tty-read", { args });

  const mainResult = context.Module.callMain(args);
  schedulerPhase = "waiting-for-asyncify";
  recordCheckpoint("before-asyncify-wait", {
    callMainReturnedPromise: Boolean(mainResult && typeof mainResult.then === "function"),
    callMainReturn: mainResult && typeof mainResult.then === "function" ? "promise" : mainResult,
  });

  await waitForHostInput(3000);
  schedulerPhase = "pending-input";
  updateRepeatedWaitCount();
  recordCheckpoint("pending-input", { initialWaitId: currentWaitId() });

  schedulerPhase = "queue-ready";
  recordCheckpoint("before-input-queue", { queuedInput: "a" });
  queueTerminalInput("a");
  schedulerPhase = "input-queued";
  recordCheckpoint("after-input-queue-before-resolve", { queuedInput: lastInjectedInput });

  schedulerPhase = "wait-resolver-ready";
  recordCheckpoint("before-wait-resolver-call", { waitId: currentWaitId() });

  const resolvedWaitId = resolveCurrentWait();
  schedulerPhase = "wait-resolved";
  recordCheckpoint("after-wait-resolve-before-resume", { resolvedWaitId });

  // Poll for js-import-promise-then to confirm the inner .then chain fires.
  // In handleAsync mode this is the critical missing link before doRewind.
  const promiseThenPolled = await pollForSchedulerEvent("js-import-promise-then", 2000);
  recordCheckpoint("after-promise-then-poll", {
    resolvedWaitId,
    promiseThenFired: promiseThenPolled,
    asyncifyOuterState: typeof context.__wasmacsGetAsyncifyState === "function"
      ? context.__wasmacsGetAsyncifyState()
      : null,
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  schedulerPhase = "resumed";
  updateRepeatedWaitCount();
  recordCheckpoint("after-resume", { resolvedWaitId });

  await waitForHostInputAfter(resolvedWaitId, 5000);
  schedulerPhase = "next-wait";
  updateRepeatedWaitCount();
  recordCheckpoint("after-next-wait", { resolvedWaitId, currentWaitId: currentWaitId() });

  schedulerPhase = "command-loop-still-running";
  recordCheckpoint("after-command-complete", {
    completed: false,
    reason: "interactive --nw command loop remains alive and has returned to the next input wait",
  });
} catch (error) {
  schedulerPhase = "failure";
  recordCheckpoint("failure", {
    failureKind: "exception",
    error: error && error.stack ? error.stack : String(error),
  });
  throw error;
}

function recordCheckpoint(checkpoint, details = {}) {
  flushChildLines();
  const scheduler = readSchedulerSnapshot();
  const snapshot = {
    checkpoint,
    waitImportMode,
    sequence: ++sequence,
    timestamp: new Date().toISOString(),
    monotonicMs: Math.round(performance.now() * 1000) / 1000,
    scheduler,
    asyncify: {
      waitActive: scheduler.waitActive,
      waitCount: scheduler.waitCount,
      outerState: typeof context.__wasmacsGetAsyncifyState === "function"
        ? context.__wasmacsGetAsyncifyState()
        : { available: false },
    },
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

function readSchedulerSnapshot() {
  const queued = Array.from(context.__wasmacsTerminalInputBytes || []);
  const waitCount = context.__wasmacsHostWaitForInputCount || 0;
  const events = Array.from(context.__wasmacsSchedulerEvents || []);
  const promiseStates = context.__wasmacsWaitPromiseState || {};
  const currentPromiseState = promiseStates[waitCount] || null;
  return {
    phase: schedulerPhase,
    waitActive: Boolean(context.__wasmacsHostWaitForInputPending),
    asyncifyWaitActive: Boolean(context.__wasmacsHostWaitForInputPending),
    waitCount,
    pendingResolver: typeof context.__wasmacsResolveHostInputWait === "function",
    resolverPresent: typeof context.__wasmacsResolveHostInputWait === "function",
    queuedBytes: queued.length,
    queuedPreview: queued.slice(0, 16),
    lastInjectedInput,
    lastResolvedWaitId,
    repeatedWaitCount,
    commandGuardDepth: readCommandGuardDepth(),
    outputByteCount: (context.__wasmacsTerminalOutputBytes || []).length,
    promiseIdentity: {
      currentWaitId: waitCount,
      current: currentPromiseState,
      all: JSON.parse(JSON.stringify(promiseStates)),
    },
    recentEvents: events.slice(-40),
    lastEventLabel: events.at(-1)?.label,
    boundarySeen: {
      jsImportWaitEnter: events.some((event) => event.label === "js-import-wait-enter"),
      jsImportPromiseCreated: events.some((event) => event.label === "js-import-promise-created"),
      jsImportPromiseReturned: events.some((event) => event.label === "js-import-promise-return-expression"),
      jsImportResolverBound: events.some((event) => event.label === "js-import-resolver-bound"),
      jsImportHandleAsyncEnter: events.some((event) => event.label === "js-import-handleasync-enter"),
      jsImportHandleAsyncPromiseCreated: events.some((event) => event.label === "js-import-handleasync-promise-created"),
      jsImportHandleAsyncReturning: events.some((event) => event.label === "js-import-handleasync-returning"),
      jsImportResolverCalled: events.some((event) => event.label === "js-import-resolver-called"),
      jsImportResolveAfter: events.some((event) => event.label === "js-import-resolve-after"),
      jsImportPromiseThen: events.some((event) => event.label === "js-import-promise-then"),
      jsImportHandleAsyncCurrdataBefore: events.some((event) => event.label === "js-import-handleasync-currdata-before"),
      jsImportAsyncpromisehandlersAtResolverBound: events.some((event) => event.label === "js-import-asyncpromisehandlers-at-resolver-bound"),
      jsImportPromiseThenAsyncifyState: events.some((event) => event.label === "js-import-promise-then-asyncify-state"),
      cSysdepBeforeWait: events.some((event) => event.label === "c-sysdep-before-wait"),
      cSysdepAfterWaitReturn: events.some((event) => event.label === "c-sysdep-after-wait-return"),
      jsTerminalReadByteDequeue: events.some((event) => event.label === "js-terminal-read-byte-dequeue"),
      cSysdepByteDequeued: events.some((event) => event.label === "c-sysdep-byte-dequeued"),
      cKeyboardReadCharReached: events.some((event) => event.label === "c-keyboard-read-char-reached"),
      cKeyboardBeforeWaitImport: events.some((event) => event.label === "c-keyboard-before-wait-import"),
      cKeyboardAfterWaitReturn: events.some((event) => event.label === "c-keyboard-after-wait-return"),
    },
  };
}

function queueTerminalInput(input) {
  if (typeof context.__wasmacsQueueTerminalInput !== "function") {
    throw new Error("terminal input queue is unavailable");
  }
  const bytes = typeof input === "string"
    ? Array.from(input).map((char) => char.charCodeAt(0) & 255)
    : Array.from(input || []).map((byte) => byte & 255);
  lastInjectedInput = {
    text: typeof input === "string" ? input : undefined,
    bytes,
    waitId: currentWaitId(),
  };
  context.__wasmacsQueueTerminalInput(input);
}

function resolveCurrentWait() {
  if (typeof context.__wasmacsResolveHostInputWait !== "function") {
    throw new Error("host input wait resolver is unavailable");
  }
  const waitId = currentWaitId();
  context.__wasmacsResolveHostInputWait();
  lastResolvedWaitId = waitId;
  return waitId;
}

function updateRepeatedWaitCount() {
  const waitCount = currentWaitId();
  if (lastObservedWaitCount > 0 && waitCount > lastObservedWaitCount) {
    repeatedWaitCount += waitCount - lastObservedWaitCount;
  }
  lastObservedWaitCount = waitCount;
}

function currentWaitId() {
  return context.__wasmacsHostWaitForInputCount || 0;
}

async function pollForSchedulerEvent(label, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const events = Array.from(context.__wasmacsSchedulerEvents || []);
    if (events.some((e) => e.label === label)) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

function eventBefore(snapshots, firstLabel, secondLabel) {
  const events = allEvents(snapshots);
  const first = events.find((event) => event.label === firstLabel);
  const second = events.find((event) => event.label === secondLabel);
  return Boolean(first && second && first.seq < second.seq);
}

function eventAfter(snapshots, firstLabel, secondLabel) {
  const events = allEvents(snapshots);
  const first = events.find((event) => event.label === firstLabel);
  const second = events.find((event) => event.label === secondLabel);
  return Boolean(first && second && first.seq > second.seq);
}

function allEvents(snapshots) {
  const bySeq = new Map();
  for (const snapshot of snapshots) {
    for (const event of snapshot.scheduler?.recentEvents || []) {
      bySeq.set(event.seq, event);
    }
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

async function waitForHostInput(attempts = 500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (context.__wasmacsHostWaitForInputPending) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for asyncify host input waitpoint");
}

async function waitForHostInputAfter(previousWaitId, attempts = 500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (
      context.__wasmacsHostWaitForInputPending &&
      currentWaitId() > previousWaitId
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for next input wait after resolving wait ${previousWaitId}`);
}

function readCommandGuardDepth() {
  const gc = readDiagnosticJson("wasmacs_os_gc_permission_state");
  return gc && typeof gc === "object" ? gc.wasmacsGcGuardDepth : undefined;
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

function parseJsonl(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
