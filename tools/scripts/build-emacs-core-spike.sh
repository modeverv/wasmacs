#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_ref="${repo_root}/vendor/emacs"
work_root="${repo_root}/build/emacs-core-spike"
source_copy="${work_root}/src"
build_dir="${work_root}/build-gnu-host-internal-termcap"

emconfigure_bin="${EMCONFIGURE:-emconfigure}"
emmake_bin="${EMMAKE:-emmake}"
emacs_wasm_host="${EMACS_WASM_HOST:-wasm32-unknown-linux-gnu}"
emacs_tputs_lib_cache="${EMACS_TPUTS_LIB_CACHE:-none required}"
native_baseline="${repo_root}/build/native-emacs-30.2/src"
emacs_wasm_cflags="${EMACS_WASM_CFLAGS:--g3 -O0}"
emacs_wasm_ldflags="${EMACS_WASM_LDFLAGS:--sNODERAWFS=1 -sEXIT_RUNTIME=1 -sSTACK_SIZE=1048576 -sSTACK_OVERFLOW_CHECK=2 -sINITIAL_MEMORY=268435456 -sALLOW_MEMORY_GROWTH=1}"

if ! command -v "${emconfigure_bin}" >/dev/null 2>&1; then
  echo "error: ${emconfigure_bin} not found; install/activate Emscripten first" >&2
  exit 127
fi

if ! command -v "${emmake_bin}" >/dev/null 2>&1; then
  echo "error: ${emmake_bin} not found; install/activate Emscripten first" >&2
  exit 127
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

mkdir -p "${build_dir}"
printf '{"type":"commonjs"}\n' > "${build_dir}/package.json"

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
  "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" -C src CFLAGS="${emacs_wasm_cflags}" LDFLAGS="${emacs_wasm_ldflags}" temacs
)

mkdir -p "${repo_root}/build/artifacts"
cp "${build_dir}/src/temacs.wasm" "${repo_root}/build/artifacts/emacs-core-spike.wasm"
cp "${build_dir}/src/temacs" "${repo_root}/build/artifacts/emacs-core-spike.js"
