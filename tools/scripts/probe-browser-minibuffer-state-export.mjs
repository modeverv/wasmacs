import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/build/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-minibuffer-state-export.txt`;
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
const state = context.Module.ccall("wasmacs_minibuffer_state", "string", [], []);

lines.push(`BOOT_EXIT:${boot}`);
lines.push(`STATE:${state}`);
await writeFile(logPath, `${lines.join("\n")}\n`);

if (boot !== 0) throw new Error(`expected boot exit 0, got ${boot}`);
if (!state.includes("active:false\n")) throw new Error(`expected inactive state, got ${JSON.stringify(state)}`);
if (!state.includes("depth:0\n")) throw new Error(`expected depth 0, got ${JSON.stringify(state)}`);
if (!state.includes("prompt:\n")) throw new Error(`expected empty prompt, got ${JSON.stringify(state)}`);
if (!state.includes("input:\n")) throw new Error(`expected empty input, got ${JSON.stringify(state)}`);
if (!state.includes("current-minibuffer:false\n")) {
  throw new Error(`expected current-minibuffer false, got ${JSON.stringify(state)}`);
}

console.log("browser minibuffer state export probe passed");
