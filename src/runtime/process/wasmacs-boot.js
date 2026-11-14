/*
 * wasmacs-boot.js -- boot the process kernel and start init on it.
 *
 * The system comes up in this order (browser worker and Node harnesses alike):
 *
 *   1. A system module provides the filesystem: Emacs's Emscripten module, or
 *      the small base module (src/runtime/process/base) when Emacs is not
 *      loaded.
 *   2. WasmacsBoot.boot() creates the kernel on that filesystem and connects
 *      it to the console (the keyboard buffer shared with the page, the
 *      terminal output) and to the program loader.
 *   3. The caller mounts /home/user and installs the userland (/bin, /etc).
 *   4. Init starts.  Emacs: the caller runs its main(); Emacs attaches itself
 *      to the kernel as the host process, pid 1 (see attachHost in
 *      wasmacs-kernel.js).  Any other program: WasmacsBoot.runInit() starts it
 *      as pid 1 on a pseudoterminal that is wired to the console, and drives
 *      the scheduler as the kernel's console task (pid 0) until init exits.
 *
 * Like the kernel this is plain synchronous JS: runInit() never returns to
 * the event loop while init runs.
 */
(function (root) {
  'use strict';

  const BASE_DIRECTORIES = ['/tmp', '/home', '/home/user'];
  // Keep at most this much terminal output that the page already has.
  const OUTPUT_KEEP = 1 << 20;

  // The console: keyboard bytes arrive from the page in a SharedArrayBuffer
  // (root.__wasmacsInputSAB: Int32 wake counter, Int32 byte count, bytes) and
  // are queued in root.__wasmacsTerminalInputBytes; terminal output is
  // collected in root.__wasmacsTerminalOutputBytes and posted to the page.
  // Emacs's terminal reads and writes the same queues (host library).  The
  // globals are looked up at every call: a harness may replace them.
  //   post(message)   send a message to the page (default: self.postMessage)
  //   keepOutput      never drop output the page already has (tests read it)
  function createConsole({ post = null, keepOutput = false } = {}) {
    // Atomics.wait as it is now: the worker later wraps the global one to
    // save /home/user before Emacs sleeps, which short scheduling waits must
    // not trigger.
    const rawWait = Atomics.wait.bind(Atomics);
    let sleepCell = null;
    const send = post || ((message) => {
      if (root.self && typeof root.self.postMessage === 'function') root.self.postMessage(message);
    });
    const inputSignal = () => (root.__wasmacsInputSAB ? new Int32Array(root.__wasmacsInputSAB, 0, 2) : null);
    const queue = () => root.__wasmacsTerminalInputBytes || (root.__wasmacsTerminalInputBytes = []);
    return {
      // Move the bytes the page put into the shared buffer to the input queue
      // and free the buffer for the next chunk.
      drainKeyboard() {
        const signal = inputSignal();
        if (!signal) return 0;
        const byteCount = Atomics.load(signal, 1);
        if (byteCount > 0) {
          const data = new Uint8Array(root.__wasmacsInputSAB, 8, byteCount);
          const q = queue();
          for (let i = 0; i < byteCount; i++) q.push(data[i]);
          Atomics.store(signal, 1, 0);
        }
        return byteCount;
      },
      keyboardPending() { return queue().length > 0; },
      // Remove one C-g (Emacs's quit character) from the queued input.
      takeQuitChar() {
        const q = queue();
        const index = q.indexOf(7);
        if (index < 0) return false;
        q.splice(index, 1);
        return true;
      },
      // Take everything that is queued (the console task feeds it to init).
      takeInput() { return queue().splice(0); },
      // The wake counter of the keyboard buffer.  Read it BEFORE looking at
      // the keyboard and pass it to waitForInput, so that a key that arrives
      // in between is not slept through.
      inputEpoch() {
        const signal = inputSignal();
        return signal ? Atomics.load(signal, 0) : 0;
      },
      // Sleep for up to MS milliseconds, or until the page signals keyboard
      // input, a resize or a finished HTTP request.
      waitForInput(ms, epoch) {
        ms = Math.max(0, Math.min(ms, 1000));
        const signal = inputSignal();
        if (signal) {
          rawWait(signal, 0, epoch, ms);
        } else {
          if (!sleepCell) sleepCell = new Int32Array(new SharedArrayBuffer(4));
          rawWait(sleepCell, 0, 0, ms);
        }
      },
      write(bytes, offset = 0, length = bytes.length - offset) {
        const out = root.__wasmacsTerminalOutputBytes || (root.__wasmacsTerminalOutputBytes = []);
        for (let i = 0; i < length; i++) out.push(bytes[offset + i]);
      },
      writeText(text) { this.write(new TextEncoder().encode(text)); },
      // Send what was written since the last flush to the page.
      flushTerminalOutput() {
        const out = root.__wasmacsTerminalOutputBytes || [];
        const sent = root.__wasmacsSentOutputCount || 0;
        if (out.length > sent) {
          send({ type: 'terminal-output-bytes', bytes: Array.prototype.slice.call(out, sent) });
          root.__wasmacsSentOutputCount = out.length;
        }
        if (!keepOutput && out.length > OUTPUT_KEEP) {
          out.length = 0;
          root.__wasmacsSentOutputCount = 0;
        }
      },
      // { version, rows, cols } of the page's terminal.
      size() {
        const sab = root.__wasmacsTerminalSizeSAB;
        if (!sab) return { version: 0, rows: root.__wasmacsTerminalRows || 24, cols: root.__wasmacsTerminalCols || 80 };
        const signal = new Int32Array(sab);
        return {
          version: Atomics.load(signal, 0),
          cols: Atomics.load(signal, 1) || root.__wasmacsTerminalCols || 80,
          rows: Atomics.load(signal, 2) || root.__wasmacsTerminalRows || 24,
        };
      },
    };
  }

  // Create the kernel on the filesystem FS and make it the system's kernel
  // (root.__wasmacsKernel, where Emacs's host library finds it).
  //   console       createConsole()
  //   loadProgram   name -> { factory, wasm } (synchronous)
  //   init          'emacs': Emacs will attach as the host process, pid 1
  //                 anything else: the console task is the host process
  //                 (pid 0) and runInit() starts init as pid 1
  //   views         heap views of the system module, for a console-task host
  function boot({ FS, console: cons, loadProgram, log = null, debug = false, init = 'emacs', views = null,
                  now = () => performance.now() }) {
    if (!root.WasmacsKernel) throw new Error('wasmacs-kernel.js is not loaded');
    const emacsIsInit = init === 'emacs';
    const kernel = root.WasmacsKernel.create({
      FS,
      debug,
      now,
      log,
      loadProgram,
      views,
      hostPid: emacsIsInit ? 1 : 0,
      hostName: emacsIsInit ? 'emacs' : 'kernel',
      firstPid: emacsIsInit ? undefined : 1,
      drainKeyboard: cons.drainKeyboard,
      keyboardPending: cons.keyboardPending,
      takeQuitChar: cons.takeQuitChar,
      inputEpoch: cons.inputEpoch,
      waitForInput: cons.waitForInput,
      flushTerminalOutput: cons.flushTerminalOutput,
    });
    kernel.console = cons;
    for (const dir of BASE_DIRECTORIES) { try { FS.mkdir(dir); } catch (e) { /* exists */ } }
    root.__wasmacsKernel = kernel;
    return kernel;
  }

  // Start ARGV as init (pid 1) on a new pseudoterminal and be its terminal:
  // console input goes to the master side, what init and its children write
  // comes back out, the page's terminal size is the window size.  Runs the
  // scheduler until init exits and returns its wait(2) status.
  //   env         "K=V" strings
  //   cwd         working directory of init
  //   beforeIdle  called before the thread sleeps (to save /home/user)
  function runInit(kernel, { argv, env = [], cwd = '/', beforeIdle = null }) {
    const FS = kernel.FS, C = kernel.C, cons = kernel.console;
    if (kernel.host.pid !== 0) throw new Error('runInit needs a kernel booted without Emacs as init');
    const master = FS.open('/dev/ptmx', C.O_RDWR | C.O_NONBLOCK | C.O_NOCTTY);
    const pty = master.pty;
    pty.locked = false;                    // unlockpt
    let size = cons.size();
    kernel.ptyResize(pty, size.rows, size.cols);
    const pid = kernel.emacsSpawn(argv, env, cwd, [-1, -1, -1], pty.path);
    if (pid < 0) {
      FS.close(master);
      throw new Error(`cannot start init ${argv[0]}: errno ${-pid}`);
    }
    const buffer = new Uint8Array(65536);
    let pending = [];                      // console input the terminal has not taken yet
    // Whatever the terminal has to say goes to the console.
    const drainOutput = () => {
      for (;;) {
        let n;
        try { n = FS.read(master, buffer, 0, buffer.length); } catch (e) { break; }  // EAGAIN, or EIO: no process left
        if (!n) break;
        cons.write(buffer, 0, n);
      }
      cons.flushTerminalOutput();
    };
    for (;;) {
      const epoch = cons.inputEpoch();
      cons.drainKeyboard();
      const typed = cons.takeInput();
      if (typed.length) pending = pending.concat(typed);
      if (pending.length) {
        try {
          const n = FS.write(master, Uint8Array.from(pending), 0, pending.length);
          pending = pending.slice(n);
        } catch (e) { /* EAGAIN: the terminal's input buffer is full */ }
      }
      const next = cons.size();
      if (next.version !== size.version) {
        size = next;
        kernel.ptyResize(pty, size.rows, size.cols);
      }
      kernel.pump(kernel.pumpMs);
      drainOutput();
      const status = kernel.hostReap(pid);
      if (status !== null) {
        drainOutput();
        FS.close(master);                  // hangs up whatever init left behind
        kernel.pump(kernel.pumpMs);
        return status;
      }
      if (!kernel.hasRunnable()) {
        if (pending.length) {
          cons.waitForInput(10, epoch);    // until the terminal takes more input
        } else {
          if (beforeIdle) beforeIdle();
          cons.waitForInput(Math.min(kernel._nextTimerDelay(kernel.now()), 1000), epoch);
        }
      }
    }
  }

  root.WasmacsBoot = { createConsole, boot, runInit, BASE_DIRECTORIES };
})(typeof globalThis !== 'undefined' ? globalThis : self);
