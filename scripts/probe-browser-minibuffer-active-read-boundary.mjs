import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = process.env.WASMACS_ARTIFACT_DIR ?? `${repoRoot}/artifacts/emacs-browser-persistent-spike`;
const logPath = process.env.WASMACS_LOG_PATH ?? `${repoRoot}/logs/wasm-browser-minibuffer-active-read-boundary.txt`;
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
    locateFile(filePath) {
      return `${artifactDir}/${filePath}`;
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
const initialCommandState = context.Module.ccall("wasmacs_command_state", "string", [], []);
const initialMinibufferState = context.Module.ccall("wasmacs_minibuffer_state", "string", [], []);
const beginStatus = context.Module.ccall("wasmacs_command_begin_minibuffer_probe", "number", [], []);
const beginReadback = context.Module.ccall("wasmacs_last_result", "string", [], []);
const afterCommandState = context.Module.ccall("wasmacs_command_state", "string", [], []);
const afterMinibufferState = context.Module.ccall("wasmacs_minibuffer_state", "string", [], []);

lines.push(`BOOT_EXIT:${boot}`);
lines.push(`INITIAL_COMMAND_STATE:${initialCommandState}`);
lines.push(`INITIAL_MINIBUFFER_STATE:${initialMinibufferState}`);
lines.push(`BEGIN_STATUS:${beginStatus}`);
lines.push(`BEGIN_READBACK:${beginReadback}`);
lines.push(`AFTER_COMMAND_STATE:${afterCommandState}`);
lines.push(`AFTER_MINIBUFFER_STATE:${afterMinibufferState}`);
await writeFile(logPath, `${lines.join("\n")}\n`);

if (boot !== 0) throw new Error(`expected boot exit 0, got ${boot}`);
if (initialCommandState !== "idle") throw new Error(`expected idle command state, got ${initialCommandState}`);
if (!initialMinibufferState.includes("active:false\n")) {
  throw new Error(`expected inactive initial minibuffer, got ${JSON.stringify(initialMinibufferState)}`);
}
if (beginStatus !== 3) throw new Error(`expected unavailable status 3, got ${beginStatus}`);
if (beginReadback !== "unavailable:noninteractive-batch") {
  throw new Error(`expected noninteractive unavailable readback, got ${JSON.stringify(beginReadback)}`);
}
if (afterCommandState !== "idle") throw new Error(`expected idle command state after unavailable, got ${afterCommandState}`);
if (!afterMinibufferState.includes("active:false\n") || !afterMinibufferState.includes("depth:0\n")) {
  throw new Error(`expected inactive minibuffer after unavailable, got ${JSON.stringify(afterMinibufferState)}`);
}

console.log("browser minibuffer active-read boundary probe passed");
