import assert from "node:assert/strict";
import { test } from "node:test";
import { browserKeyEventToEmacsBytes } from "../../src/wasm/src/emacs-key-bytes.js";

test("printable characters", () => {
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "a" }), [97]);
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "z" }), [122]);
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: " " }), [32]);
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "A" }), [65]);
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "0" }), [48]);
});

test("special keys", () => {
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "Enter" }), [13]);
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "Backspace" }), [127]);
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "Escape" }), [27]);
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "Tab" }), [9]);
});

test("control keys", () => {
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "g", ctrlKey: true }), [7]); // C-g
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "a", ctrlKey: true }), [1]); // C-a
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "/", ctrlKey: true }), [31]); // C-/
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "x", ctrlKey: true }), [24]); // C-x
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "n", ctrlKey: true }), [14]); // C-n
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "p", ctrlKey: true }), [16]); // C-p
});

test("alt keys produce ESC prefix sequence", () => {
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "x", altKey: true }), [27, 120]); // M-x
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "w", altKey: true }), [27, 119]); // M-w
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "d", altKey: true }), [27, 100]); // M-d
});

test("arrow keys use VT100 sequences", () => {
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "ArrowUp" }), [27, 91, 65]);
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "ArrowDown" }), [27, 91, 66]);
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "ArrowRight" }), [27, 91, 67]);
  assert.deepEqual(browserKeyEventToEmacsBytes({ key: "ArrowLeft" }), [27, 91, 68]);
});

test("unhandled keys return null", () => {
  assert.equal(browserKeyEventToEmacsBytes({ key: "F1" }), null);
  assert.equal(browserKeyEventToEmacsBytes({ key: "F12" }), null);
  assert.equal(browserKeyEventToEmacsBytes({ key: "a", metaKey: true }), null);
  assert.equal(browserKeyEventToEmacsBytes({ key: "a", isComposing: true }), null);
  assert.equal(browserKeyEventToEmacsBytes({ key: "Shift" }), null);
  assert.equal(browserKeyEventToEmacsBytes({ key: "Control" }), null);
  assert.equal(browserKeyEventToEmacsBytes({ key: "PageUp" }), null);
  assert.equal(browserKeyEventToEmacsBytes({ key: "Home" }), null);
});

test("ctrlKey with non-letter returns null", () => {
  assert.equal(browserKeyEventToEmacsBytes({ key: "ArrowUp", ctrlKey: true }), null);
  assert.equal(browserKeyEventToEmacsBytes({ key: "F1", ctrlKey: true }), null);
});

test("altKey with multi-character key returns null", () => {
  assert.equal(browserKeyEventToEmacsBytes({ key: "Enter", altKey: true }), null);
  assert.equal(browserKeyEventToEmacsBytes({ key: "Escape", altKey: true }), null);
});
