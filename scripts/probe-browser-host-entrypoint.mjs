import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-host-entrypoint.txt`;
const require = createRequire(import.meta.url);

const code = await readFile(`${artifactDir}/temacs`, "utf8");
const lines = [];
let resolveReady;
const ready = new Promise((resolve) => {
  resolveReady = resolve;
});

const context = {
  Module: {
    noInitialRun: true,
    thisProgram: "temacs",
    locateFile(path) {
      return `${artifactDir}/${path}`;
    },
    print(text) {
      lines.push(`OUT:${text}`);
    },
    printErr(text) {
      lines.push(`ERR:${text}`);
    },
    onRuntimeInitialized() {
      lines.push("READY");
      resolveReady();
    },
  },
  Buffer,
  TextDecoder,
  TextEncoder,
  URL,
  WebAssembly,
  __dirname: artifactDir,
  __filename: `${artifactDir}/temacs`,
  clearTimeout,
  console,
  performance,
  process,
  require,
  setTimeout,
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(code, context, { filename: "temacs" });
await ready;

const boot = context.Module.callMain(["--batch", "--eval", '(princ "boot\\n")']);
const evalStatus = context.Module.ccall(
  "wasmacs_eval_string",
  "number",
  ["string"],
  ['(princ "entrypoint\\n")'],
);
const entrypointState = context.Module.ccall("wasmacs_entrypoint_state", "string", [], []);
const osLifecyclePhase = context.Module.ccall("wasmacs_os_lifecycle_phase", "string", [], []);
const osPendingCommandState = context.Module.ccall("wasmacs_os_pending_command_state", "string", [], []);
const osRootState = context.Module.ccall("wasmacs_os_root_state_snapshot", "string", [], []);
const osGcPermissionStatus = context.Module.ccall("wasmacs_os_gc_permission", "number", [], []);
const osGcPermissionReadback = context.Module.ccall("wasmacs_last_result", "string", [], []);

lines.push(`BOOT_EXIT:${boot}`);
lines.push(`EVAL_STATUS:${evalStatus}`);
lines.push(`OS_LIFECYCLE_PHASE:${osLifecyclePhase}`);
lines.push(`OS_PENDING_COMMAND_STATE:${osPendingCommandState}`);
lines.push(`OS_GC_PERMISSION_STATUS:${osGcPermissionStatus}`);
lines.push(`OS_GC_PERMISSION_READBACK:${osGcPermissionReadback}`);
lines.push("ENTRYPOINT_STATE_BEGIN");
lines.push(entrypointState.trimEnd());
lines.push("ENTRYPOINT_STATE_END");
lines.push("OS_ROOT_STATE_BEGIN");
lines.push(osRootState.trimEnd());
lines.push("OS_ROOT_STATE_END");
await writeFile(logPath, `${lines.join("\n")}\n`);

if (boot !== 0) {
  throw new Error(`expected boot callMain to exit 0, got ${boot}`);
}
if (evalStatus !== 0) {
  throw new Error(`expected wasmacs_eval_string to return 0, got ${evalStatus}`);
}
if (!lines.includes("OUT:entrypoint")) {
  throw new Error("expected host entrypoint eval to print entrypoint");
}
if (!entrypointState.includes("command-state:idle\n")) {
  throw new Error(`expected entrypoint state to report idle command state; see ${logPath}`);
}
if (!entrypointState.includes("pending-asyncify-command:false\n")) {
  throw new Error(`expected entrypoint state to report no pending asyncify command; see ${logPath}`);
}
if (!entrypointState.includes("stack-bottom-refreshed:true\n")) {
  throw new Error(`expected entrypoint state to report refreshed stack bottom; see ${logPath}`);
}
if (!entrypointState.includes("stack-top-refreshed:true\n")) {
  throw new Error(`expected entrypoint state to report refreshed stack top; see ${logPath}`);
}
if (osLifecyclePhase !== "initialized") {
  throw new Error(`expected C/wasm lifecycle facade to report initialized, got ${osLifecyclePhase}; see ${logPath}`);
}
if (osPendingCommandState !== "idle") {
  throw new Error(`expected C/wasm pending-command facade to report idle, got ${osPendingCommandState}; see ${logPath}`);
}
if (osGcPermissionStatus !== 0 || osGcPermissionReadback !== "gc-permission:allowed") {
  throw new Error(`expected C/wasm GC permission facade to allow GC, got ${osGcPermissionStatus} ${osGcPermissionReadback}; see ${logPath}`);
}
if (!osRootState.includes("stack-bottom-refreshed:true\n")) {
  throw new Error(`expected C/wasm root-state facade to report refreshed stack bottom; see ${logPath}`);
}

process.exitCode = 0;
console.log("browser host entrypoint probe passed");
