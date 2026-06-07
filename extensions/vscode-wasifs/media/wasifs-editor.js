const vscode = acquireVsCodeApi();
const screen = document.getElementById("screen");
const xtermContainer = document.getElementById("xterm-container");
const filename = document.getElementById("filename");
const state = document.getElementById("state");
const startBridge = document.getElementById("start-bridge");

const blockSize = 512;
const decoder = new TextDecoder();
let currentBytes = new Uint8Array();
let currentRuntime = null;
let currentRoute = null;
let currentPreflight = {};
let currentBridgeStatus = null;
let runtimeWorker = null;
let terminal = null;
let terminalModule = null;
let terminalText = "";
const runtimeBlobUrls = [];

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.type === "wasifs.runtime-route") {
    currentRoute = message;
    rerender();
    return;
  }
  if (message?.type === "wasifs.bridge-status") {
    currentBridgeStatus = message;
    state.textContent = message.state;
    if (message.state === "ready-to-attempt" && message.route === "webview-asyncify") {
      startAsyncifyRuntime();
    }
    rerender();
    return;
  }
  if (message?.type === "wasifs.inject-terminal-bytes") {
    sendTerminalBytes(message.bytes ?? [], message.label ?? "keybinding");
    return;
  }
  if (message?.type !== "wasifs.bootstrap") return;

  currentBytes = new Uint8Array(message.bytes ?? []);
  currentRuntime = message.runtime ?? {};
  filename.textContent = message.filename ?? "filesystem.wasifs";
  state.textContent = "host ready";

  const entries = parseUserWasifs(currentBytes);
  currentPreflight = createPendingPreflight(currentRuntime);
  rerender();

  vscode.setState({
    filename: filename.textContent,
    byteLength: currentBytes.byteLength,
    entryCount: entries.length,
    userMount: message.runtime?.userMount,
  });

  publishPreflightRoute();
  runRuntimePreflight(currentRuntime);
});

startBridge?.addEventListener("click", () => {
  state.textContent = "starting bridge";
  vscode.postMessage({ type: "wasifs.bridge-start" });
});

window.addEventListener("keydown", (event) => {
  if (document.body.classList.contains("xterm-active")) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    vscode.postMessage({
      type: "wasifs.save",
      bytes: currentBytes,
    });
  }
});

vscode.postMessage({ type: "wasifs.ready" });

function rerender() {
  const entries = parseUserWasifs(currentBytes);
  screen.textContent = renderDiredBootstrap({
    entries,
    runtime: currentRuntime,
    preflight: currentPreflight,
    route: currentRoute,
    bridgeStatus: currentBridgeStatus,
  });
}

function renderDiredBootstrap({ entries, runtime, preflight, route, bridgeStatus }) {
  const mount = runtime?.userMount ?? "/home/user";
  const initialElisp = runtime?.initialElisp ?? `(dired "${mount}")`;
  const summary = summarizeEntries(entries, mount);
  const lines = [
    "wasmacs .wasifs editor",
    "",
    `mount: ${mount}`,
    `initial elisp: ${initialElisp}`,
    `image bytes: ${currentBytes.byteLength}`,
    `entries: ${summary.files} files, ${summary.directories} directories`,
    "",
    "Dired inventory:",
    ...renderTree(entries, mount),
  ];

  if (runtime?.assets) {
    lines.push(
      "",
      "runtime assets:",
      `  ${preflightLine(preflight, "xtermTerminalModule")} xterm module: ${basename(runtime.assets.xtermTerminalModule)}`,
      `  ${preflightLine(preflight, "asyncifyWorker")} asyncify worker: ${basename(runtime.assets.asyncifyWorker)}`,
      `  ${preflightLine(preflight, "asyncifyXtermTemacs")} asyncify temacs: ${basename(runtime.assets.asyncifyXtermTemacs)}`,
      `  ${preflightLine(preflight, "asyncifyXtermWasm")} asyncify wasm: ${basename(runtime.assets.asyncifyXtermWasm)}`,
      `  ${preflightLine(preflight, "asyncifyXtermData")} asyncify data: ${basename(runtime.assets.asyncifyXtermData)}`,
      `  ${preflightLine(preflight, "atomicsWorker")} atomics worker: ${basename(runtime.assets.atomicsWorker)}`,
      `  ${preflightLine(preflight, "pdumpWorker")} pdump worker: ${basename(runtime.assets.pdumpWorker)}`,
      `  ${preflightLine(preflight, "systemLispImage")} system image: ${basename(runtime.assets.systemLispImage)}`,
      `  ${preflightLine(preflight, "emptyUserImage")} empty user image: ${basename(runtime.assets.emptyUserImage)}`,
      "",
      "webview runtime preflight:",
      `  SharedArrayBuffer: ${typeof SharedArrayBuffer === "undefined" ? "unavailable" : "available"}`,
      `  Worker: ${typeof Worker === "undefined" ? "unavailable" : "available"}`,
      `  next runtime route: ${runtimeRouteStatus()}`,
    );
  }

  if (route) {
    lines.push(
      "",
      "VS Code runtime bridge:",
      `  selected route: ${route.route}`,
      `  reason: ${route.reason}`,
      ...renderRouteArtifacts(route.artifacts),
    );
  }

  if (bridgeStatus) {
    lines.push(
      "",
      "bridge start:",
      `  state: ${bridgeStatus.state}`,
      `  route: ${bridgeStatus.route}`,
      `  next: ${bridgeStatus.next}`,
      ...renderRouteArtifacts(bridgeStatus.artifacts),
    );
  }

  lines.push(
    "",
    "runtime handoff:",
    "  VS Code owns the opened .wasifs document and Save operation.",
    "  wasmacs owns Emacs command loop, Dired, and filesystem semantics.",
  );

  if (terminalText) {
    lines.push("", "terminal output:", terminalText.slice(-5000));
  }

  return lines.join("\n");
}

async function startAsyncifyRuntime() {
  if (runtimeWorker) return;
  const assets = currentRuntime?.assets ?? {};
  if (!assets.asyncifyWorker || !assets.asyncifyXtermTemacs) {
    appendTerminalLine("[wasmacs] asyncify runtime assets missing");
    return;
  }

  await ensureXtermTerminal();

  try {
    runtimeWorker = await createWebviewWorker(assets.asyncifyWorker);
  } catch (error) {
    appendTerminalLine(`[wasmacs] worker create failed: ${error?.message ?? error}`);
    return;
  }

  runtimeWorker.onmessage = (event) => handleRuntimeWorkerMessage(event.data);
  runtimeWorker.onerror = (event) => {
    appendTerminalLine(`[wasmacs] worker error: ${event.message}`);
    state.textContent = "worker error";
  };

  const xtermArtifactDir = dirnameUri(assets.asyncifyXtermTemacs);
  const xtermEntrypointSource = await fetchTextAsset(assets.asyncifyXtermTemacs, "xterm entrypoint");
  const xtermWasmBytes = await fetchBinaryAsset(assets.asyncifyXtermWasm, "xterm wasm");
  const xtermDataBytes = await fetchBinaryAsset(assets.asyncifyXtermData, "xterm data");
  const xtermLocateFilePayloads = {
    "temacs.wasm": { bytes: xtermWasmBytes, type: "application/wasm" },
    "temacs.data": { bytes: xtermDataBytes, type: "application/octet-stream" },
  };
  runtimeWorker.postMessage({
    type: "configure-runtime",
    xtermArtifactDir,
    xtermEntrypointSource,
    xtermLocateFilePayloads,
  }, [xtermWasmBytes, xtermDataBytes]);
  runtimeWorker.postMessage({ type: "start-xterm-session" });
  state.textContent = "asyncify starting";
  appendTerminalLine(`[wasmacs] starting asyncify worker from ${basename(assets.asyncifyWorker)}`);
}

async function createWebviewWorker(uri) {
  try {
    return new Worker(uri);
  } catch (directError) {
    appendTerminalLine(`[wasmacs] direct worker route blocked: ${directError?.message ?? directError}`);
  }

  const blobUrl = await createBlobScriptUrl(uri, "worker source");
  try {
    const worker = new Worker(blobUrl);
    worker.addEventListener(
      "error",
      () => {
        URL.revokeObjectURL(blobUrl);
      },
      { once: true },
    );
    return worker;
  } catch (blobError) {
    URL.revokeObjectURL(blobUrl);
    throw blobError;
  }
}

async function createBlobScriptUrl(uri, label) {
  const response = await fetchWithTimeout(uri, 2500);
  if (!response.ok) {
    throw new Error(`${label} fetch failed: http ${response.status}`);
  }

  const source = await response.text();
  const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  runtimeBlobUrls.push(blobUrl);
  return blobUrl;
}

async function createBlobResourceUrl(uri, type, label) {
  const bytes = await fetchBinaryAsset(uri, label);
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type }));
  runtimeBlobUrls.push(blobUrl);
  return blobUrl;
}

async function fetchTextAsset(uri, label) {
  const response = await fetchWithTimeout(uri, 5000);
  if (!response.ok) {
    throw new Error(`${label} fetch failed: http ${response.status}`);
  }

  return response.text();
}

async function fetchBinaryAsset(uri, label) {
  const response = await fetchWithTimeout(uri, 5000);
  if (!response.ok) {
    throw new Error(`${label} fetch failed: http ${response.status}`);
  }

  return response.arrayBuffer();
}

function handleRuntimeWorkerMessage(message) {
  if (!message?.type) return;
  if (message.type === "terminal-output-bytes") {
    writeTerminalBytes(message.bytes ?? []);
    return;
  }
  if (message.type === "terminal-output") {
    writeTerminalBytes(message.bytes ?? []);
    return;
  }
  if (message.type === "runtime-configured") {
    appendTerminalLine(`[wasmacs] runtime configured: ${message.xtermArtifactDir}`);
    return;
  }
  if (message.type === "status") {
    appendTerminalLine(`[status] ${message.text}`);
    return;
  }
  if (message.type === "xterm-session-started") {
    state.textContent = "xterm session starting";
    appendTerminalLine(`[wasmacs] xterm session started: ${message.artifact}`);
    return;
  }
  if (message.type === "xterm-session-at-wait") {
    state.textContent = "interactive wait";
    appendTerminalLine(`[wasmacs] interactive wait reached (${message.terminalBytes ?? 0} bytes)`);
    return;
  }
  if (message.type === "xterm-session-returned") {
    state.textContent = "session returned";
    appendTerminalLine(`[wasmacs] session returned: ${message.error ?? message.status ?? "unknown"}`);
    return;
  }
  if (message.type === "stderr") {
    appendTerminalLine(`[stderr] ${message.text}`);
    return;
  }
  if (message.type === "stdout") {
    appendTerminalLine(`[stdout] ${message.text}`);
  }
}

async function ensureXtermTerminal() {
  if (terminal || !xtermContainer) return terminal;
  if (!currentRuntime?.assets?.xtermTerminalModule) {
    appendTerminalLine("[wasmacs] xterm integration module missing");
    return null;
  }

  try {
    terminalModule = await import(currentRuntime.assets.xtermTerminalModule);
    terminal = terminalModule.createXtermEmacsTerminal(xtermContainer, {
      fontSize: 14,
      initialDimensions: { cols: 80, rows: 24 },
      onResize(dimensions) {
        runtimeWorker?.postMessage({ type: "terminal-resize", ...dimensions });
      },
    });
    terminal.onData((data) => {
      if (!runtimeWorker) return;
      runtimeWorker.postMessage({
        type: "emacs-input-bytes",
        bytes: terminalModule.xtermDataToBytes(data),
      });
    });
    document.body.classList.add("xterm-active");
    terminal.fit();
    terminal.focus?.();
  } catch (error) {
    appendTerminalLine(`[wasmacs] xterm init failed: ${error?.message ?? error}`);
    terminal = null;
  }

  return terminal;
}

function sendTerminalBytes(bytes, label = "input") {
  const normalized = Array.from(bytes, (byte) => Number(byte)).filter(
    (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
  );
  if (normalized.length === 0) return;
  if (!runtimeWorker) {
    appendTerminalLine(`[wasmacs] dropped ${label}: runtime is not ready`);
    return;
  }
  runtimeWorker.postMessage({ type: "emacs-input-bytes", bytes: normalized });
  terminal?.focus?.();
}

function writeTerminalBytes(bytes) {
  if (terminal) {
    terminal.writeBytes(bytes);
    return;
  }
  appendTerminalBytes(bytes);
}

function appendTerminalBytes(bytes) {
  terminalText += decoder.decode(new Uint8Array(bytes));
  rerender();
}

function appendTerminalLine(text) {
  terminalText += `${text}\n`;
  rerender();
}

function createPendingPreflight(runtime) {
  const assets = runtime?.assets ?? {};
  const pending = {};
  for (const key of Object.keys(assets)) pending[key] = "pending";
  return pending;
}

async function runRuntimePreflight(runtime) {
  const assets = runtime?.assets ?? {};
  const probes = [
    ["xtermTerminalModule", assets.xtermTerminalModule],
    ["asyncifyWorker", assets.asyncifyWorker],
    ["asyncifyXtermTemacs", assets.asyncifyXtermTemacs],
    ["asyncifyXtermWasm", assets.asyncifyXtermWasm],
    ["asyncifyXtermData", assets.asyncifyXtermData],
    ["atomicsWorker", assets.atomicsWorker],
    ["pdumpWorker", assets.pdumpWorker],
    ["systemLispImage", assets.systemLispImage],
    ["emptyUserImage", assets.emptyUserImage],
  ];
  for (const [key, uri] of probes) {
    if (!uri) {
      currentPreflight[key] = "missing";
      rerender();
      continue;
    }
    probeRuntimeAsset(key, uri);
  }
}

async function probeRuntimeAsset(key, uri) {
  currentPreflight[key] = "checking";
  rerender();
  try {
    const response = await fetchWithTimeout(uri, 2500);
    currentPreflight[key] = response.ok ? "ok" : `http ${response.status}`;
    await response.body?.cancel?.();
  } catch (error) {
    currentPreflight[key] = error?.message ? `error: ${error.message}` : "error";
  }
  rerender();
}

async function fetchWithTimeout(uri, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetch(uri, {
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function publishPreflightRoute() {
  vscode.postMessage({
    type: "wasifs.preflight",
    preflight: {
      sharedArrayBuffer: typeof SharedArrayBuffer === "undefined" ? "unavailable" : "available",
      worker: typeof Worker === "undefined" ? "unavailable" : "available",
    },
  });
}

function preflightLine(preflight, key) {
  const status = preflight?.[key] ?? "pending";
  const marker = preflightMarker(status);
  return `${marker} ${status}`;
}

function preflightMarker(status) {
  if (status === "ok") return "[ok]";
  if (status === "pending" || status === "checking") return "[..]";
  return "[!!]";
}

function runtimeRouteStatus() {
  if (typeof Worker === "undefined") return "blocked: Worker unavailable";
  if (typeof SharedArrayBuffer === "undefined") {
    return "needs non-Atomics worker route; VS Code webview cannot use current Atomics runtime";
  }
  return "Atomics worker route can be attempted";
}

function renderRouteArtifacts(artifacts) {
  if (!artifacts) return [];
  const interesting = ["asyncifyWorker", "asyncifyXterm", "atomicsPdumpArtifactRoot"];
  const lines = [];
  for (const key of interesting) {
    const artifact = artifacts[key];
    if (!artifact || typeof artifact !== "object") continue;
    lines.push(`  artifact ${key}: ${artifact.available ? "available" : "missing"}`);
  }
  return lines;
}

function summarizeEntries(entries, mount) {
  let files = 0;
  let directories = 0;
  for (const entry of entries) {
    if (entry.path !== mount && entry.kind === "file") files += 1;
    if (entry.path !== mount && entry.kind === "directory") directories += 1;
  }
  return { files, directories };
}

function renderTree(entries, mount) {
  const visible = entries.filter((entry) => entry.path === mount || entry.path.startsWith(`${mount}/`));
  const lines = [`  ${mount}/`];

  for (const entry of visible) {
    if (entry.path === mount) continue;
    const relative = entry.path.slice(`${mount}/`.length);
    if (!relative) continue;
    const depth = relative.split("/").length - 1;
    const indent = "  " + "  ".repeat(depth + 1);
    const marker = entry.kind === "directory" ? "d" : "-";
    const size = entry.kind === "file" ? String(entry.size).padStart(8, " ") : "       0";
    const name = relative.split("/").at(-1);
    lines.push(`${indent}${marker} ${size} ${name}${entry.kind === "directory" ? "/" : ""}`);
  }

  if (lines.length === 1) {
    lines.push("    d        0 .local/");
  }

  return lines;
}

function basename(uri) {
  if (typeof uri !== "string") return "-";
  const clean = uri.split("?")[0].replace(/\/+$/, "");
  return clean.split("/").pop() || clean;
}

function dirnameUri(uri) {
  const clean = String(uri).split("?")[0].replace(/\/+$/, "");
  return clean.slice(0, clean.lastIndexOf("/"));
}

function parseUserWasifs(bytes) {
  const entries = new Map();
  entries.set("/home/user", { path: "/home/user", kind: "directory", size: 0 });

  let offset = 0;
  while (offset + blockSize <= bytes.length) {
    const header = bytes.subarray(offset, offset + blockSize);
    if (header.every((byte) => byte === 0)) break;

    const name = trimNulls(header.subarray(0, 100));
    const prefix = trimNulls(header.subarray(345, 500));
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const path = entryToMountPath(entryPath);
    const size = parseOctal(header.subarray(124, 136));
    const typeflag = String.fromCharCode(header[156] || 48);
    const dataStart = offset + blockSize;

    if (path) {
      const directory = typeflag === "5" || entryPath.endsWith("/");
      entries.set(path, {
        path,
        kind: directory ? "directory" : "file",
        size: directory ? 0 : size,
      });
    }

    offset = dataStart + padLength(size);
  }

  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function entryToMountPath(entryPath) {
  const clean = entryPath.replace(/\/$/, "");
  if (clean === "home/user") return "/home/user";
  if (clean.startsWith("home/user/")) return `/${clean}`;
  return null;
}

function trimNulls(bytes) {
  const zero = bytes.indexOf(0);
  const slice = bytes.subarray(0, zero === -1 ? bytes.length : zero);
  return decoder.decode(slice).trim();
}

function parseOctal(bytes) {
  const text = trimNulls(bytes);
  return text.length === 0 ? 0 : Number.parseInt(text, 8);
}

function padLength(length) {
  return Math.ceil(length / blockSize) * blockSize;
}
