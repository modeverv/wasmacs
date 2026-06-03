#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
spike_src="${WASMACS_SPIKE_SRC:-${repo_root}/build/emacs-core-spike/src}"
source_file="${spike_src}/src/emacs.c"
keyboard_file="${spike_src}/src/keyboard.c"
minibuf_file="${spike_src}/src/minibuf.c"
waitpoint_mode="${WASMACS_ASYNCIFY_WAITPOINT_MODE:-read-char}"

if [ ! -f "${source_file}" ] || [ ! -f "${keyboard_file}" ] || [ ! -f "${minibuf_file}" ]; then
  if [ "${spike_src}" = "${repo_root}/build/emacs-core-spike/src" ]; then
    "${repo_root}/scripts/build-emacs-core-spike.sh"
  else
    echo "error: source files not found at ${spike_src}/src/" >&2; exit 1
  fi
fi

read -r -d '' entrypoint_block <<'EOF' || true
static char *wasmacs_last_eval_result;
static char *wasmacs_last_minibuffer_state;
static char *wasmacs_last_entrypoint_state;
static int wasmacs_command_busy;
static int wasmacs_eval_had_error;
static int wasmacs_entrypoint_refresh_count;
static int wasmacs_pending_gc_inhibit_depth;
static int wasmacs_backtrace_args_pinned;
static char const *wasmacs_last_saved_stack_bottom;
static char const *wasmacs_last_entry_stack_bottom;
static void const *wasmacs_last_saved_stack_top;
static void const *wasmacs_last_entry_stack_top;

int wasmacs_pin_specpdl_backtrace_args (void);
int wasmacs_os_release_backtrace_args (void);
void wasmacs_write_display (void);
int wasmacs_os_push_gc_guard (void);
int wasmacs_os_pop_gc_guard (void);
int wasmacs_os_begin_command (const char *kind);
int wasmacs_os_finish_command (void);
int wasmacs_os_cancel_command (void);
static char const *wasmacs_os_phase_name (void);
static Lisp_Object wasmacs_eval_error_handler (Lisp_Object error);
static void wasmacs_append_text (char **buffer, ptrdiff_t *length,
                                 ptrdiff_t *capacity, const char *text);
static void wasmacs_store_c_string_result (const char *value);
static char const *wasmacs_specpdl_kind_name (enum specbind_tag kind);
static void wasmacs_append_specpdl_summary (char **buffer, ptrdiff_t *length,
                                            ptrdiff_t *capacity,
                                            union specbinding *first,
                                            union specbinding *limit);

#define WASMACS_ENTER_HOST_ENTRYPOINT(saved_bottom_name, saved_top_name) \
  void *wasmacs_entrypoint_stack_sentry; \
  char const *saved_bottom_name = stack_bottom; \
  void const *saved_top_name = current_thread->stack_top; \
  stack_bottom = (char *) &wasmacs_entrypoint_stack_sentry; \
  current_thread->stack_top = &wasmacs_entrypoint_stack_sentry; \
  wasmacs_last_saved_stack_bottom = saved_bottom_name; \
  wasmacs_last_saved_stack_top = saved_top_name; \
  wasmacs_last_entry_stack_bottom = stack_bottom; \
  wasmacs_last_entry_stack_top = current_thread->stack_top; \
  wasmacs_entrypoint_refresh_count++

#define WASMACS_LEAVE_HOST_ENTRYPOINT(saved_bottom_name, saved_top_name) \
  stack_bottom = saved_bottom_name; \
  current_thread->stack_top = saved_top_name

__attribute__ ((used, visibility ("default")))
const char *
wasmacs_last_result (void)
{
  return wasmacs_last_eval_result ? wasmacs_last_eval_result : "";
}

__attribute__ ((used, visibility ("default")))
const char *
wasmacs_entrypoint_state (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  intptr_t entry_gc_inhibited = garbage_collection_inhibited;
  specpdl_ref gc_count = inhibit_garbage_collection ();
  ptrdiff_t capacity = 1024;
  ptrdiff_t length = 0;
  char *state = xmalloc (capacity);
  state[0] = '\0';

  char line[256];
  snprintf (line, sizeof line, "command-state:%s\n",
            wasmacs_command_busy ? "pending" : "idle");
  wasmacs_append_text (&state, &length, &capacity, line);
  snprintf (line, sizeof line, "pending-asyncify-command:%s\n",
            wasmacs_command_busy ? "true" : "false");
  wasmacs_append_text (&state, &length, &capacity, line);
  snprintf (line, sizeof line, "minibuffer-depth:%"pI"d\n", minibuf_level);
  wasmacs_append_text (&state, &length, &capacity, line);
  snprintf (line, sizeof line, "command-loop-level:%"pI"d\n", command_loop_level);
  wasmacs_append_text (&state, &length, &capacity, line);
  snprintf (line, sizeof line, "specpdl-depth:%td\n",
            specpdl_ref_to_count (SPECPDL_INDEX ()));
  wasmacs_append_text (&state, &length, &capacity, line);
  snprintf (line, sizeof line, "specpdl-depth-before-state-read:%td\n",
            specpdl_ref_to_count (gc_count));
  wasmacs_append_text (&state, &length, &capacity, line);
  wasmacs_append_specpdl_summary (&state, &length, &capacity, specpdl,
                                  specpdl_ref_to_ptr (gc_count));
  snprintf (line, sizeof line, "gc-inhibit-depth:%d\n",
            wasmacs_pending_gc_inhibit_depth);
  wasmacs_append_text (&state, &length, &capacity, line);
  snprintf (line, sizeof line, "emacs-gc-inhibited:%td\n",
            (ptrdiff_t) entry_gc_inhibited);
  wasmacs_append_text (&state, &length, &capacity, line);
  snprintf (line, sizeof line, "entrypoint-refresh-count:%d\n",
            wasmacs_entrypoint_refresh_count);
  wasmacs_append_text (&state, &length, &capacity, line);
  snprintf (line, sizeof line, "stack-bottom-refreshed:%s\n",
            wasmacs_last_entry_stack_bottom != wasmacs_last_saved_stack_bottom
            ? "true" : "false");
  wasmacs_append_text (&state, &length, &capacity, line);
  snprintf (line, sizeof line, "stack-top-refreshed:%s\n",
            wasmacs_last_entry_stack_top != wasmacs_last_saved_stack_top
            ? "true" : "false");
  wasmacs_append_text (&state, &length, &capacity, line);

  xfree (wasmacs_last_entrypoint_state);
  wasmacs_last_entrypoint_state = state;
  unbind_to (gc_count, Qnil);
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return wasmacs_last_entrypoint_state;
}

__attribute__ ((used, visibility ("default")))
const char *
wasmacs_command_state (void)
{
  if (wasmacs_command_busy)
    return "pending";
  return "idle";
}

static char const *
wasmacs_os_phase_name (void)
{
  if (!initialized)
    return "uninitialized";
  if (wasmacs_command_busy && minibuf_level > 0)
    return "pending-input";
  if (wasmacs_command_busy)
    return "command-running";
  return "initialized";
}

__attribute__ ((used, visibility ("default")))
const char *
wasmacs_os_lifecycle_phase (void)
{
  return wasmacs_os_phase_name ();
}

__attribute__ ((used, visibility ("default")))
const char *
wasmacs_os_root_state_snapshot (void)
{
  return wasmacs_entrypoint_state ();
}

__attribute__ ((used, visibility ("default")))
int
wasmacs_os_gc_permission (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  int status = 0;
  if (!initialized)
    {
      wasmacs_store_c_string_result ("gc-permission:blocked:lifecycle");
      status = 3;
    }
  else if (wasmacs_command_busy)
    {
      wasmacs_store_c_string_result ("gc-permission:blocked:pending-command");
      status = 3;
    }
  else if (garbage_collection_inhibited)
    {
      wasmacs_store_c_string_result ("gc-permission:inhibited");
      status = 3;
    }
  else
    wasmacs_store_c_string_result ("gc-permission:allowed");

  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return status;
}

__attribute__ ((used, visibility ("default")))
const char *
wasmacs_os_pending_command_state (void)
{
  if (wasmacs_command_busy && minibuf_level > 0)
    return "pending-input";
  if (wasmacs_command_busy)
    return "command-running";
  return "idle";
}

__attribute__ ((used, visibility ("default")))
int
wasmacs_os_pin_backtrace_args (void)
{
  return wasmacs_pin_specpdl_backtrace_args ();
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

static char const *
wasmacs_specpdl_kind_name (enum specbind_tag kind)
{
  switch (kind)
    {
    case SPECPDL_UNWIND:
      return "UNWIND";
    case SPECPDL_UNWIND_ARRAY:
      return "UNWIND_ARRAY";
    case SPECPDL_UNWIND_PTR:
      return "UNWIND_PTR";
    case SPECPDL_UNWIND_INT:
      return "UNWIND_INT";
    case SPECPDL_UNWIND_INTMAX:
      return "UNWIND_INTMAX";
    case SPECPDL_UNWIND_EXCURSION:
      return "UNWIND_EXCURSION";
    case SPECPDL_UNWIND_VOID:
      return "UNWIND_VOID";
    case SPECPDL_BACKTRACE:
      return "BACKTRACE";
    case SPECPDL_NOP:
      return "NOP";
#ifdef HAVE_MODULES
    case SPECPDL_MODULE_RUNTIME:
      return "MODULE_RUNTIME";
    case SPECPDL_MODULE_ENVIRONMENT:
      return "MODULE_ENVIRONMENT";
#endif
    case SPECPDL_LET:
      return "LET";
    case SPECPDL_LET_LOCAL:
      return "LET_LOCAL";
    case SPECPDL_LET_DEFAULT:
      return "LET_DEFAULT";
    default:
      return "UNKNOWN";
    }
}

static void
wasmacs_append_specpdl_summary (char **buffer, ptrdiff_t *length,
                                ptrdiff_t *capacity,
                                union specbinding *first,
                                union specbinding *limit)
{
  ptrdiff_t total = limit - first;
  ptrdiff_t unwind = 0;
  ptrdiff_t unwind_array = 0;
  ptrdiff_t unwind_ptr = 0;
  ptrdiff_t unwind_int = 0;
  ptrdiff_t unwind_intmax = 0;
  ptrdiff_t unwind_excursion = 0;
  ptrdiff_t unwind_void = 0;
  ptrdiff_t backtrace = 0;
  ptrdiff_t nop = 0;
  ptrdiff_t module_runtime = 0;
  ptrdiff_t module_environment = 0;
  ptrdiff_t let = 0;
  ptrdiff_t let_local = 0;
  ptrdiff_t let_default = 0;
  ptrdiff_t unknown = 0;

  for (union specbinding *pdl = first; pdl < limit; pdl++)
    {
      switch (pdl->kind)
        {
        case SPECPDL_UNWIND:
          unwind++;
          break;
        case SPECPDL_UNWIND_ARRAY:
          unwind_array++;
          break;
        case SPECPDL_UNWIND_PTR:
          unwind_ptr++;
          break;
        case SPECPDL_UNWIND_INT:
          unwind_int++;
          break;
        case SPECPDL_UNWIND_INTMAX:
          unwind_intmax++;
          break;
        case SPECPDL_UNWIND_EXCURSION:
          unwind_excursion++;
          break;
        case SPECPDL_UNWIND_VOID:
          unwind_void++;
          break;
        case SPECPDL_BACKTRACE:
          backtrace++;
          break;
        case SPECPDL_NOP:
          nop++;
          break;
#ifdef HAVE_MODULES
        case SPECPDL_MODULE_RUNTIME:
          module_runtime++;
          break;
        case SPECPDL_MODULE_ENVIRONMENT:
          module_environment++;
          break;
#endif
        case SPECPDL_LET:
          let++;
          break;
        case SPECPDL_LET_LOCAL:
          let_local++;
          break;
        case SPECPDL_LET_DEFAULT:
          let_default++;
          break;
        default:
          unknown++;
          break;
        }
    }

  char line[512];
  snprintf (line, sizeof line,
            "specpdl-summary:total=%td,unwind=%td,unwind-array=%td,"
            "unwind-ptr=%td,unwind-int=%td,unwind-intmax=%td,"
            "unwind-excursion=%td,unwind-void=%td,backtrace=%td,nop=%td,"
            "module-runtime=%td,module-environment=%td,let=%td,"
            "let-local=%td,let-default=%td,unknown=%td\n",
            total, unwind, unwind_array, unwind_ptr, unwind_int,
            unwind_intmax, unwind_excursion, unwind_void, backtrace, nop,
            module_runtime, module_environment, let, let_local, let_default,
            unknown);
  wasmacs_append_text (buffer, length, capacity, line);

  ptrdiff_t tail = total < 8 ? total : 8;
  for (ptrdiff_t i = total - tail; i < total; i++)
    {
      union specbinding *pdl = first + i;
      snprintf (line, sizeof line, "specpdl-tail[%td]:kind=%s", i,
                wasmacs_specpdl_kind_name (pdl->kind));
      wasmacs_append_text (buffer, length, capacity, line);
      if (pdl->kind == SPECPDL_BACKTRACE)
        {
          ptrdiff_t nargs = pdl->bt.nargs == UNEVALLED ? 1 : pdl->bt.nargs;
          snprintf (line, sizeof line,
                    ",function=0x%llx,args=%p,nargs=%td",
                    (unsigned long long) XLI (pdl->bt.function),
                    (void *) pdl->bt.args, pdl->bt.nargs);
          wasmacs_append_text (buffer, length, capacity, line);
          if (pdl->bt.args && nargs > 0)
            {
              ptrdiff_t arg_limit = nargs < 3 ? nargs : 3;
              for (ptrdiff_t j = 0; j < arg_limit; j++)
                {
                  snprintf (line, sizeof line, ",arg%td=0x%llx", j,
                            (unsigned long long) XLI (pdl->bt.args[j]));
                  wasmacs_append_text (buffer, length, capacity, line);
                }
            }
        }
      else if (pdl->kind == SPECPDL_UNWIND_ARRAY)
        {
          snprintf (line, sizeof line, ",array=%p,nelts=%td",
                    (void *) pdl->unwind_array.array,
                    pdl->unwind_array.nelts);
          wasmacs_append_text (buffer, length, capacity, line);
        }
      else if (pdl->kind == SPECPDL_UNWIND_PTR)
        {
          snprintf (line, sizeof line, ",arg=%p,mark=%p",
                    pdl->unwind_ptr.arg, (void *) pdl->unwind_ptr.mark);
          wasmacs_append_text (buffer, length, capacity, line);
        }
      wasmacs_append_text (buffer, length, capacity, "\n");
    }
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
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

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
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
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
  if (!wasmacs_backtrace_args_pinned)
    wasmacs_pin_specpdl_backtrace_args ();
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  specpdl_ref gc_count = inhibit_garbage_collection ();
  wasmacs_pending_gc_inhibit_depth++;

  Lisp_Object prompt = build_string ("Find file: ");
  Lisp_Object result = internal_condition_case_1 (wasmacs_read_minibuffer_probe_body,
                                                 prompt,
                                                 Qt,
                                                 wasmacs_eval_error_handler);
  wasmacs_store_result (result);
  wasmacs_pending_gc_inhibit_depth--;
  unbind_to (gc_count, Qnil);
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
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
wasmacs_pin_specpdl_backtrace_args (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  ptrdiff_t pinned = 0;
  if (!wasmacs_backtrace_args_pinned)
    {
      for (union specbinding *pdl = specpdl; pdl < specpdl_ptr; pdl++)
        {
          if (pdl->kind == SPECPDL_BACKTRACE && pdl->bt.args)
            {
              ptrdiff_t nargs = pdl->bt.nargs == UNEVALLED ? 1 : pdl->bt.nargs;
              if (nargs > 0)
                {
                  Lisp_Object *copy = xmalloc (nargs * sizeof *copy);
                  memcpy (copy, pdl->bt.args, nargs * sizeof *copy);
                  pdl->bt.args = copy;
                  pinned++;
                }
            }
        }
      wasmacs_backtrace_args_pinned = 1;
    }

  char result[80];
  snprintf (result, sizeof result, "pinned-backtrace-args:%td", pinned);
  wasmacs_store_c_string_result (result);
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return 0;
}

__attribute__ ((used, visibility ("default")))
int
wasmacs_scrub_specpdl_backtrace_args (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  ptrdiff_t scrubbed = 0;
  for (union specbinding *pdl = specpdl; pdl < specpdl_ptr; pdl++)
    {
      if (pdl->kind == SPECPDL_BACKTRACE && pdl->bt.nargs != 0)
        {
          pdl->bt.args = NULL;
          pdl->bt.nargs = 0;
          scrubbed++;
        }
    }

  char result[80];
  snprintf (result, sizeof result, "scrubbed-backtrace-args:%td", scrubbed);
  wasmacs_store_c_string_result (result);
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return 0;
}

__attribute__ ((used, visibility ("default")))
int
wasmacs_garbage_collect (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  if (wasmacs_command_busy)
    {
      wasmacs_store_c_string_result ("unavailable:busy");
      WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
      return 3;
    }

  if (garbage_collection_inhibited)
    {
      wasmacs_store_c_string_result ("unavailable:gc-inhibited");
      WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
      return 3;
    }

  specpdl_ref count = SPECPDL_INDEX ();
  specbind (Qsymbols_with_pos_enabled, Qnil);
  garbage_collect ();
  unbind_to (count, Qnil);
  wasmacs_store_c_string_result ("garbage-collected");
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return 0;
}

__attribute__ ((used, visibility ("default")))
int
wasmacs_eval_string (const char *utf8)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  if (wasmacs_command_busy)
    {
      wasmacs_store_c_string_result ("unavailable:busy");
      WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
      return 3;
    }

  if (!utf8)
    {
      WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
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
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return wasmacs_eval_had_error ? 1 : 0;
}

/* --- C/wasm OS compat kernel: Memory And Root Service --- */

__attribute__ ((used, visibility ("default")))
int
wasmacs_os_release_backtrace_args (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  if (!wasmacs_backtrace_args_pinned)
    {
      wasmacs_store_c_string_result ("release-backtrace-args:not-pinned");
      WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
      return 0;
    }

  ptrdiff_t freed = 0;
  for (union specbinding *pdl = specpdl; pdl < specpdl_ptr; pdl++)
    {
      if (pdl->kind == SPECPDL_BACKTRACE && pdl->bt.args)
        {
          /* Only xfree copies we xmalloc'd: those where nargs > 0 after
             treating UNEVALLED as 1 (matching the pin condition).  */
          ptrdiff_t nargs = pdl->bt.nargs == UNEVALLED ? 1 : pdl->bt.nargs;
          if (nargs > 0)
            xfree (pdl->bt.args);
          pdl->bt.args = NULL;
          pdl->bt.nargs = 0;
          freed++;
        }
    }

  wasmacs_backtrace_args_pinned = 0;
  char result[80];
  snprintf (result, sizeof result, "released-backtrace-args:%td", freed);
  wasmacs_store_c_string_result (result);
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return 0;
}

__attribute__ ((used, visibility ("default")))
int
wasmacs_os_push_gc_guard (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  garbage_collection_inhibited++;
  wasmacs_pending_gc_inhibit_depth++;

  char result[80];
  snprintf (result, sizeof result,
            "gc-guard-pushed:emacs-depth=%d:wasmacs-depth=%d",
            garbage_collection_inhibited,
            wasmacs_pending_gc_inhibit_depth);
  wasmacs_store_c_string_result (result);
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return 0;
}

__attribute__ ((used, visibility ("default")))
int
wasmacs_os_pop_gc_guard (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  if (wasmacs_pending_gc_inhibit_depth <= 0)
    {
      wasmacs_store_c_string_result ("gc-guard-pop:underflow");
      WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
      return 1;
    }

  garbage_collection_inhibited--;
  wasmacs_pending_gc_inhibit_depth--;

  char result[80];
  snprintf (result, sizeof result,
            "gc-guard-popped:emacs-depth=%d:wasmacs-depth=%d",
            garbage_collection_inhibited,
            wasmacs_pending_gc_inhibit_depth);
  wasmacs_store_c_string_result (result);
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return 0;
}

/* --- C/wasm OS compat kernel: Blocking Input Scheduler / Control Flow --- */

__attribute__ ((used, visibility ("default")))
int
wasmacs_os_begin_command (const char *kind)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  if (wasmacs_command_busy)
    {
      wasmacs_store_c_string_result ("unavailable:busy");
      WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
      return 3;
    }

  wasmacs_command_busy = 1;
  /* Pin baseline backtrace args before the Asyncify suspend path runs.  */
  wasmacs_pin_specpdl_backtrace_args ();

  char result[128];
  snprintf (result, sizeof result,
            "command-begun:kind=%s", kind ? kind : "unknown");
  wasmacs_store_c_string_result (result);
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return 0;
}

__attribute__ ((used, visibility ("default")))
int
wasmacs_os_finish_command (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  if (!wasmacs_command_busy)
    {
      wasmacs_store_c_string_result ("finish-command:not-busy");
      WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
      return 0;
    }

  /* Release pinned backtrace args from the command's Asyncify suspension.  */
  if (wasmacs_backtrace_args_pinned)
    {
      for (union specbinding *pdl = specpdl; pdl < specpdl_ptr; pdl++)
        if (pdl->kind == SPECPDL_BACKTRACE && pdl->bt.args)
          {
            ptrdiff_t nargs = pdl->bt.nargs == UNEVALLED ? 1 : pdl->bt.nargs;
            if (nargs > 0)
              xfree (pdl->bt.args);
            pdl->bt.args = NULL;
            pdl->bt.nargs = 0;
          }
      wasmacs_backtrace_args_pinned = 0;
    }

  /* Restore any GC inhibit pushed for the command's pending-input window.  */
  while (wasmacs_pending_gc_inhibit_depth > 0)
    {
      garbage_collection_inhibited--;
      wasmacs_pending_gc_inhibit_depth--;
    }

  wasmacs_command_busy = 0;
  wasmacs_store_c_string_result ("command-finished");
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return 0;
}

__attribute__ ((used, visibility ("default")))
int
wasmacs_os_cancel_command (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  if (!wasmacs_command_busy)
    {
      wasmacs_store_c_string_result ("cancel-command:not-busy");
      WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
      return 0;
    }

  /* Inject quit via Vunread_command_events so the suspended Emacs reader
     unwinds through the normal C-g / keyboard-quit path.  */
  Vunread_command_events = list1i (quit_char);
  wasmacs_store_c_string_result ("command-cancel-queued");
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return 0;
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
