import test from "node:test";
import assert from "node:assert/strict";
import { isEditorModified } from "../../app/src/buffer-dirty.js";

test("editor text is dirty when it differs from the saved buffer text", () => {
  assert.equal(isEditorModified("alpha", "alpha"), false);
  assert.equal(isEditorModified("alpha", "alpha\n"), true);
  assert.equal(isEditorModified("", "draft"), true);
});
