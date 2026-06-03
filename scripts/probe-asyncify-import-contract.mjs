import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const fixtureC = `${repoRoot}/tests/fixtures/asyncify-import-contract.c`;
const fixtureLib = `${repoRoot}/tests/fixtures/asyncify-import-contract-library.js`;
const artifactDir = `${repoRoot}/artifacts/asyncify-import-contract`;
const textLogPath = `${repoRoot}/logs/wasm-browser-asyncify-import-contract.txt`;
const jsonlLogPath = `${repoRoot}/logs/wasm-browser-asyncify-import-contract.jsonl`;
const require = createRequire(import.meta.url);

mkdirSync(artifactDir, { recursive: true });
writeFileSync(textLogPath, "CASE:asyncify-import-contract\n");
writeFileSync(jsonlLogPath, "");

const emcc = process.env.EMCC ?? "emcc";
const build = spawnSync(emcc, [
  fixtureC,
  "-o", `${artifactDir}/asyncify-import-contract.js`,
  "-sEXIT_RUNTIME=0",
  "-sASYNCIFY=1",
  "-sASYNCIFY_IMPORTS=host_wait_manual_promise,host_wait_async_wrapper,host_wait_handle_async",
  "-sEXPORTED_RUNTIME_METHODS=ccall",
  "-sEXPORTED_FUNCTIONS=_fixture_call_manual_promise,_fixture_call_async_wrapper,_fixture_call_handle_async,_fixture_phase_value,_fixture_last_wait_value",
  "--no-entry",
  "--js-library", fixtureLib,
], {
  encoding: "utf8",
});

appendText(`BUILD_STATUS:${build.status}`);
if (build.stdout) appendText(`BUILD_STDOUT:${build.stdout.trimEnd()}`);
if (build.stderr) appendText(`BUILD_STDERR:${build.stderr.trimEnd()}`);
if (build.status !== 0) {
  throw new Error(`failed to build asyncify import fixture; see ${textLogPath}`);
}

const code = await readFile(`${artifactDir}/asyncify-import-contract.js`, "utf8");
let resolveReady;
const ready = new Promise((resolve) => {
  resolveReady = resolve;
});
const context = {
  Module: {
    noInitialRun: true,
    thisProgram: "asyncify-import-contract",
    locateFile(filePath) {
      return `${artifactDir}/${filePath}`;
    },
    print(text) {
      appendText(`OUT:${text}`);
    },
    printErr(text) {
      appendText(`ERR:${text}`);
    },
    onRuntimeInitialized() {
      appendText("READY");
      resolveReady();
    },
  },
  Buffer,
  TextDecoder,
  TextEncoder,
  URL,
  WebAssembly,
  __dirname: artifactDir,
  __filename: `${artifactDir}/asyncify-import-contract.js`,
  clearTimeout,
  console,
  performance,
  process,
  require,
  setTimeout,
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(code, context, { filename: "asyncify-import-contract.js" });
await ready;

const manual = await runCase({
  kind: "manual",
  exportName: "fixture_call_manual_promise",
  resolveValue: 7,
  expectedReturn: 20,
  expectedPhase: 201,
  expectedLastValue: 0,
  expectedSuspends: false,
});
const asyncWrapper = await runCase({
  kind: "async-wrapper",
  exportName: "fixture_call_async_wrapper",
  resolveValue: 5,
  expectedReturn: 10,
  expectedPhase: 101,
  expectedLastValue: 0,
  expectedSuspends: false,
});
const handleAsync = await runCase({
  kind: "handle-async",
  exportName: "fixture_call_handle_async",
  resolveValue: 3,
  expectedReturn: 43,
  expectedPhase: 301,
  expectedLastValue: 3,
  expectedSuspends: true,
});

const summary = {
  status: manual.passed && asyncWrapper.passed && handleAsync.passed ? "PASS" : "FAIL",
  cases: [manual, asyncWrapper, handleAsync],
  asyncifyImports: "host_wait_manual_promise,host_wait_async_wrapper,host_wait_handle_async",
};
appendText("SUMMARY_BEGIN");
appendText(JSON.stringify(summary, null, 2));
appendText("SUMMARY_END");

if (summary.status !== "PASS") {
  throw new Error(`asyncify import contract probe failed; see ${textLogPath}`);
}

console.log("asyncify import contract probe passed");

async function runCase({
  kind,
  exportName,
  resolveValue,
  expectedReturn,
  expectedPhase,
  expectedLastValue,
  expectedSuspends,
}) {
  const beforeEventCount = events().length;
  const resultPromise = context.Module.ccall(exportName, "number", [], [], { async: true });
  const returnedPromise = Boolean(resultPromise && typeof resultPromise.then === "function");
  await waitForEvent(`${kind}:resolver-bound`);
  const phaseBeforeResolve = ccallNumber("fixture_phase_value");
  const resolverResult = context.__asyncifyContractResolve(kind, resolveValue);
  await waitForEvent(`${kind}:promise-then`);
  const result = await Promise.race([
    resultPromise.then((value) => ({ kind: "completed", value })),
    new Promise((resolve) => setTimeout(() => resolve({ kind: "timeout" }), 2000)),
  ]);
  const phaseAfter = ccallNumber("fixture_phase_value");
  const lastValue = ccallNumber("fixture_last_wait_value");
  const caseEvents = events().slice(beforeEventCount);
  const promiseIdentity = promiseIdentitySummary(kind, caseEvents);
  const suspendedUntilResolve = phaseBeforeResolve !== expectedPhase;
  const passed = (
    returnedPromise &&
    resolverResult === true &&
    result.kind === "completed" &&
    result.value === expectedReturn &&
    phaseAfter === expectedPhase &&
    lastValue === expectedLastValue &&
    suspendedUntilResolve === expectedSuspends &&
    caseEvents.some((event) => event.label === `${kind}:promise-then`)
  );
  const snapshot = {
    checkpoint: `${kind}-complete`,
    kind,
    returnedPromise,
    phaseBeforeResolve,
    phaseAfter,
    lastValue,
    result,
    resolverResult,
    expectedSuspends,
    suspendedUntilResolve,
    promiseIdentity,
    events: caseEvents,
    passed,
  };
  appendJson(snapshot);
  appendText(`CHECKPOINT:${kind}-complete`);
  return {
    kind,
    passed,
    returnedPromise,
    phaseBeforeResolve,
    phaseAfter,
    lastValue,
    result,
    expectedSuspends,
    suspendedUntilResolve,
    promiseIdentity,
  };
}

function promiseIdentitySummary(kind, caseEvents) {
  const returned = caseEvents.find((event) => (
    event.label === `${kind}:promise-returned` ||
    event.label === `${kind}:promise-return-expression` ||
    event.label === `${kind}:handle-async-returned`
  ));
  return returned?.details || {};
}

async function waitForEvent(label, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (events().some((event) => event.label === label)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for fixture event ${label}`);
}

function ccallNumber(name) {
  return context.Module.ccall(name, "number", [], []);
}

function events() {
  return context.__asyncifyContractEvents || [];
}

function appendText(line) {
  writeFileSync(textLogPath, `${readTextLog()}${line}\n`);
}

function appendJson(value) {
  writeFileSync(jsonlLogPath, `${readJsonLog()}${JSON.stringify(value)}\n`);
}

function readTextLog() {
  try {
    return require("node:fs").readFileSync(textLogPath, "utf8");
  } catch {
    return "";
  }
}

function readJsonLog() {
  try {
    return require("node:fs").readFileSync(jsonlLogPath, "utf8");
  } catch {
    return "";
  }
}
