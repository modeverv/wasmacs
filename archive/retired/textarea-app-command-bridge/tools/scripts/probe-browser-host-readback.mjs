import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/build/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-host-readback.txt`;
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
const commandForm = [
  "(concat",
  '  "{\\"path\\":\\"/home/user/readback.txt\\",\\"text\\":\\""',
  '  "readback text"',
  '  "\\",\\"point\\":14}")',
].join(" ");
const evalStatus = context.Module.ccall(
  "wasmacs_eval_string",
  "number",
  ["string"],
  [commandForm],
);
const readback = context.Module.ccall("wasmacs_last_result", "string", [], []);
const parsed = JSON.parse(readback);

lines.push(`BOOT_EXIT:${boot}`);
lines.push(`EVAL_STATUS:${evalStatus}`);
lines.push(`READBACK:${readback}`);
await writeFile(logPath, `${lines.join("\n")}\n`);

if (boot !== 0) {
  throw new Error(`expected boot callMain to exit 0, got ${boot}`);
}
if (evalStatus !== 0) {
  throw new Error(`expected wasmacs_eval_string to return 0, got ${evalStatus}`);
}
if (parsed.path !== "/home/user/readback.txt") {
  throw new Error(`expected readback path, got ${JSON.stringify(parsed.path)}`);
}
if (parsed.text !== "readback text" || parsed.point !== 14) {
  throw new Error(`unexpected readback payload ${readback}`);
}

process.exitCode = 0;
console.log("browser host readback probe passed");
