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

  $wasmacs_terminal__deps: ["$TTY", "$FS", "$wasmacs_asyncify_env"],
  $wasmacs_terminal__postset: [
    "globalThis.__wasmacsTerminalInputBytes = globalThis.__wasmacsTerminalInputBytes || [];",
    "globalThis.__wasmacsTerminalOutputBytes = globalThis.__wasmacsTerminalOutputBytes || [];",
    "globalThis.__wasmacsSchedulerEvents = globalThis.__wasmacsSchedulerEvents || [];",
    "globalThis.__wasmacsSchedulerEventSeq = globalThis.__wasmacsSchedulerEventSeq || 0;",
    "globalThis.__wasmacsPromiseSeq = globalThis.__wasmacsPromiseSeq || 0;",
    "globalThis.__wasmacsWaitPromiseState = globalThis.__wasmacsWaitPromiseState || {};",
    "globalThis.__wasmacsWaitImportMode = globalThis.__wasmacsWaitImportMode || (typeof process !== 'undefined' && process.env && process.env.WASMACS_WAIT_IMPORT_MODE) || 'handleAsync'; // product-default-candidate; use WASMACS_WAIT_IMPORT_MODE=async-wrapper for known-broken comparison",
    "globalThis.__wasmacsGetAsyncifyState = function () {",
    "  if (typeof Asyncify === 'undefined') { return { available: false }; }",
    "  return {",
    "    available: true,",
    "    state: Asyncify.state,",
    "    currDataPresent: !!Asyncify.currData,",
    "    asyncPromiseHandlersPresent: !!Asyncify.asyncPromiseHandlers,",
    "    exportCallStackLength: Asyncify.exportCallStack ? Asyncify.exportCallStack.length : -1,",
    "  };",
    "};",
    "globalThis.__wasmacsTerminalRows = globalThis.__wasmacsTerminalRows || 24;",
    "globalThis.__wasmacsTerminalCols = globalThis.__wasmacsTerminalCols || 80;",
    "globalThis.__wasmacsQueueTerminalInput = function (bytes) {",
    "  var queue = globalThis.__wasmacsTerminalInputBytes;",
    "  if (typeof bytes === 'string') {",
    "    for (var i = 0; i < bytes.length; i++) queue.push(bytes.charCodeAt(i) & 255);",
    "    return;",
    "  }",
    "  if (bytes && typeof bytes.length === 'number') {",
    "    for (var j = 0; j < bytes.length; j++) queue.push(bytes[j] & 255);",
    "  }",
    "};",
    "globalThis.__wasmacsRecordSchedulerCheckpoint = function (code, details) {",
    "  var labels = {",
    "    1: 'js-import-wait-enter',",
    "    2: 'js-import-resolver-called',",
    "    3: 'js-import-resolve-after',",
    "    4: 'js-import-promise-then',",
    "    5: 'js-import-promise-created',",
    "    6: 'js-import-promise-return-expression',",
    "    7: 'js-import-resolver-bound',",
    "    8: 'js-import-handleasync-enter',",
    "    9: 'js-import-handleasync-promise-created',",
    "    13: 'js-import-handleasync-returning',",
    "    14: 'js-import-handleasync-currdata-before',",
    "    15: 'js-import-asyncpromisehandlers-at-resolver-bound',",
    "    16: 'js-import-promise-then-asyncify-state',",
    "    17: 'js-import-outer-entrypoint-currdata-present',",
    "    10: 'js-terminal-read-byte-enter',",
    "    11: 'js-terminal-read-byte-dequeue',",
    "    12: 'js-terminal-read-byte-empty',",
    "    100: 'c-sysdep-before-wait',",
    "    101: 'c-sysdep-after-wait-return',",
    "    102: 'c-sysdep-byte-dequeued',",
    "    200: 'c-keyboard-read-char-reached',",
    "    201: 'c-keyboard-before-wait-import',",
    "    202: 'c-keyboard-after-wait-return',",
    "  };",
    "  var event = {",
    "    seq: ++globalThis.__wasmacsSchedulerEventSeq,",
    "    code: code,",
    "    label: labels[code] || ('checkpoint-' + code),",
    "    waitActive: !!globalThis.__wasmacsHostWaitForInputPending,",
    "    waitCount: globalThis.__wasmacsHostWaitForInputCount || 0,",
    "    resolverPresent: typeof globalThis.__wasmacsResolveHostInputWait === 'function',",
    "    queuedBytes: (globalThis.__wasmacsTerminalInputBytes || []).length,",
    "    queuedPreview: (globalThis.__wasmacsTerminalInputBytes || []).slice(0, 16),",
    "    outputByteCount: (globalThis.__wasmacsTerminalOutputBytes || []).length,",
    "    details: details || {},",
    "  };",
    "  globalThis.__wasmacsSchedulerEvents.push(event);",
    "  if (globalThis.__wasmacsSchedulerEvents.length > 400) {",
    "    globalThis.__wasmacsSchedulerEvents = globalThis.__wasmacsSchedulerEvents.slice(-400);",
    "  }",
    "};",
    "TTY.default_tty_ops.get_char = function () {",
    "  var queue = globalThis.__wasmacsTerminalInputBytes || [];",
    "  return queue.length ? queue.shift() : undefined;",
    "};",
    "TTY.default_tty_ops.put_char = function (tty, val) {",
    "  if (val === null) return;",
    "  val = val & 255;",
    "  globalThis.__wasmacsTerminalOutputBytes.push(val);",
    "  if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {",
    "    self.postMessage({ type: 'terminal-output', fd: 1, bytes: [val] });",
    "  }",
    "};",
    "TTY.default_tty_ops.fsync = function () {};",
    "TTY.default_tty_ops.ioctl_tcgets = function () {",
    "  return globalThis.__wasmacsTerminalTermios || {",
    "    c_iflag: 0,",
    "    c_oflag: 0,",
    "    c_cflag: 2237,",
    "    c_lflag: 0,",
    "    c_cc: [3, 28, 127, 21, 4, 0, 1, 0, 17, 19, 26, 0, 18, 15, 23, 22, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],",
    "  };",
    "};",
    "TTY.default_tty_ops.ioctl_tcsets = function (tty, optional_actions, data) {",
    "  globalThis.__wasmacsTerminalTermios = data;",
    "  return 0;",
    "};",
    "TTY.default_tty_ops.ioctl_tiocgwinsz = function () {",
    "  return [globalThis.__wasmacsTerminalRows || 24, globalThis.__wasmacsTerminalCols || 80];",
    "};",
    "TTY.default_tty1_ops.put_char = function (tty, val) {",
    "  if (val === null) return;",
    "  val = val & 255;",
    "  globalThis.__wasmacsTerminalOutputBytes.push(val);",
    "  if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {",
    "    self.postMessage({ type: 'terminal-output', fd: 2, bytes: [val] });",
    "  }",
    "};",
    "TTY.default_tty1_ops.fsync = function () {};",
    "TTY.stream_ops.ioctl = function (stream, op, argp) {",
    "  if (op === {{{ cDefs.FIONREAD }}}) {",
    "    {{{ makeSetValue('argp', 0, '(globalThis.__wasmacsTerminalInputBytes || []).length', 'i32') }}};",
    "    return 0;",
    "  }",
    "  return 0;",
    "};",
  ].join("\n"),
  $wasmacs_terminal: {},

  wasmacs_host_terminal_input_available__deps: ["$wasmacs_terminal"],
  wasmacs_host_terminal_input_available: function () {
    return (globalThis.__wasmacsTerminalInputBytes || []).length;
  },

  wasmacs_host_terminal_read_byte__deps: ["$wasmacs_terminal"],
  wasmacs_host_terminal_read_byte: function () {
    globalThis.__wasmacsRecordSchedulerCheckpoint &&
      globalThis.__wasmacsRecordSchedulerCheckpoint(10);
    var queue = globalThis.__wasmacsTerminalInputBytes || [];
    if (queue.length) {
      var byte = queue.shift();
      globalThis.__wasmacsRecordSchedulerCheckpoint &&
        globalThis.__wasmacsRecordSchedulerCheckpoint(11, { byte: byte });
      return byte;
    }
    globalThis.__wasmacsRecordSchedulerCheckpoint &&
      globalThis.__wasmacsRecordSchedulerCheckpoint(12);
    return -1;
  },

  wasmacs_host_is_tty_fd__deps: ["$FS", "$wasmacs_terminal"],
  wasmacs_host_is_tty_fd: function (fd) {
    try {
      var stream = FS.getStream(fd);
      return stream && stream.tty ? 1 : 0;
    } catch (e) {
      return 0;
    }
  },

  wasmacs_host_wait_for_input__deps: ["$wasmacs_asyncify_env", "$wasmacs_terminal"],
  wasmacs_host_wait_for_input: function () {
    var mode =
      globalThis.__wasmacsWaitImportMode ||
      (typeof process !== "undefined" && process.env && process.env.WASMACS_WAIT_IMPORT_MODE) ||
      "handleAsync"; // product-default-candidate; async-wrapper = known-broken comparison
    globalThis.__wasmacsHostWaitForInputCount =
      (globalThis.__wasmacsHostWaitForInputCount || 0) + 1;
    var waitId = globalThis.__wasmacsHostWaitForInputCount;
    globalThis.__wasmacsHostWaitForInputPending = true;
    globalThis.__wasmacsRecordSchedulerCheckpoint &&
      globalThis.__wasmacsRecordSchedulerCheckpoint(1, { waitId: waitId, mode: mode });

    if (mode === "handleAsync") {
      globalThis.__wasmacsRecordSchedulerCheckpoint &&
        globalThis.__wasmacsRecordSchedulerCheckpoint(14, {
          waitId: waitId,
          mode: mode,
          currDataPresentBeforeHandleAsync: (typeof Asyncify !== "undefined") ? !!Asyncify.currData : null,
          asyncPromiseHandlersPresentBeforeHandleAsync: (typeof Asyncify !== "undefined") ? !!Asyncify.asyncPromiseHandlers : null,
        });
      return Asyncify.handleAsync(function () {
        globalThis.__wasmacsRecordSchedulerCheckpoint &&
          globalThis.__wasmacsRecordSchedulerCheckpoint(8, { waitId: waitId, mode: mode });

        var createdPromiseId = ++globalThis.__wasmacsPromiseSeq;
        globalThis.__wasmacsWaitPromiseState[waitId] = {
          waitId: waitId,
          mode: mode,
          createdPromiseId: createdPromiseId,
          resolverPromiseId: createdPromiseId,
          resolverCalled: false,
          resolveAfter: false,
          thenReached: false,
          asyncifyHandleAsyncOwnsSuspend: true,
          actualReturnedPromiseId: "asyncify-handleAsync",
        };
        globalThis.__wasmacsRecordSchedulerCheckpoint &&
          globalThis.__wasmacsRecordSchedulerCheckpoint(9, {
            waitId: waitId,
            mode: mode,
            createdPromiseId: createdPromiseId,
          });

        var promise = new Promise((resolve) => {
          // Expose the resolver so the worker/probe can call it when a key is ready.
          globalThis.__wasmacsResolveHostInputWait = function () {
            globalThis.__wasmacsWaitPromiseState[waitId].resolverCalled = true;
            globalThis.__wasmacsRecordSchedulerCheckpoint &&
              globalThis.__wasmacsRecordSchedulerCheckpoint(2, {
                waitId: waitId,
                mode: mode,
                createdPromiseId: createdPromiseId,
                resolverPromiseId: createdPromiseId,
              });
            globalThis.__wasmacsHostWaitForInputPending = false;
            globalThis.__wasmacsResolveHostInputWait    = undefined;
            resolve(0);
            globalThis.__wasmacsWaitPromiseState[waitId].resolveAfter = true;
            globalThis.__wasmacsRecordSchedulerCheckpoint &&
              globalThis.__wasmacsRecordSchedulerCheckpoint(3, {
                waitId: waitId,
                mode: mode,
                createdPromiseId: createdPromiseId,
              });
          };
          globalThis.__wasmacsRecordSchedulerCheckpoint &&
            globalThis.__wasmacsRecordSchedulerCheckpoint(7, {
              waitId: waitId,
              mode: mode,
              createdPromiseId: createdPromiseId,
              resolverPromiseId: createdPromiseId,
            });
          globalThis.__wasmacsRecordSchedulerCheckpoint &&
            globalThis.__wasmacsRecordSchedulerCheckpoint(15, {
              waitId: waitId,
              mode: mode,
              asyncPromiseHandlersPresentAtResolverBound: (typeof Asyncify !== "undefined") ? !!Asyncify.asyncPromiseHandlers : null,
              currDataPresentAtResolverBound: (typeof Asyncify !== "undefined") ? !!Asyncify.currData : null,
            });

          if (typeof self !== "undefined" &&
              typeof self.postMessage === "function" &&
              typeof WorkerGlobalScope !== "undefined" &&
              self instanceof WorkerGlobalScope) {
            self.postMessage({ type: "emacs-waiting" });
          }
          // Drain: if bytes were queued while Emacs was processing (between wait points),
          // resolve immediately now that the new resolver is set.
          var _q = (globalThis.__wasmacsTerminalInputBytes || []).length;
          var _termOut = (globalThis.__wasmacsTerminalOutputBytes || []).length;
          var _t = (typeof performance !== "undefined") ? Math.round(performance.now()) : "?";
          if (_q > 0 && typeof globalThis.__wasmacsResolveHostInputWait === "function") {
            console.log("[host-lib DRAIN] waitId=" + waitId + " inputQueue=" + _q + " termOut=" + _termOut + " t=" + _t + " → resolving immediately");
            globalThis.__wasmacsResolveHostInputWait();
          } else {
            console.log("[host-lib WAIT] waitId=" + waitId + " inputQueue=" + _q + " termOut=" + _termOut + " t=" + _t);
          }
        });
        var thenPromiseId = ++globalThis.__wasmacsPromiseSeq;
        globalThis.__wasmacsWaitPromiseState[waitId].thenPromiseId = thenPromiseId;
        globalThis.__wasmacsWaitPromiseState[waitId].returnedExpressionPromiseId = thenPromiseId;
        var returnedExpression = promise.then(function (value) {
          globalThis.__wasmacsWaitPromiseState[waitId].thenReached = true;
          var asyncifyAtThen = (typeof Asyncify !== "undefined") ? {
            state: Asyncify.state,
            currDataPresent: !!Asyncify.currData,
            asyncPromiseHandlersPresent: !!Asyncify.asyncPromiseHandlers,
          } : null;
          globalThis.__wasmacsRecordSchedulerCheckpoint &&
            globalThis.__wasmacsRecordSchedulerCheckpoint(4, {
              waitId: waitId,
              mode: mode,
              createdPromiseId: createdPromiseId,
              thenPromiseId: thenPromiseId,
              value: value,
            });
          globalThis.__wasmacsRecordSchedulerCheckpoint &&
            globalThis.__wasmacsRecordSchedulerCheckpoint(16, {
              waitId: waitId,
              asyncifyAtThen: asyncifyAtThen,
            });
          return value;
        });
        returnedExpression.__wasmacsPromiseId = thenPromiseId;
        globalThis.__wasmacsRecordSchedulerCheckpoint &&
          globalThis.__wasmacsRecordSchedulerCheckpoint(13, {
            waitId: waitId,
            mode: mode,
            createdPromiseId: createdPromiseId,
            resolverPromiseId: createdPromiseId,
            thenPromiseId: thenPromiseId,
            returnedExpressionPromiseId: thenPromiseId,
            actualReturnedPromiseId: "asyncify-handleAsync",
            asyncifyHandleAsyncOwnsSuspend: true,
            asyncifyStateAtReturning: (typeof Asyncify !== "undefined") ? {
              state: Asyncify.state,
              currDataPresent: !!Asyncify.currData,
              asyncPromiseHandlersPresent: !!Asyncify.asyncPromiseHandlers,
            } : null,
          });
        return returnedExpression;
      });
    }

    return (async function () {
    var createdPromiseId = ++globalThis.__wasmacsPromiseSeq;
    globalThis.__wasmacsWaitPromiseState[waitId] = {
      waitId: waitId,
      mode: mode,
      createdPromiseId: createdPromiseId,
      resolverPromiseId: createdPromiseId,
      resolverCalled: false,
      resolveAfter: false,
      thenReached: false,
      asyncFunctionWrapsReturnExpression: true,
      actualReturnedPromiseId: "unobservable-async-function-wrapper",
    };
    globalThis.__wasmacsRecordSchedulerCheckpoint &&
      globalThis.__wasmacsRecordSchedulerCheckpoint(5, {
        waitId: waitId,
        mode: mode,
        createdPromiseId: createdPromiseId,
      });

    var promise = new Promise((resolve) => {
      // Expose the resolver so the worker/probe can call it when a key is ready.
      globalThis.__wasmacsResolveHostInputWait = function () {
        globalThis.__wasmacsWaitPromiseState[waitId].resolverCalled = true;
        globalThis.__wasmacsRecordSchedulerCheckpoint &&
          globalThis.__wasmacsRecordSchedulerCheckpoint(2, {
            waitId: waitId,
            mode: mode,
            createdPromiseId: createdPromiseId,
            resolverPromiseId: createdPromiseId,
          });
        globalThis.__wasmacsHostWaitForInputPending = false;
        globalThis.__wasmacsResolveHostInputWait    = undefined;
        resolve(0);
        globalThis.__wasmacsWaitPromiseState[waitId].resolveAfter = true;
        globalThis.__wasmacsRecordSchedulerCheckpoint &&
          globalThis.__wasmacsRecordSchedulerCheckpoint(3, {
            waitId: waitId,
            mode: mode,
            createdPromiseId: createdPromiseId,
          });
      };
      globalThis.__wasmacsRecordSchedulerCheckpoint &&
        globalThis.__wasmacsRecordSchedulerCheckpoint(7, {
          waitId: waitId,
          mode: mode,
          createdPromiseId: createdPromiseId,
          resolverPromiseId: createdPromiseId,
        });

      // In a browser Web Worker, notify the main thread that Emacs is waiting.
      if (typeof self !== "undefined" &&
          typeof self.postMessage === "function" &&
          typeof WorkerGlobalScope !== "undefined" &&
          self instanceof WorkerGlobalScope) {
        self.postMessage({ type: "emacs-waiting" });
      }
      // Drain queued bytes immediately if available.
      if ((globalThis.__wasmacsTerminalInputBytes || []).length > 0 &&
          typeof globalThis.__wasmacsResolveHostInputWait === "function") {
        globalThis.__wasmacsResolveHostInputWait();
      }
    });
    var thenPromiseId = ++globalThis.__wasmacsPromiseSeq;
    globalThis.__wasmacsWaitPromiseState[waitId].thenPromiseId = thenPromiseId;
    globalThis.__wasmacsWaitPromiseState[waitId].returnedExpressionPromiseId = thenPromiseId;
    var returnedExpression = promise.then(function (value) {
      globalThis.__wasmacsWaitPromiseState[waitId].thenReached = true;
      globalThis.__wasmacsRecordSchedulerCheckpoint &&
        globalThis.__wasmacsRecordSchedulerCheckpoint(4, {
          waitId: waitId,
          mode: mode,
          createdPromiseId: createdPromiseId,
          thenPromiseId: thenPromiseId,
          value: value,
        });
      return value;
    });
    returnedExpression.__wasmacsPromiseId = thenPromiseId;
    globalThis.__wasmacsRecordSchedulerCheckpoint &&
      globalThis.__wasmacsRecordSchedulerCheckpoint(6, {
        waitId: waitId,
        mode: mode,
        createdPromiseId: createdPromiseId,
        resolverPromiseId: createdPromiseId,
        thenPromiseId: thenPromiseId,
        returnedExpressionPromiseId: thenPromiseId,
        actualReturnedPromiseId: "unobservable-async-function-wrapper",
        asyncFunctionWrapsReturnExpression: true,
      });
    return returnedExpression;
    })();
  },

  wasmacs_host_scheduler_checkpoint__deps: ["$wasmacs_terminal"],
  wasmacs_host_scheduler_checkpoint: function (code) {
    globalThis.__wasmacsRecordSchedulerCheckpoint &&
      globalThis.__wasmacsRecordSchedulerCheckpoint(code);
    return 0;
  },
});
