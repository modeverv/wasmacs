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
      thisProgram: "emacs",
      locateFile(path) {
        return `${ARTIFACT_DIR}/${path}`;
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
    const module = await ensureAsyncifyRuntimeOnly();
    const args = ["--quick", "--no-splash", "--nw"];
    post("status", { text: "starting pdmp-free interactive command loop probe", args });

    const pending = module.callMain(args);
    if (!(pending && typeof pending.then === "function")) {
      post("asyncify-interactive-loop-probe-result", {
        passed: false,
        error: `callMain returned synchronously before command loop waitpoint: ${pending}`,
        args,
        entrypointState: module.ccall("wasmacs_entrypoint_state", "string", [], []),
        commandState: module.ccall("wasmacs_command_state", "string", [], []),
        minibufferState: module.ccall("wasmacs_minibuffer_state", "string", [], []),
        output: recentOutput.slice(-80),
      });
      return;
    }

    await waitForHostInput(3000);
    const initialMinibufferState = module.ccall("wasmacs_minibuffer_state", "string", [], []);
    const initialCommandState = module.ccall("wasmacs_command_state", "string", [], []);
    const inputStatus = module.ccall(
      "wasmacs_input_text",
      "number",
      ["string"],
      [String.fromCharCode(24, 6)],
    );
    if (inputStatus !== 0) {
      post("asyncify-interactive-loop-probe-result", {
        passed: false,
        error: `wasmacs_input_text returned ${inputStatus}`,
        args,
        initialMinibufferState,
        initialCommandState,
        output: recentOutput.slice(-80),
      });
      return;
    }
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
    self.__wasmacsResolveHostInputWait();

    await waitForHostInput(3000);
    const afterKeyMinibufferState = module.ccall("wasmacs_minibuffer_state", "string", [], []);
    const afterKeyCommandState = module.ccall("wasmacs_command_state", "string", [], []);
    post("asyncify-interactive-loop-probe-result", {
      passed: afterKeyMinibufferState.includes("active:true"),
      args,
      initialWaitpoint: true,
      inputStatus,
      initialMinibufferState,
      initialCommandState,
      afterKeyMinibufferState,
      afterKeyCommandState,
      output: recentOutput.slice(-80),
      note: "pdmp-free startup reached command-loop waitpoint and accepted C-x C-f",
    });
  } catch (error) {
    post("asyncify-interactive-loop-probe-result", {
      passed: false,
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
      thisProgram: "emacs",
      locateFile(path) {
        return `${ARTIFACT_DIR}/${path}`;
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
