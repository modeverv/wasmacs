#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
native_root="$repo_root/build/native-emacs-30.2/src"
image_path="$repo_root/artifacts/system-lisp-emacs-30.2.wasifs"
manifest_path="$repo_root/artifacts/system-lisp-emacs-30.2.manifest.json"
work_root="$repo_root/build/system-lisp-image"
staging_root="$work_root/root"
log_path="$repo_root/logs/system-lisp-image.txt"

source_commit="$(git -C "$repo_root/vendor/emacs" rev-parse HEAD)"
source_tag="$(git -C "$repo_root/vendor/emacs" describe --tags --exact-match HEAD)"
emacs_version="$("$native_root/src/emacs" --batch --eval '(princ emacs-version)' 2>/dev/null | tail -n 1)"

if [[ "$emacs_version" != "30.2" ]]; then
  echo "expected native baseline Emacs 30.2, got: $emacs_version" >&2
  exit 1
fi

if [[ ! -d "$native_root/lisp" ]]; then
  echo "missing native lisp tree: $native_root/lisp" >&2
  exit 1
fi

mkdir -p "$repo_root/artifacts" "$repo_root/logs"
rm -rf "$work_root"
mkdir -p "$staging_root/system"

{
  echo "# System Lisp Image"
  echo
  echo "date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "source: vendor/emacs"
  echo "commit: $source_commit"
  echo "tag: $source_tag"
  echo "emacs_version: $emacs_version"
  echo "image: artifacts/$(basename "$image_path")"
  echo "manifest: artifacts/$(basename "$manifest_path")"
} >"$log_path"

rsync -a \
  --include='*/' \
  --include='*.el' \
  --include='*.elc' \
  --exclude='*' \
  "$native_root/lisp/" "$staging_root/system/lisp/"

rsync -a \
  --include='*/' \
  --include='charsets/***' \
  --include='tutorials/***' \
  --include='HELLO' \
  --include='TUTORIAL*' \
  --include='NEWS*' \
  --include='DOC*' \
  --exclude='*' \
  "$native_root/etc/" "$staging_root/system/etc/"

el_count="$(find "$staging_root/system/lisp" -type f -name '*.el' | wc -l | tr -d ' ')"
elc_count="$(find "$staging_root/system/lisp" -type f -name '*.elc' | wc -l | tr -d ' ')"
loaddefs_count="$(find "$staging_root/system/lisp" -type f -name '*loaddefs.el' | wc -l | tr -d ' ')"
file_count="$(find "$staging_root/system" -type f | wc -l | tr -d ' ')"

if [[ "$el_count" -eq 0 || "$elc_count" -eq 0 || "$loaddefs_count" -eq 0 ]]; then
  echo "system image requires .el, .elc, and generated loaddefs" >&2
  echo "el=$el_count elc=$elc_count loaddefs=$loaddefs_count" >&2
  exit 1
fi

tar -C "$staging_root" -cf "$image_path" system
content_hash="$(shasum -a 256 "$image_path" | awk '{print $1}')"
created_utc="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

cat >"$manifest_path" <<EOF
{
  "schema_version": 1,
  "kind": "system-lisp.wasifs",
  "format": "tar",
  "emacs_version": "$emacs_version",
  "source_commit": "$source_commit",
  "source_tag": "$source_tag",
  "created_utc": "$created_utc",
  "root_prefix": "/system",
  "mount": {
    "path": "/system",
    "writable": false
  },
  "contents": {
    "lisp_el_files": $el_count,
    "lisp_elc_files": $elc_count,
    "loaddefs_files": $loaddefs_count,
    "total_files": $file_count
  },
  "content_hash": {
    "algorithm": "sha256",
    "value": "$content_hash"
  }
}
EOF

{
  echo "lisp_el_files: $el_count"
  echo "lisp_elc_files: $elc_count"
  echo "loaddefs_files: $loaddefs_count"
  echo "total_files: $file_count"
  echo "sha256: $content_hash"
} >>"$log_path"

echo "built $image_path"
echo "wrote $manifest_path"
