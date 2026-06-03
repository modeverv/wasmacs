#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_src="${repo_root}/build/emacs-pdump-configure-probe/src"
build_dir="${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump/src"
probe_dir="${repo_root}/build/emacs-pdump-configure-probe/bindings-progress"
real_bindings="${build_src}/lisp/bindings.el"
backup_bindings="${probe_dir}/bindings.el.original"
log_file="${repo_root}/logs/emacs-pdump-bindings-progress.txt"

if [ ! -f "${build_dir}/temacs" ] || [ ! -f "${build_dir}/temacs.wasm" ]; then
  "${repo_root}/scripts/probe-emacs-pdump-temacs-build.sh"
fi

mkdir -p "${probe_dir}" "${repo_root}/logs"

perl -0777 -ne '
  my $s = $_;
  my $depth = 0;
  my $in_string = 0;
  my $escape = 0;
  my $line = 1;
  my $form_start = 0;
  my $out = "";
  my $len = length($s);
  for (my $i = 0; $i < $len; $i++) {
    my $ch = substr($s, $i, 1);
    my $line_start = ($i == 0 || substr($s, $i - 1, 1) eq "\n");
    my $at_top_open = (!$in_string && $depth == 0 && $line_start && $ch eq "(");
    $form_start = $line if $at_top_open;

    $out .= $ch;

    if ($in_string) {
      if ($escape) {
        $escape = 0;
      } elsif ($ch eq "\\") {
        $escape = 1;
      } elsif ($ch eq "\"") {
        $in_string = 0;
      }
    } else {
      if ($ch eq ";") {
        while ($i + 1 < $len) {
          my $next = substr($s, $i + 1, 1);
          last if $next eq "\n";
          $i++;
          $out .= $next;
        }
      } elsif ($ch eq "\"") {
        $in_string = 1;
      } elsif ($ch eq "(") {
        $depth++;
      } elsif ($ch eq ")") {
        $depth--;
        if ($depth == 0 && $form_start) {
          $out .= "\n(message \"wasmacs bindings probe: completed top-level form from line $form_start\")";
          $form_start = 0;
        }
      }
    }
    $line++ if $ch eq "\n";
  }
  print $out;
' "${real_bindings}" > "${probe_dir}/bindings.el.instrumented"

{
  printf 'pdump bindings progress probe\n'
  printf 'instrumented bindings: %s\n' "${probe_dir}/bindings.el.instrumented"
  printf '\n'
} > "${log_file}"

set +e
(
  cd "${build_dir}"
  cp "${real_bindings}" "${backup_bindings}"
  trap 'cp "${backup_bindings}" "${real_bindings}"' EXIT
  cp "${probe_dir}/bindings.el.instrumented" "${real_bindings}"
  EMACSLOADPATH="${build_src}/lisp" \
    node --stack-size=65500 ./temacs --batch -l loadup --temacs=pdump
) 2>&1 | tee -a "${log_file}"
status=${PIPESTATUS[0]}
set -e

printf '\nSTATUS:%s\n' "${status}" | tee -a "${log_file}"

rg -q 'wasmacs bindings probe:' "${log_file}"

if [ "${status}" -eq 0 ]; then
  printf 'RESULT:PASS instrumented bindings completed\n' | tee -a "${log_file}"
else
  last_line="$(rg 'wasmacs bindings probe:' "${log_file}" | tail -1 || true)"
  printf 'RESULT:KNOWN_BLOCKER bindings status %s after %s\n' "${status}" "${last_line}" | tee -a "${log_file}"
fi
