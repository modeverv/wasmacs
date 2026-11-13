#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
build_src="${repo_root}/build/emacs-pdump-configure-probe/src"
build_dir="${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump/src"
probe_lisp_dir="${repo_root}/build/emacs-pdump-configure-probe/loadup-gc-split"
probe_loadup="${probe_lisp_dir}/loadup-no-after-load-gc.el"
real_loadup="${build_src}/lisp/loadup.el"
backup_loadup="${probe_lisp_dir}/loadup.el.original"
log_file="${repo_root}/logs/emacs-pdump-loadup-gc-split.txt"

if [ ! -f "${build_dir}/temacs" ] || [ ! -f "${build_dir}/temacs.wasm" ]; then
  EMACS_WASM_LDFLAGS="${EMACS_WASM_LDFLAGS:--sNODERAWFS=1 -sEXIT_RUNTIME=1 -sSTACK_SIZE=134217728 -sSTACK_OVERFLOW_CHECK=0 -sINITIAL_MEMORY=1073741824 -sALLOW_MEMORY_GROWTH=1}" \
    "${repo_root}/tools/scripts/probe-emacs-pdump-temacs-build.sh"
fi

mkdir -p "${probe_lisp_dir}" "${repo_root}/logs"

perl -0pe 's/\(add-hook '\''after-load-functions \(lambda \(_\) \(garbage-collect\)\)\)/(message "wasmacs probe: skipped after-load garbage-collect hook")/' \
  "${real_loadup}" > "${probe_loadup}"

{
  printf 'pdump loadup GC split probe\n'
  printf 'probe loadup: %s\n' "${probe_loadup}"
  printf 'source lisp: %s\n' "${build_src}/lisp"
  printf '\n'
} > "${log_file}"

set +e
(
  cd "${build_dir}"
  cp "${real_loadup}" "${backup_loadup}"
  trap 'cp "${backup_loadup}" "${real_loadup}"' EXIT
  cp "${probe_loadup}" "${real_loadup}"
  EMACSLOADPATH="${build_src}/lisp" \
    node --stack-size=65500 ./temacs --batch -l loadup --temacs=pdump
) 2>&1 | tee -a "${log_file}"
status=${PIPESTATUS[0]}
set -e

printf '\nSTATUS:%s\n' "${status}" | tee -a "${log_file}"

rg -q 'wasmacs probe: skipped after-load garbage-collect hook' "${log_file}"
rg -q 'Loading bindings \(source\)' "${log_file}"

if [ "${status}" -eq 0 ]; then
  printf 'RESULT:PASS loadup progressed without after-load GC\n' | tee -a "${log_file}"
else
  printf 'RESULT:KNOWN_BLOCKER loadup status %s without after-load GC\n' "${status}" | tee -a "${log_file}"
fi
