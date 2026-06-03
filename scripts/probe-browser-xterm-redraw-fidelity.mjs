/**
 * probe-browser-xterm-redraw-fidelity.mjs
 *
 * Terminal redraw fidelity smoke for xterm.js path.
 *
 * Verifies that Emacs --nw terminal output contains the ANSI sequences
 * required for xterm.js to render a working terminal editor:
 *   - Cursor positioning (ESC [ row ; col H)
 *   - Erase-to-EOL (ESC [ K) used during redraw
 *   - Reverse video (ESC [ 7m) for mode line
 *   - Mode line text visible in terminal stream
 *   - Display updates after: a,b,c / Enter / Backspace / C-l / C-x 2 / C-x 1
 *
 * JS owns NO display semantics — all ANSI sequences are Emacs-produced.
 * This smoke runs in Node.js vm context (same as product-input-smoke).
 * It does not launch a real browser or a real xterm instance.
 *
 * Terminal size: 80 cols × 24 rows (Emacs default for --nw with no COLUMNS/LINES override).
 * Future resize smoke is separate.
 *
 * Deferred: GUI frame route, C-x 5 2, Clipboard, terminal resize, mouse.
 *
 * Logs:
 *   logs/browser-xterm-redraw-fidelity.txt
 *   logs/browser-xterm-redraw-fidelity.jsonl
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
const defaultLogStem = `${repoRoot}/logs/browser-xterm-redraw-fidelity`;
const textLogPath =
  process.env.WASMACS_TEXT_LOG_PATH ?? `${defaultLogStem}.txt`;
const jsonlLogPath =
  process.env.WASMACS_JSONL_LOG_PATH ?? `${defaultLogStem}.jsonl`;
const require = createRequire(import.meta.url);

const TIMEOUT_MS = Number(process.env.WASMACS_XTERM_REDRAW_TIMEOUT_MS ?? 600_000);

/* ── Parent: spawn child ─────────────────────────────────────────── */

if (!process.argv.includes("--child")) {
  writeFileSync(textLogPath, "CASE:browser-xterm-redraw-fidelity\n");
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
      "browser xterm redraw fidelity smoke did not pass — see " + textLogPath
    );
  }
  console.log("browser xterm redraw fidelity smoke passed — see " + textLogPath);
  process.exit(0);
}

/* ── Child: boot Emacs, run fidelity sequence ────────────────────── */

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

// ENV is not exported in this artifact — terminal size is Emacs default (80x24 for --nw).
const termEnv = { note: "ENV not exported; terminal size is Emacs --nw default (80x24)" };
recordCheckpoint("after-boot", { termEnv });

/* ── Start interactive loop ──────────────────────────────────────── */

context.Module.callMain(["--quick", "--no-splash", "--nw"]);
await waitForHostInput(10_000);

const initialBytes = terminalOutputBytes();
const initialAnalysis = analyzeTerminalBytes(initialBytes);
recordCheckpoint("initial-display", {
  termEnv,
  byteCount: initialBytes.length,
  waitId: currentWaitId(),
  ...initialAnalysis,
});

/* ── Fidelity steps ──────────────────────────────────────────────── */

// 1. a, b, c — self-insert
await runStep("insert-a",   [97],         { expectedBuffer: "a",   expectedCommand: "self-insert-command" });
await runStep("insert-b",   [98],         { expectedBuffer: "ab",  expectedCommand: "self-insert-command" });
await runStep("insert-c",   [99],         { expectedBuffer: "abc", expectedCommand: "self-insert-command" });

// 2. Enter — newline
await runStep("enter",      [13],         { expectedBuffer: "abc\n", expectedCommand: "newline" });

// 3. Backspace — delete-backward-char
await runStep("backspace",  [127],        { expectedBuffer: "abc", expectedCommand: "delete-backward-char" });

// 4. C-l — recenter-top-bottom / redraw (expect large output jump)
await runStep("ctrl-l",     [12],         { expectedCommand: "recenter-top-bottom", isRedraw: true });

// 5. C-x 2 — split-window-below
// C-x (byte 24) is a prefix key: it consumes a wait point before the second byte.
// Send in two rounds so we don't race the intermediate C-x wait.
await runCxStep("split-window", 50, { expectedCommand: "split-window-below", isWindowOp: true });

// 6. C-x 1 — delete-other-windows
await runCxStep("unsplit-window", 49, { expectedCommand: "delete-other-windows", isWindowOp: true });

const finalBytes = terminalOutputBytes();
const finalAnalysis = analyzeTerminalBytes(finalBytes);
recordCheckpoint("all-steps-complete", {
  finalByteCount: finalBytes.length,
  finalWaitCount: currentWaitId(),
  ...finalAnalysis,
});

/* ── Step runners ────────────────────────────────────────────────── */

// runCxStep: handles C-x prefix sequences (C-x is byte 24, a prefix key).
// C-x triggers an intermediate wait point before the completing byte is consumed.
// We send C-x first, wait for the intermediate wait, then send the completing byte.
async function runCxStep(label, completingByte, opts = {}) {
  const { expectedCommand, isWindowOp = false } = opts;

  // Round 1: send C-x (24), wait for the intermediate C-x prefix wait
  await waitForHostInput(90_000);
  const waitIdBefore = currentWaitId();
  const byteCountBefore = terminalOutputBytes().length;
  queueInput([24]); // C-x prefix
  resolveWait();
  await waitForHostInputAfter(lastResolvedWaitId, 60_000);

  // Round 2: send completing byte, wait for command completion
  queueInput([completingByte]);
  resolveWait();
  await waitForHostInputAfter(lastResolvedWaitId, 60_000);

  const currentBytes = terminalOutputBytes();
  const byteCountAfter = currentBytes.length;
  const outputAdvanced = byteCountAfter > byteCountBefore;
  const newByteCount = byteCountAfter - byteCountBefore;

  const analysis = analyzeTerminalBytes(currentBytes);
  const newChunkAnalysis = analyzeTerminalBytes(currentBytes.slice(byteCountBefore));

  const emacsState = readEmacsState();
  const lastCommand = emacsState?.lastCommand?.value ?? null;
  const bufferString = emacsState?.bufferString?.value ?? null;
  const commandMatches = expectedCommand !== undefined ? lastCommand === expectedCommand : null;

  const details = {
    label,
    bytes: [24, completingByte],
    waitIdBefore,
    waitIdAfter: currentWaitId(),
    byteCountBefore,
    byteCountAfter,
    newByteCount,
    outputAdvanced,
    isWindowOp,
    lastCommand,
    bufferString,
    commandMatches,
    newChunk: newChunkAnalysis,
    totalAnsi: analysis.totalAnsiSequences,
    hasCursorPositioning: analysis.hasCursorPositioning,
    hasModeLineText: analysis.hasModeLineText,
    modeLineTextSample: analysis.modeLineTextSample,
  };
  recordCheckpoint(`step-${label}`, details);
  return details;
}

async function runStep(label, bytes, opts = {}) {
  const { expectedBuffer, expectedCommand, isRedraw = false, isWindowOp = false } = opts;

  await waitForHostInput(90_000);
  const waitIdBefore = currentWaitId();
  const byteCountBefore = terminalOutputBytes().length;

  queueInput(bytes);
  resolveWait();

  await waitForHostInputAfter(lastResolvedWaitId, 60_000);

  const currentBytes = terminalOutputBytes();
  const byteCountAfter = currentBytes.length;
  const outputAdvanced = byteCountAfter > byteCountBefore;
  const newByteCount = byteCountAfter - byteCountBefore;

  const analysis = analyzeTerminalBytes(currentBytes);
  const newChunkAnalysis = analyzeTerminalBytes(currentBytes.slice(byteCountBefore));

  const emacsState = readEmacsState();
  const lastCommand = emacsState?.lastCommand?.value ?? null;
  const bufferString = emacsState?.bufferString?.value ?? null;
  const bufferMatches = expectedBuffer !== undefined ? bufferString === expectedBuffer : null;
  const commandMatches = expectedCommand !== undefined ? lastCommand === expectedCommand : null;

  const details = {
    label,
    bytes,
    waitIdBefore,
    waitIdAfter: currentWaitId(),
    byteCountBefore,
    byteCountAfter,
    newByteCount,
    outputAdvanced,
    isRedraw,
    isWindowOp,
    lastCommand,
    bufferString,
    bufferMatches,
    commandMatches,
    // ANSI in new chunk since last step
    newChunk: newChunkAnalysis,
    // Running totals
    totalAnsi: analysis.totalAnsiSequences,
    hasCursorPositioning: analysis.hasCursorPositioning,
    hasModeLineReverseVideo: analysis.hasModeLineReverseVideo,
    hasModeLineText: analysis.hasModeLineText,
    modeLineTextSample: analysis.modeLineTextSample,
  };
  recordCheckpoint(`step-${label}`, details);
  return details;
}

/* ── ANSI analysis ───────────────────────────────────────────────── */

function analyzeTerminalBytes(bytes) {
  const dec = new TextDecoder("utf-8", { fatal: false });
  const text = dec.decode(new Uint8Array(bytes));

  const allCsi = text.match(/\x1b\[[0-9;]*[A-Za-z]/g) ?? [];
  const cursorPosSeqs = allCsi.filter((s) => /\x1b\[[0-9]*;[0-9]*H/.test(s) || s === "\x1b[H");
  const eraseEolSeqs = allCsi.filter((s) => /\x1b\[[0-9]*K/.test(s));
  const eraseDispSeqs = allCsi.filter((s) => /\x1b\[[0-9]*J/.test(s));
  const reverseVideoSeqs = allCsi.filter((s) => /\x1b\[.*7m/.test(s) || s === "\x1b[7m");
  const resetAttrSeqs = allCsi.filter((s) => s === "\x1b[m" || s === "\x1b[0m");
  const cursorMoveSeqs = allCsi.filter((s) => /\x1b\[[0-9;]*[ABCDE]/.test(s));

  const visibleText = text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\x1b[^\x1b]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");

  // Mode line detection: look for Emacs buffer name or positional markers in visible text.
  // The mode line in --nw mode contains "*scratch*", "Fundamental", or "All"/"Top"/"Bot".
  // Reverse video (ESC[7m) is termcap-dependent and not a required check here.
  const hasModeLineText =
    /\*scratch\*/.test(visibleText) ||
    /Fundamental/.test(visibleText) ||
    /\bAll\b/.test(visibleText);
  const modeLineMatch = visibleText.match(/[=-]{2,}[-*%: ]{0,6}(?:F\d+\s+\*scratch\*|Fundamental)[^\n]{0,80}/);
  const modeLineTextSample = modeLineMatch ? modeLineMatch[0].slice(0, 80) : null;

  const visibleTail = visibleText.slice(-400);

  return {
    totalAnsiSequences: allCsi.length,
    cursorPositionCount: cursorPosSeqs.length,
    eraseEolCount: eraseEolSeqs.length,
    eraseDispCount: eraseDispSeqs.length,
    reverseVideoCount: reverseVideoSeqs.length,
    resetAttrCount: resetAttrSeqs.length,
    cursorMoveCount: cursorMoveSeqs.length,
    hasCursorPositioning: cursorPosSeqs.length > 0,
    hasEraseEol: eraseEolSeqs.length > 0,
    hasModeLineReverseVideo: reverseVideoSeqs.length > 0,
    hasModeLineText,
    modeLineTextSample,
    visibleTail,
    byteCount: bytes.length,
  };
}

/* ── Emacs state readback ────────────────────────────────────────── */

function readEmacsState() {
  const forms = [
    ["bufferString",    "(buffer-string)"],
    ["lastCommand",     "(condition-case nil (symbol-name last-command) (error \"unknown\"))"],
    ["bufferName",      "(buffer-name)"],
    ["minibufferDepth", "(number-to-string (minibuffer-depth))"],
    ["windowCount",     "(number-to-string (length (window-list)))"],
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

  const initial = snapshots.find((s) => s.checkpoint === "initial-display");
  const final = snapshots.find((s) => s.checkpoint === "all-steps-complete");
  const steps = snapshots.filter((s) => s.checkpoint.startsWith("step-"));

  const getStep = (label) => steps.find((s) => s.checkpoint === `step-${label}`)?.details;

  const insertC = getStep("insert-c");
  const enterStep = getStep("enter");
  const backspaceStep = getStep("backspace");
  const ctrlL = getStep("ctrl-l");
  const splitStep = getStep("split-window");
  const unsplitStep = getStep("unsplit-window");

  const hasInitialOutput = (initial?.details?.byteCount ?? 0) > 1000;
  const hasAnsiInInitialOutput = (initial?.details?.totalAnsiSequences ?? 0) > 10;
  const hasCursorPositioning = Boolean(initial?.details?.hasCursorPositioning);
  // hasEraseEol is informational only — Emacs may use cursor-rewrite instead of ESC[K
  const hasEraseEol = Boolean(initial?.details?.hasEraseEol);
  // hasModeLineText checked across initial + final (mode line visible in terminal stream)
  const hasModeLineText =
    Boolean(initial?.details?.hasModeLineText) ||
    Boolean(final?.details?.hasModeLineText) ||
    steps.some((s) => s.details?.hasModeLineText);
  // hasModeLineReverseVideo is informational — termcap-dependent, not always ESC[7m
  const hasModeLineReverseVideo =
    Boolean(initial?.details?.hasModeLineReverseVideo) ||
    Boolean(final?.details?.hasModeLineReverseVideo);

  const allPrintableOutputAdvanced =
    [getStep("insert-a"), getStep("insert-b"), getStep("insert-c")].every(
      (s) => s?.outputAdvanced
    );
  const bufferAbc = insertC?.bufferString === "abc";
  const enterNewline = enterStep?.bufferString === "abc\n";
  const backspaceWorks = backspaceStep?.bufferString === "abc";
  const ctrlLRedrawWorks = Boolean(ctrlL?.outputAdvanced);
  const splitWindowWorks = Boolean(splitStep?.outputAdvanced);
  const unsplitWindowWorks = Boolean(unsplitStep?.outputAdvanced);

  const allSteps = steps.map((s) => ({
    label: s.details?.label,
    bytes: s.details?.bytes,
    outputAdvanced: s.details?.outputAdvanced,
    newByteCount: s.details?.newByteCount,
    lastCommand: s.details?.lastCommand,
    bufferString: s.details?.bufferString,
    bufferMatches: s.details?.bufferMatches,
    commandMatches: s.details?.commandMatches,
    newChunkAnsi: s.details?.newChunk?.totalAnsiSequences,
  }));

  const status =
    !timedOut &&
    (spawnResult.status === 0 || spawnResult.status === null) &&
    checkpoints.includes("initial-display") &&
    hasInitialOutput &&
    hasAnsiInInitialOutput &&
    hasCursorPositioning &&
    hasModeLineText &&
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
    // Initial display fidelity
    hasInitialOutput,
    initialByteCount: initial?.details?.byteCount ?? null,
    hasAnsiInInitialOutput,
    totalAnsiSequences: initial?.details?.totalAnsiSequences ?? null,
    hasCursorPositioning,
    cursorPositionCount: initial?.details?.cursorPositionCount ?? null,
    // Informational: eraseEol not required — Emacs may use cursor-rewrite strategy
    hasEraseEol,
    eraseEolCount: initial?.details?.eraseEolCount ?? null,
    // Required: mode line text visible in terminal stream (*scratch* or Fundamental)
    hasModeLineText,
    modeLineDetectedBy: hasModeLineText ? (
      initial?.details?.hasModeLineText ? "initial-display" :
      final?.details?.hasModeLineText ? "final-display" :
      "steps"
    ) : "none",
    // Informational: reverse video is termcap-dependent (not always ESC[7m)
    hasModeLineReverseVideo,
    modeLineTextSample: initial?.details?.modeLineTextSample ?? final?.details?.modeLineTextSample ?? null,
    termEnv: snapshots.find((s) => s.checkpoint === "after-boot")?.details?.termEnv ?? null,
    // Step results
    allPrintableOutputAdvanced,
    bufferAbc,
    enterNewline,
    backspaceWorks,
    ctrlLRedrawWorks,
    splitWindowWorks,
    unsplitWindowWorks,
    splitWindowWindowCount: splitStep?.windowCount ?? null,
    finalByteCount: final?.details?.finalByteCount ?? null,
    finalWaitCount: final?.details?.finalWaitCount ?? null,
    allSteps,
    // Deferred
    deferred: [
      "GUI frame route (make-frame / C-x 5 2)",
      "terminal resize (SIGWINCH equivalent)",
      "Clipboard Service",
      "mouse support",
    ],
    note: "Emacs produces ANSI/VT sequences; JS is byte transport only; xterm.js is renderer only",
  };
}

/* ── Primitives ──────────────────────────────────────────────────── */

function terminalOutputBytes() {
  return Array.from(context.__wasmacsTerminalOutputBytes || []);
}

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
  if (details.byteCountAfter !== undefined) parts.push(`termBytes=${details.byteCountAfter}`);
  if (details.byteCount !== undefined) parts.push(`termBytes=${details.byteCount}`);
  if (details.newByteCount !== undefined) parts.push(`+${details.newByteCount}`);
  if (details.totalAnsiSequences !== undefined) parts.push(`ansi=${details.totalAnsiSequences}`);
  if (details.outputAdvanced !== undefined) parts.push(`outputAdvanced=${details.outputAdvanced}`);
  if (details.lastCommand) parts.push(`lastCommand=${details.lastCommand}`);
  if (details.bufferString !== undefined) parts.push(`buffer=${JSON.stringify(details.bufferString)}`);
  if (details.hasModeLineText !== undefined) parts.push(`modeLineText=${details.hasModeLineText}`);
  if (details.hasModeLineReverseVideo !== undefined) parts.push(`rv=${details.hasModeLineReverseVideo}`);
  appendFileSync(textLogPath, `t=${Math.round(performance.now())}ms  ${parts.join("  ")}\n`);
}

function parseJsonl(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}
