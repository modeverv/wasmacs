// Guards the Emacs patch layer: vendor/emacs is read-only and the product C
// and Lisp changes are the unified diffs in src/c/patches.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const patchDir = join(repoRoot, "src/c/patches");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");
const patches = readdirSync(patchDir).filter((name) => name.endsWith(".patch")).sort();
const vendorPresent = existsSync(join(repoRoot, "vendor/emacs/src/emacs.c"));

test("patch files are ordered and only touch Emacs src/ and lisp/", () => {
  assert.equal(patches.length >= 5, true);
  for (const [index, name] of patches.entries()) {
    assert.match(name, /^\d{4}-[a-z0-9-]+\.patch$/);
    assert.equal(Number(name.slice(0, 4)), index + 1, `${name} breaks the numbering`);
    const text = readFileSync(join(patchDir, name), "utf8");
    const files = [...text.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
    assert.equal(files.length > 0, true, `${name} names no file`);
    for (const file of files) assert.match(file, /^(src|lisp)\//, `${name} touches ${file}`);
  }
});

test("patch layer applies cleanly to the pinned vendor/emacs", { skip: !vendorPresent }, () => {
  const result = spawnSync(join(repoRoot, "src/build/apply-emacs-patches.sh"), ["--check"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /emacs patch layer ok/);
});

test("vendor/emacs is pinned to the release the patches were taken against", { skip: !vendorPresent }, () => {
  const head = execFileSync("git", ["-C", join(repoRoot, "vendor/emacs"), "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(head, "636f166cfc86aa90d63f592fd99f3fdd9ef95ebd", "vendor/emacs moved: regenerate src/c/patches");
});

test("product build applies the patch layer and nothing else to Emacs sources", () => {
  const builder = read("src/build/build-emacs-browser-atomics-pdump-profile.sh");
  assert.match(builder, /src\/build\/apply-emacs-patches\.sh" "\$\{pdump_src\}"/);
  assert.doesNotMatch(builder, /patch-emacs-host-entrypoint-spike\.sh/);
  // The only in-place edits left are build-tree configuration (config.h, Makefile).
  const edited = [...builder.matchAll(/^\s+(src\/[A-Za-z0-9_.\/-]+)\s*$/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(edited)].sort(), ["src/Makefile", "src/config.h"]);
});

test("C patch layer README documents the workflow", () => {
  const readme = read("src/c/README.md");
  assert.match(readme, /apply-emacs-patches\.sh/);
  assert.match(readme, /src\/c\/patches/);
  assert.doesNotMatch(readme, /emacs-30\.2-patched/);
});
