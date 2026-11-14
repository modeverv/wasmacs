/*
 * wasmacs-kernel.js -- the wasmacs Process Service.
 *
 * A small cooperative UNIX-like kernel for one worker thread.  It is booted
 * first (wasmacs-boot.js) and then starts an init program on top of itself:
 * GNU Emacs by default, or any userland program (/bin/sh on the console).
 * There are no host processes and no extra threads involved:
 *
 *   - A process is an Emscripten program instantiated in the same thread: its
 *     own WebAssembly.Instance and linear memory, built with -sASYNCIFY=1.
 *     A system call that has to wait (read on an empty pipe, waitpid, sleep,
 *     fork ...) unwinds the process back into the scheduler below; it is rewound
 *     when the reason for waiting is gone.
 *   - One process is different: the host process.  It is not asyncified, so
 *     it cannot be unwound, and the thread never returns to the worker's event
 *     loop while it runs.  Nothing in here may therefore rely on promises,
 *     timers or messages: everything is plain synchronous JS that runs inside
 *     one of the host process's system calls, and those calls are the
 *     scheduling points (idle wait, select/poll, blocking reads, waitpid,
 *     kill).  When Emacs is init, Emacs is the host process and pid 1.  With
 *     another init, the host process is the kernel's own console task (pid 0,
 *     WasmacsBoot.runInit) and init is an ordinary process with pid 1.
 *   - There is ONE filesystem: the Emscripten FS object of the system module
 *     (Emacs, or the base module when Emacs is not loaded).  Every process
 *     uses the very same JS object; the per-process file descriptor table
 *     (FS.streams) and working directory (FS.currentPath) are swapped at every
 *     context switch.
 *   - fork() unwinds the parent with Asyncify, copies its linear memory into a
 *     fresh instance of the same module and rewinds both.  execve() replaces the
 *     program image and keeps the pid and the file descriptors.
 *   - Pseudoterminals (/dev/ptmx, /dev/pts/N, /dev/tty) are devices of the
 *     shared FS.  The host process holds the master side (Emacs's term.el, or
 *     the console task for the terminal of init); the slave side is the
 *     controlling terminal of a session, with a line discipline in between.
 *
 * The file has no Emscripten macros and no dependency on the Emacs glue.  The
 * `env` object given to WasmacsKernel.create() supplies the filesystem, the
 * console and the program loader; a host process that lives in wasm memory
 * (Emacs) adds its own pieces with attachHost() (see
 * tools/scripts/wasmacs-atomics-host-library.js).  The child-side half is
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
    ELOOP: 32, ENXIO: 60,
    O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_ACCMODE: 2097155, O_CREAT: 64, O_EXCL: 128,
    O_NOCTTY: 256, O_TRUNC: 512, O_APPEND: 1024, O_NONBLOCK: 2048, O_CLOEXEC: 524288,
    S_IFMT: 0o170000, S_IFIFO: 0o010000, S_IFCHR: 0o020000, S_IFREG: 0o100000, S_IFDIR: 0o040000,
    POLLIN: 1, POLLPRI: 2, POLLOUT: 4, POLLERR: 8, POLLHUP: 16, POLLNVAL: 32,
    POLLRDNORM: 64, POLLWRNORM: 256,
    WNOHANG: 1, WUNTRACED: 2,
    SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGILL: 4, SIGABRT: 6, SIGKILL: 9, SIGSEGV: 11,
    SIGPIPE: 13, SIGALRM: 14, SIGTERM: 15, SIGCHLD: 17, SIGCONT: 18, SIGSTOP: 19,
    SIGTSTP: 20, SIGTTIN: 21, SIGTTOU: 22, SIGURG: 23, SIGWINCH: 28, NSIG: 65,
    FIONREAD: 0x541b,
    PIPE_BUF: 4096,
    // termios: c_cc indices and the c_iflag / c_oflag / c_cflag / c_lflag bits
    NCCS: 32, VINTR: 0, VQUIT: 1, VERASE: 2, VKILL: 3, VEOF: 4, VTIME: 5, VMIN: 6,
    VSTART: 8, VSTOP: 9, VSUSP: 10, VEOL: 11, VREPRINT: 12, VWERASE: 14, VLNEXT: 15, VEOL2: 16,
    ISTRIP: 0o40, INLCR: 0o100, IGNCR: 0o200, ICRNL: 0o400, IXON: 0o2000, IXANY: 0o4000,
    IUTF8: 0o40000,
    OPOST: 0o1, ONLCR: 0o4, OCRNL: 0o10, ONOCR: 0o20, ONLRET: 0o40, TABDLY: 0o14000, XTABS: 0o14000,
    B38400: 0o17, CS8: 0o60, CREAD: 0o200, HUPCL: 0o2000,
    ISIG: 0o1, ICANON: 0o2, ECHO: 0o10, ECHOE: 0o20, ECHOK: 0o40, ECHONL: 0o100, NOFLSH: 0o200,
    ECHOCTL: 0o1000, ECHOKE: 0o4000, IEXTEN: 0o100000,
    // ioctl(2) requests on terminals
    TCGETS: 0x5401, TCSETS: 0x5402, TCSETSW: 0x5403, TCSETSF: 0x5404, TCSBRK: 0x5409,
    TCXONC: 0x540a, TCFLSH: 0x540b, TIOCSCTTY: 0x540e, TIOCGPGRP: 0x540f, TIOCSPGRP: 0x5410,
    TIOCOUTQ: 0x5411, TIOCGWINSZ: 0x5413, TIOCSWINSZ: 0x5414, FIONBIO: 0x5421, TIOCNOTTY: 0x5422,
    TCSBRKP: 0x5425, TIOCGSID: 0x5429, TIOCGPTN: 0x80045430 | 0, TIOCSPTLCK: 0x40045431,
    FIONCLEX: 0x5450, FIOCLEX: 0x5451,
    TCOOFF: 0, TCOON: 1, TCIFLUSH: 0, TCOFLUSH: 1, TCIOFLUSH: 2,
    // posix_spawn: musl fdop.h FDOP_* and spawn.h POSIX_SPAWN_*
    FDOP_CLOSE: 1, FDOP_DUP2: 2, FDOP_OPEN: 3, FDOP_CHDIR: 4, FDOP_FCHDIR: 5,
    POSIX_SPAWN_SETPGROUP: 2, POSIX_SPAWN_SETSID: 128,
  });

  // Signals whose default action is not "terminate the process".  Stopping and
  // continuing are not modelled (no job control), so those are ignored too.
  const DEFAULT_IGNORED = new Set([C.SIGCHLD, C.SIGCONT, C.SIGSTOP, C.SIGTSTP, C.SIGTTIN,
                                   C.SIGTTOU, C.SIGURG, C.SIGWINCH]);

  // Emacs as init is the host process and pid 1; its children start here.
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

  // A bounded byte queue (ring buffer).  The buffer starts small and grows up
  // to CAPACITY, so the many queues that only ever carry a few bytes stay
  // cheap.
  class ByteQueue {
    constructor(capacity) {
      this.capacity = capacity;
      this.buf = new Uint8Array(0);
      this.head = 0;           // index of the first unread byte in buf
      this.size = 0;           // unread bytes
    }
    get free() { return this.capacity - this.size; }
    clear() { this.head = 0; this.size = 0; }
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

  let pipeSeq = 0;
  // A pipe: a byte queue shared by every descriptor open on one of its ends.
  class Pipe extends ByteQueue {
    constructor(capacity) {
      super(capacity);
      this.id = ++pipeSeq;
      this.readers = 0;        // number of fds (in any process) open for reading
      this.writers = 0;        // number of fds (in any process) open for writing
      this.rwait = new Set();  // processes waiting for data / EOF
      this.wwait = new Set();  // processes waiting for space / a reader to vanish
      this.hostOwned = false; // created by Emacs: activity must wake Emacs
    }
  }

  // struct termios of Emscripten's libc: four flag words, c_line, c_cc[NCCS]
  // and the two speeds.  It is stored as these bytes and handed back
  // unchanged: Emacs and stty compare what they read with what they set.
  const TERMIOS_SIZE = 60;
  const TERMIOS_CC = 17;
  const MAX_CANON = 4096;      // longest line in canonical mode (Linux N_TTY_BUF_SIZE)
  // The modes of a new terminal: Linux's tty_std_termios.
  function defaultTermios() {
    const t = new Uint8Array(TERMIOS_SIZE);
    const v = new DataView(t.buffer);
    v.setUint32(0, C.ICRNL | C.IXON, true);
    v.setUint32(4, C.OPOST | C.ONLCR, true);
    v.setUint32(8, C.B38400 | C.CS8 | C.CREAD | C.HUPCL, true);
    v.setUint32(12, C.ISIG | C.ICANON | C.ECHO | C.ECHOE | C.ECHOK | C.ECHOCTL | C.ECHOKE | C.IEXTEN, true);
    // ^C ^\ DEL ^U ^D, VTIME 0, VMIN 1, -, ^Q ^S ^Z, -, ^R ^O ^W ^V
    t.set([3, 28, 127, 21, 4, 0, 1, 0, 17, 19, 26, 0, 18, 15, 23, 22, 0], TERMIOS_CC);
    return t;
  }

  // A pseudoterminal.  The master side is what Emacs (term.el) reads and
  // writes; the slave side, /dev/pts/N, is the controlling terminal of a
  // session.  In between sits a line discipline after Linux's n_tty: input
  // processing, canonical line editing, echo, the signal characters and
  // output processing.
  class Pty {
    constructor(index, capacity) {
      this.index = index;
      this.input = new ByteQueue(capacity);   // what the slave reads
      this.inTotal = 0;                       // bytes ever put into input
      this.inTaken = 0;                       // bytes ever read from input
      this.lines = [];                        // canonical mode: { end, eof } of the complete lines in input
      this.edit = [];                         // canonical mode: the line being edited
      this.editColumn = 0;                    // output column where that line started
      this.output = new ByteQueue(capacity);  // what the master reads
      this.column = 0;                        // output column (tabs, erasing)
      this.termios = defaultTermios();
      this.rows = 24;
      this.cols = 80;
      this.xpixel = 0;
      this.ypixel = 0;
      this.masters = 0;         // descriptors open on the master side
      this.slaves = 0;          // descriptors open on the slave side
      this.slaveOpened = false;
      this.locked = true;       // until unlockpt()
      this.hungUp = false;      // the master side was closed
      this.stopped = false;     // output stopped by the STOP character (IXON)
      this.lnext = false;       // the next input character is taken literally
      this.sid = 0;             // the session this is the controlling terminal of
      this.fgPgrp = 0;          // its foreground process group
      this.hostOwned = false;  // Emacs holds the master: output must wake it
      this.slaveReaders = new Set();  // processes waiting for input (or a hangup)
      this.slaveWriters = new Set();  // processes waiting for room in output
      this.masterReaders = new Set(); // processes waiting for output (or the slave to close)
      this.masterWriters = new Set(); // processes waiting for room in input
    }
    _flag(offset) {
      const t = this.termios;
      return (t[offset] | t[offset + 1] << 8 | t[offset + 2] << 16 | t[offset + 3] << 24) >>> 0;
    }
    get iflag() { return this._flag(0); }
    get oflag() { return this._flag(4); }
    get lflag() { return this._flag(12); }
    cc(index) { return this.termios[TERMIOS_CC + index]; }
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
      this.ptys = new Map();     // /dev/pts/N index -> Pty
      this.maxPtys = 64;
      this.ttyCapacity = 65536;  // bytes of input / output a pty buffers
      this.nextPid = env.firstPid === undefined ? FIRST_PID : env.firstPid;
      this.debug = !!env.debug;
      this.stats = { spawns: 0, forks: 0, execs: 0, exits: 0, switches: 0 };
      // Process activity that Emacs has to look at (output on its pipes, EOF,
      // child status changes) is counted here; see emacsAttention().
      this.eventSeq = 0;
      this.servicedSeq = 0;
      this.sigchldPending = false;
      // The host process (see the top of the file): Emacs as pid 1, or the
      // console task as pid 0.  Its fd table is the live FS.streams array.
      this.host = new Process(env.hostPid === undefined ? 1 : env.hostPid, 0);
      this.host.name = env.hostName || 'emacs';
      this.host.state = 'running';
      this.host.streams = this.FS.streams;
      this.procs.set(this.host.pid, this.host);
      this.current = this.host;
      this._initPipeOps();
      this._initTtyOps();
      this._installTtyDevices();
    }

    // The host process is a wasm program (Emacs): HOST supplies what only it
    // knows.  views() are its heap views, for system call arguments;
    // raiseSignal(sig) runs its signal handlers; requestQuit() makes it quit
    // what it is doing (C-g while it waits for a subprocess).
    attachHost(host) {
      if (host.name) this.host.name = host.name;
      for (const key of ['views', 'raiseSignal', 'requestQuit']) {
        if (host[key]) this.env[key] = host[key];
      }
      return this;
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
      return this.current === this.host ? this.env.views() : this.current.inst.views();
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
            if (k.current === k.host) {
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
              if (k.current !== k.host) k._signal(k.current, C.SIGPIPE);
              throw k.errno(C.EPIPE);
            }
            const free = pipe.capacity - pipe.size;
            // Writes of up to PIPE_BUF bytes are atomic.
            if (free > 0 && !(length <= C.PIPE_BUF && free < length)) {
              const n = Math.min(free, length);
              pipe.put(buffer, offset, n);
              k._wakeSet(pipe.rwait);
              if (pipe.hostOwned && FS.streams !== k.host.streams) k.eventSeq++;
              return n;
            }
            if (stream.flags & C.O_NONBLOCK) throw k.errno(C.EAGAIN);
            if (k.current === k.host) {
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
            if (pipe.hostOwned && FS.streams !== k.host.streams) k.eventSeq++;
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
      pipe.hostOwned = this.current === this.host;
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

    // ----------------------------------------------------------------- ttys
    // /dev/ptmx opens the master side of a new pseudoterminal and creates its
    // slave side /dev/pts/N; /dev/tty is the controlling terminal of the
    // caller.  For Emacs, /dev/tty stays its own terminal (the console).
    _installTtyDevices() {
      const FS = this.FS;
      if (typeof FS.registerDevice !== 'function') return;   // a host without devices: no terminals
      FS.mkdirTree('/dev/pts');
      const ptmx = FS.makedev(5, 2);
      FS.registerDevice(ptmx, { open: (stream) => this._openPtmx(stream) });
      try { FS.mkdev('/dev/ptmx', 0o666, ptmx); } catch (e) { if (e.errno !== C.EEXIST) throw e; }
      const ttyDev = FS.makedev(5, 0);
      const previous = FS.getDevice(ttyDev);
      const consoleOps = previous && (previous.consoleOps || previous.stream_ops);
      FS.registerDevice(ttyDev, { open: (stream) => this._openTty(stream, consoleOps) });
      FS.getDevice(ttyDev).consoleOps = consoleOps;
    }
    // A device open that fails must also free the descriptor FS.open took.
    _refuseOpen(stream, errno) {
      this.FS.closeStream(stream.fd);
      throw this.errno(errno);
    }
    _openTty(stream, consoleOps) {
      const p = this.current;
      if (p === this.host && consoleOps) {
        stream.stream_ops = consoleOps;
        if (consoleOps.open) consoleOps.open(stream);
        return;
      }
      const pty = this._ctty(p);
      if (!pty) this._refuseOpen(stream, C.ENXIO);
      this._attachTty(stream, pty, false);
    }
    _openPtmx(stream) {
      const FS = this.FS;
      let index = 0;
      while (this.ptys.has(index)) index++;
      if (index >= this.maxPtys) this._refuseOpen(stream, C.EAGAIN);
      const pty = new Pty(index, this.ttyCapacity);
      pty.dev = FS.makedev(136, index);
      pty.path = `/dev/pts/${index}`;
      pty.hostOwned = this.current === this.host;
      FS.registerDevice(pty.dev, { open: (s) => this._openPts(s, pty) });
      try { FS.unlink(pty.path); } catch (e) { /* not there */ }
      FS.mkdev(pty.path, 0o620, pty.dev);
      this.ptys.set(index, pty);
      this._attachTty(stream, pty, true);
    }
    _openPts(stream, pty) {
      if (pty.locked || pty.hungUp || this.ptys.get(pty.index) !== pty) this._refuseOpen(stream, C.EIO);
      this._attachTty(stream, pty, false);
      // A session leader without a terminal acquires the first one it opens.
      const p = this.current;
      if (!(stream.flags & C.O_NOCTTY) && p !== this.host && p.sid === p.pid && !pty.sid && !this._ctty(p)) {
        this._setCtty(p, pty);
      }
    }
    _attachTty(stream, pty, master) {
      stream.stream_ops = master ? this.ptmOps : this.ptsOps;
      stream.pty = pty;
      stream.ptyMaster = master;
      stream.seekable = false;
      if (master) {
        pty.masters++;
      } else {
        pty.slaves++;
        pty.slaveOpened = true;
      }
    }
    // The controlling terminal of P's session, or null.  Emacs has none.
    _ctty(p) {
      if (!p || p === this.host) return null;
      for (const pty of this.ptys.values()) if (pty.sid && pty.sid === p.sid) return pty;
      return null;
    }
    _setCtty(p, pty) {
      pty.sid = p.sid;
      pty.fgPgrp = p.pgid;
    }
    // The session loses its controlling terminal (its leader exited, or
    // TIOCNOTTY): SIGHUP and SIGCONT to the foreground process group.
    _ttyDisassociate(pty) {
      const fg = pty.fgPgrp;
      pty.sid = 0;
      pty.fgPgrp = 0;
      if (fg) {
        this._signalGroup(fg, C.SIGHUP);
        this._signalGroup(fg, C.SIGCONT);
      }
    }
    // The master side was closed: the slave side reads end-of-file, writes
    // fail, and the session is hung up.
    _ttyHangup(pty) {
      pty.hungUp = true;
      const leader = pty.sid ? this.procs.get(pty.sid) : null;
      this._ttyDisassociate(pty);
      if (leader && leader !== this.current) this._signal(leader, C.SIGHUP);
      this._wakeSet(pty.slaveReaders);
      this._wakeSet(pty.slaveWriters);
    }
    // Remove the pseudoterminal once neither side is open.
    _ttyMaybeFree(pty) {
      if (pty.masters > 0 || pty.slaves > 0 || this.ptys.get(pty.index) !== pty) return;
      this.ptys.delete(pty.index);
      try { this.FS.unlink(pty.path); } catch (e) { /* already gone */ }
      delete this.FS.devices[pty.dev];
    }
    // Send SIG to every process of group PGID; the running process, which
    // may die of it, last.
    _signalGroup(pgid, sig) {
      let self = false;
      for (const t of [...this.procs.values()]) {
        if (t === this.host || t.state === 'zombie' || t.pgid !== pgid) continue;
        if (t === this.current) { self = true; continue; }
        this._signal(t, sig);
      }
      if (self) this._signal(this.current, sig);
    }

    // Output processing (OPOST) of byte C into OUT[N...]; returns the new N.
    // It adds at most 8 bytes (a tab expanded to spaces).
    _ttyOutChar(pty, c, out, n) {
      const oflag = pty.oflag;
      if (!(oflag & C.OPOST)) {
        out[n++] = c;
        return n;
      }
      switch (c) {
        case 10:
          if (oflag & C.ONLRET) pty.column = 0;
          if (oflag & C.ONLCR) {
            pty.column = 0;
            out[n++] = 13;
          }
          out[n++] = 10;
          return n;
        case 13:
          if ((oflag & C.ONOCR) && pty.column === 0) return n;
          if (oflag & C.OCRNL) {
            if (oflag & C.ONLRET) pty.column = 0;
            out[n++] = 10;
            return n;
          }
          pty.column = 0;
          out[n++] = 13;
          return n;
        case 9: {
          const spaces = 8 - (pty.column & 7);
          pty.column += spaces;
          if ((oflag & C.TABDLY) === C.XTABS) {
            for (let i = 0; i < spaces; i++) out[n++] = 32;
            return n;
          }
          out[n++] = 9;
          return n;
        }
        case 8:
          if (pty.column > 0) pty.column--;
          out[n++] = 8;
          return n;
        default:
          if (c >= 32 && c !== 127 && !((pty.iflag & C.IUTF8) && (c & 0xc0) === 0x80)) pty.column++;
          out[n++] = c;
          return n;
      }
    }
    // Queue COUNT bytes of BYTES[OFFSET...] for the master, as many as fit.
    _ttyEmit(pty, bytes, offset, count) {
      const n = Math.min(count, pty.output.free);
      if (n <= 0) return;
      pty.output.put(bytes, offset, n);
      this._wakeSet(pty.masterReaders);
      if (pty.hostOwned) this.eventSeq++;
    }
    // What the slave writes, through output processing.  Returns how many of
    // the LENGTH bytes fitted into the master's queue.
    _ttyWrite(pty, buffer, offset, length) {
      const room = pty.output.free;
      if (!(pty.oflag & C.OPOST)) {
        const n = Math.min(room, length);
        this._ttyEmit(pty, buffer, offset, n);
        return n;
      }
      if (room < 8) return 0;
      const out = new Uint8Array(Math.min(room, length * 2 + 8));
      let n = 0, i = 0;
      while (i < length && n + 8 <= out.length) {
        n = this._ttyOutChar(pty, buffer[offset + i] & 0xff, out, n);
        i++;
      }
      this._ttyEmit(pty, out, 0, n);
      return i;
    }
    _ttyEchoRaw(pty, bytes) {
      const out = new Uint8Array(bytes.length * 8);
      let n = 0;
      for (const c of bytes) n = this._ttyOutChar(pty, c, out, n);
      this._ttyEmit(pty, out, 0, n);
    }
    // Echo C; with ECHOCTL a control character as ^X.
    _ttyEchoChar(pty, c) {
      if ((pty.lflag & C.ECHOCTL) && (c < 32 || c === 127) && c !== 9 && c !== 10) {
        this._ttyEchoRaw(pty, [94, c ^ 0x40]);
      } else {
        this._ttyEchoRaw(pty, [c]);
      }
    }
    // The output column after echoing B at column COL.
    _ttyEchoWidth(pty, b, col) {
      if (b === 9) return (col | 7) + 1;
      if (b < 32 || b === 127) return (pty.lflag & C.ECHOCTL) ? col + 2 : col;
      if ((pty.iflag & C.IUTF8) && (b & 0xc0) === 0x80) return col;
      return col + 1;
    }

    // Input processing of one byte written to the master (n_tty's
    // receive_char).  Signals go to SIGS; the caller sends them.
    _ttyReceive(pty, c, sigs) {
      const iflag = pty.iflag, lflag = pty.lflag;
      if (iflag & C.ISTRIP) c &= 0x7f;
      if (pty.lnext) {
        pty.lnext = false;
        this._ttyStore(pty, c);
        return;
      }
      if (iflag & C.IXON) {
        if (c && c === pty.cc(C.VSTOP)) {
          pty.stopped = true;
          return;
        }
        if (c && c === pty.cc(C.VSTART)) {
          this._ttyStart(pty);
          return;
        }
        if (pty.stopped && (iflag & C.IXANY)) this._ttyStart(pty);
      }
      if (c === 13) {
        if (iflag & C.IGNCR) return;
        if (iflag & C.ICRNL) c = 10;
      } else if (c === 10 && (iflag & C.INLCR)) {
        c = 13;
      }
      if (c && (lflag & C.ISIG)) {
        const sig = c === pty.cc(C.VINTR) ? C.SIGINT : c === pty.cc(C.VQUIT) ? C.SIGQUIT
          : c === pty.cc(C.VSUSP) ? C.SIGTSTP : 0;
        if (sig) {
          if (!(lflag & C.NOFLSH)) this._ttyFlush(pty, true, true);
          if (lflag & C.ECHO) this._ttyEchoChar(pty, c);
          sigs.push(sig);
          return;
        }
      }
      if (!(lflag & C.ICANON)) {
        this._ttyStore(pty, c);
        return;
      }
      if (c) {
        if (c === pty.cc(C.VERASE)) return this._ttyErase(pty, 'erase');
        if (c === pty.cc(C.VKILL)) return this._ttyErase(pty, 'kill');
        if (lflag & C.IEXTEN) {
          if (c === pty.cc(C.VWERASE)) return this._ttyErase(pty, 'werase');
          if (c === pty.cc(C.VLNEXT)) {
            pty.lnext = true;
            if ((lflag & C.ECHO) && (lflag & C.ECHOCTL)) {
              if (pty.edit.length === 0) pty.editColumn = pty.column;
              this._ttyEchoRaw(pty, [94, 8]);
            }
            return;
          }
          if (c === pty.cc(C.VREPRINT)) {
            if (lflag & C.ECHO) {
              this._ttyEchoChar(pty, c);
              this._ttyEchoRaw(pty, [10]);
              pty.editColumn = pty.column;
              for (const b of pty.edit) this._ttyEchoChar(pty, b);
            }
            return;
          }
        }
      }
      if (c === 10) {
        if (lflag & (C.ECHO | C.ECHONL)) this._ttyEchoRaw(pty, [10]);
        pty.edit.push(c);
        this._ttyCommitLine(pty, false);
        return;
      }
      if (c && c === pty.cc(C.VEOF)) {
        this._ttyCommitLine(pty, true);
        return;
      }
      if (c && (c === pty.cc(C.VEOL) || ((lflag & C.IEXTEN) && c === pty.cc(C.VEOL2)))) {
        if (lflag & C.ECHO) this._ttyEchoChar(pty, c);
        pty.edit.push(c);
        this._ttyCommitLine(pty, false);
        return;
      }
      this._ttyStore(pty, c);
    }
    // An ordinary input character: into the line being edited (canonical
    // mode) or straight into the input queue.
    _ttyStore(pty, c) {
      const lflag = pty.lflag;
      if (lflag & C.ICANON) {
        if (pty.edit.length >= MAX_CANON - 1) return;   // the line is full (Linux drops it too)
        if (lflag & C.ECHO) {
          if (pty.edit.length === 0) pty.editColumn = pty.column;
          this._ttyEchoChar(pty, c);
        }
        pty.edit.push(c);
        return;
      }
      if (lflag & C.ECHO) this._ttyEchoChar(pty, c);
      pty.input.put(Uint8Array.of(c), 0, 1);
      pty.inTotal++;
    }
    // The line being edited is complete and becomes readable.  EOF: it was
    // ended by VEOF, which is not part of it (an empty one reads as EOF).
    _ttyCommitLine(pty, eof) {
      const n = pty.edit.length;
      if (n) pty.input.put(Uint8Array.from(pty.edit), 0, n);
      pty.edit.length = 0;
      pty.inTotal += n;
      pty.lines.push({ end: pty.inTotal, eof });
    }
    // VERASE, VWERASE and VKILL in canonical mode, with their echo.
    _ttyErase(pty, kind) {
      const lflag = pty.lflag;
      if (pty.edit.length === 0) return;
      if (kind === 'kill') {
        if (!(lflag & C.ECHO)) {
          pty.edit.length = 0;
          return;
        }
        if (!(lflag & C.ECHOK) || !(lflag & C.ECHOKE) || !(lflag & C.ECHOE)) {
          pty.edit.length = 0;
          this._ttyEchoChar(pty, pty.cc(C.VKILL));
          if (lflag & C.ECHOK) this._ttyEchoRaw(pty, [10]);
          return;
        }
      }
      let seenWord = false;
      while (pty.edit.length) {
        // One character: with IUTF8 a lead byte and its continuation bytes.
        let start = pty.edit.length - 1;
        if (pty.iflag & C.IUTF8) while (start > 0 && (pty.edit[start] & 0xc0) === 0x80) start--;
        const c = pty.edit[start];
        if (kind === 'werase') {
          const word = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
          if (word) seenWord = true;
          else if (seenWord) break;
        }
        pty.edit.length = start;
        if (lflag & C.ECHO) this._ttyRubout(pty, c, kind);
        if (kind === 'erase') break;
      }
    }
    // Take the echo of C, just removed from the line being edited, back.
    _ttyRubout(pty, c, kind) {
      const lflag = pty.lflag;
      if (kind === 'erase' && !(lflag & C.ECHOE)) {
        this._ttyEchoChar(pty, pty.cc(C.VERASE));
        return;
      }
      if (c === 9) {
        // Back to the column where the tab started.
        let col = pty.editColumn;
        for (const b of pty.edit) col = this._ttyEchoWidth(pty, b, col);
        this._ttyEchoRaw(pty, new Array(Math.max(0, pty.column - col)).fill(8));
        return;
      }
      const control = c < 32 || c === 127;
      if (control && !(lflag & C.ECHOCTL)) return;   // its echo was invisible
      this._ttyEchoRaw(pty, control ? [8, 32, 8, 8, 32, 8] : [8, 32, 8]);
    }
    // Discard pending input (the slave's) and/or output (the master's).
    _ttyFlush(pty, input, output) {
      if (input) {
        pty.input.clear();
        pty.inTaken = pty.inTotal;
        pty.lines.length = 0;
        pty.edit.length = 0;
        pty.lnext = false;
        this._wakeSet(pty.masterWriters);
      }
      if (output) {
        pty.output.clear();
        this._wakeSet(pty.slaveWriters);
      }
    }
    _ttyStart(pty) {
      pty.stopped = false;
      this._wakeSet(pty.slaveWriters);
    }
    // tcsetattr(): the new modes, and what switching canonical mode does to
    // pending input (as in Linux).
    _ttySetTermios(pty, bytes) {
      const wasCanon = pty.lflag & C.ICANON;
      pty.termios.set(bytes);
      const canon = pty.lflag & C.ICANON;
      if (wasCanon && !canon) {
        // The line being edited becomes readable as it is.
        const n = pty.edit.length;
        if (n) pty.input.put(Uint8Array.from(pty.edit), 0, n);
        pty.inTotal += n;
        pty.edit.length = 0;
        pty.lines.length = 0;
      } else if (!wasCanon && canon) {
        // Pending input becomes one line.
        pty.lines.length = 0;
        if (pty.input.size) pty.lines.push({ end: pty.inTotal, eof: false });
      }
      if (pty.stopped && !(pty.iflag & C.IXON)) this._ttyStart(pty);
      this._wakeSet(pty.slaveReaders);
    }
    // Is there something for the slave to read?  POLL: as poll() sees it, in
    // non-canonical mode with VTIME 0 that means VMIN bytes.
    _ttyReadable(pty, poll) {
      if (pty.lflag & C.ICANON) return pty.lines.length > 0;
      const vmin = pty.cc(C.VMIN);
      return pty.input.size >= (poll && !pty.cc(C.VTIME) && vmin ? vmin : 1);
    }
    // Read up to LENGTH bytes of input for the slave: in canonical mode at
    // most one line, and 0 for an end-of-file.
    _ttyTake(pty, buffer, offset, length) {
      if (length === 0) return 0;
      let n;
      if (pty.lflag & C.ICANON) {
        const avail = pty.lines[0].end - pty.inTaken;
        n = avail ? pty.input.take(buffer, offset, Math.min(length, avail)) : 0;
        pty.inTaken += n;
        if (n === avail) pty.lines.shift();
      } else {
        n = pty.input.take(buffer, offset, length);
        pty.inTaken += n;
      }
      if (n) this._wakeSet(pty.masterWriters);
      return n;
    }

    _initTtyOps() {
      const k = this;
      const ioctl = (stream, op, arg) => k._ttyIoctl(stream, op, arg);
      const llseek = () => { throw k.errno(C.ESPIPE); };
      // The master side: what Emacs reads and writes.
      this.ptmOps = {
        read(stream, buffer, offset, length) {
          const pty = stream.pty;
          for (;;) {
            if (pty.output.size > 0) {
              const n = pty.output.take(buffer, offset, length);
              k._wakeSet(pty.slaveWriters);
              return n;
            }
            // No slave descriptor is open (any more): EIO, as in Linux.
            if (pty.slaves === 0) throw k.errno(C.EIO);
            if (stream.flags & C.O_NONBLOCK) throw k.errno(C.EAGAIN);
            if (k.current === k.host) {
              const r = k._emacsBlock(() => pty.output.size > 0 || pty.slaves === 0, -1, { quit: true });
              if (r === 'eintr') throw k.errno(C.EINTR);
              continue;
            }
            throw new BlockRequest({ kind: 'tty-read', sets: [pty.masterReaders], interruptible: true });
          }
        },
        write(stream, buffer, offset, length) {
          const pty = stream.pty;
          const room = () => pty.input.size + pty.edit.length < pty.input.capacity;
          for (;;) {
            // Nothing reads the slave side any more: the bytes are dropped.
            if (pty.slaves === 0 && pty.slaveOpened) return length;
            const sigs = [];
            let i = 0;
            while (i < length && room()) {
              k._ttyReceive(pty, buffer[offset + i] & 0xff, sigs);
              i++;
            }
            if (i > 0 || length === 0) {
              k._wakeSet(pty.slaveReaders);
              for (const sig of sigs) if (pty.fgPgrp) k._signalGroup(pty.fgPgrp, sig);
              return i;
            }
            if (stream.flags & C.O_NONBLOCK) throw k.errno(C.EAGAIN);
            if (k.current === k.host) {
              const r = k._emacsBlock(() => room() || (pty.slaves === 0 && pty.slaveOpened), -1, { quit: true });
              if (r === 'eintr') throw k.errno(C.EINTR);
              continue;
            }
            throw new BlockRequest({ kind: 'tty-write', sets: [pty.masterWriters], interruptible: true });
          }
        },
        dup(stream) {
          stream.pty.masters++;
        },
        close(stream) {
          const pty = stream.pty;
          if (--pty.masters > 0) return;
          k._ttyHangup(pty);
          k._ttyMaybeFree(pty);
        },
        poll(stream) {
          const pty = stream.pty;
          let mask = 0;
          if (pty.output.size > 0) mask |= C.POLLIN | C.POLLRDNORM;
          if (pty.slaves === 0) mask |= C.POLLHUP;
          if (pty.input.size + pty.edit.length < pty.input.capacity) mask |= C.POLLOUT | C.POLLWRNORM;
          return mask;
        },
        ioctl,
        llseek,
      };
      // The slave side: the terminal of the processes.
      this.ptsOps = {
        read(stream, buffer, offset, length) {
          const pty = stream.pty, p = k.current;
          for (;;) {
            if (pty.hungUp) return 0;
            let ready, until = null;
            if (pty.lflag & C.ICANON) {
              ready = pty.lines.length > 0;
            } else {
              const vmin = pty.cc(C.VMIN), vtime = pty.cc(C.VTIME), avail = pty.input.size;
              ready = vmin > 0 ? avail >= Math.min(vmin, length) : !vtime || avail > 0;
              if (!ready && vtime && p !== k.host) {
                // VTIME: a timeout for the whole read (VMIN 0), or a timer
                // that starts once some input has arrived.
                const deadline = p.restart && p.restart.kind === 'tty-read' ? p.restart.until
                  : vmin === 0 || avail > 0 ? k.now() + vtime * 100 : null;
                if (deadline !== null && k.now() >= deadline) ready = true;
                else until = deadline;
              }
            }
            if (ready) {
              if (p.restart && p.restart.kind === 'tty-read') p.restart = null;
              return k._ttyTake(pty, buffer, offset, length);
            }
            if (stream.flags & C.O_NONBLOCK) throw k.errno(C.EAGAIN);
            if (p === k.host) {
              const r = k._emacsBlock(() => pty.hungUp || k._ttyReadable(pty, false), -1, { quit: true });
              if (r === 'eintr') throw k.errno(C.EINTR);
              continue;
            }
            if (until !== null) p.restart = { kind: 'tty-read', until };
            throw new BlockRequest({ kind: 'tty-read', sets: [pty.slaveReaders], until, interruptible: true });
          }
        },
        write(stream, buffer, offset, length) {
          const pty = stream.pty;
          for (;;) {
            if (pty.hungUp) throw k.errno(C.EIO);
            if (length === 0) return 0;
            if (!pty.stopped) {
              const n = k._ttyWrite(pty, buffer, offset, length);
              if (n > 0) return n;
            }
            if (stream.flags & C.O_NONBLOCK) throw k.errno(C.EAGAIN);
            if (k.current === k.host) {
              const r = k._emacsBlock(() => pty.hungUp || (!pty.stopped && pty.output.free >= 8), -1, { quit: true });
              if (r === 'eintr') throw k.errno(C.EINTR);
              continue;
            }
            throw new BlockRequest({ kind: 'tty-write', sets: [pty.slaveWriters], interruptible: true });
          }
        },
        dup(stream) {
          stream.pty.slaves++;
        },
        close(stream) {
          const pty = stream.pty;
          if (--pty.slaves > 0) return;
          k._wakeSet(pty.masterReaders);
          k._wakeSet(pty.masterWriters);
          if (pty.hostOwned) k.eventSeq++;   // Emacs has to see the EIO
          k._ttyMaybeFree(pty);
        },
        poll(stream) {
          const pty = stream.pty;
          if (pty.hungUp) {
            return C.POLLIN | C.POLLRDNORM | C.POLLOUT | C.POLLWRNORM | C.POLLHUP | C.POLLERR;
          }
          let mask = 0;
          if (k._ttyReadable(pty, true)) mask |= C.POLLIN | C.POLLRDNORM;
          if (!pty.stopped && pty.output.free >= 8) mask |= C.POLLOUT | C.POLLWRNORM;
          return mask;
        },
        ioctl,
        llseek,
      };
    }

    // The window of PTY's terminal has a new size: SIGWINCH to the foreground
    // process group when it changed.
    ptyResize(pty, rows, cols, xpixel = 0, ypixel = 0) {
      const changed = rows !== pty.rows || cols !== pty.cols;
      pty.rows = rows;
      pty.cols = cols;
      pty.xpixel = xpixel;
      pty.ypixel = ypixel;
      if (changed && pty.fgPgrp) this._signalGroup(pty.fgPgrp, C.SIGWINCH);
    }

    // ioctl(2) on either side of a pseudoterminal (from Emacs or a process).
    // ARG is the argument word: a pointer into the caller's memory or a
    // value.  Returns 0 or -errno.
    _ttyIoctl(stream, op, arg) {
      const pty = stream.pty, master = stream.ptyMaster, p = this.current;
      const { HEAPU8, HEAP32, HEAP16 } = this._views();
      const own = this._ctty(p) === pty;   // the caller's controlling terminal
      switch (op) {
        case C.TCGETS:
          HEAPU8.set(pty.termios, arg);
          return 0;
        case C.TCSETS:
        case C.TCSETSW:
        case C.TCSETSF:
          if (op === C.TCSETSF) this._ttyFlush(pty, true, false);
          this._ttySetTermios(pty, HEAPU8.subarray(arg, arg + TERMIOS_SIZE));
          return 0;
        case C.TIOCGWINSZ:
          HEAP16[arg >> 1] = pty.rows;
          HEAP16[(arg >> 1) + 1] = pty.cols;
          HEAP16[(arg >> 1) + 2] = pty.xpixel;
          HEAP16[(arg >> 1) + 3] = pty.ypixel;
          return 0;
        case C.TIOCSWINSZ: {
          this.ptyResize(pty, HEAP16[arg >> 1] & 0xffff, HEAP16[(arg >> 1) + 1] & 0xffff,
                         HEAP16[(arg >> 1) + 2] & 0xffff, HEAP16[(arg >> 1) + 3] & 0xffff);
          return 0;
        }
        case C.TIOCGPGRP:
          if ((!master && !own) || !pty.fgPgrp) return -C.ENOTTY;
          HEAP32[arg >> 2] = pty.fgPgrp;
          return 0;
        case C.TIOCSPGRP: {
          if (master || !own) return -C.ENOTTY;
          const pgid = HEAP32[arg >> 2];
          if (pgid <= 0) return -C.EINVAL;
          for (const t of this.procs.values()) {
            if (t !== this.host && t.state !== 'zombie' && t.pgid === pgid && t.sid === pty.sid) {
              pty.fgPgrp = pgid;
              return 0;
            }
          }
          return -C.EPERM;
        }
        case C.TIOCGSID:
          if ((!master && !own) || !pty.sid) return -C.ENOTTY;
          HEAP32[arg >> 2] = pty.sid;
          return 0;
        case C.TIOCSCTTY:
          if (master || p === this.host || p.sid !== p.pid) return -C.EPERM;
          if (own) return 0;
          if (this._ctty(p) || (pty.sid && pty.sid !== p.sid)) return -C.EPERM;
          this._setCtty(p, pty);
          return 0;
        case C.TIOCNOTTY:
          if (!own) return -C.ENOTTY;
          if (p.sid === p.pid) this._ttyDisassociate(pty);
          return 0;
        case C.FIONREAD:
          HEAP32[arg >> 2] = master ? pty.output.size
            : !(pty.lflag & C.ICANON) ? pty.input.size
            : pty.lines.length ? pty.lines[0].end - pty.inTaken : 0;
          return 0;
        case C.TIOCOUTQ:
          HEAP32[arg >> 2] = master ? pty.input.size : pty.output.size;
          return 0;
        case C.FIONBIO:
          if (HEAP32[arg >> 2]) stream.flags |= C.O_NONBLOCK;
          else stream.flags &= ~C.O_NONBLOCK;
          return 0;
        case C.FIOCLEX:
        case C.FIONCLEX:
          stream.cloexec = op === C.FIOCLEX;
          return 0;
        case C.TCFLSH: {
          // Seen from the master, its input is what the slave wrote.
          const input = arg === C.TCIFLUSH || arg === C.TCIOFLUSH;
          const output = arg === C.TCOFLUSH || arg === C.TCIOFLUSH;
          if (!input && !output) return -C.EINVAL;
          if (master) this._ttyFlush(pty, output, input);
          else this._ttyFlush(pty, input, output);
          return 0;
        }
        case C.TCXONC:
          if (arg === C.TCOOFF) pty.stopped = true;
          else if (arg === C.TCOON) this._ttyStart(pty);
          return 0;
        case C.TCSBRK:
        case C.TCSBRKP:
          return 0;   // tcdrain(): output is never delayed
        case C.TIOCGPTN:
          if (!master) return -C.ENOTTY;
          HEAP32[arg >> 2] = pty.index;
          return 0;
        case C.TIOCSPTLCK:
          if (!master) return -C.ENOTTY;
          pty.locked = HEAP32[arg >> 2] !== 0;
          return 0;
        default:
          return -C.ENOTTY;
      }
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
      for (const p of this.procs.values()) if (p !== this.host && p.state !== 'zombie') n++;
      return n;
    }
    _newProc(parent) {
      const p = new Process(this.nextPid++, parent.pid);
      p.pgid = parent === this.host ? p.pid : parent.pgid;
      p.sid = parent === this.host ? p.pid : parent.sid;
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
      // A session leader takes its controlling terminal with it: the
      // foreground process group is hung up.
      if (p.sid === p.pid) {
        for (const pty of this.ptys.values()) if (pty.sid === p.sid) this._ttyDisassociate(pty);
      }
      // Orphans are adopted by the host process and reaped automatically.
      for (const c of p.children) {
        c.ppid = this.host.pid; c.autoReap = true; this.host.children.add(c);
        if (c.state === 'zombie') this._reap(c);
      }
      p.children.clear();
      if (p.vforkParent) this._vforkRelease(p);
      const parent = this.procs.get(p.ppid);
      if (p.autoReap || !parent) { this._reap(p); return; }
      if (parent === this.host) {
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
      if (target === this.host || target.state === 'zombie' || sig === 0) return;
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
          if (t === this.host || t.state === 'zombie') continue;
          if (pgid === null ? t !== p : t.pgid === pgid) out.push(t);
        }
      }
      return out;
    }
    sys_kill(p, pid, sig) {
      if (sig < 0 || sig >= C.NSIG) return -C.EINVAL;
      const targets = this._killTargets(p, pid).filter((t) => t !== this.host && t.state !== 'zombie');
      if (targets.length === 0) {
        // Signalling the host process from a process is not allowed.
        return pid === this.host.pid ? -C.EPERM : -C.ESRCH;
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
      if (parent !== this.host) { child.pgid = parent.pgid; child.sid = parent.sid; }
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
        const pty = stream && stream.pty;
        if (pty) {
          if (stream.ptyMaster) sets.push(pty.masterReaders, pty.masterWriters);
          else sets.push(pty.slaveReaders, pty.slaveWriters);
          continue;
        }
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
    // Host process side.  The host process is not asyncified: its blocking
    // calls run the scheduler in a loop until their condition holds.  The
    // emacs* entry points are the system calls of Emacs as the host process
    // (their pointer arguments refer to Emacs's memory).
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
          if (env.requestQuit) env.requestQuit();
          return 'eintr';
        }
        this.pump(this.pumpMs);
        // Output of this round first; its exits are reported by the next
        // poll (see emacsPoll).
        if (cond()) return 'ok';
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
      return this.sys_pipe2(this.host, fdPtr, flags);
    }

    // emacs_spawn(): start ARGV with fds STDIN/STDOUT/STDERR of Emacs as the
    // child's 0/1/2.  Nothing else is inherited.  With PTYNAME (a pty
    // process), the descriptors given as -1 are that terminal's slave side,
    // and it becomes the controlling terminal of the child's new session.
    // Returns the pid or -errno.
    emacsSpawn(argv, env, cwd, stdio, ptyName = null) {
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
      let pty = null;
      try {
        this._withTable(streams, () => {
          stdio.forEach((fd, i) => {
            if (fd < 0 && ptyName) {
              const s = FS.open(ptyName, C.O_RDWR | C.O_NOCTTY);
              pty = s.pty || null;
              if (s.fd !== i) {
                FS.dupStream(s, i).cloexec = false;
                FS.close(s);
              } else {
                s.cloexec = false;
              }
              return;
            }
            const src = this.host.streams[fd];
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
      const r = this._spawn(this.host, { path: argv[0], argv, env, cwd: cwd || FS.currentPath, streams, newSession: true });
      if (r.err) return -r.err;
      if (pty && !pty.sid) this._setCtty(this.procs.get(r.pid), pty);
      return r.pid;
    }

    // waitpid(PID, WNOHANG) for a host process without wasm memory (the
    // console task): the wait(2)-encoded status once PID has exited, else null.
    hostReap(pid) {
      const z = this._findChild(this.host, pid).zombie;
      if (!z) return null;
      const status = z.exitStatus;
      this._reap(z);
      return status;
    }

    // waitpid() for Emacs.  Returns pid, 0 (WNOHANG, nothing yet) or -errno.
    emacsWaitpid(pid, statusPtr, options) {
      if (!(options & C.WNOHANG)) this.pump(this.pumpMs);
      for (;;) {
        const found = this._findChild(this.host, pid);
        if (found.none) return -C.ECHILD;
        if (found.zombie) {
          const z = found.zombie;
          if (statusPtr) this.env.views().HEAP32[statusPtr >> 2] = z.exitStatus;
          this._reap(z);
          return z.pid;
        }
        if (options & C.WNOHANG) return 0;
        const r = this._emacsBlock(() => !this._findChild(this.host, pid).running, -1, { quit: true });
        if (r === 'eintr') return -C.EINTR;
      }
    }

    // kill() for Emacs.  PID < 0 names a process group.
    emacsKill(pid, sig) {
      if (sig < 0 || sig >= C.NSIG) return -C.EINVAL;
      const targets = this._killTargets(this.host, pid).filter((t) => t !== this.host && t.state !== 'zombie');
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
      // Children that exited in an earlier round are reported now.
      this._deliverSigchld();
      // A system call is a scheduling point even when it does not wait.
      this.pump(timeout === 0 ? this.sliceMs : this.pumpMs);
      env.drainKeyboard();
      let n = this._pollScan(fds, nfds, ttyReady);
      // What a child wrote is readable before its exit of the same round is
      // reported (the next call does that).  Emacs stops reading a process
      // when it learns of the exit, so accept-process-output with a timeout
      // could otherwise return without the last output of a process that
      // is already gone.
      if (n === 0) {
        this._deliverSigchld();
        n = this._pollScan(fds, nfds, ttyReady);
      }
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
      if (this.env.raiseSignal) this.env.raiseSignal(C.SIGCHLD);
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
