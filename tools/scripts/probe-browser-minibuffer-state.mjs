import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/build/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-minibuffer-state.txt`;
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
const evalStatus = context.Module.ccall(
  "wasmacs_eval_string",
  "number",
  ["string"],
  [[
    "(concat",
    ' "active:" (if (active-minibuffer-window) "true" "false") "\\n"',
    ' "depth:" (number-to-string (minibuffer-depth)) "\\n"',
    ' "current-minibuffer:" (if (minibufferp) "true" "false") "\\n"',
    ' "prompt-end:" (number-to-string (minibuffer-prompt-end)) "\\n"',
    ")",
  ].join(" ")],
);
const readback = context.Module.ccall("wasmacs_last_result", "string", [], []);

lines.push(`BOOT_EXIT:${boot}`);
lines.push(`EVAL_STATUS:${evalStatus}`);
lines.push(`READBACK:${readback}`);
await writeFile(logPath, `${lines.join("\n")}\n`);

if (boot !== 0) throw new Error(`expected boot exit 0, got ${boot}`);
if (evalStatus !== 0) throw new Error(`expected minibuffer state eval 0, got ${evalStatus}`);
if (!readback.includes("active:false\n")) throw new Error(`expected inactive minibuffer, got ${JSON.stringify(readback)}`);
if (!readback.includes("depth:0\n")) throw new Error(`expected minibuffer depth 0, got ${JSON.stringify(readback)}`);
if (!readback.includes("current-minibuffer:false\n")) {
  throw new Error(`expected current buffer to be non-minibuffer, got ${JSON.stringify(readback)}`);
}
if (!readback.includes("prompt-end:1\n")) throw new Error(`expected non-minibuffer prompt end 1, got ${JSON.stringify(readback)}`);

console.log("browser minibuffer state probe passed");
