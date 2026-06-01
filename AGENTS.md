# AGENTS.md

## Project

`wasmacs` explores a browser-hosted Emacs built from WebAssembly, WASI-like host capabilities, and portable filesystem images.

The project goal is not to make an Emacs-like editor from scratch. The goal is to preserve the real Emacs/Elisp center of gravity by bringing the Emacs C core and its Lisp machine into wasm, then hosting display, input, persistence, and portability in the browser.

## Current Baseline

- GNU Emacs source is available as a submodule at `vendor/emacs`.
- The submodule is pinned to GNU Emacs 30.2.
- The submodule URL currently uses the GitHub mirror because Savannah HTTP clone failed with a 504 during setup.
- Treat `vendor/emacs` as read-only reference material unless the task explicitly asks for patch experiments.

Important reference files:

```text
vendor/emacs/README
vendor/emacs/configure.ac
vendor/emacs/src/emacs.c
vendor/emacs/src/lisp.h
vendor/emacs/src/eval.c
vendor/emacs/src/lread.c
vendor/emacs/src/bytecode.c
vendor/emacs/src/fileio.c
vendor/emacs/src/callproc.c
vendor/emacs/src/process.c
vendor/emacs/src/keyboard.c
vendor/emacs/src/window.c
vendor/emacs/src/xdisp.c
vendor/emacs/lisp/loadup.el
```

## Architecture Decisions

The core architecture is a three-part composition:

```text
emacs-core.wasm
  immutable runtime image
  Emacs C core, Elisp interpreter, bytecode runtime, built-in primitives

system-lisp.wasifs
  read-only release image
  GNU Emacs lisp/ as .el + .elc plus generated autoload/loaddefs artifacts

user-filesystem.wasifs
  writable portable user image
  init.el, .emacs.d, ELPA packages, project files, history, snapshots
```

Use B for the system Lisp image: `.el + .elc + generated autoload/loaddefs`. Do not start with raw `.el` only unless doing a deliberately narrow spike. Do not start with pdumper/dumped state unless the task is specifically about startup performance or dump compatibility.

The default mount model is:

```text
/system    read-only  system-lisp.wasifs
/home/user writable   user-filesystem.wasifs
/tmp       volatile   memory filesystem
```

The default `load-path` order should prefer user overrides:

```text
/home/user/.emacs.d/lisp
/home/user/.emacs.d/elpa/*/
/system/lisp
```

## Design Boundaries

- Keep browser GUI concerns out of `emacs-core.wasm`.
- Keep filesystem host calls separate from GUI protocol calls.
- Treat OPFS/IndexedDB as local persistence backends, not as the portable format itself.
- Treat `.wasifs` images as explicit import/export artifacts.
- Prefer release-pinned artifacts over floating upstream branches.
- Prefer existing Emacs C core over a new Elisp subset engine.

The essential insight: existing Emacs Lisp expects many C primitives, not just an evaluator. `fileio.c`, `keyboard.c`, `window.c`, `xdisp.c`, `callproc.c`, and related modules are part of the Lisp machine that makes the Lisp layer work.

## Host Surface

WASI-style filesystem support is necessary but not sufficient. The minimum host surface should include:

```text
host.fs      path_open, read, write, stat, readdir, rename, unlink, mkdir, sync
host.clock   wall clock, monotonic clock, timers
host.random  random bytes
host.env     environment variables, cwd
host.stdio   stdout, stderr, debug logging
host.gui     input events, frame metrics, redisplay target, clipboard
```

`host.process` should be unavailable or stubbed in the first MVP. Later work may route process-like behavior to browser services, remote workers, or explicit host integrations.

## Working Style

- Read `PLAN.md` first for implementation work.
- Read `ARCHITECTURE.md` before making architecture or runtime changes.
- Work from the `Current Next Step` in `PLAN.md` unless the user explicitly redirects.
- When starting a task, identify the relevant milestone in `PLAN.md`.
- When finishing a task, update the milestone status, deliverables, validation notes, or blockers in `PLAN.md`.
- If a task reveals that the plan is wrong, update `PLAN.md` with the new evidence before continuing.
- Use `rg` for code search.
- Keep changes narrow and document any architectural decision in `ARCHITECTURE.md`.
- Do not modify `vendor/emacs` unless the task is explicitly a patch experiment.
- When investigating feasibility, tie conclusions to concrete Emacs source files and functions.
- Keep generated build artifacts out of the repo until there is an agreed output directory and ignore policy.

## Required Work Loop

Use this loop for every non-trivial implementation or research turn:

```text
1. Read PLAN.md.
2. Read the relevant section of ARCHITECTURE.md.
3. Check the current git status.
4. Execute the next unchecked step for the active milestone.
5. Validate with the command named in PLAN.md, or add a better validation command to PLAN.md.
6. Update PLAN.md with status, evidence, and blockers.
7. Summarize changed files and validation results.
```

Do not skip ahead to browser UI, wasm build scripts, or filesystem implementation until the earlier milestone dependencies are satisfied, unless the user explicitly asks for that spike.

## Early Milestones

1. Confirm a minimal Emacs 30.2 wasm build strategy.
2. Confirm batch-mode Elisp evaluation in wasm.
3. Build a release-pinned `system-lisp.wasifs` from `.el + .elc + generated autoload/loaddefs`.
4. Build a writable `user-filesystem.wasifs` with journal/snapshot semantics.
5. Mount `/system` read-only and `/home/user` writable.
6. Run a browser MVP with one frame, one buffer, basic input, and persistent file edits.

## Non-Goals For MVP

- Full native Emacs compatibility.
- Native subprocess and pty support.
- Full TRAMP support.
- Native-comp support.
- pdumper/dumped image support.
- Transparent mounting of arbitrary host OS directories.
