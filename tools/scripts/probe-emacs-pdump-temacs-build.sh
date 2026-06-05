#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
build_dir="${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump"
native_baseline="${repo_root}/build/native-emacs-30.2/src"
log_file="${repo_root}/logs/emacs-pdump-temacs-build.txt"

emmake_bin="${EMMAKE:-emmake}"
emacs_wasm_cflags="${EMACS_WASM_CFLAGS:--g3 -O0}"
emacs_wasm_ldflags="${EMACS_WASM_LDFLAGS:--sNODERAWFS=1 -sEXIT_RUNTIME=1 -sSTACK_SIZE=1048576 -sSTACK_OVERFLOW_CHECK=2 -sINITIAL_MEMORY=268435456 -sALLOW_MEMORY_GROWTH=1}"

if ! command -v "${emmake_bin}" >/dev/null 2>&1; then
  echo "error: ${emmake_bin} not found; install/activate Emscripten first" >&2
  exit 127
fi

if [ ! -f "${build_dir}/src/Makefile" ]; then
  "${repo_root}/src/build/probe-emacs-pdump-configure.sh"
fi

if [ ! -x "${native_baseline}/lib-src/make-docfile" ] \
   || [ ! -x "${native_baseline}/lib-src/make-fingerprint" ]; then
  echo "error: native baseline helper tools are missing; run src/build/build-native-baseline.sh first" >&2
  exit 1
fi

mkdir -p "${repo_root}/logs"
{
  printf 'pdump temacs build probe\n'
  printf 'workdir: %s\n' "${build_dir}"
  printf 'target: src/temacs\n'
  printf '\n'
} > "${log_file}"

(
  cd "${build_dir}"
  printf '{"type":"commonjs"}\n' > src/package.json
  perl -0pi -e 's@^#define TERMINFO 1$@/* #undef TERMINFO */@m;
                s@^#define HAVE_LINUX_SYSINFO 1$@/* #undef HAVE_LINUX_SYSINFO */@m;
                s@^#define HAVE_PTHREAD 1$@/* #undef HAVE_PTHREAD */@m;
                s@^#define HAVE_PTHREAD_SIGMASK 1$@/* #undef HAVE_PTHREAD_SIGMASK */@m' \
    src/config.h
  perl -0pi -e 's/^LIBS_TERMCAP=.*$/LIBS_TERMCAP=/m;
                s/^TERMCAP_OBJ=.*$/TERMCAP_OBJ=termcap.o tparam.o/m' \
    src/Makefile

  {
    "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" -C lib CFLAGS="${emacs_wasm_cflags}" all
    "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" -C lib-src CFLAGS="${emacs_wasm_cflags}" all
    cp "${native_baseline}/lib-src/make-docfile" lib-src/make-docfile
    cp "${native_baseline}/lib-src/make-fingerprint" lib-src/make-fingerprint
    if ! "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" \
      -C src \
      CFLAGS="${emacs_wasm_cflags}" \
      LDFLAGS="${emacs_wasm_ldflags}" \
      temacs; then
      if [ -f src/temacs.tmp ] && [ -f src/temacs.wasm ] \
         && rg -q 'missing fingerprint' "${log_file}"; then
        printf '\nApplying wasm-side pdumper fingerprint workaround.\n'
        printf 'Reason: upstream make-fingerprint was run on the JS launcher; the fingerprint bytes live in temacs.wasm for Emscripten.\n'
        "${native_baseline}/lib-src/make-fingerprint" src/temacs.wasm
        mv src/temacs.tmp src/temacs
      else
        exit 1
      fi
    fi
  } 2>&1 | tee -a "${log_file}"
)

test -f "${build_dir}/src/temacs"
test -f "${build_dir}/src/temacs.wasm"
printf 'STATUS:PASS pdumper temacs build completed\n' | tee -a "${log_file}"
