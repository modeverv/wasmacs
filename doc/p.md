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
- Refresh stack bounds before every JS-to-Emacs entrypoint that may allocate or
  run Lisp. Do not keep using the startup `main` stack range after `callMain`
  returns.
- During temporary host eval or forced suspended probes, additionally inhibit
  GC when Asyncify parks the command outside normal command-loop ownership.
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
2. Patch the copied build tree so host entrypoints set the scan range from the
   current entry frame before entering Lisp.
3. Keep this patch out of `vendor/emacs` and gated behind the spike scripts.

The goal is not to make stack APIs part of the public host ABI. They are a
runtime-port implementation detail.

The current spike already uses the simpler C-local form for `wasmacs_eval_string`:
save `stack_bottom`, set it from a local `stack_bottom_variable`, run the eval
under a condition handler, then restore it. That aligns with Emacs' own
`SET_STACK_TOP_ADDRESS` pattern conceptually, but it is still a spike. A better
version should set both global `stack_bottom` and `current_thread->stack_top`
from Emscripten stack APIs or an equivalent noinline helper, then run Lisp
outside the no-allocation `flush_stack_call_func1` callback contract.

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
- Keep GC inhibited for the lifetime of the forced suspended probe. This is a
  bounded correctness guard: prior source reading shows `specpdl`, handler, and
  stack roots are the exact surfaces at risk while Asyncify has unwound the C
  stack to JS.
- Remove or narrow that inhibition only after GC-after-completion and
  GC-while-idle-after-resume probes pass.

The existing `minibuf-setup` waitpoint shape is the right diagnostic direction:
after prompt/window/keymap/setup hook state exists, before
`recursive_edit_1` consumes input. The final route may move the waitpoint back
toward the normal input wait once GC/root safety is stable.

The source now makes the next split clearer:

- `minibuf-setup` is useful to observe a valid active minibuffer with a shallow
  suspended stack.
- `read-char` / `kbd_buffer_get_event` is the semantically final waitpoint
  because it is where the normal command loop waits for input, timers, quit,
  mouse movement, and process output.
- The implementation should graduate from forced
  `read-from-minibuffer` probes to a command protocol that starts at
  `command-execute` / `call-interactively`, because interactive specs are where
  file prompts, command prompts, prefix args, and command history are created.

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

The current cancel probe supports this rule. Directly storing a `quit_char`
event through the low-level input path can trigger interrupt handling from the
host-call side. Queueing `quit_char` in `Vunread_command_events` lets the
resumed Emacs input reader consume the cancel from the correct dynamic extent,
so `condition-case` catches it and unwinds `read_minibuf` normally.

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

For file-visiting fidelity, the browser worker must not only write bytes. It
must let these Emacs paths run:

```text
find-file-noselect
  find-file-noselect-1
    insert-file-contents VISIT=t
    after-find-file

save-buffer
  basic-save-buffer
    write-region VISIT=t
```

The reverse-sync boundary should run after these functions complete, when
`buffer-file-name`, visited modtime, coding system, backup/autosave state, and
undo boundaries have already been updated by Emacs.

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

The worker command protocol should therefore distinguish three classes:

- `state-read`: allowed while pending only if guarded and non-mutating, for
  example minibuffer state snapshots.
- `input-inject`: allowed while pending; it may enqueue text, key events, or
  cancel into Emacs-owned input queues.
- `command/eval`: rejected while pending with `unavailable:busy`.

This avoids reentrant `specpdl`/handler stacks and matches the current source
ownership model.

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

Phase 2 must include two GC probes before promotion:

- after a suspended minibuffer completes, run explicit `(garbage-collect)` from
  a fresh host entrypoint and read minibuffer/command state;
- after a real file-visiting edit/save/undo sequence, run explicit
  `(garbage-collect)` and then perform another command against the same buffer.

Phase 3: move from forced minibuffer probe to real browser command dispatch.
Only after this passes should the browser UI expose real minibuffer commands.

Phase 4: retire browser-side placeholder behavior that conflicts with Emacs
semantics. Keep explicit unavailable messages only for surfaces still outside
the MVP, such as process/pty.

## Validation Checklist

Run these after changing the wasm/runtime design:

```sh
npm test
tools/scripts/validate-minibuffer-asyncify-entrypoint-plan.sh
node tools/scripts/probe-browser-asyncify-minibuffer-input-injection.mjs
node tools/scripts/probe-browser-asyncify-minibuffer-cancel.mjs
npm run browser:smoke:all
```

For GC/root work, add or keep evidence for:

- GC after a completed suspended minibuffer command.
- Reentrant eval rejected while pending.
- File-visiting buffer and undo-list survive explicit `garbage-collect`.
- Browser reverse-sync still preserves `/home/user` changes.

## Current Answers To The Four Open Questions

Asyncify suspend/resume after GC:
The source says GC while the stack is unwound to JS is unsafe unless stack,
`specpdl`, and handler roots remain visible. Keep GC inhibited during the
pending forced command. After resume and unwind, GC should be allowed, but this
needs an explicit probe before the asyncify lane is promoted.

Forced probe vs worker/browser command protocol:
The source points toward a real command protocol. `call-interactively` and
`command_loop_1` own interactive specs, prefix args, command hooks, undo
boundaries, and command history. The forced probe is a valid diagnostic, but it
should not be the product path.

Stack refresh vs GC inhibit:
Use both, but at different boundaries. Stack refresh is the general
JS-to-Emacs entrypoint rule. GC inhibit is a narrow pending-Asyncify-command
guard until the command-loop owner and post-resume GC probes prove stable.
The current post-completion GC blocker is more specific than a generic
`specpdl` leak: boot-baseline GC passes with the same backtrace shape, while
Asyncify resume leaves old backtrace `args` pointers aimed at wasm stack slots
whose raw Lisp words have changed. The next fix should make those backtrace
argument roots durable or remove/rebase the stale batch/bootstrap backtrace
before suspended commands can overwrite the stack slots they point at. A
diagnostic scrub of non-empty `SPECPDL_BACKTRACE` arg slots makes text and
cancel post-completion GC pass, which confirms the target while also showing
what not to ship: erasing backtrace args is a proof probe, not Emacs fidelity.
The better spike is now a one-time command-boundary pin: copy those baseline
backtrace arg vectors to `xmalloc` storage before the Asyncify command starts.
That keeps ordinary text/cancel post-completion GC green without deleting
backtrace args. It still needs a real lifetime/freeing policy before being
treated as product architecture.

File-visiting buffer and undo-list after explicit GC:
The source suggests this should be made stable by fixing host-entrypoint roots,
not by avoiding file-visiting. `files.el` and `fileio.c` create ordinary live
buffers and visited-file state; `alloc.c` explicitly marks live buffer undo
lists after compaction. If explicit GC still crashes, the first suspect is the
wasm host-entrypoint root range or a hidden unmarked object in dynamic
bindings/hooks, not the high-level file-visiting model.
