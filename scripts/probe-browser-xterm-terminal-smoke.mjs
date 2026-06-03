/**
 * probe-browser-xterm-terminal-smoke.mjs
 *
 * Smoke test for the xterm.js terminal output path:
 *   Emacs stdout/tty → __wasmacsTerminalOutputBytes → terminal-output-bytes → xterm.write()
 *
 * Proves end-to-end that:
 *   1. Emacs produces terminal output bytes during boot / initial render
 *   2. After a,b,c input, terminal output bytes increase (Emacs redisplayed)
 *   3. Terminal bytes contain ANSI sequences (non-trivial terminal output)
 *   4. Emacs buffer state (abc) is confirmed via eval readback
 *   5. Worker loop survives and returns to wait point after each key
 *
 * Does NOT:
 *   - Use a real xterm.js instance (Node.js vm context)
 *   - Fake any Emacs display semantics in JS
 *   - Test clipboard / kill-ring
 *   - Modify vendor/emacs
 *
 * Terminal output path:
 *   __wasmacsTerminalOutputBytes (wasm tty hook)
 *     → terminal-output-bytes message (asyncify worker, 16ms interval)
 *     → xterm.write(new Uint8Array(bytes))   [in browser; not tested here]
 *
 * Input path (product default, unchanged):
 *   browserKeyEventToEmacsBytes → emacs-input-bytes → handleAsync byte queue
 *
 * Logs:
 *   logs/browser-xterm-terminal-smoke.txt
 *   logs/browser-xterm-terminal-smoke.jsonl
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
const defaultLogStem = `${repoRoot}/logs/browser-xterm-terminal-smoke`;
const textLogPath =
  process.env.WASMACS_TEXT_LOG_PATH ?? `${defaultLogStem}.txt`;
const jsonlLogPath =
  process.env.WASMACS_JSONL_LOG_PATH ?? `${defaultLogStem}.jsonl`;
const require = createRequire(import.meta.url);

const TIMEOUT_MS = Number(process.env.WASMACS_XTERM_TIMEOUT_MS ?? 600_000);

/* ── Parent: spawn child ─────────────────────────────────────────── */

if (!process.argv.includes("--child")) {
  writeFileSync(textLogPath, "CASE:browser-xterm-terminal-smoke\n");
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
      "browser xterm terminal smoke did not pass — see " + textLogPath
    );
  }
  console.log("browser xterm terminal smoke passed — see " + textLogPath);
  process.exit(0);
}

/* ── Child: boot Emacs, verify terminal output path ─────────────── */

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

const keyScript = [
  { label: "printable-a", bytes: [97],  expectedBuffer: "a",   expectedCommand: "self-insert-command" },
  { label: "printable-b", bytes: [98],  expectedBuffer: "ab",  expectedCommand: "self-insert-command" },
  { label: "printable-c", bytes: [99],  expectedBuffer: "abc", expectedCommand: "self-insert-command" },
  { label: "ctrl-g",      bytes: [7],   expectedCommand: "keyboard-quit" },
];

try {
  context.Module.callMain(["--quick", "--no-splash", "--nw"]);
  await waitForHostInput(5_000);

  const initialBytes = terminalOutputBytes();
  const initialByteCount = initialBytes.length;
  recordCheckpoint("first-wait", {
    waitId: currentWaitId(),
    initialTerminalByteCount: initialByteCount,
    hasTerminalOutput: initialByteCount > 0,
    hasAnsiSequences: containsAnsi(initialBytes),
    terminalTextSample: bytesToText(initialBytes).slice(-200),
  });

  for (const keyDef of keyScript) {
    await runKeyObservation(keyDef);
  }

  const finalBytes = terminalOutputBytes();
  recordCheckpoint("all-keys-complete", {
    finalTerminalByteCount: finalBytes.length,
    finalWaitCount: currentWaitId(),
    hasAnsiSequences: containsAnsi(finalBytes),
  });

} catch (err) {
  recordCheckpoint("failure", {
    failureKind: "exception",
    error: err?.stack ?? String(err),
  });
  throw err;
}

/* ── Key observation ─────────────────────────────────────────────── */

async function runKeyObservation({ label, bytes, expectedBuffer, expectedCommand }) {
  await waitForHostInput(90_000);
  const waitIdBefore = currentWaitId();
  const byteCountBefore = terminalOutputBytes().length;

  queueInput(bytes);
  resolveWait();

  await waitForHostInputAfter(lastResolvedWaitId, 60_000);

  const waitIdAfter = currentWaitId();
  const termBytes = terminalOutputBytes();
  const byteCountAfter = termBytes.length;
  const outputAdvanced = byteCountAfter > byteCountBefore;

  const emacsState = readEmacsState();
  const lastCommand = emacsState?.lastCommand?.status === 0 ? emacsState.lastCommand.value : null;
  const bufferString = emacsState?.bufferString?.status === 0 ? emacsState.bufferString.value : null;
  const bufferMatches = expectedBuffer !== undefined ? bufferString === expectedBuffer : null;
  const commandMatches = expectedCommand !== undefined ? lastCommand === expectedCommand : null;

  const details = {
    label,
    bytes,
    waitIdBefore,
    waitIdAfter,
    byteCountBefore,
    byteCountAfter,
    outputAdvanced,
    hasAnsiSequences: containsAnsi(termBytes),
    lastCommand,
    bufferString,
    bufferMatches,
    commandMatches,
    terminalTextTail: bytesToText(termBytes).slice(-300),
  };
  recordCheckpoint(`key-${label}`, details);
  return details;
}

/* ── Emacs state readback ────────────────────────────────────────── */

function readEmacsState() {
  const state = {};
  const forms = [
    ["bufferString", "(buffer-string)"],
    ["lastCommand", "(condition-case nil (symbol-name last-command) (error \"unknown\"))"],
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
  return state;
}

/* ── Terminal output helpers ─────────────────────────────────────── */

function terminalOutputBytes() {
  return Array.from(context.__wasmacsTerminalOutputBytes || []);
}

function containsAnsi(bytes) {
  // ESC [ is the start of CSI sequences used in terminal redraw
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0x1b && bytes[i + 1] === 0x5b) return true; // ESC [
  }
  return false;
}

function bytesToText(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
  } catch {
    return String.fromCharCode(...bytes);
  }
}

/* ── Summary builder ─────────────────────────────────────────────── */

function buildSummary(snapshots, spawnResult) {
  const checkpoints = snapshots.map((s) => s.checkpoint);
  const timedOut = spawnResult.error?.code === "ETIMEDOUT";

  const firstWait = snapshots.find((s) => s.checkpoint === "first-wait");
  const keySnaps = snapshots.filter((s) => s.checkpoint.startsWith("key-"));
  const final = snapshots.find((s) => s.checkpoint === "all-keys-complete");

  const hasInitialTerminalOutput = (firstWait?.details?.initialTerminalByteCount ?? 0) > 0;
  const hasAnsiInInitialOutput = Boolean(firstWait?.details?.hasAnsiSequences);

  const keyAbc = keySnaps.filter((s) => ["key-printable-a", "key-printable-b", "key-printable-c"].includes(s.checkpoint));
  const allPrintableOutputAdvanced = keyAbc.length === 3 && keyAbc.every((s) => s.details?.outputAdvanced);
  const bufferAbc = keySnaps.find((s) => s.checkpoint === "key-printable-c")?.details?.bufferString === "abc";
  const ctrlGSurvived = keySnaps.find((s) => s.checkpoint === "key-ctrl-g")?.details?.commandMatches !== false;

  const allKeys = keySnaps.map((s) => ({
    label: s.details?.label,
    bytes: s.details?.bytes,
    outputAdvanced: s.details?.outputAdvanced,
    byteCountBefore: s.details?.byteCountBefore,
    byteCountAfter: s.details?.byteCountAfter,
    lastCommand: s.details?.lastCommand,
    bufferString: s.details?.bufferString,
    bufferMatches: s.details?.bufferMatches,
    commandMatches: s.details?.commandMatches,
  }));

  const status =
    !timedOut &&
    (spawnResult.status === 0 || spawnResult.status === null) &&
    checkpoints.includes("first-wait") &&
    hasInitialTerminalOutput &&
    hasAnsiInInitialOutput &&
    allPrintableOutputAdvanced &&
    bufferAbc
      ? "PASS"
      : "FAIL";

  return {
    status,
    timedOut,
    exitStatus: spawnResult.status,
    signal: spawnResult.signal,
    checkpoints,
    hasInitialTerminalOutput,
    hasAnsiInInitialOutput,
    allPrintableOutputAdvanced,
    bufferAbc,
    ctrlGSurvived,
    finalTerminalByteCount: final?.details?.finalTerminalByteCount ?? null,
    finalWaitCount: final?.details?.finalWaitCount ?? null,
    allKeys,
    outputPath: "__wasmacsTerminalOutputBytes → terminal-output-bytes message → xterm.write()",
    inputPath: "bytes → __wasmacsQueueTerminalInput → handleAsync",
    note: "JS owns no display or command semantics; terminal bytes are Emacs-produced ANSI sequences",
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
  if (details.bytes) parts.push(`bytes=[${details.bytes}]`);
  if (details.byteCountAfter !== undefined) parts.push(`termBytes=${details.byteCountAfter}`);
  if (details.outputAdvanced !== undefined) parts.push(`outputAdvanced=${details.outputAdvanced}`);
  if (details.lastCommand) parts.push(`lastCommand=${details.lastCommand}`);
  if (details.bufferString !== undefined) parts.push(`buffer=${JSON.stringify(details.bufferString)}`);
  if (details.initialTerminalByteCount !== undefined) parts.push(`initTermBytes=${details.initialTerminalByteCount}`);
  appendFileSync(textLogPath, `t=${Math.round(performance.now())}ms  ${parts.join("  ")}\n`);
}

function parseJsonl(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}
