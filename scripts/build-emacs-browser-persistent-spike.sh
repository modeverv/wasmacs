#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${repo_root}/build/emacs-core-spike/build-gnu-host-internal-termcap"
source_copy="${repo_root}/build/emacs-core-spike/src"
out_dir="${repo_root}/artifacts/emacs-browser-persistent-spike"
emmake_bin="${EMMAKE:-emmake}"
emacs_wasm_cflags="${EMACS_WASM_CFLAGS:--g3 -O0}"
emacs_persistent_ldflags="${EMACS_PERSISTENT_LDFLAGS:--sEXIT_RUNTIME=0 -sEXPORTED_FUNCTIONS=_main,_wasmacs_eval_string,_wasmacs_garbage_collect,_wasmacs_pin_specpdl_backtrace_args,_wasmacs_scrub_specpdl_backtrace_args,_wasmacs_last_result,_wasmacs_entrypoint_state,_wasmacs_minibuffer_state,_wasmacs_command_state,_wasmacs_command_begin_minibuffer_probe,_wasmacs_command_begin_minibuffer_force_probe,_wasmacs_os_lifecycle_phase,_wasmacs_os_root_state_snapshot,_wasmacs_os_gc_permission,_wasmacs_os_pending_command_state,_wasmacs_os_pin_backtrace_args -sEXPORTED_RUNTIME_METHODS=callMain,ccall,FS,FS_createPath,FS_createDataFile,FS_readFile -sSTACK_SIZE=1048576 -sSTACK_OVERFLOW_CHECK=2 -sINITIAL_MEMORY=268435456 -sALLOW_MEMORY_GROWTH=1 --preload-file ${source_copy}/lisp@/usr/local/share/emacs/30.2/lisp --preload-file ${source_copy}/etc@/usr/local/share/emacs/30.2/etc}"

if ! command -v "${emmake_bin}" >/dev/null 2>&1; then
  echo "error: ${emmake_bin} not found; install/activate Emscripten first" >&2
  exit 127
fi

if [ ! -f "${build_dir}/src/Makefile" ] || [ ! -d "${source_copy}/lisp" ]; then
  "${repo_root}/scripts/build-emacs-core-spike.sh"
fi

"${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh"

(
  cd "${build_dir}"
  rm -f src/temacs src/temacs.wasm src/temacs.data
  "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" \
    -C src \
    CFLAGS="${emacs_wasm_cflags}" \
    LDFLAGS="${emacs_persistent_ldflags}" \
    temacs
)

mkdir -p "${out_dir}"
printf '{"type":"commonjs"}\n' > "${out_dir}/package.json"
cp "${build_dir}/src/temacs" "${out_dir}/temacs"
cp "${build_dir}/src/temacs.wasm" "${out_dir}/temacs.wasm"
cp "${build_dir}/src/temacs.data" "${out_dir}/temacs.data"
