/**
 * emacs-atomics-worker.js
 *
 * Web Worker for Emacs wasm using SharedArrayBuffer + Atomics.wait.
 * No Asyncify — wasm runs synchronously. Blocking is done via Atomics.wait.
 *
 * Protocol:
 *   Main → Worker: { type: "start", args: [...] }
 *   Main → Worker: (input via SharedArrayBuffer + Atomics.notify, NOT postMessage)
 *   Worker → Main: { type: "ready", sab: SharedArrayBuffer }
 *   Worker → Main: { type: "terminal-output-bytes", bytes: [...] }
 *   Worker → Main: { type: "status", text: "..." }
 *   Worker → Main: { type: "session-ended", status: N }
 *
 * SharedArrayBuffer layout (264 bytes):
 *   Int32[0] bytes 0-3:  signal (0=idle, 1=input available)
 *   Int32[1] bytes 4-7:  byte count
 *   Uint8    bytes 8+:   input bytes (up to 256 bytes)
 */

const ARTIFACT_DIR = "/artifacts/emacs-browser-atomics";

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

// SharedArrayBuffer: 4 bytes signal + 4 bytes count + 256 bytes data
const INPUT_SAB = new SharedArrayBuffer(264);
globalThis.__wasmacsInputSAB = INPUT_SAB;
globalThis.__wasmacsTerminalOutputBytes = [];
globalThis.__wasmacsTerminalInputBytes = [];
globalThis.__wasmacsSentOutputCount = 0;

self.onmessage = async (event) => {
  if (event.data?.type === "start") {
    await startEmacs(event.data.args ?? ["--quick", "--no-splash", "--nw"]);
  }
};

async function startEmacs(args) {
  // Advertise the SAB to main thread so it can send input
  post("ready", { sab: INPUT_SAB });
  post("status", { text: "loading Emacs wasm..." });

  let emacsModule;
  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });

  const Module = {
    noInitialRun: true,
    thisProgram: "emacs",
    locateFile(path) { return `${ARTIFACT_DIR}/${path}`; },
    print(text) {
      post("stdout", { text });
    },
    printErr(text) {
      console.warn("[emacs printErr]", text);
      post("stderr", { text });
    },
    onAbort(what) {
      post("session-ended", { error: `abort: ${what}` });
    },
    onExit(status) {
      // Called when C code calls exit(N). Gives us JS stack trace.
      console.trace("[atomics worker] Module.onExit called with status=" + status);
    },
    onRuntimeInitialized() {
      emacsModule = Module;
      // Patch TTY ops on already-opened streams (onRuntimeInitialized fires AFTER streams open).
      // We must patch the tty.ops on each stream directly, not TTY.default_tty_ops.
      try {
        const FS = Module.FS;
        const putChar = (_tty, val) => {
          if (val === null) return;
          globalThis.__wasmacsTerminalOutputBytes.push(val & 255);
        };
        const getChar = () => {
          const q = globalThis.__wasmacsTerminalInputBytes || [];
          return q.length ? q.shift() : undefined;
        };
        const ioctl_tcgets = () => ({
          c_iflag:0, c_oflag:0, c_cflag:2237, c_lflag:0,
          c_cc:[3,28,127,21,4,0,1,0,17,19,26,0,18,15,23,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        });
        for (let fd = 0; fd <= 2; fd++) {
          const stream = FS.getStream(fd);
          if (stream?.tty) {
            stream.tty.ops.put_char = putChar;
            stream.tty.ops.get_char = getChar;
            stream.tty.ops.fsync = () => {};
            stream.tty.ops.ioctl_tcgets = ioctl_tcgets;
            stream.tty.ops.ioctl_tcsets = () => 0;
            stream.tty.ops.ioctl_tiocgwinsz = () =>
              [globalThis.__wasmacsTerminalRows || 24, globalThis.__wasmacsTerminalCols || 80];
            console.log(`[atomics worker] TTY ops patched for fd=${fd}`);
          }
        }
      } catch(e) {
        console.warn("[atomics worker] TTY patch failed:", e);
      }
      post("status", { text: "Emacs runtime initialized" });
      resolveReady();
    },
  };

  self.Module = Module;

  try {
    importScripts(`${ARTIFACT_DIR}/temacs`);
  } catch (err) {
    post("session-ended", { error: String(err) });
    return;
  }

  await ready;
  post("status", { text: "starting Emacs..." });

  console.log("[atomics worker] SAB:", INPUT_SAB, "Atomics.wait:", typeof Atomics?.wait);
  console.log("[atomics worker] globalThis.__wasmacsInputSAB:", globalThis.__wasmacsInputSAB);

  // Intercept wasmacs_host_wait_for_input to verify it's being called
  const origWait = globalThis.wasmacs_host_wait_for_input;
  let waitCallCount = 0;
  if (Module._wasmacs_host_wait_for_input !== undefined) {
    console.log("[atomics worker] wasmacs_host_wait_for_input is exported from wasm");
  }
  // Hook via __wasmacsInputSAB check
  const origSAB = globalThis.__wasmacsInputSAB;
  Object.defineProperty(globalThis, '__wasmacsInputSAB', {
    get() { return origSAB; },
    set(v) { console.log("[atomics worker] __wasmacsInputSAB set to:", v); Object.defineProperty(globalThis, '__wasmacsInputSAB', {value: v, writable: true, configurable: true}); }
  });

  // Log diagnostics before callMain
  const checkInterval = setInterval(() => {
    const waitCount = globalThis.__wasmacsHostWaitForInputCount || 0;
    const fioCount  = globalThis.__wasmacsFionreadCallCount || 0;
    const termBytes = globalThis.__wasmacsTerminalOutputBytes?.length || 0;
    const queueLen  = globalThis.__wasmacsTerminalInputBytes?.length || 0;
    const lastFio   = globalThis.__wasmacsLastFionread;
    console.log("[atomics worker] waitCount:", waitCount,
                "fionread:", fioCount,
                "termBytes:", termBytes,
                "queueLen:", queueLen,
                "lastFionread:", lastFio ? JSON.stringify(lastFio) : "null");
  }, 500);

  post("status", { text: "calling callMain..." });
  // Intercept quit_/exitJS to get stack trace
  const origQuit = self.__ZL5quit_ ?? null;

  try {
    console.log("[atomics worker] calling callMain...");

    // Monkey-patch to get exit stack trace
    const origCallMain = Module.callMain.bind(Module);
    Module.callMain = function patchedCallMain(a) {
      try {
        return origCallMain(a);
      } catch(e) {
        if (e?.name === "ExitStatus") {
          console.error("[atomics worker] ExitStatus thrown, status=", e.status);
          console.error("[atomics worker] ExitStatus stack:", e.stack);
        } else {
          console.error("[atomics worker] Non-ExitStatus exception:", e?.name, e?.message);
          console.error("[atomics worker] stack:", e?.stack);
        }
        throw e;
      }
    };

    const status = Module.callMain(args);
    clearInterval(checkInterval);
    console.log("[atomics worker] callMain returned:", status, "waitCount:", globalThis.__wasmacsHostWaitForInputCount, "termBytes:", globalThis.__wasmacsTerminalOutputBytes?.length);
    post("session-ended", { status });
  } catch (err) {
    clearInterval(checkInterval);
    if (err?.name !== "ExitStatus") {
      console.error("[atomics worker] callMain threw non-ExitStatus:", err);
    }
    const status = err?.status ?? 1;
    post("session-ended", { status, error: err?.message });
  }
}
