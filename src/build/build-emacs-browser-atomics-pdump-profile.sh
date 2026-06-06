#!/usr/bin/env bash
# Build a pdumper-enabled Atomics profile for Level 5-6.
#
# Key differences from build-emacs-browser-atomics.sh:
#   - Source tree: pdump-configure-probe (has HAVE_PDUMPER + alloc.c/pdumper.c fixes)
#   - Generates bootstrap-emacs.pdmp with a stub-linked Node profile, then
#     builds the browser Atomics profile from the same source tree.
#   - Bundles pdmp alongside temacs.wasm
#   - Same Atomics.wait blocking (NO Asyncify)
#
# Boot: callMain(["--dump-file=/bootstrap-emacs.pdmp","--quick","--no-splash","-nw"])
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

pdump_src="${repo_root}/build/emacs-pdump-configure-probe/src"
build_dir="${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump"
out_dir="${repo_root}/build/artifacts/emacs-browser-atomics-pdump"
atomics_host_library="${repo_root}/tools/scripts/wasmacs-atomics-host-library.js"
emmake_bin="${EMMAKE:-emmake}"
emacs_wasm_cflags="${EMACS_WASM_CFLAGS:--g3 -O0}"
initial_memory="${WASMACS_ATOMICS_PDUMP_INITIAL_MEMORY:-1073741824}"
allow_memory_growth="${WASMACS_ATOMICS_PDUMP_ALLOW_MEMORY_GROWTH:-1}"
native_baseline="${repo_root}/build/native-emacs-30.2/src"

if ! command -v "${emmake_bin}" >/dev/null 2>&1; then
  echo "error: ${emmake_bin} not found" >&2; exit 127
fi

if [ ! -f "${build_dir}/src/Makefile" ]; then
  echo "error: pdump build tree missing; run src/build/probe-emacs-pdump-configure.sh first" >&2
  exit 1
fi

if [ ! -x "${native_baseline}/lib-src/make-docfile" ] \
   || [ ! -x "${native_baseline}/lib-src/make-fingerprint" ]; then
  echo "error: native baseline helper tools are missing; run src/build/build-native-baseline.sh first" >&2
  exit 1
fi

echo "=== Syncing native generated Lisp for pdump redisplay/autoloads ==="
if [ ! -f "${native_baseline}/lisp/international/charprop.el" ]; then
  echo "error: missing native generated Lisp: ${native_baseline}/lisp/international/charprop.el" >&2
  exit 1
fi
if [ ! -f "${native_baseline}/lisp/subdirs.el" ]; then
  echo "error: missing native generated Lisp: ${native_baseline}/lisp/subdirs.el" >&2
  exit 1
fi
mkdir -p "${pdump_src}/lisp/international"
cp "${native_baseline}/lisp/subdirs.el" "${pdump_src}/lisp/subdirs.el"
cp "${native_baseline}/lisp/international/charprop.el" "${pdump_src}/lisp/international/charprop.el"
for generated_lisp in "${native_baseline}"/lisp/international/uni-*.el; do
  if [ ! -f "${generated_lisp}" ]; then
    echo "error: missing native generated uni-*.el files" >&2
    exit 1
  fi
  cp "${generated_lisp}" "${pdump_src}/lisp/international/$(basename "${generated_lisp}")"
done
while IFS= read -r generated_lisp; do
  rel="${generated_lisp#"${native_baseline}/lisp/"}"
  mkdir -p "${pdump_src}/lisp/$(dirname "${rel}")"
  cp "${generated_lisp}" "${pdump_src}/lisp/${rel}"
done < <(
  find "${native_baseline}/lisp" \
    \( -name '*loaddefs*.el' -o -name 'loaddefs.el' \) \
    -type f | sort
)
if [ -d "${repo_root}/src/emacs-lisp" ]; then
  rsync -a --include='*.el' --exclude='*' \
    "${repo_root}/src/emacs-lisp/" "${pdump_src}/lisp/"
fi

loadup_el="${pdump_src}/lisp/loadup.el"
if ! grep -q "wasmacs pbootstrap: preload url fetch lisp" "${loadup_el}"; then
  echo "=== Patching loadup.el to preload url fetch Lisp into pbootstrap pdmp ==="
  perl -0pi -e '
    s/(\n        \(message "Dumping under the name %s" output\))/
        (when (equal dump-mode "pbootstrap")\n          ;; wasmacs pbootstrap: preload url fetch lisp before the portable dump.\n          ;; Browser\/CI pdmp startup can otherwise overflow the wasm JS call\n          ;; stack while loading these bytecode-heavy Lisp libraries after\n          ;; restore.  Keeping them in the dump makes runtime require shallow.\n          (add-to-list (quote load-path) \"\/usr\/local\/share\/emacs\/30.2\/lisp\/url\")\n          (require (quote json))\n          (require (quote url-methods))\n          (require (quote url-parse))\n          (require (quote url-vars))\n          (require (quote wasmacs-url-fetch)))$1/s
  ' "${loadup_el}"
fi
if ! grep -q '/usr/local/share/emacs/30.2/lisp/url' "${loadup_el}"; then
  echo "=== Patching loadup.el to add URL Lisp directory before pbootstrap preload ==="
  perl -0pi -e '
    s/(\n          \(require \(quote json\)\))/
          (add-to-list (quote load-path) "\/usr\/local\/share\/emacs\/30.2\/lisp\/url")$1/s
  ' "${loadup_el}"
fi

echo "=== Byte-compiling lisp files for temacs.data preload ==="
"${native_baseline}/src/emacs" --batch \
  --eval "(byte-recompile-directory \"${pdump_src}/lisp\" 0 t)" 2>&1 \
  | grep -E "^(Compiling|Done|Error)" | tail -5
echo "byte-compile done"

emacs_c="${pdump_src}/src/emacs.c"
if ! grep -q "wasmacs pbootstrap: prepend virtual FS lisp path" "${emacs_c}"; then
  echo "=== Applying emacs.c Vload_path fix for Emscripten pbootstrap ==="
  perl -0pi -e '
    s/(  init_lread \(\);)/$1\n\n#ifdef __EMSCRIPTEN__\n  \/* wasmacs pbootstrap: prepend virtual FS lisp path after init_lread so\n     pbootstrap finds loadup.el when getenv(EMACSLOADPATH) is not picked up. *\/\n  {\n    const char *memfs_lisp = "\/usr\/local\/share\/emacs\/30.2\/lisp";\n    Lisp_Object memfs_path = decode_env_path (0, memfs_lisp, 0);\n    if (!NILP (memfs_path))\n      Vload_path = nconc2 (memfs_path, Vload_path);\n  }\n#endif/
  ' "${emacs_c}"
fi

pdumper_c="${pdump_src}/src/pdumper.c"
if ! grep -q "wasmacs pdumper: use heap-backed contiguous dump mapping under Emscripten" "${pdumper_c}"; then
  echo "=== Applying pdumper.c heap mapping fix for Emscripten ==="
  perl -0pi -e '
    s{\n  return \(VM_SUPPORTED \? dump_mmap_contiguous_vm : dump_mmap_contiguous_heap\)\n    \(maps, nr_maps, total_size\);}
     {\n  return\n#ifdef __EMSCRIPTEN__\n    /* wasmacs pdumper: use heap-backed contiguous dump mapping under Emscripten.\n       Emscripten exposes POSIX-like mmap enough for configure, but wasm/browser\n       pdmp restore cannot rely on the VM reservation path used by native Emacs. */\n    dump_mmap_contiguous_heap\n#else\n    (VM_SUPPORTED ? dump_mmap_contiguous_vm : dump_mmap_contiguous_heap)\n#endif\n    (maps, nr_maps, total_size);}s
  ' "${pdumper_c}"
fi

base_exports="_main,_malloc,_free"
base_exports="${base_exports},_wasmacs_eval_string,_wasmacs_garbage_collect"
base_exports="${base_exports},_wasmacs_pin_specpdl_backtrace_args,_wasmacs_scrub_specpdl_backtrace_args"
base_exports="${base_exports},_wasmacs_last_result,_wasmacs_entrypoint_state,_wasmacs_minibuffer_state"
base_exports="${base_exports},_wasmacs_command_state,_wasmacs_interactive_state"
base_exports="${base_exports},_wasmacs_os_lifecycle_phase,_wasmacs_os_lifecycle_state"
base_exports="${base_exports},_wasmacs_os_root_state_snapshot,_wasmacs_os_stack_bounds_probe"
base_exports="${base_exports},_wasmacs_os_gc_permission,_wasmacs_os_gc_permission_state"
base_exports="${base_exports},_wasmacs_os_root_safety_probe,_wasmacs_os_pending_command_state"
base_exports="${base_exports},_wasmacs_os_pin_backtrace_args,_wasmacs_os_release_backtrace_args"
base_exports="${base_exports},_wasmacs_os_push_gc_guard,_wasmacs_os_pop_gc_guard"
base_exports="${base_exports},_wasmacs_os_begin_command,_wasmacs_os_finish_command,_wasmacs_os_cancel_command,_wasmacs_os_configure_dired_without_ls,_wasmacs_os_dired_without_ls_probe,_wasmacs_os_filesystem_dired_state,_wasmacs_os_network_fetch_json,_wasmacs_os_url_fetch_loader_state,_wasmacs_os_apply_terminal_resize"
base_exports="${base_exports},_wasmacs_input_text,_wasmacs_input_cancel,_wasmacs_os_timing_checkpoint"

# Atomics (no Asyncify)
emacs_atomics_pdump_ldflags="-sEXIT_RUNTIME=0 \
  -sEXPORTED_FUNCTIONS=${base_exports} \
  -sEXPORTED_RUNTIME_METHODS=callMain,ccall,FS,FS_createPath,FS_createDataFile,FS_readFile \
  -sSTACK_SIZE=16777216 \
  -sSTACK_OVERFLOW_CHECK=2 \
  -sINITIAL_MEMORY=${initial_memory} \
  -sALLOW_MEMORY_GROWTH=${allow_memory_growth} \
  --js-library ${atomics_host_library} \
  --preload-file ${pdump_src}/lisp@/usr/local/share/emacs/30.2/lisp \
  --preload-file ${pdump_src}/etc@/usr/local/share/emacs/30.2/etc"

pdmp_file="${build_dir}/src/bootstrap-emacs.pdmp"

echo "=== Deferring bootstrap-emacs.pdmp generation until final Atomics runtime ==="
rm -f "${pdmp_file}" "${build_dir}/src/pdmp-probe-stubs.o"

echo "=== Applying OS compat patches (Atomics waitpoint) ==="
cp "${repo_root}/vendor/emacs/src/keyboard.c" "${pdump_src}/src/keyboard.c"
cp "${repo_root}/vendor/emacs/src/sysdep.c" "${pdump_src}/src/sysdep.c"
WASMACS_SPIKE_SRC="${pdump_src}" \
WASMACS_ENABLE_ASYNCIFY_WAITPOINT=1 \
WASMACS_ASYNCIFY_WAITPOINT_MODE="os-compat" \
  "${repo_root}/tools/scripts/patch-emacs-host-entrypoint-spike.sh"

# os-compat mode removes wasmacs_host_* externs from sysdep.c.
# The atomics host library provides the implementations.  Add them back.
SYSDEP="${pdump_src}/src/sysdep.c"
if ! grep -q "wasmacs_host_scheduler_checkpoint (int code)" "${SYSDEP}"; then
  perl -0pi -e 's|(extern void wasmacs_os_timing_checkpoint \(int code\);\nextern void wasmacs_os_timing_checkpoint \(int code\);\n\n/\* Read from FD)|/* wasmacs atomics host symbols. */\nextern int wasmacs_host_wait_for_input (void);\nextern int wasmacs_host_terminal_input_available (void);\nextern int wasmacs_host_terminal_read_byte (void);\nextern int wasmacs_host_is_tty_fd (int fd);\nextern int wasmacs_host_scheduler_checkpoint (int code);\nextern int wasmacs_host_terminal_resize_pending (void);\nextern int wasmacs_host_terminal_resize_cols (void);\nextern int wasmacs_host_terminal_resize_rows (void);\nextern int wasmacs_host_terminal_resize_ack (void);\nextern int wasmacs_os_apply_terminal_resize (int width, int height);\n$1|' "${SYSDEP}"
  echo "  fixed: added wasmacs_host_* externs to sysdep.c"
fi
if ! grep -q "wasmacs_host_terminal_resize_pending" "${SYSDEP}"; then
  perl -0pi -e 's|(extern int wasmacs_host_scheduler_checkpoint \(int code\);\n)|$1extern int wasmacs_host_terminal_resize_pending (void);\nextern int wasmacs_host_terminal_resize_cols (void);\nextern int wasmacs_host_terminal_resize_rows (void);\nextern int wasmacs_host_terminal_resize_ack (void);\nextern int wasmacs_os_apply_terminal_resize (int width, int height);\n|' "${SYSDEP}"
fi
if ! grep -q "wasmacs_os_apply_terminal_resize (wasmacs_host_terminal_resize_cols" "${SYSDEP}"; then
  perl -0pi -e 's|(          wasmacs_host_scheduler_checkpoint \(100\);\n          wasmacs_host_wait_for_input \(\);\n          wasmacs_host_scheduler_checkpoint \(101\);\n)|$1          if (wasmacs_host_terminal_resize_pending ())\n            {\n              wasmacs_os_apply_terminal_resize (wasmacs_host_terminal_resize_cols (),\n                                                wasmacs_host_terminal_resize_rows ());\n              wasmacs_host_terminal_resize_ack ();\n            }\n|' "${SYSDEP}"
fi

echo "=== Building pdumper+Atomics profile (${initial_memory} bytes) ==="
(
  cd "${build_dir}"
  printf '{"type":"commonjs"}\n' > src/package.json
  printf '{"type":"commonjs"}\n' > lib-src/package.json
  cp "${native_baseline}/lib-src/make-docfile" lib-src/make-docfile
  cp "${native_baseline}/lib-src/make-fingerprint" lib-src/make-fingerprint
  perl -0pi -e 's@^#define TERMINFO 1$@/* #undef TERMINFO */@m;
                s@^#define HAVE_LINUX_SYSINFO 1$@/* #undef HAVE_LINUX_SYSINFO */@m;
                s@^#define HAVE_PTHREAD 1$@/* #undef HAVE_PTHREAD */@m;
                s@^#define HAVE_PTHREAD_SIGMASK 1$@/* #undef HAVE_PTHREAD_SIGMASK */@m' \
    src/config.h
  perl -0pi -e 's/^LIBS_TERMCAP=.*$/LIBS_TERMCAP=/m;
                s/^TERMCAP_OBJ=.*$/TERMCAP_OBJ=termcap.o tparam.o/m' \
    src/Makefile
  if ! grep -q "wasmacs: Atomics pdump browser link flags" src/Makefile; then
    {
      printf '\n# wasmacs: Atomics pdump browser link flags.\n'
      printf 'temacs$(EXEEXT): LDFLAGS += %s\n' "${emacs_atomics_pdump_ldflags}"
    } >> src/Makefile
  fi
  rm -f src/temacs src/temacs.wasm src/temacs.data

  "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" \
    -C lib \
    CFLAGS="${emacs_wasm_cflags}" \
    all
  cp "${native_baseline}/lib-src/make-docfile" lib-src/make-docfile
  cp "${native_baseline}/lib-src/make-fingerprint" lib-src/make-fingerprint
  touch lib-src/make-docfile lib-src/make-fingerprint

  "${emmake_bin}" make -j"${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || printf '4')}" \
    -C src \
    CFLAGS="${emacs_wasm_cflags}" \
    temacs || {
      if [ -f src/temacs.tmp ] && [ -f src/temacs.wasm ]; then
        "${repo_root}/build/native-emacs-30.2/src/lib-src/make-fingerprint" src/temacs.wasm
        mv src/temacs.tmp src/temacs
      else
        exit 1
      fi
    }
) 2>&1 | grep -v "^make\[" | tail -10

echo "=== Generating matching bootstrap-emacs.pdmp (final Atomics runtime) ==="
rm -f "${pdmp_file}"
WASMACS_TEMACS_DIR="${build_dir}/src" \
WASMACS_PDMP_OUT="${pdmp_file}" \
  node --stack-size=65500 --input-type=module <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const temacsDir = process.env.WASMACS_TEMACS_DIR;
const pdmpOut = process.env.WASMACS_PDMP_OUT;
const code = readFileSync(`${temacsDir}/temacs`, "utf8");
const ttyOut = [];
let readyResolve;
const ready = new Promise((resolve) => { readyResolve = resolve; });
const ctx = {
  Module: {
    noInitialRun: true,
    thisProgram: "/temacs",
    locateFile: (p) => `${temacsDir}/${p}`,
    print: (text) => console.log(text),
    printErr: (text) => console.error(text),
    onRuntimeInitialized() { readyResolve(); },
  },
  Buffer, TextDecoder, TextEncoder, URL, WebAssembly, SharedArrayBuffer,
  Atomics, clearTimeout, console, performance, process, setTimeout,
  __dirname: temacsDir,
  __filename: `${temacsDir}/temacs`,
  require: createRequire(`${temacsDir}/package.json`),
};
ctx.globalThis = ctx;
ctx.self = { postMessage() {} };

vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: "temacs" });
await ready;

ctx.globalThis.__wasmacsInputSAB = new SharedArrayBuffer(264);
ctx.globalThis.__wasmacsTerminalOutputBytes = ttyOut;
ctx.globalThis.__wasmacsTerminalInputBytes = [];
ctx.Module.FS.writeFile("/temacs", new Uint8Array([0]));
ctx.Module.FS.chmod("/temacs", 0o755);

const status = ctx.Module.callMain(["--batch", "-l", "loadup", "--temacs=pbootstrap"]);
if (status !== 0)
  process.exit(status || 1);

const pdmp = ctx.Module.FS.readFile("/bootstrap-emacs.pdmp");
writeFileSync(pdmpOut, Buffer.from(pdmp));
if (ttyOut.length)
  console.log(new TextDecoder().decode(new Uint8Array(ttyOut.slice(0, 4000))));
console.log(`wrote ${pdmp.length} bytes to ${pdmpOut}`);
JS
test -f "${pdmp_file}"

echo "=== Packaging ==="
mkdir -p "${out_dir}"
printf '{"type":"commonjs"}\n' > "${out_dir}/package.json"
cp "${build_dir}/src/temacs"       "${out_dir}/temacs"
cp "${build_dir}/src/temacs"       "${out_dir}/temacs.js"
cp "${build_dir}/src/temacs.wasm"  "${out_dir}/temacs.wasm"
cp "${build_dir}/src/temacs.data"  "${out_dir}/temacs.data"
cp "${pdmp_file}"                  "${out_dir}/bootstrap-emacs.pdmp"

echo "=== Artifacts ==="
ls -lh "${out_dir}/"
echo "temacs.wasm: $(sha256sum "${out_dir}/temacs.wasm" | cut -d' ' -f1)"
echo "pdmp:        $(sha256sum "${out_dir}/bootstrap-emacs.pdmp" | cut -d' ' -f1)"
echo "ARTIFACT:${out_dir}"
echo "Boot: callMain([\"--dump-file=/bootstrap-emacs.pdmp\",\"--quick\",\"--no-splash\",\"-nw\"])"
