// Real CPython + real Emacs run-python, using the product wasm runtime.
//   node tools/scripts/probe-python.mjs [name-filter]
//   WASMACS_PROCESS_PROBE_BUNDLE=docs node tools/scripts/probe-python.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import {
  batchEval, interactiveSession, buildArtifactDir, buildUserlandDir,
  docsArtifactDir, docsUserlandDir, repoRoot,
} from "./lib/pdump-node-harness.mjs";
import { fakeBrowserHttp, pythonBatchCases, pythonReplSteps } from "../../tests/process/python-cases.mjs";

const docs = process.env.WASMACS_PROCESS_PROBE_BUNDLE === "docs";
const boot = { artifactDir: docs ? docsArtifactDir : buildArtifactDir, userland: docs ? docsUserlandDir : buildUserlandDir };
const filter = process.argv[2] || "";
const lines = [`bundle: ${docs ? "docs" : "build"}`];
let failures = 0, checks = 0;
async function check(name, fn) {
  if (filter && !name.includes(filter)) return;
  checks++;
  const start = performance.now();
  try {
    await fn();
    const text = `PASS ${name} (${Math.round(performance.now() - start)}ms)`;
    lines.push(text); console.log(text);
  } catch (error) {
    failures++;
    const text = `FAIL ${name}: ${error.stack || error}`;
    lines.push(text); console.error(text);
  }
}
async function value(form, expected, options = {}) {
  const result = await batchEval(form, { ...boot, ...options });
  assert.equal(result.ok, true, `Emacs ${result.value}; ${result.stderr.slice(-5).join(" | ")}`);
  if (expected instanceof RegExp) assert.match(result.value, expected);
  else assert.equal(result.value, expected);
  return result;
}
for (const testCase of pythonBatchCases) {
  await check(testCase.name, async () => {
    const host = testCase.http ? fakeBrowserHttp() : null;
    await value(testCase.form, testCase.expected, host ? { prepare: host.prepare } : {});
    testCase.after?.(host);
  });
}
await check("run-python: multiline REPL, exception recovery, CPU-loop interruption and cleanup", async () => {
  let mounts, driver;
  const control = new Int32Array(new SharedArrayBuffer(8));
  try {
    const result = await interactiveSession({ ...boot, timeoutMs: 60_000,
      async prepare(emacs) {
        mounts = emacs.FS.getMounts(emacs.FS.root.mount).length;
        // A computing child need not reach Atomics.wait. Model the browser
        // page's independent input thread instead of relying on the Node
        // harness's idle callback to interrupt a running CPU loop.
        driver = new Worker(`
          const { parentPort, workerData } = require('node:worker_threads');
          const control = new Int32Array(workerData.control);
          const signal = new Int32Array(workerData.input, 0, 2);
          const bytes = new Uint8Array(workerData.input, 8);
          parentPort.postMessage('ready');
          Atomics.wait(control, 0, 0);
          Atomics.wait(control, 0, 1, 300);
          const deadline = Date.now() + 5000;
          while (Atomics.load(signal, 1) !== 0) {
            if (Date.now() > deadline) throw new Error('Emacs did not consume the loop input');
            Atomics.wait(control, 0, 1, 10);
          }
          bytes.fill(0); bytes.set([3, 3]);
          Atomics.store(signal, 1, 2); Atomics.add(signal, 0, 1); Atomics.notify(signal, 0);
          Atomics.store(control, 1, 1);
        `, { eval: true, workerData: { control: control.buffer, input: emacs.context.__wasmacsInputSAB } });
        await new Promise((resolve, reject) => {
          driver.once("message", resolve); driver.once("error", reject);
        });
      },
      steps: pythonReplSteps({ onCpuLoop() { Atomics.store(control, 0, 1); Atomics.notify(control, 0); } }),
    });
    for (const entry of result.log) lines.push(`  REPL ${entry.step} (${entry.atMs}ms)`);
    assert.equal(result.completed, true, JSON.stringify(result.failure));
    assert.equal(Atomics.load(control, 1), 1, "external input driver sent C-c C-c");
    assert.equal(result.emacs.FS.readFile("/home/user/python-repl.txt", { encoding: "utf8" }), "shared-file\n");
    assert.equal(result.emacs.kernel().liveCount(), 0);
    assert.equal(result.emacs.FS.getMounts(result.emacs.FS.root.mount).length, mounts);
  } finally {
    if (driver) await driver.terminate();
  }
});
await check("20 repeated Python processes leave no live processes or filesystem mounts", async () => {
  let mounts;
  const result = await value(`(let ((ok 0)) (dotimes (_ 20)
    (with-temp-buffer (when (and (= 0 (call-process "python3" nil t nil "-c" "import json; print(json.dumps(42))"))
      (string= (buffer-string) "42\\n")) (setq ok (1+ ok)))))
    (list ok (length (process-list))))`, "(20 0)", {
    prepare(emacs) { mounts = emacs.FS.getMounts(emacs.FS.root.mount).length; },
  });
  assert.equal(result.emacs.kernel().liveCount(), 0);
  assert.equal(result.emacs.FS.getMounts(result.emacs.FS.root.mount).length, mounts);
});
lines.push(`${checks - failures}/${checks} checks passed`);
await mkdir(`${repoRoot}logs`, { recursive: true });
await writeFile(`${repoRoot}logs/python-probe${docs ? "-docs" : ""}${filter ? "-filtered" : ""}.txt`, `${lines.join("\n")}\n`);
process.exitCode = failures ? 1 : 0;
