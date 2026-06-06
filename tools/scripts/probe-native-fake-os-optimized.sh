#!/usr/bin/env bash
# Build a native macOS probe with the wasmacs OS facade patch applied.
#
# Purpose:
#   Separate "wasmacs C-side OS compatibility patch semantics" from
#   Emscripten/browser/pdump startup.  This build is native, optimized, and
#   pdump-free, then runs batch smoke checks through the patched Emacs.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_ref="${repo_root}/vendor/emacs"
work_root="${repo_root}/build/native-fake-os-optimized"
source_copy="${work_root}/src"
log_file="${repo_root}/logs/native-fake-os-optimized.txt"
jobs="${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}"
cflags="${WASMACS_NATIVE_FAKE_OS_CFLAGS:--O2 -g0}"

mkdir -p "${work_root}" "${repo_root}/logs"
rm -f "${log_file}"

{
  echo "# Native fake OS optimized probe"
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "source: vendor/emacs"
  echo "commit: $(git -C "${source_ref}" rev-parse HEAD)"
  echo "cflags: ${cflags}"
  echo
} | tee -a "${log_file}"

if [ "${WASMACS_NATIVE_FAKE_OS_FORCE_RECOPY:-0}" = "1" ]; then
  rm -rf "${source_copy}"
fi

if [ ! -d "${source_copy}" ] || [ ! -f "${source_copy}/configure.ac" ]; then
  mkdir -p "${source_copy}"
  git -C "${source_ref}" archive HEAD | tar -x -C "${source_copy}"
fi

if ! rg 'wasmacs_os_network_fetch_json' "${source_copy}/src/emacs.c" >/dev/null; then
  echo "## Applying wasmacs OS facade patch" | tee -a "${log_file}"
  WASMACS_SPIKE_SRC="${source_copy}" \
  WASMACS_ENABLE_ASYNCIFY_WAITPOINT=0 \
    "${repo_root}/tools/scripts/patch-emacs-host-entrypoint-spike.sh" 2>&1 | tee -a "${log_file}"
fi

if [ ! -x "${source_copy}/configure" ]; then
  echo "## Autogen" | tee -a "${log_file}"
  (cd "${source_copy}" && ./autogen.sh) 2>&1 | tee -a "${log_file}"
fi

configure_flags=(
  "--without-all"
  "--without-x"
  "--without-ns"
  "--without-pgtk"
  "--without-sound"
  "--without-dbus"
  "--without-gconf"
  "--without-gsettings"
  "--without-native-compilation"
  "--with-dumping=none"
  "--with-pdumper=no"
  "--with-unexec=no"
)

echo "## Configure" | tee -a "${log_file}"
(
  cd "${source_copy}"
  CFLAGS="${cflags}" ./configure "${configure_flags[@]}"
) 2>&1 | tee -a "${log_file}"

echo "## Build src" | tee -a "${log_file}"
(
  cd "${source_copy}"
  make -j"${jobs}" src
) 2>&1 | tee -a "${log_file}"

emacs_bin="${source_copy}/src/emacs"
test -x "${emacs_bin}"

run_check() {
  local name="$1"
  shift
  echo "## Check: ${name}" | tee -a "${log_file}"
  "${emacs_bin}" "$@" 2>&1 | tee -a "${log_file}"
  echo | tee -a "${log_file}"
}

run_check "version" --quick --batch --eval '(princ emacs-version)'
run_check "json" --quick --batch --eval '(require (quote json))' --eval '(princ "json-ok")'
run_check "wasmacs primitive bound" --quick --batch \
  --eval '(princ (if (fboundp (quote wasmacs-os-network-fetch-json)) "wasmacs-primitive-ok" "wasmacs-primitive-missing"))'
run_check "wasmacs stack facade" --quick --batch \
  --eval '(princ (if (fboundp (quote wasmacs-os-stack-bounds-probe)) (wasmacs-os-stack-bounds-probe) "missing"))'

echo "PASS native fake OS optimized probe" | tee -a "${log_file}"
echo "EMACS:${emacs_bin}"
echo "LOG:${log_file}"
