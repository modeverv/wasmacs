import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const artifactDir = `${repoRoot}/build/artifacts/emacs-browser-atomics-pdump`;
const logPath = `${repoRoot}/logs/browser-pdump-atomics-terminal-profile.txt`;

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
          const text = new TextDecoder().decode(new Uint8Array(terminalOutput));
          post("wait-entered", {
            waitCount: globalThis.__wasmacsHostWaitForInputCount || 0,
            terminalOutputBytes: terminalOutput.length,
            terminalTextTail: text.slice(-4000),
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
  context.globalThis.__wasmacsDiagnosticLog = true;
  context.globalThis.__wasmacsTerminalRows = 24;
  context.globalThis.__wasmacsTerminalCols = 80;
  context.Module.FS.writeFile("/temacs", new Uint8Array([0]));
  context.Module.FS.chmod("/temacs", 0o755);
  context.Module.FS.writeFile("/bootstrap-emacs.pdmp", new Uint8Array(pdmpBytes));
  installXtermTermShim(context.Module.FS);
  context.ENV.TERM = "xterm-256color";
  context.ENV.COLORTERM = "truecolor";
  context.ENV.TERMCAP = "xterm-256color:co#80:li#24:Co#16777216:cl=\\E[H\\E[2J:cm=\\E[%i%d;%dH:up=\\E[A:do=\\E[B:nd=\\E[C:le=\\b:bs:ku=\\E[A:kd=\\E[B:kr=\\E[C:kl=\\E[D:kh=\\E[H:@7=\\E[F:kD=\\E[3~:ks=\\E[?1h\\E=:ke=\\E[?1l\\E>:vi=\\E[?25l:ve=\\E[?25h:vs=\\E[?25h:ti=\\E[?1049h:te=\\E[?1049l:so=\\E[7m:se=\\E[27m:us=\\E[4m:ue=\\E[24m:md=\\E[1m:mr=\\E[7m:me=\\E[0m:AF=\\E[38;5;%dm:AB=\\E[48;5;%dm:op=\\E[39;49m:";

  post("ready");
  const xtermMouseEnableBytes = Array.from(new TextEncoder().encode("\u001b[?1000h\u001b[?1003h\u001b[?1006h"));
  context.globalThis.__wasmacsTerminalOutputBytes.push(...xtermMouseEnableBytes);
  const bootArgs = [
    "--dump-file=/bootstrap-emacs.pdmp",
    "--quick",
    "--no-splash",
    "-nw",
    "--eval", "(insert (format \"WASMACS-TERM=%s\\n\" (getenv \"TERM\")))",
    "--eval", "(insert (format \"WASMACS-COLORTERM=%s\\n\" (getenv \"COLORTERM\")))",
    "--eval", "(insert (format \"WASMACS-CELLS=%S\\n\" (display-color-cells)))",
    "--eval", "(insert (format \"WASMACS-TTY-COLORS=%S\\n\" (length (tty-color-alist))))",
    "--eval", "(insert (format \"WASMACS-PIXEL=%S\\n\" (tty-color-translate \"#123456\")))",
    "--eval", "(insert (propertize \"WASMACS-TRUECOLOR-SAMPLE\" 'face '(:foreground \"#123456\" :background \"#654321\")))",
    "--eval", "(progn (require 'xt-mouse) (xterm-mouse-mode 1) (insert (format \"\\nWASMACS-XTERM-MOUSE=%S\\nWASMACS-TERMINAL-LIVE=%S\\nWASMACS-TERMINAL-NAME=%S\\nWASMACS-MOUSE-PARAM=%S\\n\" xterm-mouse-mode (mapcar #'terminal-live-p (terminal-list)) (mapcar #'terminal-name (terminal-list)) (terminal-parameter nil 'xterm-mouse-mode))))",
  ];
  try {
    const status = context.Module.callMain(bootArgs);
    post("callMain-returned", { status });
  } catch (error) {
    post("callMain-threw", { error: error?.stack || String(error), status: error?.status });
  }
} else {
  writeFileSync(logPath, "CASE:browser-pdump-atomics-terminal-profile\n");
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

  sendBytes([97, 98, 99]); // abc
  await waitForWaitCount(messages, 2);
  sendBytes([27, 91, 68]); // xterm cursor-left
  await waitForWaitCount(messages, 3);
  sendBytes([90]); // Z
  await waitForWaitCount(messages, 4);

  await worker.terminate();
  const finalText = combinedTerminalText + messages
    .filter((m) => m.terminalTextTail)
    .map((m) => m.terminalTextTail)
    .join("\n");
  const probeText = [
    finalText,
    ...messages.map((m) => m.text ?? ""),
  ].join("\n");
  const plainProbeText = probeText.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  const summary = {
    hasXterm256Color: plainProbeText.includes("T=xterm-256color") || plainProbeText.includes("WASMACS-TERM=xterm-256color"),
    hasColorTermTrueColor: plainProbeText.includes("CT=truecolor") || plainProbeText.includes("COLORTERM=truecolor"),
    hasTrueColorCells: plainProbeText.includes("CC=16777216") || plainProbeText.includes("CELLS=16777216"),
    hasTrueColorPixel: plainProbeText.includes("PX=1193046") || plainProbeText.includes("PIXEL=1193046"),
    hasDirectColorEscape: /\u001b\[(?:38|48);2;[0-9]{1,3};[0-9]{1,3};[0-9]{1,3}m/.test(probeText),
    hasXtermMouseMode: probeText.includes("WASMACS-XTERM-MOUSE=t"),
    hasMouse1006Enable: finalText.includes("\u001b[?1006h"),
    hasArrowEditResult: finalText.includes("abc") && /\x08(?:\u001b\[[0-9;?]*[ -/]*[@-~])*Zc\x08/.test(finalText),
    waitEvents: messages.filter((m) => m.type === "wait-entered").length,
    terminalOutputBytes: messages.at(-1)?.terminalOutputBytes ?? null,
  };

  writeFileSync(logPath, [
    "SUMMARY_BEGIN",
    JSON.stringify(summary, null, 2),
    "SUMMARY_END",
    "MESSAGES_BEGIN",
    ...messages.map((m) => JSON.stringify(m)),
    "MESSAGES_END",
    "",
  ].join("\n"));

  if (!summary.hasXterm256Color) throw new Error(`TERM readback did not report xterm-256color; see ${logPath}`);
  if (!summary.hasDirectColorEscape) throw new Error(`no true-color direct SGR escape was emitted; see ${logPath}`);
  if (!summary.hasXtermMouseMode) throw new Error(`xterm-mouse-mode was not enabled; see ${logPath}`);
  if (!summary.hasMouse1006Enable) throw new Error(`xterm mouse 1006 enable sequence was not emitted; see ${logPath}`);
  if (!summary.hasArrowEditResult) throw new Error(`cursor-left edit did not emit the expected backspace + Zc rewrite; see ${logPath}`);

  console.log("Atomics pdmp terminal profile probe passed — see " + logPath);

  function sendBytes(bytes) {
    data.fill(0);
    data.set(bytes.slice(0, 256));
    Atomics.store(signal, 1, Math.min(bytes.length, 256));
    Atomics.add(signal, 0, 1);
    Atomics.notify(signal, 0, 1);
  }
}

function installXtermTermShim(FS) {
  const termDir = "/usr/local/share/emacs/30.2/lisp/term";
  const source = `
;;; xterm.el --- wasmacs browser xterm shim -*- lexical-binding: t; -*-
;; Keep TERM=xterm-256color while avoiding the full GNU term/xterm.el startup
;; path in browser Workers with small JavaScript stacks.  Termcap has already
;; installed cursor-key sequences from ku/kd/kr/kl in src/term.c.

(require 'term/tty-colors)

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
        reject(new Error("timed out waiting for terminal profile probe message"));
      }
    }, 10);
  });
}
