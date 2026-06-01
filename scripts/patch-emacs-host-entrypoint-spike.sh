#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_file="${repo_root}/build/emacs-core-spike/src/src/emacs.c"

if [ ! -f "${source_file}" ]; then
  "${repo_root}/scripts/build-emacs-core-spike.sh"
fi

read -r -d '' entrypoint_block <<'EOF' || true
static char *wasmacs_last_eval_result;

__attribute__ ((used, visibility ("default")))
const char *
wasmacs_last_result (void)
{
  return wasmacs_last_eval_result ? wasmacs_last_eval_result : "";
}

static void
wasmacs_store_result (Lisp_Object value)
{
  Lisp_Object text = STRINGP (value) ? value : Fprin1_to_string (value, Qt, Qnil);
  ptrdiff_t size = SBYTES (text);
  char *copy = xmalloc (size + 1);
  memcpy (copy, SSDATA (text), size);
  copy[size] = '\0';
  xfree (wasmacs_last_eval_result);
  wasmacs_last_eval_result = copy;
}

static int wasmacs_eval_had_error;

static Lisp_Object
wasmacs_eval_body (Lisp_Object source)
{
  Lisp_Object read_result = call3 (intern_c_string ("read-from-string"),
                                  source, Qnil, Qnil);
  Lisp_Object form = Fcar (read_result);
  return Feval (form, Qt);
}

static Lisp_Object
wasmacs_eval_error_handler (Lisp_Object error)
{
  wasmacs_eval_had_error = 1;
  return Fcons (intern_c_string ("error"), error);
}

__attribute__ ((used, visibility ("default")))
int
wasmacs_eval_string (const char *utf8)
{
  /* callMain returns before JavaScript invokes this entrypoint.  Refresh the
     stack scan bottom so Emacs GC does not scan the old main frame.  */
  void *stack_bottom_variable;
  char const *saved_stack_bottom = stack_bottom;
  stack_bottom = (char *) &stack_bottom_variable;

  if (!utf8)
    {
      stack_bottom = saved_stack_bottom;
      return 2;
    }

  specpdl_ref gc_count = inhibit_garbage_collection ();
  Lisp_Object source = build_string (utf8);
  wasmacs_eval_had_error = 0;
  Lisp_Object result = internal_condition_case_1 (wasmacs_eval_body, source,
                                                 Qt,
                                                 wasmacs_eval_error_handler);
  wasmacs_store_result (result);
  unbind_to (gc_count, Qnil);
  stack_bottom = saved_stack_bottom;
  return wasmacs_eval_had_error ? 1 : 0;
}

EOF
export WASMACS_ENTRYPOINT_BLOCK="${entrypoint_block}"

if rg 'wasmacs_eval_string' "${source_file}" >/dev/null; then
  perl -0pi -e 's/static char \*wasmacs_last_eval_result;.*?\n+DEFUN \("invocation-name"/DEFUN ("invocation-name"/s' "$source_file"
fi

perl -0pi -e 'BEGIN { $block = $ENV{"WASMACS_ENTRYPOINT_BLOCK"} } s/DEFUN \("invocation-name", Finvocation_name, Sinvocation_name, 0, 0, 0,\n/${block}\nDEFUN ("invocation-name", Finvocation_name, Sinvocation_name, 0, 0, 0,\n/' "$source_file"
