#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

emacs_bin="build/native-emacs-30.2/src/src/emacs"
log_file="logs/native-baseline.txt"

test -x "$emacs_bin"
test -f "$log_file"

version="$("$emacs_bin" --batch --eval '(princ emacs-version)')"
test "$version" = "30.2"

rg -q "hello wasmacs" "$log_file"
rg -q "tag: emacs-30.2" "$log_file"
rg -q -- "--without-native-compilation" "$log_file"
rg -q -- "--with-dumping=none" "$log_file"

echo "native baseline validation passed"
