import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUserPath } from "../../src/wasm/src/user-path.js";

test("relative file names open under projects", () => {
  assert.equal(
    normalizeUserPath("notes/today.txt"),
    "/home/user/projects/notes/today.txt",
  );
});

test("absolute user paths are preserved and normalized", () => {
  assert.equal(
    normalizeUserPath("/home/user/projects/../notes.txt"),
    "/home/user/notes.txt",
  );
});

test("paths outside the user filesystem are rejected", () => {
  assert.throws(() => normalizeUserPath("/system/lisp/subr.el"), /path must stay under \/home\/user/);
  assert.throws(() => normalizeUserPath("../../system/lisp/subr.el"), /path must stay under \/home\/user/);
});
