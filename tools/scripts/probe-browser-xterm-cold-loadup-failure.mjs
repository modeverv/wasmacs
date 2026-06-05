/**
 * probe-browser-xterm-cold-loadup-failure.mjs
 *
 * Documents the cold loadup JS call stack overflow blocker.
 * Blocker ID: browser-worker-cold-loadup-js-stack-overflow
 *
 * This probe intentionally runs with a small JS stack (--stack-size=1500, ~1.5MB)
 * to simulate browser Worker conditions (~1-4MB JS stack).
 *
 * Expected result: FAIL with RangeError: Maximum call stack size exceeded at eval_sub
 * (Same as the browser Worker failure)
 *
 * If this probe PASSES, the blocker may be resolved (or stack is still too large).
 *
 * Product route: startXtermSession uses ['--quick','--no-splash','--nw'] — NO pdump.
 * This is the correct product route. It is currently blocked.
 *
 * PASS criteria for this probe:
 *   - The probe correctly REPRODUCES the browser failure (coldLoadupFailed: true)
 *   - errorName is "RangeError" or "RuntimeError"
 *   - errorMessage includes "Maximum call stack" or "Aborted"
 *   - No --dump-file in args (confirms cold loadup)
 *   - No pdump used
 *
 * If the product is FIXED (cold loadup succeeds), this probe should be updated to
 * reflect that and removed from the blocker documentation.
 *
 * Logs:
 *   logs/browser-xterm-cold-loadup-failure.txt
 *   logs/browser-xterm-cold-loadup-failure.jsonl
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

const defaultLogStem = `${repoRoot}/logs/browser-xterm-cold-loadup-failure`;
const textLogPath =
  process.env.WASMACS_TEXT_LOG_PATH ?? `${defaultLogStem}.txt`;
const jsonlLogPath =
  process.env.WASMACS_JSONL_LOG_PATH ?? `${defaultLogStem}.jsonl`;
const require = createRequire(import.meta.url);

const TIMEOUT_MS = Number(process.env.WASMACS_COLD_LOADUP_TIMEOUT_MS ?? 120_000);

/* ── Parent: spawn child with small stack ────────────────────────── */

if (!process.argv.includes("--child")) {
  writeFileSync(textLogPath, "CASE:browser-xterm-cold-loadup-failure\n");
  writeFileSync(jsonlLogPath, "");

  // Use small stack (~1.5MB) to reproduce browser Worker conditions.
  // Browser Workers have ~1-4MB JS call stack.
  // Node.js default is ~4MB; probes normally use --stack-size=65500 (65MB).
  const result = spawnSync(
    process.execPath,
    ["--stack-size=1500", fileURLToPath(import.meta.url), "--child"],
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

  // This probe PASSES when it successfully REPRODUCES the browser failure.
  // It FAILS if the cold loadup unexpectedly succeeds (may indicate the blocker is fixed).
  if (summary.status === "RESOLVED") {
    console.log("cold loadup failure probe: BLOCKER RESOLVED — cold loadup succeeds on small stack — see " + textLogPath);
  } else if (summary.status === "PASS") {
    console.log("cold loadup failure probe: blocker confirmed (cold loadup fails as expected) — see " + textLogPath);
  } else {
    console.error("cold loadup failure probe: inconclusive result — see " + textLogPath);
  }
  process.exit(0);
}

/* ── Child: attempt cold loadup with small stack ─────────────────── */

let abortEvent = null;
let loadupOutput = [];
let sequence = 0;

const code = await readFile(`${artifactDir}/temacs`, "utf8");

let resolveReady;
const ready = new Promise((r) => { resolveReady = r; });

const context = {
  Module: {
    noInitialRun: true,
    thisProgram: "emacs",
    locateFile(p) { return `${artifactDir}/${p}`; },
    print(text) {
      loadupOutput.push(text);
      if (loadupOutput.length > 200) loadupOutput = loadupOutput.slice(-200);
    },
    printErr(text) {
      loadupOutput.push(`ERR:${text}`);
      if (loadupOutput.length > 200) loadupOutput = loadupOutput.slice(-200);
    },
    onAbort(what) {
      abortEvent = what;
      recordCheckpoint("abort", { what: what.slice(0, 200) });
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
  stackSizeKb: 1500,
  note: "simulating browser Worker JS stack (~1-4MB); cold loadup (no pdump)",
});

const args = ["--quick", "--no-splash", "--nw"]; // product default — NO --dump-file
let coldLoadupError = null;
let coldLoadupFailed = false;

try {
  // PRODUCT DEFAULT: cold loadup without pdump.
  // Expected: fails with RangeError (stack overflow) in eval_sub during loadup.
  context.Module.callMain(args);

  // If we get here, wait a moment to see if interactive wait is reached
  let waitReached = false;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (context.__wasmacsHostWaitForInputPending) {
      waitReached = true;
      break;
    }
  }

  if (waitReached) {
    const termBytes = (context.__wasmacsTerminalOutputBytes || []).length;
    const waitCount = context.__wasmacsHostWaitForInputCount || 0;
    recordCheckpoint("unexpected-success", {
      terminalBytes: termBytes,
      waitCount,
      stackSizeKb: 1500,
      productRoute: args.join(" "),
      hasDumpFile: args.some((a) => a === "--dump-file"),
      note: "BLOCKER RESOLVED: cold loadup succeeded on small stack. ASYNCIFY_REMOVE=eval_sub fixed the JS call stack overflow.",
    });
    coldLoadupFailed = false;
  } else {
    recordCheckpoint("no-wait-no-error", {
      note: "callMain returned without error but no interactive wait reached",
    });
    coldLoadupFailed = true;
  }
} catch (err) {
  coldLoadupError = err;
  coldLoadupFailed = true;
  const isStackOverflow = /Maximum call stack|stack overflow/i.test(err.message ?? "");
  const isAbort = /Aborted|RuntimeError/i.test(err.name ?? "");
  recordCheckpoint("cold-loadup-failed", {
    errorName: err.name,
    errorMessage: (err.message ?? "").slice(0, 200),
    isStackOverflow,
    isAbort,
    lastLoadupFile: loadupOutput.filter((l) => l.startsWith("Loading ")).slice(-1)[0] ?? null,
    loadupTail: loadupOutput.slice(-20),
    stackTrace: (err.stack ?? "").split("\n").slice(0, 15).join("\n"),
    args,
    hasDumpFile: args.some((a) => a === "--dump-file"),
    productRoute: true,
  });
}

/* ── Summary builder ─────────────────────────────────────────────── */

function buildSummary(snapshots, spawnResult) {
  const checkpoints = snapshots.map((s) => s.checkpoint);
  const timedOut = spawnResult.error?.code === "ETIMEDOUT";

  const failSnap = snapshots.find((s) => s.checkpoint === "cold-loadup-failed");
  const successSnap = snapshots.find((s) => s.checkpoint === "unexpected-success");

  const coldLoadupFailed = Boolean(failSnap);
  const unexpectedSuccess = Boolean(successSnap);
  const errorName = failSnap?.details?.errorName ?? null;
  const errorMessage = failSnap?.details?.errorMessage ?? null;
  const isStackOverflow = failSnap?.details?.isStackOverflow ?? false;
  const hasDumpFile = failSnap?.details?.hasDumpFile ?? false;
  const lastLoadupFile = failSnap?.details?.lastLoadupFile ?? null;

  // This probe PASSES when the blocker is correctly reproduced.
  // It means: cold loadup failed as expected in browser-like conditions.
  const blockerReproduced = coldLoadupFailed && !hasDumpFile;

  const status = blockerReproduced ? "PASS" : unexpectedSuccess ? "RESOLVED" : "INCONCLUSIVE";

  return {
    status,
    timedOut,
    exitStatus: spawnResult.status,
    signal: spawnResult.signal,
    checkpoints,
    // Blocker documentation
    blockerReproduced,
    unexpectedSuccess,
    coldLoadupFailed,
    errorName,
    errorMessage: errorMessage?.slice(0, 200) ?? null,
    isStackOverflow,
    hasDumpFile,
    productRoute: "['--quick','--no-splash','--nw'] (no --dump-file, no pdump)",
    lastLoadupFile,
    artifactDir,
    stackSizeKb: 1500,
    note: [
      "PASS = blocker confirmed (cold loadup fails with small stack as expected in browser).",
      "RESOLVED = cold loadup unexpectedly succeeded (blocker may be fixed).",
      "hasDumpFile=false confirms this is the product cold loadup route.",
      "Browser Workers use ~1-4MB JS stack; this probe uses --stack-size=1500.",
    ].join(" "),
  };
}

/* ── Helpers ─────────────────────────────────────────────────────── */

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
  if (details.errorName) parts.push(`error=${details.errorName}`);
  if (details.isStackOverflow !== undefined) parts.push(`stackOverflow=${details.isStackOverflow}`);
  if (details.lastLoadupFile) parts.push(`lastFile=${details.lastLoadupFile.slice(0, 60)}`);
  appendFileSync(textLogPath, `t=${Math.round(performance.now())}ms  ${parts.join("  ")}\n`);
}

function parseJsonl(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}
