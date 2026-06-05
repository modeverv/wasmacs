/**
 * wasmacs-atomics-host-library.js
 *
 * Host library for Emacs wasm using SharedArrayBuffer + Atomics.wait
 * instead of Asyncify. This gives true blocking wait semantics.
 *
 * Architecture:
 *   C code calls wasmacs_host_wait_for_input()
 *     → flush pending terminal output via postMessage
 *     → Atomics.wait(inputSAB, 0, 0)  ← true blocking, no JS overhead
 *   Main thread (on user input):
 *     → write bytes to inputSAB
 *     → Atomics.notify(inputSAB, 0)
 *     → Worker wakes immediately
 *
 * SharedArrayBuffer layout (inputSAB):
 *   Int32[0]  (bytes 0-3):  signal  (0=idle, 1=input available)
 *   Int32[1]  (bytes 4-7):  byte count
 *   Uint8[8+] (bytes 8+):   input bytes (up to 256 bytes per wakeup)
 *
 * SharedArrayBuffer layout (terminalSizeSAB):
 *   Int32[0]: resize version
 *   Int32[1]: columns
 *   Int32[2]: rows
 *
 * No Asyncify, no JS wrapper frames, no call stack save/restore.
 */

mergeInto(LibraryManager.library, {
  // ── Terminal input/output state ────────────────────────────────
  $wasmacs_atomics_env__deps: ["$ENV", "$TTY"],
  $wasmacs_atomics_env__postset: [
    // Terminal environment (required by Emacs --nw)
    "ENV.TERM    = ENV.TERM    || 'xterm-256color';",
    "ENV.TERMCAP = ENV.TERMCAP || 'xterm-256color:co#80:li#24:Co#256:cl=\\\\E[H\\\\E[2J:cm=\\\\E[%i%d;%dH:up=\\\\E[A:do=\\\\E[B:nd=\\\\E[C:le=\\\\b:bs:ku=\\\\E[A:kd=\\\\E[B:kr=\\\\E[C:kl=\\\\E[D:kh=\\\\E[H:@7=\\\\E[F:kD=\\\\E[3~:ks=\\\\E[?1h\\\\E=:ke=\\\\E[?1l\\\\E>:ti=\\\\E[?1049h:te=\\\\E[?1049l:so=\\\\E[7m:se=\\\\E[27m:us=\\\\E[4m:ue=\\\\E[24m:md=\\\\E[1m:mr=\\\\E[7m:me=\\\\E[0m:AF=\\\\E[38;5;%dm:AB=\\\\E[48;5;%dm:op=\\\\E[39;49m:';",
    "ENV.HOME    = ENV.HOME    || '/home/user';",
    "ENV.USER    = ENV.USER    || 'wasmacs';",
    "ENV.LOGNAME = ENV.LOGNAME || 'wasmacs';",
    // Shared input buffer (SharedArrayBuffer, set from worker before importScripts)
    "globalThis.__wasmacsInputSAB = globalThis.__wasmacsInputSAB || null;",
    "globalThis.__wasmacsTerminalSizeSAB = globalThis.__wasmacsTerminalSizeSAB || null;",
    "globalThis.__wasmacsTerminalResizeSeen = globalThis.__wasmacsTerminalResizeSeen || 0;",
    // I/O buffers
    "globalThis.__wasmacsTerminalOutputBytes = globalThis.__wasmacsTerminalOutputBytes || [];",
    "globalThis.__wasmacsTerminalInputBytes  = globalThis.__wasmacsTerminalInputBytes  || [];",
    "globalThis.__wasmacsSentOutputCount     = globalThis.__wasmacsSentOutputCount     || 0;",
    "globalThis.__wasmacsHostWaitForInputCount = globalThis.__wasmacsHostWaitForInputCount || 0;",
    "globalThis.__wasmacsTerminalRows = globalThis.__wasmacsTerminalRows || 24;",
    "globalThis.__wasmacsTerminalCols = globalThis.__wasmacsTerminalCols || 80;",
    // TTY I/O hooks — wire Emacs terminal output into __wasmacsTerminalOutputBytes
    // Wrapped in try-catch to avoid breaking module initialization if TTY is not ready.
    "try {",
    "  if (typeof TTY !== 'undefined' && TTY.default_tty_ops) {",
    "    TTY.default_tty_ops.get_char = function () {",
    "      var q = globalThis.__wasmacsTerminalInputBytes || [];",
    "      return q.length ? q.shift() : undefined;",
    "    };",
    "    TTY.default_tty_ops.put_char = function (tty, val) {",
    "      if (val === null) return;",
    "      globalThis.__wasmacsTerminalOutputBytes.push(val & 255);",
    "    };",
    "    TTY.default_tty_ops.fsync = function () {};",
    "    TTY.default_tty_ops.ioctl_tcgets = function () {",
    "      return { c_iflag:0, c_oflag:0, c_cflag:2237, c_lflag:0,",
    "        c_cc:[3,28,127,21,4,0,1,0,17,19,26,0,18,15,23,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0] };",
    "    };",
    "    TTY.default_tty_ops.ioctl_tcsets = function () { return 0; };",
    "    TTY.default_tty_ops.ioctl_tiocgwinsz = function () {",
    "      return [globalThis.__wasmacsTerminalRows || 24, globalThis.__wasmacsTerminalCols || 80];",
    "    };",
    "  }",
    "  if (typeof TTY !== 'undefined' && TTY.default_tty1_ops) {",
    "    TTY.default_tty1_ops.put_char = function (tty, val) {",
    "      if (val === null) return;",
    "      globalThis.__wasmacsTerminalOutputBytes.push(val & 255);",
    "    };",
    "    TTY.default_tty1_ops.fsync = function () {};",
    "  }",
    "  // ── OS compat: add FIONREAD ioctl to TTY stream ops ──────────",
    "  // Emacs tty_read_avail_input calls ioctl(FIONREAD) to check how many",
    "  // bytes are available before calling emacs_read.  Emscripten's TTY",
    "  // stream_ops has no ioctl method by default, so we add one that",
    "  // reports bytes from our input queue.",
    "  if (typeof TTY !== 'undefined' && TTY.stream_ops) {",
    "    TTY.stream_ops.ioctl = function(stream, cmd, arg) {",
    "      if (cmd === 0x541B) {  // FIONREAD",
    "        globalThis.__wasmacsFionreadCallCount = (globalThis.__wasmacsFionreadCallCount || 0) + 1;",
    "        var q = globalThis.__wasmacsTerminalInputBytes || [];",
    "        var available = q.length;",
    "        if (stream.tty && stream.tty.input) available += stream.tty.input.length;",
    "        try { HEAP32[arg >> 2] = available; } catch(e) {}",
    "        globalThis.__wasmacsLastFionread = { ts: Date.now(), available: available, queueLen: q.length, callCount: globalThis.__wasmacsFionreadCallCount };",
    "        return 0;",
    "      }",
    "      // Fallback for other ioctls: return ENOTTY",
    "      return -25;",
    "    };",
    "  }",
    "} catch(e) {",
    "  // TTY setup failed — terminal output will not work but won't break initialization",
    "  console.warn('[wasmacs-atomics] TTY hook setup failed:', e);",
    "}",
  ].join("\n"),
  $wasmacs_atomics_env: {},

  // ── wasmacs_host_wait_for_input ────────────────────────────────
  // Called from kbd_buffer_get_event (keyboard.c patch).
  // Flushes terminal output, then blocks via Atomics.wait.
  // Includes timing diagnostics via postMessage for latency analysis.
  wasmacs_host_wait_for_input__deps: ["$wasmacs_atomics_env", "$FS"],
  wasmacs_host_wait_for_input: function () {
    var tEnter = Date.now();
    globalThis.__wasmacsHostWaitForInputCount =
      (globalThis.__wasmacsHostWaitForInputCount || 0) + 1;
    var waitNum = globalThis.__wasmacsHostWaitForInputCount;

    // ── 1. Flush pending terminal output ────────────────────────
    var outBytes = globalThis.__wasmacsTerminalOutputBytes || [];
    var sentCount = globalThis.__wasmacsSentOutputCount || 0;
    if (outBytes.length > sentCount) {
      var newBytes = Array.prototype.slice.call(outBytes, sentCount);
      globalThis.__wasmacsSentOutputCount = outBytes.length;
      if (typeof self !== "undefined" && typeof self.postMessage === "function") {
        self.postMessage({ type: "terminal-output-bytes", bytes: newBytes });
      }
    }

    // ── 2. Block via Atomics.wait ────────────────────────────────
    var sab = globalThis.__wasmacsInputSAB;
    if (!sab) return;
    var signal = new Int32Array(sab, 0, 2);

    for (;;) {
      var lastSeen = Atomics.load(signal, 0);
      if (Atomics.load(signal, 1) > 0) break;
      if (typeof self !== "undefined" && typeof self.postMessage === "function") {
        try {
          self.postMessage({
            type: "timing-wait-enter",
            waitNum: waitNum,
            ts: Date.now(),
            queueLen: (globalThis.__wasmacsTerminalInputBytes || []).length,
            outLen: (globalThis.__wasmacsTerminalOutputBytes || []).length,
            fioCalls: globalThis.__wasmacsFionreadCallCount || 0,
          });
        } catch(e) {}
      }
      var result = Atomics.wait(signal, 0, lastSeen);
      if (globalThis.__wasmacsTerminalSizeSAB) {
        try {
          var sizeSignal = new Int32Array(globalThis.__wasmacsTerminalSizeSAB);
          if (Atomics.load(sizeSignal, 0) !== (globalThis.__wasmacsTerminalResizeSeen || 0))
            return;
        } catch(e) {}
      }
      if (result === "ok" || Atomics.load(signal, 1) > 0) break;
    }

    // ── 3. Populate terminal input queue ─────────────────────────
    var byteCount = Atomics.load(signal, 1);
    if (byteCount > 0) {
      var data = new Uint8Array(sab, 8, byteCount);
      var queue = globalThis.__wasmacsTerminalInputBytes;
      for (var i = 0; i < byteCount; i++) queue.push(data[i]);
      Atomics.store(signal, 1, 0);
    }

    // ── 4. Timing diagnostic ─────────────────────────────────────
    if (typeof self !== "undefined" && typeof self.postMessage === "function") {
      try {
        var s0 = FS.getStream(0);
        self.postMessage({
          type: "timing",
          waitNum: waitNum,
          ts: Date.now(),
          totalMs: Date.now() - tEnter,
          byteCount: byteCount,
          queueLen: (globalThis.__wasmacsTerminalInputBytes||[]).length,
          fioCalls: globalThis.__wasmacsFionreadCallCount || 0,
          s0ioctl: s0 && s0.stream_ops ? typeof s0.stream_ops.ioctl : "no-stream",
        });
      } catch(e) {}
    }
  },

  // ── wasmacs_host_terminal_read_byte ───────────────────────────
  // Returns next byte from input queue, or -1 if empty.
  wasmacs_host_terminal_read_byte__deps: ["$wasmacs_atomics_env"],
  wasmacs_host_terminal_read_byte: function () {
    var queue = globalThis.__wasmacsTerminalInputBytes || [];
    if (queue.length > 0) {
      var b = queue.shift();
      console.log("[atomics host] read_byte=" + b + " remaining=" + queue.length);
      return b;
    }
    return -1;
  },

  // ── wasmacs_host_terminal_input_available ─────────────────────
  wasmacs_host_terminal_input_available__deps: ["$wasmacs_atomics_env"],
  wasmacs_host_terminal_input_available: function () {
    return (globalThis.__wasmacsTerminalInputBytes || []).length > 0 ? 1 : 0;
  },

  // ── wasmacs_host_terminal_resize_* ────────────────────────────
  wasmacs_host_terminal_resize_pending__deps: ["$wasmacs_atomics_env"],
  wasmacs_host_terminal_resize_pending: function () {
    var sab = globalThis.__wasmacsTerminalSizeSAB;
    if (!sab) return 0;
    var signal = new Int32Array(sab);
    return Atomics.load(signal, 0) !== (globalThis.__wasmacsTerminalResizeSeen || 0) ? 1 : 0;
  },

  wasmacs_host_terminal_resize_cols__deps: ["$wasmacs_atomics_env"],
  wasmacs_host_terminal_resize_cols: function () {
    var sab = globalThis.__wasmacsTerminalSizeSAB;
    if (!sab) return globalThis.__wasmacsTerminalCols || 80;
    var signal = new Int32Array(sab);
    return Atomics.load(signal, 1) || globalThis.__wasmacsTerminalCols || 80;
  },

  wasmacs_host_terminal_resize_rows__deps: ["$wasmacs_atomics_env"],
  wasmacs_host_terminal_resize_rows: function () {
    var sab = globalThis.__wasmacsTerminalSizeSAB;
    if (!sab) return globalThis.__wasmacsTerminalRows || 24;
    var signal = new Int32Array(sab);
    return Atomics.load(signal, 2) || globalThis.__wasmacsTerminalRows || 24;
  },

  wasmacs_host_terminal_resize_ack__deps: ["$wasmacs_atomics_env"],
  wasmacs_host_terminal_resize_ack: function () {
    var sab = globalThis.__wasmacsTerminalSizeSAB;
    if (!sab) return 0;
    var signal = new Int32Array(sab);
    globalThis.__wasmacsTerminalResizeSeen = Atomics.load(signal, 0);
    globalThis.__wasmacsTerminalCols = Atomics.load(signal, 1) || globalThis.__wasmacsTerminalCols || 80;
    globalThis.__wasmacsTerminalRows = Atomics.load(signal, 2) || globalThis.__wasmacsTerminalRows || 24;
    if (typeof self !== "undefined" && typeof self.postMessage === "function") {
      try {
        self.postMessage({
          type: "terminal-resized",
          cols: globalThis.__wasmacsTerminalCols,
          rows: globalThis.__wasmacsTerminalRows,
          version: globalThis.__wasmacsTerminalResizeSeen,
        });
      } catch(e) {}
    }
    return 0;
  },

  // ── wasmacs_host_is_tty_fd ────────────────────────────────────
  wasmacs_host_is_tty_fd__deps: ["$FS", "$wasmacs_atomics_env"],
  wasmacs_host_is_tty_fd: function (fd) {
    try {
      var stream = FS.getStream(fd);
      return stream && stream.tty ? 1 : 0;
    } catch (e) {
      return 0;
    }
  },

  // ── wasmacs_host_scheduler_checkpoint ─────────────────────────
  // Lightweight diagnostic hook (no-op in production).
  wasmacs_host_scheduler_checkpoint__deps: [],
  wasmacs_host_scheduler_checkpoint: function (code, _details) {
    if (typeof self !== "undefined" && typeof self.postMessage === "function") {
      try {
        self.postMessage({
          type: "scheduler-checkpoint",
          code: code,
          ts: Date.now(),
          queueLen: (globalThis.__wasmacsTerminalInputBytes || []).length,
          outLen: (globalThis.__wasmacsTerminalOutputBytes || []).length,
        });
      } catch(e) {}
    }
  },

  // ── wasmacs_host_input_text ───────────────────────────────────
  // Inject text input (used by legacy paths; queue directly).
  wasmacs_host_input_text__deps: ["$wasmacs_atomics_env"],
  wasmacs_host_input_text: function (strPtr) {
    var text = UTF8ToString(strPtr);
    var queue = globalThis.__wasmacsTerminalInputBytes;
    for (var i = 0; i < text.length; i++) {
      queue.push(text.charCodeAt(i) & 0xff);
    }
    return 0;
  },

  // ── wasmacs_host_input_cancel ─────────────────────────────────
  wasmacs_host_input_cancel__deps: ["$wasmacs_atomics_env"],
  wasmacs_host_input_cancel: function () {
    globalThis.__wasmacsTerminalInputBytes = [];
    return 0;
  },

  // ── wasmacs_os_timing_checkpoint ─────────────────────────────────
  // No-op stub for latency measurement calls from os-compat waitpoint.
  wasmacs_os_timing_checkpoint__deps: [],
  wasmacs_os_timing_checkpoint: function (code) {
    if (typeof self !== "undefined" && typeof self.postMessage === "function") {
      try {
        self.postMessage({
          type: "os-timing-checkpoint",
          code: code,
          ts: Date.now(),
          queueLen: (globalThis.__wasmacsTerminalInputBytes || []).length,
          outLen: (globalThis.__wasmacsTerminalOutputBytes || []).length,
        });
      } catch(e) {}
    }
  },
});
