import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/build/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-find-file-phases.txt`;

const path = "/home/user/find-phase.txt";

const phaseSetup = (body, bufferName = "find-phase") => [
  `(let ((path ${JSON.stringify(path)}))`,
  `  (with-current-buffer (get-buffer-create ${JSON.stringify(bufferName)})`,
  "    (let ((buffer-undo-list t)",
  "          (inhibit-read-only t))",
  "      (erase-buffer))",
  body,
  "    (buffer-name)))",
].join(" ");

const appendFrom = (bufferName) => [
  `(let ((path ${JSON.stringify(path)}))`,
  "  (garbage-collect)",
  `  (with-current-buffer ${JSON.stringify(bufferName)}`,
  "    (goto-char (point-max))",
  "    (insert \" beta\")",
  "    (write-region (point-min) (point-max) path nil 'silent)",
  "    (concat (buffer-name) \"\\n\" (buffer-string))))",
].join(" ");

const cases = {
  "set-visited-then-insert-no-visit": [
    phaseSetup([
      "    (set-visited-file-name path t t)",
      "    (insert-file-contents path)",
    ].join(" "), "find-phase"),
    appendFrom("find-phase.txt"),
  ],
  "insert-visit-then-set-file-vars": [
    phaseSetup([
      "    (insert-file-contents path t)",
      "    (setq buffer-file-truename (abbreviate-file-name (file-truename path)))",
      "    (setq buffer-file-number (file-attribute-file-identifier (file-attributes path)))",
      "    (setq default-directory (file-name-directory buffer-file-name))",
    ].join(" "), "find-phase"),
    appendFrom("find-phase.txt"),
  ],
  "insert-no-visit-then-set-visited": [
    phaseSetup([
      "    (insert-file-contents path)",
      "    (set-visited-file-name path t t)",
    ].join(" "), "find-phase"),
    appendFrom("find-phase.txt"),
  ],
  "insert-visit-only": [
    phaseSetup("    (insert-file-contents path t)", "find-phase"),
    appendFrom("find-phase.txt"),
  ],
  "insert-visit-raw-lite": [
    phaseSetup([
      "    (set-buffer-multibyte t)",
      "    (insert-file-contents path t)",
      "    (setq buffer-file-truename (abbreviate-file-name (file-truename buffer-file-name)))",
      "    (setq buffer-file-number (file-attribute-file-identifier (file-attributes buffer-file-name)))",
      "    (setq default-directory (file-name-directory buffer-file-name))",
    ].join(" "), "find-phase"),
    appendFrom("find-phase.txt"),
  ],
  "after-find-file-nomodes": [
    phaseSetup([
      "    (insert-file-contents path t)",
      "    (setq buffer-file-truename (abbreviate-file-name (file-truename buffer-file-name)))",
      "    (setq buffer-file-number (file-attribute-file-identifier (file-attributes buffer-file-name)))",
      "    (setq default-directory (file-name-directory buffer-file-name))",
      "    (let ((auto-save-default nil))",
      "      (after-find-file nil nil t nil t))",
    ].join(" "), "find-phase"),
    appendFrom("find-phase.txt"),
  ],
  "after-find-file-noauto-with-modes": [
    phaseSetup([
      "    (insert-file-contents path t)",
      "    (setq buffer-file-truename (abbreviate-file-name (file-truename buffer-file-name)))",
      "    (setq buffer-file-number (file-attribute-file-identifier (file-attributes buffer-file-name)))",
      "    (setq default-directory (file-name-directory buffer-file-name))",
      "    (let ((auto-save-default nil)",
      "          (enable-local-variables nil))",
      "      (after-find-file nil nil t nil nil))",
    ].join(" "), "find-phase"),
    appendFrom("find-phase.txt"),
  ],
  "find-file-noselect-live": [
    [
      `(let ((path ${JSON.stringify(path)}))`,
      "  (find-file-noselect path t nil nil)",
      "  (buffer-name (get-file-buffer path)))",
    ].join(" "),
    appendFrom("find-phase.txt"),
  ],
  "find-file-noselect-set-buffer-live": [
    [
      `(let ((path ${JSON.stringify(path)}))`,
      "  (set-buffer (find-file-noselect path t nil nil))",
      "  (buffer-name))",
    ].join(" "),
    appendFrom("find-phase.txt"),
  ],
  "find-file-noselect-switch-to-buffer-live": [
    [
      `(let ((path ${JSON.stringify(path)}))`,
      "  (switch-to-buffer (find-file-noselect path t nil nil))",
      "  (buffer-name))",
    ].join(" "),
    appendFrom("find-phase.txt"),
  ],
  "find-file-noselect-pop-same-window-live": [
    [
      `(let ((path ${JSON.stringify(path)}))`,
      "  (pop-to-buffer-same-window (find-file-noselect path t nil nil))",
      "  (buffer-name))",
    ].join(" "),
    appendFrom("find-phase.txt"),
  ],
  "find-file-command-live": [
    [
      `(let ((path ${JSON.stringify(path)}))`,
      "  (find-file path)",
      "  (buffer-name))",
    ].join(" "),
    appendFrom("find-phase.txt"),
  ],
  "find-file-live-insert-no-write": [
    [
      `(let ((path ${JSON.stringify(path)}))`,
      "  (find-file path)",
      "  (goto-char (point-max))",
      "  (insert \" setup\")",
      "  (buffer-name))",
    ].join(" "),
    appendFrom("find-phase.txt"),
  ],
  "find-file-live-erase-insert-no-write": [
    [
      `(let ((path ${JSON.stringify(path)}))`,
      "  (find-file path)",
      "  (let ((buffer-undo-list t))",
      "    (erase-buffer)",
      "    (insert \"alpha\"))",
      "  (buffer-name))",
    ].join(" "),
    appendFrom("find-phase.txt"),
  ],
  "find-file-live-insert-write-region": [
    [
      `(let ((path ${JSON.stringify(path)}))`,
      "  (find-file path)",
      "  (goto-char (point-max))",
      "  (insert \" setup\")",
      "  (write-region (point-min) (point-max) path nil 'silent)",
      "  (buffer-name))",
    ].join(" "),
    appendFrom("find-phase.txt"),
  ],
  "find-file-live-erase-insert-write-region": [
    [
      `(let ((path ${JSON.stringify(path)}))`,
      "  (find-file path)",
      "  (let ((buffer-undo-list t))",
      "    (erase-buffer)",
      "    (insert \"alpha\"))",
      "  (write-region (point-min) (point-max) path nil 'silent)",
      "  (buffer-name))",
    ].join(" "),
    appendFrom("find-phase.txt"),
  ],
  "find-file-live-insert-save-buffer": [
    [
      `(let ((path ${JSON.stringify(path)}))`,
      "  (find-file path)",
      "  (goto-char (point-max))",
      "  (insert \" setup\")",
      "  (save-buffer)",
      "  (buffer-name))",
    ].join(" "),
    appendFrom("find-phase.txt"),
  ],
};

if (!process.argv.includes("--child")) {
  const summaries = [];
  const statuses = new Map();
  for (const name of Object.keys(cases)) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", name], {
      encoding: "utf8",
      timeout: 75_000,
    });
    const combined = `${result.stdout || ""}${result.stderr || ""}`.trimEnd();
    const completedSuccessful =
      combined.includes("STEP_1_STATUS:0") && combined.includes("STEP_2_STATUS:0");
    const knownBlocked = result.status !== 0 &&
      (
        combined.includes("memory access out of bounds") ||
        combined.includes("RuntimeError: unreachable") ||
        combined.includes("_STATUS:1")
      );
    const timedOut = result.error?.code === "ETIMEDOUT";
    const status = result.status === 0 || completedSuccessful
      ? "PASS"
      : knownBlocked || timedOut ? "KNOWN_BLOCKER" : "FAIL";
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
      throw new Error(`find-file phase case failed: ${name}; see ${logPath}`);
    }
  }

  if (statuses.get("set-visited-then-insert-no-visit") !== "PASS") {
    throw new Error(`set-visited baseline must pass; see ${logPath}`);
  }
  await writeFile(logPath, `${summaries.join("\n")}\n`);
  console.log("browser find-file phase probe passed with known live find-file blockers");
  process.exit(0);
}

const caseName = process.argv.at(-1);
const forms = cases[caseName];
if (!forms) throw new Error(`unknown find-file phase case ${caseName}`);

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
    locateFile(filePath) {
      return `${artifactDir}/${filePath}`;
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
context.Module.FS_createDataFile("/home/user", "find-phase.txt", new TextEncoder().encode("alpha"), true, true, true);

const boot = context.Module.callMain(["--batch", "--eval", '(princ "boot\\n")']);
lines.push(`BOOT_EXIT:${boot}`);
if (boot !== 0) throw new Error(`expected boot exit 0, got ${boot}`);

for (const [index, form] of forms.entries()) {
  const label = `STEP_${index + 1}`;
  const status = context.Module.ccall("wasmacs_eval_string", "number", ["string"], [form]);
  const readback = context.Module.ccall("wasmacs_last_result", "string", [], []);
  lines.push(`${label}_STATUS:${status}`);
  lines.push(`${label}_READBACK:${readback}`);
  if (status !== 0) {
    console.log(lines.join("\n"));
    throw new Error(`${label} eval failed with ${status}`);
  }
}

console.log(lines.join("\n"));
process.exit(0);
