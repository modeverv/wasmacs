#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
build_src="${repo_root}/build/emacs-pdump-configure-probe/src"
build_dir="${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump/src"
probe_dir="${repo_root}/build/emacs-pdump-configure-probe/bindings-purecopy-markers"
real_bindings="${build_src}/lisp/bindings.el"
backup_bindings="${probe_dir}/bindings.el.original"
log_file="${repo_root}/logs/emacs-pdump-bindings-purecopy-markers.txt"

if [ ! -f "${build_dir}/temacs" ] || [ ! -f "${build_dir}/temacs.wasm" ]; then
  "${repo_root}/tools/scripts/probe-emacs-pdump-temacs-build.sh"
fi

mkdir -p "${probe_dir}" "${repo_root}/logs"
cp "${real_bindings}" "${backup_bindings}"

make_variant() {
  local variant="$1"
  local first_replacement="$2"
  local second_replacement="$3"
  WASMACS_FIRST_REPLACEMENT="${first_replacement}" \
  WASMACS_SECOND_REPLACEMENT="${second_replacement}" \
    perl -0pe '
      my $first = $ENV{"WASMACS_FIRST_REPLACEMENT"};
      my $second = $ENV{"WASMACS_SECOND_REPLACEMENT"};
      my $count = 0;
      s/\(purecopy map\)/++$count == 1 ? $first : (++$count == 3 ? $second : "(purecopy map)")/ge;
    ' "${backup_bindings}" > "${probe_dir}/bindings.${variant}.el"
}

make_variant "both-marked" \
  '(progn
      (message "wasmacs purecopy marker: before input")
      (prog1 (purecopy map)
        (message "wasmacs purecopy marker: after input")))' \
  '(progn
      (message "wasmacs purecopy marker: before coding")
      (prog1 (purecopy map)
        (message "wasmacs purecopy marker: after coding")))'

make_variant "input-only" \
  '(progn
      (message "wasmacs purecopy marker: before input-only")
      (prog1 (purecopy map)
        (message "wasmacs purecopy marker: after input-only")))' \
  '(progn
      (message "wasmacs purecopy marker: coding purecopy skipped")
      map)'

make_variant "coding-only" \
  '(progn
      (message "wasmacs purecopy marker: input purecopy skipped")
      map)' \
  '(progn
      (message "wasmacs purecopy marker: before coding-only")
      (prog1 (purecopy map)
        (message "wasmacs purecopy marker: after coding-only")))'

{
  printf 'pdump bindings purecopy markers probe\n'
  printf 'real bindings: %s\n' "${real_bindings}"
  printf '\n'
} > "${log_file}"

run_variant() {
  local variant="$1"
  printf '\n=== variant:%s ===\n' "${variant}" | tee -a "${log_file}"
  set +e
  (
    cd "${build_dir}"
    cp "${probe_dir}/bindings.${variant}.el" "${real_bindings}"
    EMACSLOADPATH="${build_src}/lisp" \
      node --stack-size=65500 ./temacs --batch -l loadup --temacs=pdump
  ) 2>&1 | tee -a "${log_file}"
  local status=${PIPESTATUS[0]}
  set -e
  printf 'VARIANT_STATUS:%s:%s\n' "${variant}" "${status}" | tee -a "${log_file}"
}

trap 'cp "${backup_bindings}" "${real_bindings}"' EXIT
run_variant "both-marked"
run_variant "input-only"
run_variant "coding-only"

rg -q 'wasmacs purecopy marker:' "${log_file}"
rg -q 'VARIANT_STATUS:both-marked:' "${log_file}"
rg -q 'VARIANT_STATUS:input-only:' "${log_file}"
rg -q 'VARIANT_STATUS:coding-only:' "${log_file}"

printf 'RESULT:PASS purecopy marker probe recorded\n' | tee -a "${log_file}"
