#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_file="${repo_root}/build/emacs-core-spike/src/src/emacs.c"
keyboard_file="${repo_root}/build/emacs-core-spike/src/src/keyboard.c"
minibuf_file="${repo_root}/build/emacs-core-spike/src/src/minibuf.c"
waitpoint_mode="${WASMACS_ASYNCIFY_WAITPOINT_MODE:-read-char}"

if [ ! -f "${source_file}" ] || [ ! -f "${keyboard_file}" ] || [ ! -f "${minibuf_file}" ]; then
  "${repo_root}/scripts/build-emacs-core-spike.sh"
fi

read -r -d '' entrypoint_block <<'EOF' || true
static char *wasmacs_last_eval_result;
static char *wasmacs_last_minibuffer_state;
static int wasmacs_command_busy;
static int wasmacs_eval_had_error;

static Lisp_Object wasmacs_eval_error_handler (Lisp_Object error);

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

static Lisp_Object
wasmacs_read_minibuffer_probe_body (Lisp_Object prompt)
{
  return call1 (intern_c_string ("read-from-minibuffer"), prompt);
}

__attribute__ ((used, visibility ("default")))
int
wasmacs_command_begin_minibuffer_force_probe (void)
{
  if (wasmacs_command_busy)
    {
      wasmacs_store_c_string_result ("unavailable:busy");
      return 3;
    }

  wasmacs_command_busy = 1;
  bool saved_noninteractive = noninteractive;
  noninteractive = false;
  wasmacs_eval_had_error = 0;
  specpdl_ref gc_count = inhibit_garbage_collection ();

  Lisp_Object prompt = build_string ("Find file: ");
  Lisp_Object result = internal_condition_case_1 (wasmacs_read_minibuffer_probe_body,
                                                 prompt,
                                                 Qt,
                                                 wasmacs_eval_error_handler);
  wasmacs_store_result (result);
  unbind_to (gc_count, Qnil);
  noninteractive = saved_noninteractive;
  wasmacs_command_busy = 0;
  return wasmacs_eval_had_error ? 1 : 0;
}

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

if rg 'wasmacs_host_wait_for_input' "${keyboard_file}" >/dev/null; then
  perl -0pi -e 's#/\* wasmacs browser input injection spike\. \*/.*?\nvoid\nkbd_buffer_store_event#void\nkbd_buffer_store_event#sg' "${keyboard_file}"
  perl -0pi -e 's/\n\/\* wasmacs asyncify input waitpoint spike\. \*\/\nextern int wasmacs_host_wait_for_input \(void\);\n//s' "${keyboard_file}"
  perl -0pi -e 's/\n\s+\/\* wasmacs asyncify input waitpoint spike: yield only while an\n\s+active minibuffer read is waiting for real input\.  The JS import is\n\s+currently a no-op probe hook; later input-event work must make this\n\s+the suspension point that browser input resumes\.  \*\/\n\s+if \(minibuf_level > 0 && !end_time && !input_pending\n\s+&& !detect_input_pending_run_timers \(0\)\)\n\s+wasmacs_host_wait_for_input \(\);\n//s' "${keyboard_file}"
fi

if rg 'wasmacs_host_wait_for_input' "${minibuf_file}" >/dev/null; then
  perl -0pi -e 's/\n\/\* wasmacs asyncify minibuffer setup waitpoint spike\. \*\/\nextern int wasmacs_host_wait_for_input \(void\);\n//s' "${minibuf_file}"
  perl -0pi -e 's/\n\s+\/\* wasmacs asyncify minibuffer setup waitpoint spike: yield after\n\s+the minibuffer buffer, prompt, window, keymap, and setup hook are active,\n\s+but before recursive_edit_1 starts consuming input\.  This compares a\n\s+shallower suspend boundary against the read_char waitpoint\.  \*\/\n\s+wasmacs_host_wait_for_input \(\);\n//s' "${minibuf_file}"
fi

read -r -d '' input_block <<'EOF' || true
/* wasmacs browser input injection spike. */
__attribute__ ((used, visibility ("default")))
int
wasmacs_input_text (const char *utf8)
{
  if (!utf8)
    return 2;

  while (*utf8)
    {
      unsigned char byte = (unsigned char) *utf8++;
      if (byte >= 0x80)
        return 4;

      struct input_event event;
      EVENT_INIT (event);
      event.kind = ASCII_KEYSTROKE_EVENT;
      event.modifiers = 0;
      event.code = byte;
      event.frame_or_window = selected_frame;
      event.arg = Qnil;
      event.timestamp = 0;
      kbd_buffer_store_event (&event);
    }

  return 0;
}

__attribute__ ((used, visibility ("default")))
int
wasmacs_input_cancel (void)
{
  Vunread_command_events = list1i (quit_char);
  return 0;
}

EOF
export WASMACS_INPUT_BLOCK="${input_block}"

if rg 'wasmacs_input_text' "${keyboard_file}" >/dev/null; then
  perl -0pi -e 's#/\* wasmacs browser input injection spike\. \*/.*?\nvoid\nkbd_buffer_store_event#void\nkbd_buffer_store_event#sg' "${keyboard_file}"
fi

perl -0pi -e 'BEGIN { $block = $ENV{"WASMACS_INPUT_BLOCK"} } s#void\nkbd_buffer_store_event \(register struct input_event \*event\)\n\{#\n\n${block}\nvoid\nkbd_buffer_store_event (register struct input_event *event)\n{#' "${keyboard_file}"

if [ "${WASMACS_ENABLE_ASYNCIFY_WAITPOINT:-0}" = "1" ]; then
  case "${waitpoint_mode}" in
    read-char)
      perl -0pi -e 's#/\* Read a character from the keyboard; call the redisplay if needed\.  \*/#/\* wasmacs asyncify input waitpoint spike. \*/\nextern int wasmacs_host_wait_for_input (void);\n\n/\* Read a character from the keyboard; call the redisplay if needed.  \*/#' "${keyboard_file}"

      perl -0pi -e 's#  if \(NILP \(c\)\)\n    \{\n      c = read_decoded_event_from_main_queue \(end_time, local_getcjmp,\n                                              prev_event, used_mouse_menu\);#  if (NILP (c))\n    {\n      /* wasmacs asyncify input waitpoint spike: yield only while an\n         active minibuffer read is waiting for real input.  The JS import is\n         currently a no-op probe hook; later input-event work must make this\n         the suspension point that browser input resumes.  */\n      if (minibuf_level > 0 && !end_time && !input_pending\n          && !detect_input_pending_run_timers (0))\n        wasmacs_host_wait_for_input ();\n\n      c = read_decoded_event_from_main_queue (end_time, local_getcjmp,\n                                              prev_event, used_mouse_menu);#' "${keyboard_file}"
      ;;
    minibuf-setup)
      perl -0pi -e 's#static Lisp_Object\nread_minibuf #/\* wasmacs asyncify minibuffer setup waitpoint spike. \*/\nextern int wasmacs_host_wait_for_input (void);\n\nstatic Lisp_Object\nread_minibuf #' "${minibuf_file}"

      perl -0pi -e 's#\n  recursive_edit_1 \(\);#\n  /* wasmacs asyncify minibuffer setup waitpoint spike: yield after\n     the minibuffer buffer, prompt, window, keymap, and setup hook are active,\n     but before recursive_edit_1 starts consuming input.  This compares a\n     shallower suspend boundary against the read_char waitpoint.  */\n  wasmacs_host_wait_for_input ();\n\n  recursive_edit_1 ();#' "${minibuf_file}"
      ;;
    *)
      echo "error: unsupported WASMACS_ASYNCIFY_WAITPOINT_MODE=${waitpoint_mode}" >&2
      exit 2
      ;;
  esac
fi
