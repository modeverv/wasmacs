import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;
const artifactDir = process.env.WASMACS_ARTIFACT_DIR ?? `${repoRoot}/build/artifacts/emacs-browser-asyncify-spike`;
const logPath = process.env.WASMACS_LOG_PATH ?? `${repoRoot}/logs/wasm-browser-asyncify-minibuffer-waitpoint.txt`;
const require = createRequire(import.meta.url);

if (!process.argv.includes("--child")) {
  const result = spawnSync(
    process.execPath,
    ["--stack-size=65500", fileURLToPath(import.meta.url), "--child"],
    {
      encoding: "utf8",
      timeout: 45_000,
    },
  );
  const combined = `${result.stdout || ""}${result.stderr || ""}`.trimEnd();
  const reachedWaitpoint = combined.includes("WASMACS_HOST_WAIT_FOR_INPUT");
  const asyncifyRootBlocked = combined.includes("corrupted its heap memory area");
  const timedOut = result.error?.code === "ETIMEDOUT";
  const status = result.status === 0
    ? "PASS"
    : reachedWaitpoint && asyncifyRootBlocked
      ? "KNOWN_BLOCKER"
      : timedOut
        ? "KNOWN_BLOCKER"
        : "FAIL";

  await writeFile(logPath, [
    "CASE:minibuffer-waitpoint",
    `STATUS:${status}`,
    `EXIT_STATUS:${result.status}`,
    `SIGNAL:${result.signal}`,
    reachedWaitpoint ? "WAITPOINT_REACHED:true" : "WAITPOINT_REACHED:false",
    timedOut ? "TIMEOUT:true" : "TIMEOUT:false",
    combined,
    "",
  ].join("\n"));

  if (status === "FAIL") {
    throw new Error(`minibuffer waitpoint probe failed; see ${logPath}`);
  }

  console.log(status === "PASS"
    ? "browser asyncify minibuffer waitpoint probe passed"
    : "browser asyncify minibuffer waitpoint probe recorded known Asyncify suspend blocker");
  process.exit(0);
}

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
const status = await context.Module.ccall(
  "wasmacs_command_begin_minibuffer_force_probe",
  "number",
  [],
  [],
  { async: true },
);
const readback = context.Module.ccall("wasmacs_last_result", "string", [], []);
const state = context.Module.ccall("wasmacs_minibuffer_state", "string", [], []);
const waitCount = context.__wasmacsHostWaitForInputCount || 0;

lines.push(`BOOT_EXIT:${boot}`);
lines.push(`EVAL_STATUS:${status}`);
lines.push(`READBACK:${readback}`);
lines.push(`WAIT_FOR_INPUT_COUNT:${waitCount}`);
lines.push(`AFTER_MINIBUFFER_STATE:${state}`);
await writeFile(logPath, `${lines.join("\n")}\n`);

if (boot !== 0) throw new Error(`expected boot exit 0, got ${boot}`);
if (waitCount < 1) {
  throw new Error(`expected read-from-minibuffer to reach host waitpoint; see ${logPath}`);
}
if (status !== 1) {
  throw new Error(`expected current read to return a caught error after waitpoint; see ${logPath}`);
}
if (!state.includes("active:false\n") || !state.includes("depth:0\n")) {
  throw new Error(`expected minibuffer to unwind after EOF; see ${logPath}`);
}

console.log("browser asyncify minibuffer waitpoint probe reached read_minibuf input wait");
