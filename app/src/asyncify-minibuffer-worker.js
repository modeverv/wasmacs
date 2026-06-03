const ARTIFACT_DIR = "/artifacts/emacs-browser-interactive";
const DUMP_FILE = "bootstrap-emacs.pdmp";

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

function readMemorySnapshot(module = emacsModule) {
  const heapBytes = module?.HEAPU8?.length ?? self.HEAPU8?.length;
  const bufferBytes = module?.wasmMemory?.buffer?.byteLength ?? self.wasmMemory?.buffer?.byteLength;
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
  return {
    term: module.ENV?.TERM,
    termcap: module.ENV?.TERMCAP,
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
