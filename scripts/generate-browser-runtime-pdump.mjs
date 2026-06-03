/**
 * Generate bootstrap-emacs.pdmp using the browser runtime binary.
 *
 * ENV must be set in a preRun callback so it is available before callMain
 * runs init_lread.  Setting Module.ENV after onRuntimeInitialized is too
 * late because getEnvStrings() may have been called and cached already.
 *
 * Usage:
 *   node --stack-size=65500 scripts/generate-browser-runtime-pdump.mjs \
 *     <artifact-dir> <output-pdmp-path>
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const [, , artifactDir, outputPdmpPath] = process.argv;
if (!artifactDir || !outputPdmpPath) {
  console.error("Usage: generate-browser-runtime-pdump.mjs <artifact-dir> <output-pdmp>");
  process.exit(1);
}

const require = createRequire(import.meta.url);

async function makeModule(extraSetup) {
  const code = await readFile(`${artifactDir}/temacs`, "utf8");
  let resolve;
  const ready = new Promise((r) => { resolve = r; });
  const lines = [];
  const mod = {
    noInitialRun: true,
    thisProgram: "temacs",
    locateFile: (f) => `${artifactDir}/${f}`,
    print:    (t) => { lines.push(`OUT:${t}`); },
    printErr: (t) => { if (!/syscall|arch-dep|prlimit/.test(t)) lines.push(`ERR:${t}`); },
    onRuntimeInitialized() { resolve(); },
    // preRun fires after wasm loads but before callMain — the right time for ENV
    preRun: [() => {
      mod.ENV["EMACSLOADPATH"] = "/usr/local/share/emacs/30.2/lisp";
      mod.ENV["TERM"] = "dumb";
      mod.ENV["LANG"] = "C";
      mod.ENV["HOME"] = "/home/user";
      if (extraSetup) extraSetup(mod);
    }],
  };
  const ctx = {
    Module: mod,
    Buffer, TextDecoder, TextEncoder, URL, WebAssembly,
    __dirname: artifactDir,
    __filename: `${artifactDir}/temacs`,
    clearTimeout, console, performance, process, require, setTimeout,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: "temacs" });
  await ready;
  return { mod, lines };
}

// --- Step 1: Run pbootstrap ---
process.stderr.write("pbootstrap: loading browser runtime...\n");
const { mod: M1, lines: l1 } = await makeModule(null);

process.stderr.write("pbootstrap: running loadup.el (this takes ~60s)...\n");
M1.callMain(["--batch", "-l", "loadup", "--temacs=pbootstrap"]);

// Print loadup progress markers
const progress = l1.filter((l) => l.startsWith("OUT:Loading") || l.startsWith("OUT:Dump"));
progress.slice(-5).forEach((l) => process.stderr.write(l.slice(4) + "\n"));

// Extract pdmp from virtual MEMFS — invocation-directory is "" so pdmp is at /
let pdmpBytes;
for (const path of ["/bootstrap-emacs.pdmp", "bootstrap-emacs.pdmp"]) {
  try {
    pdmpBytes = M1.FS.readFile(path);
    process.stderr.write(`pdmp found at ${path}\n`);
    break;
  } catch { /* try next */ }
}

if (!pdmpBytes) {
  // List root to help diagnose
  try {
    const files = M1.FS.readdir("/");
    process.stderr.write("FS / contents: " + files.join(" ") + "\n");
  } catch {}
  process.stderr.write("pbootstrap output (last 10 lines):\n");
  l1.slice(-10).forEach((l) => process.stderr.write("  " + l + "\n"));
  console.error("ERROR: bootstrap-emacs.pdmp not found");
  process.exit(1);
}

await writeFile(outputPdmpPath, pdmpBytes);
process.stderr.write(`pdmp written: ${outputPdmpPath} (${pdmpBytes.byteLength} bytes)\n`);

// --- Step 2: Verify pdmp load ---
process.stderr.write("verifying pdmp load...\n");
const { mod: M2, lines: l2 } = await makeModule((m) => {
  // Inject pdmp into MEMFS before callMain
  m.preRun.push(() => {
    m.FS.writeFile("/bootstrap-emacs.pdmp", pdmpBytes);
  });
});

M2.callMain([
  "--dump-file=/bootstrap-emacs.pdmp",
  "--batch",
  "--eval", '(princ (concat "VERSION:" emacs-version "\\n"))',
  "--eval", "(garbage-collect)",
  "--eval", '(princ "GC:PASS\\n")',
]);

const passed = l2.some((l) => l.includes("VERSION:30.2")) && l2.some((l) => l.includes("GC:PASS"));
if (passed) {
  process.stderr.write("pdmp load verification: PASS\n");
  console.log("STATUS:PASS");
  console.log(`PDMP:${outputPdmpPath}`);
  console.log(`SIZE:${pdmpBytes.byteLength}`);
} else {
  process.stderr.write("pdmp load verification: FAIL\n");
  l2.forEach((l) => process.stderr.write(l + "\n"));
  process.exit(1);
}
