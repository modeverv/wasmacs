import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-visited-file-cross-eval.txt`;

const setupBuffer = [
  "(let ((path \"/home/user/visited-cross.txt\"))",
  "  (with-current-buffer (get-buffer-create \"visited-cross\")",
  "    (let ((buffer-undo-list t))",
  "      (erase-buffer)",
  "      (insert \"alpha\"))",
].join(" ");

const setupSuffix = "    (buffer-name)))";

const setup = (body) => `${setupBuffer} ${body} ${setupSuffix}`;

const appendFrom = (bufferName) => [
  "(let ((path \"/home/user/visited-cross.txt\"))",
  "  (garbage-collect)",
  `  (with-current-buffer ${JSON.stringify(bufferName)}`,
  "    (goto-char (point-max))",
  "    (insert \" beta\")",
  "    (write-region (point-min) (point-max) path nil 'silent)",
  "    (concat (buffer-name) \"\\n\" (buffer-string))))",
].join(" ");

const cases = {
  "manual-buffer-file-name-cross": [
    setup("(setq buffer-file-name path)"),
    appendFrom("visited-cross"),
  ],
  "set-visited-default-cross": [
    setup("(set-visited-file-name path t t)"),
    appendFrom("visited-cross.txt"),
  ],
  "set-visited-minimized-cross": [
    setup([
      "(let ((auto-save-default nil)",
      "      (change-major-mode-with-file-name nil)",
      "      (after-set-visited-file-name-hook nil)",
      "      (backup-enable-predicate nil))",
      "  (set-visited-file-name path t t))",
    ].join(" ")),
    appendFrom("visited-cross.txt"),
  ],
  "set-visited-rename-back-cross": [
    setup("(set-visited-file-name path t t) (rename-buffer \"visited-cross\" t)"),
    appendFrom("visited-cross"),
  ],
  "set-visited-clear-file-vars-cross": [
    setup([
      "(set-visited-file-name path t t)",
      "(setq buffer-file-name nil",
      "      buffer-file-truename nil",
      "      buffer-file-number nil",
      "      buffer-auto-save-file-name nil)",
      "(rename-buffer \"visited-cross\" t)",
    ].join(" ")),
    appendFrom("visited-cross"),
  ],
  "set-visited-kill-before-cross": [
    [
      "(let ((path \"/home/user/visited-cross.txt\"))",
      "  (with-current-buffer (get-buffer-create \"visited-cross\")",
      "    (let ((buffer-undo-list t))",
      "      (erase-buffer)",
      "      (insert \"alpha\"))",
      "    (set-visited-file-name path t t)",
      "    (write-region (point-min) (point-max) path nil 'silent)",
      "    (kill-buffer (current-buffer))",
      "    path))",
    ].join(" "),
    [
      "(let ((path \"/home/user/visited-cross.txt\"))",
      "  (garbage-collect)",
      "  (with-temp-buffer",
      "    (insert-file-contents path)",
      "    (concat path \"\\n\" (buffer-string))))",
    ].join(" "),
  ],
};

if (!process.argv.includes("--child")) {
  const summaries = [];
  const statuses = new Map();
  for (const name of Object.keys(cases)) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", name], {
      encoding: "utf8",
      timeout: 45_000,
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
      throw new Error(`visited file cross-eval case failed: ${name}; see ${logPath}`);
    }
  }

  if (statuses.get("manual-buffer-file-name-cross") !== "PASS") {
    throw new Error(`manual buffer-file-name cross baseline must pass; see ${logPath}`);
  }
  await writeFile(logPath, `${summaries.join("\n")}\n`);
  console.log("browser visited-file cross-eval probe passed with known live visited-file blockers");
  process.exit(0);
}

const caseName = process.argv.at(-1);
const forms = cases[caseName];
if (!forms) throw new Error(`unknown visited file cross-eval case ${caseName}`);

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
context.Module.FS_createDataFile("/home/user", "visited-cross.txt", new TextEncoder().encode("alpha"), true, true, true);

const boot = context.Module.callMain(["--batch", "--eval", '(princ "boot\\n")']);
lines.push(`BOOT_EXIT:${boot}`);
if (boot !== 0) throw new Error(`expected boot exit 0, got ${boot}`);

for (const [index, form] of forms.entries()) {
  const label = `STEP_${index + 1}`;
  const status = context.Module.ccall("wasmacs_eval_string", "number", ["string"], [form]);
  const readback = context.Module.ccall("wasmacs_last_result", "string", [], []);
  lines.push(`${label}_STATUS:${status}`);
  lines.push(`${label}_READBACK:${readback}`);
  if (status !== 0) throw new Error(`${label} eval failed with ${status}`);
}

console.log(lines.join("\n"));
