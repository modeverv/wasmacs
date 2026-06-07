import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  RuntimeRoute,
  hasAsyncifyXtermArtifact,
  selectRuntimeRoute,
  runtimeRouteReason,
  startPlanForRoute,
} = require("../../extensions/vscode-wasifs/src/runtime-bridge.js");

test("VS Code runtime bridge selects webview Atomics only when SAB and Worker are available", () => {
  assert.equal(
    selectRuntimeRoute({ sharedArrayBuffer: "available", worker: "available" }),
    RuntimeRoute.WebviewAtomics,
  );
  assert.equal(
    selectRuntimeRoute({ sharedArrayBuffer: "unavailable", worker: "available" }),
    RuntimeRoute.ExtensionHostBridge,
  );
});

test("VS Code runtime bridge selects Asyncify webview route when SAB is unavailable but Asyncify artifact exists", () => {
  const artifacts = { asyncifyXterm: { available: true, path: "/tmp/asyncify" } };

  assert.equal(hasAsyncifyXtermArtifact(artifacts), true);
  assert.equal(
    selectRuntimeRoute({ sharedArrayBuffer: "unavailable", worker: "available" }, artifacts),
    RuntimeRoute.WebviewAsyncify,
  );
});

test("VS Code runtime bridge explains the SharedArrayBuffer blocker", () => {
  assert.match(
    runtimeRouteReason(
      { sharedArrayBuffer: "unavailable", worker: "available" },
      RuntimeRoute.ExtensionHostBridge,
    ),
    /SharedArrayBuffer is unavailable/,
  );
});

test("VS Code runtime bridge start plan blocks the extension-host route until a runtime is attached", () => {
  const plan = startPlanForRoute({
    route: RuntimeRoute.ExtensionHostBridge,
    preflight: { sharedArrayBuffer: "unavailable", worker: "available" },
  });

  assert.equal(plan.state, "blocked");
  assert.match(plan.next, /emacs-browser-asyncify-spike/);
});
