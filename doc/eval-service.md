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

`max-lisp-eval-depth` is lowered to 1000 (Emacs: 1600). A browser worker has a
small JavaScript stack that wasm shares, and a JavaScript stack overflow goes
through Emacs's C frames without unwinding them. Runaway recursion therefore
has to end as the Lisp error `excessive-lisp-nesting` first.

When a JavaScript exception does go through Emacs (stack overflow in C code,
out of memory, `kill-emacs`), the engine is in an undefined state. The core
refuses further requests, the worker reports the result as `fatal`, and the
client rejects everything after it. Create a new service.

## Measured (2026-11-14, Chrome, local server)

- Ready in about 250-350 ms after the files are there.
- From the public site (2026-11-14, a fast connection): about 3 s for the
  first visit, see below for later ones.
- Round trip of a small request: 0.07-0.09 ms. A request that conses 100000
  cells: 0.8 ms. `(fib 25)`: 45 ms interpreted, 8 ms after `byte-compile`.
- `(require 'org)` 64 ms; exporting a small Org document to HTML 145 ms.

## Limits and open issues

1. **Download size on the first visit.** The service loads the whole product
   build: `temacs.wasm` 2.1 MB, the pdmp 12.2 MB and `temacs.data` 139 MB (all
   of Emacs's `lisp/` and `etc/`). The worker keeps these in the browser's
   Cache Storage under the build id of the site (`app/eval-build-id.json`), so
   later visits download nothing but that id; a new build is downloaded once
   and replaces the old one. The cache belongs to the page's origin: another
   site that uses the service has its own copy. The first visit is still
   150 MB: a small data package (the preloaded Lisp is in the pdmp already;
   most of `lisp/` is only needed for `require`) remains to be done. There is
   no service worker, so the page itself does not work offline.
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
   file layout (`app/src/`, `artifacts/emacs-browser-atomics-pdump/`) is part
   of the contract now.
8. **Memory.** The module reserves 1 GiB of linear memory at start (the
   product's setting) and can grow to 4 GiB. Lisp cannot see how much is used:
   `garbage-collect` is inhibited during a request and returns nil.
9. **Emacs is "killed".** Batch startup ends with `kill-emacs`, whose hooks
   have run. Nothing was found broken by that, but it is an unusual state for
   Emacs to continue in; a dedicated "initialise and return" entry point in
   the patch layer would be cleaner.

## Tests

| Command | What runs |
|---|---|
| `npm test` | `tests/runtime/eval-service-bundle.test.js`: the published core and Lisp on the published Emacs under Node: values, errors, `call`, output, recursion limit, garbage collection. |
| `npm run test:eval-service` | `tools/scripts/probe-eval-service.mjs`: real Chrome, `docs/` from a plain static server without isolation headers: the worker, the client, the demo page, a failed engine, and a page on another origin. |
