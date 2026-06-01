#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

inventory="docs/emacs-30.2-source-inventory.md"
test -f "$inventory"

required_patterns=(
  "vendor/emacs/src/emacs.c"
  "vendor/emacs/lisp/loadup.el"
  "vendor/emacs/src/pdumper.c"
  "vendor/emacs/src/eval.c"
  "vendor/emacs/src/lread.c"
  "vendor/emacs/src/bytecode.c"
  "vendor/emacs/src/fns.c"
  "vendor/emacs/src/fileio.c"
  "vendor/emacs/src/coding.c"
  "vendor/emacs/src/keyboard.c"
  "vendor/emacs/src/callint.c"
  "vendor/emacs/src/frame.c"
  "vendor/emacs/src/window.c"
  "vendor/emacs/src/xdisp.c"
  "vendor/emacs/src/dispnew.c"
  "vendor/emacs/src/process.c"
  "vendor/emacs/src/callproc.c"
  "required"
  "stub"
  "defer"
  "MVP Surface Table"
)

for pattern in "${required_patterns[@]}"; do
  rg -q "$pattern" "$inventory"
done

rg -n "DEFUN|defsubr|syms_of_" \
  vendor/emacs/src/{eval,lread,bytecode,fileio,keyboard,window,xdisp,callproc,process}.c \
  >/dev/null

echo "source inventory validation passed"
