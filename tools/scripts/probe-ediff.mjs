// Real GNU diff/diff3 and real Emacs Ediff, using the product wasm runtime.
//   node tools/scripts/probe-ediff.mjs
//   WASMACS_PROCESS_PROBE_BUNDLE=docs node tools/scripts/probe-ediff.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
  batchEval, buildArtifactDir, buildUserlandDir, docsArtifactDir, docsUserlandDir, repoRoot,
} from "./lib/pdump-node-harness.mjs";
import { ediffCases, prepareEdiffFixtures } from "../../tests/process/ediff-cases.mjs";

const docs = process.env.WASMACS_PROCESS_PROBE_BUNDLE === "docs";
const boot = { artifactDir: docs ? docsArtifactDir : buildArtifactDir, userland: docs ? docsUserlandDir : buildUserlandDir };
const lines = [`bundle: ${docs ? "docs" : "build"}`];
let failures = 0;
async function check(name, fn) {
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
  const result = await batchEval(form, { ...boot, prepare: prepareEdiffFixtures, ...options });
  assert.equal(result.ok, true, `Emacs ${result.value}; ${result.stderr.slice(-5).join(" | ")}`);
  if (expected instanceof RegExp) assert.match(result.value, expected);
  else assert.equal(result.value, expected);
  return result;
}

await check("GNU diff and diff3 are found directly and through the shell", () => value(
  `(list (shell-command-to-string "diff --version | head -n 1")
         (shell-command-to-string "diff3 --version | head -n 1")
         (with-temp-buffer (call-process "diff" nil t nil "--version") (goto-char (point-min)) (buffer-substring (point) (line-end-position))))`,
  /^\("diff \(GNU diffutils\) [0-9.]+\n" "diff3 \(GNU diffutils\) [0-9.]+\n" "diff \(GNU diffutils\) [0-9.]+"\)$/,
));
await check("diff exit codes: equal 0, different 1, missing 2", () => value(
  `(list (call-process "diff" nil nil nil "/tmp/ediff-A.txt" "/tmp/ediff-A.txt")
         (call-process "diff" nil nil nil "/tmp/ediff-A.txt" "/tmp/ediff-B.txt")
         (call-process "diff" nil nil nil "/tmp/ediff-A.txt" "/tmp/no-such-diff-file"))`, "(0 1 2)",
));
await check("diff normal format and unified format", () => value(
  `(list
    (with-temp-buffer (let ((status (call-process "diff" nil t nil "/tmp/ediff-A.txt" "/tmp/ediff-B.txt"))) (list status (buffer-string))))
    (with-temp-buffer (let ((status (call-process "diff" nil t nil "-u" "--label=A" "--label=B" "/tmp/ediff-A.txt" "/tmp/ediff-B.txt"))) (list status (buffer-string)))))`,
  '((1 "2c2\n< red\n---\n> blue\n4c4\n< one\n---\n> two\n") (1 "--- A\n+++ B\n@@ -1,5 +1,5 @@\n start\n-red\n+blue\n mid\n-one\n+two\n tail\n"))',
));
await check("diff3 merge exit codes and conflict markers", () => value(
  `(list
    (with-temp-buffer (let ((status (call-process "diff3" nil t nil "-m" "/tmp/merge-A.txt" "/tmp/merge-base.txt" "/tmp/merge-B.txt")))
      (list status (and (string-match-p "<<<<<<< /tmp/merge-A.txt" (buffer-string)) t)
                   (and (string-match-p "||||||| /tmp/merge-base.txt" (buffer-string)) t)
                   (and (string-match-p ">>>>>>> /tmp/merge-B.txt" (buffer-string)) t))))
    (call-process "diff3" nil nil nil "-m" "/tmp/merge-clean-A.txt" "/tmp/merge-base.txt" "/tmp/merge-clean-B.txt")
    (call-process "diff3" nil nil nil "/tmp/merge-A.txt" "/tmp/merge-base.txt" "/tmp/no-such-diff3-file"))`,
  "((1 t t t) 0 2)",
));
for (const testCase of ediffCases) await check(testCase.name, () => value(testCase.form, testCase.expected));
await check("100 repeated diff/diff3 processes leave no live process or filesystem mounts", async () => {
  let mounts;
  const result = await value(`(let ((ok 0)) (dotimes (_ 50)
    (when (= 1 (call-process "diff" nil nil nil "/tmp/ediff-A.txt" "/tmp/ediff-B.txt")) (setq ok (1+ ok)))
    (when (= 0 (call-process "diff3" nil nil nil "/tmp/ediff-A.txt" "/tmp/ediff-A.txt" "/tmp/ediff-A.txt")) (setq ok (1+ ok))))
    (list ok (length (process-list))))`, "(100 0)", {
    prepare(emacs) {
      prepareEdiffFixtures(emacs);
      mounts = emacs.FS.getMounts(emacs.FS.root.mount).length;
    },
  });
  assert.equal(result.emacs.kernel().liveCount(), 0);
  assert.equal(result.emacs.FS.getMounts(result.emacs.FS.root.mount).length, mounts);
});
lines.push(`${9 - failures}/9 checks passed`);
await mkdir(`${repoRoot}logs`, { recursive: true });
await writeFile(`${repoRoot}logs/ediff-probe${docs ? "-docs" : ""}.txt`, `${lines.join("\n")}\n`);
process.exitCode = failures ? 1 : 0;
