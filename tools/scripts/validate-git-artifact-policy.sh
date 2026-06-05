#!/usr/bin/env bash
set -euo pipefail

max_bytes="${WASMACS_MAX_TRACKED_FILE_BYTES:-95000000}"

if git ls-files --error-unmatch docs/artifacts >/dev/null 2>&1; then
  echo "docs/artifacts contains tracked generated files" >&2
  git ls-files docs/artifacts >&2
  exit 1
fi

large_files="$(
  while IFS= read -r -d '' tracked_file; do
    if [ ! -f "${tracked_file}" ]; then
      continue
    fi
    size="$(wc -c <"${tracked_file}" | tr -d ' ')"
    if [ "${size}" -gt "${max_bytes}" ]; then
      printf '%s %s\n' "${size}" "${tracked_file}"
    fi
  done < <(git ls-files -z)
)"

if [ -n "${large_files}" ]; then
  echo "tracked files exceed ${max_bytes} bytes:" >&2
  echo "${large_files}" >&2
  exit 1
fi

echo "git artifact policy ok"
