import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isMainThread, parentPort, workerData } from "node:worker_threads";

if (!isMainThread) {
  const { pdmpPath, temacsPath, temacsDir, logJsonlPath } = workerData;
  function ck(k, d = {}) { try { appendFileSync(logJsonlPath, JSON.stringify({ ts: Date.now(), k, ...d }) + "\n"); } catch (e) {} }

  async function run() {
    ck("vm-created");
    const code = readFileSync(temacsPath, "utf8");
    const pdmp = readFileSync(pdmpPath);
    ck("loaded", { pdmp: pdmp.length });

    const sab = new SharedArrayBuffer(264);
    const ttyOut = [], ttyIn = [];
    ck("sab-ready", { sz: sab.byteLength });

    // Proxy Atomics to intercept wait() for diagnostic checkpoint
    const origWait = Atomics.wait;
    const wrappedAtomics = new Proxy(Atomics, {
      get(target, prop) {
        if (prop === "wait")
          return function(arr, idx, val, timeout) {
            ck("atomics-wait-entered", { ttyOutLen: ttyOut.length, ttyInLen: ttyIn.length, hasTtyOutput: ttyOut.length > 0 });
            return origWait.call(target, arr, idx, val, timeout);
          };
        const v = target[prop];
        return typeof v === "function" ? v.bind(target) : v;
      },
    });

    let rdy; const ready = new Promise(r => { rdy = r; });
    const ctx = {
      Module: {
        noInitialRun: true, thisProgram: "/temacs",
        locateFile: p => `${temacsDir}/${p}`,
        print(t)   { ck("stdout", { t: t.substring(0, 1000) }); },
        printErr(t) { ck("stderr", { t: t.substring(0, 1000) }); },
        onAbort(what) { ck("onAbort", { what: String(what).substring(0, 1000) }); },
        onRuntimeInitialized() { ck("rt-init"); rdy(); },
      },
      Buffer, TextDecoder, TextEncoder, URL, WebAssembly, SharedArrayBuffer,
      Atomics: wrappedAtomics,
      __dirname: temacsDir, __filename: `${temacsDir}/temacs`,
      clearTimeout, console, performance, process,
      require: createRequire(temacsDir + "/package.json"), setTimeout,
    };
    ctx.globalThis = ctx;
    ctx.self = { postMessage: m => { if (m?.type === "terminal-output-bytes") ck("tty-flush", { n: m.bytes?.length || 0 }); }};

    const vm = await import("node:vm");
    vm.createContext(ctx);
    try { vm.runInContext(code, ctx, { filename: "temacs" }); }
    catch (e) { ck("vm-threw", { e: e.message.substring(0, 200) }); parentPort.postMessage({ k: "done" }); return; }
    await ready;

    ctx.globalThis.__wasmacsInputSAB = sab;
    ctx.globalThis.__wasmacsTerminalOutputBytes = ttyOut;
    ctx.globalThis.__wasmacsTerminalInputBytes = ttyIn;
    ck("globals-set");
    try {
      try {
        ctx.Module.FS.writeFile("/temacs", new Uint8Array([0]));
        ctx.Module.FS.chmod("/temacs", 0o755);
        const ast = ctx.Module.FS.stat("/temacs");
        ck("argv0-file-placed", { mode: ast.mode, size: ast.size });
      } catch (e) {
        ck("argv0-file-fail", { e: e.message });
      }
      if (ctx.Module.FS?.writeFile) {
        ctx.Module.FS.writeFile("/bootstrap-emacs.pdmp", new Uint8Array(pdmp));
      } else if (ctx.Module.FS?.createDataFile) {
        ctx.Module.FS.createDataFile("/", "bootstrap-emacs.pdmp", new Uint8Array(pdmp), true, true, true);
      } else if (ctx.Module.FS_createDataFile) {
        ctx.Module.FS_createDataFile("/", "bootstrap-emacs.pdmp", new Uint8Array(pdmp), true, true, true);
      } else {
        throw new Error("no FS write API");
      }
      const st = ctx.Module.FS.stat("/bootstrap-emacs.pdmp");
      ck("pdmp-placed", { size: st.size });
    }
    catch (e) { ck("pdmp-fail", { e: e.message }); }

    ck("before-callMain");
    const bootArgs = workerData.bootArgs || [
      "--dump-file=/bootstrap-emacs.pdmp", "--quick", "--no-splash", "-nw",
      "--eval", "(setq uniquify-trailing-separator-p nil)",
      "--eval", "(setq create-lockfiles nil)"
    ];
    ck("boot-args", { args: JSON.stringify(bootArgs) });
    try { const r = ctx.Module.callMain(bootArgs); ck("callMain-ret", { r }); }
    catch (e) {
      ck("callMain-threw", {
        e: e.message.substring(0, 200),
        stack: String(e.stack || "").substring(0, 2000)
      });
      ck("callMain-blocked-or-crashed");
    }
    if (ttyOut.length) {
      ck("tty-output", { n: ttyOut.length, t: new TextDecoder().decode(new Uint8Array(ttyOut.slice(0, 2000))) });
    }
    ck("worker-done");
    parentPort.postMessage({ k: "done" });
  }
  run().catch(e => { ck("fatal", { e: e.message }); parentPort.postMessage({ k: "done" }); });

} else {
  const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const logJ = `${repoRoot}/logs/wasm-browser-pdump-atomics-tty-command-loop.jsonl`;
  const logT = `${repoRoot}/logs/wasm-browser-pdump-atomics-tty-command-loop.txt`;
  writeFileSync(logJ, "");

  const { Worker } = await import("node:worker_threads");
  const worker = new Worker(new URL(import.meta.url), {
    env: process.env,
    workerData: {
      pdmpPath:   `${repoRoot}/artifacts/emacs-browser-atomics-pdump/bootstrap-emacs.pdmp`,
      temacsDir:  `${repoRoot}/artifacts/emacs-browser-atomics-pdump`,
      temacsPath: `${repoRoot}/artifacts/emacs-browser-atomics-pdump/temacs`,
      logJsonlPath: logJ,
      bootArgs: process.env.WASMACS_PDUMP_BOOT_ARGS
        ? JSON.parse(process.env.WASMACS_PDUMP_BOOT_ARGS)
        : undefined,
    },
  });

  await new Promise(r => setTimeout(r, 8000));

  try {
    const raw = readFileSync(logJ, "utf8");
    const entries = raw.trim().split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch(e) { return { raw: l }; }});
    console.log(`\nCheckpoints: ${entries.length}`);
    for (const e of entries) {
      const ts = e.ts ? new Date(e.ts).toISOString().slice(11, 23) : "";
      const v = e.t || e.e || e.r || (e.hasTtyOutput !== undefined ? `ttyOutLen=${e.ttyOutLen} hasTty=${e.hasTtyOutput}` : "");
      console.log(`  ${ts} ${e.k} ${v}`);
    }
    const kinds = entries.map(e => e.k);
    const waitE = entries.find(e => e.k === "atomics-wait-entered");
    console.log(`\nstderr:${kinds.includes("stderr")?"YES":"NO"} stdout:${kinds.includes("stdout")?"YES":"NO"} tty-flush:${kinds.includes("tty-flush")?"YES":"NO"}`);
    console.log(`atomics-wait:${kinds.includes("atomics-wait-entered")?"YES":"NO"} callMain-done:${kinds.some(k=>k==="callMain-ret"||k==="callMain-threw")?"YES":"NO"}`);
    if (waitE) console.log(`Wait at: ttyOutLen=${waitE.ttyOutLen}, hasTtyOutput=${waitE.hasTtyOutput}`);
    writeFileSync(logT, raw);
  } catch (e) { console.log(`No log: ${e.message}`); }
  await worker.terminate();
}
