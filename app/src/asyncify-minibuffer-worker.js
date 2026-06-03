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

self.onmessage = async (event) => {
  if (event.data?.type === "boot-probe") {
    await runBootProbe(event.data);
    return;
  }
  if (event.data?.type === "start-minibuffer-read") {
    await startMinibufferRead(event.data.command);
    return;
  }
  if (event.data?.type === "input-text") {
    injectInputText(event.data.text);
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
      thisProgram: "temacs",
      locateFile(path) {
        return `/artifacts/emacs-browser-asyncify-spike/${path}`;
      },
      print(text) {
        recentOutput.push(`OUT:${text}`);
        post("stdout", { text });
      },
      printErr(text) {
        recentOutput.push(`ERR:${text}`);
        post("stderr", { text });
      },
      onRuntimeInitialized() {
        emacsModule = Module;
        post("status", { text: "asyncify emacs runtime initialized" });
        resolve(Module);
      },
    };

    self.Module = Module;

    try {
      importScripts("/artifacts/emacs-browser-asyncify-spike/temacs");
    } catch (error) {
      reject(error);
    }
  });

  const module = await emacsReady;
  if (!booted) {
    const bootCode = module.callMain(["--batch", "--eval", '(princ "boot\\n")']);
    if (bootCode !== 0) throw new Error(`asyncify emacs boot exited ${bootCode}`);
    booted = true;
    post("status", { text: "asyncify emacs booted" });
  }
  return module;
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

async function ensureAsyncifyRuntimeOnly() {
  if (emacsReady) {
    await emacsReady;
    return emacsModule;
  }

  post("status", { text: "loading asyncify emacs package" });
  emacsReady = new Promise((resolve, reject) => {
    var Module = {
      noInitialRun: true,
      thisProgram: "temacs",
      locateFile(path) {
        return `/artifacts/emacs-browser-asyncify-spike/${path}`;
      },
      print(text) {
        recentOutput.push(`OUT:${text}`);
        post("stdout", { text });
      },
      printErr(text) {
        recentOutput.push(`ERR:${text}`);
        post("stderr", { text });
      },
      onRuntimeInitialized() {
        emacsModule = Module;
        post("status", { text: "asyncify emacs runtime initialized" });
        resolve(Module);
      },
    };

    self.Module = Module;

    try {
      importScripts("/artifacts/emacs-browser-asyncify-spike/temacs");
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

async function waitForHostInput() {
  for (let attempt = 0; attempt < 500; attempt += 1) {
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
