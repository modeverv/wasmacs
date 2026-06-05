# Emacs Source Mechanics For Wasm

This note summarizes the Emacs 30.2 implementation surfaces that matter for
wasmacs. It is grounded in the requested source files under `vendor/emacs`.

## GC, Roots, And Lisp Object Lifetime

`vendor/emacs/src/alloc.c` is the central lifetime owner. Allocation paths call
`maybe_garbage_collect`, which recomputes the consing threshold and may enter
`garbage_collect`. The collector is conservative around the C stack and precise
around known Emacs roots.

Important root classes:

- Static/global roots visited by `visit_static_gc_roots`.
- Pinned objects and pinned symbols.
- Reader state via `mark_lread`.
- Terminal, keyboard, charset, composite, profiler, GUI-specific roots.
- Thread roots via `mark_threads`.
- Live buffers and their undo lists.

The ordering is important. `garbage_collect` first compacts each live buffer,
marks the major root sets, then handles undo lists specially. `mark_buffer`
does not normally mark a live buffer's `undo_list` immediately; after ordinary
reachability has been established, GC compacts each live buffer's undo list and
then marks it. This means real undo state is GC-sensitive and depends on live
buffer reachability, not just a random Lisp object reference left somewhere.

`mark_object` and `mark_objects` push onto an explicit mark stack and run
`process_mark_stack`, so recursive Lisp object graphs do not usually consume
deep C stack. The collector still depends on correct C stack bounds because
local `Lisp_Object` values, handler records, and other temporary roots may only
be visible through stack scanning.

`inhibit_garbage_collection` in `alloc.c` is a real safety tool, not just a
performance knob. It records an unwind-protect entry and increments
`garbage_collection_inhibited`; the matching unwind restores collection. For a
suspended wasm command whose C stack is parked by Asyncify, this is currently
the narrowest safe guard around paths where Emacs does not yet own a normal
command-loop lifetime.

## Threads, Stack Marking, And Roots

`vendor/emacs/src/thread.c` marks each thread in `mark_one_thread`:

- `mark_specpdl(thread->m_specpdl, thread->m_specpdl_ptr)`
- `mark_c_stack(thread->m_stack_bottom, stack_top)`
- handler chain tag/value objects
- current buffer
- bytecode interpreter state

`mark_threads` calls `flush_stack_call_func` before walking all threads. That
shape matters because native Emacs tries to make stack state visible and stable
before conservative marking. Each thread initializes `m_stack_bottom` and
`stack_top` from an aligned local stack object near thread startup.

For wasm, the practical issue is that an exported host entrypoint is not
necessarily entered from the same native-shaped stack regime as the original
top-level Emacs loop. If host code calls back into Emacs repeatedly, the current
thread's stack top/bottom assumptions must be refreshed or GC must be inhibited
around the callback until a real owner stack exists.

The lower-level implementation in `alloc.c` makes this sharper. `mark_c_stack`
simply calls `mark_memory(bottom, end)` and assumes the stack is one contiguous
address range. `SET_STACK_TOP_ADDRESS` is deliberately a macro so that the
stack-top sentry object lives in the caller's environment. When
`__builtin_unwind_init` is unavailable, Emacs falls back to `sys_setjmp` to
spill registers into a `jmp_buf` on the stack, but the source comments warn
that this must be verified per platform. This is directly relevant to
Emscripten: wasm linear-memory stack is contiguous, but JS-exported calls are
not the same dynamic extent as native `main`, so the stack range must be chosen
from the current exported entrypoint, not from stale startup frames.

`flush_stack_call_func1` is the native pattern to copy: it computes a fresh
stack top, stores it in `current_thread->stack_top`, then calls the callback.
It also says the callback must not run Lisp or allocate GC memory. That means
we should not literally wrap arbitrary host eval in this callback. Instead,
host entrypoints need a wasmacs-specific equivalent of "refresh root-scan stack
range before entering Lisp", while keeping Lisp execution outside
`flush_stack_call_func1`'s no-allocation callback contract.

`record_in_backtrace` in `lisp.h` also writes
`current_thread->stack_top = specpdl_ptr->bt.args`. This is another hint that
Emacs treats stack-top maintenance as part of normal Lisp entry/backtrace
bookkeeping, not as a one-time process-global constant.

The current Asyncify GC blocker is now pinned to this same mechanism.
`record_in_backtrace` stores a raw `Lisp_Object *args` pointer in
`SPECPDL_BACKTRACE`; `mark_specpdl` later calls `mark_objects` on that pointer
and count. A diagnostic scrub that sets non-empty backtrace `args` slots to
`NULL` / `0` lets post-completion GC pass after both text completion and
cancel. That scrub is only evidence, not a product design: a real fix must keep
the backtrace argument roots valid across Asyncify resume or discard/rebase
stale bootstrap backtrace records at an Emacs-owned boundary.

The first better spike copies those baseline backtrace `args` vectors to
`xmalloc` storage at the exported Asyncify command boundary. That makes
ordinary text completion and cancel survive post-completion GC without erasing
backtrace arguments. The remaining design gap is ownership: copied arrays need
a principled freeing or retirement policy before this becomes product code.

## Eval, Conditions, Unwind, And specpdl

`vendor/emacs/src/eval.c` implements Lisp nonlocal control with handler records,
`sys_setjmp`, and `sys_longjmp`. `internal_catch` pushes a handler, calls a C
function, and resumes through the saved jump buffer when `throw` or `signal`
unwinds to it.

`unwind_to_catch` is the key path: it repeatedly calls `unbind_to` to unwind
`specpdl`, restores handler state, restores eval depth/activation state, then
`sys_longjmp`s. This means Lisp conditions are not just return values. They
depend on C jump buffers, valid stack frames, and correct `specpdl` unwinding.

`specpdl` stores dynamic bindings, unwind-protect entries, save-excursion
state, module/runtime cleanup, and buffer-local restoration. It is also a GC
root surface: entries may contain Lisp objects or pointer payloads with custom
mark functions. Any wasm host entrypoint that crosses eval must either:

- run inside Emacs' normal dynamic extent and let `unbind_to` complete, or
- catch errors at the boundary and leave `specpdl` balanced, or
- expose the operation as pending and reject reentrant eval until the stack is
  resumed and unwound.

`mark_specpdl` makes the GC implication explicit. It marks unwind arguments,
unwind arrays, save-excursion markers/windows, backtrace functions and args,
let-bound symbols/old values, local binding locations, and `SPECPDL_UNWIND_PTR`
payloads only when a custom mark function exists. It aborts on unexpected
entries. Therefore a suspended command is safe only if every live dynamic
binding/unwind entry either contains ordinary marked Lisp objects, has a custom
marker, or remains visible through a valid C/wasm stack scan. A host-created
pointer payload with no mark function is not safe to use as a hidden owner of
Lisp objects.

## Command Loop And Input Wait

`vendor/emacs/src/keyboard.c` owns the command loop. The important path is:

```text
command_loop
  command_loop_2
    command_loop_1
      read_key_sequence
        read_char
          kbd_buffer_get_event
```

`command_loop` catches top-level errors and, in interactive mode, loops forever.
`command_loop_1` runs command finalization hooks, selects the current buffer,
handles echo/minibuffer redraw cases, then reads a key sequence and dispatches
the command.

`kbd_buffer` is the native queue of input events. `kbd_buffer_store_event` adds
events; `kbd_buffer_get_event` waits until input, mouse movement, quit, timer,
or process output makes progress possible. The waiting path calls
`wait_reading_process_output`, which is the native blocking integration point.

This is the main browser mismatch: browser workers cannot synchronously block
the event loop waiting for DOM input. The Emacs side wants a command-loop wait
point; the browser side wants a Promise/message boundary.

`Fcall_interactively` in `callint.c` explains why a worker/browser command
protocol should dispatch real commands instead of only eval strings. It parses
interactive specs, saves/restores command identity, preserves
`current-prefix-arg`, and calls minibuffer readers for file names, buffers,
commands, strings, coding systems, and Lisp expressions. The command loop in
`keyboard.c` runs `pre-command-hook`, calls `undo-auto--add-boundary`, records
point/current buffer before the command, executes `command-execute`, then runs
`post-command-hook` and updates last-command state. Running commands through
this path gives undo boundaries, prefix handling, hooks, minibuffer argument
reading, and command history. Calling `wasmacs_eval_string` directly can be a
diagnostic and maintenance API, but it is not equivalent to Emacs interactive
editing.

## Minibuffer

`vendor/emacs/src/minibuf.c` owns real minibuffer state. `read_minibuf` binds
minibuffer variables, checks recursive minibuffer policy, creates/selects the
minibuffer buffer and window, records unwind-protect cleanup, installs prompt
text/keymap/history state, runs `minibuffer_setup_hook`, clears undo, then
enters `recursive_edit_1`.

The path is intentionally not a browser-side text prompt:

```text
Fread_from_minibuffer
  read_minibuf
    set_window_buffer / Fselect_window
    run_hook(minibuffer_setup_hook)
    recursive_edit_1
      command_loop
```

On exit, `read_minibuf` reselects the minibuffer buffer, extracts contents, and
history/default handling continues through the same C/Lisp state.

`vendor/emacs/lisp/minibuffer.el` layers completion behavior on this primitive.
`completing-read-default` composes keymaps, stores completion table/predicate in
minibuffer-local variables through a setup hook, then calls
`read-from-minibuffer`. Completion is therefore not separable from the real
minibuffer buffer, keymap, command loop, and hooks.

## Lisp Reader And Load

`vendor/emacs/src/lread.c` has two relevant roles.

First, it implements reading forms from strings, buffers, markers, functions,
and files. `Fread_from_string` calls `read_internal_start`, which sets global
read indices for string input and then calls `read0`.

Second, it implements load/eval loops. `Fload` resolves files through
`load-path`, suffixes, file-name handlers, file descriptors, and safety checks,
then calls `readevalloop`. `readevalloop` binds `standard-input`, lexical
environment, `macroexp--dynvars`, load-history state, reads one form, restores
temporary buffer point/restriction state, and evaluates or macroexpands/evals.

`mark_lread` marks reader stack entries. That matters for wasm because reader
state is global and reentrant in controlled ways, but still expects GC marking
to see active reader structures.

## File Primitives

`vendor/emacs/src/fileio.c` maps Elisp file operations to host file syscalls
plus file-name-handler indirection.

Key surfaces:

- `Fexpand_file_name` and friends normalize paths and consult handlers.
- `Ffind_file_name_handler` routes magic/remote/special file operations.
- `Ffile_exists_p`, `Ffile_readable_p`, directory predicates, stat functions,
  rename/delete/copy/mkdir all route through encoded file names and host calls.
- `Finsert_file_contents` opens, stats, reads, decodes, inserts into the
  current buffer, optionally marks the buffer as visiting the file, and records
  visited-file modtime.
- `Fwrite_region` / `write_region` validates the region, handles annotations
  and coding systems, opens/writes/fsyncs/closes, and updates visited-file
  buffer state when `visit` is requested.

For wasmacs, this means `/system`, `/home/user`, and `/tmp` must be visible to
Emacs as ordinary filesystem paths inside the Emscripten FS layer. Browser
storage is an implementation detail behind that layer, not an Elisp-visible
replacement for `fileio.c`.

`vendor/emacs/lisp/files.el` adds the higher-level file-visiting contract.
`find-file-noselect` first reuses an existing buffer visiting the same file or
truename when possible, checks disk modification state, handles literal vs
normal visits, and only then creates a new buffer. `find-file-noselect-1`
erases the buffer, calls `insert-file-contents` with `visit` non-nil, records
`buffer-file-truename`, `buffer-file-number`, `default-directory`, backup
policy, coding/local-variable behavior, and calls `after-find-file`.
`set-visited-file-name` similarly updates `buffer-file-name`, truename,
default directory, buffer name, backup/autosave state, visited modtime, and
local write/revert hooks.

`save-buffer` and `basic-save-buffer` are not just `write-region`. They verify
visited-file modtime, run save hooks, potentially prompt for a filename,
delegate to VC/write hooks, write through `write-region`, update
`buffer-file-coding-system`, `buffer-file-number`, auto-save state, and run
after-save hooks. So the stable browser path must make these normal Elisp
functions work against MEMFS paths; bypassing them with JS file writes will
skip real visited-file state.

## Buffers, Point, Markers, And Undo

`vendor/emacs/src/buffer.c` owns buffer identity and buffer-local state.
`Fget_buffer_create` allocates a buffer, initializes gap text storage, point,
narrowing bounds, modification ticks, overlay structures, buffer name, mark, and
undo list. Ordinary buffers start with `buffer-undo-list` as nil; internal
space-prefixed buffers start with undo disabled (`t`).

`set_buffer_internal_2` updates `current_buffer`, records old buffer point /
narrowing markers, fetches the new buffer's markers, and synchronizes indirect
buffer undo lists with their base buffers. This is why "current buffer" is not
just a JS-side selected file. It is a C-owned pointer plus per-buffer Lisp state.

The `buffer-undo-list` docstring defines the real undo record shape: insertion
ranges, deleted text, file timestamp entries, text property changes, apply
entries, marker adjustments, point positions, and nil boundaries. GC handles
these lists specially for live buffers, and `simple.el` consumes them.

`vendor/emacs/lisp/simple.el` implements user-facing undo. `undo` manages
`pending-undo-list`, `undo-equiv-table`, region undo, redo detection, and
messages. `primitive-undo` walks the undo records and performs buffer changes.
`undo-auto--add-boundary` and related functions add command/timer/amalgamation
boundaries after undoable changes.

The implication is direct: browser-side textarea undo is not Emacs undo. Real
undo requires persistent Emacs buffers, command boundaries, live buffer GC
roots, and command dispatch through Emacs.

`vendor/emacs/src/insdel.c` is the missing lower half of the undo story.
`insert_1_both` calls `prepare_to_modify_buffer` before moving/growing the gap,
then `record_insert`, increments modification ticks, adjusts markers, intervals,
and point. `del_range_2` builds the deleted text when undo is enabled, calls
`record_delete`, adjusts markers, and updates modification ticks. `replace_range`
records insertion before deletion so undo can restore marker behavior in the
right order.

`prepare_to_modify_buffer_1` is especially important for wasm stability. The
source comment says it runs Lisp, may GC, and may compact buffers, so callers
must not invoke it while manipulating the gap or another critical text section.
It also calls `undo-auto--undoable-change`, handles read-only/interval checks,
locks visited files through `file_truename`, extracts active region text, runs
`before-change-functions`, and sets `deactivate-mark`. Therefore file-visiting
buffer + undo stability after explicit GC depends on three things being true:

- the buffer remains live through `Vbuffer_alist` / selected-window / current
  buffer roots;
- the current host entrypoint exposes the stack and `specpdl` roots correctly
  while hooks and modification code run;
- undo lists are compacted and marked only after live-buffer marking, so a
  hidden or prematurely killed buffer can lose undo state.

This clarifies the prior crash class: if a file-visiting buffer poisons the next
host eval around GC, the likely fault is not `find-file` alone. It is the
combination of host entrypoint stack range, dynamic bindings/hooks, and live
buffer/undo marking after text/file-visiting state has been established.

## Wasm-Relevant Conclusions

1. Do not split editor semantics out into browser UI. Buffers, undo, point,
   command state, minibuffer, completion, and file visiting live in Emacs.
2. Host eval is dangerous unless it preserves stack/GC root assumptions. The
   safer shape is an owned command protocol with pending/busy state and a
   refreshed stack-root range at every JS-to-Emacs entry.
3. Minibuffer support should suspend and resume the real Emacs command loop,
   not call a browser prompt and stuff the result back into Lisp.
4. File persistence should materialize browser user/system images into the
   Emscripten filesystem and let `fileio.c` run normally.
5. Any Asyncify waitpoint must be placed where Emacs-owned state is already
   valid and reentrant host calls are rejected until unwind completes.
6. `inhibit_garbage_collection` is justified for forced suspended probes, but
   the target architecture should shrink its use to narrow pending-command
   regions and prove explicit GC after completion.
