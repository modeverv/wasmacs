import test from "node:test";
import assert from "node:assert/strict";
import { calculateFallbackTerminalDimensions } from "../../src/wasm/src/xterm-emacs-terminal.js";

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
