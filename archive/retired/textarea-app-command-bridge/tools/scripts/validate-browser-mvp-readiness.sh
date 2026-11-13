#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
glue="${repo_root}/build/artifacts/emacs-core-spike.js"
wasm="${repo_root}/build/artifacts/emacs-core-spike.wasm"
plan="${repo_root}/doc/browser-mvp-plan.md"
batch_log="${repo_root}/logs/wasm-batch-eval.txt"

if [[ ! -f "${batch_log}" ]]; then
  batch_log="${repo_root}/archive/old-logs/wasm-batch-eval.txt"
fi

test -f "${glue}"
test -f "${wasm}"
test -f "${plan}"
test -f "${batch_log}"

rg 'NODERAWFS' "${glue}" >/dev/null
rg 'NODERAWFS is currently only supported on Node\.js environment' "${glue}" >/dev/null
rg 'not a separate|not become a replacement|without `NODERAWFS`' "${plan}" >/dev/null
rg 'hello wasmacs' "${batch_log}" >/dev/null

echo "browser MVP readiness validation passed: current wasm artifact is Node-only; browser packaging profile is documented"
