#!/usr/bin/env bash
# Build an interactive pdmp-enabled Asyncify TTY profile for Level 5-6.
#
# Difference from build-emacs-browser-interactive.sh:
#   - This profile bundles bootstrap-emacs.pdmp as a preloaded file
#   - Boot: callMain(["--dump-file=/bootstrap-emacs.pdmp","--quick","--no-splash","--nw"])
#   - Pdmp skip cold loadup → no JS call stack overflow
#   - Same Asyncify + handleAsync terminal path as interactive profile
#
# Matching set is separate from batch pdmp proof profile.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Source tree: pdump configure probe (has alloc.c/pdumper.c/loadup.el patches)
pdump_src="${repo_root}/build/emacs-pdump-configure-probe/src"
build_dir="${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump"
out_dir="${repo_root}/artifacts/emacs-browser-pdump-interactive"
asyncify_lib="${repo_root}/scripts/wasmacs-asyncify-host-library.js"
native_baseline="${repo_root}/build/native-emacs-30.2/src"
emmake_bin="${EMMAKE:-emmake}"
emacs_wasm_cflags="${EMACS_WASM_CFLAGS:--O2}"
initial_memory="${WASMACS_PDUMP_INTERACTIVE_INITIAL_MEMORY:-805306368}"
allow_memory_growth="${WASMACS_PDUMP_INTERACTIVE_ALLOW_MEMORY_GROWTH:-0}"

if ! command -v "${emmake_bin}" >/dev/null 2>&1; then
  echo "error: ${emmake_bin} not found" >&2; exit 127
fi

if [ ! -f "${build_dir}/src/Makefile" ]; then
  echo "error: pdump build tree missing; run scripts/probe-emacs-pdump-temacs-build.sh first" >&2
  exit 1
fi

# We need the same OS compat patches as the interactive profile,
# BUT we must NOT link the pdmp-probe-stubs.o. The real host library
# (wasmacs-asyncify-host-library.js) provides wasmacs_host_wait_for_input.
#
# If pdmp-probe-stubs.o exists in the build dir, remove it from link.
if [ -f "${build_dir}/src/pdmp-probe-stubs.o" ]; then
  echo "=== Removing pdmp-probe-stubs.o (will use real host library) ==="
  rm -f "${build_dir}/src/pdmp-probe-stubs.o"
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

emacs_pdump_interactive_ldflags="-sEXIT_RUNTIME=0 \
  -sASYNCIFY=1 \
  -sASYNCIFY_IMPORTS=wasmacs_host_wait_for_input \
  -sASYNCIFY_STACK_SIZE=4194304 \
  -sASYNCIFY_REMOVE=eval_sub \
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
WASMACS_ASYNCIFY_WAITPOINT_MODE="read-char" \
  "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh"

echo "=== Building interactive pdmp TTY profile (Asyncify, preloaded lisp, ${initial_memory} bytes) ==="
(
  cd "${build_dir}"
  printf '{"type":"commonjs"}\n' > src/package.json
  rm -f src/temacs src/temacs.tmp src/temacs.wasm src/temacs.data

  {
    "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" \
      -C src \
      CFLAGS="${emacs_wasm_cflags}" \
      LDFLAGS="${emacs_pdump_interactive_ldflags}" \
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

echo "=== Generating pdmp with interactive temacs ==="
(
  cd "${build_dir}/src"
  rm -f bootstrap-emacs.pdmp
  LANG=C LC_ALL=C \
  EMACSLOADPATH="${pdump_src}/lisp" \
    node --stack-size=65500 ./temacs --batch -l loadup --temacs=pbootstrap
)

pdmp_file="${build_dir}/src/bootstrap-emacs.pdmp"
if [ ! -f "${pdmp_file}" ]; then
  echo "error: bootstrap-emacs.pdmp was not generated" >&2; exit 1
fi
echo "pdmp size: $(du -h "${pdmp_file}" | cut -f1)"

echo "=== Packaging artifacts ==="
mkdir -p "${out_dir}"
printf '{"type":"commonjs"}\n' > "${out_dir}/package.json"
cp "${build_dir}/src/temacs"       "${out_dir}/temacs"
cp "${build_dir}/src/temacs.wasm"  "${out_dir}/temacs.wasm"
cp "${build_dir}/src/temacs.data"  "${out_dir}/temacs.data"
cp "${pdmp_file}"                  "${out_dir}/bootstrap-emacs.pdmp"

echo "=== Artifacts ==="
ls -lh "${out_dir}/"
echo "temacs.wasm sha256: $(sha256sum "${out_dir}/temacs.wasm" | cut -d' ' -f1)"
echo "bootstrap-emacs.pdmp sha256: $(sha256sum "${out_dir}/bootstrap-emacs.pdmp" | cut -d' ' -f1)"
echo "ARTIFACT:${out_dir}"
echo "To boot: callMain([\"--dump-file=/bootstrap-emacs.pdmp\",\"--quick\",\"--no-splash\",\"--nw\"])"
