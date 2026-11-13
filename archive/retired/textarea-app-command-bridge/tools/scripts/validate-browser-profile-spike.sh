#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${repo_root}/build/artifacts/emacs-browser-spike"
log_path="${repo_root}/logs/wasm-browser-profile-batch.txt"

test -f "${artifact_dir}/temacs"
test -f "${artifact_dir}/temacs.wasm"
test -f "${artifact_dir}/temacs.data"

if rg 'NODERAWFS is currently only supported' "${artifact_dir}/temacs" >/dev/null; then
  echo "error: browser profile still contains Node-only NODERAWFS runtime" >&2
  exit 1
fi

rg 'temacs\.data' "${artifact_dir}/temacs" >/dev/null
rg '/usr/local/share/emacs/30\.2/lisp/loadup\.el' "${artifact_dir}/temacs" >/dev/null

(
  cd "${artifact_dir}"
  node ./temacs --batch --eval '(princ "hello browser-profile")'
) > "${log_path}" 2>&1

rg 'hello browser-profile' "${log_path}" >/dev/null
echo "browser profile validation passed"
