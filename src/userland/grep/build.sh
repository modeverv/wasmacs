#!/usr/bin/env bash
# Build GNU grep as a wasmacs process image (runs under src/runtime/process).
#
#   src/userland/grep/build.sh           build
#   src/userland/grep/build.sh --clean   remove the work directory
#
# Output: build/artifacts/userland/grep.{js,wasm}.
#
# Why GNU grep and not the BusyBox applet: Emacs is written against it.
# M-x grep, lgrep, rgrep and the xref/project search commands use --null,
# --color, --exclude and --directories=skip, and parse GNU grep's messages.
# grep itself is not patched.
#
# Configuration (cross build against Emscripten's musl libc): no NLS, no PCRE
# (-P), no threads; gnulib's regex and getopt are used, because musl has
# neither the GNU regex API nor a fully GNU-compatible getopt.
#
# Idempotent: downloads the release tarball if missing, verifies its sha256,
# configures once (about 90 seconds), compiles and links only what is out of
# date.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${here}/../../.." && pwd)"
source "${repo_root}/src/runtime/process/child/wasmacs-child-flags.sh"

GREP_VERSION=${GREP_VERSION:-3.12}
case "${GREP_VERSION}" in
  # sha256 of the tarball whose signature (grep-3.12.tar.xz.sig, key
  # 155D3FC500C834486D1EEA677FD9FCCB000BEEEE, Jim Meyering) was verified.
  3.12) GREP_SHA256=2649b27c0e90e632eadcd757be06c6e9a4f48d941de51e7c0f83ff76408a07b9 ;;
  *) echo "build.sh: no pinned sha256 for grep ${GREP_VERSION}" >&2; exit 2 ;;
esac
tarball_name=grep-${GREP_VERSION}.tar.xz
url=https://ftp.gnu.org/gnu/grep/${tarball_name}
JOBS=${JOBS:-$( (sysctl -n hw.ncpu || nproc) 2>/dev/null | head -1)}
# Emscripten's default C stack is 64 KiB; the regex matcher recurses.
STACK_SIZE=${WASMACS_GREP_STACK_SIZE:-1048576}

work="${repo_root}/build/userland/grep"
dl="${repo_root}/build/userland/dl"
tarball="${dl}/${tarball_name}"
src="${work}/src/grep-${GREP_VERSION}"
bld="${work}/build"
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
for tool in emcc emar emconfigure node curl shasum tar; do
  command -v "${tool}" >/dev/null 2>&1 || die "missing tool: ${tool}"
done
case "${repo_root}" in *[[:space:]]*) die "path contains whitespace (configure cannot cope): ${repo_root}" ;; esac
mkdir -p "${dl}" "${out}" "${work}/src"

# ------------------------------------------------- 1. download + verify
if [ ! -f "${tarball}" ]; then
  say "downloading ${url}"
  curl -fsSL --retry 3 -o "${tarball}.part" "${url}"
  mv "${tarball}.part" "${tarball}"
fi
actual=$(shasum -a 256 "${tarball}" | awk '{print $1}')
[ "${actual}" = "${GREP_SHA256}" ] || die "sha256 mismatch for ${tarball_name}: got ${actual}, want ${GREP_SHA256}"

# ------------------------------------------------------------ 2. extract
if [ ! -f "${src}/.wasmacs-extracted" ]; then
  say "extracting ${tarball_name}"
  rm -rf "${src}"
  tar -xJf "${tarball}" -C "${work}/src"
  touch "${src}/.wasmacs-extracted"
fi

# ---------------------------------------------------------- 3. configure
# --enable-cross-guesses=risky: assume a sane, modern libc for the checks
# that cannot run when cross compiling (musl is one); the two exceptions are
# spelled out.  Dependency tracking is off, so a changed configuration
# starts from an empty build directory.
configure_args=(
  --host=wasm32-unknown-emscripten
  --prefix=/usr
  --disable-nls
  --disable-perl-regexp
  --disable-threads
  --disable-dependency-tracking
  --enable-cross-guesses=risky
  --with-included-regex
  gl_cv_func_getopt_gnu=no
  gl_cv_func_getopt_posix=no
  CFLAGS=-O2
)
configure_key="${GREP_VERSION} ${configure_args[*]}"
if [ ! -f "${bld}/config.status" ] || [ "$(cat "${bld}/.wasmacs-configure-key" 2>/dev/null)" != "${configure_key}" ]; then
  say "configuring grep ${GREP_VERSION} (emconfigure, about 90 seconds)"
  rm -rf "${bld}"
  mkdir -p "${bld}"
  (cd "${bld}" && emconfigure "${src}/configure" --build="$(sh "${src}/build-aux/config.guess")" "${configure_args[@]}") \
    > "${work}/configure.log" 2>&1 \
    || { tail -30 "${work}/configure.log" | cut -c1-300 >&2; die "configure failed (see ${work}/configure.log)"; }
  printf '%s\n' "${configure_key}" > "${bld}/.wasmacs-configure-key"
fi

# ------------------------------------------------------------ 4. compile
# gnulib (lib/libgreputils.a) and the objects of the grep program; the link
# is done below with the flags every wasmacs process needs.
say "compiling grep ${GREP_VERSION} (${gmake_bin} -j${JOBS})"
objects=$(cd "${bld}/src" && "${gmake_bin}" -s --no-print-directory --eval='wasmacs-print-objects: ; @echo $(grep_OBJECTS)' wasmacs-print-objects)
[ -n "${objects}" ] || die "could not determine the objects of the grep program"
{
  "${gmake_bin}" -C "${bld}/lib" -j"${JOBS}"
  # shellcheck disable=SC2086
  "${gmake_bin}" -C "${bld}/src" -j"${JOBS}" ${objects}
} > "${work}/compile.log" 2>&1 \
  || { grep -n 'error' "${work}/compile.log" | head -20 | cut -c1-300 >&2; die "compile failed (see ${work}/compile.log)"; }

rt_obj="${work}/wasmacs-child-rt.o"
if [ ! -f "${rt_obj}" ] || [ "${wasmacs_child_rt_c}" -nt "${rt_obj}" ]; then
  emcc -O2 -c "${wasmacs_child_rt_c}" -o "${rt_obj}"
fi

# --------------------------------------------------------------- 5. link
printf '{"type":"commonjs"}\n' > "${out}/package.json"
link_inputs=()
for object in ${objects}; do link_inputs+=("${bld}/src/${object}"); done
link_inputs+=("${bld}/lib/libgreputils.a" "${rt_obj}")
ldflags="-O2 -Wno-js-compiler ${wasmacs_child_ldflags} -sEXPORT_NAME=wasmacsProgram_grep -sSTACK_SIZE=${STACK_SIZE}"
key=$( { echo "${ldflags}"; ls -lT "${link_inputs[@]}" \
  "${wasmacs_child_dir}/wasmacs-child-library.js" "${wasmacs_child_dir}/wasmacs-child-pre.js"; } | shasum -a 256 | awk '{print $1}')
if [ -f "${out}/grep.js" ] && [ -f "${out}/grep.wasm" ] && [ "$(cat "${work}/.linkkey" 2>/dev/null)" = "${key}" ]; then
  say "link: up to date"
else
  say "linking grep (Asyncify)"
  # shellcheck disable=SC2086
  emcc ${ldflags} -o "${out}/grep.js" "${link_inputs[@]}" > "${work}/link.log" 2>&1 \
    || { tail -40 "${work}/link.log" | cut -c1-300 >&2; die "link failed (see ${work}/link.log)"; }
  printf '%s\n' "${key}" > "${work}/.linkkey"
fi

say "grep: wasm $(wc -c < "${out}/grep.wasm" | tr -d ' ') bytes, js $(wc -c < "${out}/grep.js" | tr -d ' ') bytes"
