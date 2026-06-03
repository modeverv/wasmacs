const ARTIFACT_DIR = "/artifacts/emacs-browser-interactive";
const DUMP_FILE = "bootstrap-emacs.pdmp";

// XTERM_ARTIFACT_DIR: artifact for the xterm interactive session.
// emacs-browser-asyncify-spike: full Asyncify instrumentation + all terminal byte symbols.
// emacs-browser-interactive: callMain returns sync 0 → session ends immediately (wrong).
const XTERM_ARTIFACT_DIR = "/artifacts/emacs-browser-asyncify-spike";

// OPEN BLOCKER: browser-worker-cold-loadup-js-stack-overflow
// callMain(['--quick','--no-splash','--nw']) triggers loadup.el which recurses ~1000+
// levels in eval_sub. In browser Worker (JS stack ~1-4MB) this causes:
//   RangeError: Maximum call stack size exceeded at temacs.wasm.eval_sub
// Node.js probes escape via --stack-size=65500 (65MB). No browser Worker API equivalent.
// The xterm product default is cold loadup (this path), which is a known open blocker
// in browser Workers. See docs/os-compatibility-boundary.md for full analysis.

// DIAGNOSTIC ONLY: pdump constants. Used by start-pdump-xterm-session only.
// NOT used in startXtermSession (the product xterm path).
// pdump boot avoids loadup recursion but is not the product default.
const XTERM_PDMP_URL = "/artifacts/emacs-browser-asyncify-pdump/bootstrap-emacs.pdmp";
const XTERM_PDMP_PATH = "/bootstrap-emacs.pdmp";

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

function postPendingCommand(command, state, details = {}) {
  post("pending-command", {
    id: details.id ?? `${command?.type ?? "minibuffer-read"}:${command?.path ?? ""}`,
    commandType: command?.type ?? "minibuffer-read",
    path: command?.path,
    pointIndex: command?.pointIndex,
    state,
    minibuffer: details.minibuffer ?? "",
    result: details.result,
    error: details.error,
  });
}

let emacsModule;
let emacsReady;
let booted = false;
let pendingCommand;
let pendingInputResolver;
let recentOutput = [];
let diagnosticEvents = [];
let bootstrapPdumpInfo;
let terminalOutputSentCount = 0;
let terminalOutputStreamStarted = false;

// Separate singleton for the xterm interactive session.
// Uses XTERM_ARTIFACT_DIR (asyncify-spike) which has a Promise-returning callMain.
let xtermEmacsModule;
let xtermEmacsReady;

function flushTerminalOutputBytes() {
  const bytes = self.__wasmacsTerminalOutputBytes;
  if (!bytes || bytes.length <= terminalOutputSentCount) return;
  const newBytes = Array.from(bytes).slice(terminalOutputSentCount);
  terminalOutputSentCount = bytes.length;
  console.log("[worker flush] sending " + newBytes.length + " bytes, total=" + bytes.length + " t=" + Math.round(performance.now()));
  post("terminal-output-bytes", { bytes: newBytes });
}

function startTerminalOutputStream() {
  if (terminalOutputStreamStarted) return;
  terminalOutputStreamStarted = true;
  setInterval(flushTerminalOutputBytes, 16);
  // Input queue watchdog: if bytes are queued AND Emacs is at a wait point,
  // resolve the wait. Fixes race condition where emacs-input-bytes arrives
  // while Emacs is processing (resolver is undefined), bytes accumulate in
  // the queue but the next wait never gets resolved.
  setInterval(function drainInputQueue() {
    if ((self.__wasmacsTerminalInputBytes || []).length > 0) {
      if (typeof self.__wasmacsSelectCallback === "function") {
        self.__wasmacsSelectCallback(1);
        self.__wasmacsSelectCallback = null;
      }
      if (typeof self.__wasmacsResolveHostInputWait === "function") {
        self.__wasmacsResolveHostInputWait();
      }
    }
  }, 8);
}

self.onmessage = async (event) => {
  if (event.data?.type === "boot-probe") {
    await runBootProbe(event.data);
    return;
  }
  if (event.data?.type === "interactive-loop-probe") {
    await runInteractiveLoopProbe(event.data);
    return;
  }
  if (event.data?.type === "start-interactive-command-loop") {
    await startInteractiveCommandLoop(event.data);
    return;
  }
  if (event.data?.type === "start-xterm-session") {
    await startXtermSession(event.data);
    return;
  }
  if (event.data?.type === "start-pdump-xterm-session") {
    // DIAGNOSTIC ONLY: pdump boot session.
    // Avoids browser Worker cold loadup stack overflow via pdump restore.
    // NOT the product default. Use only for diagnostic comparison.
    await startPdumpXtermSession(event.data);
    return;
  }
  if (event.data?.type === "interactive-semantics-probe") {
    await runInteractiveSemanticsProbe(event.data);
    return;
  }
  if (event.data?.type === "start-minibuffer-read") {
    await startMinibufferRead(event.data.command);
    return;
  }
  if (event.data?.type === "input-text") {
    injectInputText(event.data.text);
  }
  if (event.data?.type === "terminal-input") {
    queueTerminalInput(event.data.bytes ?? event.data.text ?? "");
    if (typeof self.__wasmacsResolveHostInputWait === "function") {
      self.__wasmacsResolveHostInputWait();
    }
  }
  if (event.data?.type === "emacs-input-bytes") {
    const bytes = event.data.bytes ?? [];
    if (bytes.length > 0) {
      queueTerminalInput(bytes);
      // Wake up select() via TTY poll callback (fast path: avoids 30s setitimer wait).
      // When wait_reading_process_output calls select() on the keyboard fd, our poll
      // override saves the makeNotifyCallback. Calling it here signals "POLLIN: data ready",
      // so select() returns immediately and read_char can read the byte.
      if (typeof self.__wasmacsSelectCallback === "function") {
        self.__wasmacsSelectCallback(1); // POLLIN
        self.__wasmacsSelectCallback = null;
      }
      // Also resolve any pending wasmacs_host_wait_for_input (emfile_read path).
      if (typeof self.__wasmacsResolveHostInputWait === "function") {
        self.__wasmacsResolveHostInputWait();
      }
    }
  }
  if (event.data?.type === "emacs-read-state") {
    handleEmacsReadState(event.data);
  }
};

async function ensureAsyncifyEmacs() {
  if (emacsReady) {
    await emacsReady;
    return emacsModule;
  }

  post("status", { text: "loading asyncify emacs package" });
  emacsReady = new Promise((resolve, reject) => {
    var Module = {
      noInitialRun: true,
      thisProgram: "emacs",
      locateFile(path) {
        return `${ARTIFACT_DIR}/${path}`;
      },
      print(text) {
        recentOutput.push(`OUT:${text}`);
        recordDiagnostic("stdout", { text });
        post("stdout", { text });
      },
      printErr(text) {
        recentOutput.push(`ERR:${text}`);
        recordDiagnostic("stderr", { text });
        post("stderr", { text });
      },
      onAbort(what) {
        recordDiagnostic("abort", { what });
      },
      onRuntimeInitialized() {
        emacsModule = Module;
        post("status", { text: "asyncify emacs runtime initialized" });
        startTerminalOutputStream();
        resolve(Module);
      },
    };

    self.Module = Module;

    try {
      importScripts(`${ARTIFACT_DIR}/temacs`);
    } catch (error) {
      reject(error);
    }
  });

  const module = await emacsReady;
  if (!booted) {
    await ensureBootstrapPdump(module);
    const bootCode = module.callMain(["--dump-file", `/${DUMP_FILE}`, "--no-loadup", "--batch", "--eval", '(princ "boot\\n")']);
    if (bootCode !== 0) {
      post("status", { text: `asyncify bootstrap boot exited ${bootCode}; continuing diagnostic` });
    }
    booted = true;
    post("status", { text: "asyncify emacs booted" });
  }
  return module;
}

async function ensureBootstrapPdump(module) {
  try {
    const stat = module.FS.stat(`/${DUMP_FILE}`);
    bootstrapPdumpInfo = { bytes: stat.size, mode: stat.mode, size: stat.size, existing: true };
    return;
  } catch {}
  const response = await fetch(`${ARTIFACT_DIR}/${DUMP_FILE}`);
  if (!response.ok) {
    throw new Error(`failed to fetch ${DUMP_FILE}: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  module.preRun = module.preRun || [];
  module.preRun.push(() => {
    module.FS.writeFile(`/${DUMP_FILE}`, bytes);
  });
  module.FS.writeFile(`/${DUMP_FILE}`, bytes);
  const stat = module.FS.stat(`/${DUMP_FILE}`);
  bootstrapPdumpInfo = { bytes: bytes.length, mode: stat.mode, size: stat.size };
}

async function runBootProbe(options = {}) {
  try {
    recentOutput = [];
    const module = await ensureAsyncifyRuntimeOnly();
    const args = options.noLoadup
      ? ["--batch", "--no-loadup", "--eval", '(princ "boot\\n")']
      : ["--batch", "--eval", '(princ "boot\\n")'];
    const status = module.callMain(args);
    post("asyncify-boot-probe-result", {
      passed: status === 0,
      status,
      noLoadup: Boolean(options.noLoadup),
      output: recentOutput.slice(-80),
    });
  } catch (error) {
    post("asyncify-boot-probe-result", {
      passed: false,
      noLoadup: Boolean(options.noLoadup),
      error: error && error.stack ? error.stack : String(error),
      output: recentOutput.slice(-80),
    });
  }
}

async function runInteractiveLoopProbe() {
  try {
    recentOutput = [];
    diagnosticEvents = [];
    const module = await ensureAsyncifyRuntimeOnly();
    const args = ["--quick", "--no-splash", "--nw"];
    post("status", { text: "starting pdmp-free interactive command loop probe", args });

    recordDiagnostic("before-callMain", { args, memory: readMemorySnapshot(module) });
    const pending = module.callMain(args);
    recordDiagnostic("after-callMain", {
      returnedPromise: Boolean(pending && typeof pending.then === "function"),
      returned: pending && typeof pending.then === "function" ? "promise" : pending,
      waitPending: Boolean(self.__wasmacsHostWaitForInputPending),
      waitCount: self.__wasmacsHostWaitForInputCount || 0,
      memory: readMemorySnapshot(module),
    });
    const hasAsyncMainPromise = Boolean(pending && typeof pending.then === "function");
    if (!hasAsyncMainPromise && !self.__wasmacsHostWaitForInputPending) {
      post("asyncify-interactive-loop-probe-result", {
        passed: false,
        error: `callMain returned synchronously before command loop waitpoint: ${pending}`,
        args,
        ttySnapshot: readTtySnapshot(module),
        entrypointState: module.ccall("wasmacs_entrypoint_state", "string", [], []),
        commandState: module.ccall("wasmacs_command_state", "string", [], []),
        minibufferState: module.ccall("wasmacs_minibuffer_state", "string", [], []),
        output: recentOutput.slice(-80),
      });
      return;
    }

    if (!self.__wasmacsHostWaitForInputPending) {
      await waitForHostInput(3000);
    }
    const initialMinibufferState = module.ccall("wasmacs_minibuffer_state", "string", [], []);
    const initialCommandState = module.ccall("wasmacs_command_state", "string", [], []);
    const outputByteCountBeforeInput = (self.__wasmacsTerminalOutputBytes || []).length;
    recordDiagnostic("before-input", { memory: readMemorySnapshot(module) });
    queueTerminalInput("a");
    if (typeof self.__wasmacsResolveHostInputWait !== "function") {
      post("asyncify-interactive-loop-probe-result", {
        passed: false,
        error: "host input wait resolver missing after first waitpoint",
        args,
        initialMinibufferState,
        initialCommandState,
        output: recentOutput.slice(-80),
      });
      return;
    }
    recordDiagnostic("before-resolve", { memory: readMemorySnapshot(module) });
    self.__wasmacsResolveHostInputWait();

    await waitForHostInput(3000);
    recordDiagnostic("after-second-wait", { memory: readMemorySnapshot(module) });
    const afterKeyMinibufferState = module.ccall("wasmacs_minibuffer_state", "string", [], []);
    const afterKeyCommandState = module.ccall("wasmacs_command_state", "string", [], []);
    const terminalBytes = Array.from(self.__wasmacsTerminalOutputBytes || []);
    const terminalOutputAdvanced = terminalBytes.length > outputByteCountBeforeInput;
    const abortEvents = diagnosticEvents.filter((event) => event.event === "abort");
    const abortOutput = recentOutput.filter((line) => /Aborted|OOM/i.test(line));
    post("asyncify-interactive-loop-probe-result", {
      passed: Boolean(
        self.__wasmacsHostWaitForInputCount >= 2 &&
        terminalOutputAdvanced &&
        abortEvents.length === 0 &&
        abortOutput.length === 0
      ),
      args,
      initialWaitpoint: true,
      callMainReturnedPromise: hasAsyncMainPromise,
      callMainStatus: hasAsyncMainPromise ? undefined : pending,
      ttySnapshot: readTtySnapshot(module),
      printableByteQueued: true,
      waitCount: self.__wasmacsHostWaitForInputCount || 0,
      terminalOutputAdvanced,
      outputByteCountBeforeInput,
      outputByteCountAfterInput: terminalBytes.length,
      abortOutput,
      initialMinibufferState,
      initialCommandState,
      afterKeyMinibufferState,
      afterKeyCommandState,
      terminalBytes: terminalBytes.slice(-200),
      output: recentOutput.slice(-80),
      diagnostics: diagnosticEvents.slice(-80),
      note: "pdmp-free startup reached command-loop waitpoint and accepted a printable terminal byte",
    });
  } catch (error) {
    post("asyncify-interactive-loop-probe-result", {
      passed: false,
      error: error && error.stack ? error.stack : String(error),
      output: recentOutput.slice(-80),
      diagnostics: diagnosticEvents.slice(-80),
    });
  }
}

async function startInteractiveCommandLoop() {
  try {
    recentOutput = [];
    diagnosticEvents = [];
    const module = await ensureAsyncifyRuntimeOnly();
    const args = ["--quick", "--no-splash", "--nw"];
    post("status", { text: "starting pdmp-free interactive command loop", args });
    recordDiagnostic("start-command-loop-before-callMain", { args, memory: readMemorySnapshot(module) });
    const status = module.callMain(args);
    post("interactive-command-loop-returned", {
      status,
      args,
      ttySnapshot: readTtySnapshot(module),
      output: recentOutput.slice(-80),
      diagnostics: diagnosticEvents.slice(-80),
    });
  } catch (error) {
    post("interactive-command-loop-returned", {
      passed: false,
      error: error && error.stack ? error.stack : String(error),
      output: recentOutput.slice(-80),
      diagnostics: diagnosticEvents.slice(-80),
    });
  }
}

async function runInteractiveSemanticsProbe() {
  try {
    recentOutput = [];
    diagnosticEvents = [];
    const module = await ensureAsyncifyRuntimeOnly();
    const args = ["--quick", "--no-splash", "--nw"];
    const steps = [];
    post("status", { text: "starting pdmp-free interactive semantics probe", args });

    recordDiagnostic("semantics-before-callMain", { args, memory: readMemorySnapshot(module) });
    const pending = module.callMain(args);
    const hasAsyncMainPromise = Boolean(pending && typeof pending.then === "function");
    if (!hasAsyncMainPromise && !self.__wasmacsHostWaitForInputPending) {
      post("asyncify-interactive-semantics-probe-result", {
        passed: false,
        error: `callMain returned synchronously before command loop waitpoint: ${pending}`,
        args,
        ttySnapshot: readTtySnapshot(module),
        output: recentOutput.slice(-80),
        diagnostics: diagnosticEvents.slice(-80),
      });
      return;
    }

    if (!self.__wasmacsHostWaitForInputPending) {
      await waitForHostInput(3000);
    }

    const initialOutput = readTerminalText();
    steps.push({ name: "initial-command-loop", outputByteCount: initialOutput.bytes.length });

    await sendTerminalBytesAndWait("abc", "insert-printable");
    const afterInsert = readTerminalText();
    steps.push({ name: "insert-printable", outputByteCount: afterInsert.bytes.length });

    await sendTerminalBytesAndWait([31], "undo"); // C-_ / C-/ terminal undo.
    const afterUndo = readTerminalText();
    steps.push({ name: "undo", outputByteCount: afterUndo.bytes.length });

    await sendTerminalBytesAndWait([24, 6], "find-file-prefix"); // C-x C-f.
    const minibufferOpen = readTerminalText();
    steps.push({ name: "minibuffer-open", outputByteCount: minibufferOpen.bytes.length });

    await sendTerminalBytesAndWait("wasmacs-real-route.txt\r", "find-file-submit", 1000);
    const afterFindFile = readTerminalText();
    steps.push({ name: "find-file-submit", outputByteCount: afterFindFile.bytes.length });

    const outputBytesBeforeSplit = (self.__wasmacsTerminalOutputBytes || []).length;
    await sendTerminalBytesAndWait([24, 50], "split-window"); // C-x 2.
    const afterSplit = readTerminalText();
    steps.push({ name: "split-window", outputByteCount: afterSplit.bytes.length });

    const abortEvents = diagnosticEvents.filter((event) => event.event === "abort");
    const abortOutput = recentOutput.filter((line) => /Aborted|OOM/i.test(line));
    const terminalBytes = Array.from(self.__wasmacsTerminalOutputBytes || []);
    const checks = {
      heapMiB: readMemorySnapshot(module).heapMiB,
      commandLoopReached:
        Boolean(self.__wasmacsHostWaitForInputPending) &&
        (self.__wasmacsHostWaitForInputCount || 0) >= 1 &&
        /\*scratch\*/.test(initialOutput.text),
      printableInserted: /abc/.test(afterInsert.text),
      undoRedisplayed:
        afterUndo.bytes.length > afterInsert.bytes.length &&
        !/abc$/.test(afterUndo.text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim()),
      minibufferOwnedByEmacs: /Find file:/.test(minibufferOpen.text),
      findFileSelectedBuffer:
        /wasmacs-real-route\.txt/.test(afterFindFile.text),
      splitWindow:
        (self.__wasmacsTerminalOutputBytes || []).length > outputBytesBeforeSplit &&
        countMatches(afterSplit.text, /wasmacs-real-route\.txt/g) >= 2,
      terminalOutputObserved: terminalBytes.length > 0,
      noAbort: abortEvents.length === 0 && abortOutput.length === 0,
    };

    post("asyncify-interactive-semantics-probe-result", {
      passed: Object.values(checks).every(Boolean),
      args,
      checks,
      steps,
      ttySnapshot: readTtySnapshot(module),
      waitCount: self.__wasmacsHostWaitForInputCount || 0,
      abortOutput,
      terminalTextTail: afterSplit.text.slice(-2000),
      terminalBytes: terminalBytes.slice(-240),
      output: recentOutput.slice(-80),
      diagnostics: diagnosticEvents.slice(-120),
      note: "terminal bytes exercised minibuffer, undo, buffer, and window semantics through the real Emacs command loop",
    });
  } catch (error) {
    post("asyncify-interactive-semantics-probe-result", {
      passed: false,
      error: error && error.stack ? error.stack : String(error),
      output: recentOutput.slice(-80),
      diagnostics: diagnosticEvents.slice(-120),
    });
  }
}

function readInteractiveState(module) {
  return parseStateLines(module.ccall("wasmacs_interactive_state", "string", [], []));
}

function readMinibufferState(module) {
  return parseStateLines(module.ccall("wasmacs_minibuffer_state", "string", [], []));
}

function parseStateLines(text = "") {
  const state = {};
  for (const line of String(text).split("\n")) {
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    state[line.slice(0, separator)] = line.slice(separator + 1);
  }
  state.raw = text;
  return state;
}

function readTerminalText() {
  const bytes = Array.from(self.__wasmacsTerminalOutputBytes || []);
  return {
    bytes,
    text: String.fromCharCode(...bytes.slice(-20000)),
  };
}

function countMatches(text, pattern) {
  return Array.from(String(text).matchAll(pattern)).length;
}

async function sendTerminalBytesAndWait(bytes, label, attempts = 500) {
  const previousWaitCount = self.__wasmacsHostWaitForInputCount || 0;
  recordDiagnostic("terminal-input", {
    label,
    previousWaitCount,
    queuedBytes: typeof bytes === "string" ? bytes.length : bytes?.length || 0,
    memory: readMemorySnapshot(),
  });
  queueTerminalInput(bytes);
  if (typeof self.__wasmacsResolveHostInputWait !== "function") {
    throw new Error(`host input wait resolver missing before ${label}`);
  }
  self.__wasmacsResolveHostInputWait();
  await waitForHostInputAfter(previousWaitCount, attempts, label);
  recordDiagnostic("terminal-input-complete", {
    label,
    waitCount: self.__wasmacsHostWaitForInputCount || 0,
    memory: readMemorySnapshot(),
  });
}

async function waitForHostInputAfter(previousWaitCount, attempts = 500, label = "terminal input") {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (
      self.__wasmacsHostWaitForInputPending &&
      (self.__wasmacsHostWaitForInputCount || 0) > previousWaitCount
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for asyncify host input waitpoint after ${label}`);
}

function readMemorySnapshot(_module = emacsModule) {
  // HEAPU8 and wasmMemory are NOT in EXPORTED_RUNTIME_METHODS for asyncify-spike.
  // Accessing module.HEAPU8 in the browser Worker throws RuntimeError: Aborted.
  // Use safe accessors only. heapBytes is omitted for artifacts without HEAPU8 export.
  let heapBytes;
  let bufferBytes;
  // wasmMemory and HEAPU8 are NOT in EXPORTED_RUNTIME_METHODS for asyncify-spike.
  // Accessing them triggers abort() (not a catchable JS exception) in the browser Worker.
  // Do NOT access module.wasmMemory or module.HEAPU8 here.
  return {
    heapBytes,
    bufferBytes,
    heapMiB: heapBytes ? Math.round(heapBytes / 1024 / 1024) : undefined,
    outputByteCount: (self.__wasmacsTerminalOutputBytes || []).length,
  };
}

function recordDiagnostic(event, details = {}) {
  diagnosticEvents.push({
    event,
    t: Date.now(),
    waitCount: self.__wasmacsHostWaitForInputCount || 0,
    waitPending: Boolean(self.__wasmacsHostWaitForInputPending),
    ...details,
  });
  if (diagnosticEvents.length > 200) {
    diagnosticEvents = diagnosticEvents.slice(-200);
  }
}

function readTtySnapshot(module) {
  function streamInfo(fd) {
    try {
      const stream = module.FS.getStream(fd);
      return {
        fd,
        path: stream?.path,
        tty: Boolean(stream?.tty),
        seekable: Boolean(stream?.seekable),
      };
    } catch (error) {
      return { fd, error: String(error) };
    }
  }
  // ENV is not in EXPORTED_RUNTIME_METHODS for asyncify-spike — safe accessor needed.
  let term, termcap;
  try { term = module.ENV?.TERM; } catch {}
  try { termcap = module.ENV?.TERMCAP; } catch {}
  return {
    term,
    termcap,
    streams: [streamInfo(0), streamInfo(1), streamInfo(2), streamInfo(3)],
    waitCount: self.__wasmacsHostWaitForInputCount || 0,
    waitPending: Boolean(self.__wasmacsHostWaitForInputPending),
    inputBytes: Array.from(self.__wasmacsTerminalInputBytes || []),
    outputByteCount: (self.__wasmacsTerminalOutputBytes || []).length,
  };
}

function queueTerminalInput(input = "") {
  if (typeof self.__wasmacsQueueTerminalInput !== "function") {
    throw new Error("terminal input queue is unavailable");
  }
  self.__wasmacsQueueTerminalInput(input);
}

async function ensureAsyncifyRuntimeOnly() {
  if (emacsReady) {
    await emacsReady;
    return emacsModule;
  }

  post("status", { text: "loading asyncify emacs package" });
  emacsReady = new Promise((resolve, reject) => {
    var Module = {
      noInitialRun: true,
      thisProgram: "emacs",
      locateFile(path) {
        return `${ARTIFACT_DIR}/${path}`;
      },
      print(text) {
        recentOutput.push(`OUT:${text}`);
        recordDiagnostic("stdout", { text });
        post("stdout", { text });
      },
      printErr(text) {
        recentOutput.push(`ERR:${text}`);
        recordDiagnostic("stderr", { text });
        post("stderr", { text });
      },
      onAbort(what) {
        recordDiagnostic("abort", { what });
      },
      onRuntimeInitialized() {
        emacsModule = Module;
        post("status", { text: "asyncify emacs runtime initialized" });
        startTerminalOutputStream();
        resolve(Module);
      },
    };

    self.Module = Module;

    try {
      importScripts(`${ARTIFACT_DIR}/temacs`);
    } catch (error) {
      reject(error);
    }
  });

  return emacsReady;
}

// ensureXtermEmacs: loads XTERM_ARTIFACT_DIR (asyncify-spike) for interactive --nw sessions.
// Separate from ensureAsyncifyRuntimeOnly (which uses emacs-browser-interactive) because
// emacs-browser-interactive callMain returns synchronously, ending the session immediately.
async function ensureXtermEmacs() {
  if (xtermEmacsReady) {
    await xtermEmacsReady;
    return xtermEmacsModule;
  }

  post("status", { text: "loading xterm emacs package" });
  xtermEmacsReady = new Promise((resolve, reject) => {
    var Module = {
      noInitialRun: true,
      thisProgram: "emacs",
      locateFile(path) {
        return `${XTERM_ARTIFACT_DIR}/${path}`;
      },
      print(text) {
        recentOutput.push(`OUT:${text}`);
        recordDiagnostic("stdout", { text });
        post("stdout", { text });
        // Report loadup progress for diagnostic display.
        if (text.startsWith("Loading ") || text.startsWith("Source file ")) {
          post("xterm-loadup-checkpoint", { phase: "loading", file: text.slice(0, 120) });
        }
      },
      printErr(text) {
        recentOutput.push(`ERR:${text}`);
        recordDiagnostic("stderr", { text });
        post("stderr", { text });
        // Propagate boot errors to xterm-session-error for visibility.
        if (/error|Error|failed|abort|stack/i.test(text)) {
          post("xterm-session-error", { error: text.slice(0, 200) });
        }
      },
      onAbort(what) {
        recordDiagnostic("abort", { what });
        post("xterm-session-error", { error: `abort: ${what}` });
      },
      onRuntimeInitialized() {
        xtermEmacsModule = Module;
        post("status", { text: "xterm emacs runtime initialized" });
        startTerminalOutputStream();
        // Override TTY stdin poll to check our input queue.
        // Root cause of 30-second latency: Emacs's wait_reading_process_output calls
        // select(fd0, timeout=30s). If fd0 poll returns "not ready" (no data in
        // Emscripten's tty.input), select() suspends via Asyncify for the full timeout.
        // Fix: our poll checks __wasmacsTerminalInputBytes; if data is available,
        // returns POLLIN immediately. If not, saves the async callback so that
        // emacs-input-bytes handler can wake up select() when data arrives.
        try {
          const stream0 = Module.FS.getStream(0);
          if (stream0 && stream0.tty) {
            stream0.stream_ops.poll = function(_stream, _timeout, cb) {
              const qLen = (self.__wasmacsTerminalInputBytes || []).length;
              if (qLen > 0) {
                if (cb) cb(1); // POLLIN: data ready
                return 1;
              }
              // No data: save callback so input handler can wake select() up
              if (cb) self.__wasmacsSelectCallback = cb;
              return 0; // Not ready
            };
          }
        } catch (_e) {
          // Non-fatal: fall back to existing wait mechanism
        }
        resolve(Module);
      },
    };

    self.Module = Module;

    // Patch self.setTimeout BEFORE importScripts so the module captures the patched version.
    // Root cause: Emacs calls setitimer(ITIMER_REAL, 30) → Emscripten creates setTimeout(fn, 30000).
    // After each key press, Emacs busy-loops calling setitimer hundreds of times (select() returns
    // immediately in wasm). The last setTimeout fires after ~30 seconds, resuming wasm to run
    // auto-save timer callbacks. This causes a 30-second delay after every key press.
    // Fix: reduce any setTimeout >= 5000ms to 1ms, so SIGALRM callbacks run immediately.
    // This allows Emacs's timer processing to complete quickly and return to interactive wait.
    if (!self.__wasmacsSetTimeoutPatched) {
      self.__wasmacsSetTimeoutPatched = true;
      const _origSetTimeout = self.setTimeout;
      self.setTimeout = function wasmacsSetTimeout(fn, delay, ...args) {
        // Reduce Emscripten setitimer timeouts to fire quickly.
        // Emacs calls setitimer(ITIMER_REAL, N) via Emscripten's __setitimer_js,
        // which creates setTimeout(callback, N_ms). N starts at auto-save-timeout
        // (30s) and decreases each iteration of the wait_reading_process_output loop.
        // We reduce any timeout >= 500ms to 1ms to prevent long blocking.
        if (typeof delay === "number" && delay >= 500) {
          delay = 1;
        }
        return _origSetTimeout.call(self, fn, delay, ...args);
      };
    }

    try {
      importScripts(`${XTERM_ARTIFACT_DIR}/temacs`);
    } catch (error) {
      reject(error);
    }
  });

  return xtermEmacsReady;
}

async function startXtermSession() {
  try {
    recentOutput = [];
    diagnosticEvents = [];
    const module = await ensureXtermEmacs();

    // Product default: cold loadup (no pdump).
    // KNOWN OPEN BLOCKER: in browser Workers (JS stack ~1-4MB) this fails with
    //   RangeError: Maximum call stack size exceeded at temacs.wasm.eval_sub
    // because loadup.el recurses ~1000+ levels through eval_sub.
    // Node.js probes pass via --stack-size=65500. Browser Worker has no equivalent.
    // Diagnostic pdump workaround: use start-pdump-xterm-session message or ?boot=pdump.
    // Diagnostic: clear ALL timers and add pre/post-command timing hooks.
    // timer-list=nil: cancel all non-idle timers
    // timer-idle-list=nil: cancel all idle timers (including auto-save)
    // gc-cons-threshold=500MB: suppress GC
    // pre/post-command-hook: log timestamps to trace where 30s block occurs
    const args = ["--quick", "--no-splash", "--nw",
      "--eval", [
        "(setq timer-list nil timer-idle-list nil gc-cons-threshold 500000000)",
        "(add-hook 'pre-command-hook (lambda () (message \"PRE-CMD %.3f\" (float-time))))",
        "(add-hook 'post-command-hook (lambda () (message \"POST-CMD %.3f\" (float-time))))",
      ].join(" ")];
    post("status", { text: "starting xterm interactive session", args });

    // Post artifact fingerprint for diagnostic display in xterm-only page and logs.
    const fingerprint = readArtifactFingerprint(module);
    post("xterm-session-started", { args, artifact: XTERM_ARTIFACT_DIR });
    post("xterm-artifact-fingerprint", { fingerprint });
    recordDiagnostic("xterm-session-before-callMain", {
      args,
      artifact: XTERM_ARTIFACT_DIR,
      pdmpUrl: XTERM_PDMP_URL,
      memory: readMemorySnapshot(module),
    });

    // IMPORTANT: Do NOT await callMain directly.
    // In handleAsync Asyncify mode, callMain may return synchronously (number 0)
    // even while the WASM stack is suspended at a wait point.
    // Awaiting a synchronous 0 would immediately post xterm-session-returned → "session ended".
    // Instead: fire callMain, then poll __wasmacsHostWaitForInputPending to confirm
    // the session reached an interactive wait. Attach a .then() handler for the
    // case where callMain does return a Promise (browser Worker context).
    const callMainResult = module.callMain(args);
    const isPromise = Boolean(callMainResult && typeof callMainResult.then === "function");

    recordDiagnostic("xterm-session-callMain-returned", {
      isPromise,
      synchronousValue: isPromise ? null : callMainResult,
      waitPending: Boolean(self.__wasmacsHostWaitForInputPending),
      waitCount: self.__wasmacsHostWaitForInputCount || 0,
    });

    // Wire up Promise-based session-end notification if callMain returned a Promise.
    if (isPromise) {
      callMainResult.then((status) => {
        post("xterm-session-returned", {
          status,
          args,
          artifact: XTERM_ARTIFACT_DIR,
          output: recentOutput.slice(-80),
          diagnostics: diagnosticEvents.slice(-80),
        });
      }).catch((error) => {
        post("xterm-session-returned", {
          error: error && error.stack ? error.stack : String(error),
          args,
          artifact: XTERM_ARTIFACT_DIR,
          output: recentOutput.slice(-80),
          diagnostics: diagnosticEvents.slice(-80),
        });
      });
    }

    // Wait up to 5 minutes for the first interactive wait point.
    // In the browser, wasm JIT compilation (22MB) + cold loadup can take 60-120 seconds.
    // 30s was too short — loadup timed out, xterm-session-at-wait was never posted.
    let sessionAlive = false;
    if (self.__wasmacsHostWaitForInputPending) {
      sessionAlive = true;
    } else {
      try {
        await waitForXtermHostInput(300_000);
        sessionAlive = true;
      } catch {
        sessionAlive = false;
      }
    }

    if (!sessionAlive) {
      if (!isPromise) {
        post("xterm-session-returned", {
          status: callMainResult,
          args,
          artifact: XTERM_ARTIFACT_DIR,
          error: "Emacs did not reach interactive wait point within 5 minutes",
          output: recentOutput.slice(-80),
          diagnostics: diagnosticEvents.slice(-80),
        });
      }
      return;
    }

    // Session is alive at a wait point.
    post("status", { text: "xterm session interactive" });
    post("xterm-session-at-wait", {
      waitCount: self.__wasmacsHostWaitForInputCount || 0,
      terminalBytes: (self.__wasmacsTerminalOutputBytes || []).length,
      artifact: XTERM_ARTIFACT_DIR,
    });

    // For sync callMain (handleAsync mode): session runs indefinitely via the
    // worker event loop. emacs-input-bytes messages drive each wait → command → wait
    // cycle. The session ends when the worker is terminated by main.js.
    // No xterm-session-returned is posted here — it will come from .then() if
    // callMain was a Promise, or from worker termination.

  } catch (error) {
    post("xterm-session-returned", {
      error: error && error.stack ? error.stack : String(error),
      artifact: XTERM_ARTIFACT_DIR,
      output: recentOutput.slice(-80),
      diagnostics: diagnosticEvents.slice(-80),
    });
  }
}

// readArtifactFingerprint: collects diagnostic info about the loaded artifact.
// Used to compare probe route vs browser route.
function readArtifactFingerprint(module) {
  let stackSize, initialMemory, allowMemoryGrowth, asyncifyIgnoreIndirect;
  let handleAsyncMode = typeof globalThis.__wasmacsWaitImportMode !== "undefined"
    ? globalThis.__wasmacsWaitImportMode : (self.__wasmacsWaitImportMode ?? "unknown");
  // Read build-time constants embedded in the temacs JS if accessible.
  try { stackSize = module.STACK_SIZE; } catch {}
  try { initialMemory = module.INITIAL_MEMORY; } catch {}
  try { allowMemoryGrowth = module.ALLOW_MEMORY_GROWTH; } catch {}
  return {
    artifactDir: XTERM_ARTIFACT_DIR,
    wasmUrl: `${XTERM_ARTIFACT_DIR}/temacs.wasm`,
    dataUrl: `${XTERM_ARTIFACT_DIR}/temacs.data`,
    stackSize: stackSize ?? "not exported",
    initialMemory: initialMemory ?? "not exported",
    allowMemoryGrowth: allowMemoryGrowth ?? "not exported",
    asyncifyIgnoreIndirect: asyncifyIgnoreIndirect ?? "not exported",
    handleAsyncMode,
    heapU8Exported: (() => { try { return Boolean(module.HEAPU8); } catch { return false; } })(),
    envExported: (() => { try { return Boolean(module.ENV); } catch { return false; } })(),
    wasmacsQueueTerminalInputPresent: typeof self.__wasmacsQueueTerminalInput === "function",
    wasmacsTerminalOutputBytesPresent: Array.isArray(self.__wasmacsTerminalOutputBytes),
    note: "fingerprint collected after onRuntimeInitialized; some build-time flags not exported",
  };
}

// ── DIAGNOSTIC ONLY: pdump boot ────────────────────────────────────
// ensureXtermPdmp / startPdumpXtermSession are diagnostic utilities.
// They are NOT called from startXtermSession (the product path).
// Trigger via: postMessage({ type: "start-pdump-xterm-session" })
//           or: ?boot=pdump in xterm.html

let xtermPdmpLoaded = false;

async function ensureXtermPdmp(module) {
  if (xtermPdmpLoaded) return;
  post("status", { text: "[diagnostic] loading xterm pdump" });
  post("xterm-loadup-checkpoint", { phase: "pdmp-fetch-start", url: XTERM_PDMP_URL });
  try {
    const response = await fetch(XTERM_PDMP_URL);
    if (!response.ok) throw new Error(`fetch ${XTERM_PDMP_URL}: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    module.FS.writeFile(XTERM_PDMP_PATH, bytes);
    xtermPdmpLoaded = true;
    post("status", { text: `[diagnostic] xterm pdump loaded (${bytes.length} bytes)` });
    post("xterm-loadup-checkpoint", { phase: "pdmp-loaded", bytes: bytes.length });
  } catch (err) {
    post("xterm-loadup-checkpoint", { phase: "pdmp-load-failed", error: String(err) });
    throw err;
  }
}

async function startPdumpXtermSession() {
  // DIAGNOSTIC ONLY. Use when cold loadup stack overflow prevents startXtermSession.
  // Product xterm path: startXtermSession (cold loadup, may fail in browser Worker).
  try {
    recentOutput = [];
    diagnosticEvents = [];
    const module = await ensureXtermEmacs();
    await ensureXtermPdmp(module);
    const args = ["--dump-file", XTERM_PDMP_PATH, "--quick", "--no-splash", "--nw"];
    post("status", { text: "[diagnostic] starting pdump xterm session", args });
    post("xterm-session-started", { args, diagnostic: true, bootMode: "pdump" });
    post("xterm-artifact-fingerprint", { fingerprint: readArtifactFingerprint(module), bootMode: "pdump" });
    recordDiagnostic("pdump-xterm-session-before-callMain", { args, artifact: XTERM_ARTIFACT_DIR, pdmpUrl: XTERM_PDMP_URL });

    const callMainResult = module.callMain(args);
    const isPromise = Boolean(callMainResult && typeof callMainResult.then === "function");

    if (isPromise) {
      callMainResult.then((status) => {
        post("xterm-session-returned", { status, args, artifact: XTERM_ARTIFACT_DIR, bootMode: "pdump", output: recentOutput.slice(-80) });
      }).catch((error) => {
        post("xterm-session-returned", { error: error && error.stack ? error.stack : String(error), args, artifact: XTERM_ARTIFACT_DIR, bootMode: "pdump" });
      });
    }

    let sessionAlive = self.__wasmacsHostWaitForInputPending;
    if (!sessionAlive) {
      try { await waitForXtermHostInput(30_000); sessionAlive = true; } catch { sessionAlive = false; }
    }

    if (!sessionAlive) {
      post("xterm-session-returned", {
        status: callMainResult, args, artifact: XTERM_ARTIFACT_DIR, bootMode: "pdump",
        error: "pdump xterm: Emacs did not reach interactive wait",
        output: recentOutput.slice(-80),
      });
      return;
    }

    post("status", { text: "[diagnostic] pdump xterm session interactive" });
    post("xterm-session-at-wait", {
      waitCount: self.__wasmacsHostWaitForInputCount || 0,
      terminalBytes: (self.__wasmacsTerminalOutputBytes || []).length,
      artifact: XTERM_ARTIFACT_DIR,
      bootMode: "pdump",
      diagnostic: true,
    });
  } catch (error) {
    post("xterm-session-returned", {
      error: error && error.stack ? error.stack : String(error),
      artifact: XTERM_ARTIFACT_DIR,
      bootMode: "pdump",
      output: recentOutput.slice(-80),
    });
  }
}

async function waitForXtermHostInput(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (self.__wasmacsHostWaitForInputPending) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out waiting for xterm host input wait");
}

async function startMinibufferRead(command = { type: "minibuffer-read" }) {
  if (pendingCommand) {
    postPendingCommand(command, "unavailable", { error: "asyncify minibuffer command already pending" });
    return;
  }

  pendingCommand = command;
  try {
    const module = await ensureAsyncifyEmacs();
    postPendingCommand(command, "starting", { minibuffer: "Find file: " });
    const pending = module.ccall(
      "wasmacs_command_begin_minibuffer_force_probe",
      "number",
      [],
      [],
      { async: true },
    );

    await waitForHostInput();
    const minibufferState = module.ccall("wasmacs_minibuffer_state", "string", [], []);
    post("asyncify-minibuffer-state", { text: minibufferState });
    postPendingCommand(command, "pending-input", { minibuffer: "Find file: " });

    await new Promise((resolve) => {
      pendingInputResolver = resolve;
    });

    postPendingCommand(command, "resuming", { minibuffer: "Find file: " });
    if (typeof self.__wasmacsResolveHostInputWait !== "function") {
      throw new Error("asyncify host input wait resolver is unavailable");
    }
    self.__wasmacsResolveHostInputWait();

    const status = await pending;
    const readback = module.ccall("wasmacs_last_result", "string", [], []);
    const commandState = module.ccall("wasmacs_command_state", "string", [], []);
    const afterMinibufferState = module.ccall("wasmacs_minibuffer_state", "string", [], []);

    if (status !== 0 || commandState !== "idle") {
      throw new Error(`asyncify minibuffer read failed: status=${status} commandState=${commandState} readback=${readback}`);
    }

    postPendingCommand(command, "completed", { result: readback });
    post("asyncify-minibuffer-result", {
      passed: true,
      readback,
      commandState,
      minibufferState: afterMinibufferState,
    });
  } catch (error) {
    const message = error && error.stack ? error.stack : String(error);
    postPendingCommand(command, "failed", { error: message });
    post("asyncify-minibuffer-result", { passed: false, error: message });
  } finally {
    pendingCommand = undefined;
    pendingInputResolver = undefined;
  }
}

async function waitForHostInput(attempts = 500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (self.__wasmacsHostWaitForInputPending) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for asyncify host input waitpoint");
}

function handleEmacsReadState({ forms = [], tag }) {
  if (!emacsModule) {
    post("emacs-state-result", { tag, error: "emacs module not ready" });
    return;
  }
  const results = {};
  for (const { key, form } of forms) {
    const status = emacsModule.ccall("wasmacs_eval_string", "number", ["string"], [form]);
    results[key] = status === 0 ? emacsModule.ccall("wasmacs_last_result", "string", [], []) : `[eval error ${status}]`;
  }
  const commandState = emacsModule.ccall("wasmacs_command_state", "string", [], []);
  post("emacs-state-result", {
    tag,
    results,
    commandState,
    waitCount: self.__wasmacsHostWaitForInputCount ?? 0,
    waitPending: Boolean(self.__wasmacsHostWaitForInputPending),
  });
}

function injectInputText(text = "") {
  if (!pendingCommand || !pendingInputResolver) {
    post("asyncify-minibuffer-result", {
      passed: false,
      error: "asyncify minibuffer input arrived with no pending command",
    });
    return;
  }
  const status = emacsModule.ccall(
    "wasmacs_input_text",
    "number",
    ["string"],
    [text.endsWith("\n") ? text : `${text}\n`],
  );
  if (status !== 0) {
    post("asyncify-minibuffer-result", {
      passed: false,
      error: `wasmacs_input_text returned ${status}`,
    });
    return;
  }
  pendingInputResolver();
}
