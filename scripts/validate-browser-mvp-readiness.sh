#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
glue="${repo_root}/artifacts/emacs-core-spike.js"
wasm="${repo_root}/artifacts/emacs-core-spike.wasm"
plan="${repo_root}/docs/browser-mvp-plan.md"

test -f "${glue}"
test -f "${wasm}"
test -f "${plan}"

rg 'NODERAWFS' "${glue}" >/dev/null
rg 'NODERAWFS is currently only supported on Node\.js environment' "${glue}" >/dev/null
rg 'not a separate|not become a replacement|without `NODERAWFS`' "${plan}" >/dev/null
rg 'hello wasmacs' "${repo_root}/logs/wasm-batch-eval.txt" >/dev/null

echo "browser MVP readiness validation passed: current wasm artifact is Node-only; browser packaging profile is documented"
