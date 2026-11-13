/*
 * wasmacs-child-library.js -- child-side half of the wasmacs process kernel
 * (Emscripten JS library).  Every program that runs as a process is linked
 * with:
 *
 *   --js-library wasmacs-child-library.js --pre-js wasmacs-child-pre.js
 *   wasmacs-child-rt.c
 *   -sASYNCIFY=1 -sMODULARIZE=1 -sWASM_ASYNC_COMPILATION=0 -sINVOKE_RUN=0 -sEXIT_RUNTIME=1
 *
 * It provides
 *   - the shared filesystem: the program's FS *is* the kernel's FS object
 *     (Emacs's Emscripten FS).  The kernel swaps the fd table (FS.streams) and
 *     the cwd (FS.currentPath) at every context switch.
 *   - $WK: start / suspend / resume / cloneFrom for ONE program instance.
 *     This is the only code that touches Emscripten's Asyncify internals
 *     (src/lib/libasync.js).
 *   - the wasm imports that enter the kernel
 *     (src/runtime/process/wasmacs-kernel.js).  The ones that can block are
 *     marked __async so that emcc adds them to ASYNCIFY_IMPORTS.
 *
 * Blocking-syscall protocol ("restartable system calls"):
 *   import called  -> kernel.sys_xxx() returns/throws a BlockRequest
 *                  -> WK.suspend(): asyncify_start_unwind(), import returns
 *                  -> wasm unwinds to the scheduler (kernel)
 *   scheduler      -> later WK.resume(): asyncify_start_rewind() and re-enter
 *                     the entry export; wasm replays down to the SAME import
 *   import called  -> state is Rewinding: asyncify_stop_rewind(), then the
 *      (again)        system call is simply issued again.
 * A system call therefore must not have side effects before it blocks.
 */

// Emscripten's own implementations of the system calls we wrap.  They are
// re-registered under private names so that the wrappers can call them.
var wasmacsOrigSyscalls = {};
for (const name of ['__syscall_openat', '__syscall_dup', '__syscall_dup3', '__syscall_fcntl64',
                    '__syscall_stat64', '__syscall_lstat64', '__syscall_newfstatat', '__syscall_getdents64']) {
  wasmacsOrigSyscalls[`$wasmacs_orig${name}`] = LibraryManager.library[name];
  wasmacsOrigSyscalls[`$wasmacs_orig${name}__deps`] = LibraryManager.library[`${name}__deps`] || [];
}
addToLibrary(wasmacsOrigSyscalls);

addToLibrary({
  // ======================= shared filesystem ==============================
  // No private FS: no FS.staticInit(), no FS.init() (standard streams come
  // from the kernel's fd table), no FS.quit() at exit.
  $FS__postset: '',
  $FS: "=Module['wasmacsFS']",

  // ======================= instance control ===============================
  $WK__deps: ['$Asyncify', '$stackSave', '$stackRestore', '$stackAlloc', '$stringToUTF8OnStack',
              '$UTF8ToString', '$runtimeKeepalivePush', '$runtimeKeepalivePop', '$ExitStatus',
              '$FS', '$SYSCALLS',
              'emscripten_stack_get_base', 'emscripten_stack_get_end',
              'emscripten_stack_set_limits', 'malloc',
              'wasmacs_rt_start', 'wasmacs_rt_sig_disposition', 'wasmacs_rt_deliver_signal'],
  $WK__postset: 'WK.init();',
  $WK: {
    kernel: null,       // the kernel (wasmacs-kernel.js)
    proc: null,         // this instance's Process
    env: [],            // "K=V" strings handed to environ_get()
    raw: null,          // un-instrumented wasm exports (set by wasmacs-child-pre.js)
    dataPtr: 0,         // persistent Asyncify data buffer (one suspension at a time)
    invokeSps: [],      // stack pointers of invoke_* frames of the suspended stack
    inHandler: 0,       // > 0 while a signal handler runs on top of a system call

    init() {
      WK.kernel = Module['wasmacsKernel'];
      WK.proc = Module['wasmacsProc'];
      WK.env = Module['wasmacsEnv'] || [];
      Module['wasmacs'] = WK;
    },

    // ---- accessors used by the kernel -------------------------------------
    views() { return { HEAPU8, HEAP8, HEAP32, HEAPU32, HEAP16 }; },
    readStr(ptr) { return UTF8ToString(ptr); },
    readStrArray(ptr) {
      var out = [];
      if (!ptr) return out;
      for (;;) {
        var s = {{{ makeGetValue('ptr', 0, '*') }}};
        if (!s) break;
        out.push(UTF8ToString(s));
        ptr += {{{ POINTER_SIZE }}};
      }
      return out;
    },
    memoryBytes() { return HEAPU8.length; },
    getUmask() { return SYSCALLS.umask; },
    setUmask(mask) { SYSCALLS.umask = mask; },
    // 'default' | 'ignore' | 'handler'
    sigDisposition(sig) {
      return ['default', 'ignore', 'handler'][_wasmacs_rt_sig_disposition(sig)] || 'default';
    },
    // Run the handlers of the signals that became pending for this process.
    // Called on top of the system call the process is in (like a real signal
    // interrupting a system call).  A handler may longjmp out of here.
    runSignalHandlers() {
      var p = WK.proc;
      while (p.sigPending.size) {
        var sig = p.sigPending.values().next().value;
        p.sigPending.delete(sig);
        WK.inHandler++;
        try {
          _wasmacs_rt_deliver_signal(sig);
        } finally {
          WK.inHandler--;
        }
      }
    },

    // ---- running ----------------------------------------------------------
    // Call into wasm and classify how control came back to the scheduler.
    enter(fn) {
      var k = WK.kernel;
      try {
        fn();
      } catch (e) {
        if (e === k.EXEC) return { kind: 'exec' };
        if (e === k.KILLED) return { kind: 'killed' };
        if (e instanceof ExitStatus) return { kind: 'exit', status: e.status };
        return { kind: 'crash', error: e };
      }
      if (Asyncify.currData) {
        // Fully unwound: Asyncify.maybeStopUnwind() already ran
        // asyncify_stop_unwind() when the outermost export returned.
        return { kind: 'blocked' };
      }
      return { kind: 'returned' };
    },
    // First entry of a fresh image: argv goes on the C stack (like callMain),
    // then wasmacs_rt_start() runs the constructors, main() and exit().
    start(argv) {
      var argc = argv.length;
      var argvPtr = stackAlloc((argc + 1) * {{{ POINTER_SIZE }}});
      for (var i = 0; i < argc; i++) {
        {{{ makeSetValue('argvPtr', 'i * ' + POINTER_SIZE, 'stringToUTF8OnStack(argv[i])', '*') }}};
      }
      {{{ makeSetValue('argvPtr', 'argc * ' + POINTER_SIZE, 0, '*') }}};
      return WK.enter(() => _wasmacs_rt_start(argc, argvPtr));
    },
    // Called from an __async import: begin unwinding to the scheduler.
    suspend() {
      var A = Asyncify;
#if ASSERTIONS
      assert(A.state === A.State.Normal, 'WK.suspend: bad asyncify state ' + A.state);
      assert(!A.currData, 'WK.suspend: nested suspension is not supported');
#endif
      if (!WK.dataPtr) {
        WK.dataPtr = _malloc({{{ C_STRUCTS.asyncify_data_s.__size__ }}} + A.StackSize);
      }
      A.setDataHeader(WK.dataPtr, WK.dataPtr + {{{ C_STRUCTS.asyncify_data_s.__size__ }}}, A.StackSize);
      A.setDataRewindFunc(WK.dataPtr);     // remembers exportCallStack[0] == wasmacs_rt_start
      A.currData = WK.dataPtr;
      A.state = A.State.Unwinding;
      _asyncify_start_unwind(WK.dataPtr);
    },
    // Called by the scheduler: rewind the suspended stack.
    resume() {
      var A = Asyncify;
#if ASSERTIONS
      assert(A.currData, 'WK.resume: not suspended');
      assert(A.exportCallStack.length === 0, 'WK.resume: wasm frames of this instance are on the stack');
#endif
      A.state = A.State.Rewinding;
      _asyncify_start_rewind(A.currData);
      var entry = A.funcWrappers.get(A.getDataRewindFunc(A.currData));
      runtimeKeepalivePop();               // balances maybeStopUnwind()'s push
      return WK.enter(() => entry());
    },
    // Wrapper used by every kernel-entering import.
    // EINTR_RESULT is what the import returns when a signal handler interrupted
    // the blocked call (-EINTR for __syscall_*, +EINTR for WASI fd_* calls).
    sys(f, eintrResult) {
      var A = Asyncify, k = WK.kernel, p = WK.proc;
      if (A.state === A.State.Rewinding) {
        // We are the import the stack was suspended in: the rewind is complete.
        A.state = A.State.Normal;
        _asyncify_stop_rewind();
        A.currData = null;
      }
      // Signals that arrived while this process was not running.
      if (p.sigPending.size && !WK.inHandler) {
        WK.runSignalHandlers();
        if (p.eintr) {
          p.eintr = false;
          k.cancelRestart(p);
          return eintrResult;
        }
      }
      p.eintr = false;
      var r;
      try {
        r = f(k, p);
      } catch (e) {
        if (!(e instanceof k.BlockRequest)) throw e;
        r = e;
      }
      if (r instanceof k.BlockRequest) {
        if (WK.inHandler) {
          // A signal handler cannot be suspended (there is a JS frame between
          // it and the interrupted system call).
          k.cancelRestart(p);
          return eintrResult;
        }
        k.block(p, r);
        WK.suspend();
        return 0;
      }
      return r;
    },

    // ---- fork(): become a copy of the (fully unwound) parent instance -------
    cloneFrom(pk) {
      var A = Asyncify, PA = pk.asyncify();
      if (PA.exportCallStack.length !== 0 || !PA.currData || PA.state !== PA.State.Normal) {
        throw new Error('WK.cloneFrom: parent is not suspended');
      }
      // 1. linear memory (the whole thing: data, heap, C stack, Asyncify buffer)
      var src = pk.views().HEAPU8;
      if (src.length > HEAPU8.length) {
        wasmMemory.grow((src.length - HEAPU8.length) >>> 16);
        updateMemoryViews();
      }
      HEAPU8.set(src);
      // 2. mutable wasm globals
      var regs = pk.regs();
      _emscripten_stack_set_limits(regs.stackBase, regs.stackEnd);  // __stack_base, __stack_end
      stackRestore(regs.sp);                                        // __stack_pointer
      if (WK.raw['_emscripten_tempret_set'] && regs.tempRet0 !== undefined) {
        WK.raw['_emscripten_tempret_set'](regs.tempRet0);           // tempRet0
      }
      //    __asyncify_state / __asyncify_data: both instances are in state 0
      //    (normal) here; resume() sets them through asyncify_start_rewind().
      // 3. Asyncify JS bookkeeping.  The rewind id stored in the data header
      //    maps to an export FUNCTION OBJECT of the parent; translate it to the
      //    same export of this instance by export name.
      var praw = pk.raw;
      for (var [pfunc, id] of PA.callstackFuncToId) {
        var name = null;
        for (var n in praw) { if (praw[n] === pfunc) { name = n; break; } }
        if (name === null) throw new Error('WK.cloneFrom: cannot map rewind function');
        var mine = WK.raw[name];
        A.callstackFuncToId.set(mine, id);
        A.callStackIdToFunc.set(id, mine);
      }
      A.callStackId = PA.callStackId;
      A.currData = PA.currData;            // same address: memory was copied
      A.handleSleepReturnValue = PA.handleSleepReturnValue;
      A.state = A.State.Normal;
      // 4. remaining per-instance JS state
      WK.dataPtr = pk.dataPtr;
      WK.invokeSps = pk.invokeSps.slice();
      SYSCALLS.umask = pk.getUmask();
      runtimeKeepalivePush();              // parent's maybeStopUnwind() pushed once
    },
    asyncify() { return Asyncify; },
    // Every mutable wasm global that is reachable through exports.
    regs() {
      var r = {
        sp: stackSave(),
        stackBase: _emscripten_stack_get_base(),
        stackEnd: _emscripten_stack_get_end(),
      };
      if (WK.raw['_emscripten_tempret_get']) r.tempRet0 = WK.raw['_emscripten_tempret_get']();
      return r;
    },

    // ---- setjmp/longjmp support --------------------------------------------
    // Emscripten's invoke_* wrappers do
    //   var sp = stackSave(); try { call } catch (e) { stackRestore(sp); ... }
    // When such a frame is re-created by a rewind, stackSave() returns the
    // stack pointer of the suspension point instead of the caller's, so a later
    // longjmp() leaves __stack_pointer too low.  Remember the correct value
    // per frame across unwind/rewind (and across fork, see cloneFrom).
    // IMPORTS is the wasm import object ({ env: {...}, wasi_snapshot_preview1:
    // {...} }).  The import keys may be minified (-Os/-Oz links), so the
    // invoke_* wrappers are recognised by their JS function name.
    wrapInvokes(imports) {
      for (var mod of Object.values(imports)) {
        if (!mod || typeof mod !== 'object') continue;
        for (var key of Object.keys(mod)) {
          var f = mod[key];
          if (typeof f === 'function' && typeof f.name === 'string' && f.name.startsWith('invoke_')) {
            mod[key] = WK.wrapInvoke(f);
          }
        }
      }
    },
    wrapInvoke(orig) {
      return function(...args) {
        var A = Asyncify;
        var sp = A.state === A.State.Rewinding ? WK.invokeSps.pop() : stackSave();
        var r = orig(...args);
        if (A.state === A.State.Unwinding) {
          WK.invokeSps.push(sp);           // innermost frame is pushed first
          return r;
        }
        stackRestore(sp);                  // no-op unless a longjmp was caught
        return r;
      };
    },
  },

  // ======================= process system calls ===========================
  wasmacs_k_fork__deps: ['$WK'],
  wasmacs_k_fork__async: true,
  wasmacs_k_fork: () => WK.sys((k, p) => k.sys_fork(p, false), -{{{ cDefs.EINTR }}}),

  wasmacs_k_vfork__deps: ['$WK'],
  wasmacs_k_vfork__async: true,
  wasmacs_k_vfork: () => WK.sys((k, p) => k.sys_fork(p, true), -{{{ cDefs.EINTR }}}),

  // Not async: either fails (-errno) or throws kernel.EXEC through the wasm
  // frames of the image that is being replaced.
  wasmacs_k_execve__deps: ['$WK'],
  wasmacs_k_execve: (path, argv, envp) => WK.kernel.sys_execve(WK.proc, path, argv, envp),

  wasmacs_k_spawn__deps: ['$WK'],
  wasmacs_k_spawn: (pidPtr, path, ops, nops, argv, envp, searchPath, flags, pgroup) =>
    WK.kernel.sys_spawn(WK.proc, pidPtr, path, ops, nops, argv, envp, searchPath, flags, pgroup),

  wasmacs_k_wait4__deps: ['$WK'],
  wasmacs_k_wait4__async: true,
  wasmacs_k_wait4: (pid, wstatus, options, rusage) =>
    WK.sys((k, p) => k.sys_wait4(p, pid, wstatus, options), -{{{ cDefs.EINTR }}}),

  wasmacs_k_sleep__deps: ['$WK'],
  wasmacs_k_sleep__async: true,
  wasmacs_k_sleep: (msLo, msHi) =>
    WK.sys((k, p) => k.sys_sleep(p, (msLo >>> 0) + msHi * 4294967296), -{{{ cDefs.EINTR }}}),

  wasmacs_k_pause__deps: ['$WK'],
  wasmacs_k_pause__async: true,
  wasmacs_k_pause: () => WK.sys((k, p) => k.sys_pause(p), -{{{ cDefs.EINTR }}}),

  wasmacs_k_getpid__deps: ['$WK'],
  wasmacs_k_getpid: () => WK.proc.pid,
  wasmacs_k_getppid__deps: ['$WK'],
  wasmacs_k_getppid: () => WK.proc.ppid,
  wasmacs_k_getpgid__deps: ['$WK'],
  wasmacs_k_getpgid: (pid) => WK.kernel.sys_getpgid(WK.proc, pid),
  wasmacs_k_setpgid__deps: ['$WK'],
  wasmacs_k_setpgid: (pid, pgid) => WK.kernel.sys_setpgid(WK.proc, pid, pgid),
  wasmacs_k_getsid__deps: ['$WK'],
  wasmacs_k_getsid: (pid) => WK.kernel.sys_getsid(WK.proc, pid),
  wasmacs_k_setsid__deps: ['$WK'],
  wasmacs_k_setsid: () => WK.kernel.sys_setsid(WK.proc),

  wasmacs_k_kill__deps: ['$WK'],
  wasmacs_k_kill: (pid, sig) => {
    var r = WK.kernel.sys_kill(WK.proc, pid, sig);
    // A signal sent to ourselves with a handler installed is delivered now.
    if (r === 0 && WK.proc.sigPending.size && !WK.inHandler) {
      WK.runSignalHandlers();
      WK.proc.eintr = false;
    }
    return r;
  },

  // ======================= overrides of Emscripten system calls ============
  proc_exit__deps: ['$WK', '$ExitStatus'],
  proc_exit: (code) => {
    WK.kernel.sys_exit(WK.proc, code);
    throw new ExitStatus(code);
  },

  environ_sizes_get__deps: ['$WK', '$lengthBytesUTF8'],
  environ_sizes_get: (penviron_count, penviron_buf_size) => {
    var bufSize = 0;
    for (var s of WK.env) bufSize += lengthBytesUTF8(s) + 1;
    {{{ makeSetValue('penviron_count', 0, 'WK.env.length', SIZE_TYPE) }}};
    {{{ makeSetValue('penviron_buf_size', 0, 'bufSize', SIZE_TYPE) }}};
    return 0;
  },
  environ_get__deps: ['$WK', '$stringToUTF8'],
  environ_get: (__environ, environ_buf) => {
    var bufSize = 0, envp = 0;
    for (var s of WK.env) {
      var ptr = environ_buf + bufSize;
      {{{ makeSetValue('__environ', 'envp', 'ptr', '*') }}};
      bufSize += stringToUTF8(s, ptr, Infinity) + 1;
      envp += {{{ POINTER_SIZE }}};
    }
    return 0;
  },

  // read()/write(): the shared FS does the work; a pipe that would block
  // throws a BlockRequest, which suspends the process unless part of the
  // request was already transferred.
  fd_read__deps: ['$WK', '$FS', '$SYSCALLS'],
  fd_read__async: true,
  fd_read: (fd, iov, iovcnt, pnum) => WK.sys((k, p) => {
    var pre = k.preempt(p);
    if (pre) return pre;
    try {
      var stream = SYSCALLS.getStreamFromFD(fd);
      var ret = 0;
      for (var i = 0; i < iovcnt; i++) {
        var ptr = {{{ makeGetValue('iov', C_STRUCTS.iovec.iov_base, '*') }}};
        var len = {{{ makeGetValue('iov', C_STRUCTS.iovec.iov_len, '*') }}};
        iov += {{{ C_STRUCTS.iovec.__size__ }}};
        var curr;
        try {
          curr = FS.read(stream, HEAP8, ptr, len);
        } catch (e) {
          if (e instanceof k.BlockRequest && ret > 0) break;
          throw e;
        }
        if (curr < 0) return {{{ cDefs.EIO }}};
        ret += curr;
        if (curr < len) break; // nothing more to read
      }
      {{{ makeSetValue('pnum', 0, 'ret', SIZE_TYPE) }}};
      return 0;
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
      return e.errno;
    }
  }, {{{ cDefs.EINTR }}}),

  fd_write__deps: ['$WK', '$FS', '$SYSCALLS'],
  fd_write__postset: '',
  fd_write__async: true,
  fd_write: (fd, iov, iovcnt, pnum) => WK.sys((k, p) => {
    var pre = k.preempt(p);
    if (pre) return pre;
    try {
      var stream = SYSCALLS.getStreamFromFD(fd);
      var ret = 0;
      for (var i = 0; i < iovcnt; i++) {
        var ptr = {{{ makeGetValue('iov', C_STRUCTS.iovec.iov_base, '*') }}};
        var len = {{{ makeGetValue('iov', C_STRUCTS.iovec.iov_len, '*') }}};
        iov += {{{ C_STRUCTS.iovec.__size__ }}};
        if (!len) continue;
        var curr;
        try {
          curr = FS.write(stream, HEAP8, ptr, len);
        } catch (e) {
          if (e instanceof k.BlockRequest && ret > 0) break;
          throw e;
        }
        if (curr < 0) return {{{ cDefs.EIO }}};
        ret += curr;
        if (curr < len) break; // no more space to write
      }
      {{{ makeSetValue('pnum', 0, 'ret', SIZE_TYPE) }}};
      return 0;
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
      return e.errno;
    }
  }, {{{ cDefs.EINTR }}}),

  __syscall_pipe2__deps: ['$WK'],
  __syscall_pipe2: (fdPtr, flags) => WK.kernel.sys_pipe2(WK.proc, fdPtr, flags),

  // Emscripten's fsync is promise based under Asyncify ("__async: 'auto'");
  // no promise ever resolves inside the Emacs worker.  The shared FS is
  // in-memory, so there is nothing to flush.
  fd_sync__deps: ['$SYSCALLS', '$FS'],
  fd_sync__async: false,
  fd_sync: (fd) => {
    try {
      SYSCALLS.getStreamFromFD(fd);
      return 0;
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
      return e.errno;
    }
  },

  __syscall_poll__deps: ['$WK'],
  __syscall_poll__async: true,
  __syscall_poll: (fds, nfds, timeout) =>
    WK.sys((k, p) => k.sys_poll(p, fds, nfds, timeout), -{{{ cDefs.EINTR }}}),

  // ---- FD_CLOEXEC ----------------------------------------------------------
  // Emscripten ignores close-on-exec ("makes no sense for a single process").
  // It is tracked per descriptor in stream.cloexec and honoured by exec/spawn.
  __syscall_openat__deps: ['$WK', '$FS', '$wasmacs_orig__syscall_openat'],
  __syscall_openat__async: true,
  __syscall_openat: (dirfd, path, flags, varargs) => WK.sys((k, p) => {
    var pre = k.preempt(p);
    if (pre) return pre;
    var fd = wasmacs_orig__syscall_openat(dirfd, path, flags, varargs);
    if (fd >= 0) FS.getStream(fd).cloexec = !!(flags & {{{ cDefs.O_CLOEXEC }}});
    return fd;
  }, -{{{ cDefs.EINTR }}}),

  __syscall_dup__deps: ['$WK', '$FS', '$wasmacs_orig__syscall_dup'],
  __syscall_dup: (fd) => {
    var newfd = wasmacs_orig__syscall_dup(fd);
    if (newfd >= 0) FS.getStream(newfd).cloexec = false;
    return newfd;
  },

  __syscall_dup3__deps: ['$WK', '$FS', '$wasmacs_orig__syscall_dup3'],
  __syscall_dup3: (fd, newfd, flags) => {
    var r = wasmacs_orig__syscall_dup3(fd, newfd, flags);
    if (r >= 0) {
      var stream = FS.getStream(r);
      stream.cloexec = !!(flags & {{{ cDefs.O_CLOEXEC }}});
      // Emscripten stores O_CLOEXEC in the (shared) status flags; undo that.
      stream.flags &= ~{{{ cDefs.O_CLOEXEC }}};
    }
    return r;
  },

  __syscall_fcntl64__deps: ['$WK', '$FS', '$SYSCALLS', '$wasmacs_orig__syscall_fcntl64'],
  __syscall_fcntl64: (fd, cmd, varargs) => {
    var stream = FS.getStream(fd);
    if (!stream) return -{{{ cDefs.EBADF }}};
    var arg = varargs ? {{{ makeGetValue('varargs', 0, 'i32') }}} : 0;
    switch (cmd) {
      case {{{ cDefs.F_GETFD }}}:
        return stream.cloexec ? 1 : 0;
      case {{{ cDefs.F_SETFD }}}:
        stream.cloexec = !!(arg & 1);
        return 0;
      case {{{ cDefs.F_DUPFD }}}:
      case 1030: { // F_DUPFD_CLOEXEC
        if (arg < 0) return -{{{ cDefs.EINVAL }}};
        while (FS.streams[arg]) arg++;
        var newStream = FS.dupStream(stream, arg);
        newStream.cloexec = cmd === 1030;
        return newStream.fd;
      }
    }
    return wasmacs_orig__syscall_fcntl64(fd, cmd, varargs);
  },

  // ---- preemption points ---------------------------------------------------
  // A process that never blocks would keep Emacs from running.  These hot,
  // side-effect free calls are scheduling points: when the time slice is used
  // up the process yields before doing the call.
  __syscall_stat64__deps: ['$WK', '$wasmacs_orig__syscall_stat64'],
  __syscall_stat64__async: true,
  __syscall_stat64: (path, buf) => WK.sys((k, p) =>
    k.preempt(p) || wasmacs_orig__syscall_stat64(path, buf), -{{{ cDefs.EINTR }}}),

  __syscall_lstat64__deps: ['$WK', '$wasmacs_orig__syscall_lstat64'],
  __syscall_lstat64__async: true,
  __syscall_lstat64: (path, buf) => WK.sys((k, p) =>
    k.preempt(p) || wasmacs_orig__syscall_lstat64(path, buf), -{{{ cDefs.EINTR }}}),

  __syscall_newfstatat__deps: ['$WK', '$wasmacs_orig__syscall_newfstatat'],
  __syscall_newfstatat__async: true,
  __syscall_newfstatat: (dirfd, path, buf, flags) => WK.sys((k, p) =>
    k.preempt(p) || wasmacs_orig__syscall_newfstatat(dirfd, path, buf, flags), -{{{ cDefs.EINTR }}}),

  __syscall_getdents64__deps: ['$WK', '$wasmacs_orig__syscall_getdents64'],
  __syscall_getdents64__async: true,
  __syscall_getdents64: (fd, dirp, count) => WK.sys((k, p) =>
    k.preempt(p) || wasmacs_orig__syscall_getdents64(fd, dirp, count), -{{{ cDefs.EINTR }}}),

  // HTTP(S) for Git's remote helper. The kernel starts the page-owned request
  // once and unwinds this import while it is pending. Output pointers belong
  // to THIS instance's heap and are freed by the caller, including on error.
  // out: six wasm32 words: status, headers ptr/len, body ptr/len, final URL ptr.
  wasmacs_host_http_fetch__deps: ['$WK', '$UTF8ToString', 'malloc', 'free'],
  wasmacs_host_http_fetch__async: true,
  wasmacs_host_http_fetch: (url, method, headers, body, bodyLen, out) => WK.sys((k, p) => {
    var maxBytes = 25 * 1024 * 1024;
    HEAPU8.fill(0, out, out + 24);
    if (bodyLen < 0 || bodyLen > maxBytes) return 1;
    var response = k.sys_http_fetch(p, () => {
      var pairs = [];
      for (var line of UTF8ToString(headers).split(/\r?\n/)) {
        var colon = line.indexOf(':');
        if (colon > 0) pairs.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
      }
      var binary = '';
      for (var i = 0; i < bodyLen; i += 16384) {
        binary += String.fromCharCode.apply(null, HEAPU8.subarray(body + i, body + Math.min(bodyLen, i + 16384)));
      }
      return { url: UTF8ToString(url), method: UTF8ToString(method), headers: pairs,
               bodyBase64: bodyLen ? btoa(binary) : '', processHttp: true };
    });
    if (response instanceof k.BlockRequest) return response;
    var allocated = [];
    function put(bytes) {
      var ptr = _malloc(bytes.length + 1);
      if (!ptr) throw new Error('out of memory');
      allocated.push(ptr);
      HEAPU8.set(bytes, ptr);
      HEAPU8[ptr + bytes.length] = 0;
      return ptr;
    }
    try {
      var encoder = new TextEncoder();
      if (response.error) {
        var diagnostic = encoder.encode(String(response.error));
        var dp = put(diagnostic);
        HEAP32[(out + 4) >> 2] = dp;
        HEAP32[(out + 8) >> 2] = diagnostic.length;
        return 1;
      }
      if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) return 1;
      var hpairs = Array.isArray(response.headers) ? response.headers : Object.entries(response.headers || {});
      var headerBytes = encoder.encode(hpairs.map((h) =>
        (Array.isArray(h) ? h[0] : h.name) + ': ' + (Array.isArray(h) ? h[1] : h.value) + '\r\n').join(''));
      var encoded = response.bodyBase64 || '';
      if (encoded.length > Math.ceil(maxBytes / 3) * 4 || headerBytes.length > 128 * 1024) return 1;
      var raw = atob(encoded);
      if (raw.length > maxBytes) return 1;
      var bytes = new Uint8Array(raw.length);
      for (var j = 0; j < raw.length; j++) bytes[j] = raw.charCodeAt(j);
      var hp = put(headerBytes), bp = put(bytes), up = put(encoder.encode(response.url || UTF8ToString(url)));
      HEAP32[out >> 2] = response.status;
      HEAP32[(out + 4) >> 2] = hp;
      HEAP32[(out + 8) >> 2] = headerBytes.length;
      HEAP32[(out + 12) >> 2] = bp;
      HEAP32[(out + 16) >> 2] = bytes.length;
      HEAP32[(out + 20) >> 2] = up;
      return 0;
    } catch (_) {
      for (var ptr of allocated) _free(ptr);
      HEAPU8.fill(0, out, out + 24);
      return 1;
    }
  }, 1),

  // ---- sockets -------------------------------------------------------------
  // There is no network stack: socket() fails with EAFNOSUPPORT.  Emscripten's
  // SOCKFS (a WebSocket emulation that needs the event loop) must not even be
  // linked in: it mounts itself in the filesystem when the program starts,
  // and the filesystem is the shared one, so every process would leave a
  // mount behind that keeps its whole instance and memory alive.
  $getSocketFromFD__deps: ['$FS'],
  $getSocketFromFD: (fd) => {
    FS.getStreamChecked(fd); // EBADF for a descriptor that is not open
    throw new FS.ErrnoError({{{ cDefs.ENOTSOCK }}});
  },
  __syscall_socket__deps: [],
  __syscall_socket: (domain, type, protocol) => -{{{ cDefs.EAFNOSUPPORT }}},

  // ---- mmap ----------------------------------------------------------------
  // The shared FS lives in Emacs's JS closure: its mmap stream op would
  // allocate in, and copy into, Emacs's heap.  Map files by reading them into
  // this process's own memory instead (private mappings; shared mappings are
  // written back by msync/munmap).
  _mmap_js__deps: ['$WK', '$FS', '$SYSCALLS', '$mmapAlloc', 'emscripten_builtin_memalign'],
  _mmap_js: (len, prot, flags, fd, offset, allocated, addr) => {
    try {
      var stream = SYSCALLS.getStreamFromFD(fd);
      if ((stream.flags & {{{ cDefs.O_ACCMODE }}}) === {{{ cDefs.O_WRONLY }}}) return -{{{ cDefs.EACCES }}};
      var ptr = mmapAlloc(len);
      if (!ptr) return -{{{ cDefs.ENOMEM }}};
      var pos = Number(offset);
      var done = 0;
      while (done < len) {
        var n = stream.stream_ops.read ? stream.stream_ops.read(stream, HEAP8, ptr + done, len - done, pos + done) : 0;
        if (!(n > 0)) break;
        done += n;
      }
      {{{ makeSetValue('allocated', 0, 1, 'i32') }}};
      {{{ makeSetValue('addr', 0, 'ptr', '*') }}};
      return 0;
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
      return -e.errno;
    }
  },
  _munmap_js__deps: ['$WK', '$FS', '$SYSCALLS'],
  _munmap_js: (addr, len, prot, flags, fd, offset) => {
    try {
      var stream = SYSCALLS.getStreamFromFD(fd);
      if ((prot & {{{ cDefs.PROT_WRITE }}}) && (flags & 1 /* MAP_SHARED */) && stream.stream_ops.write) {
        stream.stream_ops.write(stream, HEAP8, addr, len, Number(offset));
      }
      return 0;
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
      return -e.errno;
    }
  },
  _msync_js__deps: ['$WK', '$FS', '$SYSCALLS'],
  _msync_js: (addr, len, prot, flags, fd, offset) => {
    try {
      var stream = SYSCALLS.getStreamFromFD(fd);
      if ((flags & 1 /* MAP_SHARED */) && stream.stream_ops.write) {
        stream.stream_ops.write(stream, HEAP8, addr, len, Number(offset));
      }
      return 0;
    } catch (e) {
      if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
      return -e.errno;
    }
  },
});
