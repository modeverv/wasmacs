# Persistent Emacs Buffer Requirement

The current browser worker can keep the Emacs wasm runtime alive, but each
editing command still reconstructs a temporary buffer from a file, mutates it,
and writes it back. That is enough for ordinary insert, delete, movement, save,
and readback, but it cannot support the Emacs features that rely on live buffer
identity.

## Features Blocked By Temp Buffers

- Undo: `buffer-undo-list` is buffer-local and only meaningful when the same
  buffer survives across commands.
- Kill ring and region commands: `mark-active`, point, region, and
  `interprogram-cut-function` need persistent editor state.
- Minibuffer commands: `find-file`, `switch-buffer`, completion, and history
  need a persistent command loop plus minibuffer window/buffer state.

## Source Grounding

- `vendor/emacs/src/editfns.c` exposes point/mark and mutates
  `buffer-undo-list`.
- `vendor/emacs/lisp/simple.el` implements `undo`, `kill-ring`, `kill-new`,
  `current-kill`, and minibuffer-facing commands.
- `vendor/emacs/src/minibuf.c` owns active minibuffer buffers/windows and
  recursive minibuffer state.
- `vendor/emacs/src/window.c` and `vendor/emacs/src/buffer.c` are required for
  selected window/current buffer semantics.

## Current Evidence

`tools/scripts/probe-browser-persistent-buffer-undo.mjs` attempts the smallest
persistent-buffer undo path:

```text
find-file /home/user/persistent-undo.txt
insert alpha as setup
insert beta as undoable edit
undo
write-region
```

As of 2026-06-01, the probe records a known blocker:

```text
KNOWN_BLOCKER:persistent buffer undo currently crashes wasm during GC/undo traversal
```

This means the next implementation step is not just replacing
`with-temp-buffer` with `find-file` in the browser worker. The project needs a
dedicated persistent-buffer command mode that keeps Emacs buffer identity,
selected window state, and GC-safe host entrypoint usage stable before real
undo, kill-ring, or minibuffer behavior can be enabled.

## Matrix Probe

`tools/scripts/probe-browser-persistent-buffer-matrix.mjs` narrows the blocker:

```text
CASE:temp-buffer-write                         STATUS:PASS
CASE:find-file-write-undo-disabled             STATUS:PASS
CASE:find-file-record-undo-no-undo             STATUS:PASS
CASE:find-file-record-undo-no-intervals        STATUS:PASS
CASE:find-file-record-undo-and-undo            STATUS:KNOWN_BLOCKER
CASE:find-file-record-undo-and-undo-gc-high    STATUS:KNOWN_BLOCKER
CASE:find-file-record-undo-and-primitive-undo  STATUS:PASS
CASE:find-file-record-undo-start-undo-more     STATUS:PASS
CASE:find-file-record-undo-with-inhibit-message STATUS:KNOWN_BLOCKER
CASE:find-file-record-undo-and-undo-no-intervals STATUS:KNOWN_BLOCKER
```

Evidence is in `logs/wasm-browser-persistent-buffer-matrix.txt`.

The important result is that `find-file` itself is usable, persistent buffer
writes are usable, recording undo data without invoking undo is usable, and
even the lower-level undo path is usable:

```elisp
(undo-start)
(undo-more 1)
```

also passes. Direct `primitive-undo` also passes and leaves the expected text.

The crash appears in the higher-level `undo` command after the lower-level undo
operation succeeds. Raising `gc-cons-threshold` to `most-positive-fixnum` does
not avoid the crash, and binding `inhibit-message` does not avoid it either.
That narrows suspicion away from simple ordinary-GC timing and away from just
the minibuffer message path. The next debugging pass should focus on the latter
half of `vendor/emacs/lisp/simple.el`'s `undo`: redo bookkeeping,
`undo-equiv-table`, `pending-undo-list`, cleanup of point records, auto-save
modified-state handling, and host-entrypoint stack/GC safety after those Lisp
structures are updated.

## Cross-Eval Buffer Probe

`tools/scripts/probe-browser-persistent-buffer-cross-eval.mjs` tests whether buffer
identity survives across multiple host calls to `wasmacs_eval_string` in the
same wasm runtime:

```text
CASE:cross-eval-named-buffer-no-undo STATUS:PASS
CASE:cross-eval-file-buffer-no-undo  STATUS:KNOWN_BLOCKER
CASE:cross-eval-primitive-undo       STATUS:KNOWN_BLOCKER
```

Evidence is in `logs/wasm-browser-persistent-buffer-cross-eval.txt`.

The named-buffer case proves that ordinary Emacs buffer identity can survive
across host eval calls: one eval creates a buffer and inserts `alpha`; the next
eval re-enters the same buffer, appends ` beta`, and writes `alpha beta` to
`/home/user/cross-eval-named-buffer.txt`.

The `find-file` case still crashes with `memory access out of bounds` during
GC marking, even before undo is invoked. The undo-list case also crashes at
the same boundary. This means the next persistent-buffer milestone needs to
stabilize host-entrypoint stack/GC safety and file-visiting buffer lifetime,
not just switch the browser worker from `with-temp-buffer` to `find-file`.

## File-Buffer GC Root Probe

`tools/scripts/probe-browser-file-buffer-gc-roots.mjs` adds a narrower matrix around
the host eval GC boundary. It first showed that explicit `(garbage-collect)`
from `wasmacs_eval_string` crashed even in the boot-only and named-buffer
cases, so the failure was not specific to `find-file`.

The copied-source entrypoint now refreshes `stack_bottom` and inhibits GC
during each host eval. With that temporary boundary, these cases pass:

```text
boot-gc-only
temp-buffer-gc
named-buffer-gc
named-buffer-set-buffer-file-name
named-buffer-set-visited-file-name
named-buffer-insert-file-contents
find-file-kill-before-boundary
```

These still crash:

```text
find-file-live-buffer-gc
```

Evidence is in `logs/wasm-browser-file-buffer-gc-roots.txt`.

The current conclusion is therefore narrower than "file IO is unsafe":
ordinary named buffers, manual `buffer-file-name`, `insert-file-contents`, and
`find-file` buffers that are killed before returning can cross the host eval
boundary. Correctly-addressed `set-visited-file-name` buffers can also cross
the boundary. Live `find-file` buffers are still unsafe. The next pass should
focus on `vendor/emacs/lisp/files.el`'s `find-file-noselect-1` and
`after-find-file` paths, plus any text properties, intervals, mode/local
variable state, or buffer bookkeeping they leave for GC to mark.

`tools/scripts/probe-browser-visited-file-state.mjs` confirms the individual
`set-visited-file-name` phases complete inside one eval. 
`tools/scripts/probe-browser-visited-file-cross-eval.mjs` confirms
`set-visited-file-name` can survive a second host eval when the renamed buffer
is addressed by its new filename-derived buffer name.

`tools/scripts/probe-browser-find-file-phases.mjs` narrows the live `find-file`
blocker further. These survive across host eval calls:

```text
find-file-noselect-live
find-file-noselect-set-buffer-live
find-file-noselect-switch-to-buffer-live
find-file-noselect-pop-same-window-live
find-file-command-live
find-file-live-insert-no-write
find-file-live-erase-insert-no-write
find-file-live-insert-save-buffer
```

These remain known blockers:

```text
insert-file-contents with VISIT=t when manually staged
direct write-region against a live file-visiting buffer
```

Evidence is in `logs/wasm-browser-find-file-phases.txt`.

The practical consequence is important: real file-visiting buffers are viable,
but saving them through direct `write-region` is not. The next implementation
step was to move live file-buffer persistence toward Emacs' real
`save-buffer` path and leave `write-region` for temp-buffer/non-live bridge
proofs only.

The browser worker now follows that rule for ordinary editing commands: it
opens the active user file with `find-file`, mutates the live file-visiting
buffer, and saves modified buffers with `save-buffer`. This does not make
high-level `undo`, kill-ring/region, or minibuffer fidelity available yet;
those remain explicit unavailable boundaries until their Emacs-owned state is
safe across host eval calls.

`tools/scripts/probe-browser-undo-tail-phases.mjs` removes direct `write-region`
from the undo isolation path. It confirms `undo-start` plus one `undo-more`
passes, but a second `undo-more` is already a known wasm blocker. That means
the high-level `undo` failure is not caused by browser-side saving, nor only by
the later `undo-equiv-table` / message / autosave tail; repeated undo
application through `undo-more` is now the first failing phase to isolate.
Named-buffer cases show the same split, so the blocker is broader than
file-visiting buffer state.

The next pass changed that interpretation. Once `wasmacs_eval_string` catches
Lisp signals at the host boundary, the second `undo-more` / high-level `undo`
cases no longer crash wasm; they return safe `EVAL_STATUS:1` readbacks with
`(error user-error No further undo information)`. Adding the command-loop-shaped
post-edit `(undo-boundary)` makes high-level `undo` pass for both file-visiting
and named buffers. The browser worker therefore now records an Emacs
`undo-boundary` after edit commands and routes `C-/` to real Emacs `(undo)`.
`tools/scripts/probe-browser-worker-real-undo.mjs` verifies the worker-shaped
insert/undo/save sequence.
