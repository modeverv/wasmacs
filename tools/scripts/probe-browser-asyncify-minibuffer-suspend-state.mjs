import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;
const artifactDir = process.env.WASMACS_ARTIFACT_DIR ?? `${repoRoot}/build/artifacts/emacs-browser-asyncify-spike`;
const logPath = process.env.WASMACS_LOG_PATH ?? `${repoRoot}/logs/wasm-browser-asyncify-minibuffer-suspend-state.txt`;
const require = createRequire(import.meta.url);

if (!process.argv.includes("--child")) {
  const result = spawnSync(
    process.execPath,
    ["--stack-size=65500", fileURLToPath(import.meta.url), "--child"],
    {
      encoding: "utf8",
      timeout: 240_000,
    },
  );
  const combined = `${result.stdout || ""}${result.stderr || ""}`.trimEnd();
  if (result.error?.code === "ETIMEDOUT") {
    await writeFile(logPath, [
      "CASE:minibuffer-suspend-state",
      "STATUS:TIMEOUT",
      `EXIT_STATUS:${result.status}`,
      `SIGNAL:${result.signal}`,
      combined,
      "",
    ].join("\n"));
  }
  if (result.status !== 0) {
    throw new Error(`minibuffer suspend-state probe failed:\n${combined}`);
  }
  console.log(combined);
  process.exit(0);
}

const code = await readFile(`${artifactDir}/temacs`, "utf8");
const lines = ["CASE:minibuffer-suspend-state"];
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
lines.push(`BOOT_EXIT:${boot}`);
if (boot !== 0) {
  await writeFile(logPath, `${lines.join("\n")}\n`);
  throw new Error(`expected boot exit 0, got ${boot}`);
}

const pending = context.Module.ccall(
  "wasmacs_command_begin_minibuffer_force_probe",
  "number",
  [],
  [],
  { async: true },
);

let waitCount = 0;
for (let attempt = 0; attempt < 200; attempt += 1) {
  waitCount = context.__wasmacsHostWaitForInputCount || 0;
  if (waitCount > 0) break;
  await new Promise((resolve) => setTimeout(resolve, 10));
}

lines.push(`WAIT_FOR_INPUT_COUNT:${waitCount}`);
if (waitCount < 1) {
  await writeFile(logPath, `${lines.join("\n")}\n`);
  throw new Error(`expected forced minibuffer read to reach host waitpoint; see ${logPath}`);
}

let commandState = "";
let minibufferState = "";
let entrypointState = "";
let reentrantEvalStatus = -1;
let reentrantEvalReadback = "";
let reentrantCommandStatus = -1;
let reentrantCommandReadback = "";
try {
  commandState = context.Module.ccall("wasmacs_command_state", "string", [], []);
  minibufferState = context.Module.ccall("wasmacs_minibuffer_state", "string", [], []);
  entrypointState = context.Module.ccall("wasmacs_entrypoint_state", "string", [], []);
  reentrantEvalStatus = context.Module.ccall(
    "wasmacs_eval_string",
    "number",
    ["string"],
    ['(princ "should-not-run")'],
  );
  reentrantEvalReadback = context.Module.ccall("wasmacs_last_result", "string", [], []);
  reentrantCommandStatus = context.Module.ccall(
    "wasmacs_command_begin_minibuffer_force_probe",
    "number",
    [],
    [],
  );
  reentrantCommandReadback = context.Module.ccall("wasmacs_last_result", "string", [], []);
  lines.push(`COMMAND_STATE:${commandState}`);
  lines.push("MINIBUFFER_STATE_BEGIN");
  lines.push(minibufferState.trimEnd());
  lines.push("MINIBUFFER_STATE_END");
  lines.push("ENTRYPOINT_STATE_BEGIN");
  lines.push(entrypointState.trimEnd());
  lines.push("ENTRYPOINT_STATE_END");
  lines.push(`REENTRANT_EVAL_STATUS:${reentrantEvalStatus}`);
  lines.push(`REENTRANT_EVAL_READBACK:${reentrantEvalReadback}`);
  lines.push(`REENTRANT_COMMAND_STATUS:${reentrantCommandStatus}`);
  lines.push(`REENTRANT_COMMAND_READBACK:${reentrantCommandReadback}`);
} catch (error) {
  lines.push(`STATE_READ_ERROR:${error?.stack || error}`);
}

await writeFile(logPath, `${lines.join("\n")}\n`);

if (typeof pending?.catch === "function") {
  pending.catch(() => {});
}

if (commandState !== "pending") {
  throw new Error(`expected suspended command state pending; see ${logPath}`);
}
if (!minibufferState.includes("active:true\n") || !minibufferState.includes("depth:1\n")) {
  throw new Error(`expected active minibuffer state during suspension; see ${logPath}`);
}
if (!entrypointState.includes("command-state:pending\n")) {
  throw new Error(`expected entrypoint state to report pending command; see ${logPath}`);
}
if (!entrypointState.includes("pending-asyncify-command:true\n")) {
  throw new Error(`expected entrypoint state to report pending asyncify command; see ${logPath}`);
}
if (!entrypointState.includes("gc-inhibit-depth:1\n")) {
  throw new Error(`expected entrypoint state to report pending command GC inhibit depth; see ${logPath}`);
}
if (!entrypointState.includes("stack-bottom-refreshed:true\n")) {
  throw new Error(`expected entrypoint state to report refreshed stack bottom; see ${logPath}`);
}
if (!entrypointState.includes("stack-top-refreshed:true\n")) {
  throw new Error(`expected entrypoint state to report refreshed stack top; see ${logPath}`);
}
if (reentrantEvalStatus !== 3 || reentrantEvalReadback !== "unavailable:busy") {
  throw new Error(`expected reentrant eval to be unavailable:busy; see ${logPath}`);
}
if (reentrantCommandStatus !== 3 || reentrantCommandReadback !== "unavailable:busy") {
  throw new Error(`expected reentrant command begin to be unavailable:busy; see ${logPath}`);
}

console.log("browser asyncify minibuffer suspend-state probe passed");
process.exit(0);
