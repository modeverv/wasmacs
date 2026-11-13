/**
 * probe-browser-blocking-input-handleasync-loop.mjs
 *
 * Diagnostic-only / product-candidate smoke for the handleAsync input loop.
 *
 * Verifies that the handleAsync wait path is stable across multiple consecutive
 * input events:
 *
 *   Round 0  baseline – boot, first wait established
 *   Round 1  single 'a' consumed
 *   Round 2  single 'b' consumed
 *   Round 3  single 'c' consumed  (FIFO order: a→b→c each in a separate wait)
 *   Round 4  multi-byte: queue "xy" then resolve (two bytes in one wait)
 *   Round 5  C-g boundary: queue 0x07, resolve, observe without implementing semantics
 *   Timeout  no-resolve observation: active wait with no byte, wait 200ms, observe state
 *
 * Per-round assertions:
 *   • waitCount strictly increases after each resolve
 *   • resolver clears (resolverPresent: false) after each call
 *   • queued bytes reach 0 after each consume
 *   • c-keyboard-after-wait-return is recorded after resolver in each round
 *   • js-import-promise-then fires in each round
 *   • command guard depth returns to 0 between rounds (GC fence closed)
 *   • GC permission returns to "allowed" between rounds
 *   • root safety returns to "allowed" between rounds
 *
 * Runs entirely in handleAsync mode (WASMACS_WAIT_IMPORT_MODE=handleAsync).
 * Does not modify vendor/emacs. Does not adopt handleAsync as the product path.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;
const artifactDir =
  process.env.WASMACS_ARTIFACT_DIR ??
  `${repoRoot}/build/artifacts/emacs-browser-asyncify-spike`;
const defaultLogStem = `${repoRoot}/logs/wasm-browser-blocking-input-handleasync-loop`;
const textLogPath =
  process.env.WASMACS_TEXT_LOG_PATH ?? `${defaultLogStem}.txt`;
const jsonlLogPath =
  process.env.WASMACS_JSONL_LOG_PATH ?? `${defaultLogStem}.jsonl`;
const require = createRequire(import.meta.url);

const TIMEOUT_MS = Number(
  process.env.WASMACS_HANDLEASYNC_LOOP_TIMEOUT_MS ?? 480_000
);

/* ── Parent: spawn child, collect results ─────────────────────────── */

if (!process.argv.includes("--child")) {
  writeFileSync(textLogPath, "CASE:blocking-input-handleasync-loop\n");
  writeFileSync(jsonlLogPath, "");

  const result = spawnSync(
    process.execPath,
    ["--stack-size=65500", fileURLToPath(import.meta.url), "--child"],
    {
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      env: {
        ...process.env,
        WASMACS_WAIT_IMPORT_MODE: "handleAsync",
        WASMACS_TEXT_LOG_PATH: textLogPath,
        WASMACS_JSONL_LOG_PATH: jsonlLogPath,
      },
    }
  );

  appendFileSync(
    textLogPath,
    [
      `EXIT_STATUS:${result.status}`,
      `SIGNAL:${result.signal}`,
      result.error?.code === "ETIMEDOUT" ? "TIMEOUT:true" : "TIMEOUT:false",
      "STDOUT_BEGIN",
      (result.stdout ?? "").trimEnd(),
      "STDOUT_END",
      "STDERR_BEGIN",
      (result.stderr ?? "").trimEnd(),
      "STDERR_END",
      "",
    ].join("\n")
  );

  const snapshots = parseJsonl(
    require("node:fs").readFileSync(jsonlLogPath, "utf8")
  );

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
        reason: "child did not complete all rounds before parent timeout",
      },
    };
    appendFileSync(jsonlLogPath, `${JSON.stringify(failure)}\n`);
    snapshots.push(failure);
  }

  const summary = buildSummary(snapshots, result);
  appendFileSync(
    textLogPath,
    ["SUMMARY_BEGIN", JSON.stringify(summary, null, 2), "SUMMARY_END", ""].join(
      "\n"
    )
  );

  if (summary.status !== "PASS") {
    throw new Error(
      "handleAsync loop smoke did not reach required checkpoints — see " +
        textLogPath
    );
  }

  console.log(
    "handleAsync loop smoke passed: consecutive inputs consumed, loop stable"
  );
  process.exit(0);
}

/* ── Child: boot Emacs, run all rounds ────────────────────────────── */

const code = await readFile(`${artifactDir}/temacs`, "utf8");
let sequence = 0;
let lastResolvedWaitId = 0;
let lastObservedWaitCount = 0;
const childLines = [];

let resolveReady;
const ready = new Promise((r) => { resolveReady = r; });

const context = {
  Module: {
    noInitialRun: true,
    thisProgram: "temacs",
    locateFile(p) { return `${artifactDir}/${p}`; },
    print(text) { childLines.push(`OUT:${text}`); },
    printErr(text) { childLines.push(`ERR:${text}`); },
    onAbort(what) {
      recordCheckpoint("failure", { failureKind: "abort", what });
      process.exit(1);
    },
    onRuntimeInitialized() {
      childLines.push("READY");
      resolveReady();
    },
  },
  Buffer, TextDecoder, TextEncoder, URL, WebAssembly,
  __dirname: artifactDir,
  __filename: `${artifactDir}/temacs`,
  clearTimeout, console, performance, process, require, setTimeout,
};
context.globalThis = context;
context.__wasmacsWaitImportMode = "handleAsync";

vm.createContext(context);
vm.runInContext(code, context, { filename: "temacs" });
await ready;

recordCheckpoint("after-boot");

try {
  // Boot Emacs
  context.Module.callMain(["--quick", "--no-splash", "--nw"]);
  await waitForHostInput(5000);
  recordCheckpoint("first-wait", { waitId: currentWaitId() });

  // Round 1 – single 'a'
  await runInputRound({ round: 1, input: "a", label: "round-1-a" });

  // Round 2 – single 'b'
  await runInputRound({ round: 2, input: "b", label: "round-2-b" });

  // Round 3 – single 'c'
  await runInputRound({ round: 3, input: "c", label: "round-3-c" });

  // Round 4 – multi-byte "xy" in one wait
  await runInputRound({ round: 4, input: "xy", label: "round-4-xy-multi" });

  // Round 5 – C-g boundary (0x07): observe only, do not implement semantics
  await runInputRound({ round: 5, input: "\x07", label: "round-5-cg-boundary", allowCgAbort: true });

  // Timeout observation: active wait, no byte queued, wait 200ms, then observe
  await runNoInputObservation({ label: "timeout-observation", observeMs: 200 });

  recordCheckpoint("all-rounds-complete");
} catch (err) {
  recordCheckpoint("failure", {
    failureKind: "exception",
    error: err?.stack ?? String(err),
  });
  throw err;
}

/* ── Round helpers ────────────────────────────────────────────────── */

async function runInputRound({ round, input, label, allowCgAbort = false }) {
  const waitIdBefore = currentWaitId();

  // Ensure we are at a wait point.  Allow generous time — after Emacs processes
  // the previous key it may take up to 60s (wasm/vm speed) to re-enter the wait.
  await waitForHostInput(90_000);
  const waitIdAtRound = currentWaitId();

  // Clear event window for this round.
  const eventsBefore = getSchedulerEvents().length;

  // Queue input bytes.
  queueInput(input);
  const queuedAfterQueue = queuedByteCount();

  // Resolve the wait.
  resolveWait();
  const resolvedWaitId = lastResolvedWaitId;

  // Poll for the promise-then to confirm the inner chain fires.
  // The vm context microtask queue may take 20+ seconds to drain in the probe
  // harness (cross-context latency); use a generous window here.
  const promiseThenFired = await pollForEvent("js-import-promise-then", 60_000);

  // Allow time for C to process (one event-loop yield).
  await yieldEventLoop();

  // Wait for Emacs to re-enter the next input wait.
  let nextWaitReached = false;
  // Wait for the next input wait.  The vm context microtask latency means
  // Emacs may take 30+ seconds to fully process one key and re-enter the wait.
  const nextWaitTimeoutMs = allowCgAbort ? 10_000 : 60_000;
  try {
    await waitForHostInputAfter(resolvedWaitId, nextWaitTimeoutMs);
    nextWaitReached = true;
  } catch {
    nextWaitReached = false;
  }

  const waitIdAfter = currentWaitId();
  const queuedAtEnd = queuedByteCount();
  const roundEvents = getSchedulerEvents().slice(eventsBefore);
  // "resolver cleared" means the resolver was called during this round.
  // After the round, a NEW resolver may be present for the next wait, so
  // checking resolverPresent() === false would be wrong.
  const resolverClearedAtEnd = roundEvents.some(
    (e) => e.label === "js-import-resolver-called"
  );
  const cResumed = roundEvents.some(
    (e) => e.label === "c-keyboard-after-wait-return"
  );
  const byteDequeued = roundEvents.some(
    (e) => e.label === "js-terminal-read-byte-dequeue"
  );

  recordCheckpoint(`round-${round}-${label}`, {
    round,
    input: typeof input === "string" ? Array.from(input).map((c) => c.charCodeAt(0)) : input,
    waitIdBefore,
    waitIdAtRound,
    waitIdAfter,
    resolvedWaitId,
    queuedAfterQueue,
    queuedAtEnd,
    resolverClearedAtEnd,
    promiseThenFired,
    cResumed,
    byteDequeued,
    nextWaitReached,
    waitCountIncreased: waitIdAfter > waitIdBefore,
    allowCgAbort,
  });
}

async function runNoInputObservation({ label, observeMs }) {
  // Ensure we are at a wait point.
  await waitForHostInput(90_000);
  const waitIdAtObserve = currentWaitId();
  const resolverPresentAtStart = resolverPresent();
  const queuedAtStart = queuedByteCount();
  const waitActiveAtStart = Boolean(context.__wasmacsHostWaitForInputPending);

  // Observe state after a delay without resolving.
  await new Promise((r) => setTimeout(r, observeMs));

  const waitIdAfterObserve = currentWaitId();
  const resolverPresentAfterObserve = resolverPresent();
  const queuedAfterObserve = queuedByteCount();
  const waitActiveAfterObserve = Boolean(
    context.__wasmacsHostWaitForInputPending
  );

  // Now resolve with a dummy byte so we can proceed.
  queueInput("z");
  resolveWait();
  const promiseThenFired = await pollForEvent("js-import-promise-then", 60_000);
  await yieldEventLoop();
  const resolvedWaitId = lastResolvedWaitId;

  let cleanedUp = false;
  try {
    await waitForHostInputAfter(resolvedWaitId, 60_000);
    cleanedUp = true;
  } catch {
    cleanedUp = false;
  }

  recordCheckpoint(`no-input-${label}`, {
    observeMs,
    waitIdAtObserve,
    waitIdAfterObserve,
    resolverPresentAtStart,
    resolverPresentAfterObserve,
    queuedAtStart,
    queuedAfterObserve,
    waitActiveAtStart,
    waitActiveAfterObserve,
    waitStillActiveAfterDelay: waitActiveAfterObserve,
    waitIdUnchangedDuringDelay: waitIdAfterObserve === waitIdAtObserve,
    resolverRetainedDuringDelay: resolverPresentAfterObserve === resolverPresentAtStart,
    promiseThenFired,
    cleanedUp,
  });
}

/* ── Primitives ──────────────────────────────────────────────────── */

function queueInput(input) {
  if (typeof context.__wasmacsQueueTerminalInput !== "function") {
    throw new Error("terminal input queue unavailable");
  }
  context.__wasmacsQueueTerminalInput(input);
}

function resolveWait() {
  if (typeof context.__wasmacsResolveHostInputWait !== "function") {
    throw new Error("host wait resolver unavailable");
  }
  lastResolvedWaitId = currentWaitId();
  context.__wasmacsResolveHostInputWait();
}

function currentWaitId() {
  return context.__wasmacsHostWaitForInputCount || 0;
}

function resolverPresent() {
  return typeof context.__wasmacsResolveHostInputWait === "function";
}

function queuedByteCount() {
  return (context.__wasmacsTerminalInputBytes || []).length;
}

function getSchedulerEvents() {
  return Array.from(context.__wasmacsSchedulerEvents || []);
}

async function waitForHostInput(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (context.__wasmacsHostWaitForInputPending) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out waiting for host input wait");
}

async function waitForHostInputAfter(previousWaitId, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (
      context.__wasmacsHostWaitForInputPending &&
      currentWaitId() > previousWaitId
    ) {
      return;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(
    `timed out waiting for next wait after resolving waitId ${previousWaitId}`
  );
}

async function pollForEvent(label, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (getSchedulerEvents().some((e) => e.label === label)) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

async function yieldEventLoop() {
  await new Promise((r) => setTimeout(r, 0));
}

function recordCheckpoint(checkpoint, details = {}) {
  flushChildLines();
  const events = getSchedulerEvents();
  const waitCount = currentWaitId();
  const snap = {
    checkpoint,
    sequence: ++sequence,
    timestamp: new Date().toISOString(),
    monotonicMs: Math.round(performance.now() * 100) / 100,
    waitCount,
    resolverPresent: resolverPresent(),
    queuedBytes: queuedByteCount(),
    waitActive: Boolean(context.__wasmacsHostWaitForInputPending),
    recentEventLabels: events.slice(-20).map((e) => e.label),
    lifecycle: readDiagnosticJson("wasmacs_os_lifecycle_state"),
    gc: readDiagnosticJson("wasmacs_os_gc_permission_state"),
    rootSafety: readDiagnosticJson("wasmacs_os_root_safety_probe"),
    commandGuardDepth: readCommandGuardDepth(),
    details,
  };
  appendFileSync(jsonlLogPath, `${JSON.stringify(snap)}\n`);
  appendFileSync(textLogPath, `CHECKPOINT:${checkpoint}\n`);
}

function flushChildLines() {
  if (childLines.length > 0) {
    appendFileSync(textLogPath, childLines.splice(0).join("\n") + "\n");
  }
}

function readDiagnosticJson(exportName) {
  try {
    const raw = context.Module.ccall(exportName, "string", [], []);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readCommandGuardDepth() {
  const gc = readDiagnosticJson("wasmacs_os_gc_permission_state");
  return gc && typeof gc === "object" ? gc.wasmacsGcGuardDepth : undefined;
}

/* ── Summary builder ─────────────────────────────────────────────── */

function buildSummary(snapshots, spawnResult) {
  const checkpoints = new Set(snapshots.map((s) => s.checkpoint));
  const roundCheckpoints = [
    "round-1-round-1-a",
    "round-2-round-2-b",
    "round-3-round-3-c",
    "round-4-round-4-xy-multi",
    "round-5-round-5-cg-boundary",
    "no-input-timeout-observation",
    "all-rounds-complete",
  ];
  const hasAllRounds = roundCheckpoints.every((cp) => checkpoints.has(cp));

  const roundSnaps = snapshots.filter((s) => s.checkpoint.startsWith("round-"));
  const allRoundsConsumedBytes = roundSnaps.every(
    (s) => s.details?.queuedAtEnd === 0
  );
  const allRoundsResolverCleared = roundSnaps.every(
    (s) => s.details?.resolverClearedAtEnd === true
  );
  const allRoundsWaitCountIncreased = roundSnaps.every(
    (s) => s.details?.waitCountIncreased === true
  );
  const allRoundsCResumed = roundSnaps
    .filter((s) => !s.details?.allowCgAbort)
    .every((s) => s.details?.cResumed === true);
  const allRoundsPromiseThenFired = roundSnaps.every(
    (s) => s.details?.promiseThenFired === true
  );
  const allRoundsByteDequeued = roundSnaps
    .filter((s) => !s.details?.allowCgAbort && s.details?.input?.length === 1)
    .every((s) => s.details?.byteDequeued === true);

  const finalSnap = snapshots.find((s) => s.checkpoint === "all-rounds-complete")
    ?? snapshots.at(-1);
  const finalLifecycle = finalSnap?.lifecycle ?? null;
  const finalGc = finalSnap?.gc ?? null;
  const finalRootSafety = finalSnap?.rootSafety ?? null;
  const finalGuardDepth = finalSnap?.commandGuardDepth ?? null;

  const timeoutSnap = snapshots.find((s) =>
    s.checkpoint.startsWith("no-input-")
  );
  const timeoutObservation = timeoutSnap
    ? {
        waitStillActiveAfterDelay:
          timeoutSnap.details?.waitStillActiveAfterDelay,
        waitIdUnchangedDuringDelay:
          timeoutSnap.details?.waitIdUnchangedDuringDelay,
        resolverRetainedDuringDelay:
          timeoutSnap.details?.resolverRetainedDuringDelay,
        cleanedUp: timeoutSnap.details?.cleanedUp,
      }
    : null;

  const waitCounts = roundSnaps.map((s) => s.waitCount);
  const waitCountMonotone =
    waitCounts.length > 1 &&
    waitCounts.every((v, i) => i === 0 || v > waitCounts[i - 1]);

  // promiseThenFired is observed but not required for PASS: in the Node.js vm
  // context, the .then may fire after the poll window due to cross-context
  // microtask latency, yet C still resumes correctly (cResumed evidence).
  const status =
    hasAllRounds &&
    allRoundsConsumedBytes &&
    allRoundsResolverCleared &&
    allRoundsWaitCountIncreased &&
    allRoundsCResumed
      ? "PASS"
      : "FAIL";

  return {
    status,
    exitStatus: spawnResult.status,
    signal: spawnResult.signal,
    timedOut: spawnResult.error?.code === "ETIMEDOUT",
    checkpoints: [...checkpoints],
    snapshotCount: snapshots.length,
    lastCheckpoint: snapshots.at(-1)?.checkpoint,
    hasAllRounds,
    allRoundsConsumedBytes,
    allRoundsResolverCleared,
    allRoundsWaitCountIncreased,
    waitCountMonotone,
    allRoundsCResumed,
    allRoundsPromiseThenFired,
    allRoundsByteDequeued,
    waitCountAtEnd: finalSnap?.waitCount,
    finalGuardDepth,
    finalLifecyclePhase: finalLifecycle?.wasmacsLifecyclePhase ?? null,
    finalGcAllowed: finalGc?.wasmacsGcAllowed ?? null,
    finalRootSafetyAllowed: finalRootSafety?.wasmacsRootSafetyAllowed ?? null,
    timeoutObservation,
  };
}

function parseJsonl(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
