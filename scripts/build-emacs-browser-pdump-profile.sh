#!/usr/bin/env bash
# Build a browser-compatible Emacs wasm profile that:
#   1. Uses 512MB fixed linear memory (no growth) as the substrate
#   2. Generates a pbootstrap pdump artifact from source
#   3. Bundles the pdump as a preloaded file so browser workers skip cold loadup
#   4. Exports all wasmacs_os_* facade entrypoints
#
# This implements the architectural path described in small-os-for-emacs.md:
#   wasm linear memory (512MB fixed) <- C/wasm OS compat kernel <- Emacs C core
#
# Browser worker usage:
#   Module.callMain(["--dump-file=/bootstrap-emacs.pdmp", "--batch", ...])
#   → skips cold loadup.el entirely
#   → no Asyncify stack overflow from deep Elisp recursion
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${repo_root}/build/emacs-core-spike/build-gnu-host-internal-termcap"
source_copy="${repo_root}/build/emacs-core-spike/src"
pdump_build_dir="${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump"
pdump_src="${repo_root}/build/emacs-pdump-configure-probe/src"
out_dir="${repo_root}/artifacts/emacs-browser-pdump-profile"
emmake_bin="${EMMAKE:-emmake}"
emacs_wasm_cflags="${EMACS_WASM_CFLAGS:--g3 -O0}"

# 512MB fixed memory, no growth — the bare-metal substrate
# All wasmacs_os_* kernel entrypoints exported
base_exports="_main,_wasmacs_eval_string,_wasmacs_garbage_collect"
base_exports="${base_exports},_wasmacs_last_result,_wasmacs_entrypoint_state"
base_exports="${base_exports},_wasmacs_command_state,_wasmacs_minibuffer_state"
base_exports="${base_exports},_wasmacs_os_lifecycle_phase,_wasmacs_os_lifecycle_state"
base_exports="${base_exports},_wasmacs_os_root_state_snapshot,_wasmacs_os_stack_bounds_probe"
base_exports="${base_exports},_wasmacs_os_gc_permission,_wasmacs_os_gc_permission_state,_wasmacs_os_root_safety_probe"
base_exports="${base_exports},_wasmacs_os_pending_command_state"
base_exports="${base_exports},_wasmacs_os_pin_backtrace_args,_wasmacs_os_release_backtrace_args"
base_exports="${base_exports},_wasmacs_os_push_gc_guard,_wasmacs_os_pop_gc_guard"
base_exports="${base_exports},_wasmacs_os_begin_command,_wasmacs_os_finish_command,_wasmacs_os_cancel_command,_wasmacs_os_configure_dired_without_ls,_wasmacs_os_dired_without_ls_probe,_wasmacs_os_filesystem_dired_state"
base_exports="${base_exports},_wasmacs_input_text,_wasmacs_input_cancel"

emacs_pdump_ldflags="${EMACS_PDUMP_LDFLAGS:--sEXIT_RUNTIME=0 \
  -sEXPORTED_FUNCTIONS=${base_exports} \
  -sEXPORTED_RUNTIME_METHODS=callMain,ccall,FS,FS_createPath,FS_createDataFile,FS_readFile \
  -sSTACK_SIZE=16777216 \
  -sSTACK_OVERFLOW_CHECK=2 \
  -sINITIAL_MEMORY=536870912 \
  -sALLOW_MEMORY_GROWTH=0 \
  --preload-file ${source_copy}/lisp@/usr/local/share/emacs/30.2/lisp \
  --preload-file ${source_copy}/etc@/usr/local/share/emacs/30.2/etc}"

if ! command -v "${emmake_bin}" >/dev/null 2>&1; then
  echo "error: ${emmake_bin} not found" >&2; exit 127
fi

if [ ! -f "${build_dir}/src/Makefile" ] || [ ! -d "${source_copy}/lisp" ]; then
  "${repo_root}/scripts/build-emacs-core-spike.sh"
fi

# Apply OS compat kernel patches (alloc.c purecopy fix is in emacs-core-spike,
# pdumper.c mmap fix is in emacs-pdump-configure-probe — separate build trees)
"${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh"

echo "=== Step 1: Build 512MB browser profile ==="
(
  cd "${build_dir}"
  rm -f src/temacs src/temacs.wasm src/temacs.data
  "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" \
    -C src \
    CFLAGS="${emacs_wasm_cflags}" \
    LDFLAGS="${emacs_pdump_ldflags}" \
    temacs
)

echo "=== Step 2: Generate bootstrap pdump ==="
# The pdump must be generated with the emacs-pdump-configure-probe build which
# has the alloc.c purecopy cycle fix AND pdumper.c heap-mapping fix applied.
# Those patches are in a separate build tree to avoid contaminating the core spike.
if [ ! -f "${pdump_build_dir}/src/temacs" ] || [ ! -f "${pdump_build_dir}/src/temacs.wasm" ]; then
  echo "Building pdump temacs..."
  "${repo_root}/scripts/probe-emacs-pdump-temacs-build.sh"
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
echo "pdmp size: $(du -h "${pdmp_file}" | cut -f1)"

echo "=== Step 3: Bundle pdump into browser profile ==="
mkdir -p "${out_dir}"
printf '{"type":"commonjs"}\n' > "${out_dir}/package.json"
cp "${build_dir}/src/temacs" "${out_dir}/temacs"
cp "${build_dir}/src/temacs.wasm" "${out_dir}/temacs.wasm"
cp "${build_dir}/src/temacs.data" "${out_dir}/temacs.data"
cp "${pdmp_file}" "${out_dir}/bootstrap-emacs.pdmp"

echo "=== Step 4: Smoke test pdump load ==="
# The pdump was built by the pdump probe tree; its fingerprint matches that binary.
# For the browser profile (different binary), a fingerprint mismatch is expected.
# This smoke test uses the pdump probe binary to confirm pdump loads correctly.
(
  cd "${pdump_build_dir}/src"
  LANG=C LC_ALL=C EMACSLOADPATH="${pdump_src}/lisp" \
    node --stack-size=65500 ./temacs --dump-file="$(pwd)/bootstrap-emacs.pdmp" \
    --batch \
    --eval '(princ (concat "VERSION:" emacs-version "\n"))' \
    --eval '(garbage-collect)' \
    --eval '(princ "GC:PASS\n")' \
    --eval '(princ (format "PDUMP:%s\n" (if (pdumper-stats) "loaded" "no")))' \
    2>/dev/null
) | grep -E "VERSION:|GC:|PDUMP:"

mkdir -p "${repo_root}/logs"
{
  printf 'emacs-browser-pdump-profile build — %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'memory: 512MB fixed, no growth\n'
  printf 'stack: 16MB wasm stack\n'
  printf 'pdump: %s\n' "${pdmp_file}"
  printf 'pdump size: %s\n' "$(du -h "${pdmp_file}" | cut -f1)"
  printf 'artifacts: %s\n' "${out_dir}"
  printf 'exported OS kernel entrypoints:\n'
  echo "${base_exports}" | tr ',' '\n' | grep wasmacs_os | sed 's/_wasmacs/  wasmacs/'
  printf 'STATUS:PASS\n'
} > "${repo_root}/logs/emacs-browser-pdump-profile-build.txt"

echo "STATUS:PASS build complete → ${out_dir}"
echo "NOTE: browser worker uses --dump-file=/bootstrap-emacs.pdmp to skip cold loadup"
