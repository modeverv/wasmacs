#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_ref="${repo_root}/vendor/emacs"
work_root="${WASMACS_NATIVE_WORK_ROOT:-${repo_root}/build/native-emacs-30.2}"
source_copy="${work_root}/src"
log_file="${WASMACS_NATIVE_LOG_FILE:-${repo_root}/logs/native-baseline.txt}"
emacs_source_tag="$(
  git -C "${source_ref}" describe --tags --exact-match HEAD 2>/dev/null \
    || printf 'emacs-%s' "${WASMACS_EMACS_VERSION:-30.2}"
)"

mkdir -p "${work_root}" "${repo_root}/logs"

{
  echo "# Native Emacs 30.2 baseline"
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "source: vendor/emacs"
  echo "commit: $(git -C "${source_ref}" rev-parse HEAD)"
  echo "tag: ${emacs_source_tag}"
  echo
} >"${log_file}"

if [ ! -d "${source_copy}/.git" ] && [ ! -f "${source_copy}/configure.ac" ]; then
  mkdir -p "${source_copy}"
  git -C "${source_ref}" archive HEAD | tar -x -C "${source_copy}"
fi

if [ ! -x "${source_copy}/configure" ]; then
  (
    cd "${source_copy}"
    ./autogen.sh
  ) 2>&1 | tee -a "${log_file}"
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

{
  echo
  echo "## Configure"
  printf '%q ' "${source_copy}/configure" "${configure_flags[@]}"
  echo
} | tee -a "${log_file}"

(
  cd "${source_copy}"
  ./configure "${configure_flags[@]}"
) 2>&1 | tee -a "${log_file}"

{
  echo
  echo "## Build"
  echo "make -j${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')} src"
} | tee -a "${log_file}"

(
  cd "${source_copy}"
  make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" src
) 2>&1 | tee -a "${log_file}"

{
  echo
  echo "## Batch checks"
  echo "./src/emacs --batch --eval '(message \"hello wasmacs\")'"
} | tee -a "${log_file}"

"${source_copy}/src/emacs" --batch --eval '(message "hello wasmacs")' 2>&1 | tee -a "${log_file}"

echo "./src/emacs --batch --eval '(princ emacs-version)'" | tee -a "${log_file}"
"${source_copy}/src/emacs" --batch --eval '(princ emacs-version)' 2>&1 | tee -a "${log_file}"
echo | tee -a "${log_file}"

echo "./src/emacs --batch --eval '(princ (if (byte-code-function-p (symbol-function (quote byte-code))) \"byte-code-function\" \"not-byte-code-function\"))'" | tee -a "${log_file}"
"${source_copy}/src/emacs" --batch --eval '(princ (if (byte-code-function-p (symbol-function (quote byte-code))) "byte-code-function" "not-byte-code-function"))' 2>&1 | tee -a "${log_file}"
echo | tee -a "${log_file}"
