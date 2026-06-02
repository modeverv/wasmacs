# Minibuffer Asyncify Entrypoint Plan

## Goal

Create the first build and probe lane for an Emacs-owned suspended
minibuffer read.

This lane does not replace minibuffer behavior in the browser. It prepares a
separate wasm artifact that can preserve the Emacs C stack across an input
waitpoint, then keeps the browser limited to state reads, input events, and
explicit unavailable responses while Emacs owns the active read.

## Local Toolchain Evidence

The local toolchain is Homebrew Emscripten 5.0.7:

```text
emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 5.0.7-git
```

`/opt/homebrew/Cellar/emscripten/5.0.7/libexec/src/settings.js` defines:

- `ASYNCIFY`
- `ASYNCIFY_IMPORTS`
- `ASYNCIFY_STACK_SIZE`
- `ASYNCIFY_ADD`
- `ASYNCIFY_ONLY`
- `ASYNCIFY_ADVISE`
- `JSPI`
- `JSPI_EXPORTS`
- `JSPI_IMPORTS`

The setting comments describe Asyncify as the portable route that rewrites the
wasm binary and JSPI as the experimental VM-supported route. The first repo
lane therefore uses `-sASYNCIFY=1` and keeps JSPI as a later comparison
profile.

Full Asyncify instrumentation makes the current Emacs loadup path deeper on
the JavaScript side. With the first untrimmed profile, Node's default JS stack
overflows during `loadup.el`; the same artifact boots with:

```sh
node --stack-size=65500 ./temacs --batch --eval '(princ "hello asyncify-profile\n")'
```

That is acceptable for this spike lane, but it is evidence that the next
functional pass should narrow instrumentation with a real wait import instead
of treating full Asyncify as the production shape.

## Separate Artifact Lane

The existing persistent browser artifact remains the correctness baseline:

```text
artifacts/emacs-browser-persistent-spike/
```

The suspended-read lane builds into a separate directory:

```text
artifacts/emacs-browser-asyncify-spike/
```

The asyncify artifact keeps the same host exports as the persistent artifact:

- `_wasmacs_eval_string`
- `_wasmacs_last_result`
- `_wasmacs_minibuffer_state`
- `_wasmacs_command_state`
- `_wasmacs_command_begin_minibuffer_probe`

It also keeps `EXIT_RUNTIME=0`, the preloaded Emacs Lisp and `etc` trees, and
the browser-safe runtime methods. The browser app and worker should not switch
to this artifact until the active read probes pass.

## First Waitpoint Slice

The first functional waitpoint should be added near Emacs input wait, not in a
browser-side reader and not as a raw `read_minibuf` ABI. The source boundary
from `docs/minibuffer-suspended-read-plan.md` still applies:

- `read_minibuf`
- `recursive_edit_1`
- `command_loop`
- `read_char`
- `read_decoded_event_from_main_queue`
- `kbd_buffer_store_event`

The first C/JS bridge should introduce a host wait import with an explicit name
such as:

```text
wasmacs_host_wait_for_input
```

and compile it with:

```text
-sASYNCIFY=1
-sASYNCIFY_IMPORTS=wasmacs_host_wait_for_input
```

The import should only be reached when Emacs is in a command-loop input wait.
For the first minibuffer probe, the condition should be even narrower:

```text
minibuf_level > 0 && no queued input event is available
```

## State And Reentrancy Rules

While the command is suspended:

- `wasmacs_command_state` reports `pending-minibuffer`.
- `wasmacs_minibuffer_state` reports `active:true`, `depth:1`, prompt, input,
  and point.
- `wasmacs_eval_string` returns `unavailable:busy`.
- A second command begin returns `unavailable:busy`.
- process and pty support remain unavailable.

The asyncify lane must keep the current batch boundary until a non-batch or
interactive command-loop profile exists. In other words, the first build proof
can still report `unavailable:noninteractive-batch`; the next milestone is to
make a separate interactive entrypoint that reaches the waitpoint.

## Required Probes

1. Build the asyncify artifact without replacing the persistent artifact.
2. Boot the asyncify artifact in batch mode and verify the current host exports
   still work.
3. Confirm the active read probe still reports
   `unavailable:noninteractive-batch` before the interactive entrypoint lands.
4. Add the wait import and prove `pending-minibuffer` from a real
   `read-from-minibuffer`.
5. Feed text through the Emacs input queue and accept through Emacs
   `exit-recursive-edit` semantics.
6. Reject reentrant eval and second command begin while suspended.
7. Force GC before completion and verify the minibuffer state and result
   survive.

## Current Validation Boundary

`scripts/build-emacs-browser-asyncify-spike.sh` creates the separate asyncify
artifact. `scripts/validate-minibuffer-asyncify-entrypoint-plan.sh` checks the
plan, local Emscripten settings, artifact shape, exports, and batch boot log.

The validation intentionally does not claim active minibuffer support yet. It
only proves the next artifact lane exists and remains compatible with the
current host entrypoint probes.
