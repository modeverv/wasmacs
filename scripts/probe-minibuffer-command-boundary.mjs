import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { keyEventToBufferCommand, validateBufferCommand } from "../app/src/input-protocol.js";

const repoRoot = new URL("..", import.meta.url).pathname;
const workerSource = await readFile(`${repoRoot}/app/src/wasm-worker.js`, "utf8");

const prefix = keyEventToBufferCommand({
  ctrlKey: true,
  key: "x",
  path: "/home/user/projects/minibuffer-boundary.txt",
  pointIndex: 4,
});
const findFile = keyEventToBufferCommand({
  ctrlKey: true,
  key: "f",
  path: "/home/user/projects/minibuffer-boundary.txt",
  pointIndex: 4,
  prefix: "C-x",
});
const switchBuffer = keyEventToBufferCommand({
  key: "b",
  path: "/home/user/projects/minibuffer-boundary.txt",
  pointIndex: 4,
  prefix: "C-x",
});

assert.deepEqual(prefix, {
  type: "key-prefix",
  prefix: "C-x",
  path: "/home/user/projects/minibuffer-boundary.txt",
  pointIndex: 4,
});
assert.deepEqual(findFile, {
  type: "find-file",
  path: "/home/user/projects/minibuffer-boundary.txt",
  pointIndex: 4,
});
assert.deepEqual(switchBuffer, {
  type: "switch-buffer",
  path: "/home/user/projects/minibuffer-boundary.txt",
  pointIndex: 4,
});
assert.equal(validateBufferCommand(findFile), true);
assert.equal(validateBufferCommand(switchBuffer), true);
assert.match(workerSource, /minibuffer requires persistent Emacs command loop/);

await writeFile(
  `${repoRoot}/logs/minibuffer-command-boundary.txt`,
  [
    "PASS C-x prefix is recognized",
    "PASS C-x C-f maps to find-file",
    "PASS C-x b maps to switch-buffer",
    "PASS worker reports minibuffer unavailable until persistent command loop exists",
    "",
  ].join("\n"),
);

console.log("minibuffer command boundary probe passed");
