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

## Wasm-Relevant Conclusions

1. Do not split editor semantics out into browser UI. Buffers, undo, point,
   command state, minibuffer, completion, and file visiting live in Emacs.
2. Host eval is dangerous unless it preserves stack/GC root assumptions. The
   safer shape is an owned command protocol with pending/busy state.
3. Minibuffer support should suspend and resume the real Emacs command loop,
   not call a browser prompt and stuff the result back into Lisp.
4. File persistence should materialize browser user/system images into the
   Emscripten filesystem and let `fileio.c` run normally.
5. Any Asyncify waitpoint must be placed where Emacs-owned state is already
   valid and reentrant host calls are rejected until unwind completes.
