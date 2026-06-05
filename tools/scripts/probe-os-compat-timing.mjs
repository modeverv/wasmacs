/**
 * probe-os-compat-timing.mjs
 *
 * Automated timing probe for os-compat terminal drain path.
 * Measures delay between SAB input and terminal output in xterm.js.
 *
 * Uses worker_threads for SAB-based input injection and
 * vm.createContext for Emacs wasm execution.
 */
import { readFile } from "node:fs/promises";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;
const artifactDir = process.env.WASMACS_ARTIFACT_DIR ?? `${repoRoot}/build/artifacts/emacs-browser-atomics`;

// ── Notifier thread ───────────────────────────────────────────
if (!isMainThread) {
  const { sabBuffer } = workerData;
  const signal = new Int32Array(sabBuffer, 0, 2);
  const data = new Uint8Array(sabBuffer, 8);

  async function sendKey(byte, delayMs) {
    await new Promise(r => setTimeout(r, delayMs));
    data[0] = byte;
    Atomics.store(signal, 1, 1);
    const t0 = performance.now();
    Atomics.add(signal, 0, 1);
    Atomics.notify(signal, 0, 1);
    parentPort.postMessage({ type: "key-sent", byte, ts: t0 });
  }

  parentPort.on("message", async (msg) => {
    if (msg.type === "start") {
      // Wait for Emacs to boot, then send keys
      await sendKey(97, 2000);   // 'a' at 2s
      await sendKey(98, 1000);   // 'b' at 3s
      await sendKey(99, 1000);   // 'c' at 4s
      await sendKey(13, 1000);   // Enter at 5s
      parentPort.postMessage({ type: "done" });
    }
  });
} else {
  // ── Main thread (runs Emacs wasm) ─────────────────────────────
  const INPUT_SAB = new SharedArrayBuffer(264);
  const requireMod = createRequire(import.meta.url);
  const code = await readFile(`${artifactDir}/temacs`, "utf8");

  const outputBytes = [];
  const events = []; // timeline events

  function recordEvent(kind, detail = {}) {
    const ts = performance.now();
    events.push({ ts, kind, ...detail });
    if (process.env.WASMACS_DEBUG)
      process.stderr.write(`[${ts.toFixed(1)}] ${kind} ${JSON.stringify(detail)}\n`);
  }

  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });

  const ctx = {
    postMessage(msg) {
      if (msg?.type === "diag") recordEvent("wait-diag", msg);
    },
    Module: {
      noInitialRun: true,
      thisProgram: "emacs",
      locateFile(p) { return `${artifactDir}/${p}`; },
      print(t) {
        recordEvent("emacs-print", { text: t.slice(0, 80) });
      },
      printErr(t) {
        // Capture all stderr for analysis
        recordEvent("emacs-stderr", { text: t.slice(0, 200) });
        // Show important lines
        if (/wasmacs|drain|FIONREAD|error|abort/i.test(t))
          process.stderr.write(`STDERR: ${t.slice(0, 200)}\n`);
      },
      onAbort(w) {
        process.stderr.write(`ABORT: ${w}\n`);
        recordEvent("abort", { what: w });
      },
      onExit(s) {
        recordEvent("exit", { status: s });
      },
      onRuntimeInitialized() {
        recordEvent("runtime-init");

        // Patch TTY ops
        const FS = ctx.Module.FS;
        const putChar = (_, v) => {
          if (v !== null) outputBytes.push(v & 255);
        };
        const getChar = () => {
          const q = ctx.__wasmacsTerminalInputBytes;
          return q.length ? q.shift() : undefined;
        };
        const ioctl_tcgets = () => ({
          c_iflag: 0, c_oflag: 0, c_cflag: 2237, c_lflag: 0,
          c_cc: [3, 28, 127, 21, 4, 0, 1, 0, 17, 19, 26, 0, 18, 15, 23, 22, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        });
        for (let fd = 0; fd <= 2; fd++) {
          const s = FS.getStream(fd);
          if (s?.tty) {
            s.tty.ops.put_char = putChar;
            s.tty.ops.get_char = getChar;
            s.tty.ops.ioctl_tcgets = ioctl_tcgets;
            s.tty.ops.ioctl_tcsets = () => 0;
            s.tty.ops.ioctl_tiocgwinsz = () => [24, 80];
            s.tty.ops.fsync = () => { };
          }
        }
        resolveReady();
      },
    },
    Buffer, TextDecoder, TextEncoder, URL, WebAssembly, SharedArrayBuffer,
    __dirname: artifactDir, __filename: artifactDir + "/temacs",
    clearTimeout, console, performance, process, require: requireMod,
    setTimeout, Atomics,
    __wasmacsInputSAB: INPUT_SAB,
    __wasmacsTerminalOutputBytes: outputBytes,
    __wasmacsTerminalInputBytes: [],
    __wasmacsSentOutputCount: 0,
    __wasmacsHostWaitForInputCount: 0,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: "temacs" });
  await ready;
  recordEvent("runtime-ok");

  // Verify SAB identity
  process.stderr.write(`SAB_MATCH:${ctx.__wasmacsInputSAB === INPUT_SAB}\n`);

  // Start notifier
  const notifier = new Worker(fileURLToPath(import.meta.url), {
    workerData: { sabBuffer: INPUT_SAB },
  });
  const keySentTimes = {};
  notifier.on("message", msg => {
    if (msg.type === "key-sent") {
      keySentTimes[msg.byte] = msg.ts;
      recordEvent("key-sent", { byte: msg.byte, char: String.fromCharCode(msg.byte) });
    }
    if (msg.type === "done") {
      recordEvent("notifier-done");
    }
  });
  notifier.postMessage({ type: "start" });

  // Poll terminal output while Emacs runs
  let lastOutputLen = 0;
  const pollInterval = setInterval(() => {
    if (outputBytes.length > lastOutputLen) {
      lastOutputLen = outputBytes.length;
      recordEvent("terminal-output", { totalBytes: lastOutputLen });
    }
  }, 100);

  // Run Emacs with a timeout
  const t0 = performance.now();
  recordEvent("callmain-start", { args: ["--quick", "--no-splash", "--nw"] });

  const timeoutMs = 30000;
  const timeout = setTimeout(() => {
    recordEvent("timeout", { ms: timeoutMs });
    process.stderr.write("TIMEOUT: Emacs did not exit within 30s\n");
    ctx.Module._emscripten_force_exit?.(1);
  }, timeoutMs);

  try {
    const status = ctx.Module.callMain(["--quick", "--no-splash", "--nw"]);
    clearTimeout(timeout);
    clearInterval(pollInterval);
    const dt = Math.round(performance.now() - t0);
    recordEvent("callmain-done", { status, dtMs: dt });
    process.stderr.write(`DONE: status=${status} dt=${dt}ms waitCount=${ctx.__wasmacsHostWaitForInputCount} termBytes=${outputBytes.length}\n`);
  } catch (e) {
    clearTimeout(timeout);
    clearInterval(pollInterval);
    recordEvent("callmain-threw", { name: e?.name, message: e?.message, status: e?.status });
    process.stderr.write(`THREW: ${e?.name} ${e?.message} status=${e?.status}\n`);
  } finally {
    notifier.terminate();
  }

  // ── Analysis ──────────────────────────────────────────────────
  process.stderr.write(`\n=== TIMING ANALYSIS ===\n`);
  process.stderr.write(`Total events: ${events.length}\n`);

  // Find key timing relationships
  const keyEvents = events.filter(e => e.kind === "key-sent");
  const waitDiags = events.filter(e => e.kind === "emacs-stderr" && /wasmacs.*drain/.test(e.text));
  const termOutputs = events.filter(e => e.kind === "terminal-output");

  process.stderr.write(`Keys sent: ${keyEvents.length}\n`);
  process.stderr.write(`Drain diagnostics: ${waitDiags.length}\n`);
  process.stderr.write(`Terminal output events: ${termOutputs.length}\n`);

  if (termOutputs.length > 0) {
    const firstOutput = termOutputs[0];
    const lastOutput = termOutputs[termOutputs.length - 1];
    process.stderr.write(`First terminal output at: ${firstOutput.ts.toFixed(1)}ms (${outputBytes.length} bytes total)\n`);
    process.stderr.write(`Last terminal output at: ${lastOutput.ts.toFixed(1)}ms\n`);

    // Show first 50 bytes of terminal output as text
    const firstBytes = outputBytes.slice(0, Math.min(200, outputBytes.length));
    const asText = String.fromCharCode(...firstBytes.filter(b => b >= 32 && b < 127 || b === 10 || b === 13));
    process.stderr.write(`First output bytes (text): ${asText.slice(0, 100)}\n`);
  } else {
    process.stderr.write(`NO terminal output received!\n`);
  }

  // Key-to-output latency
  if (keyEvents.length > 0 && termOutputs.length > 0) {
    const firstKey = keyEvents[0];
    const firstOutput = termOutputs[0];
    const latency = firstOutput.ts - firstKey.ts;
    process.stderr.write(`\nKey-to-first-output latency: ${latency.toFixed(0)}ms\n`);
  }

  // Show key events
  process.stderr.write(`\n=== COMPLETE TIMELINE (first 30 events) ===\n`);
  for (const e of events.slice(0, 30)) {
    const rel = (e.ts - t0).toFixed(1);
    if (e.kind === "emacs-stderr")
      process.stderr.write(`  ${rel}ms ${e.kind}: ${e.text.slice(0, 120)}\n`);
    else
      process.stderr.write(`  ${rel}ms ${e.kind}: ${JSON.stringify({ ...e, kind: undefined, ts: undefined })}\n`);
  }
}
