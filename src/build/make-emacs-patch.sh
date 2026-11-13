#!/usr/bin/env bash
# (Re)generate one patch of the Emacs patch layer from an edited source tree.
#
#   src/build/make-emacs-patch.sh <emacs-source-copy> <NNNN-name.patch> <file>...
#
# The patch is the difference, for the named files, between
#   vendor/emacs + every patch that sorts before <NNNN-name.patch>
# and the edited tree.  Files are paths relative to the Emacs tree, e.g.
# src/keyboard.c.  Afterwards
#   src/build/apply-emacs-patches.sh --check <emacs-source-copy>
# must pass.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
vendor_dir="${WASMACS_EMACS_VENDOR_DIR:-${repo_root}/vendor/emacs}"
patch_dir="${WASMACS_EMACS_PATCH_DIR:-${repo_root}/src/c/patches}"

if [ "$#" -lt 3 ]; then
  echo "usage: $0 <emacs-source-copy> <NNNN-name.patch> <file>..." >&2
  exit 2
fi
target="$1"; patch_name="$2"; shift 2

stage="$(mktemp -d "${TMPDIR:-/tmp}/wasmacs-make-patch.XXXXXX")"
trap 'rm -rf "${stage}"' EXIT

for rel in "$@"; do
  mkdir -p "${stage}/$(dirname "${rel}")"
  cp "${vendor_dir}/${rel}" "${stage}/${rel}"
done

shopt -s nullglob
for earlier in "${patch_dir}"/*.patch; do
  [[ "$(basename "${earlier}")" < "${patch_name}" ]] || continue
  # Only the hunks for the files we are regenerating matter.
  for rel in "$@"; do
    if grep -q "^+++ b/${rel}\$" "${earlier}"; then
      (cd "${stage}" && git apply -p1 --whitespace=nowarn --include="${rel}" "${earlier}")
    fi
  done
done
shopt -u nullglob

out="${patch_dir}/${patch_name}"
: > "${out}"
for rel in "$@"; do
  if ! cmp -s "${stage}/${rel}" "${target}/${rel}"; then
    diff -u --label "a/${rel}" --label "b/${rel}" "${stage}/${rel}" "${target}/${rel}" >> "${out}" || true
  fi
done
if [ ! -s "${out}" ]; then
  rm -f "${out}"
  echo "no differences: ${patch_name} not written" >&2
  exit 1
fi
echo "wrote ${out#"${repo_root}/"} ($(grep -c '^[+-][^+-]' "${out}") changed lines)"
