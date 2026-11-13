/*
 * wasmacs-kernel.js -- the wasmacs Process Service.
 *
 * A small cooperative UNIX-like kernel that lets Emacs (wasm, not asyncified)
 * start and talk to subprocesses.  There are no host processes and no extra
 * threads involved:
 *
 *   - Emacs is pid 1.  It never returns to the worker's event loop, so nothing
 *     in here may rely on promises, timers or messages.  Everything is plain
 *     synchronous JS that runs inside one of Emacs's system calls.
 *   - A process is another Emscripten program instantiated in the same thread:
 *     its own WebAssembly.Instance and linear memory, built with -sASYNCIFY=1.
 *     A system call that has to wait (read on an empty pipe, waitpid, sleep,
 *     fork ...) unwinds the process back into the scheduler below; it is rewound
 *     when the reason for waiting is gone.
 *   - Emacs's system calls are the scheduling points: the idle keyboard wait,
 *     select/poll, blocking pipe reads, waitpid and kill all run the scheduler.
 *   - There is ONE filesystem: Emacs's Emscripten FS object.  Every process
 *     uses the very same JS object; the per-process file descriptor table
 *     (FS.streams) and working directory (FS.currentPath) are swapped at every
 *     context switch.
 *   - fork() unwinds the parent with Asyncify, copies its linear memory into a
 *     fresh instance of the same module and rewinds both.  execve() replaces the
 *     program image and keeps the pid and the file descriptors.
 *
 * The file has no Emscripten macros and no dependency on the Emacs glue: all
 * access to it goes through the `env` object given to WasmacsKernel.create()
 * (see tools/scripts/wasmacs-atomics-host-library.js).  The child-side half is
 * src/runtime/process/child/.
 */
(function (root) {
  'use strict';

  // Numeric constants of Emscripten's libc (musl, wasm32).  errno values use the
  // WASI numbering; the rest are the generic Linux values.  They are checked
  // against the headers by tests/process/programs/consts.c.
  const C = Object.freeze({
    EPERM: 63, ENOENT: 44, ESRCH: 71, EINTR: 27, EIO: 29, E2BIG: 1, ENOEXEC: 45, EBADF: 8,
    ECHILD: 12, EAGAIN: 6, ENOMEM: 48, EACCES: 2, EFAULT: 21, EEXIST: 20, ENOTDIR: 54,
    EISDIR: 31, EINVAL: 28, EMFILE: 33, ENOTTY: 59, ESPIPE: 70, EPIPE: 64, ENOSYS: 52,
    ELOOP: 32,
    O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_ACCMODE: 2097155, O_CREAT: 64, O_EXCL: 128,
    O_TRUNC: 512, O_APPEND: 1024, O_NONBLOCK: 2048, O_CLOEXEC: 524288,
    S_IFMT: 0o170000, S_IFIFO: 0o010000, S_IFCHR: 0o020000, S_IFREG: 0o100000, S_IFDIR: 0o040000,
    POLLIN: 1, POLLPRI: 2, POLLOUT: 4, POLLERR: 8, POLLHUP: 16, POLLNVAL: 32,
    POLLRDNORM: 64, POLLWRNORM: 256,
    WNOHANG: 1, WUNTRACED: 2,
    SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGILL: 4, SIGABRT: 6, SIGKILL: 9, SIGSEGV: 11,
    SIGPIPE: 13, SIGALRM: 14, SIGTERM: 15, SIGCHLD: 17, SIGCONT: 18, SIGSTOP: 19,
    SIGTSTP: 20, SIGTTIN: 21, SIGTTOU: 22, SIGURG: 23, SIGWINCH: 28, NSIG: 65,
    FIONREAD: 0x541b,
    PIPE_BUF: 4096,
    // posix_spawn: musl fdop.h FDOP_* and spawn.h POSIX_SPAWN_*
    FDOP_CLOSE: 1, FDOP_DUP2: 2, FDOP_OPEN: 3, FDOP_CHDIR: 4, FDOP_FCHDIR: 5,
    POSIX_SPAWN_SETPGROUP: 2, POSIX_SPAWN_SETSID: 128,
  });

  // Signals whose default action is not "terminate the process".  Stopping and
  // continuing are not modelled (no job control), so those are ignored too.
  const DEFAULT_IGNORED = new Set([C.SIGCHLD, C.SIGCONT, C.SIGSTOP, C.SIGTSTP, C.SIGTTIN,
                                   C.SIGTTOU, C.SIGURG, C.SIGWINCH]);

  const EMACS_PID = 1;
  const FIRST_PID = 100;
  const MAX_SHEBANG_DEPTH = 4;
  // First bytes of an executable that stands for a program image of the host
  // (see wasmacs-userland.js).  Deliberately not "#!": tools that look for a
  // script interpreter themselves (eshell does) must take it for a binary.
  const EXEC_MAGIC = '\x7fwasmacs-exec ';

  // Thrown through the wasm frames of an image that execve() is replacing.
  const EXEC = Object.freeze({ wasmacs: 'EXEC' });
  // Thrown through the wasm frames of a running process that a signal kills.
  const KILLED = Object.freeze({ wasmacs: 'KILLED' });

  // "This system call has to wait."  Returned or thrown by sys_* and by stream
  // ops; the child library then registers it (kernel.block) and unwinds.
  class BlockRequest {
    constructor(wait) { this.wait = wait; }
  }

  let pipeSeq = 0;
  // A pipe: a bounded byte queue (ring buffer).  The buffer starts small and
  // grows up to CAPACITY, so the many pipes that only ever carry a few bytes
  // stay cheap.
  class Pipe {
    constructor(capacity) {
      this.id = ++pipeSeq;
      this.capacity = capacity;
      this.buf = new Uint8Array(0);
      this.head = 0;           // index of the first unread byte in buf
      this.size = 0;           // unread bytes
      this.readers = 0;        // number of fds (in any process) open for reading
      this.writers = 0;        // number of fds (in any process) open for writing
      this.rwait = new Set();  // processes waiting for data / EOF
      this.wwait = new Set();  // processes waiting for space / a reader to vanish
      this.emacsOwned = false; // created by Emacs: activity must wake Emacs
    }
    // Move up to LENGTH unread bytes to BUFFER[OFFSET...]; returns the count.
    take(buffer, offset, length) {
      const n = Math.min(length, this.size);
      if (n === 0) return 0;
      const first = Math.min(n, this.buf.length - this.head);
      buffer.set(this.buf.subarray(this.head, this.head + first), offset);
      if (n > first) buffer.set(this.buf.subarray(0, n - first), offset + first);
      this.size -= n;
      this.head = this.size === 0 ? 0 : (this.head + n) % this.buf.length;
      return n;
    }
    // Append the N bytes BUFFER[OFFSET...]; the caller checked that they fit.
    put(buffer, offset, n) {
      if (this.size + n > this.buf.length) this._grow(this.size + n);
      const tail = (this.head + this.size) % this.buf.length;
      const first = Math.min(n, this.buf.length - tail);
      this.buf.set(buffer.subarray(offset, offset + first), tail);
      if (n > first) this.buf.set(buffer.subarray(offset + first, offset + n), 0);
      this.size += n;
    }
    _grow(need) {
      let length = Math.max(this.buf.length, 1024);
      while (length < need) length *= 2;
      const next = new Uint8Array(Math.min(length, this.capacity));
      const first = Math.min(this.size, this.buf.length - this.head);
      next.set(this.buf.subarray(this.head, this.head + first), 0);
      if (this.size > first) next.set(this.buf.subarray(0, this.size - first), first);
      this.buf = next;
      this.head = 0;
    }
  }

  // One program image: the Emscripten MODULARIZE factory plus ONE compiled
  // WebAssembly.Module shared by every instance (exec, spawn, fork child).
  class Image {
    constructor(name, factory, wasm) {
      this.name = name;
      this.factory = factory;
      this.module = wasm instanceof WebAssembly.Module ? wasm : new WebAssembly.Module(wasm);
    }
    // Synchronously create a fresh JS glue + WebAssembly.Instance for PROC and
    // return its handle (WK in wasmacs-child-library.js).
    instantiate(kernel, proc) {
      const M = {
        wasmacsWasmModule: this.module,
        wasmacsKernel: kernel,
        wasmacsProc: proc,
        wasmacsEnv: proc.env,
        wasmacsFS: kernel.FS,
        thisProgram: proc.argv[0] || this.name,
        print: (s) => kernel.log(`[${proc.pid} ${this.name}] ${s}`),
        printErr: (s) => kernel.log(`[${proc.pid} ${this.name}] ${s}`),
        // Never let a child touch the host's exit code or handlers.
        quit: (status, toThrow) => { throw toThrow; },
      };
      // The MODULARIZE factory is an async function, so it returns a promise,
      // but with -sWASM_ASYNC_COMPILATION=0 its whole body runs synchronously
      // and fills in M.  On success the promise must be left alone: a reaction
      // on it (then/catch) queues a microtask that references M, and
      // microtasks never run while Emacs runs (the worker does not return to
      // its event loop).  Every process would keep its instance and its
      // memory alive forever.
      let initialized = false;
      M.onRuntimeInitialized = () => { initialized = true; };
      // The filesystem belongs to all processes.  A library that mounts
      // something into it at program start (Emscripten's SOCKFS and PIPEFS
      // do) would leave that mount behind at every exit, and the mount keeps
      // the dead instance alive: refuse, so that such a program fails loudly
      // when it is first tried instead of leaking quietly.
      const FS = kernel.FS;
      const mount = FS.mount;
      FS.mount = () => {
        M.wasmacsInitError = new Error('it mounts a filesystem at startup (not allowed in the shared FS)');
        throw M.wasmacsInitError;
      };
      let promise;
      try {
        promise = this.factory(M);
      } finally {
        FS.mount = mount;
      }
      if (!M.wasmacs || !initialized) {
        // Rejected or never settling; nothing of value is kept alive by it.
        if (promise && typeof promise.catch === 'function') promise.catch(() => {});
        const why = M.wasmacsInitError;
        throw new Error(`program ${this.name} did not initialise synchronously` +
                        (why ? `: ${why && why.message ? why.message : why}` : ''));
      }
      return M.wasmacs;
    }
  }

  class Process {
    constructor(pid, ppid) {
      this.pid = pid;
      this.ppid = ppid;
      this.pgid = pid;
      this.sid = pid;
      this.name = '';            // program name (image)
      this.image = null;
      this.inst = null;          // handle of the current instance
      this.argv = [];
      this.env = [];             // "K=V" strings
      this.cwd = '/';
      this.streams = [];         // per-process fd table (FS.streams while running)
      this.state = 'new';        // new | ready | running | blocked | zombie
      this.wait = null;          // why it is blocked
      this.pending = null;       // fork / exec request to finish after unwinding
      this.resumeValue = undefined; // return value of a completed fork()
      this.exitStatus = 0;       // wait(2)-encoded status
      this.children = new Set();
      this.vforkParent = null;
      this.autoReap = false;
      this.sigPending = new Set(); // handled signals to deliver at the next system call
      this.eintr = false;        // the blocked system call was interrupted by a handler
      this.timedOut = false;     // the wait ended because its deadline passed
      this.restart = null;       // state of a system call that is re-issued after a rewind
      this.sliceStart = 0;
    }
  }

  class Kernel {
    constructor(env) {
      this.env = env;
      this.FS = env.FS;
      this.C = C;
      this.EXEC = EXEC;
      this.KILLED = KILLED;
      this.BlockRequest = BlockRequest;
      this.maxProcs = 64;
      this.pipeCapacity = 65536;
      this.sliceMs = 10;         // time slice of a process
      this.pumpMs = 20;          // how long Emacs lets processes run per scheduling point
      this.images = new Map();   // program name -> Image
      this.procs = new Map();
      this.runq = [];
      this.sleepers = new Set(); // blocked processes with a deadline
      this.httpRequests = new Set(); // bounded page-owned requests, never promises
      this.nextPid = FIRST_PID;
      this.debug = !!env.debug;
      this.stats = { spawns: 0, forks: 0, execs: 0, exits: 0, switches: 0 };
      // Process activity that Emacs has to look at (output on its pipes, EOF,
      // child status changes) is counted here; see emacsAttention().
      this.eventSeq = 0;
      this.servicedSeq = 0;
      this.sigchldPending = false;
      // pid 1: Emacs.  Its fd table is the live FS.streams array.
      this.emacs = new Process(EMACS_PID, 0);
      this.emacs.name = 'emacs';
      this.emacs.state = 'running';
      this.emacs.streams = this.FS.streams;
      this.procs.set(EMACS_PID, this.emacs);
      this.current = this.emacs;
      this._initPipeOps();
    }

    log(msg) {
      if (this.env.log) this.env.log(msg);
    }
    _trace(...args) {
      if (this.debug) this.log(`kernel: ${args.join(' ')}`);
    }
    now() { return this.env.now(); }
    errno(code) { return new this.FS.ErrnoError(code); }

    // ------------------------------------------------------ context switch
    // Install P's fd table and cwd in the shared FS.  Returns what to restore.
    _switchTo(p) {
      const FS = this.FS;
      const saved = { proc: this.current, streams: FS.streams, cwd: FS.currentPath };
      FS.streams = p.streams;
      FS.currentPath = p.cwd;
      this.current = p;
      return saved;
    }
    _switchBack(saved) {
      const FS = this.FS;
      this.current.cwd = FS.currentPath;       // chdir() during the slice
      FS.streams = saved.streams;
      FS.currentPath = saved.cwd;
      this.current = saved.proc;
    }
    // Run FN with TABLE as the current fd table (cwd unchanged).
    _withTable(table, fn) {
      const FS = this.FS;
      const saved = FS.streams;
      FS.streams = table;
      try { return fn(); } finally { FS.streams = saved; }
    }
    // Memory of the process that is making the current system call.
    _views() {
      return this.current === this.emacs ? this.env.views() : this.current.inst.views();
    }

    // ---------------------------------------------------------------- pipes
    _initPipeOps() {
      const k = this, FS = this.FS;
      this.pipeOps = {
        read(stream, buffer, offset, length) {
          const pipe = stream.node.pipe;
          for (;;) {
            if (pipe.size > 0) {
              const n = pipe.take(buffer, offset, length);
              if (n > 0) k._wakeSet(pipe.wwait);
              return n;
            }
            if (pipe.writers === 0) return 0;              // EOF: no writer left anywhere
            if (stream.flags & C.O_NONBLOCK) throw k.errno(C.EAGAIN);
            if (k.current === k.emacs) {
              const r = k._emacsBlock(() => pipe.size > 0 || pipe.writers === 0, -1, { quit: true });
              if (r === 'eintr') throw k.errno(C.EINTR);
              continue;
            }
            throw new BlockRequest({ kind: 'pipe-read', sets: [pipe.rwait], interruptible: true });
          }
        },
        write(stream, buffer, offset, length) {
          const pipe = stream.node.pipe;
          for (;;) {
            if (pipe.readers === 0) {
              // SIGPIPE, then EPIPE if the process survives it.
              if (k.current !== k.emacs) k._signal(k.current, C.SIGPIPE);
              throw k.errno(C.EPIPE);
            }
            const free = pipe.capacity - pipe.size;
            // Writes of up to PIPE_BUF bytes are atomic.
            if (free > 0 && !(length <= C.PIPE_BUF && free < length)) {
              const n = Math.min(free, length);
              pipe.put(buffer, offset, n);
              k._wakeSet(pipe.rwait);
              if (pipe.emacsOwned && FS.streams !== k.emacs.streams) k.eventSeq++;
              return n;
            }
            if (stream.flags & C.O_NONBLOCK) throw k.errno(C.EAGAIN);
            if (k.current === k.emacs) {
              const r = k._emacsBlock(() => pipe.readers === 0 || pipe.capacity - pipe.size >= Math.min(length, C.PIPE_BUF),
                                      -1, { quit: true });
              if (r === 'eintr') throw k.errno(C.EINTR);
              continue;
            }
            throw new BlockRequest({ kind: 'pipe-write', sets: [pipe.wwait], interruptible: true });
          }
        },
        dup(stream) {
          const pipe = stream.node.pipe;
          if (stream.wasmacsEnd === 'r') pipe.readers++; else pipe.writers++;
        },
        close(stream) {
          const pipe = stream.node.pipe;
          if (stream.wasmacsEnd === 'r') {
            if (--pipe.readers === 0) k._wakeSet(pipe.wwait);   // writers get EPIPE
          } else if (--pipe.writers === 0) {
            k._wakeSet(pipe.rwait);                              // readers get EOF
            // A process (not Emacs itself) dropped the last write end: Emacs
            // has to see the EOF.
            if (pipe.emacsOwned && FS.streams !== k.emacs.streams) k.eventSeq++;
          }
        },
        poll(stream) {
          const pipe = stream.node.pipe;
          if (stream.wasmacsEnd === 'r') {
            let mask = 0;
            if (pipe.size > 0) mask |= C.POLLIN | C.POLLRDNORM;
            if (pipe.writers === 0) mask |= C.POLLHUP;
            return mask;
          }
          if (pipe.readers === 0) return C.POLLERR;
          return pipe.size < pipe.capacity ? C.POLLOUT | C.POLLWRNORM : 0;
        },
        ioctl(stream, cmd, arg) {
          if (cmd === C.FIONREAD) {
            k._views().HEAP32[arg >> 2] = stream.node.pipe.size;
            return 0;
          }
          throw k.errno(C.ENOTTY);
        },
        getattr(stream) {
          const node = stream.node;
          return {
            dev: 14, ino: node.id, mode: node.mode, nlink: 1, uid: 0, gid: 0, rdev: 0, size: 0,
            atime: node.timestamp, mtime: node.timestamp, ctime: node.timestamp,
            blksize: 4096, blocks: 0,
          };
        },
      };
    }

    // Create a pipe in the CURRENT fd table.  Returns the two streams.
    createPipe(flags = 0) {
      const FS = this.FS;
      const pipe = new Pipe(this.pipeCapacity);
      pipe.emacsOwned = this.current === this.emacs;
      const node = {
        id: 0x40000000 + pipe.id, name: `pipe:[${pipe.id}]`, mode: C.S_IFIFO | 0o600,
        pipe, node_ops: {}, stream_ops: this.pipeOps, timestamp: new Date(),
      };
      const status = flags & C.O_NONBLOCK;
      const r = FS.createStream({
        node, path: node.name, flags: C.O_RDONLY | status, position: 0, seekable: false,
        stream_ops: this.pipeOps, wasmacsEnd: 'r', cloexec: !!(flags & C.O_CLOEXEC),
      });
      pipe.readers++;
      const w = FS.createStream({
        node, path: node.name, flags: C.O_WRONLY | status, position: 0, seekable: false,
        stream_ops: this.pipeOps, wasmacsEnd: 'w', cloexec: !!(flags & C.O_CLOEXEC),
      });
      pipe.writers++;
      return { pipe, r, w };
    }

    // ------------------------------------------------------------ fd tables
    // fork()/spawn: duplicate every open descriptor of SRC into a new table.
    // Each fd gets its own stream object (FD_CLOEXEC is per descriptor), the
    // open file description (`shared`: offset + status flags) is shared with
    // the parent, and stream_ops.dup() bumps the pipe reference counts.
    _forkStreams(src) {
      const FS = this.FS, dst = [];
      this._withTable(dst, () => {
        for (let fd = 0; fd < src.length; fd++) {
          const s = src[fd];
          if (s) FS.dupStream(s, fd);
        }
      });
      return dst;
    }
    _closeAll(p) {
      const FS = this.FS;
      this._withTable(p.streams, () => {
        for (let fd = 0; fd < p.streams.length; fd++) {
          const s = p.streams[fd];
          if (s) { try { FS.close(s); } catch (e) { /* ignore */ } }
        }
      });
      p.streams.length = 0;
    }
    _closeOnExec(p) {
      const FS = this.FS;
      this._withTable(p.streams, () => {
        for (let fd = 0; fd < p.streams.length; fd++) {
          const s = p.streams[fd];
          if (s && s.cloexec) { try { FS.close(s); } catch (e) { /* ignore */ } }
        }
      });
    }

    // ------------------------------------------------------------- programs
    // Program images come from the host (worker: synchronous XHR +
    // importScripts; Node: fs + vm): env.loadProgram(name) -> { factory, wasm }.
    _image(name) {
      let image = this.images.get(name);
      if (!image) {
        const loaded = this.env.loadProgram(name);
        if (!loaded || typeof loaded.factory !== 'function') {
          throw new Error(`program image ${name} is not available`);
        }
        image = new Image(name, loaded.factory, loaded.wasm);
        this.images.set(name, image);
      }
      return image;
    }

    // Resolve PATH (as seen by the current process) to a program image.
    // An executable is a regular file with an x bit that starts with
    //   <DEL>wasmacs-exec <program>  a program image provided by the host, or
    //   #!<interpreter> [arg]        a script (the interpreter is resolved the same way).
    // Returns { image, argv } or { err }.
    _resolveExecutable(path, argv, depth = 0) {
      const FS = this.FS;
      let node, fullPath;
      try {
        const lookup = FS.lookupPath(path, { follow: true });
        node = lookup.node;
        fullPath = lookup.path;
      } catch (e) {
        return { err: e.errno || C.ENOENT };
      }
      if (!node) return { err: C.ENOENT };
      if (FS.isDir(node.mode) || !FS.isFile(node.mode) || !(node.mode & 0o111)) return { err: C.EACCES };
      let head = '';
      try {
        const stream = FS.open(fullPath, C.O_RDONLY);
        try {
          const buf = new Uint8Array(256);
          const n = FS.read(stream, buf, 0, buf.length, 0);
          for (let i = 0; i < n; i++) head += String.fromCharCode(buf[i]);
        } finally {
          FS.close(stream);
        }
      } catch (e) {
        return { err: e.errno || C.EACCES };
      }
      if (head.startsWith(EXEC_MAGIC)) {
        const name = head.slice(EXEC_MAGIC.length).split('\n')[0].trim();
        if (!/^[A-Za-z0-9_.-]+$/.test(name)) return { err: C.ENOEXEC };
        try {
          return { image: this._image(name), argv };
        } catch (e) {
          this.log(`kernel: cannot load program "${name}": ${e && e.message ? e.message : e}`);
          return { err: C.ENOEXEC };
        }
      }
      if (!head.startsWith('#!')) return { err: C.ENOEXEC };
      if (depth >= MAX_SHEBANG_DEPTH) return { err: C.ELOOP };
      const line = head.slice(2).split('\n')[0].trim();
      const m = /^(\S+)(?:\s+(.*))?$/.exec(line);
      if (!m) return { err: C.ENOEXEC };
      const interpArgv = [m[1]];
      if (m[2]) interpArgv.push(m[2]);
      interpArgv.push(path, ...argv.slice(1));
      return this._resolveExecutable(m[1], interpArgv, depth + 1);
    }

    // PATH search as execvp/posix_spawnp do it (for the current process).
    _searchPath(file, searchPath) {
      if (searchPath === null || searchPath === undefined || file.includes('/')) return file;
      const FS = this.FS;
      let firstErr = null;
      for (const dir of searchPath.split(':')) {
        const candidate = (dir || '.') + '/' + file;
        try {
          const node = FS.lookupPath(candidate, { follow: true }).node;
          if (node && FS.isFile(node.mode) && (node.mode & 0o111)) return candidate;
        } catch (e) {
          firstErr = firstErr || e;
        }
      }
      return file.includes('/') ? file : (searchPath.split(':')[0] || '.') + '/' + file;
    }

    // ----------------------------------------------------------- processes
    liveCount() {
      let n = 0;
      for (const p of this.procs.values()) if (p !== this.emacs && p.state !== 'zombie') n++;
      return n;
    }
    _newProc(parent) {
      const p = new Process(this.nextPid++, parent.pid);
      p.pgid = parent === this.emacs ? p.pid : parent.pgid;
      p.sid = parent === this.emacs ? p.pid : parent.sid;
      parent.children.add(p);
      this.procs.set(p.pid, p);
      return p;
    }
    _makeReady(p) {
      p.wait = null;
      p.state = 'ready';
      this.runq.push(p);
    }
    // Register why P (which is unwinding, or about to) is blocked.
    block(p, request) {
      const wait = request.wait;
      if (wait.kind === 'yield') {           // not really blocked: just end the slice
        p.wait = null;
        p.state = 'ready';
        this.runq.push(p);
        return;
      }
      p.wait = wait;
      p.state = 'blocked';
      p.timedOut = false;
      for (const set of wait.sets || []) set.add(p);
      if (wait.until !== undefined && wait.until !== null) this.sleepers.add(p);
    }
    _unblock(p) {
      if (p.state !== 'blocked') return;
      const wait = p.wait;
      if (wait) for (const set of wait.sets || []) set.delete(p);
      this.sleepers.delete(p);
      this._makeReady(p);
    }
    _wakeSet(set) {
      if (set.size === 0) return;
      for (const p of [...set]) this._unblock(p);
    }
    _wakeSleepers(now) {
      if (this.sleepers.size === 0) return;
      for (const p of [...this.sleepers]) {
        if (p.wait && p.wait.until <= now) {
          p.timedOut = true;
          this._unblock(p);
        }
      }
    }
    // Milliseconds until the next sleeper is due (Infinity when there is none).
    _nextTimerDelay(now) {
      let next = Infinity;
      for (const p of this.sleepers) if (p.wait && p.wait.until < next) next = p.wait.until;
      return next === Infinity ? Infinity : Math.max(0, next - now);
    }

    // Terminate P.  It is not on any JS stack, or it is unwinding through an
    // exception (exit, KILLED, a trap).  STATUS is wait(2)-encoded.
    _terminate(p, status) {
      if (p.state === 'zombie') return;
      this._trace('exit', p.pid, status);
      this.stats.exits++;
      if (p.state === 'blocked') {
        if (p.wait) for (const set of p.wait.sets || []) set.delete(p);
        this.sleepers.delete(p);
      }
      const ri = this.runq.indexOf(p);
      if (ri >= 0) this.runq.splice(ri, 1);
      this.cancelRestart(p);
      p.wait = null; p.pending = null;
      p.exitStatus = status;
      p.state = 'zombie';
      this._closeAll(p);            // drops pipe refs -> EOF / EPIPE wakeups
      p.inst = null; p.image = null; // let the instance and its memory be collected
      // Orphans are adopted by Emacs and reaped automatically.
      for (const c of p.children) {
        c.ppid = EMACS_PID; c.autoReap = true; this.emacs.children.add(c);
        if (c.state === 'zombie') this._reap(c);
      }
      p.children.clear();
      if (p.vforkParent) this._vforkRelease(p);
      const parent = this.procs.get(p.ppid);
      if (p.autoReap || !parent) { this._reap(p); return; }
      if (parent === this.emacs) {
        this.sigchldPending = true;
        this.eventSeq++;
      } else {
        if (parent.state === 'blocked' && parent.wait && parent.wait.kind === 'child') this._unblock(parent);
        this._signal(parent, C.SIGCHLD);
      }
    }
    _reap(p) {
      const parent = this.procs.get(p.ppid);
      if (parent) parent.children.delete(p);
      this.procs.delete(p.pid);
    }
    _vforkRelease(child) {
      const parent = child.vforkParent;
      child.vforkParent = null;
      if (parent && parent.state === 'blocked' && parent.wait && parent.wait.kind === 'vfork') {
        this._unblock(parent);
      }
    }

    // -------------------------------------------------------------- signals
    // Deliver SIG to TARGET (a child process).  May throw KILLED when TARGET is
    // the running process and the signal kills it.
    _signal(target, sig) {
      if (target === this.emacs || target.state === 'zombie' || sig === 0) return;
      let disposition = 'default';
      if (sig !== C.SIGKILL && sig !== C.SIGSTOP && target.inst && target.state !== 'new') {
        try { disposition = target.inst.sigDisposition(sig); } catch (e) { disposition = 'default'; }
      }
      if (disposition === 'ignore') return;
      if (disposition === 'handler') {
        target.sigPending.add(sig);
        if (target.state === 'blocked' && target.wait && target.wait.interruptible) {
          target.eintr = true;
          this._unblock(target);
        }
        return;
      }
      if (DEFAULT_IGNORED.has(sig)) return;
      this._trace('signal', target.pid, sig);
      if (target === this.current && target.state === 'running') {
        target.killedBy = sig;
        throw KILLED;                         // unwinds to the scheduler
      }
      this._terminate(target, sig & 0x7f);
    }
    // Processes a kill(2) PID argument refers to.
    _killTargets(p, pid) {
      const out = [];
      if (pid > 0) {
        const t = this.procs.get(pid);
        if (t) out.push(t);
      } else {
        const pgid = pid === 0 ? p.pgid : pid === -1 ? null : -pid;
        for (const t of this.procs.values()) {
          if (t === this.emacs || t.state === 'zombie') continue;
          if (pgid === null ? t !== p : t.pgid === pgid) out.push(t);
        }
      }
      return out;
    }
    sys_kill(p, pid, sig) {
      if (sig < 0 || sig >= C.NSIG) return -C.EINVAL;
      const targets = this._killTargets(p, pid).filter((t) => t !== this.emacs && t.state !== 'zombie');
      if (targets.length === 0) {
        // Signalling Emacs from a process is not allowed.
        return pid === EMACS_PID ? -C.EPERM : -C.ESRCH;
      }
      if (sig === 0) return 0;
      let self = false;
      for (const t of targets) {
        if (t === p) { self = true; continue; }
        this._signal(t, sig);
      }
      if (self) this._signal(p, sig);         // last: may throw KILLED
      return 0;
    }

    // ----------------------------------------------------------- scheduler
    // Run one runnable process until it blocks, exits, execs or is preempted.
    step() {
      const p = this.runq.shift();
      if (!p) return false;
      if (p.state !== 'new' && p.state !== 'ready') return true; // stale entry
      const fresh = p.state === 'new';
      const saved = this._switchTo(p);
      this.stats.switches++;
      let out;
      try {
        p.state = 'running';
        p.sliceStart = this.now();
        out = fresh ? p.inst.start(p.argv) : p.inst.resume();
      } finally {
        this._switchBack(saved);
      }
      this._afterRun(p, out);
      return true;
    }
    _afterRun(p, out) {
      switch (out.kind) {
        case 'blocked':
          if (p.pending && p.pending.type === 'fork') this._completeFork(p);
          else if (p.state === 'running') {
            this.log(`kernel: pid ${p.pid} unwound without a wait reason; killing it`);
            this._terminate(p, C.SIGSEGV);
          }
          break;
        case 'exit':
          // sys_exit() already ran (state zombie); be defensive otherwise.
          if (p.state !== 'zombie') this._terminate(p, (out.status & 0xff) << 8);
          break;
        case 'exec':
          this._completeExec(p);
          break;
        case 'killed':
          this._terminate(p, (p.killedBy || C.SIGKILL) & 0x7f);
          break;
        case 'returned':
          this._terminate(p, 0);
          break;
        case 'crash': {
          const msg = String(out.error && out.error.message || out.error);
          const sig = /abort/i.test(msg) ? C.SIGABRT : C.SIGSEGV;
          this.log(`kernel: pid ${p.pid} (${p.name}) killed by signal ${sig}: ${msg}`);
          this.lastCrash = { pid: p.pid, name: p.name, sig, error: out.error };
          this._terminate(p, sig);
          break;
        }
        default:
          throw new Error('bad run outcome ' + JSON.stringify(out));
      }
    }
    hasRunnable() { return this.runq.length > 0; }
    // Let processes run for up to BUDGET milliseconds.  Returns true if any ran.
    pump(budgetMs = this.pumpMs) {
      const t0 = this.now();
      let ran = false;
      for (;;) {
        const now = this.now();
        this._wakeSleepers(now);
        if (this.runq.length === 0) break;
        this.step();
        ran = true;
        if (this.now() - t0 >= budgetMs) break;
      }
      return ran;
    }
    // Preemption point of a running process: when its time slice is used up it
    // gets a "yield" BlockRequest, which just ends the slice.
    preempt(p) {
      if (this.now() - p.sliceStart < this.sliceMs) return 0;
      return new BlockRequest({ kind: 'yield' });
    }

    // ---------------------------------------------------------------- fork
    sys_fork(p, vfork) {
      if (p.resumeValue !== undefined) {       // second entry, after the rewind
        const v = p.resumeValue;
        p.resumeValue = undefined;
        return v;
      }
      if (this.liveCount() >= this.maxProcs) return -C.EAGAIN;   // fork-bomb guard
      p.pending = { type: 'fork', vfork };
      return new BlockRequest({ kind: 'fork' });
    }
    // Called by the scheduler once the parent has completely unwound.
    _completeFork(parent) {
      const pend = parent.pending;
      parent.pending = null;
      const child = this._newProc(parent);
      child.name = parent.name;
      child.image = parent.image;
      child.argv = parent.argv;
      child.env = parent.env;
      child.cwd = parent.cwd;
      child.pgid = parent.pgid;
      child.sid = parent.sid;
      child.streams = this._forkStreams(parent.streams);
      try {
        child.inst = parent.image.instantiate(this, child);
        child.inst.cloneFrom(parent.inst);      // memory + globals + Asyncify state
      } catch (e) {
        this.log(`kernel: fork failed: ${e && e.message ? e.message : e}`);
        this._closeAll(child);
        parent.children.delete(child);
        this.procs.delete(child.pid);
        parent.resumeValue = -C.ENOMEM;
        this._unblock(parent);
        return;
      }
      this.stats.forks++;
      this._trace(pend.vfork ? 'vfork' : 'fork', parent.pid, child.pid);
      child.resumeValue = 0;
      child.state = 'ready';
      parent.resumeValue = child.pid;
      this.runq.push(child);                    // the child runs first
      if (pend.vfork) {
        child.vforkParent = parent;
        parent.wait = { kind: 'vfork', child, sets: [] };  // until exec/_exit
      } else {
        this._unblock(parent);
      }
    }

    // ---------------------------------------------------------------- exec
    sys_execve(p, pathPtr, argvPtr, envpPtr) {
      const inst = p.inst;
      const path = inst.readStr(pathPtr);
      const argv = inst.readStrArray(argvPtr);
      const resolved = this._resolveExecutable(path, argv.length ? argv : [path]);
      if (resolved.err) return -resolved.err;   // the caller survives
      p.pending = { type: 'exec', image: resolved.image, argv: resolved.argv, env: inst.readStrArray(envpPtr) };
      throw EXEC;                               // abandon the old image's stack
    }
    _completeExec(p) {
      const pend = p.pending;
      p.pending = null;
      this._closeOnExec(p);
      this.stats.execs++;
      this._trace('exec', p.pid, pend.image.name, pend.argv.join(' '));
      p.inst = null;                            // the old instance becomes garbage
      p.image = pend.image;
      p.name = pend.image.name;
      p.argv = pend.argv;
      p.env = pend.env;
      p.resumeValue = undefined;
      p.sigPending.clear();
      p.eintr = false;
      try {
        p.inst = pend.image.instantiate(this, p);
      } catch (e) {
        this.log(`kernel: exec of ${pend.image.name} failed: ${e && e.message ? e.message : e}`);
        this._terminate(p, C.SIGKILL);
        return;
      }
      p.state = 'new';
      this.runq.push(p);
      if (p.vforkParent) this._vforkRelease(p);
    }

    // --------------------------------------------------------------- spawn
    // Shared by posix_spawn() from a process and by Emacs.  STREAMS is the
    // child's prepared fd table.  Returns { pid } or { err }.
    _spawn(parent, { path, argv, env, cwd, streams, newSession = false, pgroup = null }) {
      const closeTable = () => {
        this._withTable(streams, () => {
          for (const s of streams) if (s) { try { this.FS.close(s); } catch (e) { /* ignore */ } }
        });
      };
      if (this.liveCount() >= this.maxProcs) { closeTable(); return { err: C.EAGAIN }; }
      const resolved = this._resolveExecutable(path, argv.length ? argv : [path]);
      if (resolved.err) { closeTable(); return { err: resolved.err }; }
      const child = this._newProc(parent);
      child.name = resolved.image.name;
      child.image = resolved.image;
      child.argv = resolved.argv;
      child.env = env;
      child.cwd = cwd;
      child.streams = streams;
      if (parent !== this.emacs) { child.pgid = parent.pgid; child.sid = parent.sid; }
      if (newSession) { child.sid = child.pid; child.pgid = child.pid; }
      else if (pgroup !== null) child.pgid = pgroup === 0 ? child.pid : pgroup;
      try {
        child.inst = child.image.instantiate(this, child);
      } catch (e) {
        this.log(`kernel: spawn of ${child.name} failed: ${e && e.message ? e.message : e}`);
        this._closeAll(child);
        parent.children.delete(child);
        this.procs.delete(child.pid);
        return { err: C.ENOMEM };
      }
      child.state = 'new';
      this.runq.push(child);
      this.stats.spawns++;
      this._trace('spawn', parent.pid, child.pid, child.argv.join(' '));
      return { pid: child.pid };
    }
    // posix_spawn(): returns an errno (0 on success) and never blocks.
    sys_spawn(p, pidPtr, pathPtr, opsPtr, nops, argvPtr, envpPtr, searchPathPtr, flags, pgroup) {
      const FS = this.FS, inst = p.inst;
      const { HEAP32 } = inst.views();
      const file = inst.readStr(pathPtr);
      const argv = inst.readStrArray(argvPtr);
      const env = inst.readStrArray(envpPtr);
      const path = this._searchPath(file, searchPathPtr ? inst.readStr(searchPathPtr) : null);
      const streams = this._forkStreams(p.streams);
      let cwd = FS.currentPath;
      try {
        this._withTable(streams, () => {
          for (let i = 0; i < nops; i++) {
            const o = (opsPtr >> 2) + i * 6;
            const cmd = HEAP32[o], fd = HEAP32[o + 1], srcfd = HEAP32[o + 2], oflag = HEAP32[o + 3], mode = HEAP32[o + 4];
            const opPath = HEAP32[o + 5] ? inst.readStr(HEAP32[o + 5]) : null;
            switch (cmd) {
              case C.FDOP_CLOSE:
                if (streams[fd]) FS.close(streams[fd]);
                break;
              case C.FDOP_DUP2: {
                const src = streams[srcfd];
                if (!src) throw this.errno(C.EBADF);
                if (srcfd === fd) { src.cloexec = false; break; }
                if (streams[fd]) FS.close(streams[fd]);
                FS.dupStream(src, fd).cloexec = false;
                break;
              }
              case C.FDOP_OPEN: {
                if (streams[fd]) FS.close(streams[fd]);
                const saved = FS.currentPath;
                FS.currentPath = cwd;
                try {
                  const s = FS.open(opPath, oflag & ~C.O_CLOEXEC, mode);
                  if (s.fd !== fd) { FS.dupStream(s, fd).cloexec = false; FS.close(s); }
                  else s.cloexec = false;
                } finally {
                  FS.currentPath = saved;
                }
                break;
              }
              case C.FDOP_CHDIR: {
                const lookup = FS.lookupPath(opPath, { follow: true });
                if (!FS.isDir(lookup.node.mode)) throw this.errno(C.ENOTDIR);
                cwd = lookup.path;
                break;
              }
              default:
                throw this.errno(C.EINVAL);
            }
          }
          for (let fd = 0; fd < streams.length; fd++) {
            const s = streams[fd];
            if (s && s.cloexec) FS.close(s);
          }
        });
      } catch (e) {
        this._withTable(streams, () => {
          for (const s of streams) if (s) { try { FS.close(s); } catch (e2) { /* ignore */ } }
        });
        return e && e.errno ? e.errno : C.EINVAL;
      }
      const r = this._spawn(p, {
        path, argv, env, cwd, streams,
        newSession: !!(flags & C.POSIX_SPAWN_SETSID),
        pgroup: (flags & C.POSIX_SPAWN_SETPGROUP) ? pgroup : null,
      });
      if (r.err) return r.err;
      if (pidPtr) inst.views().HEAP32[pidPtr >> 2] = r.pid;
      return 0;
    }

    // ---------------------------------------------------------------- wait
    _matchChild(p, c, pid) {
      if (pid > 0) return c.pid === pid;
      if (pid === -1) return true;
      return c.pgid === (pid === 0 ? p.pgid : -pid);
    }
    // { none: true } | { zombie } | { running: true }
    _findChild(p, pid) {
      let any = false;
      for (const c of p.children) {
        if (!this._matchChild(p, c, pid)) continue;
        any = true;
        if (c.state === 'zombie') return { zombie: c };
      }
      return any ? { running: true } : { none: true };
    }
    sys_wait4(p, pid, statusPtr, options) {
      const found = this._findChild(p, pid);
      if (found.none) return -C.ECHILD;
      if (found.zombie) {
        const z = found.zombie;
        if (statusPtr) p.inst.views().HEAP32[statusPtr >> 2] = z.exitStatus;
        this._reap(z);
        return z.pid;
      }
      if (options & C.WNOHANG) return 0;
      return new BlockRequest({ kind: 'child', pid, sets: [], interruptible: true });
    }
    sys_exit(p, code) {
      this._terminate(p, (code & 0xff) << 8);
    }
    sys_sleep(p, ms) {
      let until;
      if (p.restart && p.restart.kind === 'sleep') {
        // Re-issued after the rewind: keep the original deadline.
        until = p.restart.until;
        p.restart = null;
      } else {
        if (!(ms > 0)) return 0;
        until = this.now() + ms;
      }
      if (this.now() >= until) return 0;
      p.restart = { kind: 'sleep', until };
      return new BlockRequest({ kind: 'sleep', until, sets: [], interruptible: true });
    }
    // The blocked system call of P was interrupted by a signal handler and
    // returns EINTR instead of being re-issued.
    cancelRestart(p) {
      if (p.restart && p.restart.kind === 'http') {
        const handle = p.restart.handle;
        this.httpRequests.delete(handle);
        try { handle.cancel(); } catch (_) { /* release locally even if the page is gone */ }
      }
      p.restart = null;
      p.pending = null;
    }
    // Start once, unwind, and retry after the page has filled the shared slot.
    // Network callbacks live outside this worker. A short scheduler deadline
    // also covers hosts without an input wake counter; it disappears at close.
    sys_http_fetch(p, makeRequest) {
      p.timedOut = false;
      const wait = () => new BlockRequest({ kind: 'http', until: this.now() + 20,
                                           sets: [], interruptible: true });
      if (!p.restart || p.restart.kind !== 'http') {
        if (this.httpRequests.size >= 4) return wait();
        const start = this.env.startNetworkFetch || root.__wasmacsStartProcessHttp;
        if (!start) return { error: 'HTTP transport is unavailable in this host' };
        try {
          const handle = start(makeRequest());
          if (!handle || typeof handle.poll !== 'function' || typeof handle.cancel !== 'function') {
            return { error: 'Invalid HTTP transport handle' };
          }
          p.restart = { kind: 'http', handle };
          this.httpRequests.add(handle);
        } catch (_) {
          return { error: 'Could not start HTTP request' };
        }
      }
      let result;
      try { result = p.restart.handle.poll(); }
      catch (_) { this.cancelRestart(p); return { error: 'HTTP relay failed' }; }
      if (result === null) return wait();
      this.httpRequests.delete(p.restart.handle);
      p.restart = null;
      return result;
    }
    sys_pause(p) {
      return new BlockRequest({ kind: 'pause', sets: [], interruptible: true });
    }
    sys_getpgid(p, pid) {
      const t = pid === 0 ? p : this.procs.get(pid);
      return t ? t.pgid : -C.ESRCH;
    }
    sys_setpgid(p, pid, pgid) {
      const t = pid === 0 ? p : this.procs.get(pid);
      if (!t || (t !== p && t.ppid !== p.pid)) return -C.ESRCH;
      if (pgid < 0) return -C.EINVAL;
      t.pgid = pgid === 0 ? t.pid : pgid;
      return 0;
    }
    sys_getsid(p, pid) {
      const t = pid === 0 ? p : this.procs.get(pid);
      return t ? t.sid : -C.ESRCH;
    }
    sys_setsid(p) {
      if (p.pgid === p.pid) return -C.EPERM;
      p.sid = p.pid;
      p.pgid = p.pid;
      return p.pid;
    }
    sys_pipe2(p, fdPtr, flags) {
      let pair;
      try {
        pair = this.createPipe(flags);
      } catch (e) {
        return -(e && e.errno ? e.errno : C.EMFILE);
      }
      const { HEAP32 } = this._views();
      HEAP32[fdPtr >> 2] = pair.r.fd;
      HEAP32[(fdPtr >> 2) + 1] = pair.w.fd;
      return 0;
    }

    // ---------------------------------------------------------------- poll
    // Fill in revents for NFDS pollfd records at FDS in the caller's memory.
    // Returns the number of descriptors with events.
    _pollScan(fds, nfds, ttyReady) {
      const FS = this.FS;
      const { HEAP32, HEAP16 } = this._views();
      let count = 0;
      for (let i = 0; i < nfds; i++) {
        const base = fds + i * 8;
        const fd = HEAP32[base >> 2];
        const events = HEAP16[(base + 4) >> 1];
        let flags = C.POLLNVAL;
        const stream = fd >= 0 ? FS.getStream(fd) : null;
        if (fd < 0) flags = 0;
        else if (stream) {
          if (stream.tty && ttyReady) flags = ttyReady(stream);
          else if (stream.stream_ops.poll) flags = stream.stream_ops.poll(stream, -1);
          else flags = C.POLLIN | C.POLLOUT;
        }
        flags &= events | C.POLLERR | C.POLLHUP | C.POLLNVAL;
        if (flags) count++;
        HEAP16[(base + 6) >> 1] = flags;
      }
      return count;
    }
    // Wait sets of every pipe mentioned in a pollfd array.
    _pollSets(fds, nfds) {
      const FS = this.FS;
      const { HEAP32 } = this._views();
      const sets = [];
      for (let i = 0; i < nfds; i++) {
        const stream = FS.getStream(HEAP32[(fds + i * 8) >> 2]);
        const pipe = stream && stream.node && stream.node.pipe;
        if (pipe) sets.push(stream.wasmacsEnd === 'r' ? pipe.rwait : pipe.wwait);
      }
      return sets;
    }
    sys_poll(p, fds, nfds, timeout) {
      let until;
      if (p.restart && p.restart.kind === 'poll') {
        // Re-issued after the rewind: keep the original deadline.
        until = p.restart.until;
        p.restart = null;
      } else {
        const pre = this.preempt(p);
        if (pre) return pre;
        until = timeout < 0 ? null : this.now() + timeout;
      }
      const n = this._pollScan(fds, nfds, null);
      if (n > 0 || timeout === 0) return n;
      if (until !== null && this.now() >= until) return 0;
      p.restart = { kind: 'poll', until };
      return new BlockRequest({ kind: 'poll', until, sets: this._pollSets(fds, nfds), interruptible: true });
    }

    // ======================================================================
    // Emacs side.  Emacs is not asyncified: its blocking calls run the
    // scheduler in a loop until their condition holds.
    // ======================================================================

    // Block Emacs until COND() is true.
    //   timeoutMs < 0  wait forever
    //   quit           C-g typed meanwhile requests a quit in Emacs and ends the
    //                  wait with 'eintr' (the key is consumed, like the tty
    //                  driver's interrupt character)
    //   keyboard       pending keyboard input ends the wait with 'keyboard'
    //   sigchld        run Emacs's SIGCHLD handler when a child changes state
    //                  (select/poll: the handler makes Emacs's self-pipe readable)
    // Returns 'ok' | 'timeout' | 'eintr' | 'keyboard'.
    _emacsBlock(cond, timeoutMs, { quit = false, keyboard = false, sigchld = false } = {}) {
      const env = this.env;
      const deadline = timeoutMs < 0 ? Infinity : env.now() + timeoutMs;
      env.flushTerminalOutput();
      for (;;) {
        // Read the wake counter before looking at the keyboard, so that a key
        // arriving later still ends the wait below.
        const epoch = env.inputEpoch ? env.inputEpoch() : 0;
        env.drainKeyboard();
        if (cond()) return 'ok';
        if (keyboard && env.keyboardPending()) return 'keyboard';
        if (quit && env.takeQuitChar()) {
          env.requestQuit();
          return 'eintr';
        }
        this.pump(this.pumpMs);
        if (sigchld) this._deliverSigchld();
        if (cond()) return 'ok';
        const now = env.now();
        if (now >= deadline) return 'timeout';
        if (this.runq.length === 0) {
          // Nothing can change until a key arrives or a sleeper is due.
          env.waitForInput(Math.min(deadline - now, this._nextTimerDelay(now), 1000), epoch);
        }
      }
    }

    // pipe2() for Emacs.
    emacsPipe2(fdPtr, flags) {
      return this.sys_pipe2(this.emacs, fdPtr, flags);
    }

    // emacs_spawn(): start ARGV with fds STDIN/STDOUT/STDERR of Emacs as the
    // child's 0/1/2.  Nothing else is inherited.  Returns the pid or -errno.
    emacsSpawn(argv, env, cwd, stdio) {
      const FS = this.FS;
      if (cwd) {
        try {
          const lookup = FS.lookupPath(cwd, { follow: true });
          if (!FS.isDir(lookup.node.mode)) return -C.ENOTDIR;
          cwd = lookup.path;
        } catch (e) {
          return -(e && e.errno ? e.errno : C.ENOENT);
        }
      }
      const streams = [];
      try {
        this._withTable(streams, () => {
          stdio.forEach((fd, i) => {
            const src = this.emacs.streams[fd];
            if (!src) throw this.errno(C.EBADF);
            FS.dupStream(src, i).cloexec = false;
          });
        });
      } catch (e) {
        this._withTable(streams, () => {
          for (const s of streams) if (s) { try { FS.close(s); } catch (e2) { /* ignore */ } }
        });
        return -(e && e.errno ? e.errno : C.EBADF);
      }
      const r = this._spawn(this.emacs, { path: argv[0], argv, env, cwd: cwd || FS.currentPath, streams, newSession: true });
      return r.err ? -r.err : r.pid;
    }

    // waitpid() for Emacs.  Returns pid, 0 (WNOHANG, nothing yet) or -errno.
    emacsWaitpid(pid, statusPtr, options) {
      if (!(options & C.WNOHANG)) this.pump(this.pumpMs);
      for (;;) {
        const found = this._findChild(this.emacs, pid);
        if (found.none) return -C.ECHILD;
        if (found.zombie) {
          const z = found.zombie;
          if (statusPtr) this.env.views().HEAP32[statusPtr >> 2] = z.exitStatus;
          this._reap(z);
          return z.pid;
        }
        if (options & C.WNOHANG) return 0;
        const r = this._emacsBlock(() => !this._findChild(this.emacs, pid).running, -1, { quit: true });
        if (r === 'eintr') return -C.EINTR;
      }
    }

    // kill() for Emacs.  PID < 0 names a process group.
    emacsKill(pid, sig) {
      if (sig < 0 || sig >= C.NSIG) return -C.EINVAL;
      const targets = this._killTargets(this.emacs, pid).filter((t) => t !== this.emacs && t.state !== 'zombie');
      if (targets.length === 0) return -C.ESRCH;
      for (const t of targets) this._signal(t, sig);
      // Let the signalled processes react before Emacs looks again.
      this.pump(this.pumpMs);
      return 0;
    }

    // poll() for Emacs.  A tty descriptor is readable when keyboard bytes are
    // queued.  Returns the number of ready descriptors (0 on timeout or when a
    // quit was requested).
    emacsPoll(fds, nfds, timeout) {
      const env = this.env;
      const ttyReady = () => (env.keyboardPending() ? C.POLLIN | C.POLLOUT : C.POLLOUT);
      const { HEAP32, HEAP16 } = env.views();
      let watchesTty = false;
      for (let i = 0; i < nfds; i++) {
        const stream = this.FS.getStream(HEAP32[(fds + i * 8) >> 2]);
        if (stream && stream.tty && (HEAP16[(fds + i * 8 + 4) >> 1] & C.POLLIN)) watchesTty = true;
      }
      // A system call is a scheduling point even when it does not wait.
      this.pump(timeout === 0 ? this.sliceMs : this.pumpMs);
      this._deliverSigchld();
      env.drainKeyboard();
      let n = this._pollScan(fds, nfds, ttyReady);
      if (n > 0 || timeout === 0) return n;
      this._emacsBlock(() => (n = this._pollScan(fds, nfds, ttyReady)) > 0, timeout,
                       { quit: !watchesTty, sigchld: true });
      return n;
    }

    // True when processes did something Emacs has to look at since the last
    // call (output or EOF on one of its pipes, a child changed state).
    emacsAttention() {
      this._deliverSigchld();
      if (this.eventSeq === this.servicedSeq) return false;
      this.servicedSeq = this.eventSeq;
      return true;
    }
    // Tell Emacs that a child changed state (its SIGCHLD handler then reaps).
    _deliverSigchld() {
      if (!this.sigchldPending) return;
      this.sigchldPending = false;
      this.env.raiseSignal(C.SIGCHLD);
    }
    // Scheduling point of Emacs's idle keyboard wait: run processes for a
    // slice.  Returns the delay in ms until the scheduler needs to run again
    // (0 = processes are runnable, Infinity = nothing to do until input).
    emacsIdle() {
      this.pump(this.pumpMs);
      if (this.runq.length > 0) return 0;
      return this._nextTimerDelay(this.now());
    }
  }

  root.WasmacsKernel = {
    create(env) { return new Kernel(env); },
    constants: C,
    BlockRequest,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
