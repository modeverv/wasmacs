#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_src="${repo_root}/build/emacs-pdump-configure-probe/src"
build_dir="${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump/src"
probe_dir="${repo_root}/build/emacs-pdump-configure-probe/bindings-purecopy-split"
real_bindings="${build_src}/lisp/bindings.el"
backup_bindings="${probe_dir}/bindings.el.original"
log_file="${repo_root}/logs/emacs-pdump-bindings-purecopy-split.txt"

if [ ! -f "${build_dir}/temacs" ] || [ ! -f "${build_dir}/temacs.wasm" ]; then
  "${repo_root}/scripts/probe-emacs-pdump-temacs-build.sh"
fi

mkdir -p "${probe_dir}" "${repo_root}/logs"

perl -0pe '
  my $done = 0;
  s/\(defvar mode-line-input-method-map\n  \(let \(\(map \(make-sparse-keymap\)\)\)(.*?)\n    \(purecopy map\)\)\)/"(defvar mode-line-input-method-map\n  (let ((map (make-sparse-keymap)))" . $1 . "\n    map))"/se;
' "${real_bindings}" > "${probe_dir}/bindings.el.no-first-purecopy"

{
  printf 'pdump bindings purecopy split probe\n'
  printf 'patched bindings: %s\n' "${probe_dir}/bindings.el.no-first-purecopy"
  printf '\n'
} > "${log_file}"

set +e
(
  cd "${build_dir}"
  cp "${real_bindings}" "${backup_bindings}"
  trap 'cp "${backup_bindings}" "${real_bindings}"' EXIT
  cp "${probe_dir}/bindings.el.no-first-purecopy" "${real_bindings}"
  EMACSLOADPATH="${build_src}/lisp" \
    node --stack-size=65500 ./temacs --batch -l loadup --temacs=pdump
) 2>&1 | tee -a "${log_file}"
status=${PIPESTATUS[0]}
set -e

printf '\nSTATUS:%s\n' "${status}" | tee -a "${log_file}"

rg -q 'Loading bindings \(source\)' "${log_file}"

if rg -q 'Loading window \(source\)|Loading files \(source\)|Loading emacs-lisp/macroexp' "${log_file}"; then
  printf 'RESULT:PASS first mode-line purecopy avoided bindings crash\n' | tee -a "${log_file}"
elif [ "${status}" -eq 0 ]; then
  printf 'RESULT:PASS pdump completed with first purecopy removed\n' | tee -a "${log_file}"
else
  printf 'RESULT:KNOWN_BLOCKER status %s with first purecopy removed\n' "${status}" | tee -a "${log_file}"
fi
