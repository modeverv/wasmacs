// emacs-eval-client.js -- the page side of the Emacs eval service.
//
//   import { createEmacsEvalService } from "./src/emacs-eval-client.js";
//   const emacs = createEmacsEvalService();
//   await emacs.ready;                                   // { version, bootMs }
//   await emacs.eval("(+ 1 2)");                         // 3
//   await emacs.eval('(list :name "x" :tags ["a" "b"])'); // { name: "x", tags: ["a", "b"] }
//   await emacs.eval("(defun double (n) (* 2 n))", { format: "lisp" }); // "double"
//   await emacs.call("double", 21);                      // 42
//
// Values cross as JSON (see wasmacs-eval-service.el for the conventions); the
// "lisp" format returns the printed representation instead.  A Lisp error
// rejects the promise with an EmacsEvalError.  Lisp state (definitions,
// variables, buffers) lives as long as the service.
//
// Requests are answered in order, one at a time.  A request that never
// returns (an endless loop) cannot be interrupted: terminate() the service
// and create a new one.  The same goes for a service whose engine failed
// (EmacsEvalError with symbol "host-error": a stack overflow, out of memory,
// kill-emacs); it rejects every later request.

export class EmacsEvalError extends Error {
  constructor(error, output) {
    super(error?.message || "Emacs Lisp error");
    this.name = "EmacsEvalError";
    this.symbol = error?.symbol || "error";   // the Lisp error symbol, e.g. "void-variable"
    this.data = error?.data || "";            // the printed error object
    this.output = output || "";               // what Emacs printed before failing
  }
}

export function createEmacsEvalService({
  workerUrl = new URL("./emacs-eval-worker.js", import.meta.url),
  onOutput = null,   // (text) => void: what `message' and `princ' print during a request
} = {}) {
  // A worker has to come from the page's own origin.  For a page elsewhere
  // (it imported this module with CORS), a same-origin blob imports the
  // worker script and tells it where it really lives.
  const scriptUrl = new URL(workerUrl, import.meta.url);
  let worker;
  if (scriptUrl.origin === globalThis.location?.origin) {
    worker = new Worker(scriptUrl);
  } else {
    const bootstrap = `self.__wasmacsEvalWorkerUrl = ${JSON.stringify(scriptUrl.href)}; importScripts(self.__wasmacsEvalWorkerUrl);`;
    const blobUrl = URL.createObjectURL(new Blob([bootstrap], { type: "text/javascript" }));
    worker = new Worker(blobUrl);
    URL.revokeObjectURL(blobUrl);
  }
  const pending = new Map();
  let nextId = 1;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});
  let dead = null;   // why the service cannot answer any more
  const failAll = (error) => {
    dead = dead || error;
    rejectReady(error);
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };

  worker.onmessage = (event) => {
    const msg = event.data || {};
    if (msg.type === "ready") {
      resolveReady({ version: msg.version, bootMs: msg.bootMs });
    } else if (msg.type === "failed") {
      failAll(new Error(`Emacs eval service: ${msg.error}`));
    } else if (msg.type === "log") {
      console.warn("[emacs eval service]", msg.text);
    } else if (msg.type === "result") {
      const request = pending.get(msg.id);
      if (!request) return;
      pending.delete(msg.id);
      if (msg.output && onOutput) onOutput(msg.output);
      if (msg.ok) request.resolve(request.detailed ? { value: msg.value, output: msg.output, ms: msg.ms } : msg.value);
      else request.reject(new EmacsEvalError(msg.error, msg.output));
      if (msg.fatal) {
        worker.terminate();
        failAll(new Error(`Emacs eval service: the engine failed (${msg.error?.message}); create a new service`));
      }
    }
  };
  worker.onerror = (event) => failAll(new Error(`Emacs eval service worker: ${event.message || "failed to load"}`));
  worker.postMessage({ type: "start" });

  const send = (message, { detailed = false } = {}) => ready.then(() => new Promise((resolve, reject) => {
    if (dead) { reject(dead); return; }
    const id = nextId++;
    pending.set(id, { resolve, reject, detailed });
    worker.postMessage({ ...message, id });
  }));

  return {
    ready,
    // Evaluate Lisp source (one or more forms); resolves with the value of
    // the last form.  { detailed: true } resolves with { value, output, ms }.
    eval(source, { format = "json", detailed = false } = {}) {
      return send({ type: "eval", source, format }, { detailed });
    },
    // Call a Lisp function by name with JSON-compatible arguments.
    call(name, ...args) {
      return send({ type: "call", name, args, format: "json" });
    },
    terminate() {
      worker.terminate();
      failAll(new Error("Emacs eval service: terminated"));
    },
  };
}
