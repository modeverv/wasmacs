#!/usr/bin/env bash
# Build the interactive browser runtime:
#   - no pdumper bootstrap (cold-load the release system Lisp tree)
#   - Asyncify (wasmacs_host_wait_for_input at read_char in keyboard.c)
#   - fixed wasm linear memory, 512MB by default
#   - all wasmacs_os_* kernel + wasmacs_input_text key injection
#
# Boot sequence in browser worker:
#   callMain(["--quick", "--no-splash", "--nw"])
#   → Emacs interactive command loop
#   → read_char blocks → Asyncify suspend → JS "emacs-waiting" message
#   → keydown → wasmacs_input_text(bytes) + resolve wait
#   → Emacs processes key → loops back
#
# This is the thin-JS-layer architecture:
#   user → keydown → browser → thin JS → keyboard.c → OS compat → Emacs
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Source tree: pdump configure probe (already has all C patches)
pdump_src="${repo_root}/build/emacs-pdump-configure-probe/src"
build_dir="${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump"
out_dir="${repo_root}/artifacts/emacs-browser-interactive"
asyncify_lib="${repo_root}/scripts/wasmacs-asyncify-host-library.js"
native_baseline="${repo_root}/build/native-emacs-30.2/src"
emmake_bin="${EMMAKE:-emmake}"
emacs_wasm_cflags="${EMACS_WASM_CFLAGS:--O2}"
waitpoint_mode="${WASMACS_ASYNCIFY_WAITPOINT_MODE:-read-char}"
initial_memory="${WASMACS_INTERACTIVE_INITIAL_MEMORY:-536870912}"
allow_memory_growth="${WASMACS_INTERACTIVE_ALLOW_MEMORY_GROWTH:-0}"

if ! command -v "${emmake_bin}" >/dev/null 2>&1; then
  echo "error: ${emmake_bin} not found" >&2; exit 127
fi

if [ ! -f "${build_dir}/src/Makefile" ]; then
  echo "error: pdump build tree missing; run scripts/probe-emacs-pdump-temacs-build.sh first" >&2
  exit 1
fi

base_exports="_main"
base_exports="${base_exports},_wasmacs_eval_string,_wasmacs_garbage_collect,_wasmacs_last_result"
base_exports="${base_exports},_wasmacs_entrypoint_state,_wasmacs_command_state,_wasmacs_minibuffer_state,_wasmacs_interactive_state"
base_exports="${base_exports},_wasmacs_command_begin_bare_recursive_edit_probe"
base_exports="${base_exports},_wasmacs_os_lifecycle_phase,_wasmacs_os_lifecycle_state"
base_exports="${base_exports},_wasmacs_os_root_state_snapshot,_wasmacs_os_stack_bounds_probe"
base_exports="${base_exports},_wasmacs_os_gc_permission,_wasmacs_os_gc_permission_state,_wasmacs_os_root_safety_probe"
base_exports="${base_exports},_wasmacs_os_pending_command_state"
base_exports="${base_exports},_wasmacs_os_pin_backtrace_args,_wasmacs_os_release_backtrace_args"
base_exports="${base_exports},_wasmacs_os_push_gc_guard,_wasmacs_os_pop_gc_guard"
base_exports="${base_exports},_wasmacs_os_begin_command,_wasmacs_os_finish_command,_wasmacs_os_cancel_command"
base_exports="${base_exports},_wasmacs_input_text,_wasmacs_input_cancel"

emacs_interactive_ldflags="-sEXIT_RUNTIME=0 \
  -sASYNCIFY=1 \
  -sASYNCIFY_IMPORTS=wasmacs_host_wait_for_input \
  -sASYNCIFY_STACK_SIZE=4194304 \
  -sEXPORTED_FUNCTIONS=${base_exports} \
  -sEXPORTED_RUNTIME_METHODS=callMain,ccall,FS,FS_createPath,FS_createDataFile,FS_readFile,ENV \
  -sSTACK_SIZE=16777216 \
  -sSTACK_OVERFLOW_CHECK=0 \
  -sINITIAL_MEMORY=${initial_memory} \
  -sALLOW_MEMORY_GROWTH=${allow_memory_growth} \
  --js-library ${asyncify_lib} \
  --preload-file ${native_baseline}/lisp@/usr/local/share/emacs/30.2/lisp \
  --preload-file ${pdump_src}/etc@/usr/local/share/emacs/30.2/etc"

echo "=== Applying OS compat + read-char Asyncify waitpoint patches ==="
WASMACS_SPIKE_SRC="${pdump_src}" \
WASMACS_ENABLE_ASYNCIFY_WAITPOINT=1 \
WASMACS_ASYNCIFY_WAITPOINT_MODE="${waitpoint_mode}" \
  "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh"

echo "=== Building interactive profile (cold Lisp tree + Asyncify, initial memory ${initial_memory}, growth ${allow_memory_growth}) ==="
(
  cd "${build_dir}"
  printf '{"type":"commonjs"}\n' > src/package.json
  rm -f src/temacs src/temacs.tmp src/temacs.wasm src/temacs.data

  {
    "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" \
      -C src \
      CFLAGS="${emacs_wasm_cflags}" \
      LDFLAGS="${emacs_interactive_ldflags}" \
      temacs
  } || {
    if [ -f src/temacs.tmp ] && [ -f src/temacs.wasm ]; then
      "${native_baseline}/lib-src/make-fingerprint" src/temacs.wasm
      mv src/temacs.tmp src/temacs
    else
      echo "error: build failed" >&2; exit 1
    fi
  }
) 2>&1 | grep -v "^make\[" | tail -10

mkdir -p "${out_dir}"
printf '{"type":"commonjs"}\n' > "${out_dir}/package.json"
cp "${build_dir}/src/temacs"       "${out_dir}/temacs"
cp "${build_dir}/src/temacs.wasm"  "${out_dir}/temacs.wasm"
cp "${build_dir}/src/temacs.data"  "${out_dir}/temacs.data"

echo "=== STATUS ==="
ls -lh "${out_dir}/"
echo "ARTIFACT:${out_dir}"
echo "To boot: callMain([\"--quick\", \"--no-splash\", \"--nw\"])"
