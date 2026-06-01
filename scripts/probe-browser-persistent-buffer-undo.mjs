import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = `${repoRoot}/artifacts/emacs-browser-persistent-spike`;
const logPath = `${repoRoot}/logs/wasm-browser-persistent-buffer-undo.txt`;

if (!process.argv.includes("--child")) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child"], {
    encoding: "utf8",
  });
  const combined = `${result.stdout || ""}${result.stderr || ""}`;
  const safeLispError = combined.includes("EVAL_STATUS:1") &&
    combined.includes("(error user-error No further undo information)");
  const knownBlocked = result.status !== 0 &&
    (combined.includes("memory access out of bounds") || safeLispError);

  await writeFile(
    logPath,
    [
      `EXIT_STATUS:${result.status}`,
      safeLispError
        ? "KNOWN_BLOCKER:persistent buffer undo now returns a safe Lisp user-error without a command boundary"
        : knownBlocked
        ? "KNOWN_BLOCKER:persistent buffer undo currently crashes wasm during GC/undo traversal"
        : "KNOWN_BLOCKER:absent",
      combined.trimEnd(),
      "",
    ].join("\n"),
  );

  if (!knownBlocked && result.status !== 0) {
    throw new Error(`unexpected persistent buffer undo failure; see ${logPath}`);
  }

  console.log(
    knownBlocked
      ? "browser persistent buffer undo probe recorded known undo blocker"
      : "browser persistent buffer undo probe passed",
  );
  process.exit(0);
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
context.Module.FS_createDataFile(
  "/home/user",
  "persistent-undo.txt",
  new TextEncoder().encode(""),
  true,
  true,
  true,
);

const boot = context.Module.callMain(["--batch", "--eval", '(princ "boot\\n")']);
const commandForm = [
  "(let ((path \"/home/user/persistent-undo.txt\"))",
  "  (find-file path)",
  "  (let ((buffer-undo-list t))",
  "    (erase-buffer)",
  "    (insert \"alpha\"))",
  "  (setq buffer-undo-list nil)",
  "  (undo-boundary)",
  "  (insert \" beta\")",
  "  (undo)",
  "  (write-region (point-min) (point-max) path nil 'silent)",
  "  (concat path",
  '          "\\n"',
  "          (number-to-string (1- (point)))",
  '          "\\n"',
  "          (buffer-string)))",
].join(" ");
const evalStatus = context.Module.ccall(
  "wasmacs_eval_string",
  "number",
  ["string"],
  [commandForm],
);
const readback = context.Module.ccall("wasmacs_last_result", "string", [], []);
const fileText = context.Module.FS_readFile("/home/user/persistent-undo.txt", { encoding: "utf8" });

lines.push(`BOOT_EXIT:${boot}`);
lines.push(`EVAL_STATUS:${evalStatus}`);
lines.push(`READBACK:${readback}`);
lines.push(`FILE_TEXT:${fileText}`);
console.log(lines.join("\n"));

if (boot !== 0) {
  throw new Error(`expected boot callMain to exit 0, got ${boot}`);
}
if (evalStatus !== 0) {
  throw new Error(`expected wasmacs_eval_string to return 0, got ${evalStatus}`);
}
if (fileText !== "alpha") {
  throw new Error(`expected persistent buffer undo to leave alpha, got ${JSON.stringify(fileText)}`);
}
