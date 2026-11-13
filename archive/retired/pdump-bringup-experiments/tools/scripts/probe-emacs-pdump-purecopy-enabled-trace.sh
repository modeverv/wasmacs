#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
build_src="${repo_root}/build/emacs-pdump-configure-probe/src"
build_dir="${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump/src"
source_alloc="${build_src}/src/alloc.c"
real_bindings="${build_src}/lisp/bindings.el"
probe_dir="${repo_root}/build/emacs-pdump-configure-probe/purecopy-enabled-trace"
backup_alloc="${probe_dir}/alloc.c.original"
backup_bindings="${probe_dir}/bindings.el.original"
log_file="${repo_root}/logs/emacs-pdump-purecopy-enabled-trace.txt"

if [ ! -f "${source_alloc}" ]; then
  "${repo_root}/src/build/probe-emacs-pdump-configure.sh"
fi

mkdir -p "${probe_dir}" "${repo_root}/logs"
cp "${source_alloc}" "${backup_alloc}"
cp "${real_bindings}" "${backup_bindings}"

perl -0pi -e '
  s/(static ptrdiff_t pure_bytes_used_non_lisp;\n)/$1\nstatic bool wasmacs_purecopy_trace_enabled;\nstatic int wasmacs_purecopy_trace_count;\n/s;
  s/(  else\n    return purecopy \(obj\);)/  else\n    {\n      if (pure_bytes_used > 800000)\n        {\n          wasmacs_purecopy_trace_enabled = true;\n          wasmacs_purecopy_trace_count = 0;\n        }\n      else\n        wasmacs_purecopy_trace_enabled = false;\n      return purecopy (obj);\n    }/s;
  s/(static Lisp_Object\npurecopy \(Lisp_Object obj\)\n\{\n)/$1  int wasmacs_trace_index = -1;\n  bool wasmacs_trace = false;\n  if (wasmacs_purecopy_trace_enabled)\n    {\n      wasmacs_trace_index = wasmacs_purecopy_trace_count++;\n      wasmacs_trace = wasmacs_trace_index < 3000;\n    }\n  if (wasmacs_trace)\n    {\n      const char *kind = \"other\";\n      if (FIXNUMP (obj))\n        kind = \"fixnum\";\n      else if (CONSP (obj))\n        kind = \"cons\";\n      else if (SYMBOLP (obj))\n        kind = \"symbol\";\n      else if (STRINGP (obj))\n        kind = \"string\";\n      else if (CLOSUREP (obj))\n        kind = \"closure\";\n      else if (VECTORP (obj))\n        kind = \"vector\";\n      else if (RECORDP (obj))\n        kind = \"record\";\n      else if (HASH_TABLE_P (obj))\n        kind = \"hash-table\";\n      else if (FLOATP (obj))\n        kind = \"float\";\n      else if (SUBRP (obj))\n        kind = \"subr\";\n      fprintf (stderr,\n               \"WASMACS_ENABLED_PURECOPY entry #%d kind=%s raw=0x%jx ptr=%p pure=%d used=%td\\n\",\n               wasmacs_trace_index, kind, (uintmax_t) XLI (obj),\n               FIXNUMP (obj) ? NULL : XPNTR (obj),\n               FIXNUMP (obj) ? 0 : PURE_P (XPNTR (obj)), pure_bytes_used);\n    }\n/s;
  s/(      ptrdiff_t nbytes = vector_nbytes \(objp\);\n)/$1      if (wasmacs_trace)\n        fprintf (stderr,\n                 \"WASMACS_ENABLED_PURECOPY vector #%d nbytes=%td asize=%td header=0x%jx\\n\",\n                 wasmacs_trace_index, nbytes, ASIZE (obj),\n                 (uintmax_t) objp->header.size);\n/s;
  s/(      Lisp_Object tmp = Fgethash \(obj, Vpurify_flag, Qnil\);\n)/$1      if (wasmacs_trace)\n        fprintf (stderr,\n                 \"WASMACS_ENABLED_PURECOPY gethash #%d hit=%d tmp_raw=0x%jx tmp_ptr=%p\\n\",\n                 wasmacs_trace_index, !NILP (tmp), (uintmax_t) XLI (tmp),\n                 NILP (tmp) || FIXNUMP (tmp) ? NULL : XPNTR (tmp));\n/s;
  s/(  if \(HASH_TABLE_P \(Vpurify_flag\)\) \/\* Hash consing\.  \*\/\n)    Fputhash \(obj, obj, Vpurify_flag\);/$1    {\n      if (wasmacs_trace)\n        fprintf (stderr,\n                 \"WASMACS_ENABLED_PURECOPY puthash #%d obj_raw=0x%jx obj_ptr=%p\\n\",\n                 wasmacs_trace_index, (uintmax_t) XLI (obj),\n                 FIXNUMP (obj) ? NULL : XPNTR (obj));\n      Fputhash (obj, obj, Vpurify_flag);\n    }/s;
' "${source_alloc}"

WASMACS_REPLACEMENT='(defvar mode-line-input-method-map
  (let ((map (make-sparse-keymap)))
    (define-key map [mode-line mouse-2]
      (lambda (e) (interactive "e") (ignore e)))
    (define-key map [mode-line mouse-3]
      (lambda (e) (interactive "e") (ignore e)))
    (message "wasmacs enabled trace: before input-only purecopy")
    (prog1 (purecopy map)
      (message "wasmacs enabled trace: after input-only purecopy"))))

(defvar mode-line-coding-system-map
  (let ((map (make-sparse-keymap)))
    (message "wasmacs enabled trace: coding purecopy skipped")
    map)
  "Local keymap for the coding-system part of the mode line.")' perl -0pe '
  my $replacement = $ENV{"WASMACS_REPLACEMENT"};
  s/\(defvar mode-line-input-method-map\n  \(let \(\(map \(make-sparse-keymap\)\)\).*?\n    \(purecopy map\)\)\)\n\n\(defvar mode-line-coding-system-map\n  \(let \(\(map \(make-sparse-keymap\)\)\).*?\n    \(purecopy map\)\)\n  "Local keymap for the coding-system part of the mode line\."\)/$replacement/s;
' "${backup_bindings}" > "${real_bindings}"

{
  printf 'pdump purecopy enabled trace probe\n'
  printf 'source alloc: %s\n' "${source_alloc}"
  printf 'bindings variant: input-only purecopy with C trace enabled immediately before purecopy\n'
  printf '\n'
} > "${log_file}"

restore_sources() {
  cp "${backup_alloc}" "${source_alloc}"
  cp "${backup_bindings}" "${real_bindings}"
}
trap restore_sources EXIT

set +e
EMACS_WASM_LDFLAGS='-sNODERAWFS=1 -sEXIT_RUNTIME=1 -sSTACK_SIZE=134217728 -sSTACK_OVERFLOW_CHECK=0 -sINITIAL_MEMORY=1073741824 -sALLOW_MEMORY_GROWTH=1' \
  "${repo_root}/tools/scripts/probe-emacs-pdump-temacs-build.sh" 2>&1 | tee -a "${log_file}"
build_status=${PIPESTATUS[0]}
set -e

if [ "${build_status}" -ne 0 ]; then
  printf 'RESULT:BUILD_FAILED status %s\n' "${build_status}" | tee -a "${log_file}"
  exit "${build_status}"
fi

set +e
(
  cd "${build_dir}"
  EMACSLOADPATH="${build_src}/lisp" \
    node --stack-size=65500 ./temacs --batch -l loadup --temacs=pdump
) 2>&1 | tee -a "${log_file}"
run_status=${PIPESTATUS[0]}
set -e

printf '\nSTATUS:%s\n' "${run_status}" | tee -a "${log_file}"
rg -q 'wasmacs enabled trace: before input-only purecopy' "${log_file}"
rg -q 'WASMACS_ENABLED_PURECOPY' "${log_file}"

if [ "${run_status}" -eq 0 ]; then
  printf 'RESULT:PASS enabled purecopy trace completed\n' | tee -a "${log_file}"
else
  last_trace="$(rg 'WASMACS_ENABLED_PURECOPY' "${log_file}" | tail -1 || true)"
  printf 'RESULT:KNOWN_BLOCKER enabled purecopy trace status %s after %s\n' "${run_status}" "${last_trace}" | tee -a "${log_file}"
fi
