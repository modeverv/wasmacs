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

The first waitpoint probe showed that `ASYNCIFY_STACK_SIZE=65536` is too small
for suspending inside the real minibuffer read path: the runtime reported heap
cookie corruption while rewinding. The asyncify lane now uses a 4MB Asyncify
stack for correctness probes, above the separate 1MB native wasm stack already
needed by the Emacs loadup path. Increasing from 1MB to 4MB did not remove the
first resume corruption after host input by itself. The missing piece was
GC/root handling across the suspended exported command: wrapping the forced
minibuffer probe in `inhibit_garbage_collection` keeps Emacs from collecting
while the C stack is parked outside normal command-loop ownership. With that
guard, text input and cancel probes complete with normal stack-overflow
checking enabled.

`tools/scripts/build-emacs-browser-asyncify-spike.sh` accepts
`EMACS_ASYNCIFY_EXTRA_LDFLAGS` so diagnostic passes can add settings such as
`-sASYNCIFY_ADVISE=1` without replacing the default correctness profile.
It also accepts `WASMACS_ASYNCIFY_WAITPOINT_MODE` so the same lane can compare
waitpoint placement:

- `read-char`: the original waitpoint just before
  `read_decoded_event_from_main_queue` in `keyboard.c`.
- `minibuf-setup`: a shallower split waitpoint in `minibuf.c`, after the
  minibuffer buffer/window/prompt/keymap/setup hook are active and before
  `recursive_edit_1` starts consuming input.

The `minibuf-setup` mode is not the final browser input protocol. It is a
diagnostic boundary for testing whether Asyncify can safely suspend once
Emacs-owned minibuffer state is active but before the full command-loop input
stack is on the wasm stack.
The generated `logs/wasm-browser-asyncify-advise.txt` can be reduced with:

```sh
npm run asyncify:advise:summary
```

The first advisory summary confirms that the named host import is an
Asyncify state-change source and that the expected Emacs input/minibuffer
route is included in the propagated set:

- `wasmacs_command_begin_minibuffer_force_probe`
- `Fread_from_minibuffer`
- `read_minibuf`
- `recursive_edit_1`
- `command_loop`
- `read_key_sequence_vs`
- `read_char`
- `read_decoded_event_from_main_queue`
- `kbd_buffer_get_event`
- `tty_read_avail_input`

That evidence makes the current blocker narrower than "Asyncify did not
instrument the reader." The failing boundary is still the first rewind out of
the real minibuffer stack, so the next experiment should reduce the suspended
stack shape or move the waitpoint toward a safer command-loop boundary before
adding browser input injection.

## Separate Artifact Lane

The existing persistent browser artifact remains the correctness baseline:

```text
build/artifacts/emacs-browser-persistent-spike/
```

The suspended-read lane builds into a separate directory:

```text
build/artifacts/emacs-browser-asyncify-spike/
```

The asyncify artifact keeps the same host exports as the persistent artifact:

- `_wasmacs_eval_string`
- `_wasmacs_last_result`
- `_wasmacs_minibuffer_state`
- `_wasmacs_command_state`
- `_wasmacs_command_begin_minibuffer_probe`
- `_wasmacs_command_begin_minibuffer_force_probe`
- `_wasmacs_input_text`
- `_wasmacs_input_cancel`

It also keeps `EXIT_RUNTIME=0`, the preloaded Emacs Lisp and `etc` trees, and
the browser-safe runtime methods. The browser app and worker should not switch
to this artifact until the active read probes pass.

## First Waitpoint Slice

The first functional waitpoint should be added near Emacs input wait, not in a
browser-side reader and not as a raw `read_minibuf` ABI. The source boundary
from `doc/minibuffer-suspended-read-plan.md` still applies:

- `read_minibuf`
- `recursive_edit_1`
- `command_loop`
- `read_char`
- `read_decoded_event_from_main_queue`
- `kbd_buffer_store_event`

The first C/JS bridge introduces a host wait import with an explicit name:

```text
wasmacs_host_wait_for_input
```

and compile it with:

```text
-sASYNCIFY=1
-sASYNCIFY_IMPORTS=wasmacs_host_wait_for_input
```

The spike import is provided by
`tools/scripts/wasmacs-asyncify-host-library.js`. It is intentionally a no-op async
host hook for now: it proves that the Asyncify profile can link and carry a
named wait import without changing the persistent baseline. Browser input and
resume semantics still belong to the next probe. The same library also seeds
the browser-safe Emscripten environment with `TERM=dumb`, an inline `TERMCAP`,
and `/home/user` identity defaults for the asyncify lane, because non-batch
Emacs startup calls `getenv("TERM")` and then termcap initialization before it
can reach the command loop. The hook records
`globalThis.__wasmacsHostWaitForInputCount` so probes can distinguish
"entered Emacs input wait" from later stdin EOF unwinding.
The hook now remains pending until the browser/worker explicitly resolves
`globalThis.__wasmacsResolveHostInputWait`, which lets probes observe active
minibuffer state and inject Emacs input events before resuming the wait.

The copied-source patch in `tools/scripts/patch-emacs-host-entrypoint-spike.sh`
inserts the waitpoint immediately before `read_decoded_event_from_main_queue`
in `keyboard.c` only when the build sets
`WASMACS_ENABLE_ASYNCIFY_WAITPOINT=1`; the persistent non-Asyncify profile
continues to relink without this wait import. The import should only be
reached when Emacs is in a command-loop input wait. For the first minibuffer
probe, the condition is even narrower:

```text
minibuf_level > 0 && no queued input event is available
```

For the placement comparison, `WASMACS_ASYNCIFY_WAITPOINT_MODE=minibuf-setup`
instead inserts the same import in `minibuf.c` just before
`recursive_edit_1`. That mode should let probes observe active minibuffer
state at a shallower stack boundary before attempting browser input injection.

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
4. Confirm non-batch startup survives past TERM/termcap initialization and
   remains alive long enough to be treated as an interactive command-loop lane.
5. Prove a real `read-from-minibuffer` reaches the host wait import before
   the current stdin EOF unwind.
6. Add a pending host suspension and prove `pending-minibuffer` from a real
   `read-from-minibuffer`.
7. Feed text through the Emacs input queue and accept through Emacs
   `exit-recursive-edit` semantics.
8. Reject reentrant eval and second command begin while suspended.
9. Force GC before completion and verify the minibuffer state and result
   survive.

## Current Validation Boundary

`tools/scripts/build-emacs-browser-asyncify-spike.sh` creates the separate asyncify
artifact with `-sASYNCIFY_IMPORTS=wasmacs_host_wait_for_input` and the
repo-local JS library. `tools/scripts/validate-minibuffer-asyncify-entrypoint-plan.sh`
checks the plan, local Emscripten settings, artifact shape, wait import,
exports, and batch boot log.

`tools/scripts/probe-browser-asyncify-interactive-start.mjs` covers the first
non-batch startup boundary. It expects the asyncify artifact to remain alive
until a short timeout, without the earlier `TERM` or termcap initialization
errors. That proves startup gets beyond the current
`unavailable:noninteractive-batch` class of failure, but it still does not
claim active minibuffer support.

`tools/scripts/probe-browser-asyncify-minibuffer-waitpoint.mjs` covers the next
boundary: a real `read-from-minibuffer` reaches
`wasmacs_host_wait_for_input` at least once. It currently records a
`KNOWN_BLOCKER`: after the waitpoint is reached, Asyncify rewind reports heap
cookie corruption when the host waits for the command to complete.
`WASMACS_ASYNCIFY_WAITPOINT_MODE=minibuf-setup` narrows that result: the
shallower split waitpoint still corrupts if the caller awaits the whole
`read-from-minibuffer`, but `tools/scripts/probe-browser-asyncify-minibuffer-suspend-state.mjs`
can observe the suspended state before completion:

```text
COMMAND_STATE:pending
active:true
depth:1
prompt:Find file:
current-minibuffer:true
REENTRANT_EVAL_READBACK:unavailable:busy
REENTRANT_COMMAND_READBACK:unavailable:busy
```

The next implementation step is therefore no longer just "reach a waitpoint".
It is to keep the command suspended as an owned browser/worker operation,
inject input events, and resume without awaiting the entire minibuffer command
through a synchronous host call shape. The reentrant rejection part of that
contract is now covered by the suspend-state probe.
`tools/scripts/probe-browser-asyncify-minibuffer-input-injection.mjs` covers the
first input side of that contract. It waits for the host input Promise to be
pending, calls `_wasmacs_input_text` with ASCII text plus RET, then resolves the
host wait. It now passes: `INPUT_TEXT_STATUS:0`,
`WAIT_RESOLVED:true`, `COMPLETED_STATUS:0`, and the readback
`wasmacs-input.txt` prove browser input can complete a real Emacs-owned
`read-from-minibuffer` path.

`tools/scripts/probe-browser-asyncify-minibuffer-cancel.mjs` covers the cancel side.
The first C-g attempt used `kbd_buffer_store_event` directly and triggered
`handle_interrupt` from the host-call side, leaving the suspended command
pending. The passing cancel export instead appends `quit_char` to
`Vunread_command_events`, so the resumed Emacs input reader consumes it through
its own command-loop path. The probe completes with the command back at `idle`
and the minibuffer inactive.
`tools/scripts/summarize-asyncify-advise.mjs` is a diagnostic companion for that
step: it summarizes the `-sASYNCIFY_ADVISE=1` build log and asserts that the
focused input/minibuffer functions remain visible in the Asyncify propagation
report.

The validation still does not switch the browser app to the asyncify artifact.
It proves the separate artifact lane can suspend a real Emacs minibuffer read,
reject reentrant host calls, accept text, and cancel. The next bar is to make
this an owned worker/browser protocol rather than a forced probe entrypoint,
then add GC-after-completion coverage.
