#!/usr/bin/env bash
# Build BusyBox as the wasmacs userland: one multicall program that provides
# /bin/sh (ash) and the usual command line tools (ls, cat, grep, find, sed,
# awk, diff, tar, ...).  It runs as a process under the wasmacs kernel
# (src/runtime/process); see src/runtime/process/child/.
#
#   src/userland/busybox/build.sh                 build
#   src/userland/busybox/build.sh --regen-config  regenerate config/busybox-<ver>.config
#                                                 from config/applets.list + config/settings.list
#   src/userland/busybox/build.sh --clean         remove the work directory
#
# Output: build/artifacts/userland/busybox.{js,wasm} and busybox.applets.txt.
#
# Idempotent: downloads the release tarball if missing, verifies its sha256,
# applies patches/, installs the recorded config, compiles and links only what
# is out of date.
#
# Environment:
#   BB_VERSION   BusyBox release (default 1.38.0)
#   JOBS         parallel compile jobs (default: number of CPUs)
#   HOSTCC       native C compiler for the Kbuild host tools (default: cc)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${here}/../../.." && pwd)"
source "${repo_root}/src/runtime/process/child/wasmacs-child-flags.sh"

BB_VERSION=${BB_VERSION:-1.38.0}
case "${BB_VERSION}" in
  1.38.0) BB_SHA256=34f9ea6ff8636f2c9241153b9114eefa9e65674a45318ae1ef95bb5f31c53bb2 ;;
  *) echo "build.sh: no pinned sha256 for BusyBox ${BB_VERSION}" >&2; exit 2 ;;
esac
BB_URL=https://busybox.net/downloads/busybox-${BB_VERSION}.tar.bz2
JOBS=${JOBS:-$( (sysctl -n hw.ncpu || nproc) 2>/dev/null | head -1)}
HOSTCC=${HOSTCC:-cc}
STACK_SIZE=${WASMACS_BUSYBOX_STACK_SIZE:-1048576}

work="${repo_root}/build/userland/busybox"
dl="${repo_root}/build/userland/dl"
tarball="${dl}/busybox-${BB_VERSION}.tar.bz2"
src="${work}/src/busybox-${BB_VERSION}"
bld="${work}/build/busybox-${BB_VERSION}"
out="${repo_root}/build/artifacts/userland"
config_file="${here}/config/busybox-${BB_VERSION}.config"
gnubin="${work}/gnubin"

regen_config=0
case "${1:-}" in
  --clean) rm -rf "${work}"; echo "cleaned ${work}"; exit 0 ;;
  --regen-config) regen_config=1 ;;
  "") ;;
  *) echo "usage: $0 [--regen-config|--clean]" >&2; exit 2 ;;
esac

say() { printf '== %s\n' "$*"; }
die() { printf 'build.sh: %s\n' "$*" >&2; exit 1; }
sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }

for tool in emcc emar node curl "${HOSTCC}" patch bzip2; do
  command -v "${tool}" >/dev/null 2>&1 || die "required tool not found: ${tool}"
done

# ------------------------------------------- 1. private GNU userland PATH
# BusyBox's Kbuild and helper scripts assume GNU make >= 3.82 and GNU
# sed/coreutils.  macOS ships GNU make 3.81 and a BSD userland; Homebrew
# installs the GNU tools with a g prefix.  Expose them under their plain
# names in a private directory that is first on PATH for this script only.
mkdir -p "${gnubin}"
for tool in make sed grep egrep fgrep tar install cat cp mv rm ln mkdir rmdir chmod touch \
  sort uniq cut tr head tail wc tee od expr seq mktemp readlink realpath stat date \
  basename dirname printf env comm paste join fold nl split tac ls du md5sum \
  sha256sum cksum base64 dd truncate id uname pwd sleep true false test; do
  if gnu_tool=$(command -v "g${tool}" 2>/dev/null); then ln -sf "${gnu_tool}" "${gnubin}/${tool}"; fi
done
export PATH="${gnubin}:${PATH}"
case "${repo_root}" in *[[:space:]]*) die "path contains whitespace (Kbuild cannot cope): ${repo_root}" ;; esac
make --version 2>/dev/null | sed -n 1p | grep -q 'GNU Make' || die "GNU make not found (macOS: brew install make)"
sed --version 2>/dev/null | sed -n 1p | grep -q 'GNU sed' || die "GNU sed not found (macOS: brew install gnu-sed coreutils)"

# ------------------------------------------------- 2. download + verify
mkdir -p "${dl}"
if [ ! -f "${tarball}" ]; then
  say "downloading ${BB_URL}"
  curl -fL --retry 3 -o "${tarball}.part" "${BB_URL}"
  mv "${tarball}.part" "${tarball}"
fi
got=$(sha256_of "${tarball}")
[ "${got}" = "${BB_SHA256}" ] || die "sha256 mismatch for ${tarball}: got ${got}, want ${BB_SHA256}"

# --------------------------------------------- 3. extract + apply patches
patches=$(ls "${here}"/patches/*.patch 2>/dev/null || true)
want_stamp=$( { echo "${BB_SHA256}"; for p in ${patches}; do cat "${p}"; done; } | shasum -a 256 | cut -d' ' -f1)
if [ "$(cat "${src}/.wasmacs-src-stamp" 2>/dev/null || true)" != "${want_stamp}" ]; then
  say "extracting busybox-${BB_VERSION} and applying patches"
  rm -rf "${src}" "${bld}"
  mkdir -p "${work}/src"
  tar -xjf "${tarball}" -C "${work}/src"
  for p in ${patches}; do
    patch -s -p1 -d "${src}" < "${p}" || die "patch failed: ${p}"
  done
  echo "${want_stamp}" > "${src}/.wasmacs-src-stamp"
fi

# ------------------------------------------------------------ 4. config
mkdir -p "${bld}"
strip_stamp() { sed -e '4{/^# [A-Z][a-z][a-z] [A-Z][a-z][a-z] /d}' "$1"; }
if [ "${regen_config}" = 1 ] || [ ! -f "${config_file}" ]; then
  say "generating config from config/applets.list + config/settings.list"
  MAKE=make HOSTCC="${HOSTCC}" bash "${here}/mkconfig.sh" "${src}" "${bld}" \
    "${here}/config/applets.list" "${here}/config/settings.list"
  strip_stamp "${bld}/.config" > "${config_file}"
  say "recorded ${config_file#"${repo_root}/"}"
fi
if [ ! -f "${bld}/.config" ] || ! strip_stamp "${bld}/.config" | cmp -s - "${config_file}"; then
  say "installing recorded config ${config_file#"${repo_root}/"}"
  cp "${config_file}" "${bld}/.config"
  ( yes "" 2>/dev/null || true ) | make -C "${src}" O="${bld}" ARCH=wasm32 HOSTCC="${HOSTCC}" oldconfig \
    >"${bld}/.oldconfig.log" 2>&1 || { tail -20 "${bld}/.oldconfig.log" >&2; die "oldconfig failed"; }
  if ! strip_stamp "${bld}/.config" | cmp -s - "${config_file}"; then
    diff <(strip_stamp "${bld}/.config") "${config_file}" | head -40 >&2 || true
    die "recorded config is stale for busybox-${BB_VERSION}; run $0 --regen-config"
  fi
fi

# ----------------------------------------------------------- 5. compile
# patches/0001 (arch/wasm32/Makefile) selects emcc/emar and replaces the final
# link by "record the link inputs in busybox_unstripped.inputs".
say "compiling busybox-${BB_VERSION} (make -j${JOBS} ARCH=wasm32)"
if ! make -C "${src}" O="${bld}" ARCH=wasm32 HOSTCC="${HOSTCC}" -j"${JOBS}" busybox_unstripped \
  >"${work}/compile.log" 2>&1; then
  grep -n -E 'error|Error' "${work}/compile.log" | head -40 >&2 || true
  die "compile failed, see ${work}/compile.log"
fi
inputs="${bld}/busybox_unstripped.inputs"
[ -s "${inputs}" ] || die "Kbuild did not record link inputs (${inputs})"

# --------------------------------------------------- 6. libc compat shim
mkdir -p "${bld}/wasmacs-compat"
compat_objs=
for c in "${here}"/compat/*.c; do
  o="${bld}/wasmacs-compat/$(basename "${c%.c}").o"
  if [ ! -f "${o}" ] || [ "${c}" -nt "${o}" ]; then emcc -Os -Wall -c "${c}" -o "${o}"; fi
  compat_objs="${compat_objs} ${o}"
done

# -------------------------------------------------------------- 7. link
mkdir -p "${out}"
# Emscripten's Node code path is CommonJS; the repository package is an ES module.
printf '{"type":"commonjs"}\n' > "${out}/package.json"
js="${out}/busybox.js"
link_cmd="emcc -O2 -Wno-js-compiler ${wasmacs_child_ldflags} -sEXPORT_NAME=wasmacsProgram_busybox -sSTACK_SIZE=${STACK_SIZE} @inputs ${compat_objs} ${wasmacs_child_rt_c}"
stamp="${bld}/.link.stamp"
stale=0
if [ ! -f "${js}" ] || [ ! -f "${out}/busybox.wasm" ] || [ "$(cat "${stamp}" 2>/dev/null || true)" != "${link_cmd}" ]; then
  stale=1
else
  for f in $(tr ' ' '\n' < "${inputs}" | sed -e '/^$/d' -e "s#^#${bld}/#") ${compat_objs} \
    "${wasmacs_child_rt_c}" "${wasmacs_child_dir}/wasmacs-child-library.js" "${wasmacs_child_dir}/wasmacs-child-pre.js"; do
    if [ "${f}" -nt "${js}" ]; then stale=1; break; fi
  done
fi
if [ "${stale}" = 1 ]; then
  say "linking busybox (Asyncify, this takes a moment)"
  # shellcheck disable=SC2046,SC2086
  # Linked at -O2 (objects are -Os): -Os/-Oz links minify the wasm import and
  # export names, which makes the image harder to debug for no real gain.
  ( cd "${bld}" && emcc -O2 -Wno-js-compiler ${wasmacs_child_ldflags} -sEXPORT_NAME=wasmacsProgram_busybox \
      -sSTACK_SIZE=${STACK_SIZE} -o "${js}" $(cat "${inputs}") ${compat_objs} "${wasmacs_child_rt_c}" ) \
    >"${work}/link.log" 2>&1 || { tail -40 "${work}/link.log" >&2; die "link failed, see ${work}/link.log"; }
  echo "${link_cmd}" > "${stamp}"
else
  say "link: up to date"
fi

# ---------------------------------------------------------- 8. applet list
# include/applet_tables.h holds the NUL-separated applet names.
node -e '
const fs = require("fs");
const text = fs.readFileSync(process.argv[1], "utf8");
const m = /const char applet_names\[\][^=]*=\s*((?:"[^"]*"\s*)+);/.exec(text);
if (!m) { console.error("applet_names not found"); process.exit(1); }
const names = [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).filter((s) => s && s !== "\\0");
fs.writeFileSync(process.argv[2], names.join("\n") + "\n");
' "${bld}/include/applet_tables.h" "${out}/busybox.applets.txt"

say "busybox: $(wc -l < "${out}/busybox.applets.txt" | tr -d ' ') applets, wasm $(wc -c < "${out}/busybox.wasm" | tr -d ' ') bytes, js $(wc -c < "${js}" | tr -d ' ') bytes"
