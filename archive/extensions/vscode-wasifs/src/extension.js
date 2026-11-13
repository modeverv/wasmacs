const vscode = require("vscode");
const { existsSync } = require("node:fs");
const { WasifsRuntimeBridge } = require("./runtime-bridge");

const VIEW_TYPE = "wasmacs.wasifsEditor";
const USER_MOUNT = "/home/user";
const INITIAL_ELISP = '(dired "/home/user")';
const XTERM_CSS_CDN = "https://cdn.jsdelivr.net/npm/@xterm/xterm@5/css/xterm.css";
const XTERM_JS_CDN = "https://cdn.jsdelivr.net/npm/@xterm/xterm@5/lib/xterm.js";
const XTERM_FIT_JS_CDN = "https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0/lib/addon-fit.js";

function activate(context) {
  const provider = new WasifsEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
    vscode.commands.registerCommand("wasmacs.openFilesystemImage", async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          "Wasmacs filesystem images": ["wasifs"],
        },
      });
      if (!picked || picked.length === 0) return;
      await vscode.commands.executeCommand("vscode.openWith", picked[0], VIEW_TYPE);
    }),
    vscode.commands.registerCommand("wasmacs.sendTerminalKeys", async (args = {}) => {
      provider.sendTerminalKeys(args);
    }),
  );
}

function deactivate() {}

class WasifsDocument {
  constructor(uri, bytes) {
    this.uri = uri;
    this.bytes = bytes;
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
  }
}

class WasifsEditorProvider {
  constructor(context) {
    this.context = context;
    this.activePanel = null;
    this.onDidChangeCustomDocumentEmitter = new vscode.EventEmitter();
    this.onDidChangeCustomDocument = this.onDidChangeCustomDocumentEmitter.event;
  }

  async openCustomDocument(uri) {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new WasifsDocument(uri, bytes);
  }

  async resolveCustomEditor(document, webviewPanel) {
    this.activePanel = webviewPanel;
    webviewPanel.onDidChangeViewState((event) => {
      if (event.webviewPanel.active) this.activePanel = event.webviewPanel;
    });
    webviewPanel.onDidDispose(() => {
      if (this.activePanel === webviewPanel) this.activePanel = null;
    });

    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const repoRoot = vscode.Uri.joinPath(this.context.extensionUri, "..", "..");
    const appRoot = vscode.Uri.joinPath(repoRoot, "vscode", "app");
    const artifactRoot = vscode.Uri.joinPath(repoRoot, "build2", "artifacts");
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot, appRoot, artifactRoot],
    };

    webviewPanel.webview.html = this.renderWebview(webviewPanel.webview, document);
    const runtimeBridge = new WasifsRuntimeBridge({
      document,
      postMessage: (message) => webviewPanel.webview.postMessage(message),
      artifacts: runtimeArtifactStatus(appRoot, artifactRoot),
    });

    const sendBootstrap = () => {
      webviewPanel.webview.postMessage({
        type: "wasifs.bootstrap",
        filename: document.uri.fsPath.split(/[\\/]/).pop(),
        bytes: document.bytes,
        runtime: {
          userMount: USER_MOUNT,
          initialElisp: INITIAL_ELISP,
          initialView: "dired",
          assets: runtimeAssets(webviewPanel.webview, appRoot, artifactRoot),
          bridge: runtimeBridge.bootstrapPayload(),
        },
      });
    };

    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "wasifs.ready") {
        sendBootstrap();
        return;
      }

      if (message?.type === "wasifs.preflight") {
        runtimeBridge.updatePreflight(message.preflight);
        return;
      }

      if (message?.type === "wasifs.bridge-start") {
        runtimeBridge.start();
        return;
      }

      if (message?.type === "wasifs.changed") {
        const nextBytes = new Uint8Array(message.bytes ?? []);
        this.onDidChangeCustomDocumentEmitter.fire({
          document,
          undo: async () => {},
          redo: async () => {},
          label: "Update WASIFS image",
        });
        document.bytes = nextBytes;
        return;
      }

      if (message?.type === "wasifs.save") {
        const nextBytes = new Uint8Array(message.bytes ?? document.bytes);
        document.bytes = nextBytes;
        await this.saveCustomDocument(document);
        return;
      }
    });
  }

  sendTerminalKeys(args = {}) {
    const bytes = normalizeTerminalBytes(args.bytes);
    if (bytes.length === 0 || !this.activePanel) return;
    this.activePanel.webview.postMessage({
      type: "wasifs.inject-terminal-bytes",
      bytes,
      label: typeof args.label === "string" ? args.label : "keybinding",
    });
  }

  async saveCustomDocument(document) {
    await vscode.workspace.fs.writeFile(document.uri, document.bytes);
  }

  async saveCustomDocumentAs(document, destination) {
    await vscode.workspace.fs.writeFile(destination, document.bytes);
  }

  async revertCustomDocument(document) {
    document.bytes = await vscode.workspace.fs.readFile(document.uri);
  }

  async backupCustomDocument(document, context) {
    await vscode.workspace.fs.writeFile(context.destination, document.bytes);
    return {
      id: context.destination.toString(),
      delete: async () => {
        await vscode.workspace.fs.delete(context.destination, { useTrash: false });
      },
    };
  }

  renderWebview(webview, document) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "wasifs-editor.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "wasifs-editor.css"),
    );
    const nonce = nonceValue();
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} https://cdn.jsdelivr.net`,
      `script-src 'nonce-${nonce}' ${webview.cspSource} https://cdn.jsdelivr.net blob: 'wasm-unsafe-eval'`,
      "worker-src blob:",
      "child-src blob:",
      `font-src ${webview.cspSource}`,
      `connect-src ${webview.cspSource}`,
    ].join("; ");

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${XTERM_CSS_CDN}">
  <link rel="stylesheet" href="${styleUri}">
  <title>${escapeHtml(document.uri.fsPath.split(/[\\/]/).pop())}</title>
</head>
<body>
  <main id="root" class="wasifs-shell" data-state="loading">
    <section class="terminal-frame" aria-label="Wasmacs filesystem image">
      <div class="terminal-title">
        <span id="filename">filesystem.wasifs</span>
        <button id="start-bridge" type="button">Start Bridge</button>
        <span id="state">loading</span>
      </div>
      <pre id="screen" tabindex="0"></pre>
      <div id="xterm-container" aria-label="Emacs terminal"></div>
    </section>
  </main>
  <script nonce="${nonce}" src="${XTERM_JS_CDN}"></script>
  <script nonce="${nonce}" src="${XTERM_FIT_JS_CDN}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function runtimeAssets(webview, appRoot, artifactRoot) {
  const asyncifyXterm = vscode.Uri.joinPath(artifactRoot, "emacs-browser-asyncify-spike");
  return {
    appRoot: webview.asWebviewUri(appRoot).toString(),
    xtermTerminalModule: webview
      .asWebviewUri(vscode.Uri.joinPath(appRoot, "src", "xterm-emacs-terminal.js"))
      .toString(),
    asyncifyWorker: webview
      .asWebviewUri(vscode.Uri.joinPath(appRoot, "src", "asyncify-minibuffer-worker.js"))
      .toString(),
    asyncifyXtermTemacs: webview
      .asWebviewUri(vscode.Uri.joinPath(asyncifyXterm, "temacs"))
      .toString(),
    asyncifyXtermWasm: webview
      .asWebviewUri(vscode.Uri.joinPath(asyncifyXterm, "temacs.wasm"))
      .toString(),
    asyncifyXtermData: webview
      .asWebviewUri(vscode.Uri.joinPath(asyncifyXterm, "temacs.data"))
      .toString(),
    atomicsWorker: webview
      .asWebviewUri(vscode.Uri.joinPath(appRoot, "src", "emacs-atomics-worker.js"))
      .toString(),
    pdumpWorker: webview
      .asWebviewUri(vscode.Uri.joinPath(appRoot, "src", "emacs-atomics-pdump-worker.js"))
      .toString(),
    emptyUserImage: webview
      .asWebviewUri(vscode.Uri.joinPath(artifactRoot, "user-filesystem-empty.wasifs"))
      .toString(),
    systemLispImage: webview
      .asWebviewUri(vscode.Uri.joinPath(artifactRoot, "system-lisp-emacs-30.2.wasifs"))
      .toString(),
    atomicsPdumpArtifactRoot: webview
      .asWebviewUri(vscode.Uri.joinPath(artifactRoot, "emacs-browser-atomics-pdump"))
      .toString(),
  };
}

function runtimeArtifactStatus(appRoot, artifactRoot) {
  const asyncifyXterm = vscode.Uri.joinPath(artifactRoot, "emacs-browser-asyncify-spike");
  const atomicsPdumpArtifactRoot = vscode.Uri.joinPath(artifactRoot, "emacs-browser-atomics-pdump");
  return {
    xtermTerminalModule: artifactRecord(vscode.Uri.joinPath(appRoot, "src", "xterm-emacs-terminal.js")),
    asyncifyWorker: artifactRecord(vscode.Uri.joinPath(appRoot, "src", "asyncify-minibuffer-worker.js")),
    asyncifyXterm: artifactRecord(asyncifyXterm),
    atomicsWorker: artifactRecord(vscode.Uri.joinPath(appRoot, "src", "emacs-atomics-worker.js")),
    pdumpWorker: artifactRecord(vscode.Uri.joinPath(appRoot, "src", "emacs-atomics-pdump-worker.js")),
    emptyUserImage: artifactRecord(vscode.Uri.joinPath(artifactRoot, "user-filesystem-empty.wasifs")),
    systemLispImage: artifactRecord(vscode.Uri.joinPath(artifactRoot, "system-lisp-emacs-30.2.wasifs")),
    atomicsPdumpArtifactRoot: artifactRecord(atomicsPdumpArtifactRoot),
  };
}

function artifactRecord(uri) {
  return {
    path: uri.fsPath,
    available: existsSync(uri.fsPath),
  };
}

function nonceValue() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

module.exports = {
  activate,
  deactivate,
  WasifsEditorProvider,
  VIEW_TYPE,
  USER_MOUNT,
  INITIAL_ELISP,
  normalizeTerminalBytes,
};

function normalizeTerminalBytes(bytes) {
  if (!Array.isArray(bytes)) return [];
  return bytes
    .map((byte) => Number(byte))
    .filter((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);
}
