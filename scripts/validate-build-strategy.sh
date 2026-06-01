#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

strategy="docs/build-strategy.md"
script="scripts/build-emacs-core-spike.sh"

test -f "$strategy"
test -f "$script"

required_patterns=(
  "Emscripten-first"
  "WASI SDK / wasi-libc"
  "--without-x"
  "--without-ns"
  "--without-pgtk"
  "--without-sound"
  "--without-dbus"
  "--without-gsettings"
  "--without-native-compilation"
  "--with-dumping=none"
  "signals"
  "subprocesses"
  "pty"
  "sockets"
  "termios"
  "mmap"
  "setjmp/longjmp"
  "dumping/pdump"
)

for pattern in "${required_patterns[@]}"; do
  rg -q -- "$pattern" "$strategy"
done

bash -n "$script"
rg -q -- "build/emacs-core-spike" "$script"
rg -q -- "vendor/emacs" "$script"

echo "build strategy validation passed"
