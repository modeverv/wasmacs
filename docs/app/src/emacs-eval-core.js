/*
 * emacs-eval-core.js -- Emacs as a Lisp engine: evaluate, get the value back.
 *
 * The product runs Emacs as an editor: main() enters the command loop and
 * never returns.  Here the same build is used as a library instead.  Emacs
 * starts in batch mode, which initialises it from the pdmp and returns; the
 * runtime stays alive, and from then on the host calls the exported
 * wasmacs_eval_string() for every request.  Between requests the thread is
 * free: this is an ordinary request/response service.
 *
 * Plain JS shared by the worker (emacs-eval-worker.js, importScripts) and the
 * Node harness (vm).  LISP is the source of wasmacs-eval-service.el, which
 * defines the reply format and the JSON conventions.
 */
(function (root) {
  'use strict';

  // Emacs conses while it evaluates and the entry point keeps the garbage
  // collector off for the duration of a request, so the host collects
  // between requests: after this many of them, or this much later.
  const GC_EVERY_REQUESTS = 200;
  const GC_EVERY_MS = 2000;

  // A browser worker has a small JavaScript stack, which wasm shares.  Deep
  // Lisp recursion must end as a Lisp error (excessive-lisp-nesting) before
  // it ends as a JavaScript stack overflow: that one cuts through Emacs's C
  // frames without unwinding them and leaves the engine unusable.  Emacs's
  // default is 1600; about 2000 was measured to overflow in Chrome.
  const MAX_LISP_EVAL_DEPTH = 1000;

  // TEXT as a Lisp string literal.
  const lispString = (text) => `"${String(text).replace(/[\\"]/g, '\\$&')}"`;

  // Module: the Emscripten module of temacs.js, runtime initialised, with
  // /bootstrap-emacs.pdmp and /temacs in its filesystem.
  function create({ Module, lisp, pdmp = '/bootstrap-emacs.pdmp', maxLispEvalDepth = MAX_LISP_EVAL_DEPTH,
                    now = () => performance.now() }) {
    let requests = 0;
    let lastGc = now();
    let started = false;
    let broken = null;   // the exception that went through Emacs's C frames

    // One call of the C entry point: [failed, text of the result].
    function evalString(source) {
      const failed = Module.ccall('wasmacs_eval_string', 'number', ['string'], [source]) !== 0;
      return [failed, Module.ccall('wasmacs_last_result', 'string', [], []) || ''];
    }
    // What Emacs printed (message, princ) since the last call.
    function takeOutput() {
      const bytes = root.__wasmacsTerminalOutputBytes;
      if (!bytes || bytes.length === 0) return '';
      const text = new TextDecoder().decode(Uint8Array.from(bytes));
      bytes.length = 0;
      root.__wasmacsSentOutputCount = 0;
      return text;
    }
    function collectGarbage() {
      Module.ccall('wasmacs_garbage_collect', 'number', [], []);
      requests = 0;
      lastGc = now();
    }

    // Initialise Emacs.  Returns { version, output }.
    function start() {
      if (started) throw new Error('the eval service is already started');
      try {
        // Batch mode: initialise, find nothing to do, kill-emacs.  With
        // EXIT_RUNTIME=0 that ends main() and leaves the runtime usable.
        const status = Module.callMain([`--dump-file=${pdmp}`, '--batch']);
        if (status) throw new Error(`Emacs did not start (status ${status})`);
      } catch (e) {
        if (!e || e.name !== 'ExitStatus' || e.status) throw e;
      }
      const [failed, text] = evalString(`(progn ${lisp}\n (setq max-lisp-eval-depth ${Number(maxLispEvalDepth)}) emacs-version)`);
      if (failed) throw new Error(`the eval service Lisp did not load: ${text}`);
      started = true;
      collectGarbage();
      return { version: text, output: takeOutput() };
    }

    // { ok: true, value, output } | { ok: false, error: { symbol, message, data }, output }
    // Throws when the engine itself fails; it cannot be used after that.
    function request(form) {
      if (!started) throw new Error('the eval service is not started');
      if (broken) throw new Error(`the Emacs engine is unusable after: ${broken.message || broken}`);
      let failed, text;
      try {
        [failed, text] = evalString(form);
      } catch (e) {
        // A JavaScript exception (stack overflow, out of memory, exit) went
        // through Emacs's C frames; nothing was unwound.
        broken = e;
        throw e;
      }
      let reply;
      if (failed) {
        // Not an `error' condition (quit, a throw without a catch): the C
        // entry point caught it.
        reply = { ok: false, error: { symbol: 'error', message: text, data: text } };
      } else {
        reply = JSON.parse(text);
      }
      reply.output = takeOutput();
      requests += 1;
      if (requests >= GC_EVERY_REQUESTS || now() - lastGc >= GC_EVERY_MS) collectGarbage();
      return reply;
    }

    const formatSymbol = (format) => (format === 'lisp' ? "'lisp" : "'json");
    return {
      start,
      // Evaluate the forms in SOURCE; the value of the last one is returned
      // as JSON data (format 'json') or printed (format 'lisp').
      eval(source, { format = 'json' } = {}) {
        return request(`(wasmacs-eval-service-eval ${lispString(source)} ${formatSymbol(format)})`);
      },
      // Call the Lisp function NAME with JSON-compatible ARGS.
      call(name, args = [], { format = 'json' } = {}) {
        return request(`(wasmacs-eval-service-call ${lispString(name)} ${lispString(JSON.stringify(args))} ${formatSymbol(format)})`);
      },
      collectGarbage,
    };
  }

  root.WasmacsEvalService = { create };
})(typeof globalThis !== 'undefined' ? globalThis : self);
