# Persistent Command Loop Feasibility

Milestone 12 needs a persistent command owner before typing can feel normal.
The current browser bridge is intentionally narrower: one accepted command
starts one Emacs batch worker, applies an operation, syncs the file, and exits.

## Current Artifact Constraints

The current browser profile is built by `scripts/build-emacs-browser-profile-spike.sh`.
Its default linker flags include:

```text
-sEXIT_RUNTIME=1
```

The generated browser glue in `artifacts/emacs-browser-spike/temacs` reflects
that shape:

```text
noExitRuntime = false
callMain(args)
run()
runtimeExited
```

The current worker also imports the generated script directly with
`importScripts("/artifacts/emacs-browser-spike/temacs")`. After `main` exits,
that runtime is not a reusable command host.

## Emacs-Side Constraints

The current worker runs Emacs with:

```text
--batch --eval ...
```

In GNU Emacs 30.2, batch startup is designed to terminate after command-line
processing:

- `vendor/emacs/lisp/startup.el` calls `kill-emacs` when `noninteractive` is
  true.
- `vendor/emacs/src/emacs.c` sets `noninteractive` for `-batch` / `--batch`.
- `vendor/emacs/src/keyboard.c` owns the interactive `command_loop`, but the
  browser profile is not yet wired to a GUI/input event source.

That means the current proof is a real Emacs file/buffer command bridge, not
yet an interactive Emacs command loop.

## Near-Term Path

1. Keep the current one-shot batch bridge for correctness proofs.
2. Pass point through the command/sync/draw protocol so movement and insertion
   are not point-max-only.
3. Use a browser-side queue to prevent input races and coalesce fast printable
   input.
4. Build a new browser profile experiment with a non-exiting runtime and an
   explicit host command entrypoint, instead of pretending the existing batch
   artifact is persistent.

## Validation Evidence

Current proof files:

```text
logs/browser-input-command-smoke.txt
logs/browser-command-queue-smoke.txt
logs/browser-cursor-command-smoke.txt
```

The next persistent-loop spike should have its own artifact directory and must
not replace the known-good batch bridge until it can run at least open, insert,
backspace, move-left, move-right, save, and redraw.
