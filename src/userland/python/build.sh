#!/usr/bin/env bash
# Build CPython as a synchronous wasmacs Process Service image, plus stdlib.
# Output: python.{js,wasm}, python314.zip and python314-os.py in userland/.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${here}/../../.." && pwd)"
WASMACS_CHILD_ASYNCIFY_STACK_SIZE=${WASMACS_PYTHON_ASYNCIFY_STACK_SIZE:-1048576}
source "${repo_root}/src/runtime/process/child/wasmacs-child-flags.sh"

PYTHON_VERSION=${PYTHON_VERSION:-3.14.10}
case "${PYTHON_VERSION}" in
  # Official release SHA256:
  # https://www.python.org/downloads/release/python-31410/
  3.14.10) PYTHON_SHA256=de414a57119abef52784d8993e341d53aed635fc2b05c2607d9f98a2c5b72032 ;;
  *) echo "build.sh: no pinned sha256 for Python ${PYTHON_VERSION}" >&2; exit 2 ;;
esac
JOBS=${JOBS:-$( (sysctl -n hw.ncpu || nproc) 2>/dev/null | head -1)}
BUILD_PYTHON=${WASMACS_BUILD_PYTHON:-$(command -v python3.14 || command -v python3)}
STACK_SIZE=${WASMACS_PYTHON_STACK_SIZE:-5242880}
work="${repo_root}/build/userland/python"
dl="${work}/dl"
src="${work}/src/Python-${PYTHON_VERSION}"
bld="${work}/build"
out="${repo_root}/build/artifacts/userland"
tarball="${dl}/Python-${PYTHON_VERSION}.tar.xz"
url="https://www.python.org/ftp/python/${PYTHON_VERSION}/Python-${PYTHON_VERSION}.tar.xz"

if [ "${1:-}" = --clean ]; then rm -rf "${work}"; exit 0; fi
say() { printf '== %s\n' "$*"; }
die() { printf 'build.sh: %s\n' "$*" >&2; exit 1; }
gmake_bin=$(command -v gmake || command -v make)
"${gmake_bin}" --version 2>/dev/null | head -1 | grep -q 'GNU Make [4-9]' \
  || die "GNU make >=4 required"
for tool in emcc emar emconfigure curl shasum tar patch; do
  command -v "${tool}" >/dev/null || die "missing tool: ${tool}"
done
"${BUILD_PYTHON}" -c 'import sys; assert sys.version_info[:2] == (3,14), "native Python 3.14 required"' \
  || die "set WASMACS_BUILD_PYTHON to a native Python 3.14 interpreter"
case "${repo_root}" in *[[:space:]]*) die "path contains whitespace: ${repo_root}" ;; esac
mkdir -p "${dl}" "${work}/src" "${out}"
if [ ! -f "${tarball}" ]; then
  say "downloading ${url}"
  curl -fsSL --retry 3 -o "${tarball}.part" "${url}"
  mv "${tarball}.part" "${tarball}"
fi
actual=$(shasum -a 256 "${tarball}" | awk '{print $1}')
[ "${actual}" = "${PYTHON_SHA256}" ] || die "SHA256 mismatch for ${tarball}: ${actual}"
source_key=$(shasum -a 256 "${here}"/patches/*.patch "${here}"/Modules/*.c "${here}"/Lib/*.py \
  | shasum -a 256 | awk '{print $1}')
if [ "$(cat "${src}/.wasmacs-source-key" 2>/dev/null)" != "${source_key}" ]; then
  say "extracting and patching CPython ${PYTHON_VERSION}"
  rm -rf "${src}" "${bld}"
  tar -xJf "${tarball}" -C "${work}/src"
  for patchfile in "${here}"/patches/*.patch; do
    patch -d "${src}" -p1 < "${patchfile}"
  done
  # wasmacs's own modules (Setup.local and patches/ refer to them).
  cp "${here}"/Modules/*.c "${src}/Modules/"
  cp "${here}"/Lib/*.py "${src}/Lib/"
  printf '%s\n' "${source_key}" > "${src}/.wasmacs-source-key"
fi

configure_args=(
  --host=wasm32-unknown-emscripten --prefix=/usr
  --with-build-python="${BUILD_PYTHON}"
  --disable-shared --disable-wasm-dynamic-linking --disable-wasm-pthreads
  --disable-test-modules --disable-ipv6 --without-ensurepip --without-pymalloc
  --without-readline --enable-big-digits=30
  # Emscripten otherwise hardcodes runtime prefixes to / independently of
  # --prefix (which upstream treats as the staging/install prefix).
  host_prefix=/usr host_exec_prefix=/usr
  CFLAGS=-O2\ -DPY_CALL_TRAMPOLINE
)
configure_key=$( { printf '%s\n' "${PYTHON_VERSION}" "${configure_args[*]}";
  shasum -a 256 "${here}/config.site" "${here}/Setup.local"; } | shasum -a 256 | awk '{print $1}')
if [ ! -f "${bld}/Makefile" ] || [ "$(cat "${bld}/.wasmacs-configure-key" 2>/dev/null)" != "${configure_key}" ]; then
  say "configuring CPython ${PYTHON_VERSION}"
  rm -rf "${bld}"
  mkdir -p "${bld}/Modules"
  cp "${here}/Setup.local" "${bld}/Modules/Setup.local"
  (cd "${bld}" && WASMACS_CPYTHON_SOURCE="${src}" CONFIG_SITE="${here}/config.site" \
    emconfigure "${src}/configure" --build="$(sh "${src}/config.guess")" "${configure_args[@]}") \
    > "${work}/configure.log" 2>&1 \
    || { tail -35 "${work}/configure.log" >&2; die "configure failed"; }
  printf '%s\n' "${configure_key}" > "${bld}/.wasmacs-configure-key"
fi

# Do not compile upstream Python/emscripten_syscalls.c: its constructors,
# Promise/JSPI main/read/poll glue and shared-FS closures conflict with the
# Process Service. Its POSIX calls are already provided by our child runtime.
say "compiling CPython ${PYTHON_VERSION}"
make_args=(-C "${bld}" -f Makefile -f "${here}/wasmacs.mk")
"${gmake_bin}" "${make_args[@]}" -j"${JOBS}" \
  libpython3.14.a Programs/python.o pybuilddir.txt > "${work}/compile.log" 2>&1 \
  || { tail -45 "${work}/compile.log" | cut -c1-350 >&2; die "compile failed"; }
rt_obj="${work}/wasmacs-child-rt.o"
if [ ! -f "${rt_obj}" ] || [ "${wasmacs_child_rt_c}" -nt "${rt_obj}" ]; then
  emcc -O2 -c "${wasmacs_child_rt_c}" -o "${rt_obj}"
fi
# The upstream default dynamic build keeps these trampoline dependencies via
# MAIN_MODULE. Retain them explicitly for our static image. The JS fallback
# may call a suspending Python C function, so Asyncify must cover that import.
ldflags="-O2 -Wno-js-compiler ${wasmacs_child_ldflags} -sEXPORT_NAME=wasmacsProgram_python -sEXPORTED_FUNCTIONS=_main,__PyRuntime -sEXPORTED_RUNTIME_METHODS=addFunction -sALLOW_TABLE_GROWTH=1 -sASYNCIFY_IMPORTS=_PyEM_TrampolineCall_JS -sSTACK_SIZE=${STACK_SIZE} -sINITIAL_MEMORY=33554432"
module_libs=$("${gmake_bin}" "${make_args[@]}" -s --no-print-directory wasmacs-print-link-libs)
link_inputs=("${bld}/Programs/python.o" "${bld}/Python/emscripten_trampoline_wasm.o" "${bld}/libpython3.14.a" "${rt_obj}")
module_archives=()
for lib in ${module_libs}; do
  case "${lib}" in *.a) module_archives+=("${bld}/${lib}") ;; esac
done
link_key=$( { printf '%s\n' "${ldflags}" "${module_libs}"; shasum -a 256 "${link_inputs[@]}" "${module_archives[@]}" \
  "${wasmacs_child_dir}/wasmacs-child-library.js" "${wasmacs_child_dir}/wasmacs-child-pre.js"; } | shasum -a 256 | awk '{print $1}')
printf '{"type":"commonjs"}\n' > "${out}/package.json"
if [ ! -f "${out}/python.wasm" ] || [ ! -f "${out}/python.js" ] || [ "$(cat "${work}/.linkkey" 2>/dev/null)" != "${link_key}" ]; then
  say "linking CPython (Asyncify)"
  # shellcheck disable=SC2086
  (cd "${bld}" && emcc ${ldflags} -o "${out}/python.js" "${link_inputs[@]}" ${module_libs}) > "${work}/link.log" 2>&1 \
    || { tail -40 "${work}/link.log" | cut -c1-350 >&2; die "link failed"; }
  printf '%s\n' "${link_key}" > "${work}/.linkkey"
fi
"${BUILD_PYTHON}" "${here}/package-stdlib.py" "${src}" "${bld}" "${out}/python314.zip"
# getpath.py checks this real-file landmark when /bin/python3 is outside the
# configured /usr prefix, even when imports subsequently use the stdlib ZIP.
cp "${src}/Lib/os.py" "${out}/python314-os.py"
say "python: wasm $(wc -c < "${out}/python.wasm" | tr -d ' ') bytes, js $(wc -c < "${out}/python.js" | tr -d ' ') bytes"
