#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_file="${repo_root}/build/emacs-core-spike/src/src/emacs.c"

if [ ! -f "${source_file}" ]; then
  "${repo_root}/scripts/build-emacs-core-spike.sh"
fi

read -r -d '' entrypoint_block <<'EOF' || true
static char *wasmacs_last_eval_result;
static char *wasmacs_last_minibuffer_state;
static int wasmacs_command_busy;

__attribute__ ((used, visibility ("default")))
const char *
wasmacs_last_result (void)
{
  return wasmacs_last_eval_result ? wasmacs_last_eval_result : "";
}

__attribute__ ((used, visibility ("default")))
const char *
wasmacs_command_state (void)
{
  if (wasmacs_command_busy)
    return "pending";
  return "idle";
}

static void
wasmacs_append_text (char **buffer, ptrdiff_t *length, ptrdiff_t *capacity,
                     const char *text)
{
  ptrdiff_t text_length = strlen (text);
  if (*length + text_length + 1 > *capacity)
    {
      while (*length + text_length + 1 > *capacity)
        *capacity *= 2;
      *buffer = xrealloc (*buffer, *capacity);
    }
  memcpy (*buffer + *length, text, text_length);
  *length += text_length;
  (*buffer)[*length] = '\0';
}

static void
wasmacs_append_lisp_string (char **buffer, ptrdiff_t *length,
                            ptrdiff_t *capacity, Lisp_Object value)
{
  if (!STRINGP (value))
    return;

  const char *data = SSDATA (value);
  ptrdiff_t bytes = SBYTES (value);
  for (ptrdiff_t i = 0; i < bytes; i++)
    {
      char escaped[3];
      if (data[i] == '\n')
        wasmacs_append_text (buffer, length, capacity, "\\n");
      else if (data[i] == '\\')
        wasmacs_append_text (buffer, length, capacity, "\\\\");
      else
        {
          escaped[0] = data[i];
          escaped[1] = '\0';
          wasmacs_append_text (buffer, length, capacity, escaped);
        }
    }
}

__attribute__ ((used, visibility ("default")))
const char *
wasmacs_minibuffer_state (void)
{
  specpdl_ref gc_count = inhibit_garbage_collection ();
  ptrdiff_t capacity = 1024;
  ptrdiff_t length = 0;
  ptrdiff_t point_value = PT;
  char *state = xmalloc (capacity);
  state[0] = '\0';

  wasmacs_append_text (&state, &length, &capacity,
                       minibuf_level > 0 ? "active:true\n" : "active:false\n");

  char depth[64];
  snprintf (depth, sizeof depth, "depth:%"pI"d\n", minibuf_level);
  wasmacs_append_text (&state, &length, &capacity, depth);

  wasmacs_append_text (&state, &length, &capacity, "prompt:");
  if (minibuf_level > 0)
    wasmacs_append_lisp_string (&state, &length, &capacity,
                                call0 (intern_c_string ("minibuffer-prompt")));
  wasmacs_append_text (&state, &length, &capacity, "\n");

  wasmacs_append_text (&state, &length, &capacity, "input:");
  if (minibuf_level > 0)
    {
      Lisp_Object saved_buffer = Fcurrent_buffer ();
      Fset_buffer (get_minibuffer (minibuf_level));
      wasmacs_append_lisp_string (&state, &length, &capacity,
                                  call0 (intern_c_string ("minibuffer-contents-no-properties")));
      point_value = PT;
      Fset_buffer (saved_buffer);
    }
  wasmacs_append_text (&state, &length, &capacity, "\n");

  char point[64];
  snprintf (point, sizeof point, "point:%"pD"d\n", point_value);
  wasmacs_append_text (&state, &length, &capacity, point);

  wasmacs_append_text (&state, &length, &capacity,
                       minibuf_level > 0 && is_minibuffer (minibuf_level, Fcurrent_buffer ())
                       ? "current-minibuffer:true\n"
                       : "current-minibuffer:false\n");

  xfree (wasmacs_last_minibuffer_state);
  wasmacs_last_minibuffer_state = state;
  unbind_to (gc_count, Qnil);
  return wasmacs_last_minibuffer_state;
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

static void
wasmacs_store_c_string_result (const char *value)
{
  xfree (wasmacs_last_eval_result);
  wasmacs_last_eval_result = xstrdup (value);
}

__attribute__ ((used, visibility ("default")))
int
wasmacs_command_begin_minibuffer_probe (void)
{
  if (wasmacs_command_busy)
    {
      wasmacs_store_c_string_result ("unavailable:busy");
      return 3;
    }

  if (noninteractive)
    {
      wasmacs_store_c_string_result ("unavailable:noninteractive-batch");
      return 3;
    }

  wasmacs_store_c_string_result ("unavailable:interactive-suspend-entrypoint-not-implemented");
  return 3;
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
  if (wasmacs_command_busy)
    {
      wasmacs_store_c_string_result ("unavailable:busy");
      return 3;
    }

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
