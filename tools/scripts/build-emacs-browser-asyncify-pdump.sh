#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
build_dir="${repo_root}/build/emacs-core-spike/build-gnu-host-internal-termcap"
source_copy="${repo_root}/build/emacs-core-spike/src"
pdump_build_dir="${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump"
pdump_src="${repo_root}/build/emacs-pdump-configure-probe/src"
out_dir="${repo_root}/build/artifacts/emacs-browser-asyncify-pdump"
asyncify_host_library="${repo_root}/tools/scripts/wasmacs-asyncify-host-library.js"
emmake_bin="${EMMAKE:-emmake}"
emacs_wasm_cflags="${EMACS_WASM_CFLAGS:--g3 -O0}"

base_exports="_main,_wasmacs_eval_string,_wasmacs_garbage_collect,_wasmacs_last_result,_wasmacs_entrypoint_state,_wasmacs_command_state,_wasmacs_minibuffer_state,_wasmacs_os_lifecycle_phase,_wasmacs_os_lifecycle_state,_wasmacs_os_root_state_snapshot,_wasmacs_os_stack_bounds_probe,_wasmacs_os_gc_permission,_wasmacs_os_gc_permission_state,_wasmacs_os_root_safety_probe,_wasmacs_os_pending_command_state,_wasmacs_os_pin_backtrace_args,_wasmacs_os_release_backtrace_args,_wasmacs_os_push_gc_guard,_wasmacs_os_pop_gc_guard,_wasmacs_os_begin_command,_wasmacs_os_finish_command,_wasmacs_os_cancel_command,_wasmacs_os_configure_dired_without_ls,_wasmacs_os_dired_without_ls_probe,_wasmacs_os_filesystem_dired_state,_wasmacs_input_text,_wasmacs_input_cancel"

# 512MB fixed memory + Asyncify
# ASYNCIFY_IGNORE_INDIRECT=1: skip indirect call instrumentation to keep JS call stack shallow.
# With ASYNCIFY_IGNORE_INDIRECT=1, Emscripten's invoke_* (indirect call dispatchers) are
# NOT instrumented, but they CAN be called during Asyncify handleAsync execution
# (e.g. command_loop → invoke_jjij → ...). This causes the abort:
#   "import invoke_jjij was not in ASYNCIFY_IMPORTS, but changed the state"
# Fix: add the required invoke_* variants to ASYNCIFY_IMPORTS so Asyncify knows to
# handle them correctly even without full indirect instrumentation.
# Required variants (observed from abort messages during command_loop):
#   invoke_i, invoke_j, invoke_jj, invoke_jjij, invoke_ji, invoke_ij, invoke_v, invoke_vi, invoke_vii
emacs_asyncify_pdump_ldflags="${EMACS_ASYNCIFY_PDUMP_LDFLAGS:--sEXIT_RUNTIME=0 -sASYNCIFY=1 -sASYNCIFY_IGNORE_INDIRECT=1 -sASYNCIFY_IMPORTS=wasmacs_host_wait_for_input,invoke_i,invoke_j,invoke_jj,invoke_jjij,invoke_ji,invoke_ij,invoke_v,invoke_vi,invoke_vii,invoke_viii,invoke_iiii,invoke_iiiii -sASYNCIFY_STACK_SIZE=4194304 -sEXPORTED_FUNCTIONS=${base_exports} -sEXPORTED_RUNTIME_METHODS=callMain,ccall,FS,FS_createPath,FS_createDataFile,FS_readFile,ENV -sSTACK_SIZE=16777216 -sSTACK_OVERFLOW_CHECK=2 -sINITIAL_MEMORY=536870912 -sALLOW_MEMORY_GROWTH=0 --js-library ${asyncify_host_library} --preload-file ${source_copy}/lisp@/usr/local/share/emacs/30.2/lisp --preload-file ${source_copy}/etc@/usr/local/share/emacs/30.2/etc}"

if ! command -v "${emmake_bin}" >/dev/null 2>&1; then
  echo "error: ${emmake_bin} not found" >&2; exit 127
fi

if [ ! -f "${build_dir}/src/Makefile" ] || [ ! -d "${source_copy}/lisp" ]; then
  "${repo_root}/tools/scripts/build-emacs-core-spike.sh"
fi

WASMACS_ENABLE_ASYNCIFY_WAITPOINT=1 \
WASMACS_ASYNCIFY_WAITPOINT_MODE="read-char" \
  "${repo_root}/tools/scripts/patch-emacs-host-entrypoint-spike.sh"

echo "=== Step 1: Build Asyncify + 512MB fixed memory profile ==="
(
  cd "${build_dir}"
  rm -f src/temacs src/temacs.wasm src/temacs.data
  "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" \
    -C src \
    CFLAGS="${emacs_wasm_cflags}" \
    LDFLAGS="${emacs_asyncify_pdump_ldflags}" \
    temacs
)

echo "=== Step 2: Generate bootstrap pdump ==="
if [ ! -f "${pdump_build_dir}/src/temacs" ] || [ ! -f "${pdump_build_dir}/src/temacs.wasm" ]; then
  echo "Building pdump temacs..."
  "${repo_root}/tools/scripts/probe-emacs-pdump-temacs-build.sh"
fi

pdmp_file="${pdump_build_dir}/src/bootstrap-emacs.pdmp"
if [ ! -f "${pdmp_file}" ]; then
  echo "Generating bootstrap-emacs.pdmp..."
  (
    cd "${pdump_build_dir}/src"
    LANG=C LC_ALL=C EMACSLOADPATH="${pdump_src}/lisp" \
      node --stack-size=65500 ./temacs --batch -l loadup --temacs=pbootstrap
  )
fi

if [ ! -f "${pdmp_file}" ]; then
  echo "error: bootstrap-emacs.pdmp was not generated" >&2; exit 1
fi

echo "=== Step 3: Bundle ==="
mkdir -p "${out_dir}"
printf '{"type":"commonjs"}\n' > "${out_dir}/package.json"
cp "${build_dir}/src/temacs" "${out_dir}/temacs"
cp "${build_dir}/src/temacs.wasm" "${out_dir}/temacs.wasm"
cp "${build_dir}/src/temacs.data" "${out_dir}/temacs.data"
cp "${pdmp_file}" "${out_dir}/bootstrap-emacs.pdmp"

echo "STATUS:PASS build complete → ${out_dir}"
