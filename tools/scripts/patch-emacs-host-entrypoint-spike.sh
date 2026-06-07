#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
spike_src="${WASMACS_SPIKE_SRC:-${repo_root}/build/emacs-core-spike/src}"
source_file="${spike_src}/src/emacs.c"
keyboard_file="${spike_src}/src/keyboard.c"
minibuf_file="${spike_src}/src/minibuf.c"
sysdep_file="${spike_src}/src/sysdep.c"
term_file="${spike_src}/src/term.c"
loadup_file="${spike_src}/lisp/loadup.el"
waitpoint_mode="${WASMACS_ASYNCIFY_WAITPOINT_MODE:-read-char}"
terminal_tty_enabled="${WASMACS_ENABLE_ASYNCIFY_WAITPOINT:-0}"

if [ ! -f "${source_file}" ] || [ ! -f "${keyboard_file}" ] || [ ! -f "${minibuf_file}" ] || [ ! -f "${sysdep_file}" ] || [ ! -f "${term_file}" ]; then
  if [ "${spike_src}" = "${repo_root}/build/emacs-core-spike/src" ]; then
    "${repo_root}/tools/scripts/build-emacs-core-spike.sh"
  else
    echo "error: source files not found at ${spike_src}/src/" >&2; exit 1
  fi
fi

if ! rg 'wasmacs tty direct-color output' "${term_file}" >/dev/null; then
  read -r -d '' WASMACS_TERM_DIRECT_COLOR_HELPER <<'EOF' || true
/* wasmacs tty direct-color output: the browser build uses internal
   termcap rather than terminfo, so Emacs' terminfo RGB/Tc fallback is not
   available.  When the inline TERMCAP advertises 24-bit color cells, emit
   xterm direct-color SGR from the already translated tty pixel. */
#ifdef __EMSCRIPTEN__
static void
wasmacs_tty_output_direct_color (struct tty_display_info *tty,
                                 bool background, unsigned long pixel)
{
  char sequence[32];
  int red = (pixel >> 16) & 0xff;
  int green = (pixel >> 8) & 0xff;
  int blue = pixel & 0xff;
  snprintf (sequence, sizeof sequence, "\033[%d;2;%d;%d;%dm",
            background ? 48 : 38, red, green, blue);
  OUTPUT1 (tty, sequence);
}
#endif

static void
turn_on_face (struct frame *f, int face_id)
{
EOF
  WASMACS_TERM_DIRECT_COLOR_HELPER="${WASMACS_TERM_DIRECT_COLOR_HELPER}" \
    perl -0pi -e 's~static void\nturn_on_face \(struct frame \*f, int face_id\)\n\{~$ENV{WASMACS_TERM_DIRECT_COLOR_HELPER}~' "${term_file}"

  read -r -d '' WASMACS_TERM_DIRECT_COLOR_BRANCH <<'EOF' || true
      ts = tty->standout_mode ? tty->TS_set_background : tty->TS_set_foreground;
      if (face_tty_specified_color (fg) && ts)
	{
#ifdef __EMSCRIPTEN__
          if (tty->TN_max_colors == 16777216)
            wasmacs_tty_output_direct_color (tty, tty->standout_mode, fg);
          else
#endif
            {
              p = tparam (ts, NULL, 0, fg, 0, 0, 0);
	      OUTPUT (tty, p);
	      xfree (p);
            }
	}

      ts = tty->standout_mode ? tty->TS_set_foreground : tty->TS_set_background;
      if (face_tty_specified_color (bg) && ts)
	{
#ifdef __EMSCRIPTEN__
          if (tty->TN_max_colors == 16777216)
            wasmacs_tty_output_direct_color (tty, !tty->standout_mode, bg);
          else
#endif
            {
              p = tparam (ts, NULL, 0, bg, 0, 0, 0);
	      OUTPUT (tty, p);
	      xfree (p);
            }
	}
EOF
  WASMACS_TERM_DIRECT_COLOR_BRANCH="${WASMACS_TERM_DIRECT_COLOR_BRANCH}" \
    perl -0pi -e 's~      ts = tty->standout_mode \? tty->TS_set_background : tty->TS_set_foreground;\n      if \(face_tty_specified_color \(fg\) && ts\)\n\t\{\n          p = tparam \(ts, NULL, 0, fg, 0, 0, 0\);\n\t  OUTPUT \(tty, p\);\n\t  xfree \(p\);\n\t\}\n\n      ts = tty->standout_mode \? tty->TS_set_foreground : tty->TS_set_background;\n      if \(face_tty_specified_color \(bg\) && ts\)\n\t\{\n          p = tparam \(ts, NULL, 0, bg, 0, 0, 0\);\n\t  OUTPUT \(tty, p\);\n\t  xfree \(p\);\n\t\}~$ENV{WASMACS_TERM_DIRECT_COLOR_BRANCH}~' "${term_file}"
fi

if rg 'wasmacs terminal tty service spike' "${sysdep_file}" >/dev/null; then
  perl -0pi -e 's~\n/\* wasmacs terminal tty service spike\. \*/\nextern int wasmacs_host_wait_for_input \(void\);\nextern int wasmacs_host_terminal_input_available \(void\);\nextern int wasmacs_host_terminal_read_byte \(void\);\nextern int wasmacs_host_is_tty_fd \(int fd\);\nextern int wasmacs_host_scheduler_checkpoint \(int code\);\n~~' "${sysdep_file}"
  perl -0pi -e 's~\n#ifdef __EMSCRIPTEN__\n  if \(wasmacs_host_is_tty_fd \(fd\)\)\n    \{\n      unsigned char \*tty_buf = buf;\n      ptrdiff_t bytes_read = 0;\n\n      while \(bytes_read == 0\)\n        \{\n          while \(bytes_read < nbyte\)\n            \{\n              int byte = wasmacs_host_terminal_read_byte \(\);\n              if \(byte < 0\)\n                break;\n              tty_buf\[bytes_read\+\+\] = \(unsigned char\) byte;\n            \}\n\n          if \(bytes_read > 0\)\n            return bytes_read;\n\n          if \(interruptible\)\n            maybe_quit \(\);\n          wasmacs_host_wait_for_input \(\);\n        \}\n    \}\n#endif\n~~' "${sysdep_file}"
fi

if [ "${terminal_tty_enabled}" = "1" ] && [ "${waitpoint_mode}" != "os-compat" ]; then
  perl -0pi -e 's#/\* Read from FD to a buffer BUF with size NBYTE\.\n#/* wasmacs terminal tty service spike. */\nextern int wasmacs_host_wait_for_input (void);\nextern int wasmacs_host_terminal_input_available (void);\nextern int wasmacs_host_terminal_read_byte (void);\nextern int wasmacs_host_is_tty_fd (int fd);\nextern int wasmacs_host_scheduler_checkpoint (int code);\nextern void wasmacs_os_timing_checkpoint (int code);\n\n/* Read from FD to a buffer BUF with size NBYTE.\n#' "${sysdep_file}"

  perl -0pi -e 's~  ssize_t result;\n\n  do~  ssize_t result;\n\n#ifdef __EMSCRIPTEN__\n  if (wasmacs_host_is_tty_fd (fd))\n    {\n      unsigned char *tty_buf = buf;\n      ptrdiff_t bytes_read = 0;\n\n      while (bytes_read == 0)\n        {\n          while (bytes_read < nbyte)\n            {\n              int byte = wasmacs_host_terminal_read_byte ();\n              if (byte < 0)\n                break;\n              wasmacs_host_scheduler_checkpoint (102);\n              tty_buf[bytes_read++] = (unsigned char) byte;\n            }\n\n          if (bytes_read > 0)\n            return bytes_read;\n\n          if (interruptible)\n            maybe_quit ();\n          wasmacs_host_scheduler_checkpoint (100);\n          wasmacs_host_wait_for_input ();\n          wasmacs_host_scheduler_checkpoint (101);\n        }\n    }\n#endif\n\n  do~' "${sysdep_file}"
fi

read -r -d '' entrypoint_block <<'EOF' || true
static char *wasmacs_last_eval_result;
static char *wasmacs_last_minibuffer_state;
static char *wasmacs_last_interactive_state;
static char *wasmacs_last_entrypoint_state;
static char *wasmacs_last_os_lifecycle_state;
static char *wasmacs_last_os_stack_bounds_probe;
static char *wasmacs_last_os_gc_permission_state;
static char *wasmacs_last_os_root_safety_probe;
static char *wasmacs_last_os_filesystem_dired_state;
static char *wasmacs_last_os_terminal_resize_state;
static char *wasmacs_last_os_network_fetch_state;
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
int wasmacs_os_configure_dired_without_ls (void);
int wasmacs_os_dired_without_ls_probe (void);
int wasmacs_os_apply_terminal_resize (int width, int height);
const char *wasmacs_os_lifecycle_state (void);
const char *wasmacs_os_stack_bounds_probe (void);
const char *wasmacs_os_gc_permission_state (void);
const char *wasmacs_os_root_safety_probe (void);
const char *wasmacs_os_filesystem_dired_state (void);
const char *wasmacs_os_network_fetch_json (const char *request_json);
const char *wasmacs_os_url_fetch_loader_state (void);
static char const *wasmacs_os_phase_name (void);
static Lisp_Object wasmacs_eval_error_handler (Lisp_Object error);
static Lisp_Object wasmacs_recursive_edit_body (Lisp_Object ignored);
static void wasmacs_append_text (char **buffer, ptrdiff_t *length,
                                 ptrdiff_t *capacity, const char *text);
static void wasmacs_store_c_string_result (const char *value);
static char const *wasmacs_specpdl_kind_name (enum specbind_tag kind);
static void wasmacs_append_specpdl_summary (char **buffer, ptrdiff_t *length,
                                            ptrdiff_t *capacity,
                                            union specbinding *first,
                                            union specbinding *limit);

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
EM_JS (const char *, wasmacs_host_network_fetch_json,
       (const char *request_json),
       {
         function returnJson(value) {
           var json = JSON.stringify(value);
           var size = lengthBytesUTF8(json) + 1;
           var ptr = _malloc(size);
           if (!ptr)
             return 0;
           stringToUTF8(json, ptr, size);
           return ptr;
         }
         function fail(message) {
           return returnJson({ error: String(message) });
         }
         function isLocalHostName(name) {
           var normalized = String(name || "").toLowerCase();
           return normalized === "localhost"
             || normalized === "127.0.0.1"
             || normalized === "::1"
             || normalized === "[::1]";
         }
         function configuredProxyUrls(request) {
           var urls = [];
           var configured = "";
           if (request && request.proxyUrl)
             configured = String(request.proxyUrl || "");
           if (typeof Module !== "undefined" && Module && Module.wasmacsNetworkProxyUrl)
             configured = configured || String(Module.wasmacsNetworkProxyUrl || "");
           if (!configured && typeof globalThis !== "undefined" && globalThis.__wasmacsNetworkProxyUrl)
             configured = String(globalThis.__wasmacsNetworkProxyUrl || "");
           if (configured) {
             try {
               var parsed = new URL(configured, typeof location !== "undefined" ? location.href : "http://127.0.0.1:5173/");
               if (parsed.protocol === "http:" || parsed.protocol === "https:")
               urls.push(parsed.href);
             } catch (_) {}
           }
           if (typeof location !== "undefined") {
             if (isLocalHostName(location.hostname))
               urls.push(new URL("/__wasmacs_network_fetch", location.href).href);
           } else {
             urls.push("http://127.0.0.1:5173/__wasmacs_network_fetch");
           }
           return urls;
         }
         function proxyFetch(request, directError) {
           var urls = configuredProxyUrls(request);
           var errors = [];
           for (var i = 0; i < urls.length; i++) {
             var proxyUrl = urls[i];
             try {
               var proxy = new XMLHttpRequest();
               proxy.open("POST", proxyUrl, false);
               proxy.send(JSON.stringify(request));
               if (proxy.responseText) {
                 try {
                   return returnJson(JSON.parse(proxy.responseText));
                 } catch (parseError) {
                   errors.push(proxyUrl + " returned invalid JSON: " + parseError.message);
                   continue;
                 }
               }
               errors.push(proxyUrl + " status " + proxy.status);
             } catch (proxyError) {
               errors.push(proxyUrl + " failed"
                           + (proxyError && proxyError.message ? ": " + proxyError.message : ""));
             }
           }
           return fail("host.network.fetch direct request failed"
                       + (directError && directError.message ? ": " + directError.message : "")
                       + "; proxy attempts: " + errors.join("; "));
         }
         function bytesToBase64(bytes) {
           var chunkSize = 0x8000;
           var binary = "";
           for (var offset = 0; offset < bytes.length; offset += chunkSize) {
             var chunk = bytes.subarray(offset, offset + chunkSize);
             binary += String.fromCharCode.apply(null, chunk);
           }
           return btoa(binary);
         }
         try {
           var request = JSON.parse(UTF8ToString(request_json));
           var url = String(request.url || "");
           var parsed = new URL(url, typeof location !== "undefined" ? location.href : undefined);
           if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
             return fail("unsupported URL scheme: " + parsed.protocol);

           var method = String(request.method || "GET").toUpperCase();
           var xhr = new XMLHttpRequest();
           xhr.open(method, parsed.href, false);
           var headers = Array.isArray(request.headers) ? request.headers : [];
           for (var i = 0; i < headers.length; i++) {
             var header = headers[i];
             if (Array.isArray(header) && header.length >= 2)
               xhr.setRequestHeader(String(header[0]), String(header[1]));
             else if (header && typeof header === "object" && header.name)
               xhr.setRequestHeader(String(header.name), String(header.value || ""));
           }
           xhr.responseType = "arraybuffer";
           xhr.send(request.body || null);

           var responseHeaders = [];
           var rawHeaders = xhr.getAllResponseHeaders() || "";
           rawHeaders.trim().split(String.fromCharCode(10)).forEach(function (line) {
             if (line.charCodeAt(line.length - 1) === 13)
               line = line.slice(0, -1);
             if (!line) return;
             var colon = line.indexOf(":");
             if (colon <= 0) return;
             responseHeaders.push({
               name: line.slice(0, colon).trim().toLowerCase(),
               value: line.slice(colon + 1).trim(),
             });
           });
           var bodyBytes = new Uint8Array(xhr.response || new ArrayBuffer(0));
           return returnJson({
             url: xhr.responseURL || parsed.href,
             status: xhr.status,
             statusText: xhr.statusText || "",
             headers: responseHeaders,
             bodyBase64: bytesToBase64(bodyBytes),
           });
         } catch (error) {
           try {
             var fallbackRequest = JSON.parse(UTF8ToString(request_json));
             return proxyFetch(fallbackRequest, error);
           } catch (fallbackError) {
             return fail(fallbackError && fallbackError.message ? fallbackError.message : fallbackError);
           }
         }
       });
#else
static const char *
wasmacs_host_network_fetch_json (const char *request_json)
{
  return "{\"error\":\"host.network.fetch is only available in the wasm browser host\"}";
}
#endif

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
wasmacs_os_network_fetch_json (const char *request_json)
{
  return wasmacs_host_network_fetch_json (request_json);
}

DEFUN ("wasmacs-os-network-fetch-json", Fwasmacs_os_network_fetch_json,
       Swasmacs_os_network_fetch_json, 1, 1, 0,
       doc: /* Fetch a URL through the wasmacs host network service.
REQUEST-JSON is a JSON object with url, method, headers, and optional body.
Return a JSON response with status, statusText, headers, and bodyBase64.  */)
  (Lisp_Object request_json)
{
  CHECK_STRING (request_json);
  char const *response
    = wasmacs_os_network_fetch_json ((char const *) SSDATA (request_json));
  if (!response)
    return build_string ("{\"error\":\"host.network.fetch returned null\"}");
  Lisp_Object result = build_string (response);
  xfree ((void *) response);
  return result;
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
const char *
wasmacs_os_lifecycle_state (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  char *state = xmalloc (512);
  snprintf (state, 512,
            "{\"service\":\"Lifecycle\",\"owner\":\"C/wasm facade\","
            "\"diagnostic\":true,\"phase\":\"%s\",\"initialized\":%s,"
            "\"commandBusy\":%s,\"minibufferDepth\":%"pI"d,"
            "\"commandLoopLevel\":%"pI"d,\"pendingCommandState\":\"%s\"}",
            wasmacs_os_phase_name (),
            initialized ? "true" : "false",
            wasmacs_command_busy ? "true" : "false",
            minibuf_level,
            command_loop_level,
            wasmacs_os_pending_command_state ());

  xfree (wasmacs_last_os_lifecycle_state);
  wasmacs_last_os_lifecycle_state = state;
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return wasmacs_last_os_lifecycle_state;
}

__attribute__ ((used, visibility ("default")))
const char *
wasmacs_os_stack_bounds_probe (void)
{
  char current_stack_probe;
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  char *state = xmalloc (1024);
  snprintf (state, 1024,
            "{\"service\":\"Memory and Root\",\"owner\":\"C/wasm facade\","
            "\"diagnostic\":true,\"stackBottomRefreshed\":%s,"
            "\"stackTopRefreshed\":%s,\"savedStackBottomAddress\":\"%p\","
            "\"entryStackBottomAddress\":\"%p\",\"savedStackTopAddress\":\"%p\","
            "\"entryStackTopAddress\":\"%p\",\"currentStackProbeAddress\":\"%p\","
            "\"entrypointRefreshCount\":%d}",
            wasmacs_last_entry_stack_bottom != wasmacs_last_saved_stack_bottom
            ? "true" : "false",
            wasmacs_last_entry_stack_top != wasmacs_last_saved_stack_top
            ? "true" : "false",
            wasmacs_last_saved_stack_bottom,
            wasmacs_last_entry_stack_bottom,
            wasmacs_last_saved_stack_top,
            wasmacs_last_entry_stack_top,
            &current_stack_probe,
            wasmacs_entrypoint_refresh_count);

  xfree (wasmacs_last_os_stack_bounds_probe);
  wasmacs_last_os_stack_bounds_probe = state;
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return wasmacs_last_os_stack_bounds_probe;
}

__attribute__ ((used, visibility ("default")))
const char *
wasmacs_os_gc_permission_state (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  bool allowed = false;
  const char *reason = "allowed";
  if (!initialized)
    reason = "blocked:lifecycle";
  else if (wasmacs_command_busy)
    reason = "blocked:pending-command";
  else if (garbage_collection_inhibited)
    reason = "inhibited";
  else
    allowed = true;

  char *state = xmalloc (768);
  snprintf (state, 768,
            "{\"service\":\"Memory and Root\",\"owner\":\"C/wasm facade\","
            "\"diagnostic\":true,\"allowed\":%s,\"reason\":\"%s\","
            "\"garbageCollectionInhibited\":%td,\"wasmacsGcGuardDepth\":%d,"
            "\"pendingCommandState\":\"%s\",\"stackRootsFresh\":%s}",
            allowed ? "true" : "false",
            reason,
            (ptrdiff_t) garbage_collection_inhibited,
            wasmacs_pending_gc_inhibit_depth,
            wasmacs_os_pending_command_state (),
            (wasmacs_last_entry_stack_bottom != wasmacs_last_saved_stack_bottom
             && wasmacs_last_entry_stack_top != wasmacs_last_saved_stack_top)
            ? "true" : "false");

  xfree (wasmacs_last_os_gc_permission_state);
  wasmacs_last_os_gc_permission_state = state;
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return wasmacs_last_os_gc_permission_state;
}

__attribute__ ((used, visibility ("default")))
const char *
wasmacs_os_root_safety_probe (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  bool stack_roots_fresh
    = (wasmacs_last_entry_stack_bottom != wasmacs_last_saved_stack_bottom
       && wasmacs_last_entry_stack_top != wasmacs_last_saved_stack_top);
  bool gc_allowed = initialized && !wasmacs_command_busy
                    && !garbage_collection_inhibited;
  char *state = xmalloc (768);
  snprintf (state, 768,
            "{\"service\":\"Memory and Root\",\"owner\":\"C/wasm facade\","
            "\"diagnostic\":true,\"policyDefined\":true,"
            "\"entrypointRefreshCount\":%d,\"stackBottomRefreshed\":%s,"
            "\"stackTopRefreshed\":%s,\"backtraceArgsPinned\":%s,"
            "\"gcPermission\":\"%s\",\"pendingCommandState\":\"%s\"}",
            wasmacs_entrypoint_refresh_count,
            wasmacs_last_entry_stack_bottom != wasmacs_last_saved_stack_bottom
            ? "true" : "false",
            wasmacs_last_entry_stack_top != wasmacs_last_saved_stack_top
            ? "true" : "false",
            wasmacs_backtrace_args_pinned ? "true" : "false",
            gc_allowed && stack_roots_fresh ? "allowed" : "blocked-or-unsafe",
            wasmacs_os_pending_command_state ());

  xfree (wasmacs_last_os_root_safety_probe);
  wasmacs_last_os_root_safety_probe = state;
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return wasmacs_last_os_root_safety_probe;
}

__attribute__ ((used, visibility ("default")))
int
wasmacs_os_apply_terminal_resize (int width, int height)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  int status = 0;
  const char *reason = "applied";
  if (width <= 5 || height <= 2)
    {
      status = 1;
      reason = "too-small";
    }
  else if (!initialized || !FRAMEP (selected_frame)
           || !FRAME_TERMCAP_P (SELECTED_FRAME ()))
    {
      status = 2;
      reason = "no-live-tty-frame";
    }
  else
    {
      change_frame_size (SELECTED_FRAME (), width, height,
                         false, true, false);
      do_pending_window_change (false);
    }

  char *state = xmalloc (512);
  snprintf (state, 512,
            "{\"service\":\"Terminal/Tty\",\"owner\":\"C/wasm facade\","
            "\"status\":\"%s\",\"width\":%d,\"height\":%d,"
            "\"pendingCommandState\":\"%s\"}",
            reason, width, height, wasmacs_os_pending_command_state ());
  xfree (wasmacs_last_os_terminal_resize_state);
  wasmacs_last_os_terminal_resize_state = state;
  wasmacs_store_c_string_result (wasmacs_last_os_terminal_resize_state);

  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return status;
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

__attribute__ ((used, visibility ("default")))
const char *
wasmacs_interactive_state (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  specpdl_ref gc_count = inhibit_garbage_collection ();
  ptrdiff_t capacity = 1024;
  ptrdiff_t length = 0;
  char *state = xmalloc (capacity);
  state[0] = '\0';

  char line[256];
  wasmacs_append_text (&state, &length, &capacity, "buffer-name:");
  wasmacs_append_lisp_string (&state, &length, &capacity,
                              BVAR (current_buffer, name));
  wasmacs_append_text (&state, &length, &capacity, "\n");

  wasmacs_append_text (&state, &length, &capacity, "buffer-file-name:");
  wasmacs_append_lisp_string (&state, &length, &capacity,
                              BVAR (current_buffer, filename));
  wasmacs_append_text (&state, &length, &capacity, "\n");

  snprintf (line, sizeof line, "point:%"pD"d\n", PT);
  wasmacs_append_text (&state, &length, &capacity, line);
  snprintf (line, sizeof line, "buffer-size:%"pD"d\n", Z - BEG);
  wasmacs_append_text (&state, &length, &capacity, line);
  snprintf (line, sizeof line, "modified:%s\n",
            BUF_MODIFF (current_buffer) == BUF_SAVE_MODIFF (current_buffer)
            ? "false" : "true");
  wasmacs_append_text (&state, &length, &capacity, line);

  Lisp_Object undo = BVAR (current_buffer, undo_list);
  wasmacs_append_text (&state, &length, &capacity, "undo-list:");
  if (NILP (undo))
    wasmacs_append_text (&state, &length, &capacity, "nil\n");
  else if (EQ (undo, Qt))
    wasmacs_append_text (&state, &length, &capacity, "disabled\n");
  else
    wasmacs_append_text (&state, &length, &capacity, "present\n");

  wasmacs_append_text (&state, &length, &capacity, "selected-window-buffer:");
  if (WINDOWP (selected_window)
      && BUFFERP (XWINDOW (selected_window)->contents))
    wasmacs_append_lisp_string (&state, &length, &capacity,
                                BVAR (XBUFFER (XWINDOW (selected_window)->contents),
                                      name));
  wasmacs_append_text (&state, &length, &capacity, "\n");

  snprintf (line, sizeof line, "minibuffer-depth:%"pI"d\n", minibuf_level);
  wasmacs_append_text (&state, &length, &capacity, line);
  snprintf (line, sizeof line, "command-loop-level:%"pI"d\n",
            command_loop_level);
  wasmacs_append_text (&state, &length, &capacity, line);

  xfree (wasmacs_last_interactive_state);
  wasmacs_last_interactive_state = state;
  unbind_to (gc_count, Qnil);
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return wasmacs_last_interactive_state;
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

static Lisp_Object
wasmacs_recursive_edit_body (Lisp_Object ignored)
{
  return call0 (intern_c_string ("recursive-edit"));
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

__attribute__ ((used, visibility ("default")))
int
wasmacs_command_begin_bare_recursive_edit_probe (void)
{
  if (wasmacs_command_busy)
    {
      wasmacs_store_c_string_result ("unavailable:busy");
      return 3;
    }

  wasmacs_command_busy = 1;
  bool saved_noninteractive = noninteractive;
  Lisp_Object saved_top_level = Vtop_level;
  noninteractive = false;
  Vtop_level = Qnil;
  wasmacs_eval_had_error = 0;
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  specpdl_ref gc_count = inhibit_garbage_collection ();
  wasmacs_pending_gc_inhibit_depth++;

  Lisp_Object result = internal_condition_case_1 (wasmacs_recursive_edit_body,
                                                 Qnil,
                                                 Qt,
                                                 wasmacs_eval_error_handler);
  wasmacs_store_result (result);

  wasmacs_pending_gc_inhibit_depth--;
  unbind_to (gc_count, Qnil);
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  Vtop_level = saved_top_level;
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
            "gc-guard-pushed:emacs-depth=%td:wasmacs-depth=%d",
            (ptrdiff_t) garbage_collection_inhibited,
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
            "gc-guard-popped:emacs-depth=%td:wasmacs-depth=%d",
            (ptrdiff_t) garbage_collection_inhibited,
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

  char code[128];
  snprintf(code, sizeof code, "(call-interactively '%s)", kind ? kind : "ignore");
  Lisp_Object source = build_string (code);
  Lisp_Object result = internal_condition_case_1 (wasmacs_eval_body, source,
                                                 Qerror, wasmacs_eval_error_handler);

  wasmacs_pending_gc_inhibit_depth--;
  unbind_to (gc_count, Qnil);
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  noninteractive = saved_noninteractive;
  wasmacs_command_busy = 0;

  return wasmacs_eval_had_error ? 1 : 0;
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

/* --- C/wasm OS compat kernel: Filesystem / Dired without host.process --- */

__attribute__ ((used, visibility ("default")))
int
wasmacs_os_configure_dired_without_ls (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  wasmacs_eval_had_error = 0;
  Lisp_Object result = internal_condition_case_1 (wasmacs_eval_body,
                                                 build_string ("(progn (require 'ls-lisp) (setq ls-lisp-use-insert-directory-program nil) (setq insert-directory-program nil) 'dired-without-ls-configured)"),
                                                 Qt,
                                                 wasmacs_eval_error_handler);
  wasmacs_store_result (result);

  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return wasmacs_eval_had_error ? 1 : 0;
}

__attribute__ ((used, visibility ("default")))
int
wasmacs_os_dired_without_ls_probe (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  wasmacs_eval_had_error = 0;
  Lisp_Object source = build_string (
    "(progn"
    " (require 'ls-lisp)"
    " (setq ls-lisp-use-insert-directory-program nil)"
    " (setq insert-directory-program nil)"
    " (let* ((dir (cond ((file-directory-p \"/home/user\") \"/home/user\")"
    "                   ((file-directory-p \"/tmp\") \"/tmp\")"
    "                   (t default-directory)))"
    "        (entries (directory-files dir nil nil t))"
    "        (attrs (directory-files-and-attributes dir nil nil t 'integer))"
    "        (dir-attrs (file-attributes dir 'integer))"
    "        (listing (with-temp-buffer"
    "                   (insert-directory dir \"-al\" nil t)"
    "                   (buffer-string))))"
    "   (list :backend 'ls-lisp"
    "         :host-process nil"
    "         :dir dir"
    "         :directory-files (consp entries)"
    "         :directory-files-and-attributes (consp attrs)"
    "         :file-attributes (consp dir-attrs)"
    "         :file-directory-p (file-directory-p dir)"
    "         :file-readable-p (file-readable-p dir)"
    "         :file-symlink-p (file-symlink-p dir)"
    "         :listing-bytes (length listing)"
    "         :listing-has-total (string-match-p \"\\\\`total\" listing))))");
  Lisp_Object result = internal_condition_case_1 (wasmacs_eval_body, source,
                                                 Qt,
                                                 wasmacs_eval_error_handler);
  wasmacs_store_result (result);

  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return wasmacs_eval_had_error ? 1 : 0;
}

__attribute__ ((used, visibility ("default")))
const char *
wasmacs_os_filesystem_dired_state (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  char *state = xmalloc (1024);
  snprintf (state, 1024,
            "{\"service\":\"Filesystem and Persistence\",\"owner\":\"C/wasm facade\","
            "\"status\":\"product-scaffold\",\"diredBackend\":\"ls-lisp\","
            "\"usesHostProcess\":false,\"requiredPrimitives\":["
            "\"directory-files\",\"directory-files-and-attributes\","
            "\"file-attributes\",\"file-directory-p\",\"file-readable-p\","
            "\"file-symlink-p\"],\"probe\":\"wasmacs_os_dired_without_ls_probe\"}");

  xfree (wasmacs_last_os_filesystem_dired_state);
  wasmacs_last_os_filesystem_dired_state = state;
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return wasmacs_last_os_filesystem_dired_state;
}

__attribute__ ((used, visibility ("default")))
const char *
wasmacs_os_url_fetch_loader_state (void)
{
  WASMACS_ENTER_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);

  char *state = xmalloc (1024);
  snprintf (state, 1024,
            "{\"service\":\"Network Fetch\",\"owner\":\"C/wasm facade\","
            "\"status\":\"product-scaffold\",\"hostProcess\":false,"
            "\"loader\":\"wasmacs-url-fetch\","
            "\"primitive\":\"wasmacs-os-network-fetch-json\","
            "\"scope\":[\"http\",\"https\",\"package.el\",\"url.el\"]}");

  xfree (wasmacs_last_os_network_fetch_state);
  wasmacs_last_os_network_fetch_state = state;
  WASMACS_LEAVE_HOST_ENTRYPOINT (saved_stack_bottom, saved_stack_top);
  return wasmacs_last_os_network_fetch_state;
}

EOF
export WASMACS_ENTRYPOINT_BLOCK="${entrypoint_block}"

if rg 'wasmacs_eval_string' "${source_file}" >/dev/null; then
  perl -0pi -e 's/static char \*wasmacs_last_eval_result;.*?\n+DEFUN \("invocation-name"/DEFUN ("invocation-name"/s' "$source_file"
fi

perl -0pi -e 'BEGIN { $block = $ENV{"WASMACS_ENTRYPOINT_BLOCK"} } s/DEFUN \("invocation-name", Finvocation_name, Sinvocation_name, 0, 0, 0,\n/${block}\nDEFUN ("invocation-name", Finvocation_name, Sinvocation_name, 0, 0, 0,\n/' "$source_file"
perl -0pi -e 's/\n  defsubr \(&Swasmacs_os_network_fetch_json\);//g' "$source_file"
perl -0pi -e 's/  defsubr \(&Sinvocation_name\);/  defsubr (\&Swasmacs_os_network_fetch_json);\n  defsubr (\&Sinvocation_name);/' "$source_file"

if [ -f "${loadup_file}" ] && ! rg 'wasmacs os-compat: Dired without external ls' "${loadup_file}" >/dev/null; then
  perl -0pi -e 's#(\(load "bindings"\)\n)#$1\n;; wasmacs os-compat: Dired without external ls.\n;; Browser MVP keeps host.process unavailable, so directory listing must use\n;; Emacs filesystem primitives through ls-lisp instead of an ls subprocess.\n(load "ls-lisp" nil t)\n(setq ls-lisp-use-insert-directory-program nil)\n(setq insert-directory-program nil)\n#' "${loadup_file}"
fi

if rg 'wasmacs_host_wait_for_input' "${keyboard_file}" >/dev/null; then
  perl -0pi -e 's~/\* wasmacs browser input injection spike\. \*/.*?\nvoid\nkbd_buffer_store_event~void\nkbd_buffer_store_event~sg' "${keyboard_file}"
  perl -0pi -e 's/\n\/\* wasmacs asyncify input waitpoint spike\. \*\/\nextern int wasmacs_host_wait_for_input \(void\);\n//s' "${keyboard_file}"
  perl -0pi -e 's~\n/\* wasmacs os-compat terminal input injection spike\. \*/\nextern int wasmacs_host_wait_for_input \(void\);\n(?:extern int wasmacs_host_terminal_input_available \(void\);\n)?(?:extern int wasmacs_host_terminal_read_byte \(void\);)?(?:extern void wasmacs_os_timing_checkpoint \(int code\);)?\n*~~g' "${keyboard_file}"
  perl -0pi -e 's~\nextern int wasmacs_host_terminal_input_available \(void\);\n~~g' "${keyboard_file}"
  perl -0pi -e 's~\nextern int wasmacs_host_terminal_read_byte \(void\);(?:extern void wasmacs_os_timing_checkpoint \(int code\);)?\n~\n~g' "${keyboard_file}"
  perl -0pi -e 's/\nextern int wasmacs_host_scheduler_checkpoint \(int code\);\n//s' "${keyboard_file}"
  perl -0pi -e 's/\nextern void wasmacs_os_timing_checkpoint \(int code\);\n//g' "${keyboard_file}"
  perl -0pi -e 's/\n\s+\/\* wasmacs asyncify input waitpoint spike: yield only while an\n\s+active minibuffer read is waiting for real input\.  The JS import is\n\s+currently a no-op probe hook; later input-event work must make this\n\s+the suspension point that browser input resumes\.  \*\/\n\s+if \(minibuf_level > 0 && !end_time && !input_pending\n\s+&& !detect_input_pending_run_timers \(0\)\)\n\s+wasmacs_host_wait_for_input \(\);\n//s' "${keyboard_file}"
  perl -0pi -e 's~\n#ifdef __EMSCRIPTEN__\n  wasmacs_host_scheduler_checkpoint \(200\);\n#endif[ \t]*~\n~' "${keyboard_file}"
  if [ "${terminal_tty_enabled}" != "1" ] || [ "${waitpoint_mode}" != "os-compat" ]; then
    perl -0pi -e 's~\n#ifdef __EMSCRIPTEN__\n\s+if \(kbd_fetch_ptr == kbd_store_ptr\)\n\s+\{\n\s+wasmacs_host_wait_for_input \(\);\n\s+wasmacs_os_timing_checkpoint \(10\);\n\s+struct terminal \*t;\n\s+struct input_event ie;\n\s+for \(t = terminal_list; t; t = t->next_terminal\)\n\s+if \(t->read_socket_hook\)\n\s+while \(\(\*t->read_socket_hook\) \(t, &ie\) > 0\)\n\s+;\n\s+wasmacs_os_timing_checkpoint \(20\);\n\s+\}\n\s+wasmacs_os_timing_checkpoint \(30\);\n#else\n\s+wait_reading_process_output \(0, 0, -1, do_display, Qnil, NULL, 0\);\n#endif~\n\t  wait_reading_process_output (0, 0, -1, do_display, Qnil, NULL, 0);~sg' "${keyboard_file}"
    perl -0pi -e 's~\n#ifdef __EMSCRIPTEN__\n\s+if \(kbd_fetch_ptr == kbd_store_ptr\)\n\s+\{\n\s+wasmacs_host_wait_for_input \(\);\n\s+wasmacs_os_timing_checkpoint \(10\);\n\s+gobble_input \(\);\n\s+wasmacs_os_timing_checkpoint \(kbd_fetch_ptr != kbd_store_ptr \? 21 : 22\);\n\s+\}\n\s+wasmacs_os_timing_checkpoint \(kbd_fetch_ptr != kbd_store_ptr \? 31 : 32\);\n#else\n\s+wait_reading_process_output \(0, 0, -1, do_display, Qnil, NULL, 0\);\n#endif~\n\t  wait_reading_process_output (0, 0, -1, do_display, Qnil, NULL, 0);~sg' "${keyboard_file}"
    perl -0pi -e 's~\n#ifdef __EMSCRIPTEN__\n\s+if \(kbd_fetch_ptr == kbd_store_ptr\)\n\s+\{\n\s+wasmacs_host_wait_for_input \(\);\n\s+wasmacs_os_timing_checkpoint \(11\);\n\s+gobble_input \(\);\n\s+wasmacs_os_timing_checkpoint \(kbd_fetch_ptr != kbd_store_ptr \? 23 : 24\);\n\s+\}\n#else\n\s+wait_reading_process_output \(min \(duration\.tv_sec,\n\s+WAIT_READING_MAX\),\n\s+duration\.tv_nsec,\n\s+-1, 1, Qnil, NULL, 0\);\n#endif~\n\t      wait_reading_process_output (min (duration.tv_sec,\n\t\t\t\t\t\tWAIT_READING_MAX),\n\t\t\t\t\t   duration.tv_nsec,\n\t\t\t\t\t   -1, 1, Qnil, NULL, 0);~sg' "${keyboard_file}"
  fi
  if [ "${WASMACS_ENABLE_ASYNCIFY_WAITPOINT:-0}" != "1" ]; then
    perl -ni -e 'print unless /wasmacs_host_wait_for_input|wasmacs_host_terminal_input_available|wasmacs_host_terminal_read_byte|wasmacs_os_timing_checkpoint/' "${keyboard_file}"
  fi
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
  perl -0pi -e 's~/\* wasmacs browser input injection spike\. \*/.*?\nvoid\nkbd_buffer_store_event~void\nkbd_buffer_store_event~sg' "${keyboard_file}"
fi

perl -0pi -e 'BEGIN { $block = $ENV{"WASMACS_INPUT_BLOCK"} } s#void\nkbd_buffer_store_event \(register struct input_event \*event\)\n\{#\n\n${block}\nvoid\nkbd_buffer_store_event (register struct input_event *event)\n{#' "${keyboard_file}"

if [ "${WASMACS_ENABLE_ASYNCIFY_WAITPOINT:-0}" = "1" ]; then
  case "${waitpoint_mode}" in
    read-char)
      perl -0pi -e 's~\n      /\* wasmacs asyncify input waitpoint spike:.*?\n\n      c = read_decoded_event_from_main_queue~\n      c = read_decoded_event_from_main_queue~sg' "${keyboard_file}"
      read -r -d '' WASMACS_READ_CHAR_HEADER <<'EOF' || true
/* wasmacs asyncify input waitpoint spike. */
extern int wasmacs_host_wait_for_input (void);
extern int wasmacs_host_scheduler_checkpoint (int code);
extern void wasmacs_os_timing_checkpoint (int code);

/* Read a character from the keyboard; call the redisplay if needed.  */
EOF
      WASMACS_READ_CHAR_HEADER="${WASMACS_READ_CHAR_HEADER}" \
        perl -0pi -e 'BEGIN { $p = $ENV{"WASMACS_READ_CHAR_HEADER"} } s~/\* Read a character from the keyboard; call the redisplay if needed\.  \*/~$p~' "${keyboard_file}"
      perl -0pi -e 's~read_char \(int commandflag, Lisp_Object map,\n\t   Lisp_Object prev_event,\n\t   bool \*used_mouse_menu, struct timespec \*end_time\)\n\{~read_char (int commandflag, Lisp_Object map,\n\t   Lisp_Object prev_event,\n\t   bool *used_mouse_menu, struct timespec *end_time)\n{\n#ifdef __EMSCRIPTEN__\n  wasmacs_host_scheduler_checkpoint (200);\n#endif\n~' "${keyboard_file}"

      perl -0pi -e 's~  if \(NILP \(c\)\)\n    \{\n      c = read_decoded_event_from_main_queue \(end_time, local_getcjmp,\n                                              prev_event, used_mouse_menu\);~  if (NILP (c))\n    {\n      /* wasmacs asyncify input waitpoint spike: yield when an interactive\n         command loop would otherwise block for real browser input.  In the\n         browser host, stdin readiness can look like input_pending without a\n         real Emacs key event, so JS owns the actual wait/resume boundary. */\n      if (!noninteractive && !end_time)\n        {\n          wasmacs_host_scheduler_checkpoint (201);\n          wasmacs_host_wait_for_input ();\n          wasmacs_host_scheduler_checkpoint (202);\n        }\n\n      c = read_decoded_event_from_main_queue (end_time, local_getcjmp,\n                                              prev_event, used_mouse_menu);~' "${keyboard_file}"

      # Patch kbd_buffer_get_event: replace wait_reading_process_output with our
      # OS-level blocking wait. Eliminates select()/setitimer loop overhead.
      # Clean up any existing patches (handles multiple applications from previous builds):
      # Collapse repeated #ifdef __EMSCRIPTEN__ / #else / #endif nesting back to plain call
      perl -0pi -e '
        while (s/#ifdef __EMSCRIPTEN__\n\t  if \(kbd_fetch_ptr == kbd_store_ptr\)\n\t    wasmacs_host_wait_for_input \(\);\n#else\n((?:#ifdef __EMSCRIPTEN__.*?#endif\n)*)\t  wait_reading_process_output \(0, 0, -1, do_display, Qnil, NULL, 0\);\n#endif/$1\t  wait_reading_process_output (0, 0, -1, do_display, Qnil, NULL, 0);\n/sg) {}
      ' "${keyboard_file}"
      # Now apply once:
      export WASMACS_KBD_WAIT_PATCH='#ifdef __EMSCRIPTEN__
	  if (kbd_fetch_ptr == kbd_store_ptr)
	    wasmacs_host_wait_for_input ();
#else
	  wait_reading_process_output (0, 0, -1, do_display, Qnil, NULL, 0);
#endif'
      perl -0pi -e 'BEGIN { $p = $ENV{"WASMACS_KBD_WAIT_PATCH"} } s#\t  wait_reading_process_output \(0, 0, -1, do_display, Qnil, NULL, 0\);#${p}#' "${keyboard_file}"
      ;;
    os-compat)
      # os-compat mode: replace wait_reading_process_output with
      # wasmacs_host_wait_for_input + terminal drain via read_socket_hook.
	      # This makes bytes flow through the proper OS compat chain:
	      #   Atomics.wait → __wasmacsTerminalInputBytes
	      #   → tty_read_avail_input → emacs_read → emfile_read → read()
	      #   → TTY get_char → kbd_buffer_store_event
	      perl -0pi -e 's~/\* wasmacs os-compat terminal input injection spike\. \*/.*?/\* Read a character from the keyboard; call the redisplay if needed\.  \*/~/* Read a character from the keyboard; call the redisplay if needed.  */~sg' "${keyboard_file}"
	      export WASMACS_KBD_OSCOMPAT_HEADER='/* wasmacs os-compat terminal input injection spike. */
extern int wasmacs_host_wait_for_input (void);
extern int wasmacs_host_terminal_input_available (void);
extern int wasmacs_host_terminal_read_byte (void);
extern int wasmacs_host_scheduler_checkpoint (int code);
extern int wasmacs_host_terminal_resize_pending (void);
extern int wasmacs_host_terminal_resize_cols (void);
extern int wasmacs_host_terminal_resize_rows (void);
extern int wasmacs_host_terminal_resize_ack (void);
extern int wasmacs_os_apply_terminal_resize (int width, int height);
extern void wasmacs_os_timing_checkpoint (int code);

static void
wasmacs_os_maybe_apply_terminal_resize (void)
{
  if (wasmacs_host_terminal_resize_pending ())
    {
      wasmacs_os_apply_terminal_resize (wasmacs_host_terminal_resize_cols (),
                                        wasmacs_host_terminal_resize_rows ());
      wasmacs_host_terminal_resize_ack ();
    }
}

/* Read a character from the keyboard; call the redisplay if needed.  */'
	      perl -0pi -e 'BEGIN { $p = $ENV{"WASMACS_KBD_OSCOMPAT_HEADER"} } s~/\* Read a character from the keyboard.*?\*/~$p~s' "${keyboard_file}"

      # Clean up any previous kbd_buffer_get_event patches
      perl -0pi -e '
        while (s/#ifdef __EMSCRIPTEN__\n\t  if \(kbd_fetch_ptr == kbd_store_ptr\).*?\n#else\n((?:#ifdef __EMSCRIPTEN__.*?#endif\n)*)\t  wait_reading_process_output \(0, 0, -1, do_display, Qnil, NULL, 0\);\n#endif/$1\t  wait_reading_process_output (0, 0, -1, do_display, Qnil, NULL, 0);\n/sg) {}
      ' "${keyboard_file}"

	      export WASMACS_KBD_TIMED_WAIT_OSCOMPAT_PATCH='#ifdef __EMSCRIPTEN__
	      if (kbd_fetch_ptr == kbd_store_ptr)
		{
		  wasmacs_host_wait_for_input ();
		  wasmacs_os_maybe_apply_terminal_resize ();
		  wasmacs_os_timing_checkpoint (11);
		  gobble_input ();
		  wasmacs_os_timing_checkpoint (kbd_fetch_ptr != kbd_store_ptr ? 23 : 24);
		}
#else
	      wait_reading_process_output (min (duration.tv_sec,
						WAIT_READING_MAX),
					   duration.tv_nsec,
					   -1, 1, Qnil, NULL, 0);
#endif'
	      perl -0pi -e 'BEGIN { $p = $ENV{"WASMACS_KBD_TIMED_WAIT_OSCOMPAT_PATCH"} } s#\s+wait_reading_process_output \(min \(duration\.tv_sec,\n\s+WAIT_READING_MAX\),\n\s+duration\.tv_nsec,\n\s+-1, 1, Qnil, NULL, 0\);#\n$p#' "${keyboard_file}"

	      export WASMACS_KBD_WAIT_OSCOMPAT_PATCH='#ifdef __EMSCRIPTEN__
	  if (kbd_fetch_ptr == kbd_store_ptr)
	    {
	      wasmacs_host_wait_for_input ();
	      wasmacs_os_maybe_apply_terminal_resize ();
	      wasmacs_os_timing_checkpoint (10);
	      gobble_input ();
	      wasmacs_os_timing_checkpoint (kbd_fetch_ptr != kbd_store_ptr ? 21 : 22);
	    }
	  wasmacs_os_timing_checkpoint (kbd_fetch_ptr != kbd_store_ptr ? 31 : 32);
#else
	  wait_reading_process_output (0, 0, -1, do_display, Qnil, NULL, 0);
#endif'
	      perl -0pi -e 'BEGIN { $p = $ENV{"WASMACS_KBD_WAIT_OSCOMPAT_PATCH"} } s#\t  wait_reading_process_output \(0, 0, -1, do_display, Qnil, NULL, 0\);#${p}#' "${keyboard_file}"
	      perl -0pi -e 's~\n\s+wasmacs_os_timing_checkpoint \(40\);\n\s+/\* See https://lists\.gnu\.org/r/emacs-devel/2005-05/msg00297\.html~\n      /* See https://lists.gnu.org/r/emacs-devel/2005-05/msg00297.html~' "${keyboard_file}"
	      perl -0pi -e 's~\n\s+wasmacs_os_timing_checkpoint \(51\);~~g' "${keyboard_file}"
	      if ! rg 'wasmacs_os_timing_checkpoint \(41\)' "${keyboard_file}" >/dev/null; then
	        perl -0pi -e 's~(\n\s+obj = make_lispy_event \(&event->ie\);\n)~$1		      wasmacs_os_timing_checkpoint (41);\n~' "${keyboard_file}"
	      fi
	      if ! rg 'wasmacs_os_timing_checkpoint \(42\)' "${keyboard_file}" >/dev/null; then
	        perl -0pi -e 's~(      switch \(event->kind\)\n      \{.*?\n\s*default:\n\s*\{\n)~$1#ifdef __EMSCRIPTEN__\n		  wasmacs_os_timing_checkpoint (42);\n#endif\n~s' "${keyboard_file}"
	      fi
	      perl -0pi -e 's~\n\s+wasmacs_os_timing_checkpoint \(43\);~~g' "${keyboard_file}"
	      if ! rg 'wasmacs os-compat: do not synthesize switch-frame for tty keystrokes' "${keyboard_file}" >/dev/null; then
	        perl -0pi -e 's~(\n\s+if \(!EQ \(frame, internal_last_event_frame\)\n\s+&& !EQ \(frame, selected_frame\)\)\n\s+obj = make_lispy_switch_frame \(frame\);)~\n		  /* wasmacs os-compat: do not synthesize switch-frame for tty keystrokes.\n		     The pdmp-restored terminal frame can compare unequal here even though\n		     the key belongs to the active terminal; returning switch-frame first\n		     leaves the real key queued and the browser page never redisplays it. */\n#ifdef __EMSCRIPTEN__\n		  if (!(event->ie.kind == ASCII_KEYSTROKE_EVENT\n		        || event->ie.kind == MULTIBYTE_CHAR_KEYSTROKE_EVENT\n		        || event->ie.kind == NON_ASCII_KEYSTROKE_EVENT)\n		      && !EQ (frame, internal_last_event_frame)\n		      && !EQ (frame, selected_frame))\n		    obj = make_lispy_switch_frame (frame);\n#else$1\n#endif~' "${keyboard_file}"
	      fi
	      if ! rg 'wasmacs os-compat: selected_frame for lispy tty keystrokes' "${keyboard_file}" >/dev/null; then
	        export WASMACS_LISPY_FRAME_OSCOMPAT_PATCH='#ifdef __EMSCRIPTEN__
		  /* wasmacs os-compat: selected_frame for lispy tty keystrokes.
		     For terminal keystrokes the pdmp-restored frame_or_window can
		     refer to a stale frame object.  Use the active selected frame
		     before the normal focus lookup touches XFRAME (frame). */
		  wasmacs_os_timing_checkpoint (420);
		  if (event->kind == ASCII_KEYSTROKE_EVENT
		      || event->kind == MULTIBYTE_CHAR_KEYSTROKE_EVENT
		      || event->kind == NON_ASCII_KEYSTROKE_EVENT)
		    {
		      frame = selected_frame;
		      wasmacs_os_timing_checkpoint (421);
		    }
		  else
		    {
#endif
		  frame = event->ie.frame_or_window;
		  if (CONSP (frame))
		    frame = XCAR (frame);
		  else if (WINDOWP (frame))
		    frame = WINDOW_FRAME (XWINDOW (frame));

		  focus = FRAME_FOCUS_FRAME (XFRAME (frame));
		  if (! NILP (focus))
		    frame = focus;
#ifdef __EMSCRIPTEN__
		    }
#endif'
	        perl -0pi -e 'BEGIN { $p = $ENV{"WASMACS_LISPY_FRAME_OSCOMPAT_PATCH"} } s~\s*frame = event->ie\.frame_or_window;\n\s*if \(CONSP \(frame\)\)\n\s*frame = XCAR \(frame\);\n\s*else if \(WINDOWP \(frame\)\)\n\s*frame = WINDOW_FRAME \(XWINDOW \(frame\)\);\n\n\s*focus = FRAME_FOCUS_FRAME \(XFRAME \(frame\)\);\n\s*if \(! NILP \(focus\)\)\n\s*frame = focus;~\n$p~' "${keyboard_file}"
	      fi
	      if ! rg 'wasmacs_os_timing_checkpoint \(420\)' "${keyboard_file}" >/dev/null; then
	        perl -0pi -e 's~(		  /\* wasmacs os-compat: selected_frame for lispy tty keystrokes\.\n		     For terminal keystrokes the pdmp-restored frame_or_window can\n		     refer to a stale frame object\.  Use the active selected frame\n		     before the normal focus lookup touches XFRAME \(frame\)\. \*/\n)~$1		  wasmacs_os_timing_checkpoint (420);\n~' "${keyboard_file}"
	      fi
	      if ! rg 'wasmacs_os_timing_checkpoint \(421\)' "${keyboard_file}" >/dev/null; then
	        perl -0pi -e 's~(\n\s*)frame = selected_frame;~${1}{\n		      frame = selected_frame;\n		      wasmacs_os_timing_checkpoint (421);\n${1}}~' "${keyboard_file}"
	      fi
	      perl -0pi -e 's~\}#ifdef __EMSCRIPTEN__\n\s*wasmacs_os_timing_checkpoint \(44\);\n#endif~}~g' "${keyboard_file}"
	      if ! rg 'wasmacs_os_timing_checkpoint \(45\)' "${keyboard_file}" >/dev/null; then
	        perl -0pi -e 's~(\s*internal_last_event_frame = frame;\n)~$1#ifdef __EMSCRIPTEN__\n		  wasmacs_os_timing_checkpoint (45);\n#endif\n~' "${keyboard_file}"
	      fi
	      if ! rg 'wasmacs_os_timing_checkpoint \(46\)' "${keyboard_file}" >/dev/null; then
	        perl -0pi -e 's~(\s*/\* If we didn.t decide to make a switch-frame event, go ahead\n\s*and build a real event from the queue entry\.  \*/\n)~$1#ifdef __EMSCRIPTEN__\n		  wasmacs_os_timing_checkpoint (46);\n#endif\n~' "${keyboard_file}"
	      fi
	      if ! rg 'wasmacs_os_timing_checkpoint \(47\)' "${keyboard_file}" >/dev/null; then
	        perl -0pi -e 's~(\n		      obj = make_lispy_event \(&event->ie\);\n)~\n#ifdef __EMSCRIPTEN__\n		      wasmacs_os_timing_checkpoint (47);\n#endif\n$1#ifdef __EMSCRIPTEN__\n		      wasmacs_os_timing_checkpoint (48);\n#endif\n~' "${keyboard_file}"
	      fi
	      if ! rg 'wasmacs_os_timing_checkpoint \(51\)' "${keyboard_file}" >/dev/null; then
	        perl -0pi -e 's~(	  /\* Handle things that only apply to characters\.  \*/\n	  if \(FIXNUMP \(c\)\)\n	    \{\n)~${1}	      wasmacs_os_timing_checkpoint (51);\n~' "${keyboard_file}"
	      fi
	      if ! rg 'wasmacs_os_timing_checkpoint \(33\)' "${keyboard_file}" >/dev/null; then
	        perl -0pi -e 's~(\n#ifdef HAVE_X_WINDOWS\n  /\* Handle pending selection requests)~\n#ifdef __EMSCRIPTEN__\n  wasmacs_os_timing_checkpoint (33);\n#endif\n$1~' "${keyboard_file}"
	      fi
	      if ! rg 'wasmacs_os_timing_checkpoint \(40\)' "${keyboard_file}" >/dev/null; then
	        perl -0pi -e 's~(  /\* At this point, we know that there is a readable event available\n     somewhere\.  If the event queue is empty, then there must be a\n     mouse movement enabled and available\.  \*/\n  if \(kbd_fetch_ptr != kbd_store_ptr\)\n    \{\n)~${1}      wasmacs_os_timing_checkpoint (40);\n~' "${keyboard_file}"
	      fi
	      perl -0pi -e 's~\n\s+wasmacs_os_timing_checkpoint \(1000 \+ event->kind\);~~g' "${keyboard_file}"
	      if ! rg 'wasmacs_os_timing_checkpoint \(1000 \+ event->kind\)' "${keyboard_file}" >/dev/null; then
	        perl -0pi -e 's~(      wasmacs_os_timing_checkpoint \(40\);\n      union buffered_input_event \*event = kbd_fetch_ptr;\n)~${1}      wasmacs_os_timing_checkpoint (1000 + event->kind);\n~' "${keyboard_file}"
	      fi
	      if ! rg 'wasmacs os-compat: current_kboard for terminal keystrokes' "${keyboard_file}" >/dev/null; then
	        perl -0pi -e 's~      \*kbp = event_to_kboard \(&event->ie\);\n#ifdef __EMSCRIPTEN__\n      wasmacs_os_timing_checkpoint \(1100 \+ event->kind\);\n#endif~      *kbp = event_to_kboard (&event->ie);~g' "${keyboard_file}"
	        perl -0pi -e 's~      \*kbp = event_to_kboard \(&event->ie\);~      /* wasmacs os-compat: current_kboard for terminal keystrokes.\n         Avoid event_to_kboard reading a pdmp-restored stale frame_or_window\n         before the real keystroke is converted into a Lisp event. */\n#ifdef __EMSCRIPTEN__\n      if (event->kind == ASCII_KEYSTROKE_EVENT\n          || event->kind == MULTIBYTE_CHAR_KEYSTROKE_EVENT\n          || event->kind == NON_ASCII_KEYSTROKE_EVENT)\n        *kbp = current_kboard;\n      else\n        *kbp = event_to_kboard (&event->ie);\n      wasmacs_os_timing_checkpoint (1100 + event->kind);\n#else\n      *kbp = event_to_kboard (&event->ie);\n#endif~' "${keyboard_file}"
	      fi
	      if ! rg 'wasmacs_os_timing_checkpoint \(1110 \+ event->kind\)' "${keyboard_file}" >/dev/null; then
	        perl -0pi -e 's~(      if \(\*kbp == 0\)\n\t\*kbp = current_kboard;  /\* Better than returning null ptr\\?  \*/\n)~$1#ifdef __EMSCRIPTEN__\n      wasmacs_os_timing_checkpoint (1110 + event->kind);\n#endif\n~' "${keyboard_file}"
	      fi
	      if ! rg 'wasmacs_os_timing_checkpoint \(1120 \+ event->kind\)' "${keyboard_file}" >/dev/null; then
	        perl -0pi -e 's~(      obj = Qnil;\n)~$1#ifdef __EMSCRIPTEN__\n      wasmacs_os_timing_checkpoint (1120 + event->kind);\n#endif\n~' "${keyboard_file}"
	      fi
	      if ! rg 'wasmacs os-compat: selected_frame for terminal ASCII input' "${keyboard_file}" >/dev/null; then
	        perl -0pi -e 's~(      /\* Set the frame corresponding to the active tty\.  Note that the\n         value of selected_frame is not reliable here, redisplay tends\n         to temporarily change it\.  \*/\n      buf\.frame_or_window = tty->top_frame;)~      /* wasmacs os-compat: selected_frame for terminal ASCII input.\n         pdmp-restored termcap frames can otherwise synthesize a switch-frame\n         event before the actual key and fail to return to redisplay. */\n#ifdef __EMSCRIPTEN__\n      buf.frame_or_window = selected_frame;\n#else\n$1\n#endif~' "${keyboard_file}"
	      fi
	      ;;
    minibuf-setup)
      perl -0pi -e 's~static Lisp_Object\nread_minibuf #/\* wasmacs asyncify minibuffer setup waitpoint spike. \*/\nextern int wasmacs_host_wait_for_input (void);\n\nstatic Lisp_Object\nread_minibuf #' "${minibuf_file}"

      perl -0pi -e 's~\n  recursive_edit_1 \(\);#\n  /* wasmacs asyncify minibuffer setup waitpoint spike: yield after\n     the minibuffer buffer, prompt, window, keymap, and setup hook are active,\n     but before recursive_edit_1 starts consuming input.  This compares a\n     shallower suspend boundary against the read_char waitpoint.  */\n  wasmacs_host_wait_for_input ();\n\n  recursive_edit_1 ();#' "${minibuf_file}"
      ;;
    *)
      echo "error: unsupported WASMACS_ASYNCIFY_WAITPOINT_MODE=${waitpoint_mode}" >&2
      exit 2
      ;;
  esac
fi
