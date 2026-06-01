# Host Command Entrypoint Plan

The persistent browser profile can now expose reusable JavaScript runtime
hooks, but repeated command-line `Module.callMain` is not a command loop. The
next spike should add a narrow host-command entrypoint to a copied Emacs build
source, leaving `vendor/emacs` read-only.

## Evidence

`scripts/probe-browser-persistent-callmain.mjs` shows:

```text
FIRST_EXIT:0
SECOND_EXIT:1
Back to top level
```

The failure is expected because command-line startup is not a reusable editor
command API. Relevant source paths:

- `vendor/emacs/src/emacs.c`
  - `main` initializes Emacs, sets `Vtop_level`, and enters
    `Frecursive_edit`.
  - `--batch` sets `noninteractive`.
- `vendor/emacs/lisp/startup.el`
  - batch startup calls `kill-emacs` after command-line processing.
- `vendor/emacs/src/keyboard.c`
  - `command_loop` owns the interactive editor loop and kills Emacs at EOF in
    noninteractive mode.
- `vendor/emacs/src/eval.c`
  - `Feval` is the C-side evaluator.
- `vendor/emacs/src/lread.c`
  - reader primitives can parse Lisp forms.
- `vendor/emacs/src/fileio.c`
  - `insert-file-contents` and `write-region` are the file primitive boundary.
- `vendor/emacs/src/editfns.c`
  - point, insert, buffer-string, and movement primitives live here.

## Spike Shape

Do not edit `vendor/emacs` directly. The spike should:

1. Copy or patch only `build/emacs-core-spike/src`.
2. Add a small exported C function, tentatively:

   ```c
   int wasmacs_eval_string (const char *utf8);
   ```

3. Inside the function, convert UTF-8 to an Emacs Lisp string, read/eval one
   form, and return a status code.
4. Export it from Emscripten with `-sEXPORTED_FUNCTIONS=_main,_wasmacs_eval_string`.
5. Keep the JavaScript side responsible for serializing command messages into
   a narrow Lisp form at first.
6. Preserve the current one-shot batch bridge until the entrypoint can do:

   ```text
   open /home/user/notes.txt
   insert text at point
   backspace
   move left/right
   save
   return buffer text and point
   ```

## Initial Lisp Command Form

The first host command can reuse the known-good batch proof shape:

```elisp
(let ((path "/home/user/notes.txt"))
  (find-file path)
  ;; command mutation here
  (save-buffer)
  (list :path path :point (1- (point)) :text (buffer-string)))
```

The current stdout marker protocol can remain during the spike, but the
preferred next step is to return data through a dedicated host buffer or an
exported readback function rather than parsing stdout.

## Risks

- Re-entering the evaluator from JavaScript must happen after Emacs
  initialization and outside a half-unwound `kill-emacs` path.
- Batch startup is not sufficient. The persistent profile likely needs a
  dedicated initialization mode that loads enough Lisp and then waits for host
  commands.
- Error handling must catch Lisp errors and return structured failures instead
  of throwing across the JS/Wasm boundary.
- This may require a small patch experiment in copied Emacs C sources before it
  is clear whether the final entrypoint belongs in `emacs.c`, a new
  `wasmacs.c`, or an Emscripten-specific host module.

## First Patch Experiment

`scripts/patch-emacs-host-entrypoint-spike.sh` patches only:

```text
build/emacs-core-spike/src/src/emacs.c
```

It adds:

```c
int wasmacs_eval_string (const char *utf8);
const char *wasmacs_last_result (void);
```

The persistent browser profile exports it with:

```text
-sEXPORTED_FUNCTIONS=_main,_wasmacs_eval_string,_wasmacs_last_result
-sEXPORTED_RUNTIME_METHODS=callMain,ccall,FS,FS_createPath,FS_createDataFile,FS_readFile
```

`scripts/probe-browser-host-entrypoint.mjs` verifies the shape:

```text
BOOT_EXIT:0
OUT:entrypoint
EVAL_STATUS:0
```

This is a real host entrypoint into the initialized Emacs Lisp evaluator. It is
still a spike:

- It evaluates a string form and returns a numeric status.
- It stores the last evaluated result as a host-readable string.
- It does not yet catch Lisp errors into structured host errors.
- It still uses one `--batch` boot call before invoking the entrypoint.
- It refreshes the C stack-scan bottom for the host entrypoint and inhibits GC
  during each host eval. This is a temporary safety boundary for the wasm
  spike, not the final GC design.

The next step is to use this entrypoint for the existing file/buffer command
form and return path/text/point through a dedicated readback mechanism.

`scripts/probe-browser-host-file-command.mjs` proves the file side of that
path:

```text
BOOT_EXIT:0
EVAL_STATUS:0
FILE_TEXT:alpha beta
```

The probe creates `/home/user/notes.txt` in the persistent Emscripten FS,
boots Emacs once, calls `wasmacs_eval_string` with a form that uses
`insert-file-contents` and `write-region`, and reads the changed file back
through `Module.FS_readFile`.

`scripts/probe-browser-host-readback.mjs` proves the first dedicated readback
shape:

```text
BOOT_EXIT:0
EVAL_STATUS:0
READBACK:{"path":"/home/user/readback.txt","text":"readback text","point":14}
```

The remaining gap is wiring. File mutation and host-readable command results
now work through the host entrypoint, but the browser worker still uses the
known-good one-shot batch bridge.

## GC / Root Safety Finding

`scripts/probe-browser-file-buffer-gc-roots.mjs` narrows the persistent-buffer
blocker. Before GC was inhibited in `wasmacs_eval_string`, even a booted
runtime followed by `(garbage-collect)` crashed in `mark_threads` /
`process_mark_stack`, which means the host eval boundary cannot safely enter
Emacs conservative C-stack marking yet.

After inhibiting GC during host eval, these cases pass:

```text
boot-gc-only
temp-buffer-gc
named-buffer-gc
named-buffer-set-buffer-file-name
named-buffer-set-visited-file-name
named-buffer-insert-file-contents
find-file-kill-before-boundary
```

The cases that still crash are:

```text
find-file-live-buffer-gc
```

Evidence is in `logs/wasm-browser-file-buffer-gc-roots.txt`.

This keeps the browser-side policy unchanged: do not fake undo, kill-ring, or
minibuffer behavior. The next C/Elisp boundary narrowed again:
`scripts/probe-browser-find-file-phases.mjs` shows `find-file-noselect`,
`switch-to-buffer`, `pop-to-buffer-same-window`, live `find-file`, and in-memory
edits survive a second host eval. Direct `write-region` against a live
file-visiting buffer still crashes the next host eval, while `save-buffer`
passes. The browser worker should therefore use the real Emacs `save-buffer`
path for live file buffers, and keep direct `write-region` confined to
temp-buffer or non-live bridge proofs.

The browser worker has been updated accordingly: ordinary edit commands now use
`find-file` plus `save-buffer` on the live user file buffer. Direct
`write-region` remains useful evidence for temp-buffer/non-live probes but is
not the live file-buffer save path.

`scripts/probe-browser-undo-tail-phases.mjs` adds the next undo boundary:
without any direct live-buffer `write-region`, `undo-start` plus one
`undo-more` passes, while a second `undo-more` and high-level `undo` remain
known wasm blockers. Named buffers show the same one-pass/two-pass split, so
the next entrypoint investigation should start at repeated `primitive-undo` /
`undo-more` persistent state rather than browser save behavior or
file-visiting state alone.

The host eval entrypoint now wraps read/eval in `internal_condition_case_1`.
Uncaught Lisp signals are stored in `wasmacs_last_result` and returned as
status 1 instead of becoming wasm traps. With that boundary, the no-more-undo
cases are safe Lisp errors, and high-level `undo` passes when the buffer has a
normal command-loop-shaped post-edit `undo-boundary`.
