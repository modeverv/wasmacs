/**
 * probe-browser-xterm-atomics-smoke.mjs
 * Node.js smoke for Atomics.wait-based Emacs wasm using worker_threads.
 */
import { readFile } from "node:fs/promises";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = process.env.WASMACS_ARTIFACT_DIR ?? `${repoRoot}/artifacts/emacs-browser-atomics`;

// ── Notifier thread ───────────────────────────────────────────
if (!isMainThread) {
  const { sabBuffer } = workerData;
  const signal = new Int32Array(sabBuffer, 0, 2);
  const data   = new Uint8Array(sabBuffer, 8);

  async function sendKey(byte, delayMs) {
    await new Promise(r => setTimeout(r, delayMs));
    data[0] = byte;
    Atomics.store(signal, 1, 1);
    Atomics.add(signal, 0, 1);
    Atomics.notify(signal, 0, 1);
    parentPort.postMessage({ type: "sent", byte });
  }

  parentPort.on("message", async (msg) => {
    if (msg.type === "start") {
      await sendKey(97, 1000);  // 'a' after 1s
      await sendKey(98, 2000);  // 'b' after 2s
      await sendKey(99, 3000);  // 'c' after 3s
      parentPort.postMessage({ type: "done" });
    }
  });
} else {
  // ── Main thread (runs Emacs wasm) ─────────────────────────────
  const INPUT_SAB = new SharedArrayBuffer(264);
  const code = await readFile(`${artifactDir}/temacs`, "utf8");
  const require = createRequire(import.meta.url);
  const outputBytes = [];

  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });

  const ctx = {
    Module: {
      noInitialRun: true,
      thisProgram: "emacs",
      locateFile(p) { return `${artifactDir}/${p}`; },
      print() {},
      printErr(t) {
        if (!/prlimit|stdio|arch|unsupported/.test(t))
          process.stderr.write("STDERR: " + t.slice(0, 120) + "\n");
      },
      onAbort(w) { process.stderr.write("ABORT: " + w + "\n"); },
      onRuntimeInitialized() {
        const FS = ctx.Module.FS;
        const putChar = (_, v) => { if (v !== null) outputBytes.push(v & 255); };
        const getChar = () => { const q = ctx.__wasmacsTerminalInputBytes; return q.length ? q.shift() : undefined; };
        const ioctl_tcgets = () => ({ c_iflag:0, c_oflag:0, c_cflag:2237, c_lflag:0,
          c_cc:[3,28,127,21,4,0,1,0,17,19,26,0,18,15,23,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0] });
        for (let fd = 0; fd <= 2; fd++) {
          const s = FS.getStream(fd);
          if (s?.tty) {
            s.tty.ops.put_char = putChar;
            s.tty.ops.get_char = getChar;
            s.tty.ops.ioctl_tcgets = ioctl_tcgets;
            s.tty.ops.ioctl_tcsets = () => 0;
            s.tty.ops.ioctl_tiocgwinsz = () => [24, 80];
            s.tty.ops.fsync = () => {};
          }
        }
        resolveReady();
      },
    },
    Buffer, TextDecoder, TextEncoder, URL, WebAssembly, SharedArrayBuffer,
    __dirname: artifactDir, __filename: artifactDir + "/temacs",
    clearTimeout, console, performance, process, require, setTimeout, Atomics,
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
  process.stderr.write("RUNTIME_OK\n");

  const notifier = new Worker(fileURLToPath(import.meta.url), {
    workerData: { sabBuffer: INPUT_SAB },
  });
  notifier.on("message", msg => {
    if (msg.type === "sent") {
      process.stderr.write(`KEY_SENT: ${String.fromCharCode(msg.byte)} (${msg.byte})\n`);
    }
  });
  notifier.postMessage({ type: "start" });

  try {
    const t0 = performance.now();
    const status = ctx.Module.callMain(["--quick", "--no-splash", "--nw"]);
    const dt = Math.round(performance.now() - t0);
    process.stderr.write(`DONE: status=${status} dt=${dt}ms waitCount=${ctx.__wasmacsHostWaitForInputCount} termBytes=${outputBytes.length}\n`);
  } catch(e) {
    process.stderr.write(`THREW: ${e?.name} ${e?.message} status=${e?.status}\n`);
  } finally {
    notifier.terminate();
  }
}
