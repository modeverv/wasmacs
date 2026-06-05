import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-dired-without-ls.txt`;
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
const configureStatus = context.Module.ccall("wasmacs_os_configure_dired_without_ls", "number", [], []);
const configureReadback = context.Module.ccall("wasmacs_last_result", "string", [], []);
const stateRaw = context.Module.ccall("wasmacs_os_filesystem_dired_state", "string", [], []);
const state = JSON.parse(stateRaw);
const probeStatus = context.Module.ccall("wasmacs_os_dired_without_ls_probe", "number", [], []);
const probeReadback = context.Module.ccall("wasmacs_last_result", "string", [], []);

lines.push(`BOOT_EXIT:${boot}`);
lines.push(`CONFIGURE_STATUS:${configureStatus}`);
lines.push(`CONFIGURE_READBACK:${configureReadback}`);
lines.push(`STATE:${stateRaw}`);
lines.push(`PROBE_STATUS:${probeStatus}`);
lines.push(`PROBE_READBACK:${probeReadback}`);
await writeFile(logPath, `${lines.join("\n")}\n`);

if (boot !== 0) {
  throw new Error(`expected boot callMain to exit 0, got ${boot}`);
}
if (configureStatus !== 0 || !configureReadback.includes("dired-without-ls-configured")) {
  throw new Error(`expected Dired without ls configuration to pass; see ${logPath}`);
}
if (state.diredBackend !== "ls-lisp" || state.usesHostProcess !== false) {
  throw new Error(`expected filesystem Dired state to force ls-lisp without host.process; see ${logPath}`);
}
for (const primitive of [
  "directory-files",
  "directory-files-and-attributes",
  "file-attributes",
  "file-directory-p",
  "file-readable-p",
  "file-symlink-p",
]) {
  if (!state.requiredPrimitives.includes(primitive)) {
    throw new Error(`expected Dired state to include ${primitive}; see ${logPath}`);
  }
}
if (probeStatus !== 0) {
  throw new Error(`expected Dired without ls probe to pass, got ${probeStatus}: ${probeReadback}; see ${logPath}`);
}
for (const required of [
  ":backend ls-lisp",
  ":host-process nil",
  ":directory-files t",
  ":directory-files-and-attributes t",
  ":file-attributes t",
  ":file-directory-p t",
  ":file-readable-p t",
]) {
  if (!probeReadback.includes(required)) {
    throw new Error(`expected probe readback to include ${required}; got ${probeReadback}; see ${logPath}`);
  }
}

process.exitCode = 0;
console.log("browser Dired without ls probe passed");
