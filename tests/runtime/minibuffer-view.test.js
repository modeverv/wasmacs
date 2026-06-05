import assert from "node:assert/strict";
import test from "node:test";

import { minibufferTextForPrefix, minibufferTextForWorkerError } from "../../src/wasm/src/minibuffer-view.js";

test("minibuffer prefix view renders command prefixes only", () => {
  assert.equal(minibufferTextForPrefix("C-x"), "C-x");
  assert.equal(minibufferTextForPrefix(undefined), "");
  assert.equal(minibufferTextForPrefix(""), "");
});

test("minibuffer worker error view keeps unavailable boundaries explicit", () => {
  assert.equal(
    minibufferTextForWorkerError("Error: minibuffer requires persistent Emacs command loop, minibuffer window state, and completion UI"),
    "minibuffer unavailable: persistent command loop, window state, completion UI",
  );
  assert.equal(
    minibufferTextForWorkerError("Error: clipboard/kill-ring requires GUI clipboard protocol plus persistent region and kill-ring state"),
    "clipboard unavailable: GUI clipboard protocol and persistent region state required",
  );
  assert.equal(
    minibufferTextForWorkerError("Error: host.process is unavailable in the browser MVP"),
    "process unavailable",
  );
  assert.equal(minibufferTextForWorkerError("unrelated"), "");
});
