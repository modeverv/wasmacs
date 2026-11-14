// Run the product runtime (Atomics + pdump Emacs) under Node, in-process.
//
// The Emacs glue is evaluated in a vm context that looks like the browser
// worker; Emacs then runs on the calling thread:
//
//   - batch:        callMain(["--batch", "--eval", form]) returns when done.
//   - interactive:  callMain(["-nw", ...]) blocks in the real command loop.
//                   Every idle wait of Emacs passes through Atomics.wait, which
//                   this harness intercepts: an expect-style script looks at
//                   the terminal output produced so far and injects keystrokes
//                   through the same SharedArrayBuffer the browser page uses.
//                   No second thread, fully deterministic.
//
// With `userland: true` the process service gets its userland the way the
// worker provides it: /bin marker files, /etc, PATH/SHELL and a program loader.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
export const buildArtifactDir = `${repoRoot}build/artifacts/emacs-browser-atomics-pdump`;
export const docsArtifactDir = `${repoRoot}docs/artifacts/emacs-browser-atomics-pdump`;
export const buildUserlandDir = `${repoRoot}build/artifacts/userland`;
export const docsUserlandDir = `${repoRoot}docs/artifacts/userland`;

export function stripAnsi(text) {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-Z\\-_=>]/g, "");
}

// The Pages bundle ships temacs.data split into parts (GitHub file size limit).
function readPreloadData(artifactDir) {
  const whole = `${artifactDir}/temacs.data`;
  if (existsSync(whole)) return null; // the glue reads it itself
  const partsDir = `${whole}.parts`;
  const manifest = JSON.parse(readFileSync(`${partsDir}/manifest.json`, "utf8"));
  const bytes = new Uint8Array(manifest.size);
  let offset = 0;
  for (const part of manifest.parts) {
    const chunk = readFileSync(`${partsDir}/${part.name}`);
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== manifest.size) throw new Error(`temacs.data parts: expected ${manifest.size} bytes, got ${offset}`);
  return bytes.buffer;
}

let userlandLayout = null;
function loadUserlandLayout() {
  if (!userlandLayout) {
    const holder = {};
    vm.runInNewContext(readFileSync(`${repoRoot}src/runtime/process/wasmacs-userland.js`, "utf8"), { globalThis: holder, self: holder });
    userlandLayout = holder.WasmacsUserland;
  }
  return userlandLayout;
}

/**
 * Load the Emacs runtime.  Options:
 *   artifactDir   directory with temacs, temacs.wasm, temacs.data(.parts), bootstrap-emacs.pdmp
 *   userland      true | directory: install the process userland (default: false)
 *   extraPrograms directories searched for program images before the userland dir
 *   kernelSource  path of a wasmacs-kernel.js to use instead of the one next to
 *                 the userland (or, without a userland, the one in src/)
 * batchEval and interactiveSession also take `prepare(emacs)`, called after
 * boot and before Emacs runs (to put files into the filesystem).
 */
export async function bootEmacs({
  artifactDir = buildArtifactDir,
  userland = false,
  extraPrograms = [],
  kernelSource = process.env.WASMACS_KERNEL_JS || null,
} = {}) {
  const temacsJs = existsSync(`${artifactDir}/temacs`) ? `${artifactDir}/temacs` : `${artifactDir}/temacs.js`;
  const require = createRequire(`${artifactDir}/package.json`);
  const code = readFileSync(temacsJs, "utf8");
  const pdmpBytes = readFileSync(`${artifactDir}/bootstrap-emacs.pdmp`);
  const preloadData = readPreloadData(artifactDir);

  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const stderr = [];
  const hooks = { onWait: null };
  const WrappedAtomics = Object.create(Atomics);
  WrappedAtomics.wait = function (typedArray, index, value, timeout) {
    if (hooks.onWait) {
      const result = hooks.onWait(typedArray, index, value, timeout);
      if (result) return result;
    }
    return Atomics.wait(typedArray, index, value, timeout);
  };
  const context = {
    Module: {
      noInitialRun: true,
      thisProgram: "/temacs",
      locateFile(path) { return `${artifactDir}/${path}`; },
      print() {},
      printErr(text) { stderr.push(String(text)); },
      onRuntimeInitialized() { resolveReady(); },
    },
    Buffer, TextDecoder, TextEncoder, URL, WebAssembly, SharedArrayBuffer, Atomics: WrappedAtomics,
    atob, btoa,   // a worker has them; the process HTTP import uses them
    __dirname: artifactDir, __filename: temacsJs,
    clearTimeout, console, performance, process, require, setTimeout,
  };
  if (preloadData) context.Module.getPreloadedPackage = () => preloadData;
  // The C environment is captured when the static constructors run, so
  // variables have to be in ENV before that: preRun is the last chance.
  context.__wasmacsBootEnv = {
    HOME: "/home/user", LANG: "C", LC_ALL: "C", USER: "user", LOGNAME: "user",
    ...(userland ? loadUserlandLayout().ENVIRONMENT : {}),
  };
  context.Module.preRun = [() => vm.runInContext("Object.assign(ENV, __wasmacsBootEnv);", context)];
  context.globalThis = context;
  context.self = { postMessage() {} };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: "temacs" });
  await ready;

  // The kernel boots before Emacs runs, as in the worker: Emacs is its init.
  // A published userland directory carries the kernel it was published with.
  const userlandDir = typeof userland === "string" ? userland : buildUserlandDir;
  const processScript = (name) => {
    const published = `${userlandDir}/${name}`;
    return userland && existsSync(published) ? published : `${repoRoot}src/runtime/process/${name}`;
  };
  for (const [name, file] of [["wasmacs-kernel.js", kernelSource || processScript("wasmacs-kernel.js")],
                              ["wasmacs-boot.js", processScript("wasmacs-boot.js")]]) {
    vm.runInContext(readFileSync(file, "utf8"), context, { filename: name });
  }
  vm.runInContext(`WasmacsBoot.boot({
    FS: Module.FS,
    init: "emacs",
    console: WasmacsBoot.createConsole({ post() {}, keepOutput: true }),
    debug: !!globalThis.__wasmacsProcessDebug,
    log(msg) { if (globalThis.__wasmacsProcessDebug) console.warn(msg); },
    loadProgram(name) {
      if (typeof globalThis.__wasmacsLoadProgram !== "function") throw new Error("no program loader is installed");
      return globalThis.__wasmacsLoadProgram(name);
    },
  });`, context, { filename: "boot" });

  context.__wasmacsInputSAB = new SharedArrayBuffer(264);
  context.__wasmacsTerminalSizeSAB = new SharedArrayBuffer(12);
  context.__wasmacsTerminalOutputBytes = [];
  context.__wasmacsTerminalInputBytes = [];
  const FS = context.Module.FS;
  FS.writeFile("/temacs", new Uint8Array([0]));
  FS.chmod("/temacs", 0o755);
  FS.writeFile("/bootstrap-emacs.pdmp", new Uint8Array(pdmpBytes));
  for (const dir of ["/tmp", "/home", "/home/user"]) { try { FS.mkdir(dir); } catch { /* exists */ } }

  let userlandManifest = null;
  if (userland) {
    const layout = loadUserlandLayout();
    userlandManifest = JSON.parse(readFileSync(`${userlandDir}/manifest.json`, "utf8"));
    layout.install(FS, userlandManifest);
    const images = new Map();
    const searchDirs = [...extraPrograms, userlandDir];
    context.__wasmacsLoadProgram = (name) => {
      if (!images.has(name)) {
        const dir = searchDirs.find((candidate) => existsSync(`${candidate}/${name}.wasm`));
        if (!dir) throw new Error(`program image ${name} not found in ${searchDirs.join(", ")}`);
        vm.runInContext(readFileSync(`${dir}/${name}.js`, "utf8"), context, { filename: `${name}.js` });
        layout.installProgramFiles(FS, userlandManifest, name, (source) => readFileSync(`${dir}/${source}`));
        images.set(name, { factory: context[`wasmacsProgram_${name}`], wasm: readFileSync(`${dir}/${name}.wasm`) });
      }
      return images.get(name);
    };
  }

  function terminalText() {
    return stripAnsi(Buffer.from(context.__wasmacsTerminalOutputBytes).toString("utf8"));
  }
  // Same protocol as the page: one chunk of bytes, then bump and notify.
  function injectKeys(bytes) {
    const signal = new Int32Array(context.__wasmacsInputSAB, 0, 2);
    const data = new Uint8Array(context.__wasmacsInputSAB, 8);
    const chunk = Array.from(typeof bytes === "string" ? Buffer.from(bytes, "latin1") : bytes).slice(0, data.length);
    data.fill(0);
    data.set(chunk);
    Atomics.store(signal, 1, chunk.length);
    Atomics.add(signal, 0, 1);
  }
  function keyboardBufferFree() {
    return Atomics.load(new Int32Array(context.__wasmacsInputSAB, 0, 2), 1) === 0;
  }
  function run(args) {
    const t0 = performance.now();
    let status, threw = null;
    try {
      status = context.Module.callMain(args);
    } catch (error) {
      threw = error;
      status = error && typeof error.status === "number" ? error.status : undefined;
    }
    return { status, threw, ms: performance.now() - t0, stderr, terminal: terminalText() };
  }
  // The process kernel.
  const kernel = () => context.__wasmacsKernel || null;
  // What the worker evaluates at startup when the userland is installed.
  const settingsArgs = userland ? loadUserlandLayout().EMACS_SETTINGS.flatMap((form) => ["--eval", form]) : [];
  return { context, Module: context.Module, FS, hooks, run, terminalText, injectKeys, keyboardBufferFree, kernel, stderr, userlandManifest, settingsArgs };
}

const pdmpArgs = ["--dump-file=/bootstrap-emacs.pdmp"];

/**
 * Copy the host directory HOSTDIR into the Emacs filesystem as FSDIR
 * (recursively).  KEEP(name, hostPath) decides which regular files are
 * copied.  Returns the number of files written.
 */
export function copyHostDirectory(FS, hostDir, fsDir, keep = () => true) {
  let count = 0;
  FS.mkdirTree(fsDir);
  for (const name of readdirSync(hostDir)) {
    const hostPath = `${hostDir}/${name}`;
    const stat = statSync(hostPath);
    if (stat.isDirectory()) {
      count += copyHostDirectory(FS, hostPath, `${fsDir}/${name}`, keep);
    } else if (stat.isFile() && keep(name, hostPath)) {
      FS.writeFile(`${fsDir}/${name}`, readFileSync(hostPath));
      count += 1;
    }
  }
  return count;
}

/**
 * Evaluate FORM in a fresh batch Emacs.  The printed representation of its
 * value (or of the error) is returned as `value`; `ok` says which it was.
 */
export async function batchEval(form, { prepare = null, ...options } = {}) {
  const emacs = await bootEmacs(options);
  if (prepare) await prepare(emacs);
  const marker = "\u0001WASMACS-RESULT\u0001";
  // The trailing newline matters: the runtime is kept alive (EXIT_RUNTIME=0),
  // so stdio is not flushed at exit and an unterminated last line is lost.
  const wrapped = `(condition-case err (princ (format "${marker}OK %S${marker}\n" ${form})) (error (princ (format "${marker}ERROR %S${marker}\n" err))))`;
  const result = emacs.run([...pdmpArgs, "--batch", ...emacs.settingsArgs, "--eval", wrapped]);
  const raw = Buffer.from(emacs.context.__wasmacsTerminalOutputBytes).toString("utf8");
  const start = raw.indexOf(marker);
  const end = raw.indexOf(marker, start + marker.length);
  const body = start >= 0 && end > start ? raw.slice(start + marker.length, end) : null;
  return {
    ...result,
    ok: body !== null && body.startsWith("OK "),
    value: body === null ? null : body.replace(/^(OK|ERROR) /, ""),
    emacs,
  };
}

/**
 * Drive an interactive (-nw) Emacs with an expect-style script.
 *   evals    --eval forms run at startup
 *   steps    [{ name, expect: RegExp | (newText, allText, emacs) => bool, send: string | number[] }]
 *            A step fires at an idle wait once its expectation matches the
 *            terminal text produced since the previous step fired; then its
 *            keys are sent.  After the last step send C-x C-c to end the session.
 *   timeoutMs  per-step timeout
 */
export async function interactiveSession({ evals = [], steps, timeoutMs = 15000, exitGraceMs = 5000, prepare = null, ...bootOptions } = {}) {
  const emacs = await bootEmacs(bootOptions);
  if (prepare) await prepare(emacs);
  let stepIndex = 0;
  let mark = 0;
  let stepStart = performance.now();
  let failure = null;
  const log = [];
  const t0 = performance.now();
  // A session that is stuck is abandoned by throwing out of the idle wait:
  // the exception unwinds Emacs out of callMain (the instance is not reused).
  const abandon = (step, fresh) => {
    failure = { step, tail: fresh.slice(-600) };
    throw new SessionAbandoned(step);
  };
  emacs.hooks.onWait = () => {
    const now = performance.now();
    const text = emacs.terminalText();
    const fresh = text.slice(mark);
    const step = steps[stepIndex];
    if (!step) {
      // The script is over; its last keys were meant to end Emacs.
      if (now - stepStart > exitGraceMs) abandon("emacs did not exit after the last step", fresh);
      return null;
    }
    const matched = typeof step.expect === "function" ? step.expect(fresh, text, emacs) : step.expect.test(fresh);
    if (matched) {
      if (step.send != null && !emacs.keyboardBufferFree()) return null; // Emacs has not taken the last keys yet
      log.push({ step: step.name, atMs: Math.round(now - t0) });
      mark = text.length;
      stepIndex += 1;
      stepStart = now;
      if (step.send != null) {
        emacs.injectKeys(step.send);
        return "not-equal";
      }
      return null;
    }
    if (now - stepStart > timeoutMs) abandon(step.name, fresh);
    return null;
  };
  const args = [...pdmpArgs, "--quick", "--no-splash", "-nw", ...emacs.settingsArgs];
  for (const form of evals) args.push("--eval", form);
  const result = emacs.run(args);
  if (result.threw && !(result.threw instanceof SessionAbandoned) && !failure && result.status === undefined) {
    failure = { step: `emacs crashed: ${result.threw.message || result.threw}`, tail: emacs.terminalText().slice(-600) };
  }
  return { ...result, log, failure, completed: !failure && stepIndex >= steps.length, emacs };
}

class SessionAbandoned extends Error {
  constructor(step) {
    super(`interactive session abandoned at "${step}"`);
    this.name = "SessionAbandoned";
  }
}

/**
 * Boot the system without Emacs and run ARGV as init (pid 1) on the console
 * terminal, as the worker does for ?init=sh: the base module provides the
 * filesystem and the kernel's console task drives the session.
 *   userland  directory with the userland, the kernel scripts and wasmacs-base
 *   argv      the init program and its arguments
 *   chunks    what is typed: the first chunk at once, each following one when
 *             the system has gone idle
 *   prepare   (FS) => void, called before init starts
 *   timeoutMs init has to exit within this time
 * Returns { status, code, signal, text, log, kernel, FS }.
 */
export async function initSession({ userland = buildUserlandDir, argv, chunks = [], prepare = null, timeoutMs = 30000 }) {
  const require = createRequire(`${userland}/package.json`);
  const context = {
    Buffer, TextDecoder, TextEncoder, URL, WebAssembly, SharedArrayBuffer, Atomics,
    atob, btoa, clearTimeout, console, performance, process, require, setTimeout,
    __dirname: userland, __filename: `${userland}/wasmacs-base.js`,
  };
  context.globalThis = context;
  context.self = { postMessage() {} };
  vm.createContext(context);
  for (const name of ["wasmacs-kernel.js", "wasmacs-boot.js", "wasmacs-userland.js"]) {
    vm.runInContext(readFileSync(`${userland}/${name}`, "utf8"), context, { filename: name });
  }
  const base = await require(`${userland}/wasmacs-base.js`)();
  const FS = base.FS;
  const manifest = JSON.parse(readFileSync(`${userland}/manifest.json`, "utf8"));
  context.__wasmacsInputSAB = new SharedArrayBuffer(264);
  context.__wasmacsTerminalOutputBytes = [];
  context.__wasmacsTerminalInputBytes = [];
  const images = new Map();
  const log = [];
  const kernel = context.WasmacsBoot.boot({
    FS,
    init: argv[0],
    console: context.WasmacsBoot.createConsole({ post() {}, keepOutput: true }),
    views: () => ({ HEAPU8: base.HEAPU8, HEAP32: base.HEAP32, HEAP16: base.HEAP16 }),
    log(msg) { log.push(String(msg)); },
    loadProgram(name) {
      if (!images.has(name)) {
        vm.runInContext(readFileSync(`${userland}/${name}.js`, "utf8"), context, { filename: `${name}.js` });
        context.WasmacsUserland.installProgramFiles(FS, manifest, name, (source) => readFileSync(`${userland}/${source}`));
        images.set(name, { factory: context[`wasmacsProgram_${name.replace(/-/g, "_")}`], wasm: readFileSync(`${userland}/${name}.wasm`) });
      }
      return images.get(name);
    },
  });
  context.WasmacsUserland.install(FS, manifest);
  if (prepare) await prepare(FS);
  const pending = chunks.slice();
  const type = () => {
    if (!pending.length) return false;
    context.__wasmacsTerminalInputBytes.push(...Buffer.from(pending.shift(), "latin1"));
    Atomics.add(new Int32Array(context.__wasmacsInputSAB, 0, 2), 0, 1);
    return true;
  };
  const text = () => stripAnsi(Buffer.from(context.__wasmacsTerminalOutputBytes).toString("utf8"));
  type();
  let idles = 0, heldSince = null;
  const started = performance.now();
  const environment = { ...context.WasmacsUserland.ENVIRONMENT, HOME: "/home/user", USER: "user", TERM: "xterm-256color" };
  const status = context.WasmacsBoot.runInit(kernel, {
    argv,
    env: Object.entries(environment).map(([name, value]) => `${name}=${value}`),
    cwd: "/home/user",
    beforeIdle() {
      if (performance.now() - started > timeoutMs) throw new Error(`init did not exit: ${text().slice(-300)}`);
      // A process in a short timed wait (vi after ESC) is not idle yet; one
      // that polls all the time (Python's REPL) is, after a second.
      if (kernel._nextTimerDelay(kernel.now()) < 500) {
        if (heldSince === null) heldSince = performance.now();
        if (performance.now() - heldSince < 1000) return;
      }
      heldSince = null;
      if (!type() && ++idles > 20) throw new Error(`init did not exit: ${text().slice(-300)}`);
    },
  });
  return { status, code: (status >> 8) & 0xff, signal: status & 0x7f, text: text(), log, kernel, FS };
}
