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
rg "Module\\['_wasmacs_garbage_collect'\\].*wasmacs_garbage_collect" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_last_result'\\].*wasmacs_last_result" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_entrypoint_state'\\].*wasmacs_entrypoint_state" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_minibuffer_state'\\].*wasmacs_minibuffer_state" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_command_state'\\].*wasmacs_command_state" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_os_lifecycle_phase'\\].*wasmacs_os_lifecycle_phase" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_os_lifecycle_state'\\].*wasmacs_os_lifecycle_state" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_os_root_state_snapshot'\\].*wasmacs_os_root_state_snapshot" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_os_stack_bounds_probe'\\].*wasmacs_os_stack_bounds_probe" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_os_gc_permission'\\].*wasmacs_os_gc_permission" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_os_gc_permission_state'\\].*wasmacs_os_gc_permission_state" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_os_root_safety_probe'\\].*wasmacs_os_root_safety_probe" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_os_pending_command_state'\\].*wasmacs_os_pending_command_state" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_os_configure_dired_without_ls'\\].*wasmacs_os_configure_dired_without_ls" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_os_dired_without_ls_probe'\\].*wasmacs_os_dired_without_ls_probe" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_os_filesystem_dired_state'\\].*wasmacs_os_filesystem_dired_state" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_command_begin_minibuffer_probe'\\].*wasmacs_command_begin_minibuffer_probe" "${artifact_dir}/temacs" >/dev/null

(
  cd "${artifact_dir}"
  node ./temacs --batch --eval '(princ "hello persistent-profile\n")'
) > "${log_path}" 2>&1

rg 'hello persistent-profile' "${log_path}" >/dev/null
echo "browser persistent profile validation passed"
