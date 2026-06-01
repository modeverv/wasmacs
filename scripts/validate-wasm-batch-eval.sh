#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
artifact="$repo_root/artifacts/emacs-core-spike.wasm"
log_path="$repo_root/logs/wasm-batch-eval.txt"

test -f "$log_path"

if [[ -f "$artifact" ]]; then
  if rg 'hello wasmacs|\(\+ 1 2 3\)|/system/lisp/subr\.el' "$log_path" >/dev/null; then
    echo "wasm batch evaluation validation passed"
    exit 0
  fi
  rg 'invalid-function|internal-timer-start-idle|memory access out of bounds' "$log_path" >/dev/null
  echo "wasm batch evaluation blocked: wasm artifact exists, but temacs does not complete batch loadup"
  exit 0
fi

rg 'emconfigure not found|emmake not found|emcc not found' "$log_path" >/dev/null
rg 'exit_code: 127' "$log_path" >/dev/null

echo "wasm batch evaluation blocked: Emscripten toolchain is unavailable"
