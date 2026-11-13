#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
build_dir="${repo_root}/build/emacs-core-spike/build-gnu-host-internal-termcap"
source_copy="${repo_root}/build/emacs-core-spike/src"
out_dir="${repo_root}/build/artifacts/emacs-browser-spike"
emmake_bin="${EMMAKE:-emmake}"
emacs_wasm_cflags="${EMACS_WASM_CFLAGS:--g3 -O0}"
emacs_browser_ldflags="${EMACS_BROWSER_LDFLAGS:--sEXIT_RUNTIME=1 -sSTACK_SIZE=1048576 -sSTACK_OVERFLOW_CHECK=2 -sINITIAL_MEMORY=268435456 -sALLOW_MEMORY_GROWTH=1 --preload-file ${source_copy}/lisp@/usr/local/share/emacs/30.2/lisp --preload-file ${source_copy}/etc@/usr/local/share/emacs/30.2/etc}"

if ! command -v "${emmake_bin}" >/dev/null 2>&1; then
  echo "error: ${emmake_bin} not found; install/activate Emscripten first" >&2
  exit 127
fi

if [ ! -f "${build_dir}/src/Makefile" ] || [ ! -d "${source_copy}/lisp" ]; then
  "${repo_root}/tools/scripts/build-emacs-core-spike.sh"
fi

(
  cd "${build_dir}"
  rm -f src/temacs src/temacs.wasm src/temacs.data
  "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" \
    -C src \
    CFLAGS="${emacs_wasm_cflags}" \
    LDFLAGS="${emacs_browser_ldflags}" \
    temacs
)

mkdir -p "${out_dir}"
printf '{"type":"commonjs"}\n' > "${out_dir}/package.json"
cp "${build_dir}/src/temacs" "${out_dir}/temacs"
cp "${build_dir}/src/temacs.wasm" "${out_dir}/temacs.wasm"
cp "${build_dir}/src/temacs.data" "${out_dir}/temacs.data"
