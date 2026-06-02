#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
doc="${repo_root}/docs/minibuffer-suspended-read-plan.md"
probe="${repo_root}/scripts/probe-browser-minibuffer-state-export.mjs"
log="${repo_root}/logs/wasm-browser-minibuffer-state-export.txt"

test -f "${doc}"
test -f "${probe}"
test -f "${log}"

rg 'Fread_from_minibuffer' "${doc}" >/dev/null
rg 'read_minibuf' "${doc}" >/dev/null
rg 'read_minibuf_unwind' "${doc}" >/dev/null
rg 'recursive_edit_1' "${doc}" >/dev/null
rg 'command_loop' "${doc}" >/dev/null
rg 'command_loop_1' "${doc}" >/dev/null
rg 'read_char' "${doc}" >/dev/null
rg 'read_decoded_event_from_main_queue' "${doc}" >/dev/null
rg 'kbd_buffer_store_event' "${doc}" >/dev/null
rg 'exit-recursive-edit' "${doc}" >/dev/null
rg 'abort-recursive-edit' "${doc}" >/dev/null

rg 'browser-side `read-file-name` clone' "${doc}" >/dev/null
rg 'raw exported `read_minibuf` ABI' "${doc}" >/dev/null
rg 'wasmacs_eval_string' "${doc}" >/dev/null
rg 'unavailable:busy' "${doc}" >/dev/null
rg 'Asyncify/JSPI-style waitpoint' "${doc}" >/dev/null
rg 'pending-minibuffer' "${doc}" >/dev/null
rg 'GC And Root Safety' "${doc}" >/dev/null
rg 'wasmacs_minibuffer_state' "${doc}" >/dev/null
rg 'probe-browser-minibuffer-state-export\.mjs' "${doc}" >/dev/null
rg 'wasm-browser-minibuffer-state-export\.txt' "${doc}" >/dev/null

rg 'wasmacs_minibuffer_state' "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh" >/dev/null
rg '_wasmacs_minibuffer_state' "${repo_root}/scripts/build-emacs-browser-persistent-spike.sh" >/dev/null
rg 'wasmacs_minibuffer_state' "${probe}" >/dev/null
rg 'active:false' "${log}" >/dev/null
rg 'depth:0' "${log}" >/dev/null
rg 'prompt:' "${log}" >/dev/null
rg 'input:' "${log}" >/dev/null
rg 'current-minibuffer:false' "${log}" >/dev/null

rg -n 'Fread_from_minibuffer|read_minibuf|read_minibuf_unwind' \
  "${repo_root}/vendor/emacs/src/minibuf.c" >/dev/null
rg -n 'recursive_edit_1|command_loop_1|read_char|read_decoded_event_from_main_queue|kbd_buffer_store_event|exit-recursive-edit|abort-recursive-edit' \
  "${repo_root}/vendor/emacs/src/keyboard.c" >/dev/null

echo "minibuffer suspended read plan validation passed"
