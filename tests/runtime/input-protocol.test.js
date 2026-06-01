import test from "node:test";
import assert from "node:assert/strict";
import {
  keyEventToBufferCommand,
  nextPointIndexForCommand,
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

test("unknown modified and composing keys stay outside the first command bridge", () => {
  assert.equal(keyEventToBufferCommand({ key: "q", path: "/home/user/notes.txt", ctrlKey: true }), undefined);
  assert.equal(keyEventToBufferCommand({ key: "x", path: "/home/user/notes.txt", altKey: true }), undefined);
  assert.equal(keyEventToBufferCommand({ key: "x", path: "/home/user/notes.txt", isComposing: true }), undefined);
  assert.equal(keyEventToBufferCommand({ key: "Escape", path: "/home/user/notes.txt" }), undefined);
});

test("ctrl-s becomes an explicit save command", () => {
  const command = keyEventToBufferCommand({
    ctrlKey: true,
    key: "s",
    path: "/home/user/projects/demo.txt",
    pointIndex: 7,
  });

  assert.deepEqual(command, {
    type: "save-buffer",
    path: "/home/user/projects/demo.txt",
    pointIndex: 7,
  });
  assert.equal(validateBufferCommand(command), true);
});

test("emacs-ish control keys become explicit command boundaries", () => {
  assert.deepEqual(
    keyEventToBufferCommand({
      ctrlKey: true,
      key: "g",
      path: "/home/user/projects/demo.txt",
      pointIndex: 7,
    }),
    {
      type: "keyboard-quit",
      path: "/home/user/projects/demo.txt",
      pointIndex: 7,
    },
  );
  assert.deepEqual(
    keyEventToBufferCommand({
      ctrlKey: true,
      key: "/",
      path: "/home/user/projects/demo.txt",
      pointIndex: 7,
    }),
    {
      type: "undo",
      path: "/home/user/projects/demo.txt",
      pointIndex: 7,
    },
  );
  assert.equal(validateBufferCommand({ type: "keyboard-quit", path: "/home/user/projects/demo.txt" }), true);
  assert.equal(validateBufferCommand({ type: "undo", path: "/home/user/projects/demo.txt" }), true);
});

test("clipboard and kill-ring keys become explicit command boundaries", () => {
  assert.deepEqual(
    keyEventToBufferCommand({
      altKey: true,
      key: "w",
      path: "/home/user/projects/demo.txt",
      pointIndex: 7,
    }),
    {
      type: "clipboard-copy",
      path: "/home/user/projects/demo.txt",
      pointIndex: 7,
    },
  );
  assert.deepEqual(
    keyEventToBufferCommand({
      ctrlKey: true,
      key: "w",
      path: "/home/user/projects/demo.txt",
      pointIndex: 7,
    }),
    {
      type: "clipboard-cut",
      path: "/home/user/projects/demo.txt",
      pointIndex: 7,
    },
  );
  assert.deepEqual(
    keyEventToBufferCommand({
      ctrlKey: true,
      key: "y",
      path: "/home/user/projects/demo.txt",
      pointIndex: 7,
    }),
    {
      type: "clipboard-yank",
      path: "/home/user/projects/demo.txt",
      pointIndex: 7,
    },
  );
  assert.equal(validateBufferCommand({ type: "clipboard-copy", path: "/home/user/projects/demo.txt" }), true);
  assert.equal(validateBufferCommand({ type: "clipboard-cut", path: "/home/user/projects/demo.txt" }), true);
  assert.equal(validateBufferCommand({ type: "clipboard-yank", path: "/home/user/projects/demo.txt" }), true);
});

test("c-x command sequences expose minibuffer command boundaries", () => {
  assert.deepEqual(
    keyEventToBufferCommand({
      ctrlKey: true,
      key: "x",
      path: "/home/user/projects/demo.txt",
      pointIndex: 7,
    }),
    {
      type: "key-prefix",
      prefix: "C-x",
      path: "/home/user/projects/demo.txt",
      pointIndex: 7,
    },
  );
  assert.deepEqual(
    keyEventToBufferCommand({
      ctrlKey: true,
      key: "f",
      path: "/home/user/projects/demo.txt",
      pointIndex: 7,
      prefix: "C-x",
    }),
    {
      type: "find-file",
      path: "/home/user/projects/demo.txt",
      pointIndex: 7,
    },
  );
  assert.deepEqual(
    keyEventToBufferCommand({
      key: "b",
      path: "/home/user/projects/demo.txt",
      pointIndex: 7,
      prefix: "C-x",
    }),
    {
      type: "switch-buffer",
      path: "/home/user/projects/demo.txt",
      pointIndex: 7,
    },
  );
  assert.equal(validateBufferCommand({ type: "find-file", path: "/home/user/projects/demo.txt" }), true);
  assert.equal(validateBufferCommand({ type: "switch-buffer", path: "/home/user/projects/demo.txt" }), true);
});

test("buffer commands are scoped to the user filesystem", () => {
  assert.equal(validateBufferCommand({ type: "backspace", path: "/system/lisp/foo.el" }), false);
  assert.equal(validateBufferCommand({ type: "insert-text", path: "/home/user/notes.txt", text: "" }), false);
  assert.equal(validateBufferCommand({ type: "process-probe", path: "/home/user/projects/demo.txt" }), true);
});

test("point advances optimistically for queued editing commands", () => {
  assert.equal(
    nextPointIndexForCommand(0, { type: "insert-text", text: "abc" }, 10),
    3,
  );
  assert.equal(
    nextPointIndexForCommand(3, { type: "insert-text", text: "abc" }, 3),
    6,
  );
  assert.equal(
    nextPointIndexForCommand(3, { type: "backspace" }, 10),
    2,
  );
  assert.equal(
    nextPointIndexForCommand(0, { type: "move-point", direction: "left" }, 10),
    0,
  );
  assert.equal(
    nextPointIndexForCommand(9, { type: "move-point", direction: "right" }, 9),
    9,
  );
});
