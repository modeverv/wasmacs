// Asyncify host import for wasmacs_host_wait_for_input.
//
// When Emacs calls wasmacs_host_wait_for_input (from keyboard.c read_char or
// minibuf.c setup), the wasm execution suspends via Asyncify.  Control returns
// to JS.  The JS side resolves the wait by calling
// globalThis.__wasmacsResolveHostInputWait(), which also injects pending key
// bytes if any are queued.
//
// In a browser Web Worker context, the function posts { type: "emacs-waiting" }
// so the main thread knows Emacs is ready for the next key event.
//
// In a Node probe context, the global resolver is called manually by the probe.

mergeInto(LibraryManager.library, {
  // Set up default terminal environment so interactive startup does not fail.
  $wasmacs_asyncify_env__deps: ["$ENV"],
  $wasmacs_asyncify_env__postset: [
    "ENV.TERM     = ENV.TERM     || 'dumb';",
    "ENV.TERMCAP  = ENV.TERMCAP  || 'dumb:co#80:li#24:cl=\\\\E[H\\\\E[2J:cm=\\\\E[%i%d;%dH:up=\\\\E[A:do=\\\\E[B:nd=\\\\E[C:bs:';",
    "ENV.HOME     = ENV.HOME     || '/home/user';",
    "ENV.USER     = ENV.USER     || 'wasmacs';",
    "ENV.LOGNAME  = ENV.LOGNAME  || 'wasmacs';",
  ].join("\n"),
  $wasmacs_asyncify_env: {},

  wasmacs_host_wait_for_input__deps: ["$wasmacs_asyncify_env"],
  wasmacs_host_wait_for_input: async function () {
    globalThis.__wasmacsHostWaitForInputCount =
      (globalThis.__wasmacsHostWaitForInputCount || 0) + 1;
    globalThis.__wasmacsHostWaitForInputPending = true;

    return new Promise((resolve) => {
      // Expose the resolver so the worker/probe can call it when a key is ready.
      globalThis.__wasmacsResolveHostInputWait = function () {
        globalThis.__wasmacsHostWaitForInputPending = false;
        globalThis.__wasmacsResolveHostInputWait    = undefined;
        resolve(0);
      };

      // In a browser Web Worker, notify the main thread that Emacs is waiting.
      // The main thread forwards the next key event back as { type: "inject-key" }.
      if (typeof self !== "undefined" &&
          typeof self.postMessage === "function" &&
          typeof WorkerGlobalScope !== "undefined" &&
          self instanceof WorkerGlobalScope) {
        self.postMessage({ type: "emacs-waiting" });
      }
    });
  },
});
