#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
doc="${repo_root}/docs/minibuffer-asyncify-entrypoint-plan.md"
build_script="${repo_root}/scripts/build-emacs-browser-asyncify-spike.sh"
patch_script="${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh"
host_library="${repo_root}/scripts/wasmacs-asyncify-host-library.js"
advise_summary_script="${repo_root}/scripts/summarize-asyncify-advise.mjs"
suspend_state_probe="${repo_root}/scripts/probe-browser-asyncify-minibuffer-suspend-state.mjs"
input_injection_probe="${repo_root}/scripts/probe-browser-asyncify-minibuffer-input-injection.mjs"
cancel_probe="${repo_root}/scripts/probe-browser-asyncify-minibuffer-cancel.mjs"
artifact_dir="${repo_root}/artifacts/emacs-browser-asyncify-spike"
log_path="${repo_root}/logs/wasm-browser-asyncify-batch.txt"
boundary_log="${repo_root}/logs/wasm-browser-asyncify-minibuffer-active-read-boundary.txt"
emscripten_settings="/opt/homebrew/Cellar/emscripten/5.0.7/libexec/src/settings.js"

test -f "${doc}"
test -x "${build_script}"
test -x "${patch_script}"
test -f "${host_library}"
test -f "${advise_summary_script}"
test -f "${suspend_state_probe}"
test -f "${input_injection_probe}"
test -f "${cancel_probe}"
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
rg -- '-sASYNCIFY_IMPORTS=wasmacs_host_wait_for_input' "${build_script}" >/dev/null
rg -- '-sASYNCIFY_STACK_SIZE=4194304' "${build_script}" >/dev/null
rg 'EMACS_ASYNCIFY_EXTRA_LDFLAGS' "${build_script}" >/dev/null
rg 'WASMACS_ASYNCIFY_WAITPOINT_MODE' "${build_script}" >/dev/null
rg 'ASYNCIFY_ADVISE' "${doc}" >/dev/null
rg 'summarize-asyncify-advise' "${doc}" >/dev/null
rg 'probe-browser-asyncify-minibuffer-suspend-state' "${doc}" >/dev/null
rg 'probe-browser-asyncify-minibuffer-input-injection' "${doc}" >/dev/null
rg 'probe-browser-asyncify-minibuffer-cancel' "${doc}" >/dev/null
rg -- '--js-library' "${build_script}" >/dev/null
rg '_wasmacs_eval_string' "${build_script}" >/dev/null
rg '_wasmacs_garbage_collect' "${build_script}" >/dev/null
rg '_wasmacs_entrypoint_state' "${build_script}" >/dev/null
rg '_wasmacs_minibuffer_state' "${build_script}" >/dev/null
rg '_wasmacs_command_state' "${build_script}" >/dev/null
rg '_wasmacs_os_lifecycle_phase' "${build_script}" >/dev/null
rg '_wasmacs_os_root_state_snapshot' "${build_script}" >/dev/null
rg '_wasmacs_os_gc_permission' "${build_script}" >/dev/null
rg '_wasmacs_os_pending_command_state' "${build_script}" >/dev/null
rg '_wasmacs_command_begin_minibuffer_probe' "${build_script}" >/dev/null
rg '_wasmacs_command_begin_minibuffer_force_probe' "${build_script}" >/dev/null
rg '_wasmacs_input_text' "${build_script}" >/dev/null
rg '_wasmacs_input_cancel' "${build_script}" >/dev/null
rg 'WASMACS_ENABLE_ASYNCIFY_WAITPOINT=1' "${build_script}" >/dev/null
rg 'wasmacs_host_wait_for_input' "${patch_script}" >/dev/null
rg 'wasmacs_input_text' "${patch_script}" >/dev/null
rg 'wasmacs_input_cancel' "${patch_script}" >/dev/null
rg 'kbd_buffer_store_event' "${patch_script}" >/dev/null
rg 'read_decoded_event_from_main_queue' "${patch_script}" >/dev/null
rg 'recursive_edit_1' "${patch_script}" >/dev/null
rg 'minibuf-setup' "${patch_script}" >/dev/null
rg 'minibuf_level > 0' "${patch_script}" >/dev/null
rg 'WASMACS_ENABLE_ASYNCIFY_WAITPOINT' "${patch_script}" >/dev/null
rg 'wasmacs_host_wait_for_input' "${host_library}" >/dev/null
rg 'ENV.TERM' "${host_library}" >/dev/null
rg 'ENV.HOME' "${host_library}" >/dev/null
rg 'ENV.TERMCAP' "${host_library}" >/dev/null
rg '__wasmacsHostWaitForInputCount' "${host_library}" >/dev/null
rg '__wasmacsHostWaitForInputPending' "${host_library}" >/dev/null
rg '__wasmacsResolveHostInputWait' "${host_library}" >/dev/null
rg 'WASMACS_HOST_WAIT_FOR_INPUT' "${host_library}" >/dev/null

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
rg 'wasmacs_host_wait_for_input' "${artifact_dir}/temacs" >/dev/null
rg "ENV.TERM = ENV.TERM \\|\\| 'dumb'" "${artifact_dir}/temacs" >/dev/null
rg "ENV.TERMCAP = ENV.TERMCAP" "${artifact_dir}/temacs" >/dev/null
rg '__wasmacsHostWaitForInputCount' "${artifact_dir}/temacs" >/dev/null
rg '__wasmacsHostWaitForInputPending' "${artifact_dir}/temacs" >/dev/null
rg '__wasmacsResolveHostInputWait' "${artifact_dir}/temacs" >/dev/null
rg "Module\\['callMain'\\] = callMain" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['ccall'\\] = ccall" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_eval_string'\\].*wasmacs_eval_string" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_garbage_collect'\\].*wasmacs_garbage_collect" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_last_result'\\].*wasmacs_last_result" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_entrypoint_state'\\].*wasmacs_entrypoint_state" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_minibuffer_state'\\].*wasmacs_minibuffer_state" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_command_state'\\].*wasmacs_command_state" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_os_lifecycle_phase'\\].*wasmacs_os_lifecycle_phase" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_os_root_state_snapshot'\\].*wasmacs_os_root_state_snapshot" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_os_gc_permission'\\].*wasmacs_os_gc_permission" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_os_pending_command_state'\\].*wasmacs_os_pending_command_state" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_command_begin_minibuffer_probe'\\].*wasmacs_command_begin_minibuffer_probe" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_command_begin_minibuffer_force_probe'\\].*wasmacs_command_begin_minibuffer_force_probe" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_input_text'\\].*wasmacs_input_text" "${artifact_dir}/temacs" >/dev/null
rg "Module\\['_wasmacs_input_cancel'\\].*wasmacs_input_cancel" "${artifact_dir}/temacs" >/dev/null

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
