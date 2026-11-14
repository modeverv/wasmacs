// The Emacs eval service in real Chrome, from the published bundle.
//
//   node tools/scripts/probe-eval-service.mjs
//
// docs/ is served by a plain static server WITHOUT cross-origin isolation
// headers and without the service worker that adds them: the eval service
// must not need SharedArrayBuffer.  The page (docs/app/eval-service.html)
// exposes the client as window.wasmacsEval.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, chromePath, devToolsUrl, evaluate, pause, waitUntil } from "./lib/cdp.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const docsRoot = join(repoRoot, "docs");
const logPath = join(repoRoot, "logs/eval-service-probe.txt");
const evidence = [];
function pass(message) {
  evidence.push(`PASS ${message}`);
  console.log(`PASS ${message}`);
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".wasm": "application/wasm", ".el": "text/plain; charset=utf-8",
};
// A page of "another project" on its own origin, using the published files.
const foreignPage = (origin) => `<!doctype html><meta charset="utf-8"><title>another origin</title>
<script type="module">
import { createEmacsEvalService } from "${origin}/app/src/emacs-eval-client.js";
window.wasmacsEval = createEmacsEvalService();
</script>`;
// Requests for the big files of Emacs (the pdmp, the parts of temacs.data).
let bigDownloads = 0;
const handler = (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, "http://localhost").pathname));
  if (/bootstrap-emacs\.pdmp$|temacs\.data\.parts\/part-|temacs\.wasm$/.test(path)) bigDownloads += 1;
  if (path === "/foreign.html") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(foreignPage(new URL(pageUrl).origin));
    return;
  }
  const file = join(docsRoot, path);
  if (!file.startsWith(docsRoot) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end("not found");
    return;
  }
  // GitHub Pages answers every request with this header too.
  response.writeHead(200, { "Content-Type": mimeTypes[extname(file)] || "application/octet-stream",
                            "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
  createReadStream(file).pipe(response);
};
const server = createServer(handler);
const foreignServer = createServer(handler);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
await new Promise((resolve) => foreignServer.listen(0, "127.0.0.1", resolve));
const pageUrl = `http://127.0.0.1:${server.address().port}/app/eval-service.html`;
// "localhost" and "127.0.0.1" are different origins.
const foreignUrl = `http://localhost:${foreignServer.address().port}/foreign.html`;

const workDir = await mkdtemp(join(tmpdir(), "wasmacs-eval-"));
let chrome = null, client = null;
try {
  chrome = spawn(chromePath, [
    // The default JavaScript stack, as in a user's browser.
    "--headless=new", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${join(workDir, "profile")}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  client = new CdpClient(await devToolsUrl(chrome));
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  const js = (expression) => evaluate(client, sessionId, expression);
  // Evaluate SOURCE in Emacs; a Lisp error comes back as { error: symbol }.
  const lisp = (source, options = {}) => js(`window.wasmacsEval.eval(${JSON.stringify(source)}, ${JSON.stringify(options)})
    .catch((error) => ({ error: error.symbol, message: error.message, output: error.output }))`);

  const t0 = Date.now();
  await client.send("Page.navigate", { url: pageUrl }, sessionId);
  await waitUntil(() => js("Boolean(window.wasmacsEval)").catch(() => false), "the page loads the client");
  const info = await js("window.wasmacsEval.ready");
  assert.equal(info.version, "30.2");
  assert.equal(info.cached, false);
  assert.equal(bigDownloads > 3, true);
  pass(`Emacs ${info.version} is ready: ${info.bootMs} ms in the worker, ${Date.now() - t0} ms from navigation (${bigDownloads} big files downloaded)`);
  assert.equal(await js("window.crossOriginIsolated"), false);
  assert.equal(await js("typeof SharedArrayBuffer"), "undefined");
  pass("the page is not cross-origin isolated and has no SharedArrayBuffer");

  assert.equal(await lisp("(+ 1 2)"), 3);
  assert.deepEqual(await lisp('(list :name "wasmacs" :tags ["a" "b"] :n 1.5 :yes t :no :false :none nil :ja "日本語")'),
    { name: "wasmacs", tags: ["a", "b"], n: 1.5, yes: true, no: false, none: null, ja: "日本語" });
  pass("numbers, strings, vectors and plists come back as JSON");
  assert.equal(await lisp("(defun wasmacs-probe-square (n) (* n n))", { format: "lisp" }), "wasmacs-probe-square");
  assert.equal(await js("window.wasmacsEval.call('wasmacs-probe-square', 12)"), 144);
  assert.equal(await lisp("(defun wasmacs-probe-greet (who) (format \"hello %s, %d tags\" (plist-get who :name) (length (plist-get who :tags))))", { format: "lisp" }), "wasmacs-probe-greet");
  assert.equal(await js("window.wasmacsEval.call('wasmacs-probe-greet', { name: 'page', tags: ['x', 'y', 'z'] })"), "hello page, 3 tags");
  pass("definitions persist between requests; call() passes JSON arguments to a Lisp function");

  assert.deepEqual(await lisp("(car 1)"), { error: "wrong-type-argument", message: "Wrong type argument: listp, 1", output: "" });
  assert.equal((await lisp("(+ 1")).error, "end-of-file");
  assert.equal((await lisp("(list 1 2)")).error, "wasmacs-eval-service-not-json");
  assert.equal(await lisp("(+ 40 2)"), 42);
  pass("Lisp errors reject with the error symbol, and the service keeps working");

  const detailed = await lisp('(message "from %s" "emacs") (with-temp-buffer (insert "buffers work") (upcase (buffer-string)))', { detailed: true });
  assert.equal(detailed.value, "BUFFERS WORK");
  assert.equal(detailed.output, "from emacs\n");
  assert.equal(await lisp('(progn (write-region "saved" nil "/tmp/eval-note.txt" nil (quote silent)) (with-temp-buffer (insert-file-contents "/tmp/eval-note.txt") (buffer-string)))'), "saved");
  assert.equal(await lisp("(progn (require 'cl-lib) (require 'seq) (require 'subr-x) (cl-reduce #'+ (seq-filter #'cl-evenp (number-sequence 1 10))))"), 30);
  pass("message output is returned, buffers, files and the bundled Lisp libraries work");

  // What Lisp has for hashes, random bytes and sockets (doc/eval-service.md).
  assert.equal(await lisp("(secure-hash 'sha256 \"abc\")"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.deepEqual(await lisp("(vconcat (mapcar #'symbol-name (secure-hash-algorithms)))"), ["md5", "sha1", "sha224", "sha256", "sha384", "sha512"]);
  assert.deepEqual(await lisp("(vector (fboundp 'gnutls-hash-mac) (fboundp 'gnutls-symmetric-encrypt) (fboundp 'module-load))"), [null, null, null]);
  assert.deepEqual(await lisp("(vector (fboundp 'json-serialize) (fboundp 'base64url-encode-string) (sqlite-available-p))"), [true, true, true]);
  const randomBytes = '(with-temp-buffer (set-buffer-multibyte nil) (insert-file-contents-literally "/dev/urandom" nil nil 16) (mapconcat (lambda (byte) (format "%02x" byte)) (buffer-string) ""))';
  const drawn = [await lisp(randomBytes), await lisp(randomBytes)];
  assert.match(drawn[0], /^[0-9a-f]{32}$/);
  assert.notEqual(drawn[0], drawn[1]);
  assert.equal((await lisp('(with-temp-buffer (insert-file-contents-literally "/dev/urandom" nil 0 16) (buffer-size))')).error, "file-error");
  assert.equal(await lisp(`(condition-case nil
      (progn (make-network-process :name "probe" :server t :host "127.0.0.1" :service 8099 :family 'ipv4) "listening")
    (file-error "no listening socket"))`), "no listening socket");
  pass("SHA-2 is there, random bytes are the browser's; no GnuTLS, no modules, no listening socket");

  // Deep recursion ends as a Lisp error, not as a JavaScript stack overflow.
  assert.equal(await lisp("(defun wasmacs-probe-deep (n) (if (= n 0) 0 (1+ (wasmacs-probe-deep (1- n)))))", { format: "lisp" }), "wasmacs-probe-deep");
  assert.equal(await lisp("(wasmacs-probe-deep 200)"), 200);
  assert.equal((await lisp("(wasmacs-probe-deep 100000)")).error, "excessive-lisp-nesting");
  assert.equal(await lisp("(wasmacs-probe-deep 200)"), 200);
  pass("runaway recursion is a Lisp error and the engine stays usable");

  // Round trip time of small requests, and memory over many consing ones.
  const timing = await js(`(async () => {
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) await window.wasmacsEval.eval("(+ 1 2)");
    const small = (performance.now() - t0) / 500;
    const t1 = performance.now();
    for (let i = 0; i < 300; i++) await window.wasmacsEval.eval("(length (make-list 100000 0))");
    const consing = (performance.now() - t1) / 300;
    const fib = await window.wasmacsEval.eval("(defun wasmacs-probe-fib (n) (if (< n 2) n (+ (wasmacs-probe-fib (- n 1)) (wasmacs-probe-fib (- n 2))))) (wasmacs-probe-fib 25)", { detailed: true });
    return { small, consing, fib: fib.value, fibMs: fib.ms };
  })()`);
  assert.equal(timing.fib, 75025);
  assert.equal(await lisp("(+ 1 1)"), 2);
  pass(`round trip ${timing.small.toFixed(3)} ms per small request; ${timing.consing.toFixed(2)} ms per request that conses 100000 cells (300 in a row); (fib 25) interpreted in ${timing.fibMs.toFixed(0)} ms`);

  // The demo page itself.
  await js("document.querySelector('#source').value = '(list :answer (* 6 7))'; document.querySelector('#run').click(); true");
  await waitUntil(() => js("/\"answer\": 42/.test(document.querySelector('#result').textContent)"), "the page shows the result");
  pass("the demo page evaluates the form in its text area");
  // A second visit takes Emacs from Cache Storage: no big file is requested.
  await pause(1500);               // the first visit is still writing the cache
  bigDownloads = 0;
  const t1 = Date.now();
  await client.send("Page.navigate", { url: pageUrl }, sessionId);
  await waitUntil(() => js("Boolean(window.wasmacsEval)").catch(() => false), "the page loads again");
  const again = await js("window.wasmacsEval.ready");
  assert.equal(again.cached, true);
  assert.equal(bigDownloads, 0);
  assert.equal(await lisp("(+ 1 2)"), 3);
  pass(`a second visit starts from the browser's cache: ${again.bootMs} ms in the worker, ${Date.now() - t1} ms from navigation, nothing big downloaded`);

  // kill-emacs takes the engine down: that request and every later one reject.
  const killed = await lisp("(kill-emacs 0)");
  assert.equal(killed.error, "host-error");
  const afterKill = await js("window.wasmacsEval.eval('(+ 1 1)').then(() => 'answered', (error) => error.message)");
  assert.match(afterKill, /the engine failed/);
  pass("a failed engine rejects later requests instead of answering from a broken state");

  // Another project: a page on a different origin loads the client module,
  // the worker and Emacs from here.
  await client.send("Page.navigate", { url: foreignUrl }, sessionId);
  await waitUntil(() => js("Boolean(window.wasmacsEval)").catch(() => false), "the foreign page loads the client");
  assert.equal((await js("window.wasmacsEval.ready")).version, "30.2");
  assert.deepEqual(await lisp("(list :origin \"elsewhere\" :sum (+ 20 22))"), { origin: "elsewhere", sum: 42 });
  pass(`a page on another origin (${new URL(foreignUrl).origin}) uses the service published at ${new URL(pageUrl).origin}`);
  console.log(`eval service probe passed — see ${logPath}`);
} finally {
  await mkdir(join(repoRoot, "logs"), { recursive: true });
  await writeFile(logPath, `${evidence.join("\n")}\n`);
  client?.close();
  if (chrome) {
    chrome.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), pause(2000)]);
  }
  server.close();
  foreignServer.close();
  await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
