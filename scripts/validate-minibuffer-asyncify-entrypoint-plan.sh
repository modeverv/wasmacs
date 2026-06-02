#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
doc="${repo_root}/docs/minibuffer-asyncify-entrypoint-plan.md"
build_script="${repo_root}/scripts/build-emacs-browser-asyncify-spike.sh"
artifact_dir="${repo_root}/artifacts/emacs-browser-asyncify-spike"
log_path="${repo_root}/logs/wasm-browser-asyncify-batch.txt"
boundary_log="${repo_root}/logs/wasm-browser-asyncify-minibuffer-active-read-boundary.txt"
emscripten_settings="/opt/homebrew/Cellar/emscripten/5.0.7/libexec/src/settings.js"

test -f "${doc}"
test -x "${build_script}"
test -f "${artifact_dir}/temacs"
test -f "${artifact_dir}/temacs.wasm"
test -f "${artifact_dir}/temacs.data"

rg 'Emacs-owned suspended' "${doc}" >/dev/null
rg 'ASYNCIFY' "${doc}" >/dev/null
rg 'JSPI' "${doc}" >/dev/null
rg 'artifacts/emacs-browser-asyncify-spike' "${doc}" >/dev/null
rg 'wasmacs_host_wait_for_input' "${doc}" >/dev/null
rg 'read_decoded_event_from_main_queue' "${doc}" >/dev/null
rg 'kbd_buffer_store_event' "${doc}" >/dev/null
rg 'pending-minibuffer' "${doc}" >/dev/null
rg 'unavailable:busy' "${doc}" >/dev/null
rg 'unavailable:noninteractive-batch' "${doc}" >/dev/null
rg 'node --stack-size=65500' "${doc}" >/dev/null

rg -- '-sASYNCIFY=1' "${build_script}" >/dev/null
rg -- '-sASYNCIFY_STACK_SIZE=65536' "${build_script}" >/dev/null
rg '_wasmacs_eval_string' "${build_script}" >/dev/null
rg '_wasmacs_minibuffer_state' "${build_script}" >/dev/null
rg '_wasmacs_command_state' "${build_script}" >/dev/null
rg '_wasmacs_command_begin_minibuffer_probe' "${build_script}" >/dev/null

test -f "${emscripten_settings}"
rg 'var ASYNCIFY = 0' "${emscripten_settings}" >/dev/null
rg --fixed-strings 'var ASYNCIFY_IMPORTS = []' "${emscripten_settings}" >/dev/null
rg 'var ASYNCIFY_STACK_SIZE = 4096' "${emscripten_settings}" >/dev/null
rg 'var JSPI = 0' "${emscripten_settings}" >/dev/null
rg --fixed-strings 'var JSPI_EXPORTS = []' "${emscripten_settings}" >/dev/null
rg --fixed-strings 'var JSPI_IMPORTS = []' "${emscripten_settings}" >/dev/null

if rg 'NODERAWFS is currently only supported' "${artifact_dir}/temacs" >/dev/null; then
  echo "error: asyncify browser profile still contains Node-only NODERAWFS runtime" >&2
  exit 1
fi

rg 'temacs\.data' "${artifact_dir}/temacs" >/dev/null
rg 'var noExitRuntime = true' "${artifact_dir}/temacs" >/dev/null
rg 'Asyncify' "${artifact_dir}/temacs" >/dev/null
rg "Module\\['callMain'\\] = callMain" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['ccall'\\] = ccall" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_eval_string'\\].*wasmacs_eval_string" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_last_result'\\].*wasmacs_last_result" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_minibuffer_state'\\].*wasmacs_minibuffer_state" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_command_state'\\].*wasmacs_command_state" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_command_begin_minibuffer_probe'\\].*wasmacs_command_begin_minibuffer_probe" "${artifact_dir}/temacs" >/dev/null

(
  cd "${artifact_dir}"
  node --stack-size=65500 ./temacs --batch --eval '(princ "hello asyncify-profile\n")'
) > "${log_path}" 2>&1

rg 'hello asyncify-profile' "${log_path}" >/dev/null
WASMACS_ARTIFACT_DIR="${artifact_dir}" \
WASMACS_LOG_PATH="${boundary_log}" \
  node --stack-size=65500 "${repo_root}/scripts/probe-browser-minibuffer-active-read-boundary.mjs" >/dev/null

rg 'BEGIN_READBACK:unavailable:noninteractive-batch' "${boundary_log}" >/dev/null
rg 'AFTER_COMMAND_STATE:idle' "${boundary_log}" >/dev/null
echo "minibuffer asyncify entrypoint plan validation passed"
