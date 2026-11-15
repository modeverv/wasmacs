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
 *
 * The second half (WasmacsEvalFiles) is how the engine gets Emacs's own
 * files: one by one, when Emacs reads them.
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

  // ---- Emacs's own files, read when Emacs reads them --------------------------
  //
  // Emacs's lisp/ and etc/ are one package of 146 MB (temacs.data), and the
  // Emscripten glue wants all of it before Emacs starts.  A program that
  // uses Emacs as a Lisp engine reads a handful of those files: what it
  // needs most is in the pdmp.  So the glue is given an empty package, which
  // makes it create every file empty, and installFiles() gives each file its
  // size and a `contents' that is fetched when Emacs first reads it.
  //
  // The index (temacs.files.json, written by src/build/emacs-packages.mjs):
  //   { root, container: { size, chunkSize, parts: [name...] },
  //     files: [[name, start, end, crc32]...] }
  // NAME is relative to ROOT; START and END are its place in the container,
  // which is published in parts of CHUNKSIZE bytes.  An index may hold a
  // part of Emacs's files only (the core package): the others are removed.

  const EIO = 29;   // Emscripten's errno for an input/output error

  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c;
      }
    }
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
  }

  // A function (start, end) -> the bytes of that range of CONTAINER, made of
  // readPart(index, from, to) -> the bytes FROM..TO of its part INDEX.
  function containerReader(container, readPart) {
    return (start, end) => {
      const first = Math.floor(start / container.chunkSize);
      if (end <= (first + 1) * container.chunkSize) {
        return readPart(first, start - first * container.chunkSize, end - first * container.chunkSize);
      }
      // The file lies across two parts or more.
      const bytes = new Uint8Array(end - start);
      for (let at = start; at < end;) {
        const part = Math.floor(at / container.chunkSize);
        const to = Math.min(end, (part + 1) * container.chunkSize);
        bytes.set(readPart(part, at - part * container.chunkSize, to - part * container.chunkSize), at - start);
        at = to;
      }
      return bytes;
    };
  }

  // FS: the module's file system, after the glue created its (empty) files.
  // read(start, end): the bytes of that range of the container, at once;
  // it may throw.  have: Map name -> bytes that are here already.
  // onRead(name, bytes): a file was fetched.  onError(name, error): a file
  // could not be read; Emacs gets an input/output error for it and the next
  // read tries again.  Returns the number of files.
  function installFiles({ FS, index, read, have = new Map(), onRead = null, onError = null }) {
    const wanted = new Set();
    for (const [name, start, end, crc] of index.files) {
      const path = `${index.root}${name}`;
      wanted.add(path);
      let node;
      try {
        node = FS.lookupPath(path).node;
      } catch (_) {
        FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
        node = FS.create(path, 0o644);
      }
      let data = have.get(name) || null;
      Object.defineProperty(node, 'contents', {
        configurable: true,
        get() {
          if (!data) {
            try {
              const bytes = read(start, end);
              if (bytes.length !== end - start) throw new Error(`${bytes.length} bytes instead of ${end - start}`);
              if (crc32(bytes) !== crc) throw new Error('the bytes are not those of the index (was the site updated? load the page again)');
              data = bytes;
            } catch (error) {
              // Any other exception would go through Emacs's C frames.
              if (onError) onError(name, error);
              throw new FS.ErrnoError(EIO);
            }
            if (onRead) onRead(name, data);
          }
          return data;
        },
        set(value) { data = value; },
      });
      node.usedBytes = end - start;
    }
    // What the glue created and the index does not have.
    (function prune(dir) {
      for (const name of FS.readdir(dir)) {
        if (name === '.' || name === '..') continue;
        const path = `${dir}/${name}`;
        if (FS.isDir(FS.stat(path).mode)) prune(path);
        else if (!wanted.has(path)) FS.unlink(path);
      }
    })(index.root.replace(/\/$/, ''));
    return wanted.size;
  }

  root.WasmacsEvalService = { create };
  root.WasmacsEvalFiles = { crc32, containerReader, installFiles };
})(typeof globalThis !== 'undefined' ? globalThis : self);
