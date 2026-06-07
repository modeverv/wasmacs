#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_ref="${repo_root}/vendor/emacs"
work_root="${repo_root}/build/emacs-browser-asyncify-spike"
build_dir="${work_root}/build-gnu-host-internal-termcap"
source_copy="${work_root}/src"
out_dir="${repo_root}/build/artifacts/emacs-browser-asyncify-spike"
asyncify_host_library="${repo_root}/tools/scripts/wasmacs-asyncify-host-library.js"
emconfigure_bin="${EMCONFIGURE:-emconfigure}"
emmake_bin="${EMMAKE:-emmake}"
emacs_wasm_host="${EMACS_WASM_HOST:-wasm32-unknown-linux-gnu}"
emacs_tputs_lib_cache="${EMACS_TPUTS_LIB_CACHE:-none required}"
native_baseline="${repo_root}/build/native-emacs-30.2/src"
emacs_wasm_cflags="${EMACS_WASM_CFLAGS:--g3 -O0}"
base_exports="_main,_wasmacs_eval_string,_wasmacs_garbage_collect,_wasmacs_pin_specpdl_backtrace_args,_wasmacs_scrub_specpdl_backtrace_args,_wasmacs_last_result,_wasmacs_entrypoint_state,_wasmacs_minibuffer_state,_wasmacs_command_state,_wasmacs_command_begin_minibuffer_probe,_wasmacs_command_begin_minibuffer_force_probe,_wasmacs_os_lifecycle_phase,_wasmacs_os_lifecycle_state,_wasmacs_os_root_state_snapshot,_wasmacs_os_stack_bounds_probe,_wasmacs_os_gc_permission,_wasmacs_os_gc_permission_state,_wasmacs_os_root_safety_probe,_wasmacs_os_pending_command_state,_wasmacs_os_pin_backtrace_args,_wasmacs_os_release_backtrace_args,_wasmacs_os_push_gc_guard,_wasmacs_os_pop_gc_guard,_wasmacs_os_begin_command,_wasmacs_os_finish_command,_wasmacs_os_cancel_command,_wasmacs_os_configure_dired_without_ls,_wasmacs_os_dired_without_ls_probe,_wasmacs_os_filesystem_dired_state,_wasmacs_os_network_fetch_json,_wasmacs_os_url_fetch_loader_state,_wasmacs_input_text,_wasmacs_input_cancel"
emacs_asyncify_extra_ldflags="${EMACS_ASYNCIFY_EXTRA_LDFLAGS:-}"
# Asyncify instrumentation minimization spike (2026-06-04):
#
# PROBLEM: full Asyncify instrumentation wraps eval_sub with JS frames.
# During loadup.el, eval_sub recurses ~1000+ levels → JS call stack overflow in
# browser Worker (~1-4MB). Node.js probes escape via --stack-size=65500 (65MB).
# Blocker: browser-worker-cold-loadup-js-stack-overflow
#
# SPIKE: ASYNCIFY_REMOVE=eval_sub
# Removes eval_sub from the Asyncify instrumented set.
# Rationale:
#   - During interactive wait (in read_char), eval_sub is NOT on the call stack.
#     The wait path is: command_loop_1 → read_key_sequence → read_char → emfile_read → wait
#   - During loadup, eval_sub recurses without async waits (file reads, not TTY).
#   - Removing eval_sub from async set: no JS wrapper frames on each recursive call
#     → loadup recursion stays in wasm-to-wasm calls → no JS stack overflow.
# Risk:
#   - If Lisp calls (read-char) interactively: eval_sub IS on stack during wait → CRASH
#   - For basic --quick --nw (no user init, no Lisp read-char): safe
# Previous attempts:
#   - ASYNCIFY_IGNORE_INDIRECT=1: breaks suspend/resume (indirect call chain to host wait)
#   - STACK_SIZE=16MB: addresses wasm linear stack, not JS call stack
emacs_asyncify_ldflags="${EMACS_ASYNCIFY_LDFLAGS:--sEXIT_RUNTIME=0 -sASYNCIFY=1 -sASYNCIFY_IMPORTS=wasmacs_host_wait_for_input -sASYNCIFY_STACK_SIZE=4194304 -sASYNCIFY_REMOVE=eval_sub,set_internal -sEXPORTED_FUNCTIONS=${base_exports} -sEXPORTED_RUNTIME_METHODS=callMain,ccall,FS,FS_createPath,FS_createDataFile,FS_readFile -sSTACK_SIZE=16777216 -sSTACK_OVERFLOW_CHECK=2 -sINITIAL_MEMORY=268435456 -sALLOW_MEMORY_GROWTH=1 --js-library ${asyncify_host_library} --preload-file ${source_copy}/lisp@/usr/local/share/emacs/30.2/lisp --preload-file ${source_copy}/etc@/usr/local/share/emacs/30.2/etc} ${emacs_asyncify_extra_ldflags}"
wasmacs_asyncify_waitpoint_mode="${WASMACS_ASYNCIFY_WAITPOINT_MODE:-read-char}"
force_recopy="${WASMACS_ASYNCIFY_FORCE_RECOPY:-0}"

if ! command -v "${emconfigure_bin}" >/dev/null 2>&1; then
  echo "error: ${emconfigure_bin} not found; install/activate Emscripten first" >&2
  exit 127
fi

if ! command -v "${emmake_bin}" >/dev/null 2>&1; then
  echo "error: ${emmake_bin} not found; install/activate Emscripten first" >&2
  exit 127
fi

if [ "${force_recopy}" = "1" ]; then
  rm -rf "${work_root}"
fi

mkdir -p "${work_root}"

if [ ! -d "${source_copy}/.git" ] && [ ! -f "${source_copy}/configure.ac" ]; then
  mkdir -p "${source_copy}"
  git -C "${source_ref}" archive HEAD | tar -x -C "${source_copy}"
fi

if [ ! -x "${source_copy}/configure" ]; then
  (
    cd "${source_copy}"
    ./autogen.sh
  )
fi

if [ ! -x "${native_baseline}/lib-src/make-docfile" ] || [ ! -x "${native_baseline}/lib-src/make-fingerprint" ]; then
  "${repo_root}/src/build/build-native-baseline.sh"
fi

mkdir -p "${build_dir}"
printf '{"type":"commonjs"}\n' > "${build_dir}/package.json"

if [ ! -f "${build_dir}/src/Makefile" ]; then
  (
    cd "${build_dir}"
    CFLAGS="${emacs_wasm_cflags}" \
    "${emconfigure_bin}" "${source_copy}/configure" \
      --host="${emacs_wasm_host}" \
      --build="$("${source_copy}/build-aux/config.guess")" \
      --without-all \
      --without-x \
      --without-ns \
      --without-pgtk \
      --without-sound \
      --without-dbus \
      --without-gconf \
      --without-gsettings \
      --without-native-compilation \
      --with-wide-int \
      --with-dumping=none \
      --with-pdumper=no \
      --with-unexec=no \
      emacs_cv_tputs_lib="${emacs_tputs_lib_cache}" \
      ac_cv_func_malloc_trim=no \
      emacs_cv_linux_sysinfo=no \
      ac_cv_func_sigsuspend=no

    perl -0pi -e 's@^#define TERMINFO 1$@/* #undef TERMINFO */@m;
                  s@^#define HAVE_LINUX_SYSINFO 1$@/* #undef HAVE_LINUX_SYSINFO */@m;
                  s@^#define HAVE_PTHREAD 1$@/* #undef HAVE_PTHREAD */@m;
                  s@^#define HAVE_PTHREAD_SIGMASK 1$@/* #undef HAVE_PTHREAD_SIGMASK */@m' \
      src/config.h
    perl -0pi -e 's/^LIBS_TERMCAP=.*$/LIBS_TERMCAP=/m;
                  s/^TERMCAP_OBJ=.*$/TERMCAP_OBJ=termcap.o tparam.o/m' \
      src/Makefile

    "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" -C lib CFLAGS="${emacs_wasm_cflags}" all
    "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" -C lib-src CFLAGS="${emacs_wasm_cflags}" all
    cp "${native_baseline}/lib-src/make-docfile" lib-src/make-docfile
    cp "${native_baseline}/lib-src/make-fingerprint" lib-src/make-fingerprint
  )
fi

WASMACS_SPIKE_SRC="${source_copy}" \
WASMACS_ENABLE_ASYNCIFY_WAITPOINT=1 \
WASMACS_ASYNCIFY_WAITPOINT_MODE="${wasmacs_asyncify_waitpoint_mode}" \
  "${repo_root}/tools/scripts/patch-emacs-host-entrypoint-spike.sh"

(
  cd "${build_dir}"
  rm -f src/temacs src/temacs.wasm src/temacs.data
  "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" \
    -C src \
    CFLAGS="${emacs_wasm_cflags}" \
    LDFLAGS="${emacs_asyncify_ldflags}" \
    temacs
)

mkdir -p "${out_dir}"
printf '{"type":"commonjs"}\n' > "${out_dir}/package.json"
cp "${build_dir}/src/temacs" "${out_dir}/temacs"
cp "${build_dir}/src/temacs.wasm" "${out_dir}/temacs.wasm"
cp "${build_dir}/src/temacs.data" "${out_dir}/temacs.data"
