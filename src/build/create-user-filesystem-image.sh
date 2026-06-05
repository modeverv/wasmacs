#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image_path="$repo_root/build/artifacts/user-filesystem-empty.wasifs"
manifest_path="$repo_root/build/artifacts/user-filesystem-empty.manifest.json"
work_root="$repo_root/build/user-filesystem-empty"
staging_root="$work_root/root"
log_path="$repo_root/logs/user-filesystem-image.txt"

mkdir -p "$repo_root/build/artifacts" "$repo_root/logs"
rm -rf "$work_root"
mkdir -p \
  "$staging_root/home/user/.emacs.d/lisp" \
  "$staging_root/home/user/.emacs.d/elpa" \
  "$staging_root/home/user/projects" \
  "$staging_root/home/user/.local/share/wasmacs/snapshots"

cat >"$staging_root/home/user/init.el" <<'EOF'
;;; init.el --- wasmacs empty user image -*- lexical-binding: t; -*-

;;; Commentary:
;; This file is intentionally minimal. User configuration lives in the
;; writable user filesystem image.

;;; Code:

(provide 'init)
;;; init.el ends here
EOF

: >"$staging_root/home/user/.local/share/wasmacs/journal.jsonl"

tar -C "$staging_root" -cf "$image_path" home
content_hash="$(shasum -a 256 "$image_path" | awk '{print $1}')"
created_utc="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
file_count="$(find "$staging_root/home" -type f | wc -l | tr -d ' ')"
directory_count="$(find "$staging_root/home" -type d | wc -l | tr -d ' ')"

cat >"$manifest_path" <<EOF
{
  "schema_version": 1,
  "kind": "user-filesystem.wasifs",
  "format": "tar",
  "created_utc": "$created_utc",
  "root_prefix": "/home/user",
  "mount": {
    "path": "/home/user",
    "writable": true
  },
  "contents": {
    "files": $file_count,
    "directories": $directory_count
  },
  "journal": {
    "path": "/home/user/.local/share/wasmacs/journal.jsonl",
    "format": "jsonl",
    "initial_entries": 0
  },
  "snapshot": {
    "directory": "/home/user/.local/share/wasmacs/snapshots",
    "status": "reserved"
  },
  "content_hash": {
    "algorithm": "sha256",
    "value": "$content_hash"
  }
}
EOF

{
  echo "# User Filesystem Image"
  echo
  echo "date: $created_utc"
  echo "image: build/artifacts/$(basename "$image_path")"
  echo "manifest: build/artifacts/$(basename "$manifest_path")"
  echo "files: $file_count"
  echo "directories: $directory_count"
  echo "sha256: $content_hash"
} >"$log_path"

echo "built $image_path"
echo "wrote $manifest_path"
