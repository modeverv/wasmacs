import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const appPageSource = readFileSync(new URL("../../src/wasm/xterm-atomics-pdump.html", import.meta.url), "utf8");
const atomicsPdumpWorkerSource = readFileSync(
  new URL("../../src/wasm/src/emacs-atomics-pdump-worker.js", import.meta.url),
  "utf8",
);
const atomicsHostLibrarySource = readFileSync(
  new URL("../../tools/scripts/wasmacs-atomics-host-library.js", import.meta.url),
  "utf8",
);

test("canonical app page starts Emacs through the Atomics pdump worker route", () => {
  assert.match(appPageSource, /emacsWorker\s*=\s*new Worker\("\.\/src\/emacs-atomics-pdump-worker\.js\?v=" \+ Date\.now\(\)\)/);
  assert.match(appPageSource, /emacs-browser-atomics-pdump\/bootstrap-emacs\.pdmp/);
  assert.match(appPageSource, /type:\s*"start"/);
  assert.match(appPageSource, /type:\s*"terminal-resize"/);
  assert.doesNotMatch(appPageSource, /asyncify-minibuffer-worker\.js/);
});

test("Atomics pdump worker accepts xterm input bytes from the browser app", () => {
  assert.match(atomicsPdumpWorkerSource, /msg\?\.type === "emacs-input-bytes"/);
  assert.match(atomicsPdumpWorkerSource, /Atomics\.notify\(signal,\s*0,\s*1\)/);
  assert.match(atomicsHostLibrarySource, /type: "terminal-output-bytes"/);
});
