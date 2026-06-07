import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const mainSource = readFileSync(new URL("../../src/wasm/src/main.js", import.meta.url), "utf8");
const atomicsPdumpWorkerSource = readFileSync(
  new URL("../../src/wasm/src/emacs-atomics-pdump-worker.js", import.meta.url),
  "utf8",
);
const atomicsHostLibrarySource = readFileSync(
  new URL("../../tools/scripts/wasmacs-atomics-host-library.js", import.meta.url),
  "utf8",
);

test("browser xterm start button uses the Atomics pdump worker route", () => {
  assert.match(mainSource, /xtermWorker\s*=\s*new Worker\("\/app\/src\/emacs-atomics-pdump-worker\.js"\)/);
  assert.match(mainSource, /emacs-browser-atomics-pdump\/bootstrap-emacs\.pdmp/);
  assert.match(mainSource, /type:\s*"start"/);
  assert.match(mainSource, /type:\s*"terminal-resize"/);
  assert.doesNotMatch(mainSource, /xtermWorker\s*=\s*new Worker\("\/app\/src\/asyncify-minibuffer-worker\.js"\)/);
});

test("Atomics pdump worker accepts xterm input bytes from the browser app", () => {
  assert.match(atomicsPdumpWorkerSource, /msg\?\.type === "emacs-input-bytes"/);
  assert.match(atomicsPdumpWorkerSource, /Atomics\.notify\(signal,\s*0,\s*1\)/);
  assert.match(atomicsHostLibrarySource, /type: "terminal-output-bytes"/);
});
