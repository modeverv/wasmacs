import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-os-diagnostic-facade.txt`;
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
const snapshot = {
  lifecycle: readDiagnosticJson("wasmacs_os_lifecycle_state"),
  stack: readDiagnosticJson("wasmacs_os_stack_bounds_probe"),
  gc: readDiagnosticJson("wasmacs_os_gc_permission_state"),
  rootSafety: readDiagnosticJson("wasmacs_os_root_safety_probe"),
};

lines.push(`BOOT_EXIT:${boot}`);
lines.push("SNAPSHOT_BEGIN");
lines.push(JSON.stringify(snapshot, null, 2));
lines.push("SNAPSHOT_END");
await writeFile(logPath, `${lines.join("\n")}\n`);

if (boot !== 0) {
  throw new Error(`expected boot callMain to exit 0, got ${boot}; see ${logPath}`);
}
for (const key of ["lifecycle", "stack", "gc", "rootSafety"]) {
  if (!snapshot[key] || typeof snapshot[key] !== "object") {
    throw new Error(`expected structured ${key} snapshot; see ${logPath}`);
  }
  if (snapshot[key].diagnostic !== true) {
    throw new Error(`expected ${key} snapshot to be diagnostic-only; see ${logPath}`);
  }
}
if (snapshot.lifecycle.service !== "Lifecycle") {
  throw new Error(`expected lifecycle service marker; see ${logPath}`);
}
if (snapshot.stack.service !== "Memory and Root") {
  throw new Error(`expected stack service marker; see ${logPath}`);
}
if (!Object.hasOwn(snapshot.gc, "allowed") || !Object.hasOwn(snapshot.gc, "reason")) {
  throw new Error(`expected gc permission fields; see ${logPath}`);
}
if (snapshot.rootSafety.policyDefined !== true) {
  throw new Error(`expected root safety policy to be defined; see ${logPath}`);
}

console.log("browser OS diagnostic facade probe passed");

function readDiagnosticJson(entrypoint) {
  const raw = context.Module.ccall(entrypoint, "string", [], []);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`failed to parse ${entrypoint} JSON: ${String(error)}: ${raw}`);
  }
}
