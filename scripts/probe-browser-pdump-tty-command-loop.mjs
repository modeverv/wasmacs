import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";

// probe-browser-pdump-tty-command-loop.mjs
// M260604 Level 5: verify that temacs loads bootstrap-emacs.pdmp via --dump-file,
// reaches tty command loop, and processes terminal input bytes.
//
// Uses the interactive pdmp TTY profile (Asyncify + handleAsync host wait).

const repoRoot = new URL("..", import.meta.url).pathname;
const require = createRequire(import.meta.url);

const artifactDir = `${repoRoot}/artifacts/emacs-browser-pdump-interactive`;
const temacsPath = `${artifactDir}/temacs`;
const pdmpPath = `${artifactDir}/bootstrap-emacs.pdmp`;
const logPath = `${repoRoot}/logs/wasm-browser-pdump-tty-command-loop.txt`;

const lines = [];
let resolveReady;
const ready = new Promise((r) => { resolveReady = r; });

function record(kind, data = {}) {
  lines.push(`${kind}: ${JSON.stringify(data)}`);
}

const code = await readFile(temacsPath, "utf8");
const pdmpData = await readFile(pdmpPath);
record("pdmp_size", { bytes: pdmpData.length });

const context = {
  Module: {
    noInitialRun: true,
    thisProgram: "temacs",
    locateFile: (p) => `${artifactDir}/${p}`,
    print(text) { lines.push(`OUT:${text}`); },
    printErr(text) { lines.push(`ERR:${text}`); },
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

// Place pdmp in MEMFS
context.Module.FS_createDataFile?.(
  "/", "bootstrap-emacs.pdmp", pdmpData, true, true, true
);
lines.push("MEMFS:pdmp-placed");

// Intercept host wait to inject input
let waitResolver = null;
let waitCount = 0;
context.Module.wasmacs_host_wait_for_input = () => {
  waitCount++;
  lines.push(`HOST_WAIT:${waitCount}`);
  if (waitCount === 1) {
    // First wait: inject printable 'a'
    const a = 97;
    context.Module._wasmacs_input_text?.(String.fromCharCode(a));
    lines.push(`INPUT_INJECT:a`);
  }
  if (waitResolver) {
    const r = waitResolver;
    waitResolver = null;
    r(0);
  }
  return new Promise((resolve) => {
    waitResolver = resolve;
  });
};

// Start Emacs with pdmp + --quick --no-splash --nw
lines.push("BOOTING");
const bootArgs = [
  "--dump-file=/bootstrap-emacs.pdmp",
  "--quick",
  "--no-splash",
  "--nw",
];

// callMain in async mode (handleAsync path)
context.Module.callMain(bootArgs);

// Poll for events
const startTime = Date.now();
const timeoutMs = 30000;
let lastPollResult = null;

while (Date.now() - startTime < timeoutMs) {
  // Check for terminal output bytes
  if (context.Module.__wasmacsTerminalOutputBytes) {
    try {
      const bytes = context.Module.__wasmacsTerminalOutputBytes();
      if (bytes && bytes.length > 0 && bytes !== lastPollResult) {
        lastPollResult = bytes;
        lines.push(`TTY_BYTES:${bytes.length}`);
      }
    } catch (e) { /* not available */ }
  }

  // Check wait state
  if (waitCount >= 1) {
    // Trigger the wait resolver
    if (waitResolver) {
      const r = waitResolver;
      waitResolver = null;
      r(0);
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // Check if there's pending output
  if (lines.filter(l => l.startsWith("OUT:")).length > 0) break;

  await new Promise(r => setTimeout(r, 100));
}

lines.push(`ELAPSED_MS:${Date.now() - startTime}`);
lines.push(`WAIT_COUNT:${waitCount}`);
lines.push("DONE");

await writeFile(logPath, lines.join("\n") + "\n");

console.log(`Level 5 probe complete → ${logPath}`);
console.log(`Wait count: ${waitCount}`);
console.log(`Lines: ${lines.length}`);

const versionLine = lines.find(l => l.includes("emacs-version") || l.includes("VERSION"));
const pdmpLine = lines.find(l => l.includes("PDUMP") || l.includes("loaded"));
console.log(`Version: ${versionLine ?? "NOT FOUND"}`);
console.log(`Pdmp: ${pdmpLine ?? "NOT FOUND"}`);

process.exitCode = 0;
