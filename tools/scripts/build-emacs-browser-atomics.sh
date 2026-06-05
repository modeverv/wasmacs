#!/usr/bin/env bash
# build-emacs-browser-atomics.sh
#
# Build Emacs wasm using SharedArrayBuffer + Atomics.wait instead of Asyncify.
#
# Key differences from asyncify-spike:
#   - No -sASYNCIFY: wasm runs synchronously
#   - wasmacs_host_wait_for_input uses Atomics.wait (true blocking)
#   - No JS wrapper frames on every function call
#   - eval_sub, set_internal etc. don't need ASYNCIFY_REMOVE
#   - Requires COOP/COEP headers (or coi-serviceworker)
#
# Build time: ~same as asyncify (just relinking)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
build_dir="${repo_root}/build/emacs-core-spike/build-gnu-host-internal-termcap"
source_copy="${repo_root}/build/emacs-core-spike/src"
out_dir="${repo_root}/build/artifacts/emacs-browser-atomics"
atomics_host_library="${repo_root}/tools/scripts/wasmacs-atomics-host-library.js"
emmake_bin="${EMMAKE:-emmake}"
emacs_wasm_cflags="${EMACS_WASM_CFLAGS:--O2}"

base_exports="_main,_malloc,_free,_wasmacs_eval_string,_wasmacs_garbage_collect,_wasmacs_pin_specpdl_backtrace_args,_wasmacs_scrub_specpdl_backtrace_args,_wasmacs_last_result,_wasmacs_entrypoint_state,_wasmacs_minibuffer_state,_wasmacs_command_state,_wasmacs_command_begin_minibuffer_probe,_wasmacs_command_begin_minibuffer_force_probe,_wasmacs_os_lifecycle_phase,_wasmacs_os_lifecycle_state,_wasmacs_os_root_state_snapshot,_wasmacs_os_stack_bounds_probe,_wasmacs_os_gc_permission,_wasmacs_os_gc_permission_state,_wasmacs_os_root_safety_probe,_wasmacs_os_pending_command_state,_wasmacs_os_pin_backtrace_args,_wasmacs_os_release_backtrace_args,_wasmacs_os_push_gc_guard,_wasmacs_os_pop_gc_guard,_wasmacs_os_begin_command,_wasmacs_os_finish_command,_wasmacs_os_cancel_command,_wasmacs_os_configure_dired_without_ls,_wasmacs_os_dired_without_ls_probe,_wasmacs_os_filesystem_dired_state,_wasmacs_input_text,_wasmacs_input_cancel"

# No Asyncify flags — wasm runs synchronously, Atomics.wait for blocking
emacs_atomics_ldflags="${EMACS_ATOMICS_LDFLAGS:--sEXIT_RUNTIME=0 \
  -sEXPORTED_FUNCTIONS=${base_exports} \
  -sEXPORTED_RUNTIME_METHODS=callMain,ccall,FS,FS_createPath,FS_createDataFile,FS_readFile \
  -sSTACK_SIZE=16777216 \
  -sSTACK_OVERFLOW_CHECK=2 \
  -sINITIAL_MEMORY=268435456 \
  -sALLOW_MEMORY_GROWTH=1 \
  --js-library ${atomics_host_library} \
  --preload-file ${source_copy}/lisp@/usr/local/share/emacs/30.2/lisp \
  --preload-file ${source_copy}/etc@/usr/local/share/emacs/30.2/etc}"

if ! command -v "${emmake_bin}" >/dev/null 2>&1; then
  echo "error: ${emmake_bin} not found" >&2; exit 127
fi

if [ ! -f "${build_dir}/src/Makefile" ] || [ ! -d "${source_copy}/lisp" ]; then
  "${repo_root}/tools/scripts/build-emacs-core-spike.sh"
fi

# Apply host entrypoint + os-compat patches (no sysdep.c emfile_read intercept;
# bytes flow through emscripten TTY → tty_read_avail_input → emfile_read chain)
WASMACS_ENABLE_ASYNCIFY_WAITPOINT=1 \
WASMACS_ASYNCIFY_WAITPOINT_MODE="os-compat" \
  "${repo_root}/tools/scripts/patch-emacs-host-entrypoint-spike.sh"

echo "=== Building atomics profile (no Asyncify, Atomics.wait blocking) ==="
(
  cd "${build_dir}"
  rm -f src/temacs src/temacs.wasm src/temacs.data
  "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" \
    -C src \
    CFLAGS="${emacs_wasm_cflags}" \
    LDFLAGS="${emacs_atomics_ldflags}" \
    temacs
)

mkdir -p "${out_dir}"
printf '{"type":"commonjs"}\n' > "${out_dir}/package.json"
cp "${build_dir}/src/temacs"      "${out_dir}/temacs"
cp "${build_dir}/src/temacs.wasm" "${out_dir}/temacs.wasm"
cp "${build_dir}/src/temacs.data" "${out_dir}/temacs.data"

echo "=== STATUS ==="
ls -lh "${out_dir}/"
echo "ARTIFACT:${out_dir}"
echo "Boot: callMain([\"--quick\",\"--no-splash\",\"--nw\"]) — synchronous, blocks on Atomics.wait"
