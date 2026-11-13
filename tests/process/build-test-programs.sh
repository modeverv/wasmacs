#!/usr/bin/env bash
# Build the kernel test programs into build/process-tests/.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out="${repo_root}/build/process-tests"
src="${repo_root}/tests/process/programs"
source "${repo_root}/src/runtime/process/child/wasmacs-child-flags.sh"
mkdir -p "${out}"
# Emscripten's Node output is CommonJS; the repository package is an ES module.
printf '{"type":"commonjs"}\n' > "${out}/package.json"

newer() { # newer <target> <deps...>: true if target is missing or older than a dep
  local target="$1"; shift
  [ -f "${target}" ] || return 0
  local dep
  for dep in "$@"; do [ "${dep}" -nt "${target}" ] && return 0; done
  return 1
}

child_deps=("${wasmacs_child_rt_c}" "${wasmacs_child_dir}/wasmacs-child-library.js" "${wasmacs_child_dir}/wasmacs-child-pre.js" "${wasmacs_child_dir}/wasmacs-child-flags.sh")

if newer "${out}/ktest.js" "${src}/ktest.c" "${child_deps[@]}"; then
  echo "building ktest"
  # shellcheck disable=SC2086
  emcc -O2 ${WASMACS_TEST_CFLAGS:-} "${src}/ktest.c" "${wasmacs_child_rt_c}" -o "${out}/ktest.js" \
    ${wasmacs_child_ldflags} -sEXPORT_NAME=wasmacsProgram_ktest -sSTACK_SIZE=1048576
fi

if newer "${out}/fshost.js" "${src}/fshost.c"; then
  echo "building fshost"
  emcc -O2 "${src}/fshost.c" -o "${out}/fshost.js" \
    -sMODULARIZE=1 -sEXPORT_NAME=wasmacsFsHost -sEXIT_RUNTIME=0 -sALLOW_MEMORY_GROWTH=1 \
    -sENVIRONMENT=node -sFORCE_FILESYSTEM=1 \
    -sEXPORTED_FUNCTIONS=_main,_malloc,_free \
    -sEXPORTED_RUNTIME_METHODS=FS,HEAPU8,HEAP32,HEAP16,UTF8ToString,stringToUTF8,lengthBytesUTF8
fi

if newer "${out}/consts.js" "${src}/consts.c"; then
  echo "building consts"
  emcc -O1 "${src}/consts.c" -o "${out}/consts.js" -sENVIRONMENT=node
fi
echo "process test programs: ${out}"
