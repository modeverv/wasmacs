/**
 * probe-browser-product-input-smoke.mjs
 *
 * Smoke test for the browser product input path:
 *   keydown event fields → browserKeyEventToEmacsBytes → byte queue → handleAsync → Emacs
 *
 * Proves end-to-end that:
 *   1. browserKeyEventToEmacsBytes converts synthetic key events to the correct bytes
 *   2. Bytes reach Emacs via __wasmacsQueueTerminalInput + handleAsync wait resolver
 *   3. Emacs processes them with the correct command semantics (JS owns no semantics)
 *   4. buffer-string / point / last-command are correct after each key
 *
 * Key script:
 *   a, b, c   → self-insert-command, buffer accumulates "abc"
 *   Enter     → newline, buffer becomes "abc\n"
 *   Backspace → delete-backward-char, buffer returns to "abc"
 *   C-g       → keyboard-quit, loop survives, buffer unchanged
 *   Alt+x     → [27, 120] batch → execute-extended-command (M-x minibuffer)
 *
 * Uses handleAsync mode (product default — no env var needed).
 * Does NOT implement any editor semantics in JS.
 * Does NOT modify vendor/emacs.
 *
 * Logs:
 *   logs/browser-product-input-smoke.txt
 *   logs/browser-product-input-smoke.jsonl
 *
 * Path relationship:
 *   OLD path: wasm-worker.js uses wasmacs_eval_string + Lisp command forms
 *             (persistent spike artifact, batch eval per keypress)
 *   NEW path: asyncify worker uses __wasmacsQueueTerminalInput + handleAsync
 *             (asyncify spike artifact, real Emacs command loop)
 *   This probe verifies NEW path only. Old path is unchanged.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { browserKeyEventToEmacsBytes } from "../app/src/emacs-key-bytes.js";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir =
  process.env.WASMACS_ARTIFACT_DIR ??
  `${repoRoot}/artifacts/emacs-browser-asyncify-spike`;
const defaultLogStem = `${repoRoot}/logs/browser-product-input-smoke`;
const textLogPath =
  process.env.WASMACS_TEXT_LOG_PATH ?? `${defaultLogStem}.txt`;
const jsonlLogPath =
  process.env.WASMACS_JSONL_LOG_PATH ?? `${defaultLogStem}.jsonl`;
const require = createRequire(import.meta.url);

const TIMEOUT_MS = Number(process.env.WASMACS_PRODUCT_INPUT_TIMEOUT_MS ?? 600_000);

/* ── Parent: spawn child ─────────────────────────────────────────── */

if (!process.argv.includes("--child")) {
  writeFileSync(textLogPath, "CASE:browser-product-input-smoke\n");
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
      "browser product input smoke did not pass — see " + textLogPath
    );
  }
  console.log("browser product input smoke passed — see " + textLogPath);
  process.exit(0);
}

/* ── Child: boot Emacs, run key script ──────────────────────────── */

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

// Key script: synthetic key events → browserKeyEventToEmacsBytes → Emacs
const keyScript = [
  { label: "printable-a",  event: { key: "a" },                 expectedBuffer: "a",     expectedCommand: "self-insert-command" },
  { label: "printable-b",  event: { key: "b" },                 expectedBuffer: "ab",    expectedCommand: "self-insert-command" },
  { label: "printable-c",  event: { key: "c" },                 expectedBuffer: "abc",   expectedCommand: "self-insert-command" },
  { label: "enter",        event: { key: "Enter" },             expectedBuffer: "abc\n", expectedCommand: "newline" },
  { label: "backspace",    event: { key: "Backspace" },         expectedBuffer: "abc",   expectedCommand: "delete-backward-char" },
  { label: "ctrl-g",       event: { key: "g", ctrlKey: true },  expectedBuffer: "abc",   expectedCommand: "keyboard-quit", skipNextWait: true },
  { label: "alt-x",        event: { key: "x", altKey: true },   expectedCommand: "execute-extended-command" },
];

try {
  context.Module.callMain(["--quick", "--no-splash", "--nw"]);
  await waitForHostInput(5_000);
  recordCheckpoint("first-wait", { waitId: currentWaitId() });

  const keyResults = [];
  for (const keyDef of keyScript) {
    const bytes = browserKeyEventToEmacsBytes(keyDef.event);
    if (bytes === null) {
      recordCheckpoint(`key-${keyDef.label}`, { label: keyDef.label, skipped: true, reason: "no byte mapping" });
      keyResults.push({ ...keyDef, bytes: null, skipped: true });
      continue;
    }
    const result = await runKeyObservation({ ...keyDef, bytes });
    keyResults.push(result);
  }

  const finalGcState = safeCcallJson("wasmacs_os_gc_permission_state");
  const finalGuardDepth =
    finalGcState?.wasmacsGcGuardDepth ?? finalGcState?.garbageCollectionInhibited ?? null;
  const finalWaitCount = currentWaitId();

  recordCheckpoint("all-keys-complete", {
    finalWaitCount,
    finalGuardDepth,
    keyCount: keyResults.length,
    inputPath: "browserKeyEventToEmacsBytes → __wasmacsQueueTerminalInput → handleAsync",
  });

} catch (err) {
  recordCheckpoint("failure", {
    failureKind: "exception",
    error: err?.stack ?? String(err),
  });
  throw err;
}

/* ── Key observation ─────────────────────────────────────────────── */

async function runKeyObservation({ label, event, bytes, expectedBuffer, expectedCommand, skipNextWait = false }) {
  await waitForHostInput(90_000);
  const waitIdBefore = currentWaitId();
  const eventsBefore = getSchedulerEvents().length;

  queueInput(bytes);
  const queuedAfterQueue = queuedByteCount();
  resolveWait();
  const resolvedWaitId = lastResolvedWaitId;

  const promiseThenFired = await pollForEvent("js-import-promise-then", 60_000);
  await yieldEventLoop();

  let nextWaitReached = false;
  const nextWaitMs = skipNextWait ? 10_000 : 60_000;
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

  const emacsState = nextWaitReached ? readEmacsState() : null;

  const lastCommand = emacsState?.lastCommand?.status === 0 ? emacsState.lastCommand.value : null;
  const bufferString = emacsState?.bufferString?.status === 0 ? emacsState.bufferString.value : null;
  const bufferMatches = expectedBuffer !== undefined ? bufferString === expectedBuffer : null;
  const commandMatches = expectedCommand !== undefined ? lastCommand === expectedCommand : null;

  const result = {
    label,
    event,
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
    lastCommand,
    bufferString,
    bufferMatches,
    commandMatches,
  };

  recordCheckpoint(`key-${label}`, result);
  return result;
}

/* ── Emacs state readback ────────────────────────────────────────── */

function readEmacsState() {
  const state = {};
  const forms = [
    ["bufferName",      "(buffer-name)"],
    ["bufferString",    "(buffer-string)"],
    ["point",           "(number-to-string (point))"],
    ["pointMax",        "(number-to-string (point-max))"],
    ["lastCommand",     "(condition-case nil (symbol-name last-command) (error \"unknown\"))"],
    ["minibufferDepth", "(number-to-string (minibuffer-depth))"],
  ];
  for (const [key, form] of forms) {
    try {
      const status = context.Module.ccall("wasmacs_eval_string", "number", ["string"], [form]);
      const raw = context.Module.ccall("wasmacs_last_result", "string", [], []);
      state[key] = { status, value: raw };
    } catch (err) {
      state[key] = { error: String(err) };
    }
  }
  try { state.commandState = context.Module.ccall("wasmacs_command_state", "string", [], []); } catch {}
  return state;
}

/* ── Summary builder ─────────────────────────────────────────────── */

function buildSummary(snapshots, spawnResult) {
  const checkpoints = snapshots.map((s) => s.checkpoint);
  const timedOut = spawnResult.error?.code === "ETIMEDOUT";
  const keySnaps = snapshots.filter((s) => s.checkpoint.startsWith("key-"));
  const keyMap = Object.fromEntries(keySnaps.map((s) => [s.checkpoint.slice(4), s.details]));

  const printableADequeued = keyMap["printable-a"]?.byteDequeued === true;
  const printableAResumed  = keyMap["printable-a"]?.cResumed === true;
  const printableANextWait = keyMap["printable-a"]?.nextWaitReached === true;
  const bufferAbc = keyMap["printable-c"]?.bufferString === "abc";
  const enterNewline = keyMap["enter"]?.lastCommand === "newline";
  const backspaceDelete = keyMap["backspace"]?.lastCommand === "delete-backward-char";
  const ctrlGQuit = keyMap["ctrl-g"]?.lastCommand === "keyboard-quit";
  const altXExecute = keyMap["alt-x"]?.lastCommand === "execute-extended-command";
  const cgLoopSurvived =
    keyMap["ctrl-g"]?.cResumed === true ||
    keySnaps.some((s) => s.details?.waitCountIncreased && s.details?.label !== "ctrl-g");

  const evalWorked = keySnaps.some((s) => s.details?.emacsState?.bufferString?.status === 0);
  const byteMappingCorrect =
    keySnaps.filter((s) => !s.details?.skipped)
      .every((s) => Array.isArray(s.details?.bytes) && s.details.bytes.length > 0);

  const allKeys = keySnaps.map((s) => ({
    label: s.details?.label,
    event: s.details?.event,
    bytes: s.details?.bytes,
    byteDequeued: s.details?.byteDequeued,
    cResumed: s.details?.cResumed,
    nextWaitReached: s.details?.nextWaitReached,
    lastCommand: s.details?.lastCommand,
    bufferString: s.details?.bufferString,
    bufferMatches: s.details?.bufferMatches,
    commandMatches: s.details?.commandMatches,
  }));

  const finalSnap = snapshots.find((s) => s.checkpoint === "all-keys-complete");

  const status =
    !timedOut &&
    (spawnResult.status === 0 || spawnResult.status === null) &&
    checkpoints.includes("first-wait") &&
    printableADequeued &&
    printableAResumed &&
    printableANextWait &&
    bufferAbc &&
    enterNewline &&
    backspaceDelete &&
    cgLoopSurvived
      ? "PASS"
      : "FAIL";

  return {
    status,
    timedOut,
    exitStatus: spawnResult.status,
    signal: spawnResult.signal,
    checkpoints,
    byteMappingCorrect,
    evalWorked,
    printableADequeued,
    printableAResumed,
    printableANextWait,
    bufferAbc,
    enterNewline,
    backspaceDelete,
    ctrlGQuit,
    altXExecute,
    cgLoopSurvived,
    allKeys,
    finalWaitCount: finalSnap?.details?.finalWaitCount ?? null,
    finalGuardDepth: finalSnap?.details?.finalGuardDepth ?? null,
    inputPath: finalSnap?.details?.inputPath ?? null,
    note: "JS owns no command semantics; all dispatch is Emacs-internal",
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
  throw new Error(`timed out waiting for host input wait after waitId ${afterWaitId}`);
}

async function pollForEvent(label, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if ((context.__wasmacsSchedulerEvents || []).some((e) => e.label === label)) return true;
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
  const parts = [`checkpoint=${checkpoint}`];
  if (details.label) parts.push(`label=${details.label}`);
  if (details.bytes) parts.push(`bytes=[${details.bytes}]`);
  if (details.lastCommand) parts.push(`lastCommand=${details.lastCommand}`);
  if (details.bufferString !== undefined) parts.push(`buffer=${JSON.stringify(details.bufferString)}`);
  appendFileSync(textLogPath, `t=${Math.round(performance.now())}ms  ${parts.join("  ")}\n`);
}

function parseJsonl(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}
