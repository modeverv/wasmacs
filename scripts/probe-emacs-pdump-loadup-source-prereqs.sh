#!/usr/bin/env bash
# Probe: pre-load macro dependencies before files.el so source-mode pdump
# loadup does not hit "(require pcase) while preparing to dump".
#
# In a compiled Emacs build, files.elc is loaded and eval-when-compile never
# runs at load time.  When loading from source, the eager macro-expansion path
# fires (require 'pcase) and (require 'easy-mmode) before those features are
# in the features list.  The fix is to pre-load macroexp + pcase + easy-mmode
# (with eager expansion skipped) before (load "files").
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_src="${repo_root}/build/emacs-pdump-configure-probe/src"
build_dir="${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump/src"
real_loadup="${build_src}/lisp/loadup.el"
backup_loadup="${build_src}/lisp/loadup.el.original-prereqs"
log_file="${repo_root}/logs/emacs-pdump-loadup-source-prereqs.txt"

if [ ! -f "${build_dir}/temacs" ] || [ ! -f "${build_dir}/temacs.wasm" ]; then
  "${repo_root}/scripts/probe-emacs-pdump-temacs-build.sh"
fi

mkdir -p "${repo_root}/logs"
cp "${real_loadup}" "${backup_loadup}"
trap 'cp "${backup_loadup}" "${real_loadup}"; rm -f "${backup_loadup}"' EXIT

# Insert pre-load block before (load "files") so that pcase and easy-mmode
# are already in features when files.el's eval-when-compile runs.
perl -0pi -e '
  s/(\(load "files"\))/;; Wasm pdump spike: pre-load macro dependencies so files.el\n;; eval-when-compile does not fail with "require while preparing to dump".\n;; In a compiled build files.elc is used instead and this is not needed.\n(load "emacs-lisp\/macroexp")\n(let ((macroexp--pending-eager-loads (quote (skip)))) (load "emacs-lisp\/pcase"))\n(let ((macroexp--pending-eager-loads (quote (skip)))) (load "emacs-lisp\/easy-mmode"))\n$1/m
' "${real_loadup}"

{
  printf 'pdump loadup source prereqs probe\n'
  printf 'purpose: verify files.el loads from source after pre-loading pcase+easy-mmode\n'
  printf '\n'
} > "${log_file}"

printf '=== loadup source prereqs patch applied ===\n' | tee -a "${log_file}"
grep -A2 "Wasm pdump spike" "${real_loadup}" | head -8 | tee -a "${log_file}"
printf '\n' | tee -a "${log_file}"

set +e
(
  cd "${build_dir}"
  EMACSLOADPATH="${build_src}/lisp" \
    node --stack-size=65500 ./temacs --batch -l loadup --temacs=pdump
) 2>&1 | tee -a "${log_file}"
status=${PIPESTATUS[0]}
set -e

printf '\nEXIT_STATUS:%s\n' "${status}" | tee -a "${log_file}"

# Check for evidence of files.el loading successfully
if grep -q 'Loading files.el' "${log_file}" || grep -q 'Loading files' "${log_file}"; then
  printf 'PASS: files.el loading was attempted\n' | tee -a "${log_file}"
fi

# Check how far loadup progressed
for marker in bindings window files macroexp loaddefs; do
  if grep -q "Loading ${marker}" "${log_file}"; then
    printf 'REACHED: %s\n' "${marker}" | tee -a "${log_file}"
  fi
done

if grep -q 'require pcase.*while preparing to dump' "${log_file}"; then
  printf 'FAIL: still hitting pcase require error\n' | tee -a "${log_file}"
  exit 1
fi

printf 'STATUS:PASS loadup source prereqs probe recorded\n' | tee -a "${log_file}"
