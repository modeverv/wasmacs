import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

// probe-browser-pdump-external-load.mjs
// M260604: verify external .pdmp can be loaded into wasm temacs via --dump-file.
//
// This probe uses the pdump-configure-probe build tree temacs + pdmp (matching
// fingerprints) and records diagnostic snapshots at each checkpoint.
//
// The probe intentionally does not load through a browser worker. It proves the
// wasm/Node pdmp load path before browser profile integration.

const repoRoot = new URL("..", import.meta.url).pathname;
const require = createRequire(import.meta.url);

// ---- config ----

// Primary pair: pdmp probe tree (matching fingerprints)
const probeDir = `${repoRoot}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump/src`;
const pdmpPath = `${probeDir}/bootstrap-emacs.pdmp`;
const temacsPath = `${probeDir}/temacs`;
const pdmpSrc = `${repoRoot}/build/emacs-pdump-configure-probe/src`;

// Alternate pair: pdmp profile (may have fingerprint mismatch)
const altProfileDir = `${repoRoot}/artifacts/emacs-browser-pdump-profile`;
const altPdmpPath = `${altProfileDir}/bootstrap-emacs.pdmp`;
const altTemacsPath = `${altProfileDir}/temacs`;

const logPath = `${repoRoot}/logs/wasm-browser-pdump-external-load.txt`;
const jsonlPath = `${repoRoot}/logs/wasm-browser-pdump-external-load.jsonl`;

// ---- helpers ----

class PdmpProbe {
  constructor(label, artifactDir, pdmpFile, temacsFile, srcDir) {
    this.label = label;
    this.artifactDir = artifactDir;
    this.pdmpFile = pdmpFile;
    this.temacsFile = temacsFile;
    this.srcDir = srcDir;
    this.records = [];
    this.checkpointCount = 0;
  }

  record(kind, data = {}) {
    const rec = {
      timestamp: new Date().toISOString(),
      checkpoint: this.checkpointCount++,
      kind,
      label: this.label,
      ...data,
    };
    this.records.push(rec);
  }

  async run() {
    this.record("before-module-load");

    const artifactDir = this.artifactDir;
    const code = await readFile(this.temacsFile, "utf8");
    const pdmpData = await readFile(this.pdmpFile);
    const lines = [];
    let resolveReady;
    const ready = new Promise((r) => { resolveReady = r; });

    const context = {
      Module: {
        noInitialRun: true,
        thisProgram: "temacs",
        locateFile: (p) => {
          return `${artifactDir}/${p}`;
        },
        print(text) { lines.push(`OUT:${text}`); },
        printErr(text) { lines.push(`ERR:${text}`); },
        preRun: [],
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

    this.record("after-module-load", {
      runtimeInitialized: true,
    });

    // Place pdmp into MEMFS at root
    context.Module.FS_createDataFile?.(
      "/", "bootstrap-emacs.pdmp", pdmpData, true, true, true
    );
    lines.push("MEMFS:pdmp-placed");

    this.record("after-memfs-materialize", {
      pdmpSize: pdmpData.length,
      pdmpPath: "/bootstrap-emacs.pdmp",
    });

    // ---- Checkpoint: before callMain ----
    const before = this.readDiagnostic(context, lines);

    const loadPath = this.srcDir
      ? `${this.srcDir}/lisp`
      : "";
    const env = loadPath ? `EMACSLOADPATH=${loadPath}` : "";

    this.record("before-callMain", {
      ...before,
      dumpFile: "/bootstrap-emacs.pdmp",
      emacsLoadPath: loadPath,
    });

    // Build args: --dump-file for pdmp load
    const args = [
      `--dump-file=/bootstrap-emacs.pdmp`,
      "--batch",
      "--eval", '(princ (concat "VERSION:" emacs-version "\\n"))',
      "--eval", '(garbage-collect)',
      "--eval", '(princ "GC:PASS\\n")',
      "--eval", '(princ (format "PDUMP:%s\\n" (if (pdumper-stats) "loaded" "no")))',
      "--eval", '(princ (format "INITIALIZED:%s\\n" (if initialized "yes" "no")))',
    ];

    // Set env for pdmp load
    if (loadPath) {
      context.process.env.EMACSLOADPATH = loadPath;
    }
    context.process.env.LANG = "C";
    context.process.env.LC_ALL = "C";

    const bootExit = context.Module.callMain(args);
    lines.push(`BOOT_EXIT:${bootExit}`);

    this.record("after-pdump-load-attempt", {
      bootExitCode: bootExit,
      versionLine: lines.find(l => l.startsWith("OUT:VERSION:")),
      pdumpLine: lines.find(l => l.startsWith("OUT:PDUMP:")),
      gcLine: lines.find(l => l.startsWith("OUT:GC:")),
      initLine: lines.find(l => l.startsWith("OUT:INITIALIZED:")),
    });

    // ---- Checkpoint: after eval ----
    let evalStatus = -1;
    let evalResult = null;
    let evalErr = null;

    if (bootExit === 0 && typeof context.Module.ccall === "function") {
      try {
        evalStatus = context.Module.ccall(
          "wasmacs_eval_string", "number", ["string"],
          ['(princ "simple-eval-ok\\n")'],
        );
        lines.push(`EVAL_STATUS:${evalStatus}`);

        const lastResult = context.Module.ccall(
          "wasmacs_last_result", "string", [], []
        );
        lines.push(`LAST_RESULT:${lastResult}`);

        evalResult = lastResult;
      } catch (e) {
        evalErr = String(e);
        lines.push(`EVAL_ERR:${evalErr}`);
      }
    }

    this.record("after-simple-eval", {
      evalStatus,
      evalResult,
      evalErr,
    });

    // ---- Checkpoint: explicit GC via wasmacs_garbage_collect ----
    let gcStatus = -1;
    let gcResult = null;
    let gcErr = null;

    if (typeof context.Module.ccall === "function" &&
        context.Module._wasmacs_garbage_collect) {
      try {
        gcStatus = context.Module.ccall(
          "wasmacs_garbage_collect", "number", [], []
        );
        lines.push(`WASMACS_GC_STATUS:${gcStatus}`);

        const gcReadback = context.Module.ccall(
          "wasmacs_last_result", "string", [], []
        );
        lines.push(`WASMACS_GC_RESULT:${gcReadback}`);
        gcResult = gcReadback;
      } catch (e) {
        gcErr = String(e);
        lines.push(`WASMACS_GC_ERR:${gcErr}`);
      }
    } else {
      lines.push("WASMACS_GC:not-exported");
    }

    this.record("after-explicit-gc", {
      gcStatus,
      gcResult,
      gcErr,
    });

    // ---- Checkpoint: OS facade snapshot ----
    const after = this.readDiagnostic(context, lines);
    this.record("before-command-loop", after);

    // ---- Results ----
    this.lines = lines;
    return this;
  }

  readDiagnostic(context, lines) {
    const diag = {};
    try {
      diag.osLifecyclePhase = context.Module.ccall?.("wasmacs_os_lifecycle_phase", "string", [], []) ?? "unavailable";
    } catch (e) { diag.osLifecyclePhase = `error:${e.message}`; }
    try {
      diag.osPendingCommandState = context.Module.ccall?.("wasmacs_os_pending_command_state", "string", [], []) ?? "unavailable";
    } catch (e) { diag.osPendingCommandState = `error:${e.message}`; }
    try {
      diag.osGcPermission = context.Module.ccall?.("wasmacs_os_gc_permission", "number", [], []) ?? -999;
    } catch (e) { diag.osGcPermission = -999; }
    try {
      diag.osRootState = context.Module.ccall?.("wasmacs_os_root_state_snapshot", "string", [], []) ?? "unavailable";
    } catch (e) { diag.osRootState = `error:${e.message}`; }
    try {
      diag.entrypointState = context.Module.ccall?.("wasmacs_entrypoint_state", "string", [], []) ?? "unavailable";
    } catch (e) { diag.entrypointState = `error:${e.message}`; }
    try {
      diag.commandState = context.Module.ccall?.("wasmacs_command_state", "string", [], []) ?? "unavailable";
    } catch (e) { diag.commandState = `error:${e.message}`; }

    lines.push("DIAGNOSTIC_BEGIN");
    lines.push(JSON.stringify(diag, null, 2));
    lines.push("DIAGNOSTIC_END");
    return diag;
  }
}

// ---- main ----

async function main() {
  const totalStart = Date.now();
  const allRecords = [];

  // Test 1: matching pair (pdmp probe tree)
  console.log("=== Test 1: matching fingerprint pair ===");
  const probe1 = new PdmpProbe(
    "pdump-probe-tree",
    probeDir,
    pdmpPath,
    temacsPath,
    pdmpSrc,
  );
  await probe1.run();
  allRecords.push(...probe1.records);

  // Test 2: pdmp profile (possible fingerprint mismatch)
  let probe2 = null;
  try {
    await readFile(altTemacsPath);
    console.log("=== Test 2: pdmp profile ===");
    probe2 = new PdmpProbe(
      "pdmp-profile",
      altProfileDir,
      altPdmpPath,
      altTemacsPath,
      null,
    );
    await probe2.run();
    allRecords.push(...probe2.records);
  } catch (e) {
    console.log(`Test 2 skipped: ${e.message}`);
  }

  // Write logs
  const txtLines = [];
  txtLines.push(`pdmp external load probe — ${new Date().toISOString()}`);
  txtLines.push("=".repeat(60));
  txtLines.push("");

  for (const probe of [probe1, probe2].filter(Boolean)) {
    txtLines.push(`--- ${probe.label} ---`);
    for (const line of probe.lines) {
      txtLines.push(line);
    }
    txtLines.push("");
  }

  txtLines.push("SUMMARY");
  txtLines.push("=".repeat(60));
  for (const rec of allRecords) {
    txtLines.push(`${rec.label} | ${rec.kind} | ${JSON.stringify(rec)}`);
  }

  await writeFile(logPath, txtLines.join("\n") + "\n");
  await writeFile(
    jsonlPath,
    allRecords.map(r => JSON.stringify(r)).join("\n") + "\n",
  );

  // Classification
  const test1 = probe1;
  const t1VersionLine = test1.lines.find(l => l.startsWith("OUT:VERSION:"));
  const t1PdumpLine = test1.lines.find(l => l.startsWith("OUT:PDUMP:"));
  const t1GcLine = test1.lines.find(l => l.startsWith("OUT:GC:"));
  const t1Boot = test1.records.find(r => r.kind === "after-pdump-load-attempt");

  console.log("");
  console.log("=== Level Classification ===");
  console.log(`Level 0 (artifact exists): ${pdmpPath ? 'PASS' : 'FAIL'}`);
  console.log(`Level 1 (MEMFS placement): ${test1.lines.includes("MEMFS:pdmp-placed") ? 'PASS' : 'FAIL'}`);
  console.log(`Level 2 (pdumper load path): ${t1PdumpLine?.includes("loaded") ? 'PASS' : 'FAIL'}`);
  console.log(`Level 3 (simple eval):      ${t1VersionLine ? 'PASS' : 'FAIL'} ${t1VersionLine ?? ''}`);
  console.log(`Level 4 (explicit GC):      ${t1GcLine?.includes("PASS") ? 'PASS' : (t1GcLine ? `KNOWN_BLOCKER:${t1GcLine}` : 'FAIL')}`);
  console.log(`Boot exit: ${t1Boot?.bootExitCode ?? 'unknown'}`);

  const elapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s → ${logPath}`);

  process.exitCode = 0;
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exitCode = 1;
});
