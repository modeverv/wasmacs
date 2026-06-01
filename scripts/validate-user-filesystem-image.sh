#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image_path="$repo_root/artifacts/user-filesystem-empty.wasifs"
manifest_path="$repo_root/artifacts/user-filesystem-empty.manifest.json"
format_doc="$repo_root/docs/wasifs-format.md"
log_path="$repo_root/logs/user-filesystem-image.txt"

test -f "$image_path"
test -f "$manifest_path"
test -f "$format_doc"
test -f "$log_path"

tar tf "$image_path" | rg '^home/user/$' >/dev/null
tar tf "$image_path" | rg '^home/user/init\.el$' >/dev/null
tar tf "$image_path" | rg '^home/user/\.emacs\.d/$' >/dev/null
tar tf "$image_path" | rg '^home/user/\.emacs\.d/lisp/$' >/dev/null
tar tf "$image_path" | rg '^home/user/\.emacs\.d/elpa/$' >/dev/null
tar tf "$image_path" | rg '^home/user/projects/$' >/dev/null
tar tf "$image_path" | rg '^home/user/\.local/share/wasmacs/journal\.jsonl$' >/dev/null
tar tf "$image_path" | rg '^home/user/\.local/share/wasmacs/snapshots/$' >/dev/null

journal_entries="$(tar -xOf "$image_path" home/user/.local/share/wasmacs/journal.jsonl | wc -l | tr -d ' ')"
if [[ "$journal_entries" != "0" ]]; then
  echo "expected empty journal, got $journal_entries entries" >&2
  exit 1
fi

rg '"schema_version": 1' "$manifest_path" >/dev/null
rg '"kind": "user-filesystem.wasifs"' "$manifest_path" >/dev/null
rg '"format": "tar"' "$manifest_path" >/dev/null
rg '"root_prefix": "/home/user"' "$manifest_path" >/dev/null
rg '"writable": true' "$manifest_path" >/dev/null
rg '"format": "jsonl"' "$manifest_path" >/dev/null
rg '"algorithm": "sha256"' "$manifest_path" >/dev/null

recorded_hash="$(awk -F'"' '/"value":/ {print $4; exit}' "$manifest_path")"
actual_hash="$(shasum -a 256 "$image_path" | awk '{print $1}')"

if [[ "$recorded_hash" != "$actual_hash" ]]; then
  echo "manifest hash does not match image" >&2
  echo "recorded: $recorded_hash" >&2
  echo "actual:   $actual_hash" >&2
  exit 1
fi

rg 'Stable vs Spike' "$format_doc" >/dev/null
rg 'Journal' "$format_doc" >/dev/null
rg 'Snapshots' "$format_doc" >/dev/null

"$repo_root/tools/wasifs/inspect-user-filesystem.sh" "$image_path" >/dev/null

echo "user filesystem image validation passed"
