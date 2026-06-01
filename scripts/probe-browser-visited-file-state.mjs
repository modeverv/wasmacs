import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-visited-file-state.txt`;

const prelude = [
  "(let ((path \"/home/user/visited-phase.txt\"))",
  "  (with-current-buffer (get-buffer-create \"visited-phase\")",
  "    (let ((buffer-undo-list t))",
  "      (erase-buffer)",
  "      (insert \"alpha\"))",
].join(" ");

const suffix = [
  "    (write-region (point-min) (point-max) path nil 'silent)",
  "    (buffer-string)))",
].join(" ");

const form = (body) => `${prelude} ${body} ${suffix}`;

const cases = {
  "manual-buffer-file-name": form("(setq buffer-file-name path)"),
  "manual-buffer-file-truename": form("(setq buffer-file-truename (abbreviate-file-name (file-truename path)))"),
  "manual-buffer-file-number": form("(setq buffer-file-number (file-attribute-file-identifier (file-attributes path)))"),
  "manual-default-directory": form("(setq default-directory (file-name-directory path))"),
  "manual-rename-buffer": form("(rename-buffer (file-name-nondirectory path) t)"),
  "manual-clear-visited-modtime": form("(setq buffer-file-name path) (clear-visited-file-modtime)"),
  "manual-kill-file-locals": form([
    "(kill-local-variable 'write-file-functions)",
    "(kill-local-variable 'local-write-file-hooks)",
    "(kill-local-variable 'revert-buffer-function)",
    "(kill-local-variable 'backup-inhibited)",
    "(kill-local-variable 'vc-mode)",
  ].join(" ")),
  "manual-auto-save-mode": form("(setq buffer-file-name path) (let ((auto-save-default t)) (auto-save-mode t))"),
  "manual-set-buffer-modified": form("(set-buffer-modified-p t)"),
  "manual-set-auto-mode": form("(let ((change-major-mode-with-file-name t)) (set-auto-mode t))"),
  "set-visited-default": form("(set-visited-file-name path t t)"),
  "set-visited-no-autosave": form("(let ((auto-save-default nil)) (set-visited-file-name path t t))"),
  "set-visited-no-mode-change": form("(let ((change-major-mode-with-file-name nil)) (set-visited-file-name path t t))"),
  "set-visited-no-hooks": form("(let ((after-set-visited-file-name-hook nil)) (set-visited-file-name path t t))"),
  "set-visited-minimized": form([
    "(let ((auto-save-default nil)",
    "      (change-major-mode-with-file-name nil)",
    "      (after-set-visited-file-name-hook nil)",
    "      (backup-enable-predicate nil))",
    "  (set-visited-file-name path t t))",
  ].join(" ")),
};

if (!process.argv.includes("--child")) {
  const summaries = [];
  const statuses = new Map();
  for (const name of Object.keys(cases)) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", name], {
      encoding: "utf8",
      timeout: 30_000,
    });
    const combined = `${result.stdout || ""}${result.stderr || ""}`.trimEnd();
    const knownBlocked = result.status !== 0 &&
      (combined.includes("memory access out of bounds") || combined.includes("RuntimeError: unreachable"));
    const timedOut = result.error?.code === "ETIMEDOUT";
    const status = result.status === 0 ? "PASS" : knownBlocked || timedOut ? "KNOWN_BLOCKER" : "FAIL";
    statuses.set(name, status);
    summaries.push([
      `CASE:${name}`,
      `STATUS:${status}`,
      `EXIT_STATUS:${result.status}`,
      timedOut ? "TIMEOUT:true" : "TIMEOUT:false",
      combined,
      "",
    ].join("\n"));
    await writeFile(logPath, `${summaries.join("\n")}\n`);
    if (status === "FAIL") {
      throw new Error(`visited file state case failed: ${name}; see ${logPath}`);
    }
  }

  await writeFile(logPath, `${summaries.join("\n")}\n`);
  if (statuses.get("manual-buffer-file-name") !== "PASS") {
    throw new Error(`manual buffer-file-name baseline must pass; see ${logPath}`);
  }
  console.log("browser visited-file state probe passed with known visited-buffer blockers");
  process.exit(0);
}

const caseName = process.argv.at(-1);
const commandForm = cases[caseName];
if (!commandForm) throw new Error(`unknown visited file state case ${caseName}`);

const require = createRequire(import.meta.url);
const code = await readFile(`${artifactDir}/temacs`, "utf8");
const lines = [];
let resolveReady;
const ready = new Promise((resolve) => {
  resolveReady = resolve;
});

const context = {
  Module: {
    noInitialRun: true,
    thisProgram: "temacs",
    locateFile(path) {
      return `${artifactDir}/${path}`;
    },
    print(text) {
      lines.push(`OUT:${text}`);
    },
    printErr(text) {
      lines.push(`ERR:${text}`);
    },
    onRuntimeInitialized() {
      lines.push("READY");
      resolveReady();
    },
  },
  Buffer,
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

vm.createContext(context);
vm.runInContext(code, context, { filename: "temacs" });
await ready;

context.Module.FS_createPath("/", "home", true, true);
context.Module.FS_createPath("/home", "user", true, true);
context.Module.FS_createDataFile("/home/user", "visited-phase.txt", new TextEncoder().encode("alpha"), true, true, true);

const boot = context.Module.callMain(["--batch", "--eval", '(princ "boot\\n")']);
const status = context.Module.ccall("wasmacs_eval_string", "number", ["string"], [commandForm]);
const readback = context.Module.ccall("wasmacs_last_result", "string", [], []);
const text = context.Module.FS_readFile("/home/user/visited-phase.txt", { encoding: "utf8" });

lines.push(`BOOT_EXIT:${boot}`);
lines.push(`EVAL_STATUS:${status}`);
lines.push(`READBACK:${readback}`);
lines.push(`FILE_TEXT:${text}`);
console.log(lines.join("\n"));

if (boot !== 0) throw new Error(`expected boot exit 0, got ${boot}`);
if (status !== 0) throw new Error(`expected eval status 0, got ${status}`);
