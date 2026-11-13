/*
 * wasmacs-child-pre.js -- --pre-js of every program that runs as a process
 * under the wasmacs kernel (src/runtime/process/wasmacs-kernel.js).
 *
 * A process is created synchronously, inside the Emacs worker, while Emacs is
 * blocked in a system call; nothing asynchronous can ever complete there.
 * Emscripten 5.0.7 has no supported way to instantiate synchronously from an
 * already compiled WebAssembly.Module:
 *   - Module.instantiateWasm makes createWasm() return a Promise even with
 *     -sWASM_ASYNC_COMPILATION=0;
 *   - Module.wasmBinary recompiles the module for every instance.
 * So the internal, hoisted instantiateSync() (it only exists with
 * -sWASM_ASYNC_COMPILATION=0) is replaced.  It runs once per instance, from
 * createWasm(), while the MODULARIZE factory is still executing synchronously.
 */
if (Module['wasmacsWasmModule']) {
  if (typeof instantiateSync != 'function') {
    throw new Error('wasmacs-child-pre.js: instantiateSync() not found; build with -sWASM_ASYNC_COMPILATION=0');
  }
  instantiateSync = (file, info) => {
    var mod = Module['wasmacsWasmModule'];
    // longjmp support: keep the stack pointer of invoke_* frames correct across
    // an Asyncify unwind/rewind (see WK.wrapInvokes in wasmacs-child-library.js).
    WK.wrapInvokes(info);
    var instance;
    try {
      instance = new WebAssembly.Instance(mod, info);
    } catch (e) {
      // The factory is an async function: the exception only rejects its
      // promise.  Leave the reason where the kernel can read it right away
      // (typically "out of memory": every process has its own wasm memory).
      Module['wasmacsInitError'] = e;
      throw e;
    }
    WK.raw = instance.exports;
    // Static constructors are not run from JS (initRuntime): wasmacs_rt_start()
    // runs them inside the process, under the scheduler, and a fork()ed child
    // must not run them at all (it inherits the parent's memory).
    var exports = Object.assign({}, instance.exports);
    exports['__wasm_call_ctors'] = () => {};
    return [{ 'exports': exports }, mod];
  };
}
