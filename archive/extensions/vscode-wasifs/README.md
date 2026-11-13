# Wasmacs WASIFS VS Code Extension Spike

This extension treats `*.wasifs` files as portable wasmacs workspace images.

Opening a `.wasifs` file uses the `wasmacs.wasifsEditor` custom editor. The
editor owns only the VS Code document lifecycle and passes the image bytes to a
webview host. The intended runtime contract is:

```text
opened foo.wasifs
  -> mount at /home/user
  -> start emacs-core.wasm with bundled system-lisp.wasifs
  -> run (dired "/home/user")
```

The first checked-in slice is deliberately a host-side scaffold. It previews the
top-level `.wasifs` entries and records the Dired startup handoff. Real xterm.js
and wasm worker wiring should land after the active Terminal/Tty Service route
can start Emacs `--nw` through the browser worker path.

The scaffold passes VS Code webview URIs for the VS Code-specific runtime
assets. These are generated outside the GitHub Pages `docs/` bundle so the VS
Code spike cannot accidentally change or depend on the docs build output:

- `vscode/app/src/xterm-emacs-terminal.js`
- `vscode/app/src/asyncify-minibuffer-worker.js`
- `vscode/app/src/emacs-atomics-worker.js`
- `vscode/app/src/emacs-atomics-pdump-worker.js`
- `build2/artifacts/system-lisp-emacs-30.2.wasifs`
- `build2/artifacts/user-filesystem-empty.wasifs`
- `build2/artifacts/emacs-browser-asyncify-spike`

Build the VS Code runtime lane with:

```sh
npm run vscode:build
```

The VS Code webview preflight separates two questions:

- whether the local runtime assets are fetchable through VS Code webview URIs
- whether the current runtime can use the Atomics/SharedArrayBuffer path

If `SharedArrayBuffer` is unavailable, the custom editor host is still working,
but the next runtime step must use a non-Atomics worker path or move the
blocking runtime outside the webview.

Current VS Code direction: when the webview reports no `SharedArrayBuffer`, the
extension uses a non-Atomics route when
`build2/artifacts/emacs-browser-asyncify-spike` is available. If that artifact
is missing, it selects an `extension-host-bridge` placeholder and reports the
build/package step as the blocker.
