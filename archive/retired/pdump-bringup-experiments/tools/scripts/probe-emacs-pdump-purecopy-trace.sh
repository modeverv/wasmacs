#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_alloc="${repo_root}/build/emacs-pdump-configure-probe/src/src/alloc.c"
backup_alloc="${repo_root}/build/emacs-pdump-configure-probe/src/src/alloc.c.wasmpurecopybak"
log_file="${repo_root}/logs/emacs-pdump-purecopy-trace.txt"
run_log="${repo_root}/logs/emacs-pdump-purecopy-trace-run.txt"

if [ ! -f "${source_alloc}" ]; then
  "${repo_root}/src/build/probe-emacs-pdump-configure.sh"
fi

mkdir -p "${repo_root}/logs"
cp "${source_alloc}" "${backup_alloc}"

perl -0pi -e '
  s/(static ptrdiff_t pure_bytes_used_non_lisp;\n)/$1\nstatic int wasmacs_purecopy_trace_count;\nstatic int wasmacs_pure_alloc_trace_count;\n/s;
  s/(pure_bytes_used = pure_bytes_used_lisp \+ pure_bytes_used_non_lisp;\n\n  if \(pure_bytes_used <= pure_size\)\n    return result;)/pure_bytes_used = pure_bytes_used_lisp + pure_bytes_used_non_lisp;\n\n  if (wasmacs_pure_alloc_trace_count < 80)\n    fprintf (stderr,\n             \"WASMACS_PURE_ALLOC #%d type=%d size=%zu result=%p purebeg=%p pure_size=%td used=%td lisp=%td non_lisp=%td\\\\n\",\n             wasmacs_pure_alloc_trace_count++, type, size, result, purebeg,\n             pure_size, pure_bytes_used, pure_bytes_used_lisp,\n             pure_bytes_used_non_lisp);\n\n  if (pure_bytes_used <= pure_size)\n    return result;/s;
  s/(static Lisp_Object\npurecopy \(Lisp_Object obj\)\n\{\n)/$1  if (wasmacs_purecopy_trace_count < 200)\n    {\n      const char *kind = \"other\";\n      if (FIXNUMP (obj))\n        kind = \"fixnum\";\n      else if (CONSP (obj))\n        kind = \"cons\";\n      else if (SYMBOLP (obj))\n        kind = \"symbol\";\n      else if (STRINGP (obj))\n        kind = \"string\";\n      else if (CLOSUREP (obj))\n        kind = \"closure\";\n      else if (VECTORP (obj))\n        kind = \"vector\";\n      else if (RECORDP (obj))\n        kind = \"record\";\n      else if (HASH_TABLE_P (obj))\n        kind = \"hash-table\";\n      else if (FLOATP (obj))\n        kind = \"float\";\n      else if (SUBRP (obj))\n        kind = \"subr\";\n      fprintf (stderr,\n               \"WASMACS_PURECOPY #%d kind=%s raw=0x%jx ptr=%p pure=%d purebeg=%p pure_size=%td used=%td\\\\n\",\n               wasmacs_purecopy_trace_count++, kind, (uintmax_t) XLI (obj),\n               FIXNUMP (obj) ? NULL : XPNTR (obj),\n               FIXNUMP (obj) ? 0 : PURE_P (XPNTR (obj)), purebeg, pure_size,\n               pure_bytes_used);\n    }\n/s;
' "${source_alloc}"

{
  printf 'pdump purecopy trace probe\n'
  printf 'source alloc: %s\n' "${source_alloc}"
  printf '\n'
} > "${log_file}"

set +e
EMACS_WASM_LDFLAGS='-sNODERAWFS=1 -sEXIT_RUNTIME=1 -sSTACK_SIZE=134217728 -sSTACK_OVERFLOW_CHECK=0 -sINITIAL_MEMORY=1073741824 -sALLOW_MEMORY_GROWTH=1' \
  "${repo_root}/tools/scripts/probe-emacs-pdump-temacs-build.sh" 2>&1 | tee -a "${log_file}"
build_status=${PIPESTATUS[0]}
set -e

if [ "${build_status}" -ne 0 ]; then
  cp "${backup_alloc}" "${source_alloc}"
  printf 'RESULT:BUILD_FAILED status %s\n' "${build_status}" | tee -a "${log_file}"
  exit "${build_status}"
fi

set +e
(
  cd "${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump/src"
  EMACSLOADPATH="${repo_root}/build/emacs-pdump-configure-probe/src/lisp" \
    node --stack-size=65500 ./temacs --batch -l loadup --temacs=pdump
) 2>&1 | tee "${run_log}" | tee -a "${log_file}"
run_status=${PIPESTATUS[0]}
set -e

cp "${backup_alloc}" "${source_alloc}"

printf '\nSTATUS:%s\n' "${run_status}" | tee -a "${log_file}"
rg -q 'WASMACS_PURECOPY' "${run_log}"
rg -q 'WASMACS_PURE_ALLOC' "${run_log}"

if [ "${run_status}" -eq 0 ]; then
  printf 'RESULT:PASS purecopy trace completed\n' | tee -a "${log_file}"
else
  last_trace="$(rg 'WASMACS_PURE(COPY|_ALLOC)' "${run_log}" | tail -1 || true)"
  printf 'RESULT:KNOWN_BLOCKER purecopy trace status %s after %s\n' "${run_status}" "${last_trace}" | tee -a "${log_file}"
fi
