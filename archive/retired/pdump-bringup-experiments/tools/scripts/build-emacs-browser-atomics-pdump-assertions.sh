#!/usr/bin/env bash
# Build emacs-browser-atomics-pdump-assertions: same as pdump profile but with -sASSERTIONS=1.
# Purpose: get detailed abort messages from "Aborted(). Build with -sASSERTIONS for more info."
# Output: build/artifacts/emacs-browser-atomics-pdump-assertions/
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pdump_src="${repo_root}/build/emacs-pdump-configure-probe/src"
build_dir="${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump"
out_dir="${repo_root}/build/artifacts/emacs-browser-atomics-pdump-assertions"
atomics_host_library="${repo_root}/tools/scripts/wasmacs-atomics-host-library.js"
emmake_bin="${EMMAKE:-emmake}"
emacs_wasm_cflags="${EMACS_WASM_CFLAGS:--g3 -O0}"
emacs_wasm_linkflags="${EMACS_WASM_LINKFLAGS:-${emacs_wasm_cflags}}"
initial_memory="${WASMACS_ATOMICS_PDUMP_INITIAL_MEMORY:-536870912}"
wasmacs_wasm_stack_size="${WASMACS_ATOMICS_PDUMP_STACK_SIZE:-67108864}"

if ! command -v "${emmake_bin}" >/dev/null 2>&1; then
  echo "error: ${emmake_bin} not found" >&2; exit 127
fi

if [ ! -f "${build_dir}/src/Makefile" ]; then
  echo "error: pdump build tree missing; run src/build/probe-emacs-pdump-configure.sh first" >&2
  exit 1
fi

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
base_exports="${base_exports},_wasmacs_os_begin_command,_wasmacs_os_finish_command,_wasmacs_os_cancel_command,_wasmacs_os_configure_dired_without_ls,_wasmacs_os_dired_without_ls_probe,_wasmacs_os_filesystem_dired_state,_wasmacs_os_network_fetch_json,_wasmacs_os_url_fetch_loader_state"
base_exports="${base_exports},_wasmacs_input_text,_wasmacs_input_cancel,_wasmacs_os_timing_checkpoint"

# Key difference: -sASSERTIONS=1 for detailed abort info
assertions_ldflags="${emacs_wasm_linkflags} \
  -sEXIT_RUNTIME=0 \
  -sASSERTIONS=1 \
  -sEXPORTED_FUNCTIONS=${base_exports} \
  -sEXPORTED_RUNTIME_METHODS=callMain,ccall,FS,FS_createPath,FS_createDataFile,FS_readFile \
  -sSTACK_SIZE=${wasmacs_wasm_stack_size} \
  -sSTACK_OVERFLOW_CHECK=2 \
  -sINITIAL_MEMORY=${initial_memory} \
  -sALLOW_MEMORY_GROWTH=1 \
  --js-library ${atomics_host_library} \
  --preload-file ${pdump_src}/lisp@/usr/local/share/emacs/30.2/lisp \
  --preload-file ${pdump_src}/etc@/usr/local/share/emacs/30.2/etc"

echo "=== Applying OS compat patches (Atomics waitpoint) ==="
WASMACS_SPIKE_SRC="${pdump_src}" \
WASMACS_ENABLE_ASYNCIFY_WAITPOINT=1 \
WASMACS_ASYNCIFY_WAITPOINT_MODE="os-compat" \
  "${repo_root}/tools/scripts/patch-emacs-host-entrypoint-spike.sh"

SYSDEP="${pdump_src}/src/sysdep.c"
if ! grep -q "wasmacs_host_scheduler_checkpoint (int code)" "${SYSDEP}"; then
  perl -0pi -e 's|(extern void wasmacs_os_timing_checkpoint \(int code\);\nextern void wasmacs_os_timing_checkpoint \(int code\);\n\n/\* Read from FD)|/* wasmacs atomics host symbols. */\nextern int wasmacs_host_wait_for_input (void);\nextern int wasmacs_host_terminal_input_available (void);\nextern int wasmacs_host_terminal_read_byte (void);\nextern int wasmacs_host_is_tty_fd (int fd);\nextern int wasmacs_host_scheduler_checkpoint (int code);\n$1|' "${SYSDEP}"
  echo "  fixed: added wasmacs_host_* externs to sysdep.c"
fi

echo "=== Building pdumper+Atomics+ASSERTIONS profile ==="
(
  cd "${build_dir}"
  printf '{"type":"commonjs"}\n' > src/package.json
  rm -f src/temacs src/temacs.wasm src/temacs.data

  "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" \
    -C src \
    CFLAGS="${emacs_wasm_cflags}" \
    LDFLAGS="${assertions_ldflags}" \
    temacs
) 2>&1 | grep -v "^make\[" | tail -10

echo "=== Packaging ==="
mkdir -p "${out_dir}"
printf '{"type":"commonjs"}\n' > "${out_dir}/package.json"
cp "${build_dir}/src/temacs"       "${out_dir}/temacs"
cp "${build_dir}/src/temacs.wasm"  "${out_dir}/temacs.wasm"
cp "${build_dir}/src/temacs.data"  "${out_dir}/temacs.data"

echo "=== Artifacts ==="
ls -lh "${out_dir}/"
echo "ARTIFACT:${out_dir}"
echo "Boot: callMain([\"--dump-file=/bootstrap-emacs.pdmp\",\"--quick\",\"--no-splash\",\"--nw\"])"
