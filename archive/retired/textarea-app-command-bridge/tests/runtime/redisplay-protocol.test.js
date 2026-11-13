import test from "node:test";
import assert from "node:assert/strict";
import {
  textToGridDrawMessage,
  validateTextGridDrawMessage,
} from "../../src/wasm/src/redisplay-protocol.js";

test("text grid draw messages carry wrapped rows and point", () => {
  const message = textToGridDrawMessage({
    path: "/home/user/notes.txt",
    text: "abcde\nxy",
    columns: 3,
  });

  assert.equal(message.type, "text-grid-draw");
  assert.equal(message.version, 1);
  assert.deepEqual(message.rows, ["abc", "de", "xy"]);
  assert.deepEqual(message.point, { index: 8, row: 2, column: 2 });
  assert.match(message.modeLine, /notes\.txt/);
  assert.equal(validateTextGridDrawMessage(message), true);
});

test("text grid draw messages preserve empty lines", () => {
  const message = textToGridDrawMessage({
    path: "/home/user/notes.txt",
    text: "top\n\nbottom",
    columns: 80,
  });

  assert.deepEqual(message.rows, ["top", "", "bottom"]);
});

test("text grid draw messages reject invalid column counts", () => {
  assert.throws(
    () => textToGridDrawMessage({ path: "/tmp/x", text: "x", columns: 0 }),
    /columns must be a positive integer/,
  );
});

test("text grid draw messages place point from a linear buffer index", () => {
  const message = textToGridDrawMessage({
    path: "/home/user/notes.txt",
    text: "abcde",
    columns: 3,
    pointIndex: 2,
  });

  assert.deepEqual(message.rows, ["abc", "de"]);
  assert.deepEqual(message.point, { index: 2, row: 0, column: 2 });
});
