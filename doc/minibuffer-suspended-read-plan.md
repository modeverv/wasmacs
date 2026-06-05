# Minibuffer Suspended Read Plan

## Goal

Define the first safe browser host entrypoint for real Emacs-owned
minibuffer reads.

The browser must not call a JavaScript file picker, mutate minibuffer history,
or synthesize a result for `find-file`. It must enter the real Emacs command
or reader path, display Emacs-owned minibuffer state while the read is active,
feed browser input back as Emacs input events, and let Emacs produce the final
value.

## Source Facts

- `vendor/emacs/src/minibuf.c` `Fread_from_minibuffer` calls `read_minibuf`.
- `vendor/emacs/src/minibuf.c` `read_minibuf` sets minibuffer variables,
  selects the minibuffer window, inserts the prompt and initial input, runs
  `minibuffer-setup-hook`, clears minibuffer undo history, and then calls
  `recursive_edit_1`.
- `vendor/emacs/src/minibuf.c` `read_minibuf_unwind` restores prompt,
  selected frame/window state, minibuffer history state, and decrements
  `minibuf_level`.
- `vendor/emacs/src/keyboard.c` `recursive_edit_1` calls `command_loop`.
- `vendor/emacs/src/keyboard.c` `command_loop` catches `Qexit` specially when
  `command_loop_level > 0 || minibuf_level > 0`.
- `vendor/emacs/src/keyboard.c` `command_loop_1` reads a key sequence with
  `read_key_sequence`, then dispatches the resolved command.
- `vendor/emacs/src/keyboard.c` `read_char` eventually waits through
  `read_decoded_event_from_main_queue` when no unread or queued event exists.
- `vendor/emacs/src/keyboard.c` `kbd_buffer_store_event` is the native input
  queue path for events produced outside the command loop.
- `vendor/emacs/src/keyboard.c` `exit-recursive-edit` and
  `abort-recursive-edit` leave active minibuffer reads by throwing `Qexit`.

## Non-Starters

These entrypoints are intentionally forbidden for the first real minibuffer
implementation:

- A browser-side `read-file-name` clone.
- A raw exported `read_minibuf` ABI that bypasses keymaps, command dispatch,
  hooks, selected-window state, or unwind protection.
- Calling `wasmacs_eval_string` reentrantly while an Emacs command or
  minibuffer read is suspended.
- Returning a browser-chosen string as the minibuffer result.
- Letting process or pty support become an implicit dependency.

## Chosen Shape

The first supported entrypoint is a suspended command-loop entrypoint, not a
browser reader:

```text
wasmacs_command_begin(key_sequence | command_symbol)
  -> idle | pending-minibuffer | completed | error | unavailable

wasmacs_input_event(event)
  -> pending-minibuffer | completed | error

wasmacs_command_state()
  -> host.gui.minibuffer-state plus selected buffer/window metadata

wasmacs_command_cancel()
  -> aborts through Emacs quit / abort-recursive-edit semantics
```

For `C-x C-f`, the host begins the real Emacs key sequence or command. Emacs
enters `read-file-name`, `read-from-minibuffer`, `read_minibuf`,
`recursive_edit_1`, and `command_loop`. The browser sees
`pending-minibuffer` only after Emacs has made the minibuffer buffer/window and
prompt active.

When browser input arrives, it is converted into Emacs input events and fed
through the native input queue path. Accept and quit are not direct browser
results; they are Emacs events or commands that cause `exit-recursive-edit` or
`abort-recursive-edit` to unwind the original read.

## Suspension Strategy

The first implementation should preserve the active Emacs C stack while the
browser waits for input. Splitting `read_minibuf` into a heap continuation is
too invasive for the first pass because `read_minibuf` relies on specpdl,
unwind-protect entries, selected frame/window state, local bindings, and
minibuffer-local buffer state.

The practical first route is therefore an Asyncify/JSPI-style waitpoint around
the input wait path used by `read_char` when it reaches
`read_decoded_event_from_main_queue` with no available event. The wasm stack
remains the owner of the active read. The host records that Emacs is suspended
and exposes only read-only state plus input/cancel entrypoints until the read
completes.

## Host State Machine

```text
idle
  begin command
  -> running

running
  command completes without minibuffer
  -> completed

running
  read_char waits with minibuf_level > 0
  -> pending-minibuffer

pending-minibuffer
  command_state
  -> pending-minibuffer

pending-minibuffer
  input_event
  -> running -> pending-minibuffer | completed | error

pending-minibuffer
  command_cancel
  -> running -> aborted | error

pending-minibuffer
  eval_string
  -> unavailable:busy
```

`pending-minibuffer` is a single-owner state. The browser may render prompt,
input, point, depth, completion availability, and unavailable reason. It may
not start a second command, start host eval, or mutate the minibuffer buffer
outside Emacs input events.

## GC And Root Safety

The first correctness bar is that an active minibuffer read survives host
turns without losing its C stack, specpdl entries, selected minibuffer window,
current minibuffer buffer, or prompt string.

Required probes before enabling `C-x C-f`:

1. Start a real minibuffer read and observe `active:true`, `depth:1`, prompt,
   input, and point from `host.gui.minibuffer-state`.
2. Feed text input, observe that the minibuffer buffer changes on the Emacs
   side, then feed accept and verify that Emacs returns the same string.
3. Feed quit and verify the read unwinds through Emacs abort semantics and
   returns to `active:false`, `depth:0`.
4. Reject `wasmacs_eval_string` and second command starts while the command is
   suspended with an explicit `unavailable:busy` result.
5. Force at least one GC after the read resumes and before command completion,
   then verify that the minibuffer buffer/window state and result are still
   valid.

Until these probes pass, browser-facing minibuffer commands remain explicit
unavailable boundaries.

## First Implementation Slice

1. Add a C-side command state flag around exported host entrypoints.
2. Add a read-only active minibuffer state exporter that reports prompt, input,
   point, depth, and selected-window identifiers.
3. Add a suspended waitpoint at the input wait boundary rather than inside
   Lisp-level readers.
4. Add one begin/input/cancel probe for `(read-from-minibuffer "Find file: ")`
   before routing `C-x C-f`.
5. Route `C-x C-f` only after the explicit read probe passes.

## Current Evidence

`tools/scripts/patch-emacs-host-entrypoint-spike.sh` now adds a copied-source
`wasmacs_minibuffer_state` export beside `wasmacs_eval_string` and
`wasmacs_last_result`; `vendor/emacs` remains read-only. The persistent browser
profile exports it with `_wasmacs_minibuffer_state`.

`tools/scripts/probe-browser-minibuffer-state-export.mjs` verifies the inactive
state path without using `wasmacs_eval_string`:

```text
active:false
depth:0
prompt:
input:
current-minibuffer:false
```

Evidence is in `logs/wasm-browser-minibuffer-state-export.txt`. This still
does not start an active read; it creates the C-side observation surface that
the suspended read entrypoint must use once `read_char` can yield for browser
input.

`tools/scripts/patch-emacs-host-entrypoint-spike.sh` also now exports
`wasmacs_command_state` and `wasmacs_command_begin_minibuffer_probe`.
`wasmacs_eval_string` rejects future in-flight command ownership as
`unavailable:busy`; the current probe does not set that state yet because the
artifact still boots with `--batch`.

`tools/scripts/probe-browser-minibuffer-active-read-boundary.mjs` verifies the first
active-read boundary condition:

```text
INITIAL_COMMAND_STATE:idle
BEGIN_STATUS:3
BEGIN_READBACK:unavailable:noninteractive-batch
AFTER_COMMAND_STATE:idle
AFTER_MINIBUFFER_STATE:active:false
```

Evidence is in `logs/wasm-browser-minibuffer-active-read-boundary.txt`. This
proves the current batch profile cannot enter active `read_minibuf`; the next
implementation step is an interactive/suspended command entrypoint rather than
a browser-side reader or a raw `read_minibuf` call.
