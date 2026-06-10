import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateFallbackTerminalDimensions,
  controlKeyEventToBytes,
  DEFAULT_XTERM_FONT_SIZE,
  createXtermEmacsTerminal,
  decodeOsc52ClipboardPayload,
  metaKeyEventToBytes,
  stripBracketedPasteMarkers,
  terminalKeyEventToBytes,
  xtermDataToBytes,
} from "../../src/wasm/src/xterm-emacs-terminal.js";

test("xterm default font size is comfortable for the primary terminal surface", () => {
  assert.equal(DEFAULT_XTERM_FONT_SIZE, 20);
});

test("createXtermEmacsTerminal passes the default font size to xterm", () => {
  const originalWindow = globalThis.window;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  let terminalOptions;
  let focused = 0;

  class FakeTerminal {
    constructor(options) {
      terminalOptions = options;
      this.options = options;
      this.cols = options.cols;
      this.rows = options.rows;
    }
    open() {}
    focus() {
      focused += 1;
    }
    onData() {}
    write() {}
    dispose() {}
  }

  globalThis.window = {
    Terminal: FakeTerminal,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.requestAnimationFrame = () => {};
  try {
    const terminal = createXtermEmacsTerminal({
      isConnected: false,
      addEventListener() {},
      removeEventListener() {},
    });
    terminal.focus();
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }

  assert.equal(terminalOptions.fontSize, 20);
  assert.equal(terminalOptions.cursorBlink, true);
  assert.equal(terminalOptions.cursorStyle, "block");
  assert.equal(terminalOptions.macOptionIsMeta, true);
  assert.equal(typeof terminalOptions.customKeyEventHandler, "function");
  assert.equal(terminalOptions.theme.cursor.length > 0, true);
  assert.equal(focused >= 2, true);
});

test("fallback terminal fit derives rows and columns from container pixels", () => {
  assert.deepEqual(
    calculateFallbackTerminalDimensions({
      width: 620,
      height: 270,
      fontSize: 10,
    }),
    { cols: 100, rows: 20 },
  );
});

test("fallback terminal fit subtracts container padding", () => {
  assert.deepEqual(
    calculateFallbackTerminalDimensions({
      width: 636,
      height: 297,
      fontSize: 10,
      horizontalPadding: 16,
      verticalPadding: 27,
    }),
    { cols: 100, rows: 20 },
  );
});

test("fallback terminal fit keeps a usable minimum size", () => {
  assert.deepEqual(
    calculateFallbackTerminalDimensions({
      width: 1,
      height: 1,
      fontSize: 14,
    }),
    { cols: 20, rows: 3 },
  );
});

test("control-key fallback maps Ctrl letters to terminal control bytes", () => {
  assert.deepEqual(controlKeyEventToBytes({ ctrlKey: true, key: "b" }), [2]);
  assert.deepEqual(controlKeyEventToBytes({ ctrlKey: true, key: "F" }), [6]);
  assert.deepEqual(controlKeyEventToBytes({ ctrlKey: true, key: "x" }), [24]);
  assert.deepEqual(controlKeyEventToBytes({ ctrlKey: true, key: " " }), [0]);
  assert.deepEqual(controlKeyEventToBytes({ ctrlKey: true, key: "[" }), [27]);
});

test("control-key fallback ignores non-terminal control chords", () => {
  assert.equal(controlKeyEventToBytes({ ctrlKey: true, altKey: true, key: "b" }), null);
  assert.equal(controlKeyEventToBytes({ metaKey: true, ctrlKey: true, key: "b" }), null);
  assert.equal(controlKeyEventToBytes({ ctrlKey: true, key: "ArrowLeft" }), null);
  assert.equal(controlKeyEventToBytes({ key: "b" }), null);
});

test("meta-key fallback maps Alt character chords to ESC-prefixed Emacs bytes", () => {
  assert.deepEqual(metaKeyEventToBytes({ altKey: true, key: "x" }), [27, 120]);
  assert.deepEqual(metaKeyEventToBytes({ altKey: true, key: "F" }), [27, 70]);
  assert.equal(metaKeyEventToBytes({ altKey: true, ctrlKey: true, key: "x" }), null);
  assert.equal(metaKeyEventToBytes({ altKey: true, key: "ArrowLeft" }), null);
});

test("terminal key fallback maps common Emacs special keys", () => {
  assert.deepEqual(terminalKeyEventToBytes({ key: "Escape" }), [27]);
  assert.deepEqual(terminalKeyEventToBytes({ key: "Backspace" }), [127]);
  assert.deepEqual(terminalKeyEventToBytes({ key: "Enter" }), [13]);
  assert.deepEqual(terminalKeyEventToBytes({ key: "Tab" }), [9]);
});

test("terminal key fallback maps arrow keys to xterm cursor sequences", () => {
  assert.deepEqual(terminalKeyEventToBytes({ key: "ArrowUp" }), [27, 91, 65]);
  assert.deepEqual(terminalKeyEventToBytes({ key: "ArrowDown" }), [27, 91, 66]);
  assert.deepEqual(terminalKeyEventToBytes({ key: "ArrowRight" }), [27, 91, 67]);
  assert.deepEqual(terminalKeyEventToBytes({ key: "ArrowLeft" }), [27, 91, 68]);
});

test("terminal key fallback leaves modified arrows to xterm or browser", () => {
  assert.equal(terminalKeyEventToBytes({ ctrlKey: true, key: "ArrowLeft" }), null);
  assert.equal(terminalKeyEventToBytes({ altKey: true, key: "ArrowLeft" }), null);
  assert.equal(terminalKeyEventToBytes({ metaKey: true, key: "ArrowLeft" }), null);
});

test("xterm input strips bracketed paste wrappers before Emacs tty injection", () => {
  assert.equal(stripBracketedPasteMarkers("\x1b[200~kkkk\r\x1b[201~"), "kkkk\r");
  assert.deepEqual(xtermDataToBytes("\x1b[200~kkkk\r"), [107, 107, 107, 107, 13]);
});

test("OSC 52 clipboard payload decodes base64 CLIPBOARD selections to text", () => {
  // "abc" base64-encoded, as gui-backend-set-selection would emit for M-w.
  assert.equal(decodeOsc52ClipboardPayload("c;YWJj"), "abc");
});

test("OSC 52 clipboard payload decodes multibyte UTF-8 text", () => {
  // "日本語" UTF-8 base64-encoded.
  assert.equal(decodeOsc52ClipboardPayload("c;5pel5pys6Kqe"), "日本語");
});

test("OSC 52 clipboard payload ignores PRIMARY selections and paste queries", () => {
  assert.equal(decodeOsc52ClipboardPayload("p;YWJj"), null);
  assert.equal(decodeOsc52ClipboardPayload("c;?"), null);
});

test("OSC 52 clipboard payload rejects malformed input", () => {
  assert.equal(decodeOsc52ClipboardPayload("nosep"), null);
  assert.equal(decodeOsc52ClipboardPayload("c;not-base64!!"), null);
  assert.equal(decodeOsc52ClipboardPayload(123), null);
});
