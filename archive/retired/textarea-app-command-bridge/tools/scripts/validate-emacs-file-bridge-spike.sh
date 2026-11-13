#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${repo_root}/build/artifacts/emacs-browser-spike"
log_path="${repo_root}/logs/emacs-file-bridge-node.txt"

test -f "${artifact_dir}/temacs"
test -f "${artifact_dir}/temacs.wasm"
test -f "${artifact_dir}/temacs.data"

(
  cd "${artifact_dir}"
  node ./temacs --batch --eval '(progn (make-directory "/home/user" t) (with-temp-file "/home/user/notes.txt" (insert "hello emacs file bridge")) (with-temp-buffer (insert-file-contents "/home/user/notes.txt") (princ (buffer-string))))'
) > "${log_path}" 2>&1

rg 'hello emacs file bridge' "${log_path}" >/dev/null
echo "emacs file bridge validation passed"
