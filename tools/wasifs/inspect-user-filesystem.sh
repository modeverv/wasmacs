#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 artifacts/user-filesystem-empty.wasifs" >&2
  exit 2
fi

image_path="$1"

if [[ ! -f "$image_path" ]]; then
  echo "missing image: $image_path" >&2
  exit 1
fi

echo "# wasifs tar listing"
echo "image: $image_path"
echo "sha256: $(shasum -a 256 "$image_path" | awk '{print $1}')"
echo
echo "## summary"
echo "home/user entries: $(tar tf "$image_path" | rg '^home/user/' | wc -l | tr -d ' ')"
echo "journal entries: $(tar -xOf "$image_path" home/user/.local/share/wasmacs/journal.jsonl | wc -l | tr -d ' ')"
echo
echo "## entries"
tar tf "$image_path"
