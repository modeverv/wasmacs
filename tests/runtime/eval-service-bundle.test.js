// The eval service (Emacs as a Lisp engine, doc/eval-service.md) with the
// checked-in Pages bundle under Node: the same core and Lisp the worker
// loads, on the published Emacs build.  The worker and the page are covered
// in Chrome by `npm run test:eval-service`.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { docsArtifactDir, evalService, repoRoot } from "../../tools/scripts/lib/pdump-node-harness.mjs";

const docsApp = `${repoRoot}docs/app`;
const skip = !existsSync(`${docsArtifactDir}/temacs.wasm`) && "docs/artifacts has no Emacs build";

test("Pages bundle: the eval service files are published as in src/wasm", () => {
  for (const name of ["eval-service.html", "src/emacs-eval-client.js", "src/emacs-eval-worker.js",
                      "src/emacs-eval-core.js", "src/wasmacs-eval-service.el"]) {
    assert.equal(existsSync(`${docsApp}/${name}`), true, `docs/app/${name} is not published; run npm run build`);
    assert.equal(readFileSync(`${docsApp}/${name}`, "utf8"), readFileSync(`${repoRoot}src/wasm/${name}`, "utf8"),
      `docs/app/${name} is stale; run npm run build`);
  }
});

test("Pages bundle: the eval service's build id matches the published files", { skip }, async () => {
  const { evalBuildId } = await import("../../src/build/eval-build-id.mjs");
  const published = JSON.parse(readFileSync(`${docsApp}/eval-build-id.json`, "utf8")).id;
  assert.equal(published, await evalBuildId(`${repoRoot}docs`),
    "docs/app/eval-build-id.json is stale: browsers would keep an old Emacs in their cache; run npm run build");
});

test("Pages bundle: Emacs evaluates Lisp for a host and returns JSON", { skip }, async () => {
  const { service, info, emacs } = await evalService({ artifactDir: docsArtifactDir, appDir: `${docsApp}/src` });
  assert.equal(info.version, "30.2");

  assert.deepEqual(service.eval("(+ 1 2)"), { ok: true, value: 3, output: "" });
  assert.deepEqual(service.eval('(list :name "x" :tags ["a" "b"] :yes t :no :false :none nil :ja "日本語")').value,
    { name: "x", tags: ["a", "b"], yes: true, no: false, none: null, ja: "日本語" });
  assert.equal(service.eval("(list 1 \"a\" 'b)", { format: "lisp" }).value, '(1 "a" b)');

  // Several forms, comments, lexical binding; definitions persist.
  assert.equal(service.eval(";; a counter\n(let ((n 0)) (defun eval-test-next () (setq n (1+ n))))\n(eval-test-next) (eval-test-next) ; twice").value, 2);
  assert.equal(service.call("eval-test-next").value, 3);
  service.eval("(defun eval-test-describe (item) (format \"%s:%d:%S\" (plist-get item :name) (length (plist-get item :tags)) (plist-get item :done)))");
  assert.equal(service.call("eval-test-describe", [{ name: "task", tags: ["a", "b"], done: false }]).value, "task:2:nil");

  // Errors are data, with the Lisp error symbol; the service goes on.
  assert.deepEqual(service.eval("(car 1)").error,
    { symbol: "wrong-type-argument", message: "Wrong type argument: listp, 1", data: "(wrong-type-argument listp 1)" });
  assert.equal(service.eval("(+ 1").error.symbol, "end-of-file");
  assert.equal(service.eval("(+ 1 2))").error.symbol, "invalid-read-syntax");
  assert.equal(service.eval("(list 1 2 3)").error.symbol, "wasmacs-eval-service-not-json");
  assert.equal(service.eval("(throw 'nowhere 1)").error.symbol, "no-catch");
  assert.equal(service.call("eval-test-undefined", []).error.symbol, "void-function");

  assert.deepEqual(service.eval('(message "note %d" 1) 7'), { ok: true, value: 7, output: "note 1\n" });
  assert.equal(service.eval("(progn (require 'cl-lib) (cl-reduce #'+ (number-sequence 1 10)))").value, 55);

  // Runaway recursion is a Lisp error (see MAX_LISP_EVAL_DEPTH in the core).
  service.eval("(defun eval-test-deep (n) (if (= n 0) 0 (1+ (eval-test-deep (1- n)))))");
  assert.equal(service.eval("(eval-test-deep 100000)").error.symbol, "excessive-lisp-nesting");
  assert.equal(service.eval("(eval-test-deep 100)").value, 100);

  // Garbage is collected between requests: these requests cons 4.8 GB of
  // list cells in all, more than a wasm32 heap can hold.
  for (let i = 0; i < 3000; i++) {
    assert.equal(service.eval("(length (make-list 100000 0))").value, 100000);
  }
  const heapBytes = vm.runInContext("HEAPU8.length", emacs.context);
  assert.equal(heapBytes < 2 ** 31, true, `the heap grew to ${heapBytes} bytes`);
});
