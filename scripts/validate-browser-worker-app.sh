#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

test -f "${repo_root}/app/index.html"
test -f "${repo_root}/app/src/main.js"
test -f "${repo_root}/app/src/wasm-worker.js"
test -f "${repo_root}/app/src/command-queue.js"
test -f "${repo_root}/app/src/buffer-dirty.js"
test -f "${repo_root}/app/src/input-protocol.js"
test -f "${repo_root}/app/src/minibuffer-view.js"
test -f "${repo_root}/app/src/redisplay-protocol.js"
test -f "${repo_root}/app/src/user-file-list.js"
test -f "${repo_root}/app/src/user-path.js"
test -f "${repo_root}/app/src/styles.css"
test -f "${repo_root}/scripts/run-browser-smoke.mjs"
test -f "${repo_root}/scripts/serve-app.mjs"

rg 'new Worker\("/app/src/wasm-worker\.js", \{ type: "classic" \}\)' "${repo_root}/app/src/main.js" >/dev/null
rg 'BrowserUserImage' "${repo_root}/app/src/main.js" >/dev/null
rg 'isEditorModified' "${repo_root}/app/src/main.js" >/dev/null
rg 'persistEditorIfModified' "${repo_root}/app/src/main.js" >/dev/null
rg 'user-filesystem-empty\.wasifs' "${repo_root}/app/src/main.js" >/dev/null
rg 'wasmacs:user-filesystem\.wasifs:v1' "${repo_root}/app/src/main.js" >/dev/null
rg 'const defaultBufferPath = "/home/user/notes\.txt"' "${repo_root}/app/src/main.js" >/dev/null
rg 'let bufferPath = defaultBufferPath' "${repo_root}/app/src/main.js" >/dev/null
rg 'normalizeUserPath' "${repo_root}/app/src/main.js" >/dev/null
rg 'openBufferFromInput' "${repo_root}/app/src/main.js" >/dev/null
rg 'filePathInput\.addEventListener\("keydown"' "${repo_root}/app/src/main.js" >/dev/null
rg 'renderUserFileList' "${repo_root}/app/src/main.js" >/dev/null
rg 'switchBuffer' "${repo_root}/app/src/main.js" >/dev/null
rg 'visibleUserFilePaths' "${repo_root}/app/src/main.js" >/dev/null
rg 'PaxHeader' "${repo_root}/app/src/user-file-list.js" >/dev/null
rg 'localStorage\.setItem\(storageKey' "${repo_root}/app/src/main.js" >/dev/null
rg 'download = "user-filesystem\.wasifs"' "${repo_root}/app/src/main.js" >/dev/null
rg 'BrowserUserImage\.fromBytes\(new Uint8Array\(await file\.arrayBuffer\(\)\)\)' "${repo_root}/app/src/main.js" >/dev/null
rg 'editor\.addEventListener\("input"' "${repo_root}/app/src/main.js" >/dev/null
rg 'createUserWasifs' "${repo_root}/app/src/browser-wasifs.js" >/dev/null
rg 'parseUserWasifs' "${repo_root}/app/src/browser-wasifs.js" >/dev/null
rg 'id="editor"' "${repo_root}/app/index.html" >/dev/null
rg 'id="frame-grid"' "${repo_root}/app/index.html" >/dev/null
rg 'id="minibuffer"' "${repo_root}/app/index.html" >/dev/null
rg 'id="file-list"' "${repo_root}/app/index.html" >/dev/null
rg 'id="file-path"' "${repo_root}/app/index.html" >/dev/null
rg 'id="open-file"' "${repo_root}/app/index.html" >/dev/null
rg 'id="save"' "${repo_root}/app/index.html" >/dev/null
rg 'id="process-probe"' "${repo_root}/app/index.html" >/dev/null
rg 'id="export-image"' "${repo_root}/app/index.html" >/dev/null
rg 'id="import-image"' "${repo_root}/app/index.html" >/dev/null
rg 'run-buffer-command' "${repo_root}/app/src/main.js" >/dev/null
rg 'enqueueBufferCommand' "${repo_root}/app/src/main.js" >/dev/null
rg '__wasmacsSmoke' "${repo_root}/app/src/main.js" >/dev/null
rg 'runNextBufferCommand' "${repo_root}/app/src/main.js" >/dev/null
rg 'coalesceBufferCommand' "${repo_root}/app/src/main.js" >/dev/null
rg 'coalesceBufferCommand' "${repo_root}/app/src/command-queue.js" >/dev/null
rg 'keyEventToBufferCommand' "${repo_root}/app/src/main.js" >/dev/null
rg 'minibufferTextForWorkerError' "${repo_root}/app/src/main.js" >/dev/null
rg 'nextPointIndexForCommand' "${repo_root}/app/src/main.js" >/dev/null
rg 'validateBufferCommand' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'insert-text' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'Backspace' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'ArrowLeft' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'move-point' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'save-buffer' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'keyboard-quit' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'undo' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'clipboard-copy' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'clipboard-cut' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'clipboard-yank' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'key-prefix' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'find-file' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'switch-buffer' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'process-probe' "${repo_root}/app/src/input-protocol.js" >/dev/null
rg 'sync-file' "${repo_root}/app/src/main.js" >/dev/null
rg 'synced from emacs' "${repo_root}/app/src/main.js" >/dev/null
rg 'textToGridDrawMessage' "${repo_root}/app/src/main.js" >/dev/null
rg 'renderTextGrid' "${repo_root}/app/src/main.js" >/dev/null
rg 'text-grid-draw' "${repo_root}/app/src/redisplay-protocol.js" >/dev/null
rg 'validateTextGridDrawMessage' "${repo_root}/app/src/redisplay-protocol.js" >/dev/null
rg '\.frame-grid' "${repo_root}/app/src/styles.css" >/dev/null
rg '\.frame-cursor' "${repo_root}/app/src/styles.css" >/dev/null
rg '\.minibuffer' "${repo_root}/app/src/styles.css" >/dev/null
rg '\.file-list' "${repo_root}/app/src/styles.css" >/dev/null
rg 'materializeUserImage' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'FS_createDataFile' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'wasmacs_eval_string' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'wasmacs_last_result' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'buildCommandForm' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'find-file path' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'save-buffer' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'undo-boundary' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg '\(undo-only 1\)' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg '\(undo-redo 1\)' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'delete-char -1' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'backward-char 1' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'forward-char 1' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'host\.process is unavailable' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'clipboard/kill-ring requires GUI clipboard protocol' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'minibuffer requires persistent Emacs command loop' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'parseReadback' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'command\?\.path' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg '/artifacts/emacs-browser-persistent-spike/' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'importScripts\("/artifacts/emacs-browser-persistent-spike/temacs"\)' "${repo_root}/app/src/wasm-worker.js" >/dev/null
rg 'basename\(filePath\) === "temacs"' "${repo_root}/scripts/serve-app.mjs" >/dev/null
rg 'run-browser-smoke\.mjs' "${repo_root}/package.json" >/dev/null
rg 'browser:smoke:editing' "${repo_root}/package.json" >/dev/null
rg 'browser:smoke:all' "${repo_root}/package.json" >/dev/null
rg '"dev": "node scripts/serve-app\.mjs"' "${repo_root}/package.json" >/dev/null

echo "browser worker app validation passed"
