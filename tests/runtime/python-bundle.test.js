import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Run in a disposable Node process so a broken CPU-loop polling hook cannot
// hang CI's own event loop. Missing deployed Python/stdlib assets must fail.
for (const filter of ["a Python script shares UTF-8 files", "run-python:"]) {
  test(`Pages bundle: ${filter}`, () => {
    const result = spawnSync(process.execPath, ["tools/scripts/probe-python.mjs", filter], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: { ...process.env, WASMACS_PROCESS_PROBE_BUNDLE: "docs" },
      encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PASS /);
  });
}
