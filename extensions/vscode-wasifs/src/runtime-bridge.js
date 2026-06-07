const RuntimeRoute = Object.freeze({
  WebviewAtomics: "webview-atomics",
  WebviewAsyncify: "webview-asyncify",
  ExtensionHostBridge: "extension-host-bridge",
});

class WasifsRuntimeBridge {
  constructor({ document, postMessage, artifacts = {} }) {
    this.document = document;
    this.postMessage = postMessage;
    this.artifacts = artifacts;
    this.selectedRoute = RuntimeRoute.ExtensionHostBridge;
    this.lastPreflight = null;
  }

  updatePreflight(preflight = {}) {
    this.lastPreflight = preflight;
    this.selectedRoute = selectRuntimeRoute(preflight, this.artifacts);
    this.postMessage({
      type: "wasifs.runtime-route",
      route: this.selectedRoute,
      reason: runtimeRouteReason(preflight, this.selectedRoute),
      artifacts: summarizeArtifacts(this.artifacts),
    });
  }

  bootstrapPayload() {
    return {
      route: this.selectedRoute,
      userImageBytes: this.document.bytes.length,
      note: "VS Code runtime bridge owns process/runtime placement; webview remains terminal and document host.",
    };
  }

  start() {
    const plan = startPlanForRoute({
      route: this.selectedRoute,
      preflight: this.lastPreflight,
      artifacts: this.artifacts,
    });
    this.postMessage({
      type: "wasifs.bridge-status",
      ...plan,
    });
    return plan;
  }
}

function selectRuntimeRoute(preflight = {}, artifacts = {}) {
  if (preflight.sharedArrayBuffer === "available" && preflight.worker === "available") {
    return RuntimeRoute.WebviewAtomics;
  }
  if (preflight.worker === "available" && hasAsyncifyXtermArtifact(artifacts)) {
    return RuntimeRoute.WebviewAsyncify;
  }
  return RuntimeRoute.ExtensionHostBridge;
}

function runtimeRouteReason(preflight = {}, route) {
  if (route === RuntimeRoute.WebviewAtomics) {
    return "SharedArrayBuffer and Worker are available in the webview.";
  }
  if (route === RuntimeRoute.WebviewAsyncify) {
    return "Worker is available and an Asyncify xterm artifact is present; use the non-Atomics webview worker route.";
  }
  if (preflight.worker !== "available") {
    return "Worker is unavailable in the webview; runtime must stay outside the webview.";
  }
  if (preflight.sharedArrayBuffer !== "available") {
    return "SharedArrayBuffer is unavailable in the webview; current Atomics runtime must move to an extension-host bridge or be replaced by a non-Atomics worker route.";
  }
  return "Webview runtime preflight did not satisfy the Atomics route.";
}

function startPlanForRoute({ route, preflight = {}, artifacts = {} }) {
  if (route === RuntimeRoute.WebviewAtomics) {
    return {
      state: "ready-to-attempt",
      route,
      next: "Wire xterm.js to the existing Atomics worker inside the webview.",
      artifacts,
    };
  }

  if (route === RuntimeRoute.WebviewAsyncify) {
    return {
      state: "ready-to-attempt",
      route,
      next: "Wire xterm.js to asyncify-minibuffer-worker.js with start-xterm-session and mount the opened .wasifs image before startup.",
      artifacts: summarizeArtifacts(artifacts),
    };
  }

  return {
    state: "blocked",
    route,
    reason: runtimeRouteReason(preflight, route),
    next: missingAsyncifyNext(artifacts),
    artifacts: summarizeArtifacts(artifacts),
  };
}

function hasAsyncifyXtermArtifact(artifacts = {}) {
  return Boolean(artifacts.asyncifyXterm?.available);
}

function missingAsyncifyNext(artifacts = {}) {
  if (!hasAsyncifyXtermArtifact(artifacts)) {
    return "Build or package build/artifacts/emacs-browser-asyncify-spike, then expose it to the VS Code webview as the non-Atomics xterm runtime.";
  }
  return "Run the current Atomics runtime outside the webview and stream terminal bytes back to the webview.";
}

function summarizeArtifacts(artifacts = {}) {
  return Object.fromEntries(
    Object.entries(artifacts).map(([key, value]) => [
      key,
      typeof value === "object" && value !== null
        ? { available: Boolean(value.available), path: value.path }
        : value,
    ]),
  );
}

module.exports = {
  RuntimeRoute,
  WasifsRuntimeBridge,
  selectRuntimeRoute,
  runtimeRouteReason,
  startPlanForRoute,
  hasAsyncifyXtermArtifact,
};
