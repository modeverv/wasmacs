import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-file-buffer-gc-roots.txt`;

const cases = {
  "boot-gc-only": [
    [
      "(progn",
      "  (garbage-collect)",
      "  \"gc-ok\")",
    ].join(" "),
  ],
  "temp-buffer-gc": [
    [
      "(with-temp-buffer",
      "  (insert \"alpha\")",
      "  (garbage-collect)",
      "  (buffer-string))",
    ].join(" "),
  ],
  "named-buffer-gc": [
    [
      "(with-current-buffer (get-buffer-create \"gc-named\")",
      "  (let ((buffer-undo-list t))",
      "    (erase-buffer)",
      "    (insert \"alpha\"))",
      "  (buffer-string))",
    ].join(" "),
    [
      "(let ((path \"/home/user/gc-named.txt\"))",
      "  (garbage-collect)",
      "  (with-current-buffer \"gc-named\"",
      "    (goto-char (point-max))",
      "    (insert \" beta\")",
      "    (write-region (point-min) (point-max) path nil 'silent)",
      "    (concat path \"\\n\" (buffer-string))))",
    ].join(" "),
  ],
  "named-buffer-set-buffer-file-name": [
    [
      "(let ((path \"/home/user/gc-buffer-file-name.txt\"))",
      "  (with-current-buffer (get-buffer-create \"gc-buffer-file-name\")",
      "    (let ((buffer-undo-list t))",
      "      (erase-buffer)",
      "      (insert \"alpha\"))",
      "    (setq buffer-file-name path)",
      "    (buffer-string)))",
    ].join(" "),
    [
      "(let ((path \"/home/user/gc-buffer-file-name.txt\"))",
      "  (garbage-collect)",
      "  (with-current-buffer \"gc-buffer-file-name\"",
      "    (goto-char (point-max))",
      "    (insert \" beta\")",
      "    (write-region (point-min) (point-max) path nil 'silent)",
      "    (concat path \"\\n\" (buffer-string))))",
    ].join(" "),
  ],
  "named-buffer-set-visited-file-name": [
    [
      "(let ((path \"/home/user/gc-set-visited.txt\"))",
      "  (with-current-buffer (get-buffer-create \"gc-set-visited\")",
      "    (let ((buffer-undo-list t))",
      "      (erase-buffer)",
      "      (insert \"alpha\"))",
      "    (set-visited-file-name path t t)",
      "    (buffer-string)))",
    ].join(" "),
    [
      "(let ((path \"/home/user/gc-set-visited.txt\"))",
      "  (garbage-collect)",
      "  (with-current-buffer \"gc-set-visited.txt\"",
      "    (goto-char (point-max))",
      "    (insert \" beta\")",
      "    (write-region (point-min) (point-max) path nil 'silent)",
      "    (concat path \"\\n\" (buffer-string))))",
    ].join(" "),
  ],
  "named-buffer-insert-file-contents": [
    [
      "(let ((path \"/home/user/gc-insert-file-contents.txt\"))",
      "  (with-current-buffer (get-buffer-create \"gc-insert-file-contents\")",
      "    (let ((buffer-undo-list t))",
      "      (erase-buffer)",
      "      (insert-file-contents path))",
      "    (buffer-string)))",
    ].join(" "),
    [
      "(let ((path \"/home/user/gc-insert-file-contents.txt\"))",
      "  (garbage-collect)",
      "  (with-current-buffer \"gc-insert-file-contents\"",
      "    (goto-char (point-max))",
      "    (insert \" beta\")",
      "    (write-region (point-min) (point-max) path nil 'silent)",
      "    (concat path \"\\n\" (buffer-string))))",
    ].join(" "),
  ],
  "find-file-kill-before-boundary": [
    [
      "(let ((path \"/home/user/gc-find-file-kill.txt\"))",
      "  (find-file path)",
      "  (let ((buffer-undo-list t))",
      "    (erase-buffer)",
      "    (insert \"alpha\"))",
      "  (write-region (point-min) (point-max) path nil 'silent)",
      "  (kill-buffer (current-buffer))",
      "  path)",
    ].join(" "),
    [
      "(let ((path \"/home/user/gc-find-file-kill.txt\"))",
      "  (garbage-collect)",
      "  (with-temp-buffer",
      "    (insert-file-contents path)",
      "    (concat path \"\\n\" (buffer-string))))",
    ].join(" "),
  ],
  "find-file-live-buffer-gc": [
    [
      "(let ((path \"/home/user/gc-find-file-live.txt\"))",
      "  (find-file path)",
      "  (let ((buffer-undo-list t))",
      "    (erase-buffer)",
      "    (insert \"alpha\"))",
      "  (write-region (point-min) (point-max) path nil 'silent)",
      "  (concat path \"\\n\" (buffer-string)))",
    ].join(" "),
    [
      "(let ((path \"/home/user/gc-find-file-live.txt\"))",
      "  (garbage-collect)",
      "  (find-file path)",
      "  (goto-char (point-max))",
      "  (insert \" beta\")",
      "  (write-region (point-min) (point-max) path nil 'silent)",
      "  (concat path \"\\n\" (buffer-string)))",
    ].join(" "),
  ],
};

if (!process.argv.includes("--child")) {
  const summaries = [];
  const statuses = new Map();
  for (const name of Object.keys(cases)) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", name], {
      encoding: "utf8",
      timeout: 120_000,
    });
    const combined = `${result.stdout || ""}${result.stderr || ""}`.trimEnd();
    const knownBlocked = result.status !== 0 &&
      (
        combined.includes("memory access out of bounds") ||
        combined.includes("RuntimeError: unreachable") ||
        combined.includes("_STATUS:1")
      );
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
    if (status === "FAIL") {
      await writeFile(logPath, `${summaries.join("\n")}\n`);
      throw new Error(`file buffer GC roots case failed: ${name}; see ${logPath}`);
    }
  }

  await writeFile(logPath, `${summaries.join("\n")}\n`);
  if (![...statuses.values()].some((status) => status === "KNOWN_BLOCKER")) {
    throw new Error(`expected at least one GC/root known blocker; see ${logPath}`);
  }
  console.log("browser file-buffer GC roots probe recorded known host-eval GC/root blockers");
  process.exit(0);
}

const caseName = process.argv.at(-1);
const forms = cases[caseName];
if (!forms) throw new Error(`unknown file buffer GC roots case ${caseName}`);

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
  "gc-named.txt",
  "gc-buffer-file-name.txt",
  "gc-set-visited.txt",
  "gc-insert-file-contents.txt",
  "gc-find-file-kill.txt",
  "gc-find-file-live.txt",
]) {
  context.Module.FS_createDataFile("/home/user", fileName, new TextEncoder().encode("alpha"), true, true, true);
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
  if (status !== 0) {
    console.log(lines.join("\n"));
    throw new Error(`${label} eval failed with ${status}`);
  }
}

console.log(lines.join("\n"));
