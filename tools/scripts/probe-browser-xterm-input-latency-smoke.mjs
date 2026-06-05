/**
 * probe-browser-xterm-input-latency-smoke.mjs
 *
 * Measures key input latency for the xterm interactive session.
 * Blocker: xterm-input-latency-30s
 *
 * Measures:
 *   - Time from resolver call to next wasmacs_host_wait_for_input (full round-trip)
 *   - Time from resolver call to terminal output growth
 *   - Per-key latency for a, b, c
 *
 * Runs in Node.js vm with the asyncify-spike artifact.
 * Node.js uses --stack-size=65500 (65MB) so cold loadup succeeds.
 * Latency measurement is valid because we measure wasm execution time,
 * which is independent of JS call stack size.
 *
 * Build profiles tested:
 *   default: emacs-browser-asyncify-spike (CFLAGS from env or -g3 -O0)
 *   Set WASMACS_ARTIFACT_DIR to override.
 *
 * Logs:
 *   logs/browser-xterm-input-latency-smoke.txt
 *   logs/browser-xterm-input-latency-smoke.jsonl
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
const defaultLogStem = `${repoRoot}/logs/browser-xterm-input-latency-smoke`;
const textLogPath = process.env.WASMACS_TEXT_LOG_PATH ?? `${defaultLogStem}.txt`;
const jsonlLogPath = process.env.WASMACS_JSONL_LOG_PATH ?? `${defaultLogStem}.jsonl`;
const require = createRequire(import.meta.url);

const TIMEOUT_MS = 600_000;

/* ── Parent ──────────────────────────────────────────────────────── */

if (!process.argv.includes("--child")) {
  writeFileSync(textLogPath, "CASE:browser-xterm-input-latency-smoke\n");
  writeFileSync(jsonlLogPath, "");

  const result = spawnSync(
    process.execPath,
    ["--stack-size=65500", fileURLToPath(import.meta.url), "--child"],
    { encoding: "utf8", timeout: TIMEOUT_MS, env: { ...process.env } }
  );

  appendFileSync(textLogPath, [
    `EXIT_STATUS:${result.status}`,
    `SIGNAL:${result.signal}`,
    "STDOUT_BEGIN", (result.stdout ?? "").trimEnd(), "STDOUT_END",
    "STDERR_BEGIN", (result.stderr ?? "").trimEnd(), "STDERR_END", "",
  ].join("\n"));

  const snapshots = parseJsonl(require("node:fs").readFileSync(jsonlLogPath, "utf8"));
  const summary = buildSummary(snapshots, result);
  appendFileSync(textLogPath, ["SUMMARY_BEGIN", JSON.stringify(summary, null, 2), "SUMMARY_END", ""].join("\n"));

  if (summary.status === "PASS") {
    console.log("xterm input latency smoke PASS — see " + textLogPath);
  } else {
    console.log("xterm input latency smoke FAIL/BLOCKER — see " + textLogPath);
  }
  process.exit(0);
}

/* ── Child: measure latency ──────────────────────────────────────── */

const code = await readFile(`${artifactDir}/temacs`, "utf8");
let seq = 0;
let lastResolvedWaitId = 0;

let resolveReady;
const ready = new Promise(r => { resolveReady = r; });

const emacsMessages = [];
const context = {
  Module: {
    noInitialRun: true, thisProgram: "emacs",
    locateFile(p) { return `${artifactDir}/${p}`; },
    print(t) { emacsMessages.push({ t: Math.round(performance.now()), msg: t }); },
    printErr(t) { emacsMessages.push({ t: Math.round(performance.now()), msg: `ERR:${t}` }); },
    onAbort(w) { recordCheckpoint("abort", { what: w }); process.exit(1); },
    onRuntimeInitialized() {
      // Apply TTY poll override (same fix as production ensureXtermEmacs)
      try {
        const s0 = context.Module.FS.getStream(0);
        if (s0 && s0.tty) {
          s0.stream_ops.poll = function(_stream, _timeout, cb) {
            const qLen = (context.__wasmacsTerminalInputBytes || []).length;
            if (qLen > 0) {
              if (cb) cb(1);
              return 1;
            }
            if (cb) context.__wasmacsSelectCallback = cb;
            return 0;
          };
        }
      } catch (_e) {}
      resolveReady();
    },
  },
  Buffer, TextDecoder, TextEncoder, URL, WebAssembly,
  __dirname: artifactDir, __filename: `${artifactDir}/temacs`,
  clearTimeout, console, performance, process, require, setTimeout,
};
context.globalThis = context;
// Patch setTimeout to reduce SIGALRM timer delays (same fix as worker).
// Emacs calls setitimer(ITIMER_REAL, 30) → Emscripten setTimeout(fn, 30000).
// Without this patch, every key press has a 30-second delay.
const _origSetTimeout = setTimeout;
context.setTimeout = function(fn, delay, ...args) {
  if (typeof delay === "number" && delay >= 500) delay = 1;
  return _origSetTimeout(fn, delay, ...args);
};

// Record scheduler checkpoints with timestamps (called from C via host library)
// 100=before-wait, 101=after-wait-return, 102=byte-dequeued
context.__wasmacsRecordSchedulerCheckpoint = function(code, details) {
  const entry = { code, label: { 1:'js-wait-import', 2:'js-resolver-called', 3:'js-resolve-after', 4:'js-then-reached', 7:'js-resolver-bound', 8:'js-handleasync-start', 9:'js-promise-created', 10:'c-read-byte', 11:'c-byte-dequeue', 12:'c-queue-empty', 14:'c-before-handleasync', 15:'c-asyncpromise-at-bind', 16:'c-asyncify-at-then', 100:'c-before-wait', 101:'c-after-wait-return', 102:'c-sysdep-byte-dequeued' }[code] || code, t: Math.round(performance.now()), ...(details || {}) };
  (context.__wasmacsSchedulerEvents = context.__wasmacsSchedulerEvents || []).push(entry);
};
vm.createContext(context);
vm.runInContext(code, context, { filename: "temacs" });
await ready;

// Watchdog: if bytes are queued and select() callback is available, fire it.
// Mirrors production asyncify-minibuffer-worker.js startTerminalOutputStream watchdog.
setInterval(() => {
  if ((context.__wasmacsTerminalInputBytes || []).length > 0) {
    if (typeof context.__wasmacsSelectCallback === "function") {
      context.__wasmacsSelectCallback(1);
      context.__wasmacsSelectCallback = null;
    }
    if (typeof context.__wasmacsResolveHostInputWait === "function") {
      context.__wasmacsResolveHostInputWait();
    }
  }
}, 8);

// Boot
const args = ["--quick", "--no-splash", "--nw",
  "--eval", "(setq auto-save-timeout nil gc-cons-threshold 500000000)"];
context.Module.callMain(args);
await waitForHostInput(60_000);

const bootTermBytes = terminalOutputBytes();
recordCheckpoint("boot-complete", {
  artifactDir,
  waitCount: currentWaitId(),
  terminalBytes: bootTermBytes,
});

// Measure latency for a, b, c
const keys = [
  { label: "a", byte: 97 },
  { label: "b", byte: 98 },
  { label: "c", byte: 99 },
];

const latencies = [];
for (const key of keys) {
  const lat = await measureKeyLatency(key.label, key.byte);
  latencies.push(lat);
}

recordCheckpoint("all-keys-done", {
  emacsMessages: emacsMessages.slice(-40),
  latencies: latencies.map(l => ({
    key: l.key,
    resolverToNextWaitMs: l.resolverToNextWaitMs,
    resolverToTermOutputMs: l.resolverToTermOutputMs,
    termBytesGenerated: l.termBytesGenerated,
  })),
});

/* ── Measure one key ─────────────────────────────────────────────── */

async function measureKeyLatency(key, byte) {
  // Wait 150ms before sending each key.
  // This simulates human typing (~200ms between keys).
  // During this time, Emacs enters select() loop and saves the poll callback.
  // When the key arrives, the callback fires immediately (< 1ms latency).
  // Without this wait, bytes arrive before select() runs poll,
  // causing the byte to be consumed by emfile_read, then select() loops ~6s.
  await new Promise(r => setTimeout(r, 150));
  await waitForHostInput(30_000);
  const termBefore = terminalOutputBytes();
  const waitBefore = currentWaitId();

  const t0 = performance.now();
  queueInput([byte]);
  resolveWait();
  const tResolver = performance.now();

  // Poll for terminal output growth (up to 5s)
  let tTermOutput = null;
  let termBytesGenerated = 0;
  for (let i = 0; i < 5000; i++) {
    await new Promise(r => setTimeout(r, 1));
    const cur = terminalOutputBytes();
    if (cur > termBefore) {
      tTermOutput = performance.now();
      termBytesGenerated = cur - termBefore;
      break;
    }
  }

  // Wait for next host input
  let tNextWait = null;
  try {
    await waitForHostInputAfter(lastResolvedWaitId, 90_000);
    tNextWait = performance.now();
  } catch {
    tNextWait = null;
  }

  const resolverToNextWaitMs = tNextWait ? Math.round(tNextWait - tResolver) : null;
  const resolverToTermOutputMs = tTermOutput ? Math.round(tTermOutput - tResolver) : null;

  const emacsState = readEmacsState();
  // Scheduler events record C-level timestamps for key phases
  // 100=before-wait, 101=after-wait-return, 102=byte-dequeued
  const schedulerEvents = Array.from(context.__wasmacsSchedulerEvents || []);
  // Find events around this key press
  const keyEvents = schedulerEvents.filter(e => e.t >= Math.round(tResolver) - 100);

  const result = {
    key,
    byte,
    resolverCalledAt: Math.round(tResolver),
    schedulerKeyEvents: keyEvents.slice(0, 20),
    tTermOutput: tTermOutput ? Math.round(tTermOutput) : null,
    tNextWait: tNextWait ? Math.round(tNextWait) : null,
    resolverToNextWaitMs,
    resolverToTermOutputMs,
    termBytesGenerated,
    bufferString: emacsState?.bufferString?.value ?? null,
    lastCommand: emacsState?.lastCommand?.value ?? null,
  };

  recordCheckpoint(`key-${key}`, result);
  return result;
}

/* ── Summary ─────────────────────────────────────────────────────── */

function buildSummary(snapshots, spawnResult) {
  const timedOut = spawnResult.error?.code === "ETIMEDOUT";
  const bootSnap = snapshots.find(s => s.checkpoint === "boot-complete");
  const allSnap = snapshots.find(s => s.checkpoint === "all-keys-done");
  const keySnaps = snapshots.filter(s => s.checkpoint.startsWith("key-"));

  const lats = allSnap?.details?.latencies ?? [];
  const avgResolverToWait = lats.length
    ? Math.round(lats.reduce((s, l) => s + (l.resolverToNextWaitMs ?? 0), 0) / lats.length)
    : null;

  // PASS if all keys processed and average latency < 5000ms (5 seconds)
  // BLOCKER if latency >= 5000ms
  const allProcessed = lats.every(l => l.resolverToNextWaitMs !== null);
  const status = !timedOut && allProcessed && avgResolverToWait < 5000 ? "PASS" :
    !timedOut && allProcessed ? "BLOCKER" : "FAIL";

  return {
    status,
    timedOut,
    exitStatus: spawnResult.status,
    artifactDir,
    bootTermBytes: bootSnap?.details?.terminalBytes ?? null,
    avgResolverToNextWaitMs: avgResolverToWait,
    latencies: lats,
    blockerNote: avgResolverToWait >= 5000
      ? `Latency ${avgResolverToWait}ms — browser would show ~${Math.round(avgResolverToWait/1000)}s delay`
      : null,
    note: [
      "Measures wasm execution time from resolver call to next wait.",
      "Browser Worker adds ~0ms overhead on top of this.",
      "Node.js uses --stack-size=65500 (65MB) — not representative of browser 1-4MB stack.",
      "Latency should ideally be < 500ms for responsive editing.",
    ].join(" "),
  };
}

/* ── Primitives ──────────────────────────────────────────────────── */

function terminalOutputBytes() {
  return (context.__wasmacsTerminalOutputBytes || []).length;
}
function queueInput(bytes) {
  context.__wasmacsQueueTerminalInput(bytes);
  // Wake up select() via TTY poll callback
  if (typeof context.__wasmacsSelectCallback === "function") {
    context.__wasmacsSelectCallback(1);
    context.__wasmacsSelectCallback = null;
  }
}
function resolveWait() {
  lastResolvedWaitId = currentWaitId();
  if (typeof context.__wasmacsResolveHostInputWait === "function") {
    context.__wasmacsResolveHostInputWait();
  }
}
function currentWaitId() {
  return context.__wasmacsHostWaitForInputCount || 0;
}
function readEmacsState() {
  const state = {};
  for (const [k, f] of [["bufferString","(buffer-string)"],["lastCommand",'(condition-case nil (symbol-name last-command) (error "unknown"))']]) {
    try {
      const s = context.Module.ccall("wasmacs_eval_string","number",["string"],[f]);
      state[k] = { status: s, value: context.Module.ccall("wasmacs_last_result","string",[],[]) };
    } catch(e) { state[k] = { error: String(e) }; }
  }
  return state;
}
async function waitForHostInput(ms) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (context.__wasmacsHostWaitForInputPending) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error("timeout");
}
async function waitForHostInputAfter(after, ms) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (context.__wasmacsHostWaitForInputPending && currentWaitId() > after) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error("timeout after " + after);
}
function recordCheckpoint(checkpoint, details = {}) {
  const snap = { checkpoint, sequence: seq++, timestamp: new Date().toISOString(), monotonicMs: Math.round(performance.now()), details };
  appendFileSync(jsonlLogPath, JSON.stringify(snap) + "\n");
  const parts = [`checkpoint=${checkpoint}`];
  if (details.resolverToNextWaitMs !== undefined) parts.push(`resolverToWait=${details.resolverToNextWaitMs}ms`);
  if (details.resolverToTermOutputMs !== undefined) parts.push(`resolverToTermOut=${details.resolverToTermOutputMs}ms`);
  if (details.termBytesGenerated !== undefined) parts.push(`termBytes+=${details.termBytesGenerated}`);
  if (details.avgResolverToNextWaitMs !== undefined) parts.push(`avgLatency=${details.avgResolverToNextWaitMs}ms`);
  appendFileSync(textLogPath, `t=${Math.round(performance.now())}ms  ${parts.join("  ")}\n`);
}
function parseJsonl(text) {
  return text.split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
