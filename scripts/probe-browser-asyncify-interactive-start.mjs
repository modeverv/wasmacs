import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

const repoRoot = new URL("..", import.meta.url).pathname;
const artifactDir = process.env.WASMACS_ARTIFACT_DIR ?? `${repoRoot}/artifacts/emacs-browser-asyncify-spike`;
const logPath = process.env.WASMACS_LOG_PATH ?? `${repoRoot}/logs/wasm-browser-asyncify-interactive-start.txt`;
const timeoutMs = Number(process.env.WASMACS_ASYNCIFY_INTERACTIVE_TIMEOUT_MS ?? 5000);

const result = spawnSync(
  process.execPath,
  ["--stack-size=65500", "./temacs", "-Q", "--no-window-system", "--no-splash"],
  {
    cwd: artifactDir,
    encoding: "utf8",
    timeout: timeoutMs,
  },
);

const stdout = result.stdout ?? "";
const stderr = result.stderr ?? "";
const timedOut = result.error?.code === "ETIMEDOUT";
const lines = [
  "CASE:interactive-start-no-batch",
  `STATUS:${result.status}`,
  `SIGNAL:${result.signal}`,
  timedOut ? "TIMEOUT:true" : "TIMEOUT:false",
  `TIMEOUT_MS:${timeoutMs}`,
  `STDOUT:${stdout}`,
  `STDERR:${stderr}`,
];

await writeFile(logPath, `${lines.join("\n")}\n`);

if (!timedOut) {
  throw new Error(`expected non-batch asyncify startup to remain alive until timeout; see ${logPath}`);
}

if (stderr.includes("Please set the environment variable TERM")) {
  throw new Error(`TERM was not visible to non-batch Emacs startup; see ${logPath}`);
}

if (stderr.includes("Cannot open termcap database file")) {
  throw new Error(`inline TERMCAP was not visible to non-batch Emacs startup; see ${logPath}`);
}

if (stderr.includes("RuntimeError") || stderr.includes("Aborted(")) {
  throw new Error(`non-batch asyncify startup trapped before input wait; see ${logPath}`);
}

console.log("browser asyncify interactive start probe reached long-running non-batch startup");
