# PLAN.md

## Purpose

This plan turns the `wasmacs` architecture into implementation milestones that an LLM agent can follow without re-deciding the project from scratch.

Always read this file before implementation work. Update it when a milestone is completed, blocked, split, or invalidated by evidence from `vendor/emacs`.

## Ground Rules

- Follow `ARCHITECTURE.md`: the project is a three-part composition of `emacs-core.wasm`, `system-lisp.wasifs`, and `user-filesystem.wasifs`.
- GNU Emacs is pinned at 30.2 under `vendor/emacs`.
- Treat `vendor/emacs` as read-only unless a task explicitly asks for an experiment patch.
- Prefer the real Emacs C core over a new Elisp subset engine.
- Use B for system Lisp: `.el + .elc + generated autoload/loaddefs`.
- Do not start with native-comp or pdumper.
- Record concrete findings with exact source paths and commands.

## Status Legend

```text
[ ] not started
[/] in progress
[x] complete
[!] blocked
```

## Milestone 0: Repo Control Plane

Goal: make the repo self-guiding before code appears.

Status:

- [x] Create `ARCHITECTURE.md`.
- [x] Add GNU Emacs source as `vendor/emacs`.
- [x] Pin `vendor/emacs` to Emacs 30.2.
- [x] Create `AGENTS.md`.
- [x] Create this `PLAN.md`.
- [x] Add `.gitignore` once generated artifact directories are chosen.
- [x] Add `LOG.md` when the first implementation or build experiment starts.

Validation:

```sh
git submodule status --recursive
git -C vendor/emacs describe --tags --exact-match HEAD
```

Expected:

```text
vendor/emacs is at emacs-30.2
```

## Milestone 1: Emacs 30.2 Source Inventory

Goal: identify the minimum Emacs C/Lisp surfaces needed for a wasm/browser MVP.

Status: [x] complete

Deliverable:

```text
docs/emacs-30.2-source-inventory.md
```

Steps:

1. Read `vendor/emacs/README` and confirm the `src` vs `lisp` split.
2. Inventory startup and dump flow:
   - `vendor/emacs/src/emacs.c`
   - `vendor/emacs/lisp/loadup.el`
   - `vendor/emacs/src/pdumper.c`
3. Inventory Elisp evaluator and loader:
   - `vendor/emacs/src/eval.c`
   - `vendor/emacs/src/lread.c`
   - `vendor/emacs/src/bytecode.c`
   - `vendor/emacs/src/fns.c`
4. Inventory file primitives:
   - `vendor/emacs/src/fileio.c`
   - `vendor/emacs/src/coding.c`
5. Inventory input and command loop:
   - `vendor/emacs/src/keyboard.c`
   - `vendor/emacs/src/callint.c`
6. Inventory frame/window/redisplay:
   - `vendor/emacs/src/frame.c`
   - `vendor/emacs/src/window.c`
   - `vendor/emacs/src/xdisp.c`
   - `vendor/emacs/src/dispnew.c`
7. Inventory process surfaces to stub or defer:
   - `vendor/emacs/src/process.c`
   - `vendor/emacs/src/callproc.c`
8. Write a table with columns:
   - area
   - source files
   - required for MVP
   - wasm/browser risk
   - proposed first treatment

Validation:

```sh
rg -n "DEFUN|defsubr|syms_of_" vendor/emacs/src/{eval,lread,bytecode,fileio,keyboard,window,xdisp,callproc,process}.c
scripts/validate-source-inventory.sh
```

Exit criteria:

- The inventory names the initial MVP-required C modules.
- The inventory explicitly separates required, stubbed, and deferred surfaces.
- Any conclusion is grounded in source paths.

Validation notes:

- 2026-06-01: `docs/emacs-30.2-source-inventory.md` added with a required /
  stubbed / deferred MVP table.
- 2026-06-01: `scripts/validate-source-inventory.sh` wraps the milestone
  source search and asserts the inventory names all relevant Emacs source
  files and treatment categories.
- 2026-06-01: validation passed with `scripts/validate-source-inventory.sh`.

## Milestone 2: Build Strategy Spike

Goal: choose the first practical build path for `emacs-core.wasm`.

Status: [x] complete

Deliverable:

```text
docs/build-strategy.md
```

Steps:

1. Inspect Emacs configure options relevant to a terminal-less build:
   - `--without-x`
   - `--without-ns`
   - `--without-pgtk`
   - `--without-sound`
   - `--without-dbus`
   - `--without-gsettings`
   - `--without-native-compilation`
2. Compare two build routes:
   - Emscripten-first browser route.
   - WASI SDK / wasi-libc route.
3. Decide the first route by these criteria:
   - gets a wasm artifact fastest
   - can run in browser or worker
   - can expose a filesystem adapter
   - minimizes early Emacs source patches
4. Identify expected compile blockers:
   - signals
   - subprocesses
   - pty
   - sockets
   - termios
   - mmap
   - setjmp/longjmp assumptions
   - dumping/pdump
5. Create a scratch command file only after the route is chosen:
   - `scripts/build-emacs-core-spike.sh`

Validation:

```sh
test -f docs/build-strategy.md
test -f scripts/build-emacs-core-spike.sh
scripts/validate-build-strategy.sh
```

Exit criteria:

- One route is selected as the first implementation route.
- The alternative route is documented, not forgotten.
- The build script is clearly marked as a spike and does not write into `vendor/emacs` except through an ignored build directory.

Validation notes:

- 2026-06-01: selected Emscripten-first as the first implementation route.
- 2026-06-01: documented WASI SDK / wasi-libc as the alternative route.
- 2026-06-01: `scripts/build-emacs-core-spike.sh` copies the pinned Emacs
  source into `build/emacs-core-spike/src` before running Autogen/configure, so
  generated files stay out of `vendor/emacs`.
- 2026-06-01: validation passed with `scripts/validate-build-strategy.sh`.

## Milestone 3: Native Baseline Before Wasm

Goal: establish a known-good Emacs 30.2 baseline before cross-compilation.

Status: [x] complete

Deliverables:

```text
build/native-emacs-30.2/
logs/native-baseline.txt
```

Steps:

1. Configure a local native build in `build/native-emacs-30.2`.
2. Disable nonessential features where possible to mirror the wasm target.
3. Build enough to run batch mode.
4. Run simple batch Elisp:
   - `(message "hello wasmacs")`
   - `(princ emacs-version)`
   - `(byte-code-function-p (symbol-function 'byte-code))` if applicable
5. Record exact configure flags, build command, and output in `logs/native-baseline.txt`.

Validation:

```sh
build/native-emacs-30.2/src/src/emacs --batch --eval '(princ emacs-version)'
scripts/validate-native-baseline.sh
```

Exit criteria:

- Native batch mode works.
- The baseline command and output are logged.
- Any feature disabled for native baseline is listed.

Validation notes:

- 2026-06-01: `scripts/build-native-baseline.sh` builds from an ignored copy
  at `build/native-emacs-30.2/src`, leaving `vendor/emacs` untouched.
- 2026-06-01: the first out-of-tree attempt failed during Lisp generation with
  missing `build/lisp/lisp` paths and `debug-early--handler` errors, so the
  baseline now uses an in-tree build inside the copied source.
- 2026-06-01: native baseline configured with GUI, sound, D-Bus, GSettings,
  native compilation, pdumper, and unexec disabled; dumping strategy is `none`.
- 2026-06-01: `logs/native-baseline.txt` records the configure flags, build
  command, source commit/tag, and batch-mode output.
- 2026-06-01: validation passed with `scripts/validate-native-baseline.sh`;
  batch mode printed Emacs version `30.2`.

## Milestone 4: System Lisp Image Builder

Goal: create the first `system-lisp.wasifs` release image using B: `.el + .elc + generated autoload/loaddefs`.

Status: [x] complete

Deliverables:

```text
scripts/build-system-lisp-image.sh
tools/wasifs/
artifacts/system-lisp-emacs-30.2.wasifs
artifacts/system-lisp-emacs-30.2.manifest.json
```

Steps:

1. Define the initial `.wasifs` container format for the spike.
   - Prefer tar-compatible contents first.
   - Use compression only if the toolchain is already available.
2. Decide exactly what to copy from the Emacs build/source tree:
   - `lisp/**/*.el`
   - generated `.elc`
   - generated autoload/loaddefs files
   - minimal `etc/` files required by Lisp help/doc lookup
3. Define image manifest fields:
   - schema version
   - Emacs version
   - source commit
   - created timestamp
   - root prefix `/system`
   - file count
   - content hash
4. Build the image into `artifacts/`.
5. Add an inspect command for the image.

Validation:

```sh
tar tf artifacts/system-lisp-emacs-30.2.wasifs | rg '^system/lisp/.+\\.elc?$'
test -f artifacts/system-lisp-emacs-30.2.manifest.json
scripts/validate-system-lisp-image.sh
```

Exit criteria:

- The image contains both `.el` and `.elc`.
- The manifest records Emacs 30.2 and commit `636f166cfc86aa90d63f592fd99f3fdd9ef95ebd`.
- The image can be listed without custom runtime code.

Validation notes:

- 2026-06-01: `.wasifs` is a tar-compatible spike container rooted at
  `system/`, intended to mount read-only at `/system`.
- 2026-06-01: `scripts/build-system-lisp-image.sh` builds
  `artifacts/system-lisp-emacs-30.2.wasifs` and
  `artifacts/system-lisp-emacs-30.2.manifest.json` from the native baseline
  tree.
- 2026-06-01: manifest fields include schema version, kind, tar format, Emacs
  version, source commit/tag, created timestamp, root prefix, read-only mount
  metadata, file counts, and sha256 content hash.
- 2026-06-01: current image contains 1651 `.el` files, 142 `.elc` files, 20
  generated `*loaddefs.el` files, and selected `etc/` support files.
- 2026-06-01: validation passed with `scripts/validate-system-lisp-image.sh`;
  image hash is
  `ecb842aedd96a73b71eed63305d739c4a9b6c07b43d35fa79ddb89221c673ae9`.
- 2026-06-01: a full `make lisp` attempt under `--with-dumping=none` proved
  too slow for this milestone because each byte-compile reloads `loadup.el`;
  full byte-compilation is deferred to a later release/performance pass.

## Milestone 5: User Filesystem Image Builder

Goal: create a writable user image format with a simple journal/snapshot story.

Status: [x] complete

Deliverables:

```text
scripts/create-user-filesystem-image.sh
artifacts/user-filesystem-empty.wasifs
artifacts/user-filesystem-empty.manifest.json
docs/wasifs-format.md
```

Steps:

1. Define the initial user image tree:
   - `/home/user/init.el`
   - `/home/user/.emacs.d/`
   - `/home/user/projects/`
   - `/home/user/.local/share/wasmacs/`
2. Define journal files:
   - location inside image or next to image
   - append format
   - snapshot generation
3. Create an empty image builder.
4. Create an image inspector.
5. Document import/export rules in `docs/wasifs-format.md`.

Validation:

```sh
tar tf artifacts/user-filesystem-empty.wasifs | rg '^home/user/'
test -f docs/wasifs-format.md
scripts/validate-user-filesystem-image.sh
```

Exit criteria:

- The empty user image can be created and inspected.
- The format doc explains which parts are stable and which are spike-only.

Validation notes:

- 2026-06-01: `docs/wasifs-format.md` documents tar-compatible spike images,
  sidecar manifests, stable vs spike-only rules, empty journal semantics, and
  reserved snapshot location.
- 2026-06-01: `scripts/create-user-filesystem-image.sh` builds
  `artifacts/user-filesystem-empty.wasifs` and
  `artifacts/user-filesystem-empty.manifest.json`.
- 2026-06-01: initial image contains `/home/user/init.el`,
  `/home/user/.emacs.d/lisp`, `/home/user/.emacs.d/elpa`,
  `/home/user/projects`, an empty journal at
  `/home/user/.local/share/wasmacs/journal.jsonl`, and a reserved snapshots
  directory.
- 2026-06-01: validation passed with
  `scripts/validate-user-filesystem-image.sh`; image hash is
  `d564ab223a470c4beda0c39763a4f726ce8e51cbd89796f13903d722b8e7f055`.

## Milestone 6: Host ABI Draft

Goal: define the boundary between `emacs-core.wasm` and the browser/runtime host before implementing browser UI.

Status: [x] complete

Deliverables:

```text
docs/host-abi.md
wit/host-abi.wit
```

Steps:

1. Draft filesystem calls:
   - open
   - read
   - write
   - stat
   - readdir
   - rename
   - unlink
   - mkdir
   - sync
2. Draft non-filesystem calls:
   - clock
   - monotonic clock
   - random
   - environment
   - stdio/log
3. Draft GUI protocol separately:
   - input event messages
   - frame metrics
   - redisplay/draw messages
   - clipboard messages
4. Mark `process` as unavailable by default.
5. Add a compatibility note for Emscripten if the first build path cannot consume WIT directly.

Validation:

```sh
test -f docs/host-abi.md
test -f wit/host-abi.wit
scripts/validate-host-abi.sh
```

Exit criteria:

- Filesystem and GUI protocols are separate.
- The ABI names the exact first MVP calls.
- There is no hidden dependency on browser DOM inside `emacs-core.wasm`.

Validation notes:

- 2026-06-01: `docs/host-abi.md` defines separate `wasmacs:host/*` and
  `wasmacs:gui/*` surfaces and states that `emacs-core.wasm` must not call DOM,
  OPFS, IndexedDB, Clipboard API, Canvas, or File System Access API directly.
- 2026-06-01: `wit/host-abi.wit` defines filesystem, clock, random,
  environment, stdio, process, and GUI interfaces in `world emacs-core-host`.
- 2026-06-01: `host.process` is explicitly unavailable by default; process-like
  behavior must cross a later deliberate service boundary.
- 2026-06-01: Emscripten compatibility is documented as an adapter layer over
  the WIT contract, not a replacement for the boundary.
- 2026-06-01: validation passed with `scripts/validate-host-abi.sh`.

## Milestone 7: Wasm Batch Evaluation Spike

Goal: prove that some form of `emacs-core.wasm` can evaluate Elisp in batch mode.

Status: [x] complete

Deliverables:

```text
artifacts/emacs-core-spike.wasm
logs/wasm-batch-eval.txt
```

Steps:

1. Run the build spike selected in Milestone 2.
2. Keep all build output outside `vendor/emacs`.
3. Disable or stub subprocess, pty, and native GUI surfaces as narrowly as possible.
4. Run a minimal wasm invocation in Node, Wasmtime, or browser worker.
5. Evaluate:
   - `(princ "hello wasmacs")`
   - `(princ (+ 1 2 3))`
   - `(load "/system/lisp/subr.el" nil t)` if filesystem is ready
6. Record failures exactly.

Validation:

```sh
test -f artifacts/emacs-core-spike.wasm
test -f logs/wasm-batch-eval.txt
scripts/validate-wasm-batch-eval.sh
```

Exit criteria:

- Either batch Elisp evaluation works, or the blocker is reduced to one or more exact source files/functions.
- The result is logged with commands and output.

Validation notes:

- 2026-06-01: Emscripten 5.0.7 was installed with Homebrew; `emconfigure`,
  `emmake`, and `emcc` are now available.
- 2026-06-01: upstream Emacs configure rejects
  `wasm32-unknown-emscripten`, so the spike currently uses
  `wasm32-unknown-linux-gnu` as a configure fallback to reach the next
  blockers.
- 2026-06-01: the spike requires native build helpers for `make-docfile` and
  `make-fingerprint`; target wasm/JS helpers cannot be run directly by the
  build host.
- 2026-06-01: the spike also requires temporary feature corrections for this
  configure fallback: internal termcap object, no external ncurses link, no
  Linux `sysinfo`, no pthread signal forwarding, no `malloc_trim`, wide Emacs
  integers, and `NODERAWFS` for Node smoke runs.
- 2026-06-01: `scripts/build-emacs-core-spike.sh` now reproduces a
  `temacs.wasm` build; copied output is
  `artifacts/emacs-core-spike.wasm`.
- 2026-06-01: Node can start `temacs` and read source-tree `lisp/` via
  `NODERAWFS`, but batch loadup does not complete. Current blocker:
  `invalid-function ("")`, `Wrong type argument: listp, 11185520` while loading
  `loadup.el` / `subr.el`.
- 2026-06-01: running bare `temacs -nl --batch --eval ...` reaches primitive
  startup but fails with `Symbol's function definition is void:
  internal-timer-start-idle`, confirming standard Lisp loadup is still needed.
- 2026-06-01: narrowed the loadup failure with a custom `loadup.el`. Full
  `subr.el` loads successfully when the standard pre-`subr.el` load-path
  message is omitted, but `(message "Using load-path %s" load-path)` and
  similar long-list `%s` / `%S` messages reproduce the later
  `invalid-function ("")` failure while loading `subr.el`.
- 2026-06-01: source-level blocker candidates are now
  `vendor/emacs/src/editfns.c` (`Fmessage`, `Fformat_message`,
  `styled_format`) and `vendor/emacs/src/print.c` (`Fprin1_to_string`,
  `print_object`). Evidence is recorded in
  `logs/wasm-debug-format-loadup.txt`.
- 2026-06-01: `gc-cons-threshold` / explicit `garbage-collect` tests show the
  failure is GC-sensitive: raising `gc-cons-threshold` lets the focused
  `format` case pass, while `(garbage-collect)` after the format reproduces
  the failure. Under that condition, `subr.el` prefix 5697 passes and 5717
  fails at `combine-and-quote-strings`, a `mapconcat` / `lambda` closure form.
- 2026-06-01: added `scripts/debug-wasm-format-gc.sh` to reproduce the focused
  GC-sensitive failure and the 5697/5717 `subr.el` prefix split.
- 2026-06-01: negative copied-tree experiments ruled out three narrower
  causes: `print_object`'s local `stack_top` update, stack-allocated temporary
  Lisp objects via `USE_STACK_LISP_OBJECTS`, and GC only inside
  `Fmake_interpreted_closure`.
- 2026-06-01: instrumentation of `maybe_garbage_collect` shows automatic GC
  fires during `subr.el` loading immediately before the focused
  `invalid-function ("")` failure. Raising `gc-cons-threshold` after an
  explicit GC and before loading `subr.el` lets the focused case pass.
- 2026-06-01: with `-sINITIAL_MEMORY=1024MB`, higher thresholds move the
  failure later: 16MB reaches `cl-preloaded.el` and then fails in
  `mem_insert -> allocate_vectorlike -> Fvector -> Fmake_interpreted_closure`;
  64MB reaches `files.el` and fails with eager macro-expansion
  `(invalid-function "")`.
- 2026-06-01: Emscripten stack-boundary marking and `GC_SETJMP_WORKS` /
  `__builtin_unwind_init` toggles did not fix the focused failure. Rebuilding
  the copied spike tree with `CFLAGS=-g3 -O0` did: `scripts/debug-wasm-format-gc.sh`
  now passes all focused cases, including the `subr.el` 5717 prefix.
- 2026-06-01: `scripts/build-emacs-core-spike.sh` now defaults the wasm spike
  profile to `EMACS_WASM_CFLAGS="-g3 -O0"` and copies `temacs.wasm` / JS glue
  into `artifacts/emacs-core-spike.*`.
- 2026-06-01: clean `-O0` standard loadup gets past the original `subr.el`
  blocker and reaches `files.el`, then fails with wasm
  `memory access out of bounds` in `styled_format -> Fformat -> eval_sub`.
- 2026-06-01: raising the Emscripten stack to 1MB changes the next failure from
  `styled_format` memory access to an initial wasm heap OOM around
  `international/characters.el`, confirming the `files.el` blocker was stack
  budget, not an `easy-mmode.el` source-form failure.
- 2026-06-01: the current reproducible wasm batch profile is
  `CFLAGS=-g3 -O0` plus `-sSTACK_SIZE=1048576`,
  `-sSTACK_OVERFLOW_CHECK=2`, `-sINITIAL_MEMORY=268435456`, and
  `-sALLOW_MEMORY_GROWTH=1`.
- 2026-06-01: standard `loadup.el` now completes far enough for Node wasm
  `temacs --batch --eval` to print both `hello wasmacs` and `6`; evidence is
  recorded in `logs/wasm-batch-eval.txt`.
- 2026-06-01: validation passed with `scripts/validate-wasm-batch-eval.sh`.

## Milestone 8: Runtime Host Prototype

Goal: mount `system-lisp.wasifs` and `user-filesystem.wasifs` into a minimal JS/TS runtime host.

Status: [x] complete

Deliverables:

```text
runtime/
runtime/fs/
runtime/host/
tests/runtime/
```

Steps:

1. Create a minimal package skeleton only when implementation starts.
2. Implement `.wasifs` read-only mount for `/system`.
3. Implement writable in-memory mount for `/home/user`.
4. Add import/export from writable mount to `user-filesystem.wasifs`.
5. Implement clock/random/env/stdio host shims.
6. Keep GUI out of this milestone.

Validation:

```sh
npm test
```

or, if not using Node:

```sh
make test-runtime
```

Exit criteria:

- `/system` rejects writes.
- `/home/user` accepts writes.
- Export/import roundtrip preserves user files.
- Tests cover read, write, stat, readdir, rename, unlink, and sync.

Validation notes:

- 2026-06-01: added a dependency-free Node runtime skeleton with `package.json`
  and `npm test`.
- 2026-06-01: `runtime/fs/tar.js` parses and writes the tar-compatible
  `.wasifs` spike format.
- 2026-06-01: `runtime/fs/wasifs.js` mounts `/system` read-only from
  `system-lisp.wasifs`, mounts `/home/user` writable from
  `user-filesystem.wasifs`, and supports `stat`, `readdir`, `readFile`,
  `writeFile`, `mkdir`, `rename`, `unlink`, `sync`, and user-image export.
- 2026-06-01: `runtime/host/core-host.js` implements non-GUI clock, random,
  env, stdio/log, and explicit process-unavailable shims.
- 2026-06-01: tests cover read-only system writes, writable user files,
  read/write/stat/readdir/rename/unlink/sync, export/import roundtrip, and
  non-GUI host shims.
- 2026-06-01: validation passed with `npm test`; evidence in
  `logs/runtime-host.txt`.

## Milestone 9: Browser Single-Buffer MVP

Goal: run the core in a browser worker with a minimal single-buffer UI.

Status: [/] in progress

Deliverables:

```text
app/
app/index.html
app/src/
tests/e2e/
artifacts/emacs-browser-spike/
```

Steps:

1. Start with one frame and one buffer.
2. Send keyboard input from browser to core.
3. Receive redraw or text state from core.
4. Display text with a simple renderer.
5. Persist edits to `/home/user`.
6. Reload the browser and verify the file remains.
7. Keep IME support visible in the design, but do not require full IME fidelity for the first pass.

Validation:

```sh
scripts/build-emacs-browser-profile-spike.sh
scripts/validate-browser-profile-spike.sh
npm run dev
npm test
```

Use the in-app Browser or Playwright to verify:

- page loads
- editor is visible
- typing changes buffer state
- reload preserves a file

Exit criteria:

- A user can edit one file in the browser.
- The edit persists through reload.
- The core/runtime boundary still matches `docs/host-abi.md`.

Validation notes:

- 2026-06-01: added `docs/browser-mvp-plan.md` to keep the browser MVP tied to
  the real Emacs wasm artifact instead of a replacement editor core.
- 2026-06-01: added `scripts/validate-browser-mvp-readiness.sh`. It records
  that the Milestone 7 artifact is intentionally Node-only because it links
  `NODERAWFS`, and that Milestone 9 needs a browser packaging profile without
  `NODERAWFS` before direct worker execution.
- 2026-06-01: `npm test` now includes the browser readiness check.
- 2026-06-01: added `scripts/build-emacs-browser-profile-spike.sh`, which
  creates `artifacts/emacs-browser-spike/{temacs,temacs.wasm,temacs.data}`
  without `NODERAWFS` by preloading Emacs `lisp/` and `etc/` into
  `/usr/local/share/emacs/30.2/`.
- 2026-06-01: added `scripts/validate-browser-profile-spike.sh`; the packaged
  non-`NODERAWFS` artifact runs under Node and prints `hello browser-profile`,
  proving the next browser-shaped packaging step before direct worker wiring.
- 2026-06-01: because the browser profile relinks the shared copied build tree,
  re-run `scripts/build-emacs-core-spike.sh` when the Node/NODERAWFS profile is
  needed for Milestone 7 debug helpers.

## Milestone 10: Emacs Fidelity Expansion

Goal: move from proof-of-life to recognizable Emacs behavior.

Initial order:

1. Minibuffer.
2. Mode line.
3. Multiple windows.
4. Basic command dispatch.
5. Basic package loading from `/home/user/.emacs.d/elpa`.
6. Clipboard.
7. IME composition.
8. Overlay/text properties.
9. Process substitutes for grep/compile/LSP.

Each feature must have:

- a small design note
- source references into `vendor/emacs`
- tests or a repeatable smoke path
- an update to this plan if scope changes

## Current Next Step

Start Milestone 9: Browser Single-Buffer MVP. Milestone 7 now has a usable
Node wasm batch proof: the default spike build profile produces
`artifacts/emacs-core-spike.wasm`, and `temacs --batch --eval` prints both
`hello wasmacs` and `6` after standard `loadup.el`.

Start from the existing runtime host prototype and these evidence files:

```sh
logs/wasm-batch-eval.txt
logs/wasm-browser-profile-batch.txt
logs/runtime-host.txt
docs/host-abi.md
```

Do not treat the browser MVP as a new Emacs-like editor. Keep the UI as a host
surface around the real Emacs wasm artifact and the existing runtime host
boundary. The next step is direct worker loading of
`artifacts/emacs-browser-spike/temacs` with `temacs.wasm` and `temacs.data`
served from `app/`, then wiring the smallest single-buffer host UI only after
that worker proof is alive.
