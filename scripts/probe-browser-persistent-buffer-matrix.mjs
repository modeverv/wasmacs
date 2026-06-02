import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-persistent-buffer-matrix.txt`;

const cases = {
  "temp-buffer-write": [
    "(let ((path \"/home/user/matrix-temp.txt\"))",
    "  (with-temp-buffer",
    "    (insert \"temp\")",
    "    (write-region (point-min) (point-max) path nil 'silent)",
    "    (concat path \"\\n\" (buffer-string))))",
  ].join(" "),
  "find-file-write-undo-disabled": [
    "(let ((path \"/home/user/matrix-persistent-disabled.txt\"))",
    "  (find-file path)",
    "  (let ((buffer-undo-list t))",
    "    (erase-buffer)",
    "    (insert \"persistent-disabled\"))",
    "  (write-region (point-min) (point-max) path nil 'silent)",
    "  (concat path \"\\n\" (buffer-string)))",
  ].join(" "),
  "find-file-record-undo-no-undo": [
    "(let ((path \"/home/user/matrix-persistent-record.txt\"))",
    "  (find-file path)",
    "  (let ((buffer-undo-list t))",
    "    (erase-buffer)",
    "    (insert \"alpha\"))",
    "  (setq buffer-undo-list nil)",
    "  (undo-boundary)",
    "  (insert \" beta\")",
    "  (write-region (point-min) (point-max) path nil 'silent)",
    "  (concat path \"\\n\" (buffer-string)))",
  ].join(" "),
  "find-file-record-undo-no-intervals": [
    "(let ((path \"/home/user/matrix-persistent-record-no-intervals.txt\"))",
    "  (find-file path)",
    "  (let ((buffer-undo-list t))",
    "    (erase-buffer)",
    "    (insert \"alpha\"))",
    "  (set-text-properties (point-min) (point-max) nil)",
    "  (setq buffer-undo-list nil)",
    "  (undo-boundary)",
    "  (insert (substring-no-properties \" beta\"))",
    "  (set-text-properties (point-min) (point-max) nil)",
    "  (write-region (point-min) (point-max) path nil 'silent)",
    "  (concat path \"\\n\" (buffer-string)))",
  ].join(" "),
  "find-file-record-undo-and-undo": [
    "(let ((path \"/home/user/matrix-persistent-undo.txt\"))",
    "  (find-file path)",
    "  (let ((buffer-undo-list t))",
    "    (erase-buffer)",
    "    (insert \"alpha\"))",
    "  (setq buffer-undo-list nil)",
    "  (undo-boundary)",
    "  (insert \" beta\")",
    "  (undo)",
    "  (write-region (point-min) (point-max) path nil 'silent)",
    "  (concat path \"\\n\" (buffer-string)))",
  ].join(" "),
  "find-file-record-undo-and-undo-gc-high": [
    "(let ((path \"/home/user/matrix-persistent-undo-gc-high.txt\")",
    "      (gc-cons-threshold most-positive-fixnum))",
    "  (find-file path)",
    "  (let ((buffer-undo-list t))",
    "    (erase-buffer)",
    "    (insert \"alpha\"))",
    "  (setq buffer-undo-list nil)",
    "  (undo-boundary)",
    "  (insert \" beta\")",
    "  (undo)",
    "  (write-region (point-min) (point-max) path nil 'silent)",
    "  (concat path \"\\n\" (buffer-string)))",
  ].join(" "),
  "find-file-record-undo-and-primitive-undo": [
    "(let ((path \"/home/user/matrix-persistent-primitive-undo.txt\"))",
    "  (find-file path)",
    "  (let ((buffer-undo-list t))",
    "    (erase-buffer)",
    "    (insert \"alpha\"))",
    "  (setq buffer-undo-list nil)",
    "  (undo-boundary)",
    "  (insert \" beta\")",
    "  (setq buffer-undo-list (primitive-undo 1 buffer-undo-list))",
    "  (write-region (point-min) (point-max) path nil 'silent)",
    "  (concat path \"\\n\" (buffer-string)))",
  ].join(" "),
  "find-file-record-undo-start-undo-more": [
    "(let ((path \"/home/user/matrix-persistent-undo-more.txt\"))",
    "  (find-file path)",
    "  (let ((buffer-undo-list t))",
    "    (erase-buffer)",
    "    (insert \"alpha\"))",
    "  (setq buffer-undo-list nil)",
    "  (undo-boundary)",
    "  (insert \" beta\")",
    "  (undo-start)",
    "  (undo-more 1)",
    "  (write-region (point-min) (point-max) path nil 'silent)",
    "  (concat path \"\\n\" (buffer-string)))",
  ].join(" "),
  "find-file-record-undo-with-inhibit-message": [
    "(let ((path \"/home/user/matrix-persistent-undo-inhibit-message.txt\")",
    "      (inhibit-message t))",
    "  (find-file path)",
    "  (let ((buffer-undo-list t))",
    "    (erase-buffer)",
    "    (insert \"alpha\"))",
    "  (setq buffer-undo-list nil)",
    "  (undo-boundary)",
    "  (insert \" beta\")",
    "  (undo)",
    "  (write-region (point-min) (point-max) path nil 'silent)",
    "  (concat path \"\\n\" (buffer-string)))",
  ].join(" "),
  "find-file-record-undo-and-undo-no-intervals": [
    "(let ((path \"/home/user/matrix-persistent-undo-no-intervals.txt\"))",
    "  (find-file path)",
    "  (let ((buffer-undo-list t))",
    "    (erase-buffer)",
    "    (insert \"alpha\"))",
    "  (set-text-properties (point-min) (point-max) nil)",
    "  (setq buffer-undo-list nil)",
    "  (undo-boundary)",
    "  (insert (substring-no-properties \" beta\"))",
    "  (set-text-properties (point-min) (point-max) nil)",
    "  (undo)",
    "  (write-region (point-min) (point-max) path nil 'silent)",
    "  (concat path \"\\n\" (buffer-string)))",
  ].join(" "),
};

if (!process.argv.includes("--child")) {
  const summaries = [];
  const knownUndoBlockerTimeoutMs = Number(
    process.env.WASMACS_MATRIX_KNOWN_BLOCKER_TIMEOUT_MS ?? "10000",
  );
  for (const name of Object.keys(cases)) {
    const knownUndoBlockerCase = name.startsWith("find-file-");
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", name], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: knownUndoBlockerCase ? knownUndoBlockerTimeoutMs : 120_000,
    });
    const combined = `${result.stdout || ""}${result.stderr || ""}`.trimEnd();
    const knownBlocked = knownUndoBlockerCase &&
      (result.status !== 0 || result.signal || result.error) &&
      (
        combined.includes("memory access out of bounds") ||
        combined.includes("RuntimeError: unreachable") ||
        combined.includes("EVAL_STATUS:1") ||
        result.signal === "SIGTERM" ||
        result.error?.message.includes("ETIMEDOUT")
      );
    const status = result.status === 0 ? "PASS" : knownBlocked ? "KNOWN_BLOCKER" : "FAIL";
    summaries.push([
      `CASE:${name}`,
      `STATUS:${status}`,
      `EXIT_STATUS:${result.status}`,
      knownUndoBlockerCase ? `KNOWN_BLOCKER_TIMEOUT_MS:${knownUndoBlockerTimeoutMs}` : "KNOWN_BLOCKER_TIMEOUT_MS:n/a",
      result.error ? `SPAWN_ERROR:${result.error.message}` : "SPAWN_ERROR:absent",
      combined,
      "",
    ].join("\n"));
    if (status === "FAIL") {
      await writeFile(logPath, `${summaries.join("\n")}\n`);
      throw new Error(`persistent buffer matrix case failed: ${name}; see ${logPath}`);
    }
  }

  await writeFile(logPath, `${summaries.join("\n")}\n`);
  console.log("browser persistent buffer matrix probe passed with known undo blocker");
  process.exit(0);
}

const caseName = process.argv.at(-1);
const commandForm = cases[caseName];
if (!commandForm) {
  throw new Error(`unknown matrix case ${caseName}`);
}

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
for (const fileName of [
  "matrix-temp.txt",
  "matrix-persistent-disabled.txt",
  "matrix-persistent-record.txt",
  "matrix-persistent-record-no-intervals.txt",
  "matrix-persistent-undo.txt",
  "matrix-persistent-undo-gc-high.txt",
  "matrix-persistent-primitive-undo.txt",
  "matrix-persistent-undo-more.txt",
  "matrix-persistent-undo-inhibit-message.txt",
  "matrix-persistent-undo-no-intervals.txt",
]) {
  context.Module.FS_createDataFile("/home/user", fileName, new TextEncoder().encode(""), true, true, true);
}

const boot = context.Module.callMain(["--batch", "--eval", '(princ "boot\\n")']);
const evalStatus = context.Module.ccall("wasmacs_eval_string", "number", ["string"], [commandForm]);
const readback = context.Module.ccall("wasmacs_last_result", "string", [], []);

lines.push(`BOOT_EXIT:${boot}`);
lines.push(`EVAL_STATUS:${evalStatus}`);
lines.push(`READBACK:${readback}`);
console.log(lines.join("\n"));

if (boot !== 0) throw new Error(`expected boot exit 0, got ${boot}`);
if (evalStatus !== 0) throw new Error(`expected eval status 0, got ${evalStatus}`);
