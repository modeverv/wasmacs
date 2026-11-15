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

// ---- Emacs's own files, read on demand ------------------------------------------
// The worker does not download temacs.data: an index says where each file
// is, and a file is fetched when Emacs reads it (WasmacsEvalFiles in
// emacs-eval-core.js).  Here the "server" is the published package on disk.

const readIndex = (name) => JSON.parse(readFileSync(`${docsArtifactDir}/${name}`, "utf8"));
const readContainer = (index) => Buffer.concat(index.container.parts.map((name) => readFileSync(`${docsArtifactDir}/${name}`)));
const skipFiles = skip || (!existsSync(`${docsArtifactDir}/temacs.files.json`) && "docs/artifacts has no package index");

test("Pages bundle: the index names every file of the package and where it is", { skip: skipFiles }, async () => {
  const { coreFile, packageFiles } = await import("../../src/build/emacs-packages.mjs");
  const { crc32 } = await import("node:zlib");
  const listed = packageFiles(readFileSync(`${docsArtifactDir}/temacs.js`, "utf8"));
  const manifest = readIndex("temacs.data.parts/manifest.json");

  const index = readIndex("temacs.files.json");
  assert.equal(index.root, listed.root);
  assert.deepEqual(index.container, { size: manifest.size, chunkSize: manifest.chunkSize,
                                      parts: manifest.parts.map((part) => `temacs.data.parts/${part.name}`) });
  assert.deepEqual(index.files.map(([name, start, end]) => ({ name, start, end })), listed.files,
    "docs/artifacts: temacs.files.json is not the list of temacs.js; run npm run build");
  const data = readContainer(index);
  assert.equal(data.length, index.container.size);
  const crcs = new Map();
  for (const [name, start, end, crc] of index.files) {
    assert.equal(crc32(data.subarray(start, end)), crc, `checksum of ${name}`);
    crcs.set(name, crc);
  }

  // The core package: the files of the rule, with the same bytes.
  const core = readIndex("temacs.core.files.json");
  const coreData = readContainer(core);
  assert.equal(coreData.length, core.container.size);
  assert.deepEqual(core.container.parts, ["temacs.core.data"]);
  const names = new Set(crcs.keys());
  assert.deepEqual(core.files.map(([name]) => name), [...names].filter((name) => coreFile(name, names)));
  for (const [name, start, end, crc] of core.files) {
    assert.equal(crc, crcs.get(name), `${name} in the core package`);
    assert.equal(crc32(coreData.subarray(start, end)), crc, `checksum of ${name} in the core package`);
  }
  // What it is for: a language with its library, a fraction of the whole.
  for (const name of ["lisp/subdirs.el", "lisp/emacs-lisp/generator.elc", "lisp/emacs-lisp/cl-extra.elc", "lisp/help-mode.elc",
                      "lisp/calendar/iso8601.elc", "lisp/url/url-util.elc", "lisp/international/uni-name.el", "etc/charsets/JISX0208.map"]) {
    assert.equal(core.files.some((file) => file[0] === name), true, `${name} is in the core package`);
  }
  for (const name of ["lisp/subr.el", "lisp/ldefs-boot.el", "lisp/org/org.elc", "lisp/calc/calc.elc", "lisp/progmodes/python.elc", "etc/NEWS"]) {
    assert.equal(core.files.some((file) => file[0] === name), false, `${name} is not in the core package`);
  }
  assert.equal(core.container.size < 25e6, true, `the core package has ${core.container.size} bytes`);
});

test("Pages bundle: Emacs reads its own files when it needs them", { skip: skipFiles }, async () => {
  const index = readIndex("temacs.files.json");
  const data = readContainer(index);
  const read = [];          // names, in the order Emacs read them
  const errors = [];
  let fail = null;          // (start, end) => bytes | throws, in place of the read
  const { service, info, emacs } = await evalService({
    artifactDir: docsArtifactDir, appDir: `${docsApp}/src`,
    files: {
      index,
      read(start, end) {
        return fail ? fail(start, end) : data.subarray(start, end);
      },
      onRead(name) { read.push(name); },
      onError(name, error) { errors.push(`${name}: ${error.message}`); },
    },
  });
  assert.equal(info.version, "30.2");
  const lispRoot = `${index.root}lisp`;

  // The same checksum as the build's.
  const { crc32 } = await import("node:zlib");
  const sample = data.subarray(index.files[100][1], index.files[100][2]);
  emacs.context.__sample = sample;
  assert.equal(vm.runInContext("WasmacsEvalFiles.crc32(__sample)", emacs.context), crc32(sample));

  // Starting reads next to nothing; what Lisp needs most is in the pdmp.
  assert.equal(service.eval("(progn (require 'cl-lib) (require 'seq) (require 'json) (require 'bytecomp) (cl-reduce #'+ '(1 2 3)))").value, 6);
  const size = (names) => names.reduce((sum, name) => sum + (([, start, end]) => end - start)(index.files.find((file) => file[0] === name)), 0);
  assert.equal(read.length < 10 && size(read) < 1e6, true, `the start read ${read.length} files, ${size(read)} bytes: ${read.join(" ")}`);

  // Every file is there with its size, without being read.
  const before = read.length;
  assert.equal(service.eval(`(file-attribute-size (file-attributes "${lispRoot}/calc/calc.elc"))`).value,
    (([, start, end]) => end - start)(index.files.find((file) => file[0] === "lisp/calc/calc.elc")));
  assert.equal(service.eval(`(length (directory-files "${lispRoot}/org" nil "\\\\.elc\\\\'"))`).value > 100, true);
  assert.equal(read.length, before);

  // A library that is not in the pdmp is read when it is required.
  assert.equal(service.eval("(progn (require 'calc) (calc-eval \"2^100\"))").value, "1267650600228229401496703205376");
  assert.equal(read.includes("lisp/calc/calc.elc"), true);
  assert.equal(read.includes("lisp/org/org.elc"), false);
  // Source, too, and a file across two parts of the package.
  assert.match(service.eval(`(with-temp-buffer (insert-file-contents "${lispRoot}/subr.el" nil 0 60) (buffer-string))`).value, /^;;; subr\.el --- /);
  const across = index.files.find(([, start, end]) => Math.floor(start / index.container.chunkSize) !== Math.floor((end - 1) / index.container.chunkSize));
  emacs.context.__container = index.container;
  emacs.context.__part = (part, from, to) => data.subarray(part * index.container.chunkSize + from, part * index.container.chunkSize + to);
  const joined = vm.runInContext(`WasmacsEvalFiles.containerReader(__container, __part)(${across[1]}, ${across[2]})`, emacs.context);
  assert.equal(crc32(joined), across[3], `${across[0]} lies across two parts`);

  // A read that fails is an error of that file only, and is tried again.
  assert.deepEqual(errors, []);
  fail = () => { throw new Error("no network"); };
  const failed = service.eval("(progn (require 'avl-tree) t)");
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(errors.length > 0 && errors.every((error) => error === "lisp/emacs-lisp/avl-tree.elc: no network"), true, errors.join("\n"));
  assert.equal(service.eval("(+ 1 2)").value, 3);
  // So is one that brings other bytes than the index says (a site that
  // changed under a running page).
  errors.length = 0;
  fail = (start, end) => new Uint8Array(end - start);
  assert.equal(service.eval("(progn (require 'avl-tree) t)").ok, false);
  assert.match(errors[0], /^lisp\/emacs-lisp\/avl-tree\.elc: the bytes are not those of the index/);
  errors.length = 0;
  fail = null;
  assert.equal(service.eval("(progn (require 'avl-tree) (avl-tree-empty (avl-tree-create #'<)))").value, true);
  assert.deepEqual(errors, []);
});

test("Pages bundle: the core package is Emacs Lisp without the editor", { skip: skipFiles }, async () => {
  const index = readIndex("temacs.core.files.json");
  const data = readContainer(index);
  const { service, info } = await evalService({
    artifactDir: docsArtifactDir, appDir: `${docsApp}/src`,
    files: { index, read: (start, end) => data.subarray(start, end) },
  });
  assert.equal(info.version, "30.2");
  const lispRoot = `${index.root}lisp`;

  // The language and its library.
  assert.equal(service.eval("(progn (require 'cl-lib) (require 'generator) (require 'cl-extra) (require 'rx) (require 'map) (cl-reduce #'+ '(1 2 3)))").value, 6);
  assert.equal(service.eval("(progn (require 'iso8601) (format \"%S\" (iso8601-parse \"2026-11-15T10:00:00Z\")))").value, "(0 0 10 15 11 2026 nil nil 0)");
  assert.equal(service.eval("(progn (require 'url-util) (url-hexify-string \"a b\"))").value, "a%20b");
  assert.equal(service.eval("(json-serialize (json-parse-string \"{\\\"a\\\":[1,2]}\"))").value, '{"a":[1,2]}');
  assert.equal(service.eval("(let ((db (sqlite-open))) (sqlite-execute db \"create table t(a)\") (sqlite-execute db \"insert into t values(?)\" '(7)) (caar (sqlite-select db \"select a from t\")))").value, 7);
  // Text in other encodings than UTF-8 needs the charset maps.
  assert.equal(service.eval("(decode-coding-string (encode-coding-string \"日本語\" 'japanese-shift-jis) 'japanese-shift-jis)").value, "日本語");
  assert.equal(service.eval('(progn (with-temp-file "/tmp/ja.txt" (insert "日本語")) (with-temp-buffer (insert-file-contents "/tmp/ja.txt") (buffer-string)))').value, "日本語");
  assert.equal(service.eval("(get-char-code-property ?a 'name)").value, "LATIN SMALL LETTER A");
  // The compiler, as elisp-react uses it.
  assert.equal(service.eval(`(progn
    (with-temp-file "/tmp/core-test.el" (insert ";;; -*- lexical-binding: t; -*-\\n(defun core-test-twice (n) (* 2 n))\\n"))
    (byte-compile-file "/tmp/core-test.el") (load "/tmp/core-test.elc" nil t) (core-test-twice 21))`).value, 42);

  // The editor's libraries are not there: not as empty files either.
  const missing = service.eval("(require 'calc)");
  assert.equal(missing.error.symbol, "file-missing");
  assert.equal(service.eval("(or (locate-library \"org\") (locate-library \"python\") :false)").value, false);
  assert.equal(service.eval(`(or (file-exists-p "${lispRoot}/subr.el") (file-exists-p "${lispRoot}/calc/calc.elc") :false)`).value, false);
  assert.equal(service.eval("(+ 1 2)").value, 3);
});
