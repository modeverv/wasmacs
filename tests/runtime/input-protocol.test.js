import test from "node:test";
import assert from "node:assert/strict";
import {
  keyEventToBufferCommand,
  validateBufferCommand,
} from "../../app/src/input-protocol.js";

test("printable keys become insert-text commands", () => {
  const command = keyEventToBufferCommand({ key: "a", path: "/home/user/notes.txt", pointIndex: 3 });

  assert.deepEqual(command, {
    type: "insert-text",
    path: "/home/user/notes.txt",
    pointIndex: 3,
    text: "a",
  });
  assert.equal(validateBufferCommand(command), true);
});

test("enter and backspace become explicit buffer commands", () => {
  assert.deepEqual(
    keyEventToBufferCommand({ key: "Enter", path: "/home/user/notes.txt", pointIndex: 1 }),
    { type: "insert-text", path: "/home/user/notes.txt", pointIndex: 1, text: "\n" },
  );
  assert.deepEqual(
    keyEventToBufferCommand({ key: "Backspace", path: "/home/user/notes.txt", pointIndex: 1 }),
    { type: "backspace", path: "/home/user/notes.txt", pointIndex: 1 },
  );
});

test("arrow keys become move-point commands", () => {
  assert.deepEqual(
    keyEventToBufferCommand({ key: "ArrowLeft", path: "/home/user/notes.txt", pointIndex: 4 }),
    { type: "move-point", direction: "left", path: "/home/user/notes.txt", pointIndex: 4 },
  );
  assert.deepEqual(
    keyEventToBufferCommand({ key: "ArrowRight", path: "/home/user/notes.txt", pointIndex: 4 }),
    { type: "move-point", direction: "right", path: "/home/user/notes.txt", pointIndex: 4 },
  );
});

test("modified and composing keys stay outside the first command bridge", () => {
  assert.equal(keyEventToBufferCommand({ key: "x", path: "/home/user/notes.txt", ctrlKey: true }), undefined);
  assert.equal(keyEventToBufferCommand({ key: "x", path: "/home/user/notes.txt", isComposing: true }), undefined);
  assert.equal(keyEventToBufferCommand({ key: "Escape", path: "/home/user/notes.txt" }), undefined);
});

test("buffer commands are scoped to the user filesystem", () => {
  assert.equal(validateBufferCommand({ type: "backspace", path: "/system/lisp/foo.el" }), false);
  assert.equal(validateBufferCommand({ type: "insert-text", path: "/home/user/notes.txt", text: "" }), false);
});
