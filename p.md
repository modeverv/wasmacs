# Wasm And Browser Runtime Plan

This plan translates the Emacs source mechanics in `emacs.md` into the wasm
runtime design for wasmacs.

## Core Position

The first browser design should keep Emacs as the owner of editor semantics and
use Emscripten as the compatibility runtime:

```text
browser / worker messages
  -> JS host adapter
    -> Emscripten FS + Asyncify wait imports
      -> emacs-core.wasm
        -> real Emacs buffers, command loop, minibuffer, fileio, undo
```

Do not build browser substitutes for minibuffer, undo, kill-ring, point,
completion, or file visiting. The browser may render and inject input events,
but the state transition must happen in Emacs.

## Wasm Linear Memory

Emscripten puts the C heap, C stack, static data, preloaded FS metadata, and
Emacs objects into wasm linear memory. Pointers are offsets into this memory,
not native process addresses.

Design rules:

- Keep one long-lived module instance per Emacs session.
- Avoid transferring raw Emacs pointers to app UI code. Export copied strings,
  status codes, and structured snapshots instead.
- Enable memory growth for current spikes, but treat growth as a latency and
  pointer-view invalidation risk on the JS side.
- Keep JS `HEAP*` typed-array views short-lived; reacquire them after calls that
  may allocate or grow memory.
- Size the native wasm stack deliberately. Prior evidence already showed Emacs
  loadup needs a larger stack than default; keep the 1MB stack profile for now
  unless measurements justify lowering it.

## C Stack Is Not Native

Native Emacs assumes it can conservatively scan a contiguous C stack between a
known bottom and a current top. In wasm, the C stack is an area inside linear
memory maintained by Emscripten. It is real enough for C code, but browser
callbacks and exported entrypoints do not automatically recreate native
top-level stack ownership.

Design rules:

- Treat exported functions from JS into Emacs as host entrypoints requiring a
  root-safety policy.
- Prefer one owned Emacs command-loop stack over many ad hoc host eval calls.
- During temporary host eval or forced probes, inhibit GC or refresh stack
  bounds before allowing allocation-heavy code.
- Never allow reentrant eval while an Asyncify-suspended command is pending.
  Return `unavailable:busy`.

## Emscripten Stack APIs

Use Emscripten stack APIs for diagnostics and for any copied-source patch that
must refresh stack boundaries:

- `emscripten_stack_get_base()`
- `emscripten_stack_get_end()`
- `emscripten_stack_get_current()`

First treatment:

1. Add diagnostic exports/logging around host entrypoints to record current,
   base, and end.
2. If GC crashes persist across host eval, patch the copied build tree so the
   current Emacs thread's stack top/bottom are refreshed at entrypoint start.
3. Keep this patch out of `vendor/emacs` and gated behind the spike scripts.

The goal is not to make stack APIs part of the public host ABI. They are a
runtime-port implementation detail.

## Asyncify Rewind And Unwind

Asyncify rewrites wasm so calls can unwind out to JS when an async import is
reached, then rewind back into the saved stack when the Promise resolves. That
matches Emacs input wait better than a browser-side fake read.

Design rules:

- Use Asyncify only in a separate artifact lane until it is proven stable.
- Model an input wait as a pending Emacs operation, not as a synchronous exported
  function that must complete before returning control to JS.
- Expose state while pending: command state, minibuffer active/depth/prompt,
  and current input.
- Resume only by injecting Emacs input events and resolving the host wait
  Promise.
- Keep GC inhibited for the lifetime of the forced suspended probe until a
  normal command-loop owner and stack/root treatment prove GC-after-completion.

The existing `minibuf-setup` waitpoint shape is the right diagnostic direction:
after prompt/window/keymap/setup hook state exists, before
`recursive_edit_1` consumes input. The final route may move the waitpoint back
toward the normal input wait once GC/root safety is stable.

## ASYNCIFY_IMPORTS

Keep `ASYNCIFY_IMPORTS` narrow. The current named import should remain:

```text
wasmacs_host_wait_for_input
```

Do not rely on full Asyncify instrumentation as the production shape. Use
`ASYNCIFY_ADVISE=1` and summary tooling to verify that the propagation includes
the intended path:

```text
read_minibuf
recursive_edit_1
command_loop
read_key_sequence
read_char
kbd_buffer_get_event
wasmacs_host_wait_for_input
```

If additional async host calls are introduced, add them explicitly and validate
the advisory set. Avoid wildcard imports that make every host call a potential
suspension point.

## setjmp / longjmp

Emacs conditions and command-loop recovery depend on `sys_setjmp` /
`sys_longjmp`. Emscripten supports setjmp/longjmp, but mixing longjmp with
Asyncify suspension is a high-risk boundary because both mechanisms care about
control-flow restoration.

Design rules:

- Let Lisp `throw`, `signal`, `condition-case`, and `unwind-protect` stay inside
  Emacs frames whenever possible.
- At JS exported boundaries, catch Lisp errors in C and return explicit status
  codes plus last-result text.
- Do not let a longjmp cross from an Asyncify-resumed command into a JS caller
  that assumes a normal return.
- Keep `specpdl` balanced by ensuring every exported command has a single owner
  and a well-defined completion/cancel path.
- Test cancel separately from text completion. `C-g` should be queued for the
  resumed Emacs reader, not handled as a host-side interrupt that longjmps from
  the wrong stack.

## EXIT_RUNTIME / noExitRuntime

Batch proof artifacts can use runtime exit, but browser Emacs cannot. The
browser profile must keep:

```text
-sEXIT_RUNTIME=0
```

and Emscripten JS must use `noExitRuntime` behavior so exported functions,
preloaded FS, timers, and pending Asyncify operations remain usable after
startup.

Design rules:

- Keep one-shot `--batch` artifacts separate from persistent browser artifacts.
- Use persistent entrypoints for browser command execution.
- Treat `Fkill_emacs` / batch EOF as incompatible with the browser session
  profile except for controlled shutdown tests.

## FS Preload And MEMFS

Emscripten `--preload-file` packages files into a `.data` payload and mounts
them into MEMFS at startup. MEMFS is volatile, synchronous, and fits Emacs'
expectation that file syscalls return synchronously.

First browser treatment:

- Preload `/system/lisp` and required `/system/etc` from
  `system-lisp.wasifs` materialized during packaging.
- Materialize `user-filesystem.wasifs` into `/home/user` MEMFS at worker
  startup.
- Let `fileio.c` see normal paths like `/system/lisp` and
  `/home/user/projects/x.txt`.
- Reverse-sync dirty `/home/user` MEMFS contents back to the browser
  `.wasifs` image after Emacs commands that save or modify files.
- Keep OPFS/IndexedDB as persistence backends for the image, not as direct
  Emacs-visible path semantics.

Avoid `NODERAWFS` in browser profiles. It is useful for Node spikes but proves
the wrong thing for browser portability.

## Browser Event Loop Vs Blocking Read

The browser cannot let wasm block a worker forever while waiting for input if
the same worker must receive messages to provide that input. Native Emacs'
`kbd_buffer_get_event` waits inside the command loop; the browser must turn that
wait into an async suspension.

Design:

1. Emacs reaches `wasmacs_host_wait_for_input`.
2. JS host returns a pending Promise and records `pending-command`.
3. Browser UI reads state and renders frame/minibuffer.
4. Browser sends key/text/cancel messages to the worker.
5. Worker calls narrow C helpers that enqueue real Emacs input events or unread
   command events.
6. Worker resolves the pending wait Promise.
7. Asyncify rewinds into Emacs; `kbd_buffer_get_event` / `read_char` consumes
   the queued event.
8. Command finishes, unwind-protect cleanup runs, and the exported result state
   becomes complete.

While step 2 is pending, all other eval/command starts must return busy. State
read exports can remain available if they are non-allocating or protected.

## Implementation Phases

Phase 1: keep current persistent non-Asyncify browser profile as the ordinary
editing baseline. Continue using it for file open/save, point, undo/redo, and
browser smoke tests.

Phase 2: keep the Asyncify profile separate. Finish the owned suspended command
protocol:

- pending state
- busy guard
- text input
- cancel input
- completion result
- GC-after-completion smoke

Phase 3: move from forced minibuffer probe to real browser command dispatch.
Only after this passes should the browser UI expose real minibuffer commands.

Phase 4: retire browser-side placeholder behavior that conflicts with Emacs
semantics. Keep explicit unavailable messages only for surfaces still outside
the MVP, such as process/pty.

## Validation Checklist

Run these after changing the wasm/runtime design:

```sh
npm test
scripts/validate-minibuffer-asyncify-entrypoint-plan.sh
node scripts/probe-browser-asyncify-minibuffer-input-injection.mjs
node scripts/probe-browser-asyncify-minibuffer-cancel.mjs
npm run browser:smoke:all
```

For GC/root work, add or keep evidence for:

- GC after a completed suspended minibuffer command.
- Reentrant eval rejected while pending.
- File-visiting buffer and undo-list survive explicit `garbage-collect`.
- Browser reverse-sync still preserves `/home/user` changes.
