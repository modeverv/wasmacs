import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test("Asyncify browser build uses its own fresh Emacs source tree", () => {
  const source = readFileSync(
    join(repoRoot, "tools/scripts/build-emacs-browser-asyncify-spike.sh"),
    "utf8",
  );

  assert.match(source, /vscode_build_root="\$\{WASMACS_VSCODE_BUILD_ROOT:-\$\{repo_root\}\/build2\}"/);
  assert.match(source, /work_root="\$\{vscode_build_root\}\/emacs-browser-asyncify-spike"/);
  assert.match(source, /out_dir="\$\{vscode_build_root\}\/artifacts\/emacs-browser-asyncify-spike"/);
  assert.match(source, /source_ref="\$\{repo_root\}\/vendor\/emacs"/);
  assert.match(source, /WASMACS_ASYNCIFY_FORCE_RECOPY/);
  assert.match(source, /git -C "\$\{source_ref\}" archive HEAD \| tar -x -C "\$\{source_copy\}"/);
  assert.match(source, /WASMACS_SPIKE_SRC="\$\{source_copy\}"/);
  assert.match(source, /WASMACS_NATIVE_WORK_ROOT="\$\{vscode_build_root\}\/native-emacs-30\.2"/);
});
