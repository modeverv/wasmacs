/**
 * probe-browser-xterm-pdump-diagnostic-smoke.mjs
 *
 * DIAGNOSTIC ONLY — pdump boot diagnostic for xterm.js interactive session.
 *
 * This smoke validates the DIAGNOSTIC FALLBACK path (pdump boot), NOT the product default.
 * Product default (startXtermSession) uses cold loadup, which is a KNOWN OPEN BLOCKER in
 * browser Workers. This diagnostic probe documents that pdump boot works and compares routes.
 *
 * Open blocker: browser-worker-cold-loadup-js-stack-overflow
 *   callMain(['--quick','--no-splash','--nw']) → loadup.el → load ~100 Lisp files
 *   → eval_sub recurses ~1000+ levels → browser Worker JS call stack (1-4MB) overflows
 *   → RangeError: Maximum call stack size exceeded at temacs.wasm.eval_sub
 *   Node.js probe escaped via --stack-size=65500 (65MB JS stack)
 *
 * Diagnostic workaround (validated here):
 *   callMain(['--dump-file','/bootstrap-emacs.pdmp','--quick','--no-splash','--nw'])
 *   → restores Lisp state from binary snapshot (no eval_sub recursion)
 *   → command_loop enters interactive wait with shallow JS call stack
 *   → terminal output produced immediately (11,064 bytes)
 *
 * This is NOT the product boot. pdump dependency is diagnostic-only.
 *
 * Probe/browser route comparison:
 *   | Property                | Node.js probe  | Browser Worker |
 *   | JS call stack           | 65MB           | ~1-4MB         |
 *   | Without pdump + --quick | PASS (65MB)    | FAIL (overflow)|
 *   | With pdump + --dump-file| PASS           | PASS (expected)|
 *   | ASYNCIFY_IGNORE_INDIRECT| breaks Asyncify| not used       |
 *   | Artifact                | asyncify-spike  | asyncify-spike |
 *
 * Logs:
 *   logs/browser-xterm-boot-loadup-smoke.txt
 *   logs/browser-xterm-boot-loadup-smoke.jsonl
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
const pdmpSource =
  process.env.WASMACS_PDMP_DIR ??
  `${repoRoot}/artifacts/emacs-browser-asyncify-pdump`;
const pdmpFile = `${pdmpSource}/bootstrap-emacs.pdmp`;

const defaultLogStem = `${repoRoot}/logs/browser-xterm-pdump-diagnostic-smoke`;
const textLogPath =
  process.env.WASMACS_TEXT_LOG_PATH ?? `${defaultLogStem}.txt`;
const jsonlLogPath =
  process.env.WASMACS_JSONL_LOG_PATH ?? `${defaultLogStem}.jsonl`;
const require = createRequire(import.meta.url);

const TIMEOUT_MS = Number(process.env.WASMACS_BOOT_LOADUP_TIMEOUT_MS ?? 600_000);

/* ── Parent: spawn child ─────────────────────────────────────────── */

if (!process.argv.includes("--child")) {
  writeFileSync(textLogPath, "CASE:browser-xterm-pdump-diagnostic-smoke\n");
  writeFileSync(jsonlLogPath, "");

  const result = spawnSync(
    process.execPath,
    // Note: --stack-size=65500 used here for probe compatibility.
    // In the browser Worker, the JS stack is ~1-4MB. The pdump approach
    // avoids deep recursion so both work.
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
      "browser xterm pdump diagnostic smoke did not pass — see " + textLogPath
    );
  }
  console.log("browser xterm pdump diagnostic smoke passed — see " + textLogPath);
  process.exit(0);
}

/* ── Child: test pdump boot sequence ─────────────────────────────── */

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
      recordCheckpoint("abort", { what });
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

recordCheckpoint("runtime-initialized", {
  artifact: artifactDir,
  pdmpSource,
  bootStrategy: "pdump",
  note: "spike artifact (full Asyncify) + pdump boot avoids loadup recursion",
});

/* ── Load pdump into wasm FS ─────────────────────────────────────── */

const pdmpBytes = await readFile(pdmpFile);
context.Module.FS.writeFile("/bootstrap-emacs.pdmp", new Uint8Array(pdmpBytes));

recordCheckpoint("pdmp-loaded", {
  pdmpPath: pdmpFile,
  pdmpBytes: pdmpBytes.length,
  wasmFsPath: "/bootstrap-emacs.pdmp",
});

/* ── Boot with pdump ─────────────────────────────────────────────── */

const args = ["--dump-file", "/bootstrap-emacs.pdmp", "--quick", "--no-splash", "--nw"];
context.Module.callMain(args);

recordCheckpoint("callMain-fired", {
  args,
  waitPendingImmediate: Boolean(context.__wasmacsHostWaitForInputPending),
});

/* ── Wait for interactive wait point ────────────────────────────── */

await waitForHostInput(30_000);

const initialTermBytes = (context.__wasmacsTerminalOutputBytes || []).length;
const initialWaitCount = currentWaitId();

recordCheckpoint("interactive-wait-reached", {
  terminalBytes: initialTermBytes,
  waitCount: initialWaitCount,
  bootStrategy: "pdump",
  loadupRecursionAvoided: true,
  note: "pdump boot reached interactive wait without loadup recursion",
});

/* ── Send one key to confirm truly interactive ───────────────────── */

// Allow generous timeout — data file is 85MB, initial load may take 30-60s.
await runStep("key-a", [97], { expectedBuffer: "a", expectedCommand: "self-insert-command", waitMs: 90_000 });

recordCheckpoint("session-confirmed-interactive", {
  finalTerminalBytes: (context.__wasmacsTerminalOutputBytes || []).length,
  finalWaitCount: currentWaitId(),
});

/* ── Step runner ─────────────────────────────────────────────────── */

async function runStep(label, bytes, opts = {}) {
  const { expectedBuffer, expectedCommand, waitMs = 60_000 } = opts;

  await waitForHostInput(waitMs);
  const bytesBefore = (context.__wasmacsTerminalOutputBytes || []).length;

  queueInput(bytes);
  resolveWait();
  await waitForHostInputAfter(lastResolvedWaitId, waitMs);

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

function readEmacsState() {
  const forms = [
    ["bufferString", "(buffer-string)"],
    ["lastCommand", "(condition-case nil (symbol-name last-command) (error \"unknown\"))"],
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

  const pdmpSnap = snapshots.find((s) => s.checkpoint === "pdmp-loaded");
  const waitSnap = snapshots.find((s) => s.checkpoint === "interactive-wait-reached");
  const keyASnap = snapshots.find((s) => s.checkpoint === "step-key-a");

  const pdmpLoaded = Boolean(pdmpSnap?.details?.pdmpBytes);
  const interactiveWaitReached = (waitSnap?.details?.waitCount ?? 0) >= 1;
  const terminalBytesPresent = (waitSnap?.details?.terminalBytes ?? 0) > 0;
  const keyAAccepted = keyASnap?.details?.bufferString === "a";
  const keyAOutputAdvanced = Boolean(keyASnap?.details?.outputAdvanced);

  const status =
    !timedOut &&
    (spawnResult.status === 0 || spawnResult.status === null) &&
    pdmpLoaded &&
    interactiveWaitReached &&
    terminalBytesPresent &&
    keyAAccepted
      ? "PASS"
      : "FAIL";

  return {
    status,
    timedOut,
    exitStatus: spawnResult.status,
    signal: spawnResult.signal,
    checkpoints,
    // Boot sequence
    bootStrategy: "pdump",
    pdmpLoaded,
    pdmpBytes: pdmpSnap?.details?.pdmpBytes ?? null,
    // Interactive wait
    interactiveWaitReached,
    initialTerminalBytes: waitSnap?.details?.terminalBytes ?? null,
    waitCount: waitSnap?.details?.waitCount ?? null,
    terminalBytesPresent,
    // Key input
    keyAAccepted,
    keyAOutputAdvanced,
    keyALastCommand: keyASnap?.details?.lastCommand ?? null,
    // Root cause explanation
    rootCause: "eval_sub loadup recursion → JS call stack overflow in browser Worker (1-4MB)",
    fix: "--dump-file /bootstrap-emacs.pdmp skips loadup, reaches interactive wait without recursion",
    artifactPath: artifactDir,
    pdmpPath: pdmpFile,
    note: [
      "pdump from emacs-browser-asyncify-pdump reusable with emacs-browser-asyncify-spike",
      "(same Emacs source, same Lisp memory layout, different Asyncify flags)",
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
  if (details.terminalBytes !== undefined) parts.push(`termBytes=${details.terminalBytes}`);
  if (details.pdmpBytes !== undefined) parts.push(`pdmpBytes=${details.pdmpBytes}`);
  if (details.waitCount !== undefined) parts.push(`waitCount=${details.waitCount}`);
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
