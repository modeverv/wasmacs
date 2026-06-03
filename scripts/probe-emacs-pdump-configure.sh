#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_ref="${repo_root}/vendor/emacs"
work_root="${repo_root}/build/emacs-pdump-configure-probe"
source_copy="${work_root}/src"
build_dir="${work_root}/build-gnu-host-internal-termcap-pdump"
log_file="${repo_root}/logs/emacs-pdump-configure-probe.txt"

emconfigure_bin="${EMCONFIGURE:-emconfigure}"
emacs_wasm_host="${EMACS_WASM_HOST:-wasm32-unknown-linux-gnu}"
emacs_tputs_lib_cache="${EMACS_TPUTS_LIB_CACHE:-none required}"
emacs_wasm_cflags="${EMACS_WASM_CFLAGS:--g3 -O0}"

if ! command -v "${emconfigure_bin}" >/dev/null 2>&1; then
  echo "error: ${emconfigure_bin} not found; install/activate Emscripten first" >&2
  exit 127
fi

mkdir -p "${work_root}" "${repo_root}/logs"

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

rm -rf "${build_dir}"
mkdir -p "${build_dir}"

{
  printf 'pdump configure probe\n'
  printf 'source: vendor/emacs\n'
  printf 'workdir: %s\n' "${build_dir}"
  printf 'host: %s\n' "${emacs_wasm_host}"
  printf 'dumping: pdumper\n'
  printf '\n'
} > "${log_file}"

(
  cd "${build_dir}"
  {
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
      --with-dumping=pdumper \
      --with-pdumper=yes \
      --with-unexec=no \
      emacs_cv_tputs_lib="${emacs_tputs_lib_cache}" \
      ac_cv_func_malloc_trim=no \
      emacs_cv_linux_sysinfo=no \
      ac_cv_func_sigsuspend=no
  } 2>&1 | tee -a "${log_file}"
)

{
  printf '\nconfigured DUMPING/HAVE_PDUMPER:\n'
  rg -n '^(DUMPING|HAVE_PDUMPER|pdmp|bootstrap_pdmp)[[:space:]:=]' "${build_dir}/src/Makefile" || true
  printf '\nconfig.h HAVE_PDUMPER:\n'
  rg -n 'HAVE_PDUMPER' "${build_dir}/src/config.h" || true
} | tee -a "${log_file}"

rg -q '^DUMPING=pdumper$' "${build_dir}/src/Makefile"
rg -q '^#define HAVE_PDUMPER 1$' "${build_dir}/src/config.h"

printf 'STATUS:PASS pdumper configure completed\n' | tee -a "${log_file}"
