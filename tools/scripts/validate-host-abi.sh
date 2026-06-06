#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
doc="$repo_root/doc/host-abi.md"
wit="$repo_root/build/artifacts/host-abi.wit"

node "$repo_root/src/build/generate-host-abi-wit.mjs" >/dev/null

test -f "$doc"
test -f "$wit"

for pattern in \
  'path_open' \
  'read' \
  'write' \
  'stat' \
  'readdir' \
  'rename' \
  'unlink' \
  'mkdir' \
  'sync' \
  'wall-now-ms' \
  'monotonic-now-ms' \
  'random-bytes' \
  'getenv' \
  'stdout' \
  'Network Fetch' \
  'fetch\(request\) -> response' \
  'package.el' \
  'GUI Protocol' \
  'Process Surface' \
  'Emscripten Compatibility' \
  'must not call DOM'
do
  rg "$pattern" "$doc" >/dev/null
done

for pattern in \
  '^interface filesystem' \
  '^interface clock' \
  '^interface random' \
  '^interface environment' \
  '^interface stdio' \
  '^interface network' \
  '^interface process' \
  '^interface gui' \
  '^world emacs-core-host' \
  'path-open: func' \
  'readdir: func' \
  'random-bytes: func' \
  'process-unavailable: func' \
  'fetch: func' \
  'flush-draw: func' \
  'read-clipboard: func' \
  'write-clipboard: func'
do
  rg "$pattern" "$wit" >/dev/null
done

if rg 'DOM|OPFS|IndexedDB|Clipboard API|Canvas' "$wit" >/dev/null; then
  echo "WIT must not expose browser implementation APIs directly" >&2
  exit 1
fi

echo "host ABI validation passed"
