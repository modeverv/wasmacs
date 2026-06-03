// Browser runtime worker — two-file layered architecture:
//
//  bootstrap-emacs.pdmp  (OPFS) → Emacs 初期化済み状態
//  user-home.wasifs      (OPFS) → /home/user/* だけ、ポータブル tar 形式
//
// 起動シーケンス:
//   1. OPFS から pdmp を読む（なければ pbootstrap で生成）
//   2. OPFS から user-home.wasifs を読む（なければ空を生成）
//   3. pdmp と wasifs を MEMFS に展開（ブート時に一度だけ）
//   4. callMain(["--dump-file=..."]) → 高速起動
//   5. コマンド完了後: /home/user/ MEMFS を wasifs に serialize → OPFS 保存
//
// 再マテリアライズは行わない。MEMFS が /home/user/ の唯一の真実。
// visited buffer の外部変更検出エラーが起きない。

const ARTIFACT_DIR = "/artifacts/emacs-browser-runtime";
const OPFS_PDMP      = "wasmacs-bootstrap.pdmp";
const OPFS_USERHOME  = "wasmacs-user-home.wasifs";

// ---- OPFS helpers ----

async function opfsLoad(filename) {
  try {
    const root = await navigator.storage.getDirectory();
    const fh   = await root.getFileHandle(filename);
    const file = await fh.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch { return null; }
}

async function opfsSave(filename, bytes) {
  const root = await navigator.storage.getDirectory();
  const fh   = await root.getFileHandle(filename, { create: true });
  const w    = await fh.createWritable();
  await w.write(bytes);
  await w.close();
}

// ---- wasifs (tar) ---- inlined from browser-wasifs.js ----

const _blockSize   = 512;
const _textDec     = new TextDecoder();
const _textEnc     = new TextEncoder();

function _trimNulls(bytes) {
  const z = bytes.indexOf(0);
  return _textDec.decode(bytes.subarray(0, z === -1 ? bytes.length : z)).trim();
}
function _parseOctal(bytes) {
  const t = _trimNulls(bytes).trim();
  return t.length === 0 ? 0 : parseInt(t, 8);
}
function _padLen(n) { return Math.ceil(n / _blockSize) * _blockSize; }
function _writeAscii(buf, off, len, val) {
  buf.fill(0, off, off + len);
  buf.set(_textEnc.encode(val.slice(0, len)).subarray(0, len), off);
}
function _writeOctal(buf, off, len, val) {
  _writeAscii(buf, off, len, val.toString(8).padStart(len - 1, "0").slice(-(len - 1)));
}
function _tarPath(p) { return p.replace(/^\/+/, "").replace(/\/+/g, "/"); }
function _mountPath(entryPath) {
  const c = entryPath.replace(/\/$/, "");
  if (c === "home/user")           return "/home/user";
  if (c.startsWith("home/user/"))  return `/${c}`;
  return null;
}

function _parseWasifs(bytes) {
  const nodes = new Map();
  nodes.set("/home/user", { kind: "directory" });
  let off = 0;
  while (off + _blockSize <= bytes.length) {
    const hdr = bytes.subarray(off, off + _blockSize);
    if (hdr.every((b) => b === 0)) break;
    const name   = _trimNulls(hdr.subarray(0, 100));
    const prefix = _trimNulls(hdr.subarray(345, 500));
    const entry  = prefix ? `${prefix}/${name}` : name;
    const path   = _mountPath(entry);
    const size   = _parseOctal(hdr.subarray(124, 136));
    const flag   = String.fromCharCode(hdr[156] || 48);
    const dStart = off + _blockSize;
    if (path) {
      const isDir = flag === "5" || entry.endsWith("/");
      nodes.set(path, {
        kind:  isDir ? "directory" : "file",
        bytes: isDir ? undefined : bytes.slice(dStart, dStart + size),
      });
    }
    off = dStart + _padLen(size);
  }
  return nodes;
}

function _createWasifs(nodes) {
  const chunks = [];
  const paths  = [...nodes.keys()]
    .filter((p) => p === "/home/user" || p.startsWith("/home/user/"))
    .sort();
  for (const path of paths) {
    const node    = nodes.get(path);
    const isDir   = node.kind === "directory";
    const name    = isDir ? `${_tarPath(path)}/` : _tarPath(path);
    const content = isDir ? new Uint8Array() : (node.bytes ?? new Uint8Array());
    const hdr     = new Uint8Array(_blockSize);
    _writeAscii(hdr,   0, 100, name);
    _writeOctal(hdr, 100,   8, isDir ? 0o755 : 0o644);
    _writeOctal(hdr, 108,   8, 0);
    _writeOctal(hdr, 116,   8, 0);
    _writeOctal(hdr, 124,  12, content.length);
    _writeOctal(hdr, 136,  12, Math.floor(Date.now() / 1000));
    hdr.fill(32, 148, 156);
    hdr[156] = isDir ? 53 : 48; // '5' or '0'
    _writeAscii(hdr, 257, 6, "ustar");
    _writeAscii(hdr, 263, 2, "00");
    const csum = hdr.reduce((s, b) => s + b, 0);
    _writeOctal(hdr, 148, 7, csum);
    hdr[155] = 0;
    chunks.push(hdr);
    if (!isDir) {
      chunks.push(content);
      const pad = _padLen(content.length) - content.length;
      if (pad > 0) chunks.push(new Uint8Array(pad));
    }
  }
  chunks.push(new Uint8Array(_blockSize * 2));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out   = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ---- MEMFS ↔ wasifs bridge ----

function _wasifsToMemfs(module, wasifsBytes) {
  const nodes = _parseWasifs(wasifsBytes);
  // directories first
  for (const [path, node] of nodes)
    if (node.kind === "directory") { try { module.FS.mkdir(path); } catch {} }
  // files
  for (const [path, node] of nodes)
    if (node.kind === "file" && node.bytes) module.FS.writeFile(path, node.bytes);
}

function _memfsToWasifs(module) {
  const nodes = new Map();
  nodes.set("/home/user", { kind: "directory" });
  function walk(dir) {
    let entries;
    try { entries = module.FS.readdir(dir); } catch { return; }
    for (const e of entries) {
      if (e === "." || e === "..") continue;
      const path = `${dir}/${e}`;
      let stat;
      try { stat = module.FS.stat(path); } catch { continue; }
      if (module.FS.isDir(stat.mode)) {
        nodes.set(path, { kind: "directory" });
        walk(path);
      } else {
        let bytes;
        try { bytes = module.FS.readFile(path); } catch { continue; }
        nodes.set(path, { kind: "file", bytes });
      }
    }
  }
  walk("/home/user");
  return _createWasifs(nodes);
}

// ---- worker state ----

let emacsModule = null;
let emacsBooted = false;

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

// ---- Emacs module lifecycle ----

async function loadModule(pdmpBytes, userWasifsBytes) {
  return new Promise((resolve, reject) => {
    var Module = {
      noInitialRun: true,
      thisProgram: "temacs",
      locateFile(path) { return `${ARTIFACT_DIR}/${path}`; },
      print(text) { post("stdout", { text }); },
      printErr(text) { post("stderr", { text }); },
      onRuntimeInitialized() { resolve(Module); },
      preRun: [() => {
        // System layer: pdmp
        if (pdmpBytes) Module.FS.writeFile("/bootstrap-emacs.pdmp", pdmpBytes);

        // User layer: expand wasifs into /home/user (one time only)
        try { Module.FS.mkdir("/home"); } catch {}
        try { Module.FS.mkdir("/home/user"); } catch {}
        if (userWasifsBytes) {
          _wasifsToMemfs(Module, userWasifsBytes);
        } else {
          // 空の wasifs でも /home/user は作成済み
          try { Module.FS.mkdir("/home/user/projects"); } catch {}
        }
      }],
    };
    self.Module = Module;
    try { importScripts(`${ARTIFACT_DIR}/temacs`); }
    catch (e) { reject(e); }
  });
}

async function generatePdmp(module) {
  post("status", { text: "初回起動: 事前ロード状態を生成中 (約60秒)..." });
  module.callMain(["--batch", "-l", "loadup", "--temacs=pbootstrap"]);
  let bytes;
  try { bytes = module.FS.readFile("/bootstrap-emacs.pdmp"); } catch {
    throw new Error("pbootstrap 完了したが /bootstrap-emacs.pdmp が見つかりません");
  }
  await opfsSave(OPFS_PDMP, bytes);
  post("status", { text: "事前ロード状態を OPFS に保存しました" });
  post("pdmp-generated", { size: bytes.byteLength });
  return bytes;
}

async function bootFromPdmp(module) {
  const code = module.callMain([
    "--dump-file=/bootstrap-emacs.pdmp",
    "--batch",
    "--eval", '(princ "ready\n")',
  ]);
  if (code !== 0) throw new Error(`pdmp ブート失敗 (exit ${code})`);
  emacsBooted = true;
  post("status", { text: "Emacs 起動完了 (事前ロード状態から)" });
}

async function syncUserHome(module) {
  try {
    const wasifsBytes = _memfsToWasifs(module);
    await opfsSave(OPFS_USERHOME, wasifsBytes);
  } catch (e) {
    post("stderr", { text: `user-home sync 失敗: ${e}` });
  }
}

// ---- worker main init ----

(async () => {
  try {
    post("status", { text: "ストレージを確認中..." });

    let pdmpBytes     = await opfsLoad(OPFS_PDMP);
    let userWasifs    = await opfsLoad(OPFS_USERHOME);
    const needPdmp    = !pdmpBytes;

    post("status", { text: needPdmp ? "初回起動です..." : "保存済み状態を読み込み中..." });

    if (needPdmp) {
      // First boot phase 1: load module without pdmp to run pbootstrap
      const tmpModule = await loadModule(null, null);
      pdmpBytes = await generatePdmp(tmpModule);
      // pbootstrap が終わったら module は使えないので再ロード
      // (EXIT_RUNTIME=0 なので runtime は生きているが Emacs は exit 済み)
      // 新しい module インスタンスで pdmp ブートする
    }

    if (!userWasifs) {
      // 空の user-home.wasifs を OPFS に作成
      const emptyNodes = new Map([
        ["/home/user", { kind: "directory" }],
        ["/home/user/projects", { kind: "directory" }],
      ]);
      userWasifs = _createWasifs(emptyNodes);
      await opfsSave(OPFS_USERHOME, userWasifs);
    }

    // Full boot: pdmp + user.wasifs を MEMFS に展開してブート
    emacsModule = await loadModule(pdmpBytes, userWasifs);
    await bootFromPdmp(emacsModule);

    post("ready", {});
    post("user-home-files", { entries: _userFileList(emacsModule) });

  } catch (e) {
    post("error", { text: `起動エラー: ${e}` });
  }
})();

// ---- message handler ----

self.onmessage = async (event) => {
  const { type, command, wasifsBytes, filename } = event.data || {};

  if (type === "run-buffer-command") {
    await runCommand(command);
    return;
  }

  if (type === "export-user-home") {
    // /home/user MEMFS → wasifs bytes をメインスレッドに返す
    if (!emacsModule) { post("error", { text: "Emacs 未起動" }); return; }
    const bytes = _memfsToWasifs(emacsModule);
    post("export-data", { bytes });
    return;
  }

  if (type === "import-user-home") {
    // 新しい wasifs でユーザーホームを置き換える
    if (!emacsModule) { post("error", { text: "Emacs 未起動" }); return; }
    _wasifsToMemfs(emacsModule, new Uint8Array(wasifsBytes));
    await opfsSave(OPFS_USERHOME, new Uint8Array(wasifsBytes));
    post("user-home-files", { entries: _userFileList(emacsModule) });
    return;
  }

  if (type === "list-user-files") {
    if (!emacsModule) return;
    post("user-home-files", { entries: _userFileList(emacsModule) });
    return;
  }
};

// ---- command execution ----

async function runCommand(command) {
  if (!emacsModule || !emacsBooted) {
    post("error", { text: "Emacs 未起動" });
    return;
  }

  try {
    if (command?.type === "process-probe") {
      throw new Error("host.process はブラウザ MVP では利用できません");
    }
    if (["clipboard-copy", "clipboard-cut", "clipboard-yank"].includes(command?.type)) {
      throw new Error("clipboard/kill-ring は GUI clipboard プロトコルが必要です");
    }
    if (["find-file", "switch-buffer"].includes(command?.type)) {
      const msg = "minibuffer は persistent Emacs command loop が必要です";
      post("pending-command", { commandType: command.type, state: "unavailable", error: msg });
      throw new Error(msg);
    }

    // Emacs に eval — MEMFS が /home/user/ の真実なので再マテリアライズ不要
    const evalStatus = emacsModule.ccall(
      "wasmacs_eval_string", "number", ["string"], [buildEval(command)],
    );

    if (evalStatus !== 0) {
      const last = emacsModule.ccall("wasmacs_last_result", "string", [], []);
      throw new Error(`wasmacs_eval_string returned ${evalStatus}: ${last}`);
    }

    const readback = emacsModule.ccall("wasmacs_last_result", "string", [], []);
    const parsed   = parseReadback(readback);

    // コマンド完了後: /home/user MEMFS → wasifs → OPFS (真の source of truth が一か所)
    await syncUserHome(emacsModule);

    post("sync-file", parsed);
    post("exit", { code: 0 });
    post("user-home-files", { entries: _userFileList(emacsModule) });

  } catch (e) {
    post("error", { text: e?.stack ?? String(e) });
  }
}

// ---- user file list helper ----

function _userFileList(module) {
  const files = [];
  function walk(dir) {
    let entries;
    try { entries = module.FS.readdir(dir); } catch { return; }
    for (const e of entries) {
      if (e === "." || e === "..") continue;
      const path = `${dir}/${e}`;
      let stat;
      try { stat = module.FS.stat(path); } catch { continue; }
      if (!module.FS.isDir(stat.mode)) files.push(path);
      else walk(path);
    }
  }
  walk("/home/user");
  return files;
}

// ---- Emacs eval form builder (same logic as wasm-worker.js) ----

function buildEval(command = { type: "ensure-marker", path: "/home/user/notes.txt" }) {
  const path        = command?.path ?? "/home/user/notes.txt";
  const commandForm = buildCommandForm(command);
  const boundary    = needsUndoBoundary(command) ? "    (undo-boundary)" : "";
  const save        = shouldSaveBuffer(command)  ? "    (when (buffer-modified-p) (save-buffer))" : "";
  return [
    `(let ((path ${q(path)}))`,
    "  (find-file path)",
    commandForm, boundary, save,
    "    (concat path", `            ${q("\n")}`,
    "            (number-to-string (1- (point)))", `            ${q("\n")}`,
    "            (buffer-string))))",
  ].filter(Boolean).join(" ");
}

function buildCommandForm(c) {
  const pt = `(goto-char (min (point-max) (+ (point-min) ${Math.max(0, Number(c?.pointIndex) || 0)})))`;
  if (c?.type === "insert-text")                         return `${pt} (insert ${q(c.text)})`;
  if (c?.type === "backspace")                           return `${pt} (unless (bobp) (delete-char -1))`;
  if (c?.type === "move-point" && c.direction === "left")  return `${pt} (unless (bobp) (backward-char 1))`;
  if (c?.type === "move-point" && c.direction === "right") return `${pt} (unless (eobp) (forward-char 1))`;
  if (c?.type === "save-buffer")                         return `${pt} (save-buffer)`;
  if (c?.type === "undo")                                return `${pt} (undo-only 1)`;
  if (c?.type === "redo")                                return `${pt} (undo-redo 1)`;
  return [
    "(goto-char (point-min))",
    `(unless (search-forward ${q("Saved by Emacs core.")} nil t)`,
    "  (goto-char (point-max))",
    `  (insert ${q("\nSaved by Emacs core.\n")}))`,
  ].join(" ");
}

function needsUndoBoundary(c) {
  return ["insert-text","backspace","undo","redo","ensure-marker"].includes(c?.type);
}
function shouldSaveBuffer(c) {
  return !["move-point","undo","redo"].includes(c?.type);
}
function q(v) {
  return `"${String(v).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\n/g,"\\n")}"`;
}
function parseReadback(text) {
  const a = text.indexOf("\n"), b = text.indexOf("\n", a + 1);
  if (a < 0 || b < 0) throw new Error("invalid emacs readback");
  return { path: text.slice(0, a), pointIndex: parseInt(text.slice(a+1, b), 10), text: text.slice(b+1) };
}
