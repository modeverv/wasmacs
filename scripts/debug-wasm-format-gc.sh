#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src_lisp="$repo_root/build/emacs-core-spike/src/lisp"
temacs="$repo_root/build/emacs-core-spike/build-gnu-host-internal-termcap/src/temacs"
debug_lisp="$repo_root/build/wasm-debug-lisp"
out_dir="$repo_root/build"

if [[ ! -f "$temacs" ]]; then
  echo "missing temacs: run scripts/build-emacs-core-spike.sh first" >&2
  exit 1
fi

mkdir -p "$debug_lisp"
cp "$src_lisp/subr.el" "$debug_lisp/subr.el"

long="$(printf 'x%.0s' {1..80})"

run_case() {
  local name="$1"
  local expr="$2"
  local out="$out_dir/wasm-debug-format-gc-${name}.out"

  cat > "$debug_lisp/loadup.el" <<EOF_LOADUP
;;; debug loadup -*- lexical-binding: t; -*-
(message "case ${name} start")
(load "emacs-lisp/debug-early")
(load "emacs-lisp/byte-run")
(load "emacs-lisp/backquote")
${expr}
(load "subr")
(message "after subr")
(defun internal-timer-start-idle () nil)
(defun internal-echo-keystrokes-prefix () nil)
EOF_LOADUP

  set +e
  EMACSDATA="$repo_root/build/emacs-core-spike/src/etc" \
    EMACSLOADPATH="$debug_lisp:$src_lisp" \
    node "$temacs" --batch --eval '(princ "hello wasmacs")' >"$out" 2>&1
  local code=$?
  set -e

  if rg -q 'after subr' "$out"; then
    printf 'PASS %s code=%s\n' "$name" "$code"
  else
    printf 'FAIL %s code=%s\n' "$name" "$code"
    rg -n 'case|Loading subr|Error|Wrong type|invalid-function|memory access|Aborted|OOM' "$out" | tail -n 12 || true
  fi
}

run_prefix() {
  local line="$1"
  local out="$out_dir/wasm-debug-format-gc-prefix-${line}.out"

  sed -n "1,${line}p" "$src_lisp/subr.el" > "$debug_lisp/subr.el"
  cat > "$debug_lisp/loadup.el" <<EOF_LOADUP
;;; debug loadup -*- lexical-binding: t; -*-
(message "case prefix-${line} start")
(load "emacs-lisp/debug-early")
(load "emacs-lisp/byte-run")
(load "emacs-lisp/backquote")
(format "list %s" (list "$long" "$long" "$long"))
(garbage-collect)
(load "subr")
(message "after subr prefix")
(defun internal-timer-start-idle () nil)
(defun internal-echo-keystrokes-prefix () nil)
EOF_LOADUP

  set +e
  EMACSDATA="$repo_root/build/emacs-core-spike/src/etc" \
    EMACSLOADPATH="$debug_lisp:$src_lisp" \
    node "$temacs" --batch --eval '(princ "hello wasmacs")' >"$out" 2>&1
  local code=$?
  set -e

  if rg -q 'after subr prefix' "$out"; then
    printf 'PREFIX_PASS %s code=%s\n' "$line" "$code"
  else
    printf 'PREFIX_FAIL %s code=%s\n' "$line" "$code"
    rg -n 'case|Loading subr|Error|Wrong type|invalid-function|memory access|Aborted|OOM' "$out" | tail -n 12 || true
  fi
}

list_expr="(list \"$long\" \"$long\" \"$long\")"

run_case "format-only" "(format \"list %s\" $list_expr)"
run_case "format-gc" "(format \"list %s\" $list_expr) (garbage-collect)"
run_case "format-gc-raise" "(format \"list %s\" $list_expr) (garbage-collect) (setq gc-cons-threshold most-positive-fixnum)"
run_case "high-gc-format" "(setq gc-cons-threshold most-positive-fixnum) (format \"list %s\" $list_expr)"

run_prefix 5697
run_prefix 5717
