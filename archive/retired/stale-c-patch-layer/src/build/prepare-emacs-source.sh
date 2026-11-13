#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
emacs_version="${WASMACS_EMACS_VERSION:-30.2}"
work_dir="${WASMACS_EMACS_WORK_DIR:-${repo_root}/build/emacs-${emacs_version}-patched}"
src_dir="${work_dir}/src"
patch_dir="${repo_root}/src/c/patches"

rm -rf "${work_dir}"
mkdir -p "${work_dir}"
cp -R "${repo_root}/vendor/emacs" "${src_dir}"

if compgen -G "${patch_dir}/*.patch" >/dev/null; then
  for patch_file in "${patch_dir}"/*.patch; do
    echo "Applying ${patch_file#${repo_root}/}"
    patch -d "${src_dir}" -p1 < "${patch_file}"
  done
fi

echo "Prepared Emacs source: ${src_dir}"
