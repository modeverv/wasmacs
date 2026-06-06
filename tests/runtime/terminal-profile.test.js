import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

for (const relativePath of [
  "tools/scripts/wasmacs-asyncify-host-library.js",
  "tools/scripts/wasmacs-atomics-host-library.js",
]) {
  test(`${relativePath} advertises xterm truecolor with cursor keys and mouse-ready terminal profile`, () => {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.match(source, /ENV\.TERM\s+= ENV\.TERM\s+\|\| 'xterm-256color'/);
    assert.match(source, /xterm-256color:co#80:li#24:Co#16777216/);
    assert.match(source, /ENV\.COLORTERM\s+= ENV\.COLORTERM\s+\|\| 'truecolor'/);
    assert.ok(source.includes("ku=\\\\\\\\E[A:kd=\\\\\\\\E[B:kr=\\\\\\\\E[C:kl=\\\\\\\\E[D"));
    assert.ok(source.includes("ks=\\\\\\\\E[?1h\\\\\\\\E=:ke=\\\\\\\\E[?1l\\\\\\\\E>"));
  });
}
