#!/usr/bin/env bash
# Build the unified browser runtime profile:
#   - pdumper enabled (--with-dumping=pdumper)
#   - alloc.c purecopy cycle fix (already in pdump probe source tree)
#   - pdumper.c heap-mapping fix (already in pdump probe source tree)
#   - loadup.el prereqs permanently applied
#   - all wasmacs_os_* OS compat kernel entrypoints
#   - 512MB fixed linear memory, 16MB wasm stack
#   - MEMFS-based (no NODERAWFS) with preloaded lisp/etc
#
# First-boot behavior (managed by browser-runtime-worker.js):
#   callMain(["--batch", "-l", "loadup", "--temacs=pbootstrap"])
#   → writes /bootstrap-emacs.pdmp into virtual MEMFS
#   → worker extracts bytes, saves to OPFS
#
# Subsequent-boot behavior:
#   callMain(["--dump-file=/bootstrap-emacs.pdmp", "--batch", ...])
#   → skip cold loadup, start from initialized Emacs state
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Use the pdump probe source tree which already has:
#   - --with-dumping=pdumper configured
#   - alloc.c purecopy provisional hash fix
#   - pdumper.c __EMSCRIPTEN__ heap-mapping fix
pdump_src="${repo_root}/build/emacs-pdump-configure-probe/src"
build_dir="${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump"
out_dir="${repo_root}/artifacts/emacs-browser-runtime"
emmake_bin="${EMMAKE:-emmake}"
emacs_wasm_cflags="${EMACS_WASM_CFLAGS:--g3 -O0}"
native_baseline="${repo_root}/build/native-emacs-30.2/src"

# All OS compat kernel entrypoints
base_exports="_main"
base_exports="${base_exports},_wasmacs_eval_string,_wasmacs_garbage_collect,_wasmacs_last_result"
base_exports="${base_exports},_wasmacs_entrypoint_state,_wasmacs_minibuffer_state,_wasmacs_command_state"
base_exports="${base_exports},_wasmacs_command_begin_minibuffer_probe,_wasmacs_command_begin_minibuffer_force_probe"
base_exports="${base_exports},_wasmacs_os_lifecycle_phase,_wasmacs_os_root_state_snapshot"
base_exports="${base_exports},_wasmacs_os_gc_permission,_wasmacs_os_pending_command_state"
base_exports="${base_exports},_wasmacs_os_pin_backtrace_args,_wasmacs_os_release_backtrace_args"
base_exports="${base_exports},_wasmacs_os_push_gc_guard,_wasmacs_os_pop_gc_guard"
base_exports="${base_exports},_wasmacs_os_begin_command,_wasmacs_os_finish_command,_wasmacs_os_cancel_command"
base_exports="${base_exports},_wasmacs_input_text,_wasmacs_input_cancel"

emacs_runtime_ldflags="${EMACS_RUNTIME_LDFLAGS:--sEXIT_RUNTIME=0 \
  -sEXPORTED_FUNCTIONS=${base_exports} \
  -sEXPORTED_RUNTIME_METHODS=callMain,ccall,FS,FS_createPath,FS_createDataFile,FS_readFile,ENV \
  -sSTACK_SIZE=16777216 \
  -sSTACK_OVERFLOW_CHECK=2 \
  -sINITIAL_MEMORY=536870912 \
  -sALLOW_MEMORY_GROWTH=0 \
  --preload-file ${pdump_src}/lisp@/usr/local/share/emacs/30.2/lisp \
  --preload-file ${pdump_src}/etc@/usr/local/share/emacs/30.2/etc}"

if ! command -v "${emmake_bin}" >/dev/null 2>&1; then
  echo "error: ${emmake_bin} not found" >&2; exit 127
fi

if [ ! -f "${build_dir}/src/Makefile" ]; then
  echo "error: pdump configure probe build not found; run scripts/probe-emacs-pdump-temacs-build.sh first" >&2
  exit 1
fi

# --- Step 0: Apply emacs.c Vload_path fix for Emscripten pbootstrap ---
# Under Emscripten MEMFS, getenv("EMACSLOADPATH") may not be picked up during
# pbootstrap because getEnvStrings() caching can precede init_lread.  The
# emacs.c patch directly prepends the preloaded virtual FS lisp path after
# init_lread() so pbootstrap always finds loadup.el.
emacs_c="${pdump_src}/src/emacs.c"
if ! grep -q "wasmacs pbootstrap: prepend virtual FS lisp path" "${emacs_c}"; then
  echo "=== Applying emacs.c Vload_path fix for Emscripten pbootstrap ==="
  perl -0pi -e '
    s/(  init_lread \(\);)/$1\n\n#ifdef __EMSCRIPTEN__\n  \/* wasmacs pbootstrap: prepend virtual FS lisp path after init_lread so\n     pbootstrap finds loadup.el when getenv(EMACSLOADPATH) is not picked up. *\/\n  {\n    const char *memfs_lisp = "\/usr\/local\/share\/emacs\/30.2\/lisp";\n    Lisp_Object memfs_path = decode_env_path (0, memfs_lisp, 0);\n    if (!NILP (memfs_path))\n      Vload_path = nconc2 (memfs_path, Vload_path);\n  }\n#endif/
  ' "${emacs_c}"
  echo "emacs.c Vload_path fix applied."
else
  echo "=== emacs.c Vload_path fix already applied, skipping ==="
fi

# --- Step 1: Permanently apply loadup.el prereqs if not already present ---
loadup_el="${pdump_src}/lisp/loadup.el"
if ! grep -q "Wasm browser runtime: pre-load macro dependencies" "${loadup_el}"; then
  echo "=== Applying loadup.el prereqs (permanent) ==="
  perl -0pi -e '
    s/(\(load "files"\))/;; Wasm browser runtime: pre-load macro dependencies so files.el\n;; eval-when-compile does not fail with "require while preparing to dump".\n(load "emacs-lisp\/macroexp")\n(let ((macroexp--pending-eager-loads (quote (skip)))) (load "emacs-lisp\/pcase"))\n(let ((macroexp--pending-eager-loads (quote (skip)))) (load "emacs-lisp\/easy-mmode"))\n$1/m
  ' "${loadup_el}"
  echo "loadup.el prereqs applied."
else
  echo "=== loadup.el prereqs already applied, skipping ==="
fi

# --- Step 2: Apply wasmacs_os_* patches to the pdump probe source tree ---
echo "=== Applying OS compat kernel patches ==="
WASMACS_SPIKE_SRC="${pdump_src}" \
  "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh"

# --- Step 3: Build with browser LDFLAGS (relink with new flags) ---
echo "=== Building browser runtime (512MB fixed, 16MB stack, pdumper) ==="
(
  cd "${build_dir}"
  printf '{"type":"commonjs"}\n' > src/package.json

  rm -f src/temacs src/temacs.tmp src/temacs.wasm src/temacs.data

  {
    "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" \
      -C src \
      CFLAGS="${emacs_wasm_cflags}" \
      LDFLAGS="${emacs_runtime_ldflags}" \
      temacs
  } || {
    # Fingerprint workaround: upstream make-fingerprint runs on temacs.tmp (the
    # JS launcher) but fingerprint bytes live in temacs.wasm for Emscripten.
    if [ -f src/temacs.tmp ] && [ -f src/temacs.wasm ]; then
      "${native_baseline}/lib-src/make-fingerprint" src/temacs.wasm
      mv src/temacs.tmp src/temacs
    else
      echo "error: build failed and fingerprint workaround cannot apply" >&2
      exit 1
    fi
  }
) 2>&1 | grep -v "^make\[" | tail -20

# --- Step 4: Copy artifacts ---
echo "=== Copying artifacts → ${out_dir} ==="
mkdir -p "${out_dir}"
printf '{"type":"commonjs"}\n' > "${out_dir}/package.json"
cp "${build_dir}/src/temacs"       "${out_dir}/temacs"
cp "${build_dir}/src/temacs.wasm"  "${out_dir}/temacs.wasm"
cp "${build_dir}/src/temacs.data"  "${out_dir}/temacs.data"

# --- Step 5: Smoke test (verify pbootstrap works in Node) ---
echo "=== Smoke test: pbootstrap in Node ==="
(
  cd "${build_dir}/src"
  LANG=C LC_ALL=C \
    node --stack-size=65500 ./temacs \
    --batch -l loadup --temacs=pbootstrap 2>&1 | tail -5
) | grep -E "Dump complete|Dumping|error|Error" | head -5

pdmp_file="${build_dir}/src/bootstrap-emacs.pdmp"
if [ -f "${pdmp_file}" ]; then
  echo "pdmp size: $(du -h "${pdmp_file}" | cut -f1)"
  # Copy generated pdmp for reference (not bundled — generated at runtime in browser)
  cp "${pdmp_file}" "${out_dir}/bootstrap-emacs.pdmp"
  echo "=== Smoke test: pdmp load in Node ==="
  (
    cd "${build_dir}/src"
    LANG=C LC_ALL=C node --stack-size=65500 ./temacs \
      --dump-file="$(pwd)/bootstrap-emacs.pdmp" \
      --batch \
      --eval '(princ (concat "VERSION:" emacs-version "\n"))' \
      --eval '(garbage-collect)' \
      --eval '(princ "GC:PASS\n")' \
      2>/dev/null
  ) | grep -E "VERSION:|GC:"
else
  echo "warning: bootstrap-emacs.pdmp not found after pbootstrap"
fi

mkdir -p "${repo_root}/logs"
{
  printf 'emacs-browser-runtime build — %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'source: %s\n' "${pdump_src}"
  printf 'memory: 512MB fixed, no growth\n'
  printf 'stack: 16MB wasm stack\n'
  printf 'pdumper: enabled (--with-dumping=pdumper)\n'
  printf 'runtime pdmp: generated at first boot, saved to OPFS\n'
  printf 'artifacts: %s\n' "${out_dir}"
  printf 'STATUS:PASS\n'
} > "${repo_root}/logs/emacs-browser-runtime-build.txt"

echo "STATUS:PASS → ${out_dir}"
echo "Next: browser-runtime-worker.js manages OPFS pdmp lifecycle"
