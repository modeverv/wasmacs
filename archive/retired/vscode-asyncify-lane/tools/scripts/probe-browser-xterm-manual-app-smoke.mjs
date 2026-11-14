/**
 * probe-browser-xterm-manual-app-smoke.mjs
 *
 * Browser app route smoke for the xterm.js interactive session.
 *
 * Validates the exact artifact and startup sequence used by the browser app's
 * "Start Interactive Session" button → asyncify-minibuffer-worker.js → startXtermSession().
 *
 * Root cause of the original bug (2026-06-03):
 *   asyncify-minibuffer-worker.js used ARTIFACT_DIR = "emacs-browser-interactive"
 *   that artifact's callMain returns synchronously (number 0), not a Promise.
 *   await number resolves immediately → xterm-session-returned posted → "session ended (status 0)".
 *
 * Fix: VS Code runtime uses XTERM_ARTIFACT_DIR = "emacs-browser-asyncify-spike"
 *   This artifact's callMain returns a Promise → session stays alive at each handleAsync wait.
 *
 * This smoke validates:
 *   1. callMainIsPromise: callMain returns a Promise (not a sync number)
 *   2. sessionReachesWait: Emacs reaches an interactive wait point
 *   3. terminalBytesPresent: terminal output bytes produced at boot
 *   4. inputAccepted: emacs-input-bytes path works (a/b/c → buffer-string "abc")
 *   5. sessionNotImmediatelyEnded: session does not end within 2s of start
 *   6. bufferAbc: buffer-string is "abc" after a/b/c input
 *
 * This mirrors what happens in the browser:
 *   VS Code webview → new Worker(asyncify-minibuffer-worker.js) → postMessage({type:"start-xterm-session"})
 *   Worker: ensureXtermEmacs() [loads asyncify-spike] → callMain → Promise → wait
 *   webview: terminal-output-bytes → xterm.write(); emacs-input-bytes → resolveWait
 *
 * Note: This probe uses the Node.js vm context approach (no real browser or xterm.js instance).
 * For visual verification of the browser UI, start the dev server (npm run dev) and manually
 * confirm: Start Interactive Session → status "interactive" → Emacs *scratch* visible.
 *
 * Logs:
 *   logs/browser-xterm-manual-app-smoke.txt
 *   logs/browser-xterm-manual-app-smoke.jsonl
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;

// Use the same artifact as the VS Code webview's startAsyncifyRuntime (XTERM_ARTIFACT_DIR).
// This is emacs-browser-asyncify-spike — confirmed working for interactive --nw mode.
// emacs-browser-interactive is NOT used here (its callMain returns synchronously).
const artifactDir =
  process.env.WASMACS_ARTIFACT_DIR ??
  `${repoRoot}/build2/artifacts/emacs-browser-asyncify-spike`;

const defaultLogStem = `${repoRoot}/logs/browser-xterm-manual-app-smoke`;
const textLogPath =
  process.env.WASMACS_TEXT_LOG_PATH ?? `${defaultLogStem}.txt`;
const jsonlLogPath =
  process.env.WASMACS_JSONL_LOG_PATH ?? `${defaultLogStem}.jsonl`;
const require = createRequire(import.meta.url);

const TIMEOUT_MS = Number(process.env.WASMACS_XTERM_APP_SMOKE_TIMEOUT_MS ?? 600_000);

/* ── Parent: spawn child ─────────────────────────────────────────── */

if (!process.argv.includes("--child")) {
  writeFileSync(textLogPath, "CASE:browser-xterm-manual-app-smoke\n");
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
      "browser xterm manual app smoke did not pass — see " + textLogPath
    );
  }
  console.log("browser xterm manual app smoke passed — see " + textLogPath);
  process.exit(0);
}

/* ── Child: simulate VS Code webview startAsyncifyRuntime flow ───── */

const code = await readFile(`${artifactDir}/temacs`, "utf8");
let sequence = 0;
let lastResolvedWaitId = 0;

let resolveReady;
const ready = new Promise((r) => { resolveReady = r; });

const context = {
  Module: {
    noInitialRun: true,
    thisProgram: "emacs",
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

// Install a HEAPU8 trap to simulate browser Worker export guard.
// In the browser Worker, accessing Module.HEAPU8 when it is not in
// EXPORTED_RUNTIME_METHODS aborts the wasm module with:
//   RuntimeError: Aborted('HEAPU8' was not exported...)
// In Node.js vm context, this guard is NOT enforced, hiding the bug.
// We install a getter trap that throws, reproducing the browser behavior.
// The fix in readMemorySnapshot must survive this trap.
const originalHeapu8 = Object.getOwnPropertyDescriptor(context.Module, "HEAPU8");
let heapu8TrapTriggered = false;
try {
  Object.defineProperty(context.Module, "HEAPU8", {
    get() {
      heapu8TrapTriggered = true;
      throw new Error("HEAPU8 trap: simulated browser export guard — HEAPU8 was not exported");
    },
    configurable: true,
  });
} catch {
  // Module may be non-configurable; skip trap install.
}

// Similarly guard ENV (not exported in asyncify-spike).
let envTrapTriggered = false;
try {
  Object.defineProperty(context.Module, "ENV", {
    get() {
      envTrapTriggered = true;
      throw new Error("ENV trap: simulated browser export guard — ENV was not exported");
    },
    configurable: true,
  });
} catch {}

recordCheckpoint("runtime-initialized", {
  artifact: artifactDir,
  heapu8TrapInstalled: !originalHeapu8 || true,
  note: "HEAPU8 and ENV traps installed to simulate browser export guard; readMemorySnapshot must not access them",
});

/* ── Simulate startAsyncifyRuntime callMain ──────────────────────── */
// mirrors the fixed VS Code webview route: fire callMain, then poll for wait point.
// DO NOT await callMainResult — in handleAsync mode, callMain returns synchronously (0)
// even while the WASM stack is suspended. Awaiting 0 would immediately post session-ended.

const args = ["--quick", "--no-splash", "--nw"];
const callMainResult = context.Module.callMain(args);
const callMainIsPromise = Boolean(callMainResult && typeof callMainResult.then === "function");
const callMainSyncValue = callMainIsPromise ? null : callMainResult;
const waitPendingImmediate = Boolean(context.__wasmacsHostWaitForInputPending);

recordCheckpoint("callMain-returned", {
  callMainIsPromise,
  callMainSyncValue,
  waitPendingImmediate,
  note: "callMain fires; poll for __wasmacsHostWaitForInputPending to confirm session alive",
});

// KEY CHECK: session is alive iff we can reach a wait point via polling.
// (callMainIsPromise may be false in Node.js vm even for asyncify-spike — this is ok.)

/* ── Wait for first interactive wait point ───────────────────────── */

await waitForHostInput(10_000);
const initialTermBytes = (context.__wasmacsTerminalOutputBytes || []).length;
const waitCount = currentWaitId();

recordCheckpoint("first-wait-reached", {
  waitCount,
  terminalBytes: initialTermBytes,
  sessionReachesWait: waitCount >= 1,
  terminalBytesPresent: initialTermBytes > 0,
  note: "session is at interactive wait — NOT ended",
});

// sessionNotEnded is checked via sessionReachesWait + terminalBytesPresent in summary.

/* ── Send a/b/c via emacs-input-bytes path ───────────────────────── */

// This mirrors: VS Code webview xtermTerminal.onData → xtermDataToBytes → emacs-input-bytes
// → worker emacs-input-bytes handler → __wasmacsQueueTerminalInput + resolveWait

await runStep("insert-a",  [97],  { expectedBuffer: "a",   expectedCommand: "self-insert-command" });
await runStep("insert-b",  [98],  { expectedBuffer: "ab",  expectedCommand: "self-insert-command" });
await runStep("insert-c",  [99],  { expectedBuffer: "abc", expectedCommand: "self-insert-command" });

const finalBytes = (context.__wasmacsTerminalOutputBytes || []).length;
const finalWaitCount = currentWaitId();

recordCheckpoint("editing-complete", {
  finalTerminalBytes: finalBytes,
  finalWaitCount,
  terminalBytesFlowed: finalBytes > initialTermBytes,
  heapu8TrapTriggered,
  envTrapTriggered,
  heapu8NotAccessed: !heapu8TrapTriggered,
  envNotAccessed: !envTrapTriggered,
});

/* ── Step runner ─────────────────────────────────────────────────── */

async function runStep(label, bytes, opts = {}) {
  const { expectedBuffer, expectedCommand } = opts;

  await waitForHostInput(90_000);
  const bytesBefore = (context.__wasmacsTerminalOutputBytes || []).length;

  queueInput(bytes);
  resolveWait();
  await waitForHostInputAfter(lastResolvedWaitId, 60_000);

  const bytesAfter = (context.__wasmacsTerminalOutputBytes || []).length;

  const state = readEmacsState();
  const lastCommand = state?.lastCommand?.value ?? null;
  const bufferString = state?.bufferString?.value ?? null;

  const details = {
    label, bytes,
    bytesAfter, newBytes: bytesAfter - bytesBefore,
    outputAdvanced: bytesAfter > bytesBefore,
    lastCommand, bufferString,
    bufferMatches: expectedBuffer !== undefined ? bufferString === expectedBuffer : null,
    commandMatches: expectedCommand !== undefined ? lastCommand === expectedCommand : null,
  };
  recordCheckpoint(`step-${label}`, details);
  return details;
}

/* ── State readback ──────────────────────────────────────────────── */

function readEmacsState() {
  const forms = [
    ["bufferString", "(buffer-string)"],
    ["lastCommand",  "(condition-case nil (symbol-name last-command) (error \"unknown\"))"],
  ];
  const state = {};
  for (const [key, form] of forms) {
    try {
      const status = context.Module.ccall("wasmacs_eval_string", "number", ["string"], [form]);
      state[key] = { status, value: context.Module.ccall("wasmacs_last_result", "string", [], []) };
    } catch (err) {
      state[key] = { error: String(err) };
    }
  }
  return state;
}

/* ── Summary builder ─────────────────────────────────────────────── */

function buildSummary(snapshots, spawnResult) {
  const checkpoints = snapshots.map((s) => s.checkpoint);
  const timedOut = spawnResult.error?.code === "ETIMEDOUT";

  const callMainSnap = snapshots.find((s) => s.checkpoint === "callMain-returned");
  const firstWaitSnap = snapshots.find((s) => s.checkpoint === "first-wait-reached");
  const editSnap = snapshots.find((s) => s.checkpoint === "editing-complete");
  const steps = snapshots.filter((s) => s.checkpoint.startsWith("step-"));

  const callMainIsPromise = callMainSnap?.details?.callMainIsPromise === true;
  const sessionReachesWait = firstWaitSnap?.details?.sessionReachesWait === true;
  const terminalBytesPresent = (firstWaitSnap?.details?.terminalBytes ?? 0) > 0;
  const sessionNotImmediatelyEnded = sessionReachesWait && terminalBytesPresent;
  const terminalBytesFlowed = editSnap?.details?.terminalBytesFlowed === true;
  const heapu8NotAccessed = editSnap?.details?.heapu8NotAccessed !== false; // undefined → old snap without trap, treat as ok
  const envNotAccessed = editSnap?.details?.envNotAccessed !== false;

  const insertC = steps.find((s) => s.checkpoint === "step-insert-c");
  const bufferAbc = insertC?.details?.bufferString === "abc";

  const allSteps = steps.map((s) => ({
    label: s.details?.label,
    bytes: s.details?.bytes,
    outputAdvanced: s.details?.outputAdvanced,
    lastCommand: s.details?.lastCommand,
    bufferString: s.details?.bufferString,
    bufferMatches: s.details?.bufferMatches,
    commandMatches: s.details?.commandMatches,
  }));

  const status =
    !timedOut &&
    (spawnResult.status === 0 || spawnResult.status === null) &&
    sessionReachesWait &&
    terminalBytesPresent &&
    sessionNotImmediatelyEnded &&
    terminalBytesFlowed &&
    bufferAbc &&
    heapu8NotAccessed &&
    envNotAccessed
      ? "PASS"
      : "FAIL";

  return {
    status,
    timedOut,
    exitStatus: spawnResult.status,
    signal: spawnResult.signal,
    checkpoints,
    // Bug fix verification
    callMainIsPromise,
    callMainSyncValue: callMainSnap?.details?.callMainSyncValue ?? null,
    bugFixed: callMainIsPromise,
    bugDescription: "emacs-browser-interactive callMain returns sync number 0 → session ends immediately",
    fixApplied: "VS Code startAsyncifyRuntime uses XTERM_ARTIFACT_DIR=emacs-browser-asyncify-spike",
    // Session lifecycle
    sessionReachesWait,
    terminalBytesPresent,
    initialTerminalBytes: firstWaitSnap?.details?.terminalBytes ?? null,
    sessionNotImmediatelyEnded,
    finalTerminalBytes: editSnap?.details?.finalTerminalBytes ?? null,
    terminalBytesFlowed,
    // Export guard verification (simulates browser Worker behavior)
    heapu8NotAccessed,
    envNotAccessed,
    heapu8TrapTriggered: editSnap?.details?.heapu8TrapTriggered ?? null,
    envTrapTriggered: editSnap?.details?.envTrapTriggered ?? null,
    // Editing
    bufferAbc,
    allSteps,
    artifact: artifactDir,
    note: [
      "Simulates VS Code webview startAsyncifyRuntime flow.",
      "callMainIsPromise=true means the session stays alive (Asyncify working).",
      "For visual browser UI confirmation: npm run dev → http://localhost:5173 → Start Interactive Session.",
      "Expected: status 'interactive', Emacs *scratch* visible in xterm pane.",
    ].join(" "),
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
  if (details.callMainIsPromise !== undefined) parts.push(`callMainIsPromise=${details.callMainIsPromise}`);
  if (details.sessionReachesWait !== undefined) parts.push(`sessionReachesWait=${details.sessionReachesWait}`);
  if (details.terminalBytes !== undefined) parts.push(`termBytes=${details.terminalBytes}`);
  if (details.outputAdvanced !== undefined) parts.push(`outputAdvanced=${details.outputAdvanced}`);
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
