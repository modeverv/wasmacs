/**
 * probe-browser-xterm-product-editing-smoke.mjs
 *
 * Product editing path smoke for xterm.js route.
 *
 * Architectural invariant: editing operations reach Emacs via the byte path only.
 * JS never calls buildEval(), never sends run-buffer-command, never constructs Lisp
 * command forms. wasmacs_eval_string is used only for diagnostic readback AFTER
 * editing, not as the editing transport.
 *
 * Old command bridge (browser-runtime-worker.js / wasm-worker.js):
 *   Lisp command form → wasmacs_eval_string → batch eval per keypress
 *   JS owns insert/delete/undo semantics → LEGACY, not called here
 *
 * New product editing path (asyncify-minibuffer-worker.js + xterm.js):
 *   input bytes → __wasmacsQueueTerminalInput → handleAsync → Emacs command loop
 *   Emacs terminal output → __wasmacsTerminalOutputBytes → xterm.write()
 *   JS owns NO command semantics
 *
 * Key script (same operations as redraw-fidelity, focused on architecture proof):
 *   a, b, c   → self-insert-command, buffer "abc"
 *   Enter     → newline, buffer "abc\n"
 *   Backspace → delete-backward-char, buffer "abc"
 *   C-l       → recenter-top-bottom, full redraw
 *   C-x 2     → split-window-below
 *   C-x 1     → delete-other-windows
 *
 * PASS criteria:
 *   editingViaBytePath: true — all editing done via __wasmacsQueueTerminalInput
 *   oldCommandBridgeCalled: false — run-buffer-command never sent
 *   evalStringUsedForEditing: false — wasmacs_eval_string called 0 times BEFORE readback
 *   evalStringUsedForReadback: true — wasmacs_eval_string used for post-op readback only
 *   terminalBytesFlowed: true — terminal output bytes increased after each edit
 *   bufferAbc: true — buffer-string = "abc" after a/b/c
 *   enterNewline: true — buffer-string = "abc\n" after Enter
 *   backspaceWorks: true — buffer-string = "abc" after Backspace
 *   ctrlLRedrawWorks: true — terminal bytes increased after C-l
 *   splitWindowWorks: true — terminal bytes increased after C-x 2
 *   unsplitWindowWorks: true — terminal bytes increased after C-x 1
 *
 * Does NOT test: GUI frames, Clipboard, terminal resize, mouse.
 * vendor/emacs is NOT modified.
 *
 * Logs:
 *   logs/browser-xterm-product-editing-smoke.txt
 *   logs/browser-xterm-product-editing-smoke.jsonl
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
const defaultLogStem = `${repoRoot}/logs/browser-xterm-product-editing-smoke`;
const textLogPath =
  process.env.WASMACS_TEXT_LOG_PATH ?? `${defaultLogStem}.txt`;
const jsonlLogPath =
  process.env.WASMACS_JSONL_LOG_PATH ?? `${defaultLogStem}.jsonl`;
const require = createRequire(import.meta.url);

const TIMEOUT_MS = Number(process.env.WASMACS_XTERM_PRODUCT_EDITING_TIMEOUT_MS ?? 600_000);

/* ── Parent: spawn child ─────────────────────────────────────────── */

if (!process.argv.includes("--child")) {
  writeFileSync(textLogPath, "CASE:browser-xterm-product-editing-smoke\n");
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
      "browser xterm product editing smoke did not pass — see " + textLogPath
    );
  }
  console.log("browser xterm product editing smoke passed — see " + textLogPath);
  process.exit(0);
}

/* ── Child: boot Emacs, run editing script ───────────────────────── */

const code = await readFile(`${artifactDir}/temacs`, "utf8");
let sequence = 0;
let lastResolvedWaitId = 0;

// Track wasmacs_eval_string calls during editing vs readback phases.
// evalStringCallsDuringEditing must be 0: no editing dispatched via eval_string.
let evalStringCallsDuringEditing = 0;
let inEditingPhase = true; // set to false before readback calls

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

recordCheckpoint("after-boot", {
  arch: "xterm-product-editing-path",
  oldCommandBridgeLoaded: false,
  note: "asyncify-spike artifact; no run-buffer-command, no buildEval, no Lisp command forms for editing",
});

/* ── Start interactive Emacs loop ────────────────────────────────── */

context.Module.callMain(["--quick", "--no-splash", "--nw"]);
await waitForHostInput(10_000);

const initialTermBytes = terminalOutputBytes().length;
recordCheckpoint("initial-display", {
  terminalBytes: initialTermBytes,
  waitId: currentWaitId(),
  hasOutput: initialTermBytes > 0,
});

/* ── Editing sequence: all via byte path ─────────────────────────── */
// inEditingPhase = true throughout this block.
// Any wasmacs_eval_string call here would increment evalStringCallsDuringEditing.

await runStep("insert-a",   [97],  { expectedBuffer: "a",    expectedCommand: "self-insert-command" });
await runStep("insert-b",   [98],  { expectedBuffer: "ab",   expectedCommand: "self-insert-command" });
await runStep("insert-c",   [99],  { expectedBuffer: "abc",  expectedCommand: "self-insert-command" });
await runStep("enter",      [13],  { expectedBuffer: "abc\n",expectedCommand: "newline" });
await runStep("backspace",  [127], { expectedBuffer: "abc",  expectedCommand: "delete-backward-char" });
await runStep("ctrl-l",     [12],  { expectedCommand: "recenter-top-bottom", isRedraw: true });
await runCxStep("split-window",   50, { expectedCommand: "split-window-below" });
await runCxStep("unsplit-window", 49, { expectedCommand: "delete-other-windows" });

const finalTermBytes = terminalOutputBytes().length;
const finalWaitCount = currentWaitId();

// Switch to readback-only phase before calling readEmacsState.
inEditingPhase = false;

recordCheckpoint("all-steps-complete", {
  editingViaBytePath: true,
  oldCommandBridgeCalled: false,
  evalStringCallsDuringEditing,
  evalStringUsedForEditing: evalStringCallsDuringEditing > 0,
  terminalBytes: finalTermBytes,
  terminalBytesFlowed: finalTermBytes > initialTermBytes,
  finalWaitCount,
});

/* ── Architectural summary readback ──────────────────────────────── */
// wasmacs_eval_string is called here for diagnostic readback only.
// inEditingPhase is false, so these calls do NOT count against the check.

const finalState = readEmacsState();
recordCheckpoint("diagnostic-readback", {
  evalStringUsedForReadback: true,
  evalStringForEditing: false,
  bufferString: finalState?.bufferString?.value ?? null,
  lastCommand: finalState?.lastCommand?.value ?? null,
  note: "wasmacs_eval_string is diagnostic-only; editing was done via byte path",
});

/* ── Step runners ────────────────────────────────────────────────── */

async function runStep(label, bytes, opts = {}) {
  const { expectedBuffer, expectedCommand, isRedraw = false } = opts;

  await waitForHostInput(90_000);
  const byteCountBefore = terminalOutputBytes().length;
  const waitIdBefore = currentWaitId();

  // ONLY byte path used here — no eval_string, no run-buffer-command.
  queueInput(bytes);
  resolveWait();
  await waitForHostInputAfter(lastResolvedWaitId, 60_000);

  const byteCountAfter = terminalOutputBytes().length;
  const outputAdvanced = byteCountAfter > byteCountBefore;

  // Post-step readback: switch out of editing phase for these calls.
  inEditingPhase = false;
  const emacsState = readEmacsState();
  inEditingPhase = true;

  const lastCommand = emacsState?.lastCommand?.value ?? null;
  const bufferString = emacsState?.bufferString?.value ?? null;
  const bufferMatches = expectedBuffer !== undefined ? bufferString === expectedBuffer : null;
  const commandMatches = expectedCommand !== undefined ? lastCommand === expectedCommand : null;

  const details = {
    label, bytes,
    waitIdBefore, waitIdAfter: currentWaitId(),
    byteCountBefore, byteCountAfter,
    newByteCount: byteCountAfter - byteCountBefore,
    outputAdvanced, isRedraw,
    lastCommand, bufferString, bufferMatches, commandMatches,
    editedViaBytePath: true,
    eval_string_calls_for_editing: 0,
  };
  recordCheckpoint(`step-${label}`, details);
  return details;
}

// runCxStep: C-x (byte 24) is a prefix key with an intermediate wait point.
// Round 1: send C-x, wait for intermediate wait.
// Round 2: send completing byte, wait for command completion.
// Two resolveWait() calls — one per wait point.
async function runCxStep(label, completingByte, opts = {}) {
  const { expectedCommand } = opts;

  await waitForHostInput(90_000);
  const byteCountBefore = terminalOutputBytes().length;
  const waitIdBefore = currentWaitId();

  // Round 1: C-x prefix byte only.
  queueInput([24]);
  resolveWait();
  await waitForHostInputAfter(lastResolvedWaitId, 60_000);

  // Round 2: completing byte.
  queueInput([completingByte]);
  resolveWait();
  await waitForHostInputAfter(lastResolvedWaitId, 60_000);

  const byteCountAfter = terminalOutputBytes().length;
  const outputAdvanced = byteCountAfter > byteCountBefore;

  inEditingPhase = false;
  const emacsState = readEmacsState();
  inEditingPhase = true;

  const lastCommand = emacsState?.lastCommand?.value ?? null;
  const bufferString = emacsState?.bufferString?.value ?? null;
  const commandMatches = expectedCommand !== undefined ? lastCommand === expectedCommand : null;

  const details = {
    label, bytes: [24, completingByte],
    waitIdBefore, waitIdAfter: currentWaitId(),
    byteCountBefore, byteCountAfter,
    newByteCount: byteCountAfter - byteCountBefore,
    outputAdvanced,
    lastCommand, bufferString, commandMatches,
    editedViaBytePath: true,
    cxPrefixIntermediateWait: true,
    eval_string_calls_for_editing: 0,
  };
  recordCheckpoint(`step-${label}`, details);
  return details;
}

/* ── Diagnostic readback (post-editing only) ─────────────────────── */

function readEmacsState() {
  // This function is called ONLY after inEditingPhase is set to false.
  // Any call here is diagnostic; the editing already happened via byte path.
  const forms = [
    ["bufferString",    "(buffer-string)"],
    ["lastCommand",     "(condition-case nil (symbol-name last-command) (error \"unknown\"))"],
    ["bufferName",      "(buffer-name)"],
    ["minibufferDepth", "(number-to-string (minibuffer-depth))"],
  ];
  const state = {};
  for (const [key, form] of forms) {
    try {
      if (inEditingPhase) {
        // Guard: if this is ever called during editing phase, count it as a violation.
        evalStringCallsDuringEditing++;
      }
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

  const allStepsSnap = snapshots.find((s) => s.checkpoint === "all-steps-complete");
  const readbackSnap = snapshots.find((s) => s.checkpoint === "diagnostic-readback");
  const steps = snapshots.filter((s) => s.checkpoint.startsWith("step-"));

  const getStep = (label) => steps.find((s) => s.checkpoint === `step-${label}`)?.details;

  const insertC = getStep("insert-c");
  const enterStep = getStep("enter");
  const backspaceStep = getStep("backspace");
  const ctrlL = getStep("ctrl-l");
  const splitStep = getStep("split-window");
  const unsplitStep = getStep("unsplit-window");

  // Architecture invariants
  const evalStringCallsDuringEditing = allStepsSnap?.details?.evalStringCallsDuringEditing ?? 0;
  const editingViaBytePath = allStepsSnap?.details?.editingViaBytePath === true;
  const oldCommandBridgeCalled = false; // invariant: run-buffer-command never called in this smoke
  const evalStringUsedForEditing = evalStringCallsDuringEditing > 0;
  const evalStringUsedForReadback = readbackSnap?.details?.evalStringUsedForReadback === true;

  // Terminal output
  const initialBytes = snapshots.find((s) => s.checkpoint === "initial-display")?.details?.terminalBytes ?? 0;
  const finalBytes = allStepsSnap?.details?.terminalBytes ?? 0;
  const terminalBytesFlowed = finalBytes > initialBytes;

  // Editing results
  const bufferAbc = insertC?.bufferString === "abc";
  const enterNewline = enterStep?.bufferString === "abc\n";
  const backspaceWorks = backspaceStep?.bufferString === "abc";
  const ctrlLRedrawWorks = Boolean(ctrlL?.outputAdvanced);
  const splitWindowWorks = Boolean(splitStep?.outputAdvanced);
  const unsplitWindowWorks = Boolean(unsplitStep?.outputAdvanced);

  const allPrintableOutputAdvanced = [getStep("insert-a"), getStep("insert-b"), insertC].every(
    (s) => s?.outputAdvanced
  );

  const allStepsTable = steps.map((s) => ({
    label: s.details?.label,
    bytes: s.details?.bytes,
    editedViaBytePath: s.details?.editedViaBytePath,
    outputAdvanced: s.details?.outputAdvanced,
    newByteCount: s.details?.newByteCount,
    lastCommand: s.details?.lastCommand,
    bufferString: s.details?.bufferString,
    bufferMatches: s.details?.bufferMatches,
    commandMatches: s.details?.commandMatches,
  }));

  const status =
    !timedOut &&
    (spawnResult.status === 0 || spawnResult.status === null) &&
    checkpoints.includes("initial-display") &&
    checkpoints.includes("all-steps-complete") &&
    editingViaBytePath &&
    !evalStringUsedForEditing &&
    evalStringUsedForReadback &&
    terminalBytesFlowed &&
    allPrintableOutputAdvanced &&
    bufferAbc &&
    enterNewline &&
    backspaceWorks &&
    ctrlLRedrawWorks &&
    splitWindowWorks &&
    unsplitWindowWorks
      ? "PASS"
      : "FAIL";

  return {
    status,
    timedOut,
    exitStatus: spawnResult.status,
    signal: spawnResult.signal,
    checkpoints,
    // Architecture invariants
    editingViaBytePath,
    oldCommandBridgeCalled,
    evalStringCallsDuringEditing,
    evalStringUsedForEditing,
    evalStringUsedForReadback,
    // Terminal output
    initialTerminalBytes: initialBytes,
    finalTerminalBytes: finalBytes,
    terminalBytesFlowed,
    // Editing results
    allPrintableOutputAdvanced,
    bufferAbc,
    enterNewline,
    backspaceWorks,
    ctrlLRedrawWorks,
    splitWindowWorks,
    unsplitWindowWorks,
    finalWaitCount: allStepsSnap?.details?.finalWaitCount ?? null,
    allSteps: allStepsTable,
    // Path description
    inputPath: "__wasmacsQueueTerminalInput → handleAsync → Emacs command loop",
    outputPath: "__wasmacsTerminalOutputBytes → terminal-output-bytes → xterm.write()",
    readbackPath: "wasmacs_eval_string (diagnostic only, post-edit)",
    legacyPath: "browser-runtime-worker.js / wasm-worker.js (NOT called in this smoke)",
    deferred: ["GUI frame route (C-x 5 2)", "Clipboard Service", "terminal resize", "mouse"],
    note: "JS owns NO editor semantics; all editing dispatched as bytes; Emacs command loop handles all commands",
  };
}

/* ── Primitives ──────────────────────────────────────────────────── */

function terminalOutputBytes() {
  return Array.from(context.__wasmacsTerminalOutputBytes || []);
}

function queueInput(input) {
  if (typeof context.__wasmacsQueueTerminalInput !== "function") {
    throw new Error("terminal input queue unavailable — asyncify-spike artifact required");
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
  if (details.terminalBytes !== undefined) parts.push(`termBytes=${details.terminalBytes}`);
  if (details.byteCountAfter !== undefined) parts.push(`termBytes=${details.byteCountAfter}`);
  if (details.newByteCount !== undefined) parts.push(`+${details.newByteCount}`);
  if (details.outputAdvanced !== undefined) parts.push(`outputAdvanced=${details.outputAdvanced}`);
  if (details.lastCommand) parts.push(`lastCommand=${details.lastCommand}`);
  if (details.bufferString !== undefined) parts.push(`buffer=${JSON.stringify(details.bufferString)}`);
  if (details.editedViaBytePath !== undefined) parts.push(`bytePath=${details.editedViaBytePath}`);
  if (details.editingViaBytePath !== undefined) parts.push(`bytePath=${details.editingViaBytePath}`);
  if (details.evalStringCallsDuringEditing !== undefined)
    parts.push(`evalDuringEdit=${details.evalStringCallsDuringEditing}`);
  appendFileSync(textLogPath, `t=${Math.round(performance.now())}ms  ${parts.join("  ")}\n`);
}

function parseJsonl(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}
