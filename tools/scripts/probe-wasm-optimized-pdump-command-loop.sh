#!/usr/bin/env bash
# Probe: -O2 wasm + pdump → can Emacs reach the Atomics command loop?
#
# Three stages:
#   1. Build temacs with -O2 using the existing configured pdump build tree.
#   2. Generate bootstrap-emacs.pdmp with the -O2 binary (requires cold loadup).
#      Prior optimization matrix (M260607b) used --with-pdumper=no and --with-dumping=none
#      and found all -Ox levels fail at early subr.el.  This probe uses the pdump
#      build tree with --with-dumping=portable, which is a different configuration
#      not covered by the prior matrix.
#   3. If pdump is generated, boot with --dump-file and test the Atomics command loop.
#
# Usage:
#   tools/scripts/probe-wasm-optimized-pdump-command-loop.sh
#   WASMACS_OPTIMIZED_PDUMP_CFLAGS="-O1 -g0" tools/scripts/probe-wasm-optimized-pdump-command-loop.sh
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
build_dir="${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump"
pdump_src="${repo_root}/build/emacs-pdump-configure-probe/src"
atomics_host_library="${repo_root}/tools/scripts/wasmacs-atomics-host-library.js"
emmake_bin="${EMMAKE:-emmake}"

cflags="${WASMACS_OPTIMIZED_PDUMP_CFLAGS:--O2 -g0}"
cflags_slug="$(printf '%s' "${cflags}" | tr -cs 'A-Za-z0-9' '-' | sed 's/^-//;s/-$//')"
out_dir="${repo_root}/build/artifacts/emacs-browser-atomics-pdump-${cflags_slug}"
pdmp_path="${out_dir}/bootstrap-emacs.pdmp"
log_file="${repo_root}/logs/wasm-optimized-pdump-command-loop-${cflags_slug}.txt"
initial_memory="${WASMACS_ATOMICS_PDUMP_INITIAL_MEMORY:-536870912}"
wasm_stack_size="${WASMACS_ATOMICS_PDUMP_STACK_SIZE:-67108864}"

if ! command -v "${emmake_bin}" >/dev/null 2>&1; then
  echo "error: ${emmake_bin} not found; activate Emscripten first" >&2; exit 127
fi
if [ ! -f "${build_dir}/src/Makefile" ]; then
  echo "error: pdump build tree missing; run src/build/probe-emacs-pdump-configure.sh first" >&2
  exit 1
fi

mkdir -p "${out_dir}" "${repo_root}/logs"
rm -f "${log_file}"
rm -f "${build_dir}/src/pdmp-probe-stubs.o"

base_exports="_main,_malloc,_free"
base_exports="${base_exports},_wasmacs_eval_string,_wasmacs_garbage_collect"
base_exports="${base_exports},_wasmacs_pin_specpdl_backtrace_args,_wasmacs_scrub_specpdl_backtrace_args"
base_exports="${base_exports},_wasmacs_last_result,_wasmacs_entrypoint_state,_wasmacs_minibuffer_state"
base_exports="${base_exports},_wasmacs_command_state,_wasmacs_interactive_state"
base_exports="${base_exports},_wasmacs_os_lifecycle_phase,_wasmacs_os_lifecycle_state"
base_exports="${base_exports},_wasmacs_os_root_state_snapshot,_wasmacs_os_stack_bounds_probe"
base_exports="${base_exports},_wasmacs_os_gc_permission,_wasmacs_os_gc_permission_state"
base_exports="${base_exports},_wasmacs_os_root_safety_probe,_wasmacs_os_pending_command_state"
base_exports="${base_exports},_wasmacs_os_pin_backtrace_args,_wasmacs_os_release_backtrace_args"
base_exports="${base_exports},_wasmacs_os_push_gc_guard,_wasmacs_os_pop_gc_guard"
base_exports="${base_exports},_wasmacs_os_begin_command,_wasmacs_os_finish_command,_wasmacs_os_cancel_command"
base_exports="${base_exports},_wasmacs_os_configure_dired_without_ls,_wasmacs_os_dired_without_ls_probe"
base_exports="${base_exports},_wasmacs_os_filesystem_dired_state,_wasmacs_os_network_fetch_json,_wasmacs_os_url_fetch_loader_state"
base_exports="${base_exports},_wasmacs_input_text,_wasmacs_input_cancel,_wasmacs_os_timing_checkpoint"

linkflags="${cflags} \
  -sEXIT_RUNTIME=0 \
  -sEXPORTED_FUNCTIONS=${base_exports} \
  -sEXPORTED_RUNTIME_METHODS=callMain,ccall,FS,FS_createPath,FS_createDataFile,FS_readFile \
  -sSTACK_SIZE=${wasm_stack_size} \
  -sSTACK_OVERFLOW_CHECK=2 \
  -sINITIAL_MEMORY=${initial_memory} \
  -sALLOW_MEMORY_GROWTH=1 \
  --js-library ${atomics_host_library} \
  --preload-file ${pdump_src}/lisp@/usr/local/share/emacs/30.2/lisp \
  --preload-file ${pdump_src}/etc@/usr/local/share/emacs/30.2/etc"

{
  echo "# wasm optimized pdump command loop probe"
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "cflags: ${cflags}"
  echo "build-tree: build/emacs-pdump-configure-probe (--with-dumping=portable)"
  echo "out_dir: ${out_dir}"
  echo
} | tee "${log_file}"

# ── Stage 1: Ensure OS compat patches applied ────────────────────────────────
echo "=== Stage 1a: OS compat patches ===" | tee -a "${log_file}"
WASMACS_SPIKE_SRC="${pdump_src}" \
WASMACS_ENABLE_ASYNCIFY_WAITPOINT=1 \
WASMACS_ASYNCIFY_WAITPOINT_MODE="os-compat" \
  "${repo_root}/tools/scripts/patch-emacs-host-entrypoint-spike.sh" 2>&1 | tee -a "${log_file}"

SYSDEP="${pdump_src}/src/sysdep.c"
if ! grep -q "wasmacs_host_scheduler_checkpoint (int code)" "${SYSDEP}"; then
  perl -0pi -e 's|(extern void wasmacs_os_timing_checkpoint \(int code\);\nextern void wasmacs_os_timing_checkpoint \(int code\);\n\n/\* Read from FD)|/* wasmacs atomics host symbols. */\nextern int wasmacs_host_wait_for_input (void);\nextern int wasmacs_host_terminal_input_available (void);\nextern int wasmacs_host_terminal_read_byte (void);\nextern int wasmacs_host_is_tty_fd (int fd);\nextern int wasmacs_host_scheduler_checkpoint (int code);\n$1|' "${SYSDEP}"
  echo "  fixed: added wasmacs_host_* externs to sysdep.c" | tee -a "${log_file}"
fi

# ── Stage 1b: Build ──────────────────────────────────────────────────────────
echo "=== Stage 1b: build with ${cflags} ===" | tee -a "${log_file}"

# The native make-fingerprint binary cannot scan JS/wasm Emscripten output.
# Replace it with a no-op script. Since pdump generation and loading both use
# the same binary, the placeholder fingerprint values match naturally.
noop_fp="${build_dir}/lib-src/make-fingerprint"
if [ -f "${noop_fp}" ] && ! grep -q "wasmacs-noop-fingerprint" "${noop_fp}" 2>/dev/null; then
  printf '#!/bin/sh\n# wasmacs-noop-fingerprint: skip for wasm builds\nexit 0\n' > "${noop_fp}"
  chmod +x "${noop_fp}"
  echo "  replaced lib-src/make-fingerprint with no-op" | tee -a "${log_file}"
fi

(
  cd "${build_dir}"
  printf '{"type":"commonjs"}\n' > src/package.json
  rm -f src/temacs src/temacs.wasm src/temacs.data
  "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" \
    -C src \
    CFLAGS="${cflags}" \
    LDFLAGS="${linkflags}" \
    temacs
) 2>&1 | tee -a "${log_file}"

printf '{"type":"commonjs"}\n' > "${out_dir}/package.json"
cp "${build_dir}/src/temacs"      "${out_dir}/temacs"
cp "${build_dir}/src/temacs.wasm" "${out_dir}/temacs.wasm"
cp "${build_dir}/src/temacs.data" "${out_dir}/temacs.data"
echo "build: PASS" | tee -a "${log_file}"
ls -lh "${out_dir}/" | tee -a "${log_file}"

# ── Stage 2: Generate pdump ──────────────────────────────────────────────────
echo "" | tee -a "${log_file}"
echo "=== Stage 2: generate pdump with ${cflags} binary ===" | tee -a "${log_file}"
echo "(note: prior matrix used --with-pdumper=no; this build has --with-dumping=portable)" | tee -a "${log_file}"

pdump_exit=0
node --stack-size=65500 \
  "${repo_root}/tools/scripts/generate-browser-runtime-pdump.mjs" \
  "${out_dir}" "${pdmp_path}" \
  2>&1 | tee -a "${log_file}" || pdump_exit=$?

if [ "${pdump_exit}" -ne 0 ]; then
  echo "" | tee -a "${log_file}"
  echo "=== Stage 2: FAIL (exit ${pdump_exit}) ===" | tee -a "${log_file}"
  echo "cold loadup failed under ${cflags}" | tee -a "${log_file}"
  echo "RESULT:pdump-generation-failed:exit-${pdump_exit}" | tee -a "${log_file}"
  echo "ARTIFACT:${out_dir}"
  echo "LOG:${log_file}"
  exit 0
fi

echo "" | tee -a "${log_file}"
echo "=== Stage 2: PASS — pdump generated ===" | tee -a "${log_file}"
ls -lh "${pdmp_path}" | tee -a "${log_file}"

# ── Stage 3: Atomics command loop boot ──────────────────────────────────────
echo "" | tee -a "${log_file}"
echo "=== Stage 3: Atomics command loop boot with ${cflags} pdump ===" | tee -a "${log_file}"

WASMACS_ARTIFACT_DIR="${out_dir}" \
  node --stack-size=65500 \
  "${repo_root}/tools/scripts/probe-wasm-optimized-pdump-boot.mjs" \
  2>&1 | tee -a "${log_file}"

echo "ARTIFACT:${out_dir}"
echo "LOG:${log_file}"
