#!/usr/bin/env bash
# Build git as a wasmacs process image (runs under src/runtime/process).
#
#   src/userland/git/build.sh           build
#   src/userland/git/build.sh --clean   remove the work directory
#
# Output: build/artifacts/userland/{git,git-http}.{js,wasm}.
#
# The "git" binary and upstream remote-curl helper are built: no perl/python/tcl
# scripts, no curl/expat (HTTP uses the browser adapter), no gettext, no openssl
# (bundled SHA-1/SHA-256), zlib from the Emscripten port.  All Makefile knobs
# are in config.mak.  git itself is not patched.
#
# Idempotent: downloads the release tarball if missing, verifies its sha256,
# compiles and links only what is out of date.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${here}/../../.." && pwd)"
source "${repo_root}/src/runtime/process/child/wasmacs-child-flags.sh"

GIT_VERSION=${GIT_VERSION:-2.52.1}
case "${GIT_VERSION}" in
  2.52.1) GIT_SHA256=2c85e1fabf6000f732657999d015562ca8af2c988723625ef8d0ba0a8e494b39 ;;
  *) echo "build.sh: no pinned sha256 for git ${GIT_VERSION}" >&2; exit 2 ;;
esac
tarball_name=git-${GIT_VERSION}.tar.xz
url=https://mirrors.edge.kernel.org/pub/software/scm/git/${tarball_name}
JOBS=${JOBS:-$( (sysctl -n hw.ncpu || nproc) 2>/dev/null | head -1)}
# Emscripten's default C stack is 64 KiB: far too small for git (PATH_MAX
# buffers, recursive tree walks).
STACK_SIZE=${WASMACS_GIT_STACK_SIZE:-4194304}

work="${repo_root}/build/userland/git"
dl="${repo_root}/build/userland/dl"
tarball="${dl}/${tarball_name}"
src="${work}/src/git-${GIT_VERSION}"
out="${repo_root}/build/artifacts/userland"

if [ "${1:-}" = "--clean" ]; then
  rm -rf "${work}"
  echo "cleaned ${work}"
  exit 0
fi

say() { printf '== %s\n' "$*"; }
die() { printf 'build.sh: %s\n' "$*" >&2; exit 1; }

gmake_bin=$(command -v gmake || command -v make)
"${gmake_bin}" --version 2>/dev/null | head -1 | grep -q 'GNU Make [4-9]' \
  || die "GNU make >= 4 is required (macOS: brew install make)"
for tool in emcc emar node curl shasum tar; do
  command -v "${tool}" >/dev/null 2>&1 || die "missing tool: ${tool}"
done
mkdir -p "${dl}" "${out}" "${work}/src"

# ------------------------------------------------- 1. download + verify
if [ ! -f "${tarball}" ]; then
  say "downloading ${url}"
  curl -fsSL -o "${tarball}.part" "${url}"
  mv "${tarball}.part" "${tarball}"
fi
actual=$(shasum -a 256 "${tarball}" | awk '{print $1}')
[ "${actual}" = "${GIT_SHA256}" ] || die "sha256 mismatch for ${tarball_name}: got ${actual}, want ${GIT_SHA256}"

# ------------------------------------------------------------ 2. extract
if [ ! -f "${src}/.wasmacs-extracted" ]; then
  say "extracting ${tarball_name}"
  rm -rf "${src}"
  tar -xJf "${tarball}" -C "${work}/src"
  touch "${src}/.wasmacs-extracted"
fi

# ---------------------------------------------------------- 3. config.mak
cmp -s "${here}/config.mak" "${src}/config.mak" 2>/dev/null || cp "${here}/config.mak" "${src}/config.mak"
cmp -s "${here}/http-browser.c" "${src}/wasmacs-http-browser.c" 2>/dev/null || cp "${here}/http-browser.c" "${src}/wasmacs-http-browser.c"

# uname_* must be overridden on the command line: config.mak.uname would
# otherwise detect the build host (e.g. Darwin) and apply its block.
make_args=(uname_S=Emscripten uname_M=wasm32 uname_O=Emscripten uname_R=5 uname_V=1 X=.js "WASMACS_HTTP_INCLUDE=${here}")

# ------------------------------------------------------------ 4. compile
say "compiling git ${GIT_VERSION} (${gmake_bin} -j${JOBS})"
(cd "${src}" && "${gmake_bin}" -j"${JOBS}" "${make_args[@]}" wasmacs-objects wasmacs-http-objects) > "${work}/compile.log" 2>&1 \
  || { tail -40 "${work}/compile.log" | cut -c1-300 >&2; die "compile failed (see ${work}/compile.log)"; }

rt_obj="${work}/wasmacs-child-rt.o"
if [ ! -f "${rt_obj}" ] || [ "${wasmacs_child_rt_c}" -nt "${rt_obj}" ]; then
  emcc -O2 -c "${wasmacs_child_rt_c}" -o "${rt_obj}"
fi

# --------------------------------------------------------------- 5. link
printf '{"type":"commonjs"}\n' > "${out}/package.json"
ldflags="-Wno-js-compiler ${wasmacs_child_ldflags} -sEXPORT_NAME=wasmacsProgram_git -sSTACK_SIZE=${STACK_SIZE} ${rt_obj}"
key=$( { echo "${ldflags}"; cd "${src}" && ls -lT libgit.a git.o common-main.o builtin/*.o "${rt_obj}" \
  "${wasmacs_child_dir}/wasmacs-child-library.js" "${wasmacs_child_dir}/wasmacs-child-pre.js" config.mak; } | shasum -a 256 | awk '{print $1}')
if [ -f "${out}/git.js" ] && [ -f "${out}/git.wasm" ] && [ "$(cat "${work}/.linkkey" 2>/dev/null)" = "${key}" ]; then
  say "link: up to date"
else
  say "linking git (Asyncify, this takes a moment)"
  rm -f "${src}/git.js" "${src}/git.wasm"
  (cd "${src}" && "${gmake_bin}" -j"${JOBS}" V=1 "${make_args[@]}" LDFLAGS="${ldflags}" git.js) > "${work}/link.log" 2>&1 \
    || { tail -40 "${work}/link.log" | cut -c1-300 >&2; die "link failed (see ${work}/link.log)"; }
  mv "${src}/git.js" "${src}/git.wasm" "${out}/"
  printf '%s\n' "${key}" > "${work}/.linkkey"
fi

say "git: wasm $(wc -c < "${out}/git.wasm" | tr -d ' ') bytes, js $(wc -c < "${out}/git.js" | tr -d ' ') bytes"

# The helper is a separate image selected by /usr/libexec/git-core/git-remote-
# http and -https markers. Its Git protocol implementation is remote-curl.c,
# unchanged from the pinned tarball; only HTTP crosses the host boundary.
http_ldflags="-Wno-js-compiler ${wasmacs_child_ldflags} -sEXPORT_NAME=wasmacsProgram_git_http -sSTACK_SIZE=${STACK_SIZE} ${rt_obj}"
http_key=$( { echo "${http_ldflags}"; cd "${src}" && ls -lT libgit.a remote-curl.o wasmacs-http-browser.o common-main.o "${rt_obj}" \
  "${wasmacs_child_dir}/wasmacs-child-library.js" "${wasmacs_child_dir}/wasmacs-child-pre.js" \
  "${here}/curl/curl.h" "${here}/curl/easy.h" config.mak; } | shasum -a 256 | awk '{print $1}')
if [ -f "${out}/git-http.js" ] && [ -f "${out}/git-http.wasm" ] && [ "$(cat "${work}/.http-linkkey" 2>/dev/null)" = "${http_key}" ]; then
  say "git-http link: up to date"
else
  say "linking git-http (upstream remote-curl + browser HTTP)"
  rm -f "${src}/git-http.js" "${src}/git-http.wasm"
  (cd "${src}" && "${gmake_bin}" -j"${JOBS}" V=1 "${make_args[@]}" LDFLAGS="${http_ldflags}" git-http.js) > "${work}/http-link.log" 2>&1 \
    || { tail -40 "${work}/http-link.log" | cut -c1-300 >&2; die "git-http link failed (see ${work}/http-link.log)"; }
  mv "${src}/git-http.js" "${src}/git-http.wasm" "${out}/"
  printf '%s\n' "${http_key}" > "${work}/.http-linkkey"
fi
say "git-http: wasm $(wc -c < "${out}/git-http.wasm" | tr -d ' ') bytes, js $(wc -c < "${out}/git-http.js" | tr -d ' ') bytes"
