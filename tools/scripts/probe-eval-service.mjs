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
// A site that publishes docs/.  ranges: does it answer range requests (GitHub
// Pages does, Python's http.server does not)?  core: it carries the core
// package only, as elisp-studio's fetch-emacs.sh copies it.  index: false
// for a copy of the site from before it had temacs.files.json.  `seen` counts
// what was asked of it: big (the pdmp, temacs.wasm and whole parts of a
// package), whole (whole parts of a package), ranges, preflights.
const packageDir = "/artifacts/emacs-browser-atomics-pdump";
// buildId: how the site answers for app/eval-build-id.json: "ok", "error"
// (503), "unreachable" (the connection is dropped) or "missing" (404, as a
// development server).
// copy: the site also serves docs/ under /copy/, as another build (its own
// build id), the way an application keeps a copy in its vendor/.
function site({ ranges = true, core = false, index = true, copy = false } = {}) {
  const seen = { big: 0, whole: 0, ranges: 0, rangeBytes: 0, preflights: 0 };
  const self = { seen, buildId: "ok" };
  const server = createServer((request, response) => {
    let path = normalize(decodeURIComponent(new URL(request.url, "http://localhost").pathname));
    if (copy && path === "/copy/app/eval-build-id.json") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end('{"id":"0123456789abcdef0123456789abcdef"}');
      return;
    }
    if (copy && path.startsWith("/copy/")) path = path.slice("/copy".length);
    if (request.method === "OPTIONS") {   // GitHub Pages refuses a preflight
      seen.preflights += 1;
      response.writeHead(405).end();
      return;
    }
    if (path === "/app/eval-build-id.json" && self.buildId !== "ok") {
      if (self.buildId === "unreachable") request.socket.destroy();
      else response.writeHead(self.buildId === "error" ? 503 : 404).end();
      return;
    }
    if (path === "/foreign.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(foreignPage(new URL(pageUrl).origin));
      return;
    }
    if (core && path.startsWith(`${packageDir}/temacs.data.parts/`)) path = "/missing";
    if (!index && /temacs\.(core\.)?files\.json$|temacs\.core\.data$/.test(path)) path = "/missing";
    if (core && path === `${packageDir}/temacs.files.json`) path = `${packageDir}/temacs.core.files.json`;
    const file = join(docsRoot, path);
    if (!file.startsWith(docsRoot) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end("not found");
      return;
    }
    // GitHub Pages answers every request with this header too.
    const headers = { "Content-Type": mimeTypes[extname(file)] || "application/octet-stream",
                      "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };
    const isPart = /temacs\.data\.parts\/part-|temacs\.core\.data$/.test(path);
    const range = ranges && /^bytes=(\d+)-(\d+)$/.exec(request.headers.range || "");
    if (range) {
      const size = statSync(file).size;
      const start = Number(range[1]), end = Math.min(Number(range[2]), size - 1);
      seen.ranges += 1;
      seen.rangeBytes += end - start + 1;
      response.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      createReadStream(file, { start, end }).pipe(response);
      return;
    }
    if (isPart) seen.whole += 1;
    if (isPart || /bootstrap-emacs\.pdmp$|temacs\.wasm$/.test(path)) seen.big += 1;
    response.writeHead(200, headers);
    createReadStream(file).pipe(response);
  });
  return Object.assign(self, { server, listen: (host = "127.0.0.1") => new Promise((resolve) => server.listen(0, host, resolve)) });
}
const main = site();
const foreign = site();
const plain = site({ ranges: false });
const coreSite = site({ core: true });
const corePlain = site({ core: true, ranges: false });
const older = site({ index: false });
const twoBuilds = site({ copy: true });
const sites = [main, foreign, plain, coreSite, corePlain, older, twoBuilds];
await Promise.all(sites.map((each) => each.listen()));
const page = (each) => `http://127.0.0.1:${each.server.address().port}/app/eval-service.html`;
const pageUrl = page(main);
// "localhost" and "127.0.0.1" are different origins.
const foreignUrl = `http://localhost:${foreign.server.address().port}/foreign.html`;

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

  // Open URL and wait for the service: what "ready" says.
  const open = async (url) => {
    await client.send("Page.navigate", { url }, sessionId);
    await waitUntil(() => js("Boolean(window.wasmacsEval)").catch(() => false), `${url} loads the client`);
    return js("window.wasmacsEval.ready");
  };

  const t0 = Date.now();
  const info = await open(pageUrl);
  assert.equal(info.version, "30.2");
  assert.equal(info.cached, false);
  // Emacs itself is downloaded; of its 146 MB of Lisp, what the start reads.
  assert.equal(info.files, "on demand");
  assert.deepEqual([main.seen.big, main.seen.whole], [2, 0]);
  assert.equal(main.seen.ranges < 10 && main.seen.rangeBytes < 1e6, true, `${main.seen.ranges} ranges, ${main.seen.rangeBytes} bytes`);
  pass(`Emacs ${info.version} is ready: ${info.bootMs} ms in the worker, ${Date.now() - t0} ms from navigation; of Emacs's own files, ${main.seen.rangeBytes} bytes in ${main.seen.ranges} range requests`);
  const progress = await js("window.wasmacsProgress");
  assert.equal(progress[0].phase, "build id");
  assert.equal(progress.at(-1).phase, "emacs");
  assert.equal(progress.some((step) => step.phase === "download" && /temacs\.wasm$/.test(step.url) && step.bytes > 1e6), true);
  pass(`the start reports its progress: ${progress.map((step) => step.phase === "download" ? step.url.split("/").pop() : step.phase).join(", ")}`);
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

  // A library that is not in the pdmp is fetched when it is required.
  const rangesBefore = main.seen.ranges;
  assert.equal(await lisp("(progn (require 'calc) (calc-eval \"2^100\"))"), "1267650600228229401496703205376");
  assert.equal(main.seen.ranges > rangesBefore && main.seen.whole === 0, true);
  pass(`(require 'calc) fetched ${main.seen.ranges - rangesBefore} more files`);

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
  // A second visit takes Emacs from Cache Storage: nothing of Emacs is
  // requested, not the files that were read on demand either.
  await pause(1500);               // the first visit is still writing the cache
  Object.assign(main.seen, { big: 0, ranges: 0 });
  const t1 = Date.now();
  const again = await open(pageUrl);
  assert.equal(again.cached, true);
  assert.equal(again.files, "on demand");
  assert.equal(await lisp("(+ 1 2)"), 3);
  assert.equal(await lisp("(progn (require 'calc) (calc-eval \"2^10\"))"), "1024");
  assert.deepEqual([main.seen.big, main.seen.whole, main.seen.ranges], [0, 0, 0]);
  pass(`a second visit starts from the browser's cache: ${again.bootMs} ms in the worker, ${Date.now() - t1} ms from navigation, nothing of Emacs requested, calc included`);
  assert.equal(again.offline, false);
  assert.deepEqual((await js("window.wasmacsProgress")).map((step) => step.phase), ["build id", "emacs"]);

  // The build id cannot be had (a server error, no network): Emacs starts
  // from the cache of the last build all the same, and asks again next time.
  for (const failure of ["error", "unreachable"]) {
    main.buildId = failure;
    Object.assign(main.seen, { big: 0, ranges: 0 });
    const offline = await open(pageUrl);
    assert.deepEqual([offline.cached, offline.offline], [true, true]);
    assert.equal(await lisp("(progn (require 'calc) (calc-eval \"2^10\"))"), "1024");
    assert.deepEqual([main.seen.big, main.seen.whole, main.seen.ranges], [0, 0, 0]);
  }
  pass("without the build id (HTTP 503, or the connection dropped) Emacs starts from the cache, nothing of Emacs requested");
  // A server without a build id (a development server) gets nothing from
  // an older cache: it may serve another build.
  main.buildId = "missing";
  Object.assign(main.seen, { big: 0, ranges: 0 });
  const missing = await open(pageUrl);
  assert.deepEqual([missing.cached, missing.offline, main.seen.big], [false, false, 2]);
  main.buildId = "ok";
  Object.assign(main.seen, { big: 0, ranges: 0 });
  const back = await open(pageUrl);
  assert.deepEqual([back.cached, back.offline, main.seen.big], [true, false, 0]);
  pass("a server that has no build id (404) is not answered from the cache; with the id back, the cache is used again");

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
  // Its range requests need no preflight (which GitHub Pages would refuse).
  assert.equal(await js("window.wasmacsEval.ready.then((info) => info.files)"), "on demand");
  assert.deepEqual([main.seen.preflights, main.seen.whole], [0, 0]);
  pass("from another origin, too, the files are read on demand");

  // A server that does not answer range requests: the whole package is
  // downloaded before the start, as before.
  const whole = await open(page(plain));
  assert.equal(whole.files, "all");
  assert.deepEqual([plain.seen.whole, plain.seen.ranges], [5, 0]);
  assert.equal(await lisp("(progn (require 'calc) (calc-eval \"2^10\"))"), "1024");
  pass(`without range requests the package is downloaded whole (${whole.bootMs} ms in the worker)`);

  // A site with the core package only: Emacs Lisp and its library, not the
  // editor's.
  const coreInfo = await open(page(coreSite));
  assert.equal(coreInfo.files, "on demand");
  assert.equal(await lisp("(progn (require 'iso8601) (require 'cl-extra) (require 'generator) (nth 5 (iso8601-parse \"2026-11-15T10:00:00Z\")))"), 2026);
  assert.equal(await lisp("(decode-coding-string (encode-coding-string \"日本語\" 'japanese-shift-jis) 'japanese-shift-jis)"), "日本語");
  assert.equal((await lisp("(require 'calc)")).error, "file-missing");
  assert.deepEqual([coreSite.seen.whole, coreSite.seen.ranges > 0], [0, true]);
  pass(`a site with the core package: ${coreSite.seen.rangeBytes} bytes in ${coreSite.seen.ranges} range requests; calc is not there`);
  const coreWhole = await open(page(corePlain));
  assert.equal(coreWhole.files, "all");
  assert.deepEqual([corePlain.seen.whole, corePlain.seen.ranges], [1, 0]);
  assert.equal(await lisp("(progn (require 'iso8601) (nth 5 (iso8601-parse \"2026-11-15T10:00:00Z\")))"), 2026);
  assert.equal((await lisp("(require 'calc)")).error, "file-missing");
  pass("a site with the core package and no range requests downloads that package whole");

  // A copy of the site from before there was an index (an older
  // fetch-emacs.sh): the package the glue asks for, whole.
  const old = await open(page(older));
  assert.equal(old.files, "all");
  assert.deepEqual([older.seen.whole, older.seen.ranges], [5, 0]);
  assert.equal(await lisp("(progn (require 'calc) (calc-eval \"2^10\"))"), "1024");
  pass("a copy of the site without an index still works: the whole package");

  // Two builds on one origin (the site and a copy with another build id
  // under /copy/) keep a cache each: going back and forth downloads nothing.
  const first = page(twoBuilds), second = first.replace("/app/", "/copy/app/");
  for (const url of [first, second]) {
    twoBuilds.seen.big = 0;
    assert.equal((await open(url)).cached, false);
    assert.equal(twoBuilds.seen.big, 2);
    await pause(1500);             // the cache is still being written
  }
  for (const url of [first, second, first]) {
    twoBuilds.seen.big = 0;
    assert.equal((await open(url)).cached, true);
    assert.equal(twoBuilds.seen.big, 0);
  }
  assert.deepEqual(await js("caches.keys().then((names) => names.filter((name) => name.startsWith('wasmacs-eval-')).length)"), 2);
  pass("two builds on one origin keep a cache each and do not evict each other");
  console.log(`eval service probe passed — see ${logPath}`);
} finally {
  await mkdir(join(repoRoot, "logs"), { recursive: true });
  await writeFile(logPath, `${evidence.join("\n")}\n`);
  client?.close();
  if (chrome) {
    chrome.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), pause(2000)]);
  }
  for (const each of sites) each.server.close();
  await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
