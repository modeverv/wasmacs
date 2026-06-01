#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

project_log="${repo_root}/logs/browser-project-file-smoke.txt"
command_log="${repo_root}/logs/browser-command-dispatch-smoke.txt"
switch_log="${repo_root}/logs/browser-file-switch-smoke.txt"
recovery_log="${repo_root}/logs/browser-worker-recovery-smoke.txt"
enter_open_log="${repo_root}/logs/browser-enter-open-smoke.txt"
autosave_log="${repo_root}/logs/browser-textarea-autosave-smoke.txt"
undo_quit_log="${repo_root}/logs/browser-undo-quit-smoke.txt"
real_undo_log="${repo_root}/logs/wasm-browser-worker-real-undo.txt"
real_undo_ui_log="${repo_root}/logs/browser-real-undo-ui-smoke.txt"
repeated_undo_ui_log="${repo_root}/logs/browser-repeated-undo-ui-smoke.txt"
clipboard_log="${repo_root}/logs/browser-clipboard-boundary-smoke.txt"
session_log="${repo_root}/logs/browser-editing-session-smoke.txt"

test -f "${project_log}"
test -f "${command_log}"
test -f "${switch_log}"
test -f "${recovery_log}"
test -f "${enter_open_log}"
test -f "${autosave_log}"
test -f "${undo_quit_log}"
test -f "${real_undo_log}"
test -f "${real_undo_ui_log}"
test -f "${repeated_undo_ui_log}"
test -f "${clipboard_log}"
test -f "${session_log}"

rg '"/home/user/projects/demo\.txt"' "${project_log}" >/dev/null
rg 'Saved by Emacs core\.DEMO' "${project_log}" >/dev/null
rg '"state": "loaded"' "${project_log}" >/dev/null

rg '"/home/user/projects/commands\.txt"' "${command_log}" >/dev/null
rg 'Saved by Emacs core\.A' "${command_log}" >/dev/null
rg '"status": "emacs command completed"' "${command_log}" >/dev/null
rg '"status": "process unavailable"' "${command_log}" >/dev/null
rg '"state": "process unavailable"' "${command_log}" >/dev/null
rg 'host\.process is unavailable in the browser MVP' "${command_log}" >/dev/null

rg '"/home/user/projects/switch-a\.txt"' "${switch_log}" >/dev/null
rg '~/projects/switch-a\.txt' "${switch_log}" >/dev/null
rg '~/projects/switch-b\.txt' "${switch_log}" >/dev/null
rg '"current": true' "${switch_log}" >/dev/null
rg 'A1' "${switch_log}" >/dev/null

rg '"/home/user/projects/recovery-order\.txt"' "${recovery_log}" >/dev/null
rg '"status": "process unavailable"' "${recovery_log}" >/dev/null
rg '"state": "process unavailable"' "${recovery_log}" >/dev/null
rg '"editor": "REC"' "${recovery_log}" >/dev/null
rg '"status": "emacs command completed"' "${recovery_log}" >/dev/null

rg '"/home/user/projects/enter-open\.txt"' "${enter_open_log}" >/dev/null
rg '~/projects/enter-open\.txt' "${enter_open_log}" >/dev/null
rg '"state": "loaded"' "${enter_open_log}" >/dev/null

rg '"/home/user/projects/autosave-a\.txt"' "${autosave_log}" >/dev/null
rg '"/home/user/projects/autosave-b\.txt"' "${autosave_log}" >/dev/null
rg '"editor": "TEXTAREA-DRAFT"' "${autosave_log}" >/dev/null
rg '"state": "modified"' "${autosave_log}" >/dev/null
rg '~/projects/autosave-a\.txt' "${autosave_log}" >/dev/null

rg '"/home/user/projects/undo-quit\.txt"' "${undo_quit_log}" >/dev/null
rg '"editor": "U"' "${undo_quit_log}" >/dev/null
rg '"status": "keyboard quit"' "${undo_quit_log}" >/dev/null
rg '"state": "keyboard quit"' "${undo_quit_log}" >/dev/null
rg 'INSERT_EVAL_STATUS:0' "${real_undo_log}" >/dev/null
rg 'UNDO_EVAL_STATUS:0' "${real_undo_log}" >/dev/null
rg 'FILE_TEXT:$' "${real_undo_log}" >/dev/null
rg '"/home/user/projects/real-undo-ui-[0-9]+\.txt"' "${real_undo_ui_log}" >/dev/null
rg '"status": "emacs command completed"' "${real_undo_ui_log}" >/dev/null
rg '"bufferState": "synced from emacs"' "${real_undo_ui_log}" >/dev/null
rg 'REAL_UNDO_UI_SMOKE:PASS' "${real_undo_ui_log}" >/dev/null
rg '"/home/user/projects/repeated-undo-ui-[0-9]+\.txt"' "${repeated_undo_ui_log}" >/dev/null
rg '"status": "emacs command completed"' "${repeated_undo_ui_log}" >/dev/null
rg '"bufferState": "synced from emacs"' "${repeated_undo_ui_log}" >/dev/null
rg 'REPEATED_UNDO_UI_SMOKE:PASS' "${repeated_undo_ui_log}" >/dev/null

rg '"/home/user/projects/clipboard-boundary\.txt"' "${clipboard_log}" >/dev/null
rg '"editor": "CLIP"' "${clipboard_log}" >/dev/null
rg '"status": "clipboard unavailable"' "${clipboard_log}" >/dev/null
rg '"state": "clipboard unavailable"' "${clipboard_log}" >/dev/null
rg 'clipboard/kill-ring requires GUI clipboard protocol' "${clipboard_log}" >/dev/null

rg 'PASS project file open/edit/save/reload /home/user/projects/demo\.txt' "${session_log}" >/dev/null
rg 'PASS command dispatch and process boundary /home/user/projects/commands\.txt' "${session_log}" >/dev/null
rg 'PASS file switching /home/user/projects/switch-a\.txt' "${session_log}" >/dev/null
rg 'PASS worker recovery after unavailable process /home/user/projects/recovery-order\.txt' "${session_log}" >/dev/null
rg 'PASS relative path enter open /home/user/projects/enter-open\.txt' "${session_log}" >/dev/null
rg 'PASS textarea autosave before file switch /home/user/projects/autosave-a\.txt' "${session_log}" >/dev/null
rg 'PASS keyboard quit visibility /home/user/projects/undo-quit\.txt' "${session_log}" >/dev/null
rg 'PASS real Emacs undo via persistent worker /home/user/worker-real-undo\.txt' "${session_log}" >/dev/null
rg 'PASS real Emacs undo via browser UI /home/user/projects/real-undo-ui-[0-9]+\.txt' "${session_log}" >/dev/null
rg 'PASS repeated real Emacs undo via browser UI /home/user/projects/repeated-undo-ui-[0-9]+\.txt' "${session_log}" >/dev/null
rg 'PASS clipboard and kill-ring boundary visibility /home/user/projects/clipboard-boundary\.txt' "${session_log}" >/dev/null

echo "browser editing smoke evidence validation passed"
