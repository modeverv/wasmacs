import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/build/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-host-file-command.txt`;
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

context.Module.FS_createPath("/", "home", true, true);
context.Module.FS_createPath("/home", "user", true, true);
context.Module.FS_createDataFile(
  "/home/user",
  "notes.txt",
  new TextEncoder().encode("alpha"),
  true,
  true,
  true,
);

const boot = context.Module.callMain(["--batch", "--eval", '(princ "boot\\n")']);
const commandForm = [
  '(let ((path "/home/user/notes.txt"))',
  "  (with-temp-buffer",
  "    (insert-file-contents path)",
  "    (goto-char (point-max))",
  '    (insert " beta")',
  "    (write-region (point-min) (point-max) path nil 'silent)",
  '    (princ "HOST_FILE_DONE\\n")))',
].join(" ");
const evalStatus = context.Module.ccall(
  "wasmacs_eval_string",
  "number",
  ["string"],
  [commandForm],
);
const text = context.Module.FS_readFile("/home/user/notes.txt", { encoding: "utf8" });

lines.push(`BOOT_EXIT:${boot}`);
lines.push(`EVAL_STATUS:${evalStatus}`);
lines.push(`FILE_TEXT:${text}`);
await writeFile(logPath, `${lines.join("\n")}\n`);

if (boot !== 0) {
  throw new Error(`expected boot callMain to exit 0, got ${boot}`);
}
if (evalStatus !== 0) {
  throw new Error(`expected wasmacs_eval_string to return 0, got ${evalStatus}`);
}
if (text !== "alpha beta") {
  throw new Error(`expected host file command to write alpha beta, got ${JSON.stringify(text)}`);
}

process.exitCode = 0;
console.log("browser host file command probe passed");
