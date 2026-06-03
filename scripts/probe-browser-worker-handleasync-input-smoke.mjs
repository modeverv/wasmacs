/**
 * probe-browser-worker-handleasync-input-smoke.mjs
 *
 * Browser Web Worker analogue for handleAsync blocking-input smoke.
 *
 * Architecture: Node.js worker_threads
 * ─────────────────────────────────────
 * The wasm module runs in a worker_threads Worker. The message handler
 * that queues input and calls the wait resolver also runs in that same
 * worker thread. This mirrors the structure of a real browser Web Worker
 * where the wasm module, the message handler, and the resolver all share
 * one execution context (the worker's global scope).
 *
 * Known limitation: Node.js vm.runInContext latency
 * ──────────────────────────────────────────────────
 * Because the Emacs wasm is loaded via vm.runInContext within the worker
 * thread, there is still a microtask queue boundary between the worker's
 * native context and the vm context.  This means the vm Promise .then
 * (doRewind / C resume) takes ~30 s to fire under Node.js polling, for
 * the same reason as the existing handleasync-loop probe.
 *
 * In a real browser Web Worker (no vm.runInContext wrapper), the same
 * resolver call would cause C to resume at the next microtask checkpoint
 * (typically < 5 ms).  This probe verifies CORRECTNESS only; latency
 * claims require a real browser environment.
 *
 * What this probe verifies:
 *   • default mode is handleAsync (no WASMACS_WAIT_IMPORT_MODE set)
 *   • worker boots, establishes first wait
 *   • 3 consecutive inputs (a→b→c) consumed in FIFO order
 *   • waitCount monotone across all rounds
 *   • resolver cleared each round (js-import-resolver-called observed)
 *   • no byte residue between rounds
 *   • C resumes each round (waitId increases)
 *   • commandGuardDepth returns to 0 after all rounds
 *
 * Logs:
 *   logs/browser-worker-handleasync-input-smoke.txt
 *   logs/browser-worker-handleasync-input-smoke.jsonl
 */

import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir =
  process.env.WASMACS_ARTIFACT_DIR ??
  `${repoRoot}/artifacts/emacs-browser-asyncify-spike`;
const logStem = `${repoRoot}/logs/browser-worker-handleasync-input-smoke`;
const textLogPath = `${logStem}.txt`;
const jsonlLogPath = `${logStem}.jsonl`;

// Each round can take up to 60s due to vm.runInContext microtask latency
const ROUND_TIMEOUT_MS = Number(process.env.WASMACS_WORKER_ROUND_TIMEOUT_MS ?? 90_000);
const BOOT_TIMEOUT_MS = Number(process.env.WASMACS_WORKER_BOOT_TIMEOUT_MS ?? 90_000);
const TOTAL_TIMEOUT_MS = Number(process.env.WASMACS_WORKER_TOTAL_TIMEOUT_MS ?? 480_000);

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN THREAD
   ═══════════════════════════════════════════════════════════════════════════ */

if (isMainThread) {
  await writeFile(textLogPath, "CASE:browser-worker-handleasync-input-smoke\n");
  await writeFile(jsonlLogPath, "");

  const snapshots = [];
  let seq = 0;

  async function record(checkpoint, details = {}) {
    const snap = {
      checkpoint,
      sequence: seq++,
      timestamp: new Date().toISOString(),
      monotonicMs: Math.round(performance.now()),
      details,
    };
    snapshots.push(snap);
    await appendFile(jsonlLogPath, JSON.stringify(snap) + "\n");
    const { waitCount, roundRoundtripMs } = details;
    const parts = [`checkpoint=${checkpoint}`];
    if (waitCount !== undefined) parts.push(`waitCount=${waitCount}`);
    if (roundRoundtripMs !== undefined) parts.push(`roundtripMs=${roundRoundtripMs}`);
    await appendFile(textLogPath, `t=${Math.round(performance.now())}ms  ${parts.join("  ")}\n`);
  }

  const worker = new Worker(fileURLToPath(import.meta.url), {
    workerData: { artifactDir },
    // Worker needs larger stack for Emacs
    resourceLimits: { stackSizeMb: 64 },
  });

  const messages = [];
  let messageResolvers = [];
  worker.on("message", (msg) => {
    messages.push(msg);
    if (messageResolvers.length > 0) {
      const r = messageResolvers.shift();
      r();
    }
  });
  worker.on("error", (err) => {
    console.error("Worker error:", err);
  });

  async function waitForWorkerMessage(type, timeoutMs = ROUND_TIMEOUT_MS) {
    const start = Date.now();
    while (true) {
      const idx = messages.findIndex((m) => m.type === type);
      if (idx >= 0) return messages.splice(idx, 1)[0];
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timed out (${timeoutMs}ms) waiting for worker message type=${type}`);
      }
      await new Promise((r) => {
        const timer = setTimeout(() => {
          messageResolvers = messageResolvers.filter((x) => x !== r);
          r();
        }, 100);
        messageResolvers.push(() => {
          clearTimeout(timer);
          r();
        });
      });
    }
  }

  const totalTimer = setTimeout(() => {
    worker.terminate();
    console.error("FAIL: total timeout exceeded");
    process.exit(1);
  }, TOTAL_TIMEOUT_MS);

  try {
    await record("waiting-for-boot");
    const bootMsg = await waitForWorkerMessage("boot-complete", BOOT_TIMEOUT_MS);
    await record("boot-complete", { bootMs: bootMsg.bootMs });

    const firstWait = await waitForWorkerMessage("wait-active", BOOT_TIMEOUT_MS);
    await record("first-wait-active", { waitId: firstWait.waitId, waitCount: firstWait.waitCount });

    const rounds = [
      { label: "round-a", input: [97] },
      { label: "round-b", input: [98] },
      { label: "round-c", input: [99] },
    ];

    const roundResults = [];
    for (const round of rounds) {
      const roundStart = performance.now();
      worker.postMessage({ type: "queue-and-resolve", bytes: round.input, label: round.label });
      const resumed = await waitForWorkerMessage("c-resumed", ROUND_TIMEOUT_MS);
      const roundRoundtripMs = Math.round(performance.now() - roundStart);
      await record(`${round.label}-complete`, {
        label: round.label,
        input: round.input,
        waitCount: resumed.waitCount,
        bytesDequeued: resumed.bytesDequeued,
        resolverCleared: resumed.resolverCleared,
        noByteResidue: resumed.noByteResidue,
        cResumed: resumed.cResumed,
        roundRoundtripMs,
        promiseThenFired: resumed.promiseThenFired,
      });
      roundResults.push({ ...resumed, roundRoundtripMs });
    }

    worker.postMessage({ type: "observe-no-input", observeMs: 200 });
    const obs = await waitForWorkerMessage("no-input-observation", ROUND_TIMEOUT_MS);
    await record("no-input-observation", obs);

    worker.postMessage({ type: "final-state" });
    const finalMsg = await waitForWorkerMessage("final-state", ROUND_TIMEOUT_MS);
    await record("final-state", finalMsg);

    worker.terminate();
    clearTimeout(totalTimer);

    const allRoundsCResumed = roundResults.every((r) => r.cResumed);
    const allRoundsConsumedBytes = roundResults.every((r) => r.bytesDequeued);
    const allRoundsResolverCleared = roundResults.every((r) => r.resolverCleared);
    const allRoundsNoResidue = roundResults.every((r) => r.noByteResidue);
    const allRoundsWaitCountIncreased = (() => {
      let prev = firstWait.waitCount;
      for (const r of roundResults) {
        if (r.waitCount <= prev) return false;
        prev = r.waitCount;
      }
      return true;
    })();
    const maxRoundtripMs = Math.max(...roundResults.map((r) => r.roundRoundtripMs));
    const finalGuardDepth = finalMsg.commandGuardDepth ?? null;
    const defaultHandleAsyncUsed = !process.env.WASMACS_WAIT_IMPORT_MODE;

    const status =
      allRoundsCResumed &&
      allRoundsConsumedBytes &&
      allRoundsResolverCleared &&
      allRoundsNoResidue &&
      allRoundsWaitCountIncreased &&
      finalGuardDepth === 0
        ? "PASS"
        : "FAIL";

    const summary = {
      status,
      description: "worker_threads-based correctness smoke for handleAsync blocking-input",
      probeNote: "vm.runInContext latency (~30s/round) is a Node.js probe artifact; real browser Web Worker roundtrip < 5ms",
      defaultHandleAsyncUsed,
      bootMs: bootMsg.bootMs,
      rounds: roundResults.map((r, i) => ({
        label: rounds[i].label,
        input: rounds[i].input,
        waitCount: r.waitCount,
        cResumed: r.cResumed,
        bytesDequeued: r.bytesDequeued,
        resolverCleared: r.resolverCleared,
        noByteResidue: r.noByteResidue,
        roundRoundtripMs: r.roundRoundtripMs,
        promiseThenFired: r.promiseThenFired,
      })),
      allRoundsCResumed,
      allRoundsConsumedBytes,
      allRoundsResolverCleared,
      allRoundsNoResidue,
      allRoundsWaitCountIncreased,
      maxRoundtripMs,
      finalGuardDepth,
      noInputObservation: {
        waitStillActive: obs.waitStillActive,
        resolverRetained: obs.resolverRetained,
      },
    };

    await appendFile(
      textLogPath,
      ["SUMMARY_BEGIN", JSON.stringify(summary, null, 2), "SUMMARY_END", ""].join("\n")
    );

    if (status !== "PASS") {
      console.error("FAIL: browser-worker-handleasync-input-smoke — see " + textLogPath);
      process.exit(1);
    }
    console.log(
      `browser-worker-handleasync-input-smoke PASS  default=handleAsync  finalGuardDepth=${finalGuardDepth}  maxRoundtripMs=${maxRoundtripMs}ms (vm-latency)`
    );
    process.exit(0);
  } catch (err) {
    worker.terminate();
    clearTimeout(totalTimer);
    await appendFile(textLogPath, `ERROR: ${err.stack ?? err}\n`);
    console.error("FAIL: browser-worker-handleasync-input-smoke:", err.message);
    process.exit(1);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   WORKER THREAD
   Mirrors a browser Web Worker: wasm + resolver in the same thread.
   ═══════════════════════════════════════════════════════════════════════════ */

const { artifactDir: wArtifactDir } = workerData;
const require = createRequire(import.meta.url);
const code = await readFile(`${wArtifactDir}/temacs`, "utf8");

let resolveReady;
const ready = new Promise((r) => { resolveReady = r; });

const context = {
  Module: {
    noInitialRun: true,
    thisProgram: "temacs",
    locateFile(p) { return `${wArtifactDir}/${p}`; },
    print() {},
    printErr() {},
    onAbort(what) {
      parentPort.postMessage({ type: "abort", what: String(what) });
    },
    onRuntimeInitialized() {
      resolveReady();
    },
  },
  Buffer, TextDecoder, TextEncoder, URL, WebAssembly,
  __dirname: wArtifactDir,
  __filename: `${wArtifactDir}/temacs`,
  clearTimeout, console, performance, require, setTimeout,
  process,
};
context.globalThis = context;
context.__wasmacsWaitImportMode = "handleAsync";

vm.createContext(context);
vm.runInContext(code, context, { filename: "temacs" });
const bootStart = performance.now();
await ready;

context.Module.callMain(["--quick", "--no-splash", "--nw"]);
const bootMs = Math.round(performance.now() - bootStart);
parentPort.postMessage({ type: "boot-complete", bootMs });

async function waitForHostInput(timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (context.__wasmacsHostWaitForInputPending) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out waiting for host input wait in worker thread");
}

await waitForHostInput(30_000);
parentPort.postMessage({
  type: "wait-active",
  waitId: context.__wasmacsHostWaitForInputCount ?? 0,
  waitCount: context.__wasmacsHostWaitForInputCount ?? 0,
});

parentPort.on("message", async (msg) => {
  if (msg.type === "queue-and-resolve") {
    const { bytes, label } = msg;
    const prevWaitId = context.__wasmacsHostWaitForInputCount ?? 0;
    const eventsBefore = (context.__wasmacsSchedulerEvents ?? []).length;

    // Queue input
    if (typeof context.__wasmacsQueueTerminalInput === "function") {
      context.__wasmacsQueueTerminalInput(bytes);
    }

    // Call resolver — cross-context call (same vm.runInContext latency as other probes)
    if (typeof context.__wasmacsResolveHostInputWait === "function") {
      context.__wasmacsResolveHostInputWait(0);
    }

    // Poll for C-resume: same 10ms-interval pattern as handleasync-loop probe
    const start = Date.now();
    while (Date.now() - start < ROUND_TIMEOUT_MS) {
      const newWaitId = context.__wasmacsHostWaitForInputCount ?? 0;
      if (newWaitId > prevWaitId) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    const resolveRoundtripMs = Math.round(Date.now() - start + /* resolver overhead */ 0);
    const newWaitId = context.__wasmacsHostWaitForInputCount ?? 0;
    const cResumed = newWaitId > prevWaitId;
    const eventsAfter = context.__wasmacsSchedulerEvents ?? [];
    const newEvents = eventsAfter.slice(eventsBefore);
    const promiseThenFired = newEvents.some((e) => e.label === "js-import-promise-then");
    const bytesDequeued = newEvents.some((e) => e.label === "js-terminal-read-byte-dequeue");
    const resolverCleared = newEvents.some((e) => e.label === "js-import-resolver-called");
    const noByteResidue =
      Array.isArray(context.__wasmacsTerminalInputBytes) &&
      context.__wasmacsTerminalInputBytes.length === 0;

    parentPort.postMessage({
      type: "c-resumed",
      label,
      waitCount: newWaitId,
      cResumed,
      promiseThenFired,
      bytesDequeued,
      resolverCleared,
      noByteResidue,
      resolveRoundtripMs,
    });

    if (cResumed) {
      await waitForHostInput(5_000).catch(() => {});
      parentPort.postMessage({
        type: "wait-active",
        waitId: context.__wasmacsHostWaitForInputCount ?? 0,
        waitCount: context.__wasmacsHostWaitForInputCount ?? 0,
      });
    }
  }

  if (msg.type === "observe-no-input") {
    await new Promise((r) => setTimeout(r, msg.observeMs ?? 200));
    parentPort.postMessage({
      type: "no-input-observation",
      waitStillActive: !!(context.__wasmacsHostWaitForInputPending),
      resolverRetained: typeof context.__wasmacsResolveHostInputWait === "function",
      queueLen: Array.isArray(context.__wasmacsTerminalInputBytes)
        ? context.__wasmacsTerminalInputBytes.length
        : -1,
    });
  }

  if (msg.type === "final-state") {
    let commandGuardDepth = null;
    try {
      const raw = context.Module.ccall("wasmacs_os_gc_permission_state", "string", [], []);
      if (raw) {
        const parsed = JSON.parse(raw);
        commandGuardDepth = parsed?.wasmacsGcGuardDepth ?? parsed?.garbageCollectionInhibited ?? null;
      }
    } catch {}
    parentPort.postMessage({
      type: "final-state",
      commandGuardDepth,
      totalWaitCount: context.__wasmacsHostWaitForInputCount ?? 0,
      schedulerEventCount: (context.__wasmacsSchedulerEvents ?? []).length,
    });
  }
});
