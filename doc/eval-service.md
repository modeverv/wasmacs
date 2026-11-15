# Eval Service: Emacs as a Lisp Engine

## Purpose

The product runs Emacs as an editor: a page with a terminal, a worker that
enters Emacs's command loop and never returns. The eval service uses the same
Emacs build as a library instead. A page sends Lisp, Emacs evaluates it, the
value comes back as JSON. There is no terminal and no command loop; Emacs runs
only while a request is being evaluated.

It exists so that other projects can use Emacs Lisp as an engine in the
browser (the first candidate: a React-like UI library written in Emacs Lisp,
with JavaScript only applying the result to the DOM). Such projects live in
their own repositories and load the published files; this document is the
contract.

The first user is [elisp-react](https://github.com/modeverv/elisp-react): its
components, state and reconciler are Emacs Lisp evaluated here, and its
JavaScript host calls `eval` once per source file and `call` once per DOM
event.

```text
page                          src/wasm/src/emacs-eval-client.js   (ES module)
  createEmacsEvalService()      eval(source), call(name, ...args): promises
    | postMessage
worker                        src/wasm/src/emacs-eval-worker.js
  loads temacs.js / .wasm / .data and the pdmp of the product build
    |
core                          src/wasm/src/emacs-eval-core.js     (also used under Node)
  callMain(["--dump-file=...", "--batch"]) once, then wasmacs_eval_string per request
    |
Lisp                          src/wasm/src/wasmacs-eval-service.el
  reads and evaluates the forms, turns value or error into one JSON reply
```

Demo page: `src/wasm/eval-service.html` (`/app/eval-service.html`).

## Using it

```js
import { createEmacsEvalService } from "https://modeverv.github.io/wasmacs/app/src/emacs-eval-client.js";

const emacs = createEmacsEvalService();
await emacs.ready;                                     // { version: "30.2", bootMs }
await emacs.eval("(+ 1 2)");                           // 3
await emacs.eval('(list :name "x" :tags ["a" "b"])');  // { name: "x", tags: ["a", "b"] }
await emacs.eval("(defun double (n) (* 2 n))", { format: "lisp" });   // "double"
await emacs.call("double", 21);                        // 42
```

- `eval(source, { format, detailed })` evaluates every form in `source` with
  lexical binding and resolves with the value of the last one. `format` is
  `"json"` (default) or `"lisp"` (the printed representation, a string).
  `detailed: true` resolves with `{ value, output, ms }`, where `output` is
  what `message` and `princ` printed.
- `call(name, ...args)` calls a Lisp function with JSON-compatible arguments.
- A Lisp error rejects with an `EmacsEvalError`: `symbol` (`"void-variable"`),
  `message`, `data` (the printed error object), `output`.
- `createEmacsEvalService({ onOutput, onProgress })`: `onProgress` gets how the start goes, `{ phase, url, bytes }`: `"build id"`, then `"download"` for each file that was not in the cache (its URL and size), then `"emacs"` while Emacs itself starts. A network error names the URL that failed.
- A page that enforces Trusted Types (`require-trusted-types-for 'script'`) gets the worker started through a policy named `wasmacs-eval`, which its `trusted-types` directive has to allow.
- `ready` resolves with `{ version, bootMs, cached, files, offline }`:
  `cached`, nothing of Emacs was downloaded; `files`, `"on demand"` or
  `"all"` (see below); `offline`, the build id could not be asked for and
  the start came from the cache of the last build.
- `terminate()` ends the worker.
- Definitions, variables and buffers live as long as the service. Requests
  are answered one at a time, in order.

The page does not have to be cross-origin isolated (no `SharedArrayBuffer` is
used) and may be on another origin than the files: they are fetched with CORS,
and the client starts the worker through a same-origin blob.

## Values

Values cross as JSON with Emacs's own conventions (`json-serialize`,
`json-parse-string`):

| Lisp → JSON | JSON → Lisp (arguments of `call`) |
|---|---|
| plist with keyword keys, alist, hash table → object | object → plist with keyword keys |
| vector → array | array → vector |
| string, integer, float → the same | the same |
| `t` → `true`, `:false` → `false`, `nil` → `null` | `true` → `t`, `false` and `null` → `nil` |

A Lisp list is not an array: return a vector (`vconcat`). A value that has no
JSON form (a symbol, a list of numbers, a buffer) is the error
`wasmacs-eval-service-not-json`; use the `lisp` format for those.

## How it works

Emacs is started once in batch mode: `main` initialises Emacs from the pdmp,
finds nothing to do and exits. The runtime is built with `EXIT_RUNTIME=0`, so
it stays usable, and every request is one call of the exported C entry point
`wasmacs_eval_string` (patch `0001`), which evaluates under a condition-case
and stores the printed result for `wasmacs_last_result`. The entry point keeps
the garbage collector off during a request; the core collects between
requests (every 200 requests or 2 seconds) through `wasmacs_garbage_collect`.
The worker does it after it has posted an answer, when no request is
waiting (`deferCollection`, `collectIfDue`), so that a collection (6 to 18 ms)
is not added to the answer of the request that made it due.

`max-lisp-eval-depth` is lowered to 1000 (Emacs: 1600). A browser worker has a
small JavaScript stack that wasm shares, and a JavaScript stack overflow goes
through Emacs's C frames without unwinding them. Runaway recursion therefore
has to end as the Lisp error `excessive-lisp-nesting` first.

When a JavaScript exception does go through Emacs (stack overflow in C code,
out of memory, `kill-emacs`), the engine is in an undefined state. The core
refuses further requests, the worker reports the result as `fatal`, and the
client rejects everything after it. Create a new service.

### Emacs's own files

Emacs's `lisp/` and `etc/` are one package of 146 MB (`temacs.data`, 4,211
files), which the editor downloads whole. The eval service does not: most of
what a Lisp program needs (the compiler, `cl-lib`, `seq`, `json`, `url`) is
in the pdmp, and elisp-react's five examples together read seven of those
files (0.5 MB).

`temacs.files.json` (written by `src/build/emacs-packages.mjs`) says where
each file is in the package, with a checksum. The worker gives the
Emscripten glue an empty package, which makes it create every file empty,
and then gives each file its size and a `contents` that is fetched at the
first read (`WasmacsEvalFiles` in `emacs-eval-core.js`): a synchronous
request for that range of the package, which a worker may make. Every file
is there for `file-exists-p`, `load-path` and `directory-files`; only what
is read is downloaded. A file that was read is kept in the cache of the
build and is in place before Emacs starts the next time.

- **Servers without range requests.** The worker asks the server for one
  byte of the index first. GitHub Pages, nginx, Caddy and elisp-studio's
  project server send it; Python's `http.server` sends the whole file. Then
  the package is downloaded whole before the start, as before. `ready` says
  which it was: `files` is `"on demand"` or `"all"`.
- **A read that fails** (no network, or bytes that do not have the checksum
  of the index because the site was updated under a running page) is an
  input/output error for that file in Lisp; the page's console names the
  file. The next read tries again.
- **The core package.** `temacs.core.data` (21.6 MB, 641 files) with its
  index `temacs.core.files.json` is Emacs Lisp without the editor: the
  compiled Lisp of `lisp/` itself, `emacs-lisp/`, `international/`, `url/`
  and `calendar/`, the Unicode tables and the charset maps. No source files,
  no Org, Gnus, Calc, programming modes or input methods: `(require 'calc)`
  is `file-missing` there. A site that carries its own copy of Emacs can
  carry this instead of the 146 MB, under the name `temacs.files.json`
  (elisp-studio's `fetch-emacs.sh --core` does that; without the option it
  copies the whole package, so that a program finds on its own site what
  it found in the studio). The published site has both and uses the whole
  package.
- **A copy of the site without an index** (made by an older
  `fetch-emacs.sh`) gets the whole package, as before.

## Measured (2026-11-14, Chrome, local server)

- Ready in about 250-350 ms after the files are there.
- From the public site (2026-11-14, a fast connection): about 3 s for the
  first visit, see below for later ones.
- Round trip of a small request: 0.07-0.09 ms. A request that conses 100000
  cells: 0.8 ms. `(fib 25)`: 45 ms interpreted, 8 ms after `byte-compile`.
- `(require 'org)` 64 ms; exporting a small Org document to HTML 145 ms.
- Source passed to `eval` is interpreted, and the interpreter expands macros at
  every call. A library should be byte-compiled inside the service (write the
  source to a file, `byte-compile-file`, `load`): elisp-react's reconciler ran
  35 times faster that way (1000 rows: 4.7 s interpreted, 0.13 s compiled).
- With the cache below, a later visit of the public site is ready in about
  0.16 s (first visit: 1-4 s on a fast connection).

Reading files on demand (2026-11-15, Chrome, elisp-react's TODO example, a
local server that compresses and answers range requests as GitHub Pages
does):

| | whole package | on demand |
|---|---|---|
| Downloaded on the first visit | 43.1 MB | 4.8 MB |
| First visit until the page shows, at 30 Mbit/s | 12.3 s | 2.1 s |
| Later visits | 0.2-0.3 s | 0.2-0.3 s |
| Kept in the browser's storage | 162.5 MB | 16.9 MB |
| Memory of the tab's process | 630 MB | 230 MB |

`(require 'calc)` then fetches 13 files: 0.08 s locally, 0.8 s at 30 Mbit/s
with 40 ms of latency.

## Testing Lisp in this Emacs

`tools/scripts/ert.mjs` runs an ERT suite in the published WebAssembly Emacs 30.2 under Node, the Emacs pages run, so that an application's CI does not have to trust a native Emacs of another version:

```sh
node tools/scripts/ert.mjs --root ../elisp-react -L lisp -L test -c react -c react-testing -l react-test -l react-testing-test
```

`--root` (default: the current directory) is copied into Emacs's filesystem as `/project`; `-L` adds a directory of it to `load-path`; `-c` byte-compiles a file (warnings are errors) and loads it, `-l` loads one as it is, in the order given; `--selector` takes a regexp of test names. It exits 0 when every test passed.

## Hashes, random bytes, sockets

What Lisp has in this Emacs for an application that signs people in, makes
tokens or wants to be a server.  Checked on 2026-11-15 in Chrome (Emacs 30.2);
`npm run test:eval-service` keeps the rows of the eval service true.

| | |
|---|---|
| `secure-hash` | `md5`, `sha1`, `sha224`, `sha256`, `sha384`, `sha512`: Emacs's own C, as in a native Emacs. |
| GnuTLS | Not linked. `gnutls-hash-mac`, `gnutls-hash-digest` and `gnutls-symmetric-encrypt` are not defined: there is no HMAC primitive and no cipher. HMAC-SHA-256 is six lines of Lisp on `secure-hash`. |
| Public-key operations | None, as in a native Emacs: a signature (RS256, ES256, ...) cannot be checked in Lisp. |
| Dynamic modules | `module-load` is not defined: bindings to C libraries (libsodium and the like) cannot be loaded. |
| Random bytes | `(insert-file-contents-literally "/dev/urandom" nil nil N)` in a unibyte buffer gives N bytes of the browser's `crypto.getRandomValues`. With a start position (`nil 0 N`) Emacs 30 signals "cannot use a start position in a non-seekable file/device". `random` is Emacs's ordinary generator, not one for secrets. |
| JSON, base64 | `json-serialize`, `json-parse-string` and `base64url-encode-string` are there. |
| Locale, time zones | Emacs runs in the C locale (`LANG` and `LC_ALL` are "C"): `format-time-string` writes English names whatever `system-time-locale` says, and `string-collate-lessp` compares code points. Its ZONE argument works for `t` (UTC) only: an offset (`32400`), `"UTC"` or `"Asia/Tokyo"` all give the browser's own zone (checked under Node with `TZ=America/New_York`: `-0500` for each). There is no zoneinfo. elisp-react hands Lisp the visitor's languages and zone and the browser's `Intl` (`react-locale`, `react-intl`). |
| HTML, XML | libxml is not linked: `(libxml-available-p)` is nil and `libxml-parse-html-region` is not defined, so HTML cannot be parsed into a tree (elisp-react cleans HTML in the page instead, with `:inner-html`). `xml.el` (`xml-parse-region`) reads well-formed XML such as a feed, and `dom.el` walks the result. |
| SQLite | `sqlite-available-p` is t. |
| Listening | `make-network-process` with `:server` fails ("Protocol not available"): this Emacs cannot be a web server. A page that wants one answers its own requests by calling Lisp, as [elisp-studio](https://github.com/modeverv/elisp-studio) does. |
| Programs | The eval service starts none (limit 4 below): no `python3`, no `openssl`. In the editor, with the process service, `python3` has the SHA functions of `hashlib`, `hmac` and `os.urandom`; it has no `hashlib.pbkdf2_hmac`, no `hashlib.scrypt` and no `ssl` (CPython is built without OpenSSL), and there is no `openssl` program. |

Slow arithmetic belongs to the page.  PBKDF2-HMAC-SHA-256 with 600,000 rounds
takes 3.4 s in byte-compiled Lisp here, and the service answers nothing
meanwhile (limit 2); the page's Web Crypto does it in 0.07 s.  With these
parts a token signed with a shared secret (a JWT with HS256) can be made and
checked in Lisp, in about 0.05 ms; one signed with a private key cannot be
checked.

## Limits and open issues

1. **Download size on the first visit.** Emacs itself is downloaded before
   the start: `temacs.wasm` 3.2 MB and the pdmp 12.8 MB (1.2 MB and 3.4 MB as
   GitHub Pages compresses them), and the index of its files (0.08 MB). Its
   `lisp/` and `etc/` come file by file, see [Emacs's own
   files](#emacss-own-files). The worker keeps all of this in the browser's
   Cache Storage under the build id of the site (`app/eval-build-id.json`),
   so later visits download nothing but that id; a new build is downloaded
   once and replaces the old one. When the id cannot be had (no network, a
   server error), Emacs starts from the cache as it is and `ready` says
   `offline: true`; the id is asked for again next time. A server that
   answers 404 for the id (a development server) gets nothing from the
   cache. The cache belongs to the page's origin: another site that uses the
   service has its own copy. On one origin, each place the service is served
   from (the published site, an application's copy in its `vendor/`) has a
   cache of its own, and a new build replaces only the old one of its
   place. There is no service worker, so a page works
   offline only as far as the browser's HTTP cache still holds the page,
   the client and the worker. The sizes depend on
   the server compressing: a server that sends these files as they are
   makes the first visit 16.6 MB (measured on 2026-11-15: Caddy and nginx
   with common settings compress `temacs.wasm` and not the pdmp, 14.3 MB;
   elisp-studio's project server sends gzip copies that `fetch-emacs.sh`
   keeps next to the files, 4.8 MB). Reading on demand was
   tried in Chrome only; a browser that sends a preflight for a range
   request to another origin gets the whole package from GitHub Pages
   instead (the same origin is not affected).
2. **No interruption.** A request that does not return (`(while t)`) blocks
   the worker; the only way out is `terminate()` and a new service, which
   loses all Lisp state. There is no timeout in the client yet.
3. **Synchronous, one at a time.** No request is answered while another one
   runs. Timers (`run-with-timer`) only run inside a request that waits
   (`sleep-for`, `sit-for`); there is no command loop to run them between
   requests, and Lisp cannot call back into the page or await a promise.
4. **No processes, no network.** The process kernel and the userland are not
   booted (`call-process` fails with "Searching for program"), and `url.el` is
   not connected to the page.
5. **No persistence.** The filesystem is in memory; `/home/user` is empty at
   every start. Lisp state is lost with the worker.
6. **Stack depth.** About 300 nested interpreted function calls before
   `excessive-lisp-nesting` (byte-compiled code gets further). C-level
   recursion (deeply nested data in the reader or printer) can still overflow
   the JavaScript stack and end the engine.
7. **The API is not versioned.** Another project that imports
   `emacs-eval-client.js` from the Pages site gets whatever is deployed. The
   file layout (`app/src/`, `artifacts/emacs-browser-atomics-pdump/` with
   `temacs.files.json`, `temacs.data.parts/`, `temacs.core.data` and
   `temacs.core.files.json`) is part of the contract now.
8. **Memory.** The module reserves 1 GiB of linear memory at start (the
   product's setting) and can grow to 2 GiB, Emscripten's default maximum (the
   build sets no `MAXIMUM_MEMORY`). Lisp cannot see how much is used:
   `garbage-collect` is inhibited during a request and returns nil.
9. **Emacs is "killed".** Batch startup ends with `kill-emacs`, whose hooks
   have run. Nothing was found broken by that, but it is an unusual state for
   Emacs to continue in; a dedicated "initialise and return" entry point in
   the patch layer would be cleaner.

## Tests

| Command | What runs |
|---|---|
| `npm test` | `tests/runtime/eval-service-bundle.test.js`: the published core and Lisp on the published Emacs under Node: values, errors, `call`, output, recursion limit, garbage collection; the indexes against the published package; files read on demand (what the start reads, a library required later, a read that fails, wrong bytes); the core package. |
| `npm run test:eval-service` | `tools/scripts/probe-eval-service.mjs`: real Chrome, `docs/` from a plain static server without isolation headers: the worker, the client, the demo page, hashes and random bytes, a failed engine, and a page on another origin; files on demand and from the cache on the second visit; a server without range requests; a site with the core package; a copy of the site without an index. |
