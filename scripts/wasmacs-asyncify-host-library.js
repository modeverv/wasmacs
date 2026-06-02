mergeInto(LibraryManager.library, {
  $wasmacs_asyncify_env__deps: ["$ENV"],
  $wasmacs_asyncify_env__postset: [
    "ENV.TERM = ENV.TERM || 'dumb';",
    "ENV.TERMCAP = ENV.TERMCAP || 'dumb:co#80:li#24:cl=\\\\E[H\\\\E[2J:cm=\\\\E[%i%d;%dH:up=\\\\E[A:do=\\\\E[B:nd=\\\\E[C:bs:';",
    "ENV.HOME = ENV.HOME || '/home/user';",
    "ENV.USER = ENV.USER || 'wasmacs';",
    "ENV.LOGNAME = ENV.LOGNAME || 'wasmacs';",
  ].join("\n"),
  $wasmacs_asyncify_env: {},

  wasmacs_host_wait_for_input__deps: ["$wasmacs_asyncify_env"],
  wasmacs_host_wait_for_input: async function () {
    globalThis.__wasmacsHostWaitForInputCount =
      (globalThis.__wasmacsHostWaitForInputCount || 0) + 1;
    globalThis.__wasmacsHostWaitForInputPending = true;
    console.log("WASMACS_HOST_WAIT_FOR_INPUT");
    return new Promise((resolve) => {
      globalThis.__wasmacsResolveHostInputWait = () => {
        globalThis.__wasmacsHostWaitForInputPending = false;
        globalThis.__wasmacsResolveHostInputWait = undefined;
        resolve(0);
      };
    });
  },
});
