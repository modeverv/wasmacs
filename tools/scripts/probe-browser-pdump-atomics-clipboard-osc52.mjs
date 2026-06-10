/**
 * probe-browser-pdump-atomics-clipboard-osc52.mjs
 *
 * Verifies the Emacs-side half of the OSC 52 clipboard bridge
 * (doc/clipboard-kill-ring-boundary.md): when the wasmacs xterm shim
 * (installXtermTermShim, mirrors src/wasm/src/emacs-atomics-pdump-worker.js)
 * is installed, M-w (kill-ring-save) on a selected region must emit
 *
 *   \x1b]52;c;<base64(region-text)>\x07
 *
 * on the terminal output stream. This is the sequence
 * src/wasm/src/xterm-emacs-terminal.js's OSC 52 handler decodes and forwards
 * to navigator.clipboard.writeText() in the browser — that browser-side half
 * is covered separately by tests/runtime/xterm-emacs-terminal.test.js
 * (decodeOsc52ClipboardPayload).
 *
 * Boot sequence (same artifact/pattern as
 * probe-browser-pdump-atomics-terminal-profile.mjs):
 *   1. Boot temacs from bootstrap-emacs.pdmp in a worker thread.
 *   2. Install the wasmacs xterm shim (gui-backend-set-selection / OSC 52).
 *   3. --eval pre-fills the buffer with "ab" and selects the whole buffer
 *      as the region (point-min..point-max).
 *   4. Send M-w (ESC w) via the SharedArrayBuffer input channel.
 *   5. Assert the OSC 52 sequence for base64("ab") == "YWI=" appears in the
 *      terminal output.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const artifactDir = `${repoRoot}/build/artifacts/emacs-browser-atomics-pdump`;
const logPath = `${repoRoot}/logs/browser-pdump-atomics-clipboard-osc52.txt`;

const EXPECTED_OSC52 = "]52;c;YWI=";

if (!isMainThread) {
  const require = createRequire(import.meta.url);

  const code = readFileSync(`${artifactDir}/temacs`, "utf8");
  const pdmpBytes = readFileSync(`${artifactDir}/bootstrap-emacs.pdmp`);
  const terminalOutput = [];
  const terminalInput = [];
  const inputSAB = workerData.inputSAB;

  function post(type, payload = {}) {
    parentPort.postMessage({ type, ...payload });
  }

  const originalWait = Atomics.wait;
  const wrappedAtomics = new Proxy(Atomics, {
    get(target, prop) {
      if (prop === "wait") {
        return function wasmacsProbeWait(arr, idx, val, timeout) {
          post("wait-entered", {
            waitCount: globalThis.__wasmacsHostWaitForInputCount || 0,
            terminalOutputBytes: terminalOutput.length,
          });
          return originalWait.call(target, arr, idx, val, timeout);
        };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const context = {
    Module: {
      noInitialRun: true,
      thisProgram: "/temacs",
      locateFile(path) { return `${artifactDir}/${path}`; },
      print(text) { post("stdout", { text }); },
      printErr(text) { post("stderr", { text }); },
      onAbort(what) { post("abort", { what: String(what) }); },
      onRuntimeInitialized() { resolveReady(); },
    },
    Atomics: wrappedAtomics,
    Buffer,
    SharedArrayBuffer,
    TextDecoder,
    TextEncoder,
    URL,
    WebAssembly,
    __dirname: artifactDir,
    __filename: `${artifactDir}/temacs`,
    clearTimeout,
    console,
    performance,
    process,
    require,
    setTimeout,
  };
  context.globalThis = context;
  context.self = {
    postMessage(message) {
      if (message?.type === "terminal-output-bytes") {
        post("terminal-output-bytes", {
          bytes: message.bytes,
          text: new TextDecoder().decode(new Uint8Array(message.bytes)),
        });
      } else {
        post("worker-message", { message });
      }
    },
  };

  const vm = await import("node:vm");
  vm.createContext(context);
  vm.runInContext(code, context, { filename: "temacs" });
  await ready;

  context.globalThis.__wasmacsInputSAB = inputSAB;
  context.globalThis.__wasmacsTerminalOutputBytes = terminalOutput;
  context.globalThis.__wasmacsTerminalInputBytes = terminalInput;
  context.globalThis.__wasmacsTerminalRows = 24;
  context.globalThis.__wasmacsTerminalCols = 80;
  context.Module.FS.writeFile("/temacs", new Uint8Array([0]));
  context.Module.FS.chmod("/temacs", 0o755);
  context.Module.FS.writeFile("/bootstrap-emacs.pdmp", new Uint8Array(pdmpBytes));
  installXtermTermShim(context.Module.FS);
  context.ENV.TERM = "xterm-256color";
  context.ENV.COLORTERM = "truecolor";

  post("ready");

  const bootArgs = [
    "--dump-file=/bootstrap-emacs.pdmp",
    "--quick",
    "--no-splash",
    "-nw",
    // Pre-fill the buffer with "ab" and select it as the region, so the
    // first M-w sent over the terminal performs kill-ring-save on "ab".
    "--eval", "(progn (insert \"ab\") (goto-char (point-min)) (push-mark nil t t) (goto-char (point-max)))",
  ];
  try {
    const status = context.Module.callMain(bootArgs);
    post("callMain-returned", { status });
  } catch (error) {
    post("callMain-threw", { error: error?.stack || String(error), status: error?.status });
  }

  // ── wasmacs xterm terminal-init shim ────────────────────────────────
  // Mirrors src/wasm/src/emacs-atomics-pdump-worker.js's
  // WASMACS_XTERM_TERM_SHIM/installXtermTermShim. Wires gui-backend-set-selection
  // (OSC 52) so M-w/C-w push the kill-ring text to the terminal, and
  // src/wasm/src/xterm-emacs-terminal.js's OSC 52 handler forwards it to the
  // host clipboard. See doc/clipboard-kill-ring-boundary.md.
  function installXtermTermShim(FS) {
    const termDir = "/usr/local/share/emacs/30.2/lisp/term";
    const source = `
;;; xterm.el --- wasmacs browser xterm shim -*- lexical-binding: t; -*-
;; Keep TERM=xterm-256color while avoiding the full GNU term/xterm.el startup
;; path in browser Workers with small JavaScript stacks.  Termcap has already
;; installed cursor-key sequences from ku/kd/kr/kl in src/term.c.

(require 'term/tty-colors)
(require 'cl-lib)

(defcustom xterm-max-cut-length 100000
  \"Maximum number of bytes to cut into xterm using the OSC 52 sequence.\"
  :type 'natnum
  :group 'xterm)

(defun xterm--selection-char (type)
  (pcase type
    ('PRIMARY \"p\")
    ('CLIPBOARD \"c\")
    (_ (error \"Invalid selection type: %S\" type))))

(cl-defmethod gui-backend-set-selection
    (type data
     &context (window-system nil)
              ((terminal-parameter nil 'xterm--set-selection) (eql t)))
  \"Copy DATA to the system clipboard using the OSC 52 escape sequence.\"
  (let* ((bytes (encode-coding-string data 'utf-8-unix))
         (base-64 (base64-encode-string bytes :no-line-break))
         (length (length base-64)))
    (if (> length xterm-max-cut-length)
        (warn \"Selection too long to send to terminal: %d bytes\" length)
      (send-string-to-terminal
       (concat \"\\e]52;\" (xterm--selection-char type) \";\" base-64 \"\\a\")))))

(defvar xterm-standard-colors
  '((\"black\"          0 (  0   0   0))
    (\"red\"            1 (205   0   0))
    (\"green\"          2 (  0 205   0))
    (\"yellow\"         3 (205 205   0))
    (\"blue\"           4 (  0   0 238))
    (\"magenta\"        5 (205   0 205))
    (\"cyan\"           6 (  0 205 205))
    (\"white\"          7 (229 229 229))
    (\"brightblack\"    8 (127 127 127))
    (\"brightred\"      9 (255   0   0))
    (\"brightgreen\"   10 (  0 255   0))
    (\"brightyellow\"  11 (255 255   0))
    (\"brightblue\"    12 ( 92  92 255))
    (\"brightmagenta\" 13 (255   0 255))
    (\"brightcyan\"    14 (  0 255 255))
    (\"brightwhite\"   15 (255 255 255))))

(defun xterm-rgb-convert-to-16bit (prim)
  (logior prim (ash prim 8)))

(defun wasmacs-xterm-register-colors ()
  "Register xterm's palette without running full xterm probes."
  (let* ((cells (display-color-cells))
         (ncolors (if (= cells 16777216) 256 cells)))
    (when (> ncolors 0)
      (tty-color-clear))
    (dolist (color xterm-standard-colors)
      (when (> ncolors 0)
        (tty-color-define (car color) (cadr color)
                          (mapcar #'xterm-rgb-convert-to-16bit
                                  (car (cddr color))))
        (setq ncolors (1- ncolors))))
    (when (= ncolors 240)
      (let ((r 0) (g 0) (b 0))
        (while (> ncolors 24)
          (tty-color-define (format \"color-%d\" (- 256 ncolors))
                            (- 256 ncolors)
                            (mapcar #'xterm-rgb-convert-to-16bit
                                    (list (if (zerop r) 0 (+ (* r 40) 55))
                                          (if (zerop g) 0 (+ (* g 40) 55))
                                          (if (zerop b) 0 (+ (* b 40) 55)))))
          (setq b (1+ b))
          (when (> b 5) (setq g (1+ g) b 0))
          (when (> g 5) (setq r (1+ r) g 0))
          (setq ncolors (1- ncolors))))
      (while (> ncolors 0)
        (let ((gray (xterm-rgb-convert-to-16bit
                     (+ 8 (* (- 24 ncolors) 10)))))
          (tty-color-define (format \"color-%d\" (- 256 ncolors))
                            (- 256 ncolors)
                            (list gray gray gray)))
        (setq ncolors (1- ncolors))))
    (clear-face-cache)))

(defun terminal-init-xterm ()
  "Initialize the wasmacs xterm tty without probing browser-hostile features."
  (wasmacs-xterm-register-colors)
  (when (fboundp 'tty-set-up-initial-frame-faces)
    (tty-set-up-initial-frame-faces))
  (set-terminal-parameter nil 'xterm--set-selection t)
  (run-hooks 'terminal-init-xterm-hook))

(provide 'term/xterm)
;;; xterm.el ends here
`.trimStart();
    try { FS.mkdir("/usr"); } catch (_) {}
    try { FS.mkdir("/usr/local"); } catch (_) {}
    try { FS.mkdir("/usr/local/share"); } catch (_) {}
    try { FS.mkdir("/usr/local/share/emacs"); } catch (_) {}
    try { FS.mkdir("/usr/local/share/emacs/30.2"); } catch (_) {}
    try { FS.mkdir("/usr/local/share/emacs/30.2/lisp"); } catch (_) {}
    try { FS.mkdir(termDir); } catch (_) {}
    try { FS.unlink(`${termDir}/xterm.elc`); } catch (_) {}
    FS.writeFile(`${termDir}/xterm.el`, source);
  }
} else {
  writeFileSync(logPath, "CASE:browser-pdump-atomics-clipboard-osc52\n");
  const inputSAB = new SharedArrayBuffer(264);
  const signal = new Int32Array(inputSAB, 0, 2);
  const data = new Uint8Array(inputSAB, 8);
  const messages = [];
  let combinedTerminalText = "";

  const worker = new Worker(new URL(import.meta.url), { workerData: { inputSAB } });
  worker.on("message", (message) => {
    messages.push({ ts: Date.now(), ...message });
    if (message.type === "terminal-output-bytes") combinedTerminalText += message.text || "";
  });

  await waitForMessage(messages, (m) => m.type === "ready", 30_000);
  await waitForMessage(messages, (m) => m.type === "wait-entered", 60_000);

  // M-w == kill-ring-save (ESC w).
  sendBytes([27, 119]);
  await waitForWaitCount(messages, 2);

  await worker.terminate();

  const summary = {
    osc52Emitted: combinedTerminalText.includes(EXPECTED_OSC52),
    terminalOutputBytes: messages.at(-1)?.terminalOutputBytes ?? null,
    waitEvents: messages.filter((m) => m.type === "wait-entered").length,
  };

  writeFileSync(logPath, [
    "SUMMARY_BEGIN",
    JSON.stringify(summary, null, 2),
    "SUMMARY_END",
    "TERMINAL_TEXT_BEGIN",
    JSON.stringify(combinedTerminalText),
    "TERMINAL_TEXT_END",
    "MESSAGES_BEGIN",
    ...messages.filter((m) => m.type !== "terminal-output-bytes").map((m) => JSON.stringify(m)),
    "MESSAGES_END",
    "",
  ].join("\n"));

  if (!summary.osc52Emitted) {
    throw new Error(`OSC 52 clipboard sequence ${JSON.stringify(EXPECTED_OSC52)} for "ab" was not emitted after M-w; see ${logPath}`);
  }

  console.log("Atomics pdump clipboard OSC 52 probe passed — see " + logPath);

  function sendBytes(bytes) {
    data.fill(0);
    data.set(bytes.slice(0, 256));
    Atomics.store(signal, 1, Math.min(bytes.length, 256));
    Atomics.add(signal, 0, 1);
    Atomics.notify(signal, 0, 1);
  }
}

async function waitForWaitCount(messages, count) {
  await waitForMessage(messages, () => messages.filter((m) => m.type === "wait-entered").length >= count, 60_000);
}

function waitForMessage(messages, predicate, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      const found = messages.find(predicate);
      if (found) {
        clearInterval(interval);
        resolve(found);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error("timed out waiting for clipboard OSC 52 probe message"));
      }
    }, 10);
  });
}
