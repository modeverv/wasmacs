#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_src="${repo_root}/build/emacs-pdump-configure-probe/src"
build_dir="${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump/src"
probe_dir="${repo_root}/build/emacs-pdump-configure-probe/bindings-defvar-variants"
real_bindings="${build_src}/lisp/bindings.el"
backup_bindings="${probe_dir}/bindings.el.original"
log_file="${repo_root}/logs/emacs-pdump-bindings-defvar-variants.txt"

if [ ! -f "${build_dir}/temacs" ] || [ ! -f "${build_dir}/temacs.wasm" ]; then
  "${repo_root}/scripts/probe-emacs-pdump-temacs-build.sh"
fi

mkdir -p "${probe_dir}" "${repo_root}/logs"
cp "${real_bindings}" "${backup_bindings}"

replace_defvar() {
  local variant="$1"
  local replacement="$2"
  WASMACS_REPLACEMENT="${replacement}" perl -0pe '
    my $replacement = $ENV{"WASMACS_REPLACEMENT"};
    s/\(defvar mode-line-input-method-map\n  \(let \(\(map \(make-sparse-keymap\)\)\).*?\n    \(purecopy map\)\)\)/$replacement/s;
  ' "${backup_bindings}" > "${probe_dir}/bindings.${variant}.el"
}

replace_defvar "map-only" "(defvar mode-line-input-method-map
  (let ((map (make-sparse-keymap)))
    (message \"wasmacs bindings variant: map-only\")
    map))"

replace_defvar "nil-only" "(defvar mode-line-input-method-map
  (progn
    (message \"wasmacs bindings variant: nil-only\")
    nil))"

replace_defvar "string-only" "(defvar mode-line-input-method-map
  (progn
    (message \"wasmacs bindings variant: string-only\")
    \"wasmacs\"))"

WASMACS_REPLACEMENT='(defvar mode-line-input-method-map
  (progn
    (message "wasmacs bindings variant: both-map-defvars-nil/input")
    nil))

(defvar mode-line-coding-system-map
  (progn
    (message "wasmacs bindings variant: both-map-defvars-nil/coding")
    nil)
  "Local keymap for the coding-system part of the mode line.")' perl -0pe '
  my $replacement = $ENV{"WASMACS_REPLACEMENT"};
  s/\(defvar mode-line-input-method-map\n  \(let \(\(map \(make-sparse-keymap\)\)\).*?\n    \(purecopy map\)\)\)\n\n\(defvar mode-line-coding-system-map\n  \(let \(\(map \(make-sparse-keymap\)\)\).*?\n    \(purecopy map\)\)\n  "Local keymap for the coding-system part of the mode line\."\)/$replacement/s;
' "${backup_bindings}" > "${probe_dir}/bindings.both-map-defvars-nil.el"

WASMACS_REPLACEMENT='(defvar mode-line-input-method-map
  (let ((map (make-sparse-keymap)))
    (message "wasmacs bindings variant: both-maps-no-purecopy/input")
    (define-key map [mode-line mouse-2] (lambda (e) (interactive "e") (ignore e)))
    (define-key map [mode-line mouse-3] (lambda (e) (interactive "e") (ignore e)))
    map))

(defvar mode-line-coding-system-map
  (let ((map (make-sparse-keymap)))
    (message "wasmacs bindings variant: both-maps-no-purecopy/coding")
    (define-key map [mode-line mouse-1] (lambda (e) (interactive "e") (ignore e)))
    (define-key map [mode-line mouse-3] (lambda (e) (interactive "e") (ignore e)))
    map)
  "Local keymap for the coding-system part of the mode line.")' perl -0pe '
  my $replacement = $ENV{"WASMACS_REPLACEMENT"};
  s/\(defvar mode-line-input-method-map\n  \(let \(\(map \(make-sparse-keymap\)\)\).*?\n    \(purecopy map\)\)\)\n\n\(defvar mode-line-coding-system-map\n  \(let \(\(map \(make-sparse-keymap\)\)\).*?\n    \(purecopy map\)\)\n  "Local keymap for the coding-system part of the mode line\."\)/$replacement/s;
' "${backup_bindings}" > "${probe_dir}/bindings.both-maps-no-purecopy.el"

replace_defvar "first-define" "(defvar mode-line-input-method-map
  (let ((map (make-sparse-keymap)))
    (message \"wasmacs bindings variant: first-define before\")
    (define-key map [mode-line mouse-2] 'ignore)
    (message \"wasmacs bindings variant: first-define after\")
    map))"

replace_defvar "two-defines" "(defvar mode-line-input-method-map
  (let ((map (make-sparse-keymap)))
    (message \"wasmacs bindings variant: two-defines before first\")
    (define-key map [mode-line mouse-2] 'ignore)
    (message \"wasmacs bindings variant: two-defines before second\")
    (define-key map [mode-line mouse-3] 'ignore)
    (message \"wasmacs bindings variant: two-defines after second\")
    map))"

{
  printf 'pdump bindings defvar variants probe\n'
  printf 'real bindings: %s\n' "${real_bindings}"
  printf '\n'
} > "${log_file}"

run_variant() {
  local variant="$1"
  {
    printf '\n=== variant:%s ===\n' "${variant}"
  } | tee -a "${log_file}"
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
run_variant "nil-only"
run_variant "string-only"
run_variant "both-map-defvars-nil"
run_variant "both-maps-no-purecopy"
run_variant "map-only"
run_variant "first-define"
run_variant "two-defines"

rg -q 'VARIANT_STATUS:nil-only:' "${log_file}"
rg -q 'VARIANT_STATUS:string-only:' "${log_file}"
rg -q 'VARIANT_STATUS:both-map-defvars-nil:' "${log_file}"
rg -q 'VARIANT_STATUS:both-maps-no-purecopy:' "${log_file}"
rg -q 'VARIANT_STATUS:map-only:' "${log_file}"
rg -q 'VARIANT_STATUS:first-define:' "${log_file}"
rg -q 'VARIANT_STATUS:two-defines:' "${log_file}"

printf 'RESULT:PASS variant probe recorded\n' | tee -a "${log_file}"
