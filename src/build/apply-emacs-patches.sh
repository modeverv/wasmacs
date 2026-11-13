#!/usr/bin/env bash
# Apply the wasmacs Emacs patch layer to a copied Emacs source tree.
#
#   src/build/apply-emacs-patches.sh <emacs-source-copy>
#
# vendor/emacs stays read-only.  The patch layer is the set of unified diffs in
# src/c/patches/*.patch, taken against the pinned vendor/emacs revision.
#
# Every file that any patch touches is rebuilt from scratch: the pristine file
# is taken from vendor/emacs, all patches are applied to it in file-name order
# (strictly, no fuzz), and the result replaces the file in the target tree only
# when its content changed.  The outcome therefore depends on nothing but
# vendor/emacs and the patch files, and an up-to-date tree keeps its mtimes, so
# an incremental build recompiles nothing.
#
# --check <emacs-source-copy> verifies that the target tree already matches and
# changes nothing (exit 1 on mismatch).  With --check and no tree argument only
# the patches themselves are verified against vendor/emacs.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
vendor_dir="${WASMACS_EMACS_VENDOR_DIR:-${repo_root}/vendor/emacs}"
patch_dir="${WASMACS_EMACS_PATCH_DIR:-${repo_root}/src/c/patches}"

check_only=0
if [ "${1:-}" = "--check" ]; then
  check_only=1
  shift
fi
target="${1:-}"

if [ "${check_only}" = "0" ] && [ -z "${target}" ]; then
  echo "usage: $0 [--check] <emacs-source-copy>" >&2
  exit 2
fi
if [ -n "${target}" ] && [ ! -d "${target}/src" ]; then
  echo "error: ${target} does not look like an Emacs source tree" >&2
  exit 1
fi
if [ ! -f "${vendor_dir}/src/emacs.c" ]; then
  echo "error: ${vendor_dir} is missing; run: git submodule update --init" >&2
  exit 1
fi

shopt -s nullglob
patches=("${patch_dir}"/*.patch)
shopt -u nullglob
if [ "${#patches[@]}" -eq 0 ]; then
  echo "error: no patches found in ${patch_dir}" >&2
  exit 1
fi

# Files named by the patches ("+++ b/<path>" headers).
touched_files="$(
  for patch_file in "${patches[@]}"; do
    sed -n 's|^+++ b/||p' "${patch_file}"
  done | sort -u
)"

stage="$(mktemp -d "${TMPDIR:-/tmp}/wasmacs-emacs-patches.XXXXXX")"
trap 'rm -rf "${stage}"' EXIT

while IFS= read -r rel; do
  [ -n "${rel}" ] || continue
  if [ ! -f "${vendor_dir}/${rel}" ]; then
    echo "error: patch layer names ${rel}, which is not in vendor/emacs" >&2
    exit 1
  fi
  mkdir -p "${stage}/$(dirname "${rel}")"
  cp "${vendor_dir}/${rel}" "${stage}/${rel}"
done <<<"${touched_files}"

for patch_file in "${patches[@]}"; do
  if ! (cd "${stage}" && git apply -p1 --whitespace=nowarn "${patch_file}"); then
    echo "error: ${patch_file#"${repo_root}/"} does not apply to vendor/emacs" >&2
    exit 1
  fi
done

changed=0
while IFS= read -r rel; do
  [ -n "${rel}" ] || continue
  [ -n "${target}" ] || continue
  if cmp -s "${stage}/${rel}" "${target}/${rel}"; then
    continue
  fi
  changed=$((changed + 1))
  if [ "${check_only}" = "1" ]; then
    echo "stale: ${rel}" >&2
  else
    mkdir -p "${target}/$(dirname "${rel}")"
    cp "${stage}/${rel}" "${target}/${rel}"
    echo "patched: ${rel}"
  fi
done <<<"${touched_files}"

if [ "${check_only}" = "1" ] && [ "${changed}" -gt 0 ]; then
  echo "error: ${target} does not match vendor/emacs + src/c/patches" >&2
  exit 1
fi

echo "emacs patch layer ok (${#patches[@]} patches, $(printf '%s\n' "${touched_files}" | grep -c .) files, ${changed} updated)"
