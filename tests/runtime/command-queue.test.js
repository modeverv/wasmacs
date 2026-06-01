import test from "node:test";
import assert from "node:assert/strict";
import { coalesceBufferCommand } from "../../app/src/command-queue.js";

test("coalesces adjacent insert-text commands for the same user file", () => {
  const queue = coalesceBufferCommand([], {
    type: "insert-text",
    path: "/home/user/notes.txt",
    pointIndex: 0,
    text: "a",
  });
  const coalesced = coalesceBufferCommand(queue, {
    type: "insert-text",
    path: "/home/user/notes.txt",
    pointIndex: 1,
    text: "b",
  });

  assert.deepEqual(coalesced, [
    {
      type: "insert-text",
      path: "/home/user/notes.txt",
      pointIndex: 0,
      text: "ab",
    },
  ]);
});

test("keeps backspace as an ordering boundary", () => {
  const queue = coalesceBufferCommand(
    [
      {
        type: "insert-text",
        path: "/home/user/notes.txt",
        pointIndex: 0,
        text: "a",
      },
    ],
    {
      type: "backspace",
      path: "/home/user/notes.txt",
      pointIndex: 1,
    },
  );

  assert.deepEqual(queue, [
    {
      type: "insert-text",
      path: "/home/user/notes.txt",
      pointIndex: 0,
      text: "a",
    },
    {
      type: "backspace",
      path: "/home/user/notes.txt",
      pointIndex: 1,
    },
  ]);
});
