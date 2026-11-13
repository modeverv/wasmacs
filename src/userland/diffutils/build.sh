#!/usr/bin/env bash
# Build GNU diff and diff3 as separate wasmacs Process Service images.
#
#   src/userland/diffutils/build.sh           build both images
#   src/userland/diffutils/build.sh --clean   remove the work directory
#
# Upstream diffutils is unchanged. Ediff needs normal-format diff output and
# Unix diff3 output; BusyBox's diff only emits unified-format output.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${here}/../../.." && pwd)"
source "${repo_root}/src/runtime/process/child/wasmacs-child-flags.sh"

DIFFUTILS_VERSION=${DIFFUTILS_VERSION:-3.12}
case "${DIFFUTILS_VERSION}" in
  # Verified release signature: Jim Meyering,
  # 155D3FC500C834486D1EEA677FD9FCCB000BEEEE. The same SHA256 is published at
  # https://lists.gnu.org/archive/html/info-gnu/2025-04/msg00005.html
  3.12) DIFFUTILS_SHA256=7c8b7f9fc8609141fdea9cece85249d308624391ff61dedaf528fcb337727dfd ;;
  *) echo "build.sh: no pinned sha256 for diffutils ${DIFFUTILS_VERSION}" >&2; exit 2 ;;
esac
tarball_name=diffutils-${DIFFUTILS_VERSION}.tar.xz
url=https://ftp.gnu.org/gnu/diffutils/${tarball_name}
JOBS=${JOBS:-$( (sysctl -n hw.ncpu || nproc) 2>/dev/null | head -1)}
STACK_SIZE=${WASMACS_DIFFUTILS_STACK_SIZE:-1048576}

work="${repo_root}/build/userland/diffutils"
dl="${work}/dl"
tarball="${dl}/${tarball_name}"
src="${work}/src/diffutils-${DIFFUTILS_VERSION}"
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
for tool in emcc emar emconfigure curl shasum tar; do
  command -v "${tool}" >/dev/null 2>&1 || die "missing tool: ${tool}"
done
case "${repo_root}" in *[[:space:]]*) die "path contains whitespace (configure cannot cope): ${repo_root}" ;; esac
mkdir -p "${dl}" "${out}" "${work}/src"

if [ ! -f "${tarball}" ]; then
  say "downloading ${url}"
  curl -fsSL --retry 3 -o "${tarball}.part" "${url}"
  mv "${tarball}.part" "${tarball}"
fi
actual=$(shasum -a 256 "${tarball}" | awk '{print $1}')
[ "${actual}" = "${DIFFUTILS_SHA256}" ] || die "sha256 mismatch for ${tarball_name}: got ${actual}, want ${DIFFUTILS_SHA256}"

if [ ! -f "${src}/.wasmacs-extracted" ]; then
  say "extracting ${tarball_name}"
  rm -rf "${src}"
  tar -xJf "${tarball}" -C "${work}/src"
  touch "${src}/.wasmacs-extracted"
fi

# Use gnulib's GNU-compatible regex/getopt on Emscripten's musl libc.
# These settings match the GNU grep cross build. diff3 uses the Process
# Service's fork/exec/wait support to run "diff" through PATH.
configure_args=(
  --host=wasm32-unknown-emscripten
  --prefix=/usr
  --disable-nls
  --disable-threads
  --disable-dependency-tracking
  --enable-cross-guesses=risky
  --with-included-regex
  gl_cv_func_getopt_gnu=no
  gl_cv_func_getopt_posix=no
  # This release's strcasecmp locale probe has no cross-compile branch.
  # Select gnulib's implementation instead of assuming host locale behavior.
  gl_cv_func_strcasecmp_works=no
  # Emscripten itself stubs fork; wasmacs-child-rt provides the working fork.
  ac_cv_func_fork_works=yes
  CFLAGS=-O2
)
configure_key="${DIFFUTILS_VERSION} ${configure_args[*]}"
if [ ! -f "${bld}/config.status" ] || [ "$(cat "${bld}/.wasmacs-configure-key" 2>/dev/null)" != "${configure_key}" ]; then
  say "configuring diffutils ${DIFFUTILS_VERSION}"
  rm -rf "${bld}"
  mkdir -p "${bld}"
  (cd "${bld}" && emconfigure "${src}/configure" --build="$(sh "${src}/build-aux/config.guess")" "${configure_args[@]}") \
    > "${work}/configure.log" 2>&1 \
    || { tail -30 "${work}/configure.log" | cut -c1-300 >&2; die "configure failed (see ${work}/configure.log)"; }
  printf '%s\n' "${configure_key}" > "${bld}/.wasmacs-configure-key"
fi

say "compiling diffutils ${DIFFUTILS_VERSION} (${gmake_bin} -j${JOBS})"
diff_objects=$(cd "${bld}/src" && "${gmake_bin}" -s --no-print-directory --eval='wasmacs-print-diff: ; @echo $(diff_OBJECTS)' wasmacs-print-diff)
diff3_objects=$(cd "${bld}/src" && "${gmake_bin}" -s --no-print-directory --eval='wasmacs-print-diff3: ; @echo $(diff3_OBJECTS)' wasmacs-print-diff3)
[ -n "${diff_objects}" ] && [ -n "${diff3_objects}" ] || die "could not determine the diff/diff3 objects"
{
  "${gmake_bin}" -C "${bld}/lib" -j"${JOBS}"
  # shellcheck disable=SC2086
  "${gmake_bin}" -C "${bld}/src" -j"${JOBS}" libver.a ${diff_objects} ${diff3_objects}
} > "${work}/compile.log" 2>&1 \
  || { grep -n 'error' "${work}/compile.log" | head -20 | cut -c1-300 >&2; die "compile failed (see ${work}/compile.log)"; }

rt_obj="${work}/wasmacs-child-rt.o"
if [ ! -f "${rt_obj}" ] || [ "${wasmacs_child_rt_c}" -nt "${rt_obj}" ]; then
  emcc -O2 -c "${wasmacs_child_rt_c}" -o "${rt_obj}"
fi

printf '{"type":"commonjs"}\n' > "${out}/package.json"
for program in diff diff3; do
  if [ "${program}" = diff ]; then objects=${diff_objects}; else objects=${diff3_objects}; fi
  link_inputs=()
  for object in ${objects}; do link_inputs+=("${bld}/src/${object}"); done
  link_inputs+=("${bld}/src/libver.a" "${bld}/lib/libdiffutils.a" "${rt_obj}")
  ldflags="-O2 -Wno-js-compiler ${wasmacs_child_ldflags} -sEXPORT_NAME=wasmacsProgram_${program} -sSTACK_SIZE=${STACK_SIZE}"
  key=$( { printf '%s\n' "${ldflags}"; shasum -a 256 "${link_inputs[@]}" \
    "${wasmacs_child_dir}/wasmacs-child-library.js" "${wasmacs_child_dir}/wasmacs-child-pre.js"; } | shasum -a 256 | awk '{print $1}')
  if [ -f "${out}/${program}.js" ] && [ -f "${out}/${program}.wasm" ] && [ "$(cat "${work}/.${program}-linkkey" 2>/dev/null)" = "${key}" ]; then
    say "${program}: link up to date"
  else
    say "linking ${program} (Asyncify)"
    # shellcheck disable=SC2086
    emcc ${ldflags} -o "${out}/${program}.js" "${link_inputs[@]}" > "${work}/${program}-link.log" 2>&1 \
      || { tail -40 "${work}/${program}-link.log" | cut -c1-300 >&2; die "link failed (see ${work}/${program}-link.log)"; }
    printf '%s\n' "${key}" > "${work}/.${program}-linkkey"
  fi
  say "${program}: wasm $(wc -c < "${out}/${program}.wasm" | tr -d ' ') bytes, js $(wc -c < "${out}/${program}.js" | tr -d ' ') bytes"
done
