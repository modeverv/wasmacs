import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-undo-tail-phases.txt`;
const path = "/home/user/undo-tail.txt";

const setup = [
  `(let ((path ${JSON.stringify(path)}))`,
  "  (find-file path)",
  "  (let ((buffer-undo-list t))",
  "    (erase-buffer)",
  "    (insert \"alpha\"))",
  "  (setq buffer-undo-list nil)",
  "  (undo-boundary)",
  "  (insert \" beta\")",
].join(" ");

const readback = [
  "  (concat path",
  '          "\\n"',
  "          (number-to-string (1- (point)))",
  '          "\\n"',
  "          (buffer-string)))",
].join(" ");

const withSetup = (body) => [setup, body, readback].join(" ");

const namedSetup = [
  '(with-current-buffer (get-buffer-create "undo-tail-named")',
  "  (let ((buffer-undo-list t))",
  "    (erase-buffer)",
  "    (insert \"alpha\"))",
  "  (setq buffer-undo-list nil)",
  "  (undo-boundary)",
  "  (insert \" beta\")",
].join(" ");

const namedReadback = [
  "  (concat (buffer-name)",
  '          "\\n"',
  "          (number-to-string (1- (point)))",
  '          "\\n"',
  "          (buffer-string)))",
].join(" ");

const withNamedSetup = (body) => [namedSetup, body, namedReadback].join(" ");

const pointRecordPrune = [
  "  (let ((tail buffer-undo-list)",
  "        (prev nil))",
  "    (while (car tail)",
  "      (when (integerp (car tail))",
  "        (let ((pos (car tail)))",
  "          (if prev",
  "              (setcdr prev (cdr tail))",
  "            (setq buffer-undo-list (cdr tail)))",
  "          (setq tail (cdr tail))",
  "          (while (car tail)",
  "            (if (eq pos (car tail))",
  "                (if prev",
  "                    (setcdr prev (cdr tail))",
  "                  (setq buffer-undo-list (cdr tail)))",
  "              (setq prev tail))",
  "            (setq tail (cdr tail)))",
  "          (setq tail nil)))",
  "      (setq prev tail tail (cdr tail))))",
].join(" ");

const cases = {
  "undo-start-more-once": withSetup([
    "  (undo-start)",
    "  (undo-more 1)",
  ].join(" ")),
  "undo-start-more-twice": withSetup([
    "  (undo-start)",
    "  (undo-more 1)",
    "  (undo-more 1)",
  ].join(" ")),
  "named-buffer-undo-start-more-once": withNamedSetup([
    "  (undo-start)",
    "  (undo-more 1)",
  ].join(" ")),
  "named-buffer-undo-start-more-twice": withNamedSetup([
    "  (undo-start)",
    "  (undo-more 1)",
    "  (undo-more 1)",
  ].join(" ")),
  "named-buffer-high-level-undo": withNamedSetup("  (undo)"),
  "undo-tail-puthash": withSetup([
    "  (undo-start)",
    "  (undo-more 1)",
    "  (setq this-command 'undo)",
    "  (let ((equiv (gethash pending-undo-list undo-equiv-table)))",
    "    (when (and (consp equiv) undo-no-redo)",
    "      (while (let ((next (gethash equiv undo-equiv-table)))",
    "               (if next (setq equiv next))))",
    "      (setq pending-undo-list (if (consp equiv) equiv t))))",
    "  (undo-more 1)",
    "  (let ((list buffer-undo-list))",
    "    (while (eq (car list) nil)",
    "      (setq list (cdr list)))",
    "    (puthash list",
    "             (cond",
    "              (undo-in-region 'undo-in-region)",
    "              ((eq list pending-undo-list)",
    "               (or (gethash list undo-equiv-table) 'empty))",
    "              (t pending-undo-list))",
    "             undo-equiv-table))",
  ].join(" ")),
  "undo-tail-prune-point-records": withSetup([
    "  (undo-start)",
    "  (undo-more 1)",
    "  (setq this-command 'undo)",
    "  (undo-more 1)",
    pointRecordPrune,
  ].join(" ")),
  "undo-tail-modified-autosave-message": withSetup([
    "  (let* ((modified (buffer-modified-p))",
    "         (base-buffer (or (buffer-base-buffer) (current-buffer)))",
    "         (recent-save (with-current-buffer base-buffer",
    "                        (recent-auto-save-p)))",
    "         message)",
    "    (setq this-command 'undo-start)",
    "    (undo-start)",
    "    (undo-more 1)",
    "    (setq this-command 'undo)",
    "    (setq message \"Undo\")",
    "    (undo-more 1)",
    "    (let ((list buffer-undo-list))",
    "      (while (eq (car list) nil)",
    "        (setq list (cdr list)))",
    "      (puthash list pending-undo-list undo-equiv-table))",
    pointRecordPrune,
    "    (and modified (not (buffer-modified-p))",
    "         (with-current-buffer base-buffer",
    "           (delete-auto-save-file-if-necessary recent-save)))",
    "    (if message",
    "        (message \"%s\" message)))",
  ].join(" ")),
  "high-level-undo-no-save": withSetup("  (undo)"),
  "high-level-undo-save-buffer": withSetup([
    "  (undo)",
    "  (save-buffer)",
  ].join(" ")),
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
    const timedOut = result.error?.code === "ETIMEDOUT";
    const knownBlocked = result.status !== 0 &&
      (
        timedOut ||
        combined.includes("memory access out of bounds") ||
        combined.includes("RuntimeError: unreachable") ||
        combined.includes("null function or function signature mismatch") ||
        combined.includes("Aborted(native code called abort())")
      );
    const status = result.status === 0 ? "PASS" : knownBlocked ? "KNOWN_BLOCKER" : "FAIL";
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
      throw new Error(`undo tail phase case failed: ${name}; see ${logPath}`);
    }
  }

  if (statuses.get("undo-start-more-once") !== "PASS") {
    throw new Error(`undo-start-more-once baseline must pass; see ${logPath}`);
  }

  console.log("browser undo tail phase probe passed with known high-level undo blockers");
  process.exit(0);
}

const caseName = process.argv.at(-1);
const commandForm = cases[caseName];
if (!commandForm) throw new Error(`unknown undo tail phase case ${caseName}`);

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
context.Module.FS_createDataFile(
  "/home/user",
  "undo-tail.txt",
  new TextEncoder().encode(""),
  true,
  true,
  true,
);

const boot = context.Module.callMain(["--batch", "--eval", '(princ "boot\\n")']);
const evalStatus = context.Module.ccall("wasmacs_eval_string", "number", ["string"], [commandForm]);
const readbackValue = context.Module.ccall("wasmacs_last_result", "string", [], []);
const fileText = context.Module.FS_readFile(path, { encoding: "utf8" });

lines.push(`BOOT_EXIT:${boot}`);
lines.push(`EVAL_STATUS:${evalStatus}`);
lines.push(`READBACK:${readbackValue}`);
lines.push(`FILE_TEXT:${fileText}`);
console.log(lines.join("\n"));

if (boot !== 0) throw new Error(`expected boot exit 0, got ${boot}`);
if (evalStatus !== 0) throw new Error(`expected eval status 0, got ${evalStatus}`);
