import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const repoRoot = new URL("../..", import.meta.url).pathname;
const extensionRoot = join(repoRoot, "extensions/vscode-wasifs");

test("VS Code wasifs extension registers .wasifs custom editor", async () => {
  const manifest = JSON.parse(await readFile(join(extensionRoot, "package.json"), "utf8"));

  assert.equal(manifest.main, "./src/extension.js");
  assert.equal(manifest.activationEvents, undefined);
  assert.equal(
    manifest.contributes.commands.some((command) => command.command === "wasmacs.sendTerminalKeys"),
    true,
  );
  assert.equal(
    manifest.contributes.keybindings.some(
      (binding) =>
        binding.key === "ctrl+x ctrl+f" &&
        binding.command === "wasmacs.sendTerminalKeys" &&
        binding.when === "activeCustomEditorId == 'wasmacs.wasifsEditor'" &&
        binding.args.bytes.join(",") === "24,6",
    ),
    true,
  );
  assert.equal(
    manifest.contributes.keybindings.some(
      (binding) => binding.key === "alt+x" && binding.args.bytes.join(",") === "27,120",
    ),
    true,
  );
  assert.equal(
    manifest.contributes.keybindings.some(
      (binding) => binding.key === "ctrl+s" && binding.args.bytes.join(",") === "19",
    ),
    true,
  );
  assert.equal(
    manifest.contributes.keybindings.some(
      (binding) => binding.key === "ctrl+c" && binding.args.bytes.join(",") === "3",
    ),
    true,
  );
  assert.equal(
    manifest.contributes.keybindings.some(
      (binding) => binding.key === "ctrl+w" && binding.args.bytes.join(",") === "23",
    ),
    true,
  );
  for (const [key, bytes] of [
    ["a", "97"],
    ["z", "122"],
    ["1", "49"],
    ["space", "32"],
    ["enter", "13"],
    ["backspace", "127"],
    ["/", "47"],
    [".", "46"],
    ["shift+-", "95"],
  ]) {
    assert.equal(
      manifest.contributes.keybindings.some(
        (binding) =>
          binding.key === key &&
          binding.command === "wasmacs.sendTerminalKeys" &&
          binding.when === "activeCustomEditorId == 'wasmacs.wasifsEditor'" &&
          binding.args.bytes.join(",") === bytes,
      ),
      true,
      `${key} should pass through to the active wasmacs terminal`,
    );
  }
  assert.deepEqual(manifest.contributes.customEditors, [
    {
      viewType: "wasmacs.wasifsEditor",
      displayName: "Wasmacs Filesystem Image",
      selector: [{ filenamePattern: "*.wasifs" }],
      priority: "default",
    },
  ]);
});

test("VS Code wasifs extension keeps Dired handoff explicit", async () => {
  const source = await readFile(join(extensionRoot, "src/extension.js"), "utf8");
  const webview = await readFile(join(extensionRoot, "media/wasifs-editor.js"), "utf8");

  assert.match(source, /const USER_MOUNT = "\/home\/user"/);
  assert.match(source, /const INITIAL_ELISP = '\(dired "\/home\/user"\)'/);
  assert.match(source, /vscode\.workspace\.fs\.readFile\(uri\)/);
  assert.match(source, /vscode\.workspace\.fs\.writeFile\(document\.uri, document\.bytes\)/);
  assert.match(webview, /Dired inventory/);
  assert.match(webview, /wasmacs owns Emacs command loop, Dired, and filesystem semantics/);
});

test("VS Code wasifs extension exposes runtime asset handoff URIs", async () => {
  const source = await readFile(join(extensionRoot, "src/extension.js"), "utf8");
  const readme = await readFile(join(extensionRoot, "README.md"), "utf8");
  const webview = await readFile(join(extensionRoot, "media/wasifs-editor.js"), "utf8");

  assert.match(source, /function runtimeAssets/);
  assert.match(source, /https:\/\/cdn\.jsdelivr\.net\/npm\/@xterm\/xterm@5\/lib\/xterm\.js/);
  assert.match(source, /https:\/\/cdn\.jsdelivr\.net\/npm\/@xterm\/addon-fit@0\/lib\/addon-fit\.js/);
  assert.match(source, /https:\/\/cdn\.jsdelivr\.net\/npm\/@xterm\/xterm@5\/css\/xterm\.css/);
  assert.match(source, /connect-src \$\{webview\.cspSource\}/);
  assert.match(source, /script-src 'nonce-\$\{nonce\}' \$\{webview\.cspSource\} https:\/\/cdn\.jsdelivr\.net blob: 'wasm-unsafe-eval'/);
  assert.match(source, /style-src \$\{webview\.cspSource\} https:\/\/cdn\.jsdelivr\.net/);
  assert.match(source, /worker-src blob:/);
  assert.match(source, /WasifsRuntimeBridge/);
  assert.match(source, /wasifs\.bridge-start/);
  assert.match(source, /xterm-emacs-terminal\.js/);
  assert.match(source, /asyncify-minibuffer-worker\.js/);
  assert.match(source, /asyncifyXtermTemacs/);
  assert.match(source, /emacs-atomics-worker\.js/);
  assert.match(source, /system-lisp-emacs-30\.2\.wasifs/);
  assert.match(source, /emacs-browser-asyncify-spike/);
  assert.match(source, /existsSync/);
  assert.match(webview, /runtime assets/);
  assert.match(webview, /runRuntimePreflight/);
  assert.match(webview, /fetchWithTimeout/);
  assert.match(webview, /publishPreflightRoute/);
  assert.match(webview, /SharedArrayBuffer/);
  assert.match(webview, /needs non-Atomics worker route/);
  assert.match(webview, /wasifs\.preflight/);
  assert.match(webview, /VS Code runtime bridge/);
  assert.match(webview, /wasifs\.bridge-start/);
  assert.match(webview, /bridge start/);
  assert.match(webview, /startAsyncifyRuntime/);
  assert.match(webview, /createWebviewWorker\(assets\.asyncifyWorker\)/);
  assert.match(webview, /URL\.createObjectURL\(new Blob/);
  assert.match(webview, /direct worker route blocked/);
  assert.match(webview, /xtermEntrypointSource/);
  assert.match(webview, /fetchTextAsset\(assets\.asyncifyXtermTemacs/);
  assert.match(webview, /xtermLocateFilePayloads/);
  assert.match(webview, /fetchBinaryAsset\(assets\.asyncifyXtermWasm/);
  assert.match(webview, /fetchBinaryAsset\(assets\.asyncifyXtermData/);
  assert.match(webview, /start-xterm-session/);
  assert.match(webview, /terminal-output-bytes/);
  assert.match(webview, /ensureXtermTerminal/);
  assert.match(webview, /import\(currentRuntime\.assets\.xtermTerminalModule\)/);
  assert.match(webview, /createXtermEmacsTerminal/);
  assert.match(webview, /xtermDataToBytes/);
  assert.match(webview, /emacs-input-bytes/);
  assert.match(webview, /terminal-resize/);
  assert.match(webview, /document\.body\.classList\.contains\("xterm-active"\)/);
  assert.match(webview, /wasifs\.inject-terminal-bytes/);
  assert.match(webview, /function sendTerminalBytes/);
  assert.match(readme, /docs\/app\/src\/xterm-emacs-terminal\.js/);
  assert.match(readme, /build\/artifacts\/emacs-browser-asyncify-spike/);
});

test("VS Code extension-host keybindings inject terminal bytes into the active webview", async () => {
  const source = await readFile(join(extensionRoot, "src/extension.js"), "utf8");

  assert.match(source, /registerCommand\("wasmacs\.sendTerminalKeys"/);
  assert.match(source, /sendTerminalKeys\(args\)/);
  assert.match(source, /this\.activePanel\.webview\.postMessage/);
  assert.match(source, /wasifs\.inject-terminal-bytes/);
  assert.match(source, /function normalizeTerminalBytes/);
});

test("Asyncify worker accepts VS Code webview runtime artifact configuration", async () => {
  const worker = await readFile(join(repoRoot, "docs/app/src/asyncify-minibuffer-worker.js"), "utf8");

  assert.match(worker, /type === "configure-runtime"/);
  assert.match(worker, /function configureRuntime/);
  assert.match(worker, /runtime-configured/);
  assert.match(worker, /let XTERM_ARTIFACT_DIR/);
  assert.match(worker, /let XTERM_ENTRYPOINT_URL/);
  assert.match(worker, /let XTERM_ENTRYPOINT_SOURCE/);
  assert.match(worker, /let XTERM_LOCATE_FILES/);
  assert.match(worker, /let XTERM_LOCATE_FILE_PAYLOADS/);
  assert.match(worker, /let XTERM_WASM_BINARY/);
  assert.match(worker, /let XTERM_DATA_PACKAGE/);
  assert.match(worker, /let XTERM_PDMP_PAYLOAD/);
  assert.match(worker, /xtermEntrypointUrl/);
  assert.match(worker, /xtermEntrypointSource/);
  assert.match(worker, /xtermLocateFilePayloads/);
  assert.match(worker, /xtermWasmBinary/);
  assert.match(worker, /xtermDataPackage/);
  assert.match(worker, /xtermPdmpPayload/);
  assert.match(worker, /createLocateFileBlobMap/);
  assert.match(worker, /wasmBinary: XTERM_WASM_BINARY/);
  assert.match(worker, /getPreloadedPackage/);
  assert.match(worker, /fetchXtermPdmpBytes/);
  assert.match(worker, /heapU8Exported: "not-probed"/);
  assert.match(worker, /envExported: "not-probed"/);
  assert.doesNotMatch(worker, /Boolean\(module\.HEAPU8\)/);
  assert.doesNotMatch(worker, /Boolean\(module\.ENV\)/);
  assert.match(worker, /XTERM_LOCATE_FILES\[path\]/);
  assert.match(worker, /importScripts\(xtermEntrypointScriptUrl\(\)\)/);
  assert.match(worker, /type === "terminal-resize"/);
  assert.match(worker, /function updateTerminalSize/);
  assert.match(worker, /__wasmacsTerminalResizeVersion/);
  assert.match(worker, /visible-cursor t/);
  assert.match(worker, /xterm-mouse-mode 1/);
});
