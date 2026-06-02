#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
doc="${repo_root}/docs/minibuffer-command-loop-plan.md"

test -f "${doc}"

rg 'vendor/emacs/lisp/files\.el' "${doc}" >/dev/null
rg 'vendor/emacs/lisp/window\.el' "${doc}" >/dev/null
rg 'vendor/emacs/lisp/simple\.el' "${doc}" >/dev/null
rg 'vendor/emacs/lisp/minibuffer\.el' "${doc}" >/dev/null
rg 'vendor/emacs/src/minibuf\.c' "${doc}" >/dev/null
rg 'vendor/emacs/src/keyboard\.c' "${doc}" >/dev/null
rg 'vendor/emacs/src/window\.c' "${doc}" >/dev/null

rg 'read-file-name|read-buffer|completing-read|read-from-minibuffer' "${doc}" >/dev/null
rg 'Vminibuffer_list|minibuf_level|active-minibuffer-window|read_minibuf' "${doc}" >/dev/null
rg 'host\.gui\.minibuffer-state' "${doc}" >/dev/null
rg 'host\.gui\.minibuffer-input' "${doc}" >/dev/null
rg 'file candidates' "${doc}" >/dev/null
rg 'unavailable boundaries' "${doc}" >/dev/null

rg -n 'DEFUN \("active-minibuffer-window"|DEFUN \("minibufferp"|read_minibuf|Vminibuffer_list|minibuf_level' \
  "${repo_root}/vendor/emacs/src/minibuf.c" >/dev/null
rg -n 'read-file-name' "${repo_root}/vendor/emacs/lisp/files.el" >/dev/null
rg -n 'read-buffer|switch-to-buffer' "${repo_root}/vendor/emacs/lisp/window.el" "${repo_root}/vendor/emacs/lisp/simple.el" >/dev/null

echo "minibuffer command loop plan validation passed"
