/**
 * probe-browser-asyncify-outer-resume.mjs
 *
 * Diagnostic-only.  Compares how different outer JS invocation methods
 * (callMain, ccall+async, direct _fn()) interact with Asyncify.handleAsync
 * inside the C import.  Correlates with the blocking-input-scheduler finding
 * that handleAsync mode stops unwind correctly but never resumes (no
 * js-import-promise-then, no c-keyboard-after-wait-return).
 *
 * Tested cases:
 *   A  callMain([])           – outer call does NOT set asyncPromiseHandlers
 *   B  ccall(fn, {async:true})– outer call calls Asyncify.whenDone()
 *   C  _fn() direct export    – no Asyncify outer wrapping at all
 *
 * For each case the probe records:
 *   • outer return type (Promise vs number)
 *   • Asyncify.currData / asyncPromiseHandlers after outer call returns
 *   • whether promise-then fires (the inner .then callback)
 *   • whether C post-wait phase advances (C resumed from wait)
 *   • Asyncify state after resolve
 *
 * Does NOT modify vendor/emacs.  Does NOT touch product path.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;
const fixtureC = `${repoRoot}/tests/fixtures/asyncify-outer-resume.c`;
const fixtureLib = `${repoRoot}/tests/fixtures/asyncify-outer-resume-library.js`;
const artifactDir = `${repoRoot}/build/artifacts/asyncify-outer-resume`;
const defaultLogStem = `${repoRoot}/logs/wasm-browser-asyncify-outer-resume`;
const textLogPath = process.env.WASMACS_TEXT_LOG_PATH ?? `${defaultLogStem}.txt`;
const jsonlLogPath = process.env.WASMACS_JSONL_LOG_PATH ?? `${defaultLogStem}.jsonl`;
const require = createRequire(import.meta.url);

const CASES = ["A-callMain", "B-ccall-async", "C-direct"];

if (!process.argv.includes("--child")) {
  writeFileSync(textLogPath, "CASE:asyncify-outer-resume\n");
  writeFileSync(jsonlLogPath, "");

  const results = [];
  let failed = false;
  for (const caseId of CASES) {
    const caseTextLog = `${defaultLogStem}-${caseId}.txt`;
    const caseJsonlLog = `${defaultLogStem}-${caseId}.jsonl`;
    writeFileSync(caseTextLog, `CASE:asyncify-outer-resume\nINVOCATION:${caseId}\n`);
    writeFileSync(caseJsonlLog, "");

    const result = spawnSync(
      process.execPath,
      ["--stack-size=65500", fileURLToPath(import.meta.url), "--child", `--case=${caseId}`],
      {
        encoding: "utf8",
        timeout: Number(process.env.WASMACS_OUTER_RESUME_TIMEOUT_MS ?? 30_000),
        env: {
          ...process.env,
          WASMACS_TEXT_LOG_PATH: caseTextLog,
          WASMACS_JSONL_LOG_PATH: caseJsonlLog,
        },
      },
    );

    appendFileSync(caseTextLog, [
      `EXIT_STATUS:${result.status}`,
      `SIGNAL:${result.signal}`,
      result.error?.code === "ETIMEDOUT" ? "TIMEOUT:true" : "TIMEOUT:false",
      "STDOUT_BEGIN",
      (result.stdout ?? "").trimEnd(),
      "STDOUT_END",
      "STDERR_BEGIN",
      (result.stderr ?? "").trimEnd(),
      "STDERR_END",
      "",
    ].join("\n"));

    const snapshots = parseJsonl(require("node:fs").readFileSync(caseJsonlLog, "utf8"));
    const summary = summarizeCase(caseId, result, snapshots);
    results.push(summary);
    appendFileSync(jsonlLogPath, `${JSON.stringify({ caseId, ...summary })}\n`);
    if (summary.status !== "PASS") failed = true;
  }

  const overallStatus = failed ? "FAIL" : "PASS";
  const compareLog = [
    "CASE:asyncify-outer-resume-compare",
    "SUMMARY_BEGIN",
    JSON.stringify({ status: overallStatus, cases: results }, null, 2),
    "SUMMARY_END",
    "",
  ].join("\n");
  writeFileSync(`${defaultLogStem}-compare.txt`, compareLog);
  appendFileSync(textLogPath, compareLog);

  if (failed) {
    throw new Error("asyncify outer resume probe: some cases did not pass — see logs/wasm-browser-asyncify-outer-resume*.txt");
  }
  console.log("asyncify outer resume probe: all cases recorded diagnostic checkpoints");
  process.exit(0);
}

/* ── Child process: run one case ──────────────────────────────────────── */

const caseArg = process.argv.find((a) => a.startsWith("--case="));
const caseId = caseArg ? caseArg.slice("--case=".length) : "A-callMain";
let sequence = 0;

appendText(`CASE:asyncify-outer-resume\nINVOCATION:${caseId}`);

const emcc = process.env.EMCC ?? "emcc";
const build = spawnSync(emcc, [
  fixtureC,
  "-o", `${artifactDir}/asyncify-outer-resume.js`,
  "-sEXIT_RUNTIME=0",
  "-sASYNCIFY=1",
  "-sASYNCIFY_IMPORTS=host_wait_handle_async",
  "-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,callMain",
  "-sEXPORTED_FUNCTIONS=_main,_fixture_call_handle_async,_fixture_post_wait_phase",
  "--js-library", fixtureLib,
], {
  encoding: "utf8",
  env: { ...process.env, EMCC_CORES: "4" },
});

appendText(`BUILD_STATUS:${build.status}`);
if (build.stdout) appendText(`BUILD_STDOUT:${build.stdout.trimEnd()}`);
if (build.stderr) appendText(`BUILD_STDERR:${build.stderr.trimEnd()}`);
if (build.status !== 0) {
  recordSnapshot("build-failure", { buildStatus: build.status });
  throw new Error(`asyncify-outer-resume: build failed (see ${textLogPath})`);
}

const code = await readFile(`${artifactDir}/asyncify-outer-resume.js`, "utf8");
let resolveReady;
const ready = new Promise((r) => { resolveReady = r; });
const context = {
  Module: {
    noInitialRun: true,
    thisProgram: "asyncify-outer-resume",
    locateFile(p) { return `${artifactDir}/${p}`; },
    print(text) { appendText(`OUT:${text}`); },
    printErr(text) { appendText(`ERR:${text}`); },
    onRuntimeInitialized() { appendText("READY"); resolveReady(); },
  },
  Buffer,
  TextDecoder,
  TextEncoder,
  URL,
  WebAssembly,
  __dirname: artifactDir,
  __filename: `${artifactDir}/asyncify-outer-resume.js`,
  clearTimeout,
  console,
  performance,
  process,
  require,
  setTimeout,
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(code, context, { filename: "asyncify-outer-resume.js" });
await ready;

recordSnapshot("after-boot");

try {
  await runCase(caseId);
} catch (err) {
  recordSnapshot("failure", { error: String(err?.stack ?? err) });
  throw err;
}

async function runCase(id) {
  const M = context.Module;

  if (id === "A-callMain") {
    recordSnapshot("before-outer-call", { invocation: "callMain([])" });
    const ret = M.callMain([]);
    const retIsPromise = Boolean(ret && typeof ret.then === "function");
    const asyncifyAfterCall = getAsyncifyState();
    recordSnapshot("after-outer-call", {
      invocation: "callMain([])",
      returnType: retIsPromise ? "Promise" : typeof ret,
      returnValue: retIsPromise ? "promise" : ret,
      asyncifyAfterCall,
    });

    await waitForEventOrTimeout("resolver-bound", 5000);
    recordSnapshot("resolver-bound-observed", { asyncifyState: getAsyncifyState() });

    const resolveResult = context.__outerResumeResolve?.(7);
    const asyncifyAfterResolve = getAsyncifyState();
    recordSnapshot("after-resolve", {
      resolveResult,
      asyncifyAfterResolve,
    });

    // Poll for promise-then to fire (up to 2000ms with 10ms intervals).
    const promiseThenFired = await pollForEvent("promise-then", 2000);
    const postWaitPhaseAfterPoll = ccallNumber("fixture_post_wait_phase");
    const asyncifyAfterPoll = getAsyncifyState();
    recordSnapshot("after-poll", {
      promiseThenFired,
      postWaitPhase: postWaitPhaseAfterPoll,
      expectedPostWaitPhase: 21,
      cResumed: postWaitPhaseAfterPoll === 21,
      asyncifyAfterPoll,
    });

  } else if (id === "B-ccall-async") {
    recordSnapshot("before-outer-call", { invocation: "ccall(fixture_call_handle_async, {async:true})" });
    const retPromise = M.ccall("fixture_call_handle_async", "number", [], [], { async: true });
    const retIsPromise = Boolean(retPromise && typeof retPromise.then === "function");
    const asyncifyAfterCall = getAsyncifyState();
    recordSnapshot("after-outer-call", {
      invocation: "ccall(fixture_call_handle_async, {async:true})",
      returnType: retIsPromise ? "Promise" : typeof retPromise,
      asyncifyAfterCall,
    });

    await waitForEventOrTimeout("resolver-bound", 5000);
    recordSnapshot("resolver-bound-observed", { asyncifyState: getAsyncifyState() });

    const resolveResult = context.__outerResumeResolve?.(7);
    const asyncifyAfterResolve = getAsyncifyState();
    recordSnapshot("after-resolve", { resolveResult, asyncifyAfterResolve });

    const promiseThenFired = await pollForEvent("promise-then", 2000);
    const postWaitPhaseAfterPoll = ccallNumber("fixture_post_wait_phase");
    const asyncifyAfterPoll = getAsyncifyState();

    let finalReturnValue = null;
    if (retIsPromise) {
      const raceResult = await Promise.race([
        retPromise.then((v) => ({ kind: "completed", value: v })),
        new Promise((r) => setTimeout(() => r({ kind: "timeout" }), 3000)),
      ]);
      finalReturnValue = raceResult;
    }

    recordSnapshot("after-poll", {
      promiseThenFired,
      postWaitPhase: postWaitPhaseAfterPoll,
      expectedPostWaitPhase: 11,
      cResumed: postWaitPhaseAfterPoll === 11,
      asyncifyAfterPoll,
      finalReturnValue,
    });

  } else if (id === "C-direct") {
    recordSnapshot("before-outer-call", { invocation: "_fixture_call_handle_async() direct" });
    let ret;
    try {
      ret = context.Module._fixture_call_handle_async?.();
    } catch (e) {
      ret = `throw:${String(e)}`;
    }
    const retIsPromise = Boolean(ret && typeof ret === "object" && typeof ret.then === "function");
    const asyncifyAfterCall = getAsyncifyState();
    recordSnapshot("after-outer-call", {
      invocation: "_fixture_call_handle_async()",
      returnType: retIsPromise ? "Promise" : typeof ret,
      returnValue: retIsPromise ? "promise" : ret,
      asyncifyAfterCall,
    });

    const resolveResult = context.__outerResumeResolve?.(7);
    const asyncifyAfterResolve = getAsyncifyState();
    recordSnapshot("after-resolve", { resolveResult, asyncifyAfterResolve });

    const promiseThenFired = await pollForEvent("promise-then", 2000);
    const postWaitPhaseAfterPoll = ccallNumber("fixture_post_wait_phase");
    recordSnapshot("after-poll", {
      promiseThenFired,
      postWaitPhase: postWaitPhaseAfterPoll,
      expectedPostWaitPhase: 11,
      cResumed: postWaitPhaseAfterPoll === 11,
    });
  }
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function getAsyncifyState() {
  return context.__outerResumeGetAsyncifyState?.() ?? { available: false };
}

function getEvents() {
  return Array.from(context.__outerResumeEvents || []);
}

function ccallNumber(name) {
  try {
    return context.Module.ccall(name, "number", [], []);
  } catch (e) {
    return null;
  }
}

async function waitForEventOrTimeout(label, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (getEvents().some((e) => e.label === label)) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

async function pollForEvent(label, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (getEvents().some((e) => e.label === label)) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

function recordSnapshot(checkpoint, details = {}) {
  const snap = {
    checkpoint,
    caseId,
    sequence: ++sequence,
    timestamp: new Date().toISOString(),
    monotonicMs: Math.round(performance.now() * 100) / 100,
    events: getEvents().map((e) => e.label),
    postWaitPhase: ccallNumber("fixture_post_wait_phase"),
    asyncifyState: getAsyncifyState(),
    details,
  };
  appendFileSync(jsonlLogPath, `${JSON.stringify(snap)}\n`);
  appendText(`CHECKPOINT:${checkpoint}`);
}

function appendText(line) {
  appendFileSync(textLogPath, `${line}\n`);
}

function parseJsonl(text) {
  return text.split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function summarizeCase(caseId, spawnResult, snapshots) {
  const checkpoints = new Set(snapshots.map((s) => s.checkpoint));
  const afterPoll = snapshots.find((s) => s.checkpoint === "after-poll");
  const afterCall = snapshots.find((s) => s.checkpoint === "after-outer-call");
  const promiseThenFired = afterPoll?.details?.promiseThenFired ?? false;
  const cResumed = afterPoll?.details?.cResumed ?? false;
  const returnedPromise = afterCall?.details?.returnType === "Promise";
  const asyncifyAfterCall = afterCall?.details?.asyncifyAfterCall ?? {};

  // PASS criteria: the probe ran to after-poll and recorded diagnostic data.
  // (Not requiring C to resume — this is a diagnostic probe, not a product test.)
  const status = checkpoints.has("after-poll") ? "PASS" : "FAIL";

  return {
    status,
    caseId,
    exitStatus: spawnResult.status,
    signal: spawnResult.signal,
    timedOut: spawnResult.error?.code === "ETIMEDOUT",
    checkpoints: [...checkpoints],
    returnedPromise,
    promiseThenFired,
    cResumed,
    asyncifyCurrDataAfterCall: asyncifyAfterCall.currDataPresent,
    asyncifyAsyncPromiseHandlersAfterCall: asyncifyAfterCall.asyncPromiseHandlersPresent,
  };
}
