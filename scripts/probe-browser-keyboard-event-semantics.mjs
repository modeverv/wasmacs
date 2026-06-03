/**
 * probe-browser-keyboard-event-semantics.mjs
 *
 * Diagnostic probe for keyboard.c event semantics.
 *
 * Observes what Emacs does with each received byte:
 *   • printable 'a'            → self-insert-command?
 *   • printable sequence 'abc' → FIFO, one per command iteration
 *   • Enter (0x0d = CR)        → newline command?
 *   • Backspace (0x7f = DEL)   → delete-backward-char?
 *   • C-g (0x07)               → keyboard-quit path?
 *   • ESC sequence (ESC + [A)  → arrow key / escape prefix?
 *
 * For each key, reads Emacs state via wasmacs_eval_string WHILE SUSPENDED
 * at the next wasmacs_host_wait_for_input (i.e., after the command ran):
 *   • current-buffer name
 *   • buffer-string content
 *   • (point) position
 *   • (symbol-name last-command)
 *   • (symbol-name this-command) [same as last-command at wait time]
 *   • (minibuffer-depth)
 *   • wasmacs_command_state, wasmacs_minibuffer_state
 *
 * Uses handleAsync mode (default — no env var needed).
 * Does NOT implement any editor semantics in JS.
 * Does NOT modify vendor/emacs.
 *
 * Logs:
 *   logs/wasm-browser-keyboard-event-semantics.txt
 *   logs/wasm-browser-keyboard-event-semantics.jsonl
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir =
  process.env.WASMACS_ARTIFACT_DIR ??
  `${repoRoot}/artifacts/emacs-browser-asyncify-spike`;
const defaultLogStem = `${repoRoot}/logs/wasm-browser-keyboard-event-semantics`;
const textLogPath =
  process.env.WASMACS_TEXT_LOG_PATH ?? `${defaultLogStem}.txt`;
const jsonlLogPath =
  process.env.WASMACS_JSONL_LOG_PATH ?? `${defaultLogStem}.jsonl`;
const require = createRequire(import.meta.url);

const TIMEOUT_MS = Number(process.env.WASMACS_KEYBOARD_TIMEOUT_MS ?? 600_000);

/* ── Parent: spawn child ─────────────────────────────────────────── */

if (!process.argv.includes("--child")) {
  writeFileSync(textLogPath, "CASE:keyboard-event-semantics\n");
  writeFileSync(jsonlLogPath, "");

  const result = spawnSync(
    process.execPath,
    ["--stack-size=65500", fileURLToPath(import.meta.url), "--child"],
    {
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      env: { ...process.env },
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
  const summary = buildSummary(snapshots, result);
  appendFileSync(
    textLogPath,
    ["SUMMARY_BEGIN", JSON.stringify(summary, null, 2), "SUMMARY_END", ""].join("\n")
  );

  if (summary.status !== "PASS") {
    throw new Error(
      "keyboard event semantics probe did not pass — see " + textLogPath
    );
  }
  console.log(
    "keyboard event semantics probe passed — see " + textLogPath
  );
  process.exit(0);
}

/* ── Child: boot Emacs, run all key observations ─────────────────── */

const code = await readFile(`${artifactDir}/temacs`, "utf8");
let sequence = 0;
let lastResolvedWaitId = 0;

let resolveReady;
const ready = new Promise((r) => { resolveReady = r; });

const context = {
  Module: {
    noInitialRun: true,
    thisProgram: "temacs",
    locateFile(p) { return `${artifactDir}/${p}`; },
    print() {},
    printErr() {},
    onAbort(what) {
      recordCheckpoint("failure", { failureKind: "abort", what });
      process.exit(1);
    },
    onRuntimeInitialized() { resolveReady(); },
  },
  Buffer, TextDecoder, TextEncoder, URL, WebAssembly,
  __dirname: artifactDir,
  __filename: `${artifactDir}/temacs`,
  clearTimeout, console, performance, process, require, setTimeout,
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(code, context, { filename: "temacs" });
await ready;

recordCheckpoint("after-boot");

try {
  context.Module.callMain(["--quick", "--no-splash", "--nw"]);
  await waitForHostInput(5_000);
  recordCheckpoint("first-wait", { waitId: currentWaitId() });

  // Read initial state before any input
  const initialState = readEmacsState("initial");
  recordCheckpoint("initial-state", { ...initialState });

  // ── Key sequence ────────────────────────────────────────────────
  // Each key:  queue → resolve → poll promise-then → wait next wait
  //            → read Emacs state at suspension point

  const keys = [
    { label: "printable-a",   input: "a",       bytes: [97] },
    { label: "printable-b",   input: "b",       bytes: [98] },
    { label: "printable-c",   input: "c",       bytes: [99] },
    { label: "enter-cr",      input: "CR",      bytes: [13] },
    { label: "backspace-del", input: "DEL",     bytes: [127] },
    { label: "cg-quit",       input: "C-g",     bytes: [7],  skipNextWaitCheck: true },
    { label: "escape-prefix", input: "ESC",     bytes: [27] },
    // After ESC: send a non-special byte to consume the prefix
    { label: "after-escape",  input: "x",       bytes: [120] },
  ];

  const keyResults = [];
  for (const key of keys) {
    const result = await runKeyObservation(key);
    keyResults.push(result);
  }

  // Final state
  const finalGcState = safeCcallJson("wasmacs_os_gc_permission_state");
  const finalGuardDepth =
    finalGcState?.wasmacsGcGuardDepth ?? finalGcState?.garbageCollectionInhibited ?? null;
  const finalWaitCount = currentWaitId();

  recordCheckpoint("all-keys-complete", {
    finalWaitCount,
    finalGuardDepth,
    keyCount: keyResults.length,
  });

} catch (err) {
  recordCheckpoint("failure", {
    failureKind: "exception",
    error: err?.stack ?? String(err),
  });
  throw err;
}

/* ── Key observation ─────────────────────────────────────────────── */

async function runKeyObservation({ label, input, bytes, skipNextWaitCheck = false }) {
  await waitForHostInput(90_000);
  const waitIdBefore = currentWaitId();
  const eventsBefore = getSchedulerEvents().length;

  // Queue the byte(s) and resolve
  queueInput(bytes);
  const queuedAfterQueue = queuedByteCount();
  resolveWait();
  const resolvedWaitId = lastResolvedWaitId;

  // Poll for promise-then (confirms Asyncify rewind fired)
  const promiseThenFired = await pollForEvent("js-import-promise-then", 60_000);
  await yieldEventLoop();

  // Wait for next wait (generous — vm microtask latency ~30s/key)
  let nextWaitReached = false;
  const nextWaitMs = skipNextWaitCheck ? 10_000 : 60_000;
  try {
    await waitForHostInputAfter(resolvedWaitId, nextWaitMs);
    nextWaitReached = true;
  } catch {
    nextWaitReached = false;
  }

  const waitIdAfter = currentWaitId();
  const queuedAtEnd = queuedByteCount();
  const roundEvents = getSchedulerEvents().slice(eventsBefore);
  const cResumed = roundEvents.some((e) => e.label === "c-keyboard-after-wait-return");
  const byteDequeued = roundEvents.some((e) => e.label === "js-terminal-read-byte-dequeue");
  const resolverCleared = roundEvents.some((e) => e.label === "js-import-resolver-called");

  // Read Emacs state at the next wait point (after command ran)
  const emacsState = nextWaitReached ? readEmacsState(label) : null;

  const result = {
    label,
    input,
    bytes,
    waitIdBefore,
    waitIdAfter,
    resolvedWaitId,
    queuedAfterQueue,
    queuedAtEnd,
    resolverCleared,
    promiseThenFired,
    cResumed,
    byteDequeued,
    nextWaitReached,
    waitCountIncreased: waitIdAfter > waitIdBefore,
    emacsState,
  };

  recordCheckpoint(`key-${label}`, result);
  return result;
}

/* ── Emacs state readback ────────────────────────────────────────── */

function readEmacsState(_label) {
  // wasmacs_eval_string is callable while Emacs is suspended at a wait point
  // because wasmacs_command_busy = 0 when reached via callMain (not via
  // wasmacs_os_begin_command or wasmacs_command_begin_*).
  const state = {};

  const evalForms = [
    ["bufferName",   "(buffer-name)"],
    ["bufferString", "(buffer-string)"],
    ["point",        "(number-to-string (point))"],
    ["pointMax",     "(number-to-string (point-max))"],
    ["lastCommand",  "(condition-case nil (symbol-name last-command) (error \"unknown\"))"],
    ["thisCommand",  "(condition-case nil (symbol-name this-command) (error \"unknown\"))"],
    ["minibufferDepth", "(number-to-string (minibuffer-depth))"],
    ["commandState", null],  // via wasmacs_command_state export
    ["minibufferState", null],  // via wasmacs_minibuffer_state export
  ];

  for (const [key, form] of evalForms) {
    if (form === null) continue;
    try {
      const status = context.Module.ccall(
        "wasmacs_eval_string",
        "number",
        ["string"],
        [form]
      );
      const raw = context.Module.ccall("wasmacs_last_result", "string", [], []);
      state[key] = { status, value: raw };
    } catch (err) {
      state[key] = { error: String(err) };
    }
  }

  // Additional exports always readable
  try {
    state.commandState = context.Module.ccall("wasmacs_command_state", "string", [], []);
  } catch {}
  try {
    state.minibufferState = context.Module.ccall("wasmacs_minibuffer_state", "string", [], []);
  } catch {}

  return state;
}

/* ── Summary builder ─────────────────────────────────────────────── */

function buildSummary(snapshots, spawnResult) {
  const checkpoints = snapshots.map((s) => s.checkpoint);
  const timedOut = spawnResult.error?.code === "ETIMEDOUT";
  const hasFirstWait = checkpoints.includes("first-wait");
  const hasInitialState = checkpoints.includes("initial-state");
  const hasAllKeys = checkpoints.includes("all-keys-complete");

  const keySnaps = snapshots.filter((s) => s.checkpoint.startsWith("key-"));
  const keyMap = Object.fromEntries(keySnaps.map((s) => [s.checkpoint, s.details]));

  // Core criteria
  const printableADequeued = keyMap["key-printable-a"]?.byteDequeued === true;
  const printableAResumed = keyMap["key-printable-a"]?.cResumed === true;
  const printableANextWait = keyMap["key-printable-a"]?.nextWaitReached === true;
  const cgLoopSurvived =
    keyMap["key-cg-quit"]?.cResumed === true ||
    keyMap["key-after-escape"]?.cResumed === true ||
    keySnaps.some((s) => s.details?.waitCountIncreased && s.details?.label !== "cg-quit");

  // Eval status: 0 = success, 3 = busy, other = error
  const evalWorked = keySnaps.some(
    (s) => s.details?.emacsState?.bufferString?.status === 0
  );
  const evalBusy = keySnaps.every(
    (s) => s.details?.emacsState?.bufferString?.status === 3
  );

  // Buffer content observations
  const bufferContents = keySnaps
    .filter((s) => s.details?.emacsState?.bufferString?.status === 0)
    .map((s) => ({
      label: s.details?.label,
      bufferString: s.details?.emacsState?.bufferString?.value,
      point: s.details?.emacsState?.point?.value,
      lastCommand: s.details?.emacsState?.lastCommand?.value,
      thisCommand: s.details?.emacsState?.thisCommand?.value,
    }));

  const allKeys = keySnaps.map((s) => ({
    label: s.details?.label,
    bytes: s.details?.bytes,
    byteDequeued: s.details?.byteDequeued,
    cResumed: s.details?.cResumed,
    nextWaitReached: s.details?.nextWaitReached,
    waitCountIncreased: s.details?.waitCountIncreased,
    evalStatus: s.details?.emacsState?.bufferString?.status,
    lastCommand: s.details?.emacsState?.lastCommand?.value,
    bufferStringLength: s.details?.emacsState?.bufferString?.value?.length ?? null,
  }));

  const finalSnap = snapshots.find((s) => s.checkpoint === "all-keys-complete");

  const status =
    !timedOut &&
    spawnResult.exitStatus !== null &&
    (spawnResult.status === 0 || spawnResult.status === null) &&
    hasFirstWait &&
    printableADequeued &&
    printableAResumed &&
    printableANextWait &&
    cgLoopSurvived
      ? "PASS"
      : "FAIL";

  return {
    status,
    timedOut,
    exitStatus: spawnResult.status,
    signal: spawnResult.signal,
    checkpoints,
    hasFirstWait,
    hasInitialState,
    hasAllKeys,
    printableADequeued,
    printableAResumed,
    printableANextWait,
    cgLoopSurvived,
    evalWorked,
    evalBusy,
    bufferContents,
    allKeys,
    finalWaitCount: finalSnap?.details?.finalWaitCount ?? null,
    finalGuardDepth: finalSnap?.details?.finalGuardDepth ?? null,
  };
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

function queuedByteCount() {
  return (context.__wasmacsTerminalInputBytes || []).length;
}

function getSchedulerEvents() {
  return Array.from(context.__wasmacsSchedulerEvents || []);
}

function safeCcallJson(exportName) {
  try {
    const raw = context.Module.ccall(exportName, "string", [], []);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function waitForHostInput(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (context.__wasmacsHostWaitForInputPending) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out waiting for host input wait");
}

async function waitForHostInputAfter(afterWaitId, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (
      context.__wasmacsHostWaitForInputPending &&
      (context.__wasmacsHostWaitForInputCount || 0) > afterWaitId
    )
      return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(
    `timed out waiting for host input wait after waitId ${afterWaitId}`
  );
}

async function pollForEvent(label, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (
      (context.__wasmacsSchedulerEvents || []).some((e) => e.label === label)
    )
      return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

async function yieldEventLoop() {
  await new Promise((r) => setTimeout(r, 0));
}

function recordCheckpoint(checkpoint, details = {}) {
  const snap = {
    checkpoint,
    sequence: sequence++,
    timestamp: new Date().toISOString(),
    monotonicMs: Math.round(performance.now()),
    details,
  };
  appendFileSync(jsonlLogPath, JSON.stringify(snap) + "\n");
  const { waitId, waitCount } = details;
  const parts = [`checkpoint=${checkpoint}`];
  if (waitId !== undefined) parts.push(`waitId=${waitId}`);
  if (waitCount !== undefined) parts.push(`waitCount=${waitCount}`);
  appendFileSync(textLogPath, `t=${Math.round(performance.now())}ms  ${parts.join("  ")}\n`);
}

/* ── JSONL parser + summary (parent only) ────────────────────────── */

function parseJsonl(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}
