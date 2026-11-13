/**
 * Atomics command loop boot test for optimized wasm + pdump.
 *
 * Loads the temacs binary and bootstrap-emacs.pdmp from WASMACS_ARTIFACT_DIR
 * (defaults to build/artifacts/emacs-browser-atomics-pdump), boots with
 * --dump-file, and reports whether Atomics.wait is entered (command loop reached)
 * and whether terminal output is produced.
 *
 * Usage:
 *   WASMACS_ARTIFACT_DIR=build/artifacts/emacs-browser-atomics-pdump-O2-g0 \
 *     node --stack-size=65500 tools/scripts/probe-wasm-optimized-pdump-boot.mjs
 */
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isMainThread, parentPort, workerData } from "node:worker_threads";

if (!isMainThread) {
  const { artifactDir, logJsonlPath, bootArgs } = workerData;

  function ck(k, d = {}) {
    try { appendFileSync(logJsonlPath, JSON.stringify({ ts: Date.now(), k, ...d }) + "\n"); } catch (_) {}
  }

  async function run() {
    ck("worker-started", { artifactDir });
    let code, pdmp;
    try {
      code = readFileSync(`${artifactDir}/temacs`, "utf8");
      pdmp = readFileSync(`${artifactDir}/bootstrap-emacs.pdmp`);
      ck("files-loaded", { pdmpBytes: pdmp.length, codeBytes: code.length });
    } catch (e) {
      ck("file-load-failed", { e: e.message });
      parentPort.postMessage({ k: "done" });
      return;
    }

    const sab = new SharedArrayBuffer(264);
    const ttyOut = [];
    const ttyIn  = [];

    const origWait = Atomics.wait;
    const wrappedAtomics = new Proxy(Atomics, {
      get(target, prop) {
        if (prop === "wait")
          return function (arr, idx, val, timeout) {
            ck("atomics-wait-entered", { ttyOutLen: ttyOut.length });
            return origWait.call(target, arr, idx, val, timeout);
          };
        const v = target[prop];
        return typeof v === "function" ? v.bind(target) : v;
      },
    });

    let rdy;
    const ready = new Promise(r => { rdy = r; });

    const ctx = {
      Module: {
        noInitialRun: true,
        thisProgram: "/temacs",
        locateFile: p => `${artifactDir}/${p}`,
        print(t)    { ck("stdout", { t: t.substring(0, 500) }); },
        printErr(t) { ck("stderr", { t: t.substring(0, 500) }); },
        onAbort(w)  { ck("aborted", { w: String(w).substring(0, 500) }); },
        onRuntimeInitialized() { ck("runtime-initialized"); rdy(); },
      },
      Buffer, TextDecoder, TextEncoder, URL, WebAssembly,
      SharedArrayBuffer, Atomics: wrappedAtomics,
      __dirname: artifactDir, __filename: `${artifactDir}/temacs`,
      clearTimeout, console, performance, process, setTimeout,
      require: createRequire(`${artifactDir}/package.json`),
    };
    ctx.globalThis = ctx;
    ctx.self = {
      postMessage(m) {
        if (m?.type === "terminal-output-bytes") {
          ck("tty-flush", { n: m.bytes?.length || 0 });
        }
      },
    };

    const vm = await import("node:vm");
    vm.createContext(ctx);
    try {
      vm.runInContext(code, ctx, { filename: "temacs" });
    } catch (e) {
      ck("vm-run-threw", { e: e.message.substring(0, 300) });
      parentPort.postMessage({ k: "done" });
      return;
    }
    await ready;

    ctx.globalThis.__wasmacsInputSAB           = sab;
    ctx.globalThis.__wasmacsTerminalOutputBytes = ttyOut;
    ctx.globalThis.__wasmacsTerminalInputBytes  = ttyIn;
    ck("globals-set");

    try {
      ctx.Module.FS.writeFile("/temacs", new Uint8Array([0]));
      ctx.Module.FS.chmod("/temacs", 0o755);
      ck("argv0-placed");
    } catch (e) {
      ck("argv0-fail", { e: e.message });
    }

    try {
      ctx.Module.FS.writeFile("/bootstrap-emacs.pdmp", new Uint8Array(pdmp));
      const st = ctx.Module.FS.stat("/bootstrap-emacs.pdmp");
      ck("pdmp-placed", { size: st.size });
    } catch (e) {
      ck("pdmp-place-failed", { e: e.message });
      parentPort.postMessage({ k: "done" });
      return;
    }

    const args = bootArgs || [
      "--dump-file=/bootstrap-emacs.pdmp",
      "--quick", "--no-splash", "-nw",
      "--eval", "(setq uniquify-trailing-separator-p nil)",
      "--eval", "(setq create-lockfiles nil)",
    ];
    ck("callMain-start", { args: JSON.stringify(args) });

    try {
      const r = ctx.Module.callMain(args);
      ck("callMain-returned", { r });
    } catch (e) {
      ck("callMain-threw", { e: e.message.substring(0, 300), stack: String(e.stack || "").substring(0, 1000) });
    }

    if (ttyOut.length > 0) {
      const text = new TextDecoder().decode(new Uint8Array(ttyOut.slice(0, 4000)));
      ck("tty-output-sample", { n: ttyOut.length, text });
    }

    ck("worker-done");
    parentPort.postMessage({ k: "done" });
  }

  run().catch(e => {
    try { appendFileSync(workerData.logJsonlPath, JSON.stringify({ ts: Date.now(), k: "fatal", e: e.message }) + "\n"); } catch (_) {}
    parentPort.postMessage({ k: "done" });
  });

} else {
  const repoRoot = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
  const artifactDir = process.env.WASMACS_ARTIFACT_DIR
    || `${repoRoot}/build/artifacts/emacs-browser-atomics-pdump`;
  const logJ = `${repoRoot}/logs/wasm-optimized-pdump-boot.jsonl`;
  writeFileSync(logJ, "");

  const { Worker } = await import("node:worker_threads");
  const worker = new Worker(new URL(import.meta.url), {
    env: process.env,
    workerData: {
      artifactDir,
      logJsonlPath: logJ,
      bootArgs: process.env.WASMACS_PDUMP_BOOT_ARGS
        ? JSON.parse(process.env.WASMACS_PDUMP_BOOT_ARGS)
        : undefined,
    },
  });

  const timeout = parseInt(process.env.WASMACS_BOOT_TIMEOUT_MS || "10000", 10);
  await new Promise(r => setTimeout(r, timeout));

  const raw = (() => { try { return readFileSync(logJ, "utf8"); } catch (_) { return ""; } })();
  const entries = raw.trim().split("\n").filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch (_) { return { raw: l }; }
  });

  console.log(`\nCheckpoints (${entries.length}):`);
  for (const e of entries) {
    const ts = e.ts ? new Date(e.ts).toISOString().slice(11, 23) : "            ";
    const detail = e.t || e.e || e.w
      || (e.ttyOutLen !== undefined ? `ttyOut=${e.ttyOutLen}` : "")
      || (e.text ? e.text.substring(0, 120) : "")
      || "";
    console.log(`  ${ts}  ${e.k}  ${detail}`);
  }

  const kinds = entries.map(e => e.k);
  const reachedCommandLoop = kinds.includes("atomics-wait-entered");
  const hasTtyOutput       = kinds.some(e => e === "tty-flush" || e === "tty-output-sample");
  const aborted            = kinds.includes("aborted");
  const threw              = kinds.includes("callMain-threw") || kinds.includes("vm-run-threw");

  console.log(`\nartifactDir: ${artifactDir}`);
  console.log(`atomics-wait (command loop): ${reachedCommandLoop ? "YES" : "NO"}`);
  console.log(`tty-output:                  ${hasTtyOutput       ? "YES" : "NO"}`);
  console.log(`aborted:                     ${aborted            ? "YES" : "NO"}`);
  console.log(`threw:                       ${threw              ? "YES" : "NO"}`);

  if (reachedCommandLoop && hasTtyOutput) {
    console.log("\nRESULT:PASS command loop reached with tty output");
  } else if (reachedCommandLoop) {
    console.log("\nRESULT:PARTIAL command loop reached but no tty output");
  } else {
    console.log("\nRESULT:FAIL command loop not reached");
  }

  await worker.terminate();
}
