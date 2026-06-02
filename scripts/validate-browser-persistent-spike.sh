#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
artifact_dir="${repo_root}/artifacts/emacs-browser-persistent-spike"
log_path="${repo_root}/logs/wasm-browser-persistent-batch.txt"

test -f "${artifact_dir}/temacs"
test -f "${artifact_dir}/temacs.wasm"
test -f "${artifact_dir}/temacs.data"

if rg 'NODERAWFS is currently only supported' "${artifact_dir}/temacs" >/dev/null; then
  echo "error: persistent browser profile still contains Node-only NODERAWFS runtime" >&2
  exit 1
fi

rg 'temacs\.data' "${artifact_dir}/temacs" >/dev/null
rg 'var noExitRuntime = true' "${artifact_dir}/temacs" >/dev/null
rg "Module\\['callMain'\\] = callMain" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['ccall'\\] = ccall" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['FS_readFile'\\] = FS_readFile" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_eval_string'\\].*wasmacs_eval_string" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_last_result'\\].*wasmacs_last_result" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_minibuffer_state'\\].*wasmacs_minibuffer_state" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_command_state'\\].*wasmacs_command_state" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_command_begin_minibuffer_probe'\\].*wasmacs_command_begin_minibuffer_probe" "${artifact_dir}/temacs" >/dev/null

(
  cd "${artifact_dir}"
  node ./temacs --batch --eval '(princ "hello persistent-profile\n")'
) > "${log_path}" 2>&1

rg 'hello persistent-profile' "${log_path}" >/dev/null
echo "browser persistent profile validation passed"
