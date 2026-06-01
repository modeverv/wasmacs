import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-persistent-callmain.txt`;
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

const first = context.Module.callMain(["--batch", "--eval", '(princ "first\\n")']);
const second = context.Module.callMain(["--batch", "--eval", '(princ "second\\n")']);

lines.push(`FIRST_EXIT:${first}`);
lines.push(`SECOND_EXIT:${second}`);
await writeFile(logPath, `${lines.join("\n")}\n`);

if (first !== 0) {
  throw new Error(`expected first callMain to exit 0, got ${first}`);
}
if (second === 0) {
  throw new Error("expected repeated callMain batch invocation to fail until a host command entrypoint exists");
}

process.exitCode = 0;
console.log("browser persistent callMain probe passed: repeated batch callMain is not a reusable command loop");
