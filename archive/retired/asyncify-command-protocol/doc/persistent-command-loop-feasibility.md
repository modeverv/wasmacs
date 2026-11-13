# Persistent Command Loop Feasibility

Milestone 12 needs a persistent command owner before typing can feel normal.
The current browser bridge is intentionally narrower: one accepted command
starts one Emacs batch worker, applies an operation, syncs the file, and exits.

## Current Artifact Constraints

The current browser profile is built by `tools/scripts/build-emacs-browser-profile-spike.sh`.
Its default linker flags include:

```text
-sEXIT_RUNTIME=1
```

The generated browser glue in `build/artifacts/emacs-browser-spike/temacs` reflects
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

## Persistent Profile Spike

`tools/scripts/build-emacs-browser-persistent-spike.sh` creates a separate artifact:

```text
build/artifacts/emacs-browser-persistent-spike/
  temacs
  temacs.wasm
  temacs.data
```

It keeps the known-good preload packaging but changes the runtime shape:

```text
-sEXIT_RUNTIME=0
-sEXPORTED_RUNTIME_METHODS=callMain,FS,FS_createPath,FS_createDataFile,FS_readFile
```

`tools/scripts/validate-browser-persistent-spike.sh` verifies:

- the artifact is not `NODERAWFS`
- generated glue has `var noExitRuntime = true`
- `Module['callMain'] = callMain`
- `Module['FS_readFile'] = FS_readFile`
- batch eval can still print `hello persistent-profile`

This proves the next profile can expose reusable runtime hooks. It does not
yet prove that Emacs editor state survives host commands, because `--batch`
still exits through Emacs startup. The next spike needs either a host command
entrypoint or an Emacs invocation that enters a browser-owned command loop
instead of `--batch` termination.

`tools/scripts/probe-browser-persistent-callmain.mjs` confirms that repeated
command-line `callMain` is not the command loop:

```text
FIRST_EXIT:0
SECOND_EXIT:1
Back to top level
```

The first `callMain(["--batch", ...])` succeeds. The second enters Emacs
top-level recovery and exits with status 1. This is useful evidence: the
persistent profile is a necessary runtime shape, but repeated batch main calls
are not sufficient. The next implementation path should expose a host command
entrypoint inside the initialized runtime or enter a browser-owned Emacs
command loop, rather than repeatedly invoking command-line startup.

The first host entrypoint spike now exists. See
`doc/host-command-entrypoint-plan.md` and
`tools/scripts/probe-browser-host-entrypoint.mjs`. The proof sequence is:

```text
callMain(["--batch", "--eval", ...]) -> BOOT_EXIT:0
ccall("wasmacs_eval_string", ...)    -> EVAL_STATUS:0
```

This proves host-initiated eval can run after the initial boot without
repeating command-line startup.

`tools/scripts/probe-browser-host-file-command.mjs` extends that proof to Emacs file
primitives:

```text
FILE_TEXT:alpha beta
```

That command runs through `wasmacs_eval_string`, uses Emacs
`insert-file-contents` and `write-region`, and is read back through
`Module.FS_readFile`.

`tools/scripts/probe-browser-host-readback.mjs` adds the first host-readable result
channel. The persistent profile now exports `_wasmacs_last_result`; after
`wasmacs_eval_string` evaluates a form, JavaScript can call
`ccall("wasmacs_last_result", "string", [], [])` and receive a structured
payload:

```text
READBACK:{"path":"/home/user/readback.txt","text":"readback text","point":14}
```

## Validation Evidence

Current proof files:

```text
logs/browser-input-command-smoke.txt
logs/browser-command-queue-smoke.txt
logs/browser-cursor-command-smoke.txt
logs/wasm-browser-persistent-batch.txt
logs/wasm-browser-persistent-callmain.txt
logs/wasm-browser-host-entrypoint.txt
logs/wasm-browser-host-file-command.txt
logs/wasm-browser-host-readback.txt
```

The browser worker now uses this persistent entrypoint and readback channel.
It imports `build/artifacts/emacs-browser-persistent-spike/temacs`, boots once with
`Module.callMain`, then handles queued browser commands through
`wasmacs_eval_string`. Browser smoke evidence is in
`logs/browser-persistent-worker-smoke.txt`.

The remaining persistent-loop work is broader editing coverage: open/reload
more files, explicit save behavior, backspace/movement regression smoke, and
clear errors for unavailable process/pty surfaces.
