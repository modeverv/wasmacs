#!/usr/bin/env bash
# Build and run an optimized wasm --batch probe without the TTY waitpoint layer.
#
# Purpose:
#   Test whether optimized wasm itself can boot Emacs in batch mode when the
#   Atomics/xterm/TTY compatibility path is not compiled in.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_ref="${repo_root}/vendor/emacs"
work_root="${repo_root}/build/wasm-optimized-batch-no-tty"
source_copy="${work_root}/src"
build_dir="${work_root}/build"
artifact_dir="${repo_root}/build/artifacts/emacs-wasm-optimized-batch-no-tty"

emconfigure_bin="${EMCONFIGURE:-emconfigure}"
emmake_bin="${EMMAKE:-emmake}"
emacs_wasm_host="${EMACS_WASM_HOST:-wasm32-unknown-linux-gnu}"
emacs_tputs_lib_cache="${EMACS_TPUTS_LIB_CACHE:-none required}"
jobs="${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}"
cflags="${WASMACS_WASM_BATCH_NO_TTY_CFLAGS:--O2 -g0}"
cflags_slug="$(printf '%s' "${cflags}" | tr -cs 'A-Za-z0-9' '-' | sed 's/^-//;s/-$//')"
log_file="${repo_root}/logs/wasm-batch-no-tty-${cflags_slug}.txt"
ldflags="${WASMACS_WASM_BATCH_NO_TTY_LDFLAGS:--sEXIT_RUNTIME=0 \
  -sEXPORTED_FUNCTIONS=_main,_wasmacs_os_network_fetch_json,_wasmacs_os_lifecycle_state,_wasmacs_os_stack_bounds_probe,_wasmacs_os_gc_permission_state,_wasmacs_os_root_safety_probe \
  -sEXPORTED_RUNTIME_METHODS=callMain,ccall,FS,FS_createPath,FS_createDataFile,FS_readFile \
  -sSTACK_SIZE=16777216 \
  -sSTACK_OVERFLOW_CHECK=2 \
  -sINITIAL_MEMORY=268435456 \
  -sALLOW_MEMORY_GROWTH=1 \
  --preload-file ${source_copy}/lisp@/usr/local/share/emacs/30.2/lisp \
  --preload-file ${source_copy}/etc@/usr/local/share/emacs/30.2/etc}"
native_baseline="${repo_root}/build/native-emacs-30.2/src"

if ! command -v "${emconfigure_bin}" >/dev/null 2>&1; then
  echo "error: ${emconfigure_bin} not found; install/activate Emscripten first" >&2
  exit 127
fi
if ! command -v "${emmake_bin}" >/dev/null 2>&1; then
  echo "error: ${emmake_bin} not found; install/activate Emscripten first" >&2
  exit 127
fi
if [ ! -x "${native_baseline}/lib-src/make-docfile" ] \
   || [ ! -x "${native_baseline}/lib-src/make-fingerprint" ]; then
  echo "error: native baseline helper tools are missing; run src/build/build-native-baseline.sh first" >&2
  exit 1
fi

mkdir -p "${work_root}" "${repo_root}/logs" "${artifact_dir}"
rm -f "${log_file}"

{
  echo "# wasm optimized batch no-tty probe"
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "source: vendor/emacs"
  echo "commit: $(git -C "${source_ref}" rev-parse HEAD)"
  echo "cflags: ${cflags}"
  echo "tty-waitpoint: disabled"
  echo
} | tee -a "${log_file}"

if [ "${WASMACS_WASM_BATCH_NO_TTY_FORCE_RECOPY:-0}" = "1" ]; then
  rm -rf "${source_copy}" "${build_dir}"
fi

if [ ! -d "${source_copy}" ] || [ ! -f "${source_copy}/configure.ac" ]; then
  mkdir -p "${source_copy}"
  git -C "${source_ref}" archive HEAD | tar -x -C "${source_copy}"
fi

if ! rg 'wasmacs_os_network_fetch_json' "${source_copy}/src/emacs.c" >/dev/null; then
  echo "## Applying wasmacs facade patch without TTY waitpoint" | tee -a "${log_file}"
  WASMACS_SPIKE_SRC="${source_copy}" \
  WASMACS_ENABLE_ASYNCIFY_WAITPOINT=0 \
    "${repo_root}/tools/scripts/patch-emacs-host-entrypoint-spike.sh" 2>&1 | tee -a "${log_file}"
fi

if [ ! -x "${source_copy}/configure" ]; then
  echo "## Autogen" | tee -a "${log_file}"
  (cd "${source_copy}" && ./autogen.sh) 2>&1 | tee -a "${log_file}"
fi

mkdir -p "${build_dir}"
printf '{"type":"commonjs"}\n' > "${build_dir}/package.json"

echo "## Configure" | tee -a "${log_file}"
(
  cd "${build_dir}"
  CFLAGS="${cflags}" \
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
) 2>&1 | tee -a "${log_file}"

echo "## Build" | tee -a "${log_file}"
(
  cd "${build_dir}"
  "${emmake_bin}" make -j"${jobs}" -C lib CFLAGS="${cflags}" all
  "${emmake_bin}" make -j"${jobs}" -C lib-src CFLAGS="${cflags}" all || true
  cp "${native_baseline}/lib-src/make-docfile" lib-src/make-docfile
  cp "${native_baseline}/lib-src/make-fingerprint" lib-src/make-fingerprint
  touch lib-src/make-docfile lib-src/make-fingerprint
  "${emmake_bin}" make -j"${jobs}" -C src CFLAGS="${cflags}" LDFLAGS="${ldflags}" temacs
) 2>&1 | tee -a "${log_file}"

printf '{"type":"commonjs"}\n' > "${artifact_dir}/package.json"
cp "${build_dir}/src/temacs" "${artifact_dir}/temacs"
cp "${build_dir}/src/temacs.wasm" "${artifact_dir}/temacs.wasm"
cp "${build_dir}/src/temacs.data" "${artifact_dir}/temacs.data"

echo "## Batch checks" | tee -a "${log_file}"
(
  cd "${artifact_dir}"
  node --stack-size=65500 ./temacs --quick --batch --eval '(princ emacs-version)'
  echo
  node --stack-size=65500 ./temacs --quick --batch --eval '(require (quote json))' --eval '(princ "json-ok")'
  echo
) 2>&1 | tee -a "${log_file}"

echo "PASS wasm optimized batch no-tty probe" | tee -a "${log_file}"
echo "ARTIFACT:${artifact_dir}"
echo "LOG:${log_file}"
