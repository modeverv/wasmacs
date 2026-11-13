import assert from "node:assert/strict";
import { test } from "node:test";
import { batchEval, docsArtifactDir, docsUserlandDir } from "../../tools/scripts/lib/pdump-node-harness.mjs";
import { ediffCases, prepareEdiffFixtures } from "../process/ediff-cases.mjs";

// Missing/stale deployed artifacts must fail this check, not silently skip it:
// the shipped product needs a working normal-format diff and diff3 for Ediff.
for (const testCase of [ediffCases[0], ediffCases[2]]) {
  test(`Pages bundle: ${testCase.name}`, async () => {
    const result = await batchEval(testCase.form, {
      artifactDir: docsArtifactDir, userland: docsUserlandDir, prepare: prepareEdiffFixtures,
    });
    assert.equal(result.ok, true, `Emacs ${result.value}; ${result.stderr.slice(-5).join(" | ")}`);
    assert.equal(result.value, testCase.expected);
  });
}
