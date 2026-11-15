// tools/scripts/ert.mjs: ERT in the published WebAssembly Emacs 30.2.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { docsArtifactDir, repoRoot } from "../../tools/scripts/lib/pdump-node-harness.mjs";

const skip = !existsSync(`${docsArtifactDir}/temacs.wasm`) && "docs/artifacts has no Emacs build";
const ert = (...args) => spawnSync("node", [`${repoRoot}tools/scripts/ert.mjs`, "--root", `${repoRoot}tests/fixtures/ert-project`, "-L", ".", ...args], { encoding: "utf8" });

test("ERT runner: a project's tests pass in Emacs 30.2 (WebAssembly)", { skip }, () => {
  const run = ert("-c", "greet", "-l", "greet-test", "--selector", "greet-\\(says\\|in\\)");
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /2 of 2 tests passed in Emacs 30\.2/);
});

test("ERT runner: a failing test makes it exit 1", { skip }, () => {
  const run = ert("-l", "greet", "-l", "greet-test");
  assert.equal(run.status, 1);
  assert.match(run.stdout, /2 of 3 tests passed/);
});
