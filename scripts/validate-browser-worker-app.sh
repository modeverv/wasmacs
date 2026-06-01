#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

test -f "${repo_root}/app/index.html"
test -f "${repo_root}/app/src/main.js"
test -f "${repo_root}/app/src/wasm-worker.js"
test -f "${repo_root}/app/src/command-queue.js"
test -f "${repo_root}/app/src/input-protocol.js"
test -f "${repo_root}/app/src/redisplay-protocol.js"
test -f "${repo_root}/app/src/styles.css"
test -f "${repo_root}/scripts/serve-app.mjs"

rg 'new Worker\("/app/src/wasm-worker\.js", \{ type: "classic" \}\)' "${repo_root}/app/src/main.js" >/dev/null
rg 'BrowserUserImage' "${repo_root}/app/src/main.js" >/dev/null
rg 'user-filesystem-empty\.wasifs' "${repo_root}/app/src/main.js" >/dev/null
rg 'wasmacs:user-filesystem\.wasifs:v1' "${repo_root}/app/src/main.js" >/dev/null
rg 'const bufferPath = "/home/user/notes\.txt"' "${repo_root}/app/src/main.js" >/dev/null
rg 'localStorage\.setItem\(storageKey' "${repo_root}/app/src/main.js" >/dev/null
rg 'download = "user-filesystem\.wasifs"' "${repo_root}/app/src/main.js" >/dev/null
rg 'BrowserUserImage\.fromBytes\(new Uint8Array\(await file\.arrayBuffer\(\)\)\)' "${repo_root}/app/src/main.js" >/dev/null
rg 'editor\.addEventListener\("input"' "${repo_root}/app/src/main.js" >/dev/null
rg 'createUserWasifs' "${repo_root}/app/src/browser-wasifs.js" >/dev/null
rg 'parseUserWasifs' "${repo_root}/app/src/browser-wasifs.js" >/dev/null
rg 'id="editor"' "${repo_root}/app/index.html" >/dev/null
rg 'id="frame-grid"' "${repo_root}/app/index.html" >/dev/null
rg 'id="save"' "${repo_root}/app/index.html" >/dev/null
rg 'id="export-image"' "${repo_root}/app/index.html" >/dev/null
rg 'id="import-image"' "${repo_root}/app/index.html" >/dev/null
rg 'run-buffer-command' "${repo_root}/app/src/main.js" >/dev/null
rg 'enqueueBufferCommand' "${repo_root}/app/src/main.js" >/dev/null
rg 'runNextBufferCommand' "${repo_root}/app/src/main.js" >/dev/null
rg 'coalesceBufferCommand' "${repo_root}/app/src/main.js" >/dev/null
rg 'coalesceBufferCommand' "${repo_root}/app/src/command-queue.js" >/dev/null
rg 'keyEventToBufferCommand' "${repo_root}/app/src/main.js" >/dev/null
rg 'validateBufferCommand' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'insert-text' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'Backspace' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'ArrowLeft' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'move-point' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'sync-file' "${repo_root}/app/src/main.js" >/dev/null
rg 'synced from emacs' "${repo_root}/app/src/main.js" >/dev/null
rg 'textToGridDrawMessage' "${repo_root}/app/src/main.js" >/dev/null
rg 'renderTextGrid' "${repo_root}/app/src/main.js" >/dev/null
rg 'text-grid-draw' "${repo_root}/app/src/redisplay-protocol.js" >/dev/null
rg 'validateTextGridDrawMessage' "${repo_root}/app/src/redisplay-protocol.js" >/dev/null
rg '\.frame-grid' "${repo_root}/app/src/styles.css" >/dev/null
rg '\.frame-cursor' "${repo_root}/app/src/styles.css" >/dev/null
rg 'materializeUserImage' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'FS_createDataFile' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'WASMACS_SYNC_BEGIN' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'WASMACS_POINT:' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'buildCommandForm' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'delete-char -1' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'backward-char 1' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'forward-char 1' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'parseSyncedFile' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'const syncPath = "/home/user/notes\.txt"' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'insert-file-contents path' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg '/artifacts/emacs-browser-spike/' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'importScripts\("/artifacts/emacs-browser-spike/temacs"\)' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'basename\(filePath\) === "temacs"' "${repo_root}/scripts/serve-app.mjs" >/dev/null
rg '"dev": "node scripts/serve-app\.mjs"' "${repo_root}/package.json" >/dev/null

echo "browser worker app validation passed"
