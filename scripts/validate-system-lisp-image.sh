#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image_path="$repo_root/artifacts/system-lisp-emacs-30.2.wasifs"
manifest_path="$repo_root/artifacts/system-lisp-emacs-30.2.manifest.json"
log_path="$repo_root/logs/system-lisp-image.txt"
expected_commit="636f166cfc86aa90d63f592fd99f3fdd9ef95ebd"

test -f "$image_path"
test -f "$manifest_path"
test -f "$log_path"

tar tf "$image_path" | rg '^system/lisp/.+\.el$' >/dev/null
tar tf "$image_path" | rg '^system/lisp/.+\.elc$' >/dev/null
tar tf "$image_path" | rg '^system/lisp/.+loaddefs\.el$' >/dev/null
tar tf "$image_path" | rg '^system/etc/' >/dev/null

rg '"schema_version": 1' "$manifest_path" >/dev/null
rg '"kind": "system-lisp.wasifs"' "$manifest_path" >/dev/null
rg '"format": "tar"' "$manifest_path" >/dev/null
rg '"emacs_version": "30.2"' "$manifest_path" >/dev/null
rg "\"source_commit\": \"$expected_commit\"" "$manifest_path" >/dev/null
rg '"root_prefix": "/system"' "$manifest_path" >/dev/null
rg '"writable": false' "$manifest_path" >/dev/null
rg '"algorithm": "sha256"' "$manifest_path" >/dev/null

recorded_hash="$(awk -F'"' '/"value":/ {print $4; exit}' "$manifest_path")"
actual_hash="$(shasum -a 256 "$image_path" | awk '{print $1}')"

if [[ "$recorded_hash" != "$actual_hash" ]]; then
  echo "manifest hash does not match image" >&2
  echo "recorded: $recorded_hash" >&2
  echo "actual:   $actual_hash" >&2
  exit 1
fi

"$repo_root/tools/wasifs/inspect-system-lisp.sh" "$image_path" >/dev/null

echo "system lisp image validation passed"
