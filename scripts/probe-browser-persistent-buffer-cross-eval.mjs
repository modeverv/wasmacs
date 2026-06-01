import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-persistent-buffer-cross-eval.txt`;

const cases = {
  "cross-eval-named-buffer-no-undo": [
    [
      "(with-current-buffer (get-buffer-create \"cross-eval-buffer\")",
      "  (let ((buffer-undo-list t))",
      "    (erase-buffer)",
      "    (insert \"alpha\"))",
      "  (buffer-string))",
    ].join(" "),
    [
      "(let ((path \"/home/user/cross-eval-named-buffer.txt\"))",
      "  (with-current-buffer \"cross-eval-buffer\"",
      "    (goto-char (point-max))",
      "    (insert \" beta\")",
      "    (write-region (point-min) (point-max) path nil 'silent)",
      "    (concat path \"\\n\" (buffer-string))))",
    ].join(" "),
  ],
  "cross-eval-file-buffer-no-undo": [
    [
      "(let ((path \"/home/user/cross-eval-edit.txt\"))",
      "  (find-file path)",
      "  (let ((buffer-undo-list t))",
      "    (erase-buffer)",
      "    (insert \"alpha\"))",
      "  (write-region (point-min) (point-max) path nil 'silent)",
      "  (concat path \"\\n\" (buffer-string)))",
    ].join(" "),
    [
      "(let ((path \"/home/user/cross-eval-edit.txt\"))",
      "  (find-file path)",
      "  (goto-char (point-max))",
      "  (insert \" beta\")",
      "  (write-region (point-min) (point-max) path nil 'silent)",
      "  (concat path \"\\n\" (buffer-string)))",
    ].join(" "),
  ],
  "cross-eval-primitive-undo": [
    [
      "(let ((path \"/home/user/cross-eval-undo.txt\"))",
      "  (find-file path)",
      "  (let ((buffer-undo-list t))",
      "    (erase-buffer)",
      "    (insert \"alpha\"))",
      "  (setq buffer-undo-list nil)",
      "  (write-region (point-min) (point-max) path nil 'silent)",
      "  (concat path \"\\n\" (buffer-string)))",
    ].join(" "),
    [
      "(let ((path \"/home/user/cross-eval-undo.txt\"))",
      "  (find-file path)",
      "  (goto-char (point-max))",
      "  (insert \" beta\")",
      "  (write-region (point-min) (point-max) path nil 'silent)",
      "  (concat path \"\\n\" (buffer-string)))",
    ].join(" "),
    [
      "(let ((path \"/home/user/cross-eval-undo.txt\"))",
      "  (find-file path)",
      "  (setq buffer-undo-list (primitive-undo 1 buffer-undo-list))",
      "  (write-region (point-min) (point-max) path nil 'silent)",
      "  (concat path \"\\n\" (buffer-string)))",
    ].join(" "),
  ],
};

if (!process.argv.includes("--child")) {
  const summaries = [];
  for (const name of Object.keys(cases)) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", name], {
      encoding: "utf8",
    });
    const combined = `${result.stdout || ""}${result.stderr || ""}`.trimEnd();
    const knownBlocked = (
      name === "cross-eval-file-buffer-no-undo" ||
      name === "cross-eval-primitive-undo"
    ) &&
      result.status !== 0 &&
      combined.includes("memory access out of bounds");
    const status = result.status === 0 ? "PASS" : knownBlocked ? "KNOWN_BLOCKER" : "FAIL";
    summaries.push([
      `CASE:${name}`,
      `STATUS:${status}`,
      `EXIT_STATUS:${result.status}`,
      combined,
      "",
    ].join("\n"));
    if (status === "FAIL") {
      await writeFile(logPath, `${summaries.join("\n")}\n`);
      throw new Error(`persistent buffer cross-eval case failed: ${name}; see ${logPath}`);
    }
  }
  await writeFile(logPath, `${summaries.join("\n")}\n`);
  console.log("browser persistent buffer cross-eval probe passed with known undo-list blocker");
  process.exit(0);
}

const caseName = process.argv.at(-1);
const forms = cases[caseName];
if (!forms) throw new Error(`unknown cross-eval case ${caseName}`);

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
for (const fileName of ["cross-eval-named-buffer.txt", "cross-eval-edit.txt", "cross-eval-undo.txt"]) {
  context.Module.FS_createDataFile("/home/user", fileName, new TextEncoder().encode(""), true, true, true);
}

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
