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

Status: [x] complete

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
- 2026-06-01: added `app/` and `scripts/serve-app.mjs`. The app starts a
  classic Web Worker, imports the non-`NODERAWFS` browser profile, and runs
  `--batch --eval '(princ "hello browser-worker")'`.
- 2026-06-01: in-app Browser smoke passed at `http://127.0.0.1:5174/`: status
  reached `emacs core exited cleanly`, and the worker output contained
  `hello browser-worker`. Evidence is in `logs/browser-worker-smoke.txt`.
- 2026-06-01: added `scripts/validate-browser-worker-app.sh`; `npm test` now
  includes static checks for the worker app wiring and dev server MIME handling.
- 2026-06-01: added the first single-buffer host UI. It edits
  `/home/user/notes.txt` through a temporary browser host filesystem adapter
  backed by `localStorage`, tracks modified/saved state, and keeps the Emacs
  wasm worker proof visible beside the buffer.
- 2026-06-01: in-app Browser single-buffer smoke passed at
  `http://127.0.0.1:5175/`: typed text into the buffer, clicked Save, reloaded,
  confirmed the edited text persisted, and confirmed the worker output still
  contained `hello browser-worker`. Evidence is in
  `logs/browser-single-buffer-smoke.txt`.

## Milestone 10: Portable Browser User Filesystem

Goal: replace the single-buffer `localStorage` shim with a browser-side
portable `user-filesystem.wasifs` import/export path.

Status: [x] complete

Deliverables:

```text
app/src/browser-wasifs.js
tests/runtime/browser-wasifs.test.js
```

Steps:

1. Load `artifacts/user-filesystem-empty.wasifs` in the browser app.
2. Parse the tar-compatible user image without Node-only `Buffer` APIs.
3. Store edits as `/home/user/notes.txt` in the user image tree.
4. Persist the exported user image in browser storage as a portable binary
   payload, not as an ad hoc path/value object.
5. Add import/export buttons or debug hooks for downloading and restoring a
   `.wasifs` file.

Validation:

```sh
npm test
```

Use the in-app Browser or Playwright to verify:

- first load creates `/home/user/notes.txt`
- save updates the exported image
- page reload restores from the exported image
- exported image can be parsed by the repo tar/wasifs tooling

Exit criteria:

- Browser persistence uses the same tar-compatible user image semantics as the
  runtime host prototype.
- The temporary key/value `localStorage` shim is gone or explicitly limited to
  storing a serialized `.wasifs` payload.

Validation notes:

- 2026-06-01: added `app/src/browser-wasifs.js`, a browser-compatible
  tar-compatible user image parser/writer that avoids Node-only `Buffer` APIs.
- 2026-06-01: the browser single-buffer UI now loads
  `artifacts/user-filesystem-empty.wasifs`, writes `/home/user/notes.txt` into
  a `BrowserUserImage`, and stores a base64 serialized `.wasifs` payload in
  `localStorage` under `wasmacs:user-filesystem.wasifs:v1`.
- 2026-06-01: added Export and Import controls for `user-filesystem.wasifs`.
- 2026-06-01: added `tests/runtime/browser-wasifs.test.js`; it verifies import
  from the generated empty user image, tar-compatible export of
  `/home/user/notes.txt`, and base64 storage roundtrip.
- 2026-06-01: validation passed with `npm test`.

## Milestone 11: Emacs-Owned File/Buffer Bridge

Goal: move from a host-owned textarea buffer to file and buffer operations that
round-trip through the Emacs wasm core.

Status: [x] complete

Steps:

1. Start the browser core with a script that can read and write a known file.
2. Confirm Emacs `fileio.c` paths see the browser-mounted `/home/user` image.
3. Add a small command protocol for:
   - open `/home/user/notes.txt`
   - insert/replace text
   - save buffer
   - read buffer text for display
4. Keep process and pty unavailable.

Exit criteria:

- The text shown in the single-buffer UI is obtained from Emacs or synchronized
  through an explicit Emacs command bridge, not only a host-side textarea.
- Saving calls into the same boundary that Emacs file primitives use.

Validation notes:

- 2026-06-01: Node smoke with `artifacts/emacs-browser-spike/temacs` confirmed
  Emacs can create `/home/user/notes.txt` with `with-temp-file` and read it
  back with `insert-file-contents`; evidence is in
  `logs/emacs-file-bridge-node.txt`.
- 2026-06-01: browser worker smoke confirmed the same Emacs file primitive
  path in the browser-hosted wasm core; evidence is in
  `logs/emacs-file-bridge-browser.txt`.
- 2026-06-01: added `scripts/validate-emacs-file-bridge-spike.sh` and included
  it in `npm test`.
- 2026-06-01: current blocker for completing this milestone is synchronization:
  the Emacs worker Emscripten filesystem and the browser `.wasifs` user image
  are both present, but not yet the same mounted filesystem.
- 2026-06-01: browser smoke materialized the browser `.wasifs` user image into
  the Emacs worker Emscripten filesystem via `Module.preRun`, then Emacs read
  `/home/user/notes.txt` with `insert-file-contents` and printed the same text
  shown in the UI. Evidence is in `logs/emacs-mounted-user-image-browser.txt`.
- 2026-06-01: remaining bridge work is reverse synchronization: exporting
  Emacs-side changes under `/home/user` back into the browser `.wasifs` user
  image after save/read operations.
- 2026-06-01: browser reverse-sync smoke passed at `http://127.0.0.1:5180/`.
  Emacs read `/home/user/notes.txt`, appended `Saved by Emacs core.`, wrote it
  back with `write-region`, emitted a temporary `WASMACS_SYNC_*` marker, and
  the main thread updated the `BrowserUserImage`, persisted the serialized
  user image, and refreshed the visible textarea to `synced from emacs`.
  Evidence is in `logs/emacs-reverse-sync-browser.txt`.
- 2026-06-01: validation passed with `npm test`.

## Milestone 12: Redisplay And Input MVP

Goal: make the browser UI behave like a minimal Emacs frame rather than a
generic textarea.

Status: [/] in progress

Steps:

1. Define a first text-grid draw message from core/adapter to browser.
2. Route keyboard input to Emacs command handling where possible.
3. Render cursor, point, basic selection/mark state, and mode line.
4. Add basic minibuffer/echo area plumbing.
5. Keep IME composition visible in the design, even if full fidelity is later.

Exit criteria:

- Typing and simple commands update a rendered Emacs buffer view.
- The browser is a GUI host; editor state remains in the Emacs side or an
  explicit transition adapter.

Validation notes:

- 2026-06-01: added `app/src/redisplay-protocol.js` with a first
  `text-grid-draw` v1 message and validator.
- 2026-06-01: added `tests/runtime/redisplay-protocol.test.js`; it verifies
  row wrapping, empty-line preservation, point location, and invalid column
  rejection.
- 2026-06-01: the browser app now renders Emacs-synchronized
  `/home/user/notes.txt` into `#frame-grid` with a mode line and cursor while
  keeping the textarea as a temporary input surface.
- 2026-06-01: browser smoke at `http://127.0.0.1:5180/` confirmed
  `emacs core exited cleanly`, `synced from emacs`, one `.frame-cursor`, and a
  `/home/user/notes.txt` mode line. Evidence is in
  `logs/browser-text-grid-smoke.txt`.
- 2026-06-01: validation passed with `npm test`.
- 2026-06-01: added `app/src/input-protocol.js` with the first explicit
  key-to-command bridge for printable insert, Enter, and Backspace; modified
  keys and IME composition are ignored for now.
- 2026-06-01: added `tests/runtime/input-protocol.test.js`; it verifies
  command conversion and `/home/user` scoping.
- 2026-06-01: the browser app now routes `#frame-grid` keydown events through
  `run-buffer-command`. Each command launches a one-shot Emacs worker, applies
  `insert` or `delete-char -1` to `/home/user/notes.txt`, writes with
  `write-region`, reverse-syncs the file, and refreshes `text-grid-draw`.
- 2026-06-01: browser smoke at `http://127.0.0.1:5181/` confirmed pressing `Z`
  inserts through the Emacs command bridge and Backspace removes it through the
  same bridge. Evidence is in `logs/browser-input-command-smoke.txt` and
  `logs/browser-input-command-smoke.png`.
- 2026-06-01: validation passed with `npm test`.
- 2026-06-01: added `app/src/command-queue.js` and
  `tests/runtime/command-queue.test.js`; adjacent pending `insert-text`
  commands for the same file are coalesced so fast printable input can be
  applied by fewer Emacs worker runs.
- 2026-06-01: `app/src/main.js` now has an explicit command queue with
  `enqueueBufferCommand`, `runNextBufferCommand`, and one in-flight command at
  a time. Backspace remains an ordering boundary.
- 2026-06-01: browser smoke at `http://127.0.0.1:5182/` confirmed key presses
  `a`, `b`, `c` round-trip through the command queue and Emacs bridge; the
  final buffer ended with `abc`. Evidence is in
  `logs/browser-command-queue-smoke.txt` and
  `logs/browser-command-queue-smoke.png`.
- 2026-06-01: validation passed with `npm test`.
- 2026-06-01: added `docs/persistent-command-loop-feasibility.md`. The current
  browser profile is `-sEXIT_RUNTIME=1` and `--batch` startup terminates via
  Emacs `kill-emacs`, so the known-good bridge remains one-shot until a new
  non-exiting host-command profile is spiked.
- 2026-06-01: added point propagation through command, sync, and draw:
  `text-grid-draw` now carries `point.index`, worker output includes
  `WASMACS_POINT`, and main renders the cursor at the returned point.
- 2026-06-01: added ArrowLeft/ArrowRight input commands. The worker applies
  Emacs `backward-char 1` and `forward-char 1` before syncing the updated point.
- 2026-06-01: browser smoke at `http://127.0.0.1:5183/` confirmed ArrowLeft
  followed by `X` inserts before the final newline, proving point is no longer
  forced to point-max. Evidence is in `logs/browser-cursor-command-smoke.txt`
  and `logs/browser-cursor-command-smoke.png`.
- 2026-06-01: validation passed with `npm test`.
- 2026-06-01: added `scripts/build-emacs-browser-persistent-spike.sh`, which
  creates a separate `artifacts/emacs-browser-persistent-spike/` profile using
  `-sEXIT_RUNTIME=0` and exported runtime methods `callMain`, `FS`, and
  `FS_readFile`.
- 2026-06-01: added `scripts/validate-browser-persistent-spike.sh`; it checks
  the persistent profile glue for non-`NODERAWFS`, `noExitRuntime = true`,
  `Module['callMain']`, and `Module['FS_readFile']`, then verifies batch eval
  still prints `hello persistent-profile`.
- 2026-06-01: persistent profile validation passed; evidence is in
  `logs/wasm-browser-persistent-batch.txt`.
- 2026-06-01: added `scripts/probe-browser-persistent-callmain.mjs`; it loads
  the persistent profile with `Module.noInitialRun = true` and calls
  `Module.callMain` twice. The first batch call exits 0, while the second exits
  1 after Emacs reports `Back to top level`, proving repeated command-line
  `callMain` is not a reusable command loop. Evidence is in
  `logs/wasm-browser-persistent-callmain.txt`.
- 2026-06-01: added `docs/host-command-entrypoint-plan.md`, which scopes the
  next patch experiment to copied build sources and identifies the likely
  Emacs source surfaces: `emacs.c`, `keyboard.c`, `eval.c`, `lread.c`,
  `fileio.c`, and `editfns.c`.
- 2026-06-01: added `scripts/patch-emacs-host-entrypoint-spike.sh`, which
  patches only `build/emacs-core-spike/src/src/emacs.c` and adds exported
  `wasmacs_eval_string`.
- 2026-06-01: updated the persistent browser profile to export
  `_wasmacs_eval_string` and Emscripten `ccall`.
- 2026-06-01: added `scripts/probe-browser-host-entrypoint.mjs`; it boots Emacs
  once with `Module.callMain`, then invokes
  `Module.ccall("wasmacs_eval_string", ...)`. The probe printed
  `OUT:entrypoint` and returned `EVAL_STATUS:0`, proving host-initiated eval
  can run after initial boot without repeated command-line startup. Evidence is
  in `logs/wasm-browser-host-entrypoint.txt`.
- 2026-06-01: added `scripts/probe-browser-host-file-command.mjs`; it creates
  `/home/user/notes.txt` in persistent Emscripten FS, boots Emacs once, invokes
  `wasmacs_eval_string` with a form that uses `insert-file-contents` and
  `write-region`, and verifies `Module.FS_readFile` returns `alpha beta`.
  Evidence is in `logs/wasm-browser-host-file-command.txt`.
- 2026-06-01: updated the copied-source host entrypoint patch to export
  `_wasmacs_last_result` alongside `_wasmacs_eval_string`. The entrypoint now
  stores the last evaluated Lisp result as a host-readable string.
- 2026-06-01: added `scripts/probe-browser-host-readback.mjs`; it boots Emacs
  once, invokes `wasmacs_eval_string`, then verifies
  `Module.ccall("wasmacs_last_result", "string", [], [])` returns a structured
  path/text/point payload. Evidence is in
  `logs/wasm-browser-host-readback.txt`.
- 2026-06-01: validation passed with `npm test`.
- 2026-06-01: switched `app/src/wasm-worker.js` from the one-shot browser
  profile to `artifacts/emacs-browser-persistent-spike/`. The worker now boots
  Emacs once with `Module.callMain`, handles subsequent buffer commands through
  `wasmacs_eval_string`, and reads path/point/text from
  `wasmacs_last_result`.
- 2026-06-01: `app/src/main.js` now keeps one worker alive across queued
  commands instead of terminating and recreating it for every key command.
- 2026-06-01: browser smoke at `http://127.0.0.1:5173/` confirmed the
  persistent worker path: initial sync completed, ArrowLeft followed by `P`
  updated the Emacs-owned buffer to `Saved by Emacs core.P`, and the frame grid
  reflected the result. Evidence is in
  `logs/browser-persistent-worker-smoke.txt`.
- 2026-06-01: validation passed with `npm test`.

## Milestone 13: Ordinary Editing Baseline

Goal: make wasmacs useful for a small real editing session.

Status: [/] in progress

Steps:

1. Open, edit, save, reload one or more files under `/home/user/projects`.
2. Add basic command dispatch for common keys:
   - movement
   - delete/backspace
   - save
   - find-file/open
   - switch buffer
3. Add import/export UX for the user image.
4. Add visible error reporting when disabled process features are invoked.
5. Add a repeatable browser smoke script for a 5-minute editing session.

Exit criteria:

- A user can do normal note/code editing in one browser tab and recover the
  same user image after reload.
- Known missing native Emacs features are explicit, not surprising failures.

Validation notes:

- 2026-06-01: added a file path field and Open button to the browser UI. The
  app now normalizes relative paths into `/home/user/projects/...`, rejects
  paths outside `/home/user`, updates the visible buffer path, and can load or
  create project files from the browser user image.
- 2026-06-01: changed the persistent worker command form to use the command
  path instead of the fixed `/home/user/notes.txt` path, so Emacs
  `insert-file-contents` / `write-region` now operate on the active user file.
- 2026-06-01: browser smoke at `http://127.0.0.1:5173/` opened
  `/home/user/projects/demo.txt`, inserted `DEMO` through the persistent Emacs
  worker, saved, reloaded, and confirmed the editor/frame still show
  `Saved by Emacs core.DEMO`. Evidence is in
  `logs/browser-project-file-smoke.txt`.
- 2026-06-01: validation passed with `npm test`.
- 2026-06-01: added `Ctrl+S` command dispatch as `save-buffer`, keeping it
  inside the persistent Emacs command path.
- 2026-06-01: added a visible `Process` probe button for the MVP-disabled
  process surface. It reports `host.process is unavailable in the browser MVP`
  and sets both status and buffer state to `process unavailable`.
- 2026-06-01: browser smoke at `http://127.0.0.1:5173/` opened
  `/home/user/projects/commands.txt`, exercised ArrowLeft / printable input /
  Backspace / `Ctrl+S`, then verified the disabled process message. Evidence
  is in `logs/browser-command-dispatch-smoke.txt`.
- 2026-06-01: added `scripts/validate-browser-editing-smoke-evidence.sh` to
  keep the browser editing smoke evidence covered by `npm test`.
- 2026-06-01: validation passed with `npm test`.
- 2026-06-01: added a user file switcher populated from the browser
  `user-filesystem.wasifs` entries. It hides tar metadata (`PaxHeader`,
  AppleDouble `._*`) and internal `.local` state, marks the active file with
  `aria-current`, and switches buffers without launching Emacs until an edit
  command is sent.
- 2026-06-01: browser smoke at `http://127.0.0.1:5173/` created and edited
  `/home/user/projects/switch-a.txt` and `/home/user/projects/switch-b.txt`,
  then switched back to `switch-a.txt` through the file list. Evidence is in
  `logs/browser-file-switch-smoke.txt`.
- 2026-06-01: added optimistic point advancement for queued editing commands.
  This fixes fast printable input while a command is in flight, where repeated
  keys could otherwise use the same stale point and appear reversed.
- 2026-06-01: browser recovery smoke at `http://127.0.0.1:5173/` triggered the
  disabled process path, confirmed `process unavailable`, then typed `REC` into
  `/home/user/projects/recovery-order.txt` after the worker was recreated.
  Evidence is in `logs/browser-worker-recovery-smoke.txt`.
- 2026-06-01: added `scripts/summarize-browser-editing-session.mjs`, which
  rolls the project-file, command-dispatch, file-switch, and worker-recovery
  browser smoke logs into one editing session summary. Evidence is in
  `logs/browser-editing-session-smoke.txt`, and `npm test` now regenerates and
  validates it.
- 2026-06-01: extracted user-file-list filtering into
  `app/src/user-file-list.js` and added unit tests. The switcher now has
  explicit coverage for hiding tar metadata, AppleDouble files, internal
  `.local` runtime state, and non-user paths.
- 2026-06-01: added browser user image export coverage for multiple project
  files, ensuring `.wasifs` export/import preserves a small multi-file editing
  session.
- 2026-06-01: extracted user path normalization into `app/src/user-path.js`
  and added unit tests for relative project paths, absolute user paths, and
  rejection of paths outside `/home/user`.
- 2026-06-01: the file path input now opens the requested file on Enter.
  Browser smoke confirmed `enter-open.txt` opens as
  `/home/user/projects/enter-open.txt`; evidence is in
  `logs/browser-enter-open-smoke.txt`.
- 2026-06-01: added a narrow dirty-text guard for the temporary textarea
  surface. Before Open or file-list switching loads another file,
  `app/src/main.js` now persists modified textarea contents into the browser
  user image so direct DOM edits are not dropped while the frame-grid command
  path continues to move through Emacs.
- 2026-06-01: browser smoke at `http://127.0.0.1:5173/` typed
  `TEXTAREA-DRAFT` directly into `/home/user/projects/autosave-a.txt`,
  switched to `/home/user/projects/autosave-b.txt`, then reopened
  `autosave-a.txt` and confirmed the draft was preserved. Evidence is in
  `logs/browser-textarea-autosave-smoke.txt`.
- 2026-06-01: `scripts/summarize-browser-editing-session.mjs` and
  `scripts/validate-browser-editing-smoke-evidence.sh` now include the
  textarea autosave case, and validation passed with `npm test`.
- 2026-06-01: added explicit `C-g` and `C-/` command boundaries.
  `C-g` clears pending browser commands and reports `keyboard quit`; `C-/`
  reports `undo unavailable` with the concrete blocker that the MVP command
  bridge reconstructs a temporary Emacs buffer for each command, so real Emacs
  undo history requires persistent Emacs buffers rather than a browser-side
  fake.
- 2026-06-01: browser smoke at `http://127.0.0.1:5173/` opened
  `/home/user/projects/undo-quit.txt`, inserted `U`, verified `C-/` reports
  `undo requires persistent Emacs buffers`, then verified `C-g` reports
  `keyboard quit` without losing the buffer text. Evidence is in
  `logs/browser-undo-quit-smoke.txt`.
- 2026-06-01: added `docs/clipboard-kill-ring-boundary.md` with source
  grounding in `vendor/emacs/lisp/simple.el` and `vendor/emacs/lisp/select.el`.
  `C-y`, `C-w`, and `M-w` are now explicit command boundaries, but the worker
  reports `clipboard unavailable` instead of faking kill-ring behavior in the
  browser while persistent region/kill-ring state and GUI clipboard protocol
  are missing.
- 2026-06-01: browser smoke at `http://127.0.0.1:5173/` opened
  `/home/user/projects/clipboard-boundary.txt`, inserted `CLIP`, then verified
  `C-y` reports
  `clipboard/kill-ring requires GUI clipboard protocol plus persistent region
  and kill-ring state` without losing the buffer text. Evidence is in
  `logs/browser-clipboard-boundary-smoke.txt`.
- 2026-06-01: added `docs/minibuffer-command-boundary.md` with source
  grounding in `vendor/emacs/lisp/files.el`, `vendor/emacs/lisp/simple.el`,
  and `vendor/emacs/src/minibuf.c`. `C-x C-f` and `C-x b` are now explicit
  command boundaries for `find-file` and `switch-buffer`.
- 2026-06-01: the worker reports `minibuffer unavailable` for minibuffer
  commands until a persistent Emacs command loop, minibuffer window state, and
  completion UI exist. Deterministic probe evidence is in
  `logs/minibuffer-command-boundary.txt`; it is wired into `npm test`.
- 2026-06-01: added `docs/persistent-emacs-buffer-requirement.md`, tying
  undo, kill-ring, region, and minibuffer fidelity to a stable Emacs buffer /
  selected-window command path instead of the current per-command
  `with-temp-buffer` bridge.
- 2026-06-01: added `scripts/probe-browser-persistent-buffer-undo.mjs`. It
  attempts the smallest `find-file` plus undo path inside the persistent wasm
  runtime and records the current blocker: `memory access out of bounds` during
  GC/undo traversal. Evidence is in
  `logs/wasm-browser-persistent-buffer-undo.txt`, and the probe is wired into
  `npm test` as a known blocker rather than a silent assumption.
- 2026-06-01: added `scripts/probe-browser-persistent-buffer-matrix.mjs`. The
  matrix shows `find-file` and persistent writes pass, undo recording without
  invoking `undo` passes, and executing `undo` crashes with
  `memory access out of bounds` even when `gc-cons-threshold` is raised to
  `most-positive-fixnum`. Evidence is in
  `logs/wasm-browser-persistent-buffer-matrix.txt`, and the matrix is wired
  into `npm test`.
- 2026-06-01: expanded the persistent-buffer matrix. Direct `primitive-undo`
  passes, and `(undo-start)` followed by `(undo-more 1)` passes. High-level
  `undo` still crashes even with `inhibit-message` bound, so the blocker is now
  narrowed to the latter half of `vendor/emacs/lisp/simple.el`'s `undo`
  command: redo bookkeeping, `undo-equiv-table`, `pending-undo-list`, point
  record cleanup, modified-state/autosave handling, or host-entrypoint GC
  safety after those structures are updated.
- 2026-06-02: added `scripts/probe-browser-worker-point-undo-redo.mjs` and
  wired it into `npm test`. It proves a worker-shaped ordinary editing flow
  that inserts `AB`, moves point left, inserts `X` in the middle, then performs
  real Emacs `undo-only` and `undo-redo` over that middle insertion in the live
  file-visiting buffer. Evidence is in
  `logs/wasm-browser-worker-point-undo-redo.txt`.
- 2026-06-02: added `scripts/probe-browser-worker-file-switch-undo.mjs` and
  wired it into `npm test`. It switches between two live file-visiting buffers,
  edits both, then proves each buffer keeps its own real Emacs undo/redo state
  after switching. Evidence is in
  `logs/wasm-browser-worker-file-switch-undo.txt`.
- 2026-06-02: hardened `scripts/probe-browser-find-file-phases.mjs` so child
  cases call `process.exit(0)` after emitting successful evidence. Without
  that explicit exit, successful Emscripten runtime children could stay alive
  because `keepRuntimeAlive()` was set, making the full test path appear hung.
- 2026-06-02: added a narrow browser `#minibuffer` echo line plus
  `app/src/minibuffer-view.js`. It displays `C-x` prefixes and explicit
  unavailable messages for minibuffer/clipboard/process boundaries without
  pretending to implement real minibuffer input, completion, or history.
- 2026-06-02: added `scripts/run-browser-smoke.mjs` and `npm run
  browser:smoke`. It launches system Chrome headless with CDP, opens the local
  app, sends the `C-x C-f` sequence through `window.__wasmacsSmoke`, and
  verifies the minibuffer echo line reports the explicit unavailable boundary.
- 2026-06-02: expanded the runner with `npm run browser:smoke:editing`, which
  runs the minibuffer echo check plus the existing real undo, repeated undo,
  and redo browser smoke hooks through the same headless Chrome/CDP path.
- 2026-06-02: expanded `scripts/run-browser-smoke.mjs` with `files` and
  `boundaries` scenarios and added `npm run browser:smoke:all`. The all smoke
  now covers minibuffer echo, real undo/repeated undo/redo, project open/reload,
  file switching, textarea autosave before file switch, process-unavailable
  recovery, clipboard-unavailable, and keyboard quit through the repo-local
  headless Chrome/CDP runner.
- 2026-06-02: `npm run browser:smoke:all` now writes
  `logs/browser-runner-smoke.txt`, and
  `scripts/validate-browser-editing-smoke-evidence.sh` requires that runner
  evidence alongside the older browser smoke logs.
- 2026-06-02: `scripts/summarize-browser-editing-session.mjs` now includes
  the repo-local browser runner all-smoke evidence in
  `logs/browser-editing-session-smoke.txt`.
- 2026-06-02: `scripts/run-browser-smoke.mjs` now starts
  `scripts/serve-app.mjs` automatically when the target app server is not
  already running, so `npm run browser:smoke*` no longer depends on a manually
  prestarted dev server.
- 2026-06-02: added `docs/minibuffer-command-loop-plan.md` and
  `scripts/validate-minibuffer-command-loop-plan.sh`. The plan grounds real
  minibuffer support in `files.el`, `window.el`, `simple.el`, `minibuffer.el`,
  `minibuf.c`, `keyboard.c`, and `window.c`, and defines the first
  `host.gui.minibuffer-state` / `host.gui.minibuffer-input` protocol boundary.
- 2026-06-02: added `scripts/probe-browser-minibuffer-state.mjs` and wired it
  into `npm test`. It reads inactive Emacs minibuffer state through
  `wasmacs_eval_string` without entering `read_minibuf`; evidence is in
  `logs/wasm-browser-minibuffer-state.txt`.
- 2026-06-02: added `docs/minibuffer-suspended-read-plan.md` and
  `scripts/validate-minibuffer-suspended-read-plan.sh`. The plan rejects
  browser-side minibuffer readers and fixes the next implementation boundary
  as a suspended Emacs command-loop waitpoint with `unavailable:busy`
  protection for reentrant host eval.
- 2026-06-02: added copied-source `wasmacs_minibuffer_state` export,
  `_wasmacs_minibuffer_state` to the persistent browser profile, and
  `scripts/probe-browser-minibuffer-state-export.mjs`. Evidence in
  `logs/wasm-browser-minibuffer-state-export.txt` proves inactive minibuffer
  state can be read from C without `wasmacs_eval_string`.
- 2026-06-02: shortened the `find-file-*` matrix known-blocker family in
  `scripts/probe-browser-persistent-buffer-matrix.mjs` to a configurable
  timeout, defaulting to 10s, and records timeout as `KNOWN_BLOCKER`. This
  keeps the full `npm test` loop usable while preserving the blocker signal;
  set `WASMACS_MATRIX_KNOWN_BLOCKER_TIMEOUT_MS` for longer investigation.
- 2026-06-02: full `npm test` passed after the minibuffer state export and
  matrix timeout changes.
- 2026-06-02: added copied-source `wasmacs_command_state` and
  `wasmacs_command_begin_minibuffer_probe`. The new
  `scripts/probe-browser-minibuffer-active-read-boundary.mjs` records
  `unavailable:noninteractive-batch`, proving the current `--batch` profile
  cannot enter active `read_minibuf` and must move to an interactive/suspended
  command entrypoint.
- 2026-06-02: added `docs/minibuffer-asyncify-entrypoint-plan.md`,
  `scripts/build-emacs-browser-asyncify-spike.sh`, and
  `scripts/validate-minibuffer-asyncify-entrypoint-plan.sh`. The separate
  `artifacts/emacs-browser-asyncify-spike` lane builds with `-sASYNCIFY=1`
  without replacing the persistent baseline. Evidence shows the untrimmed
  Asyncify profile needs `node --stack-size=65500` for batch loadup, then
  boots and preserves the current active-read boundary:
  `unavailable:noninteractive-batch`.
- 2026-06-02: added configurable 10s known-blocker timeout handling to
  `scripts/probe-browser-persistent-buffer-cross-eval.mjs` for the
  file-visiting cross-eval cases, matching the matrix probe's routine
  regression behavior while keeping the blocker visible in logs.

## Milestone 14: Emacs Fidelity Expansion

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

## Milestone 15: High-Performance Renderer

Goal: replace the MVP DOM/textarea-oriented rendering path with a measured
Canvas/WebGL renderer that can handle large buffers, frequent redisplay, and
Emacs-style layered visual state.

Status: [ ] not started

Initial order:

1. Define renderer benchmarks and budgets:
   - startup-to-first-frame time
   - keypress-to-paint latency
   - scroll frame time
   - large buffer memory use
2. Add a Canvas 2D text-grid renderer behind the existing `text-grid-draw`
   protocol.
3. Add dirty row / dirty rectangle invalidation to avoid full-frame redraws.
4. Add a WebGL text atlas renderer:
   - glyph atlas creation
   - glyph quad batching
   - cursor and region overlay layers
   - mode line layer
5. Add renderer parity tests against the DOM renderer for:
   - cursor position
   - row wrapping
   - empty lines
   - selection/region markers
   - basic face attributes
6. Add browser performance smoke for:
   - 10k-line buffer open
   - fast typing burst
   - sustained scroll
   - resize
7. Keep renderer concerns in the browser GUI host; do not move DOM, Canvas, or
   WebGL APIs into `emacs-core.wasm`.

Exit criteria:

- A large text buffer can be opened, scrolled, and edited with measured latency
  targets documented in logs.
- The renderer can switch between DOM/Canvas/WebGL modes for comparison.
- Emacs core remains the owner of editor state; the renderer only consumes draw
  messages and sends input events.

Validation notes:

- Not started. Current architecture already points toward Canvas/WebGL text
  atlas rendering, but M13/M14 still prioritize editor correctness and Emacs
  fidelity before the performance renderer pass.

## Current Next Step

Continue Milestone 13: Ordinary Editing Baseline. The browser app now stores a
serialized `.wasifs` payload, forward-mounts `/home/user` into the
browser-hosted Emacs core, reverse-syncs Emacs-written `/home/user` content
back into the browser user image, and preserves direct textarea edits before
file switches. Start from these evidence files:

```sh
logs/wasm-batch-eval.txt
logs/wasm-browser-profile-batch.txt
logs/browser-worker-smoke.txt
logs/browser-single-buffer-smoke.txt
logs/emacs-file-bridge-node.txt
logs/emacs-file-bridge-browser.txt
logs/emacs-mounted-user-image-browser.txt
logs/emacs-reverse-sync-browser.txt
logs/browser-editing-session-smoke.txt
logs/browser-textarea-autosave-smoke.txt
logs/runtime-host.txt
docs/host-abi.md
docs/browser-mvp-plan.md
```

Next, continue adding ordinary editing coverage around expected Emacs-ish
editing behavior: isolate the high-level `undo` crash after
`undo-start`/`undo-more` succeeds, especially redo bookkeeping and
`undo-equiv-table`; design an actual minibuffer UI slice; and add a repo-local
browser automation runner for
key sequences that the current in-app browser safety layer blocks such as
`C-x`. When the browser automation dependency is made repo-local, turn the
in-app browser smoke flow itself into a fully repeatable runner. Project file
open/edit/save/reload, file switching, direct-textarea autosave, `Ctrl+S`,
`C-g`, deterministic real Emacs undo through the persistent worker, explicit
clipboard-unavailable reporting, explicit minibuffer-unavailable reporting,
movement/backspace regression, recovery after worker recreation, and visible
disabled process errors now work through the persistent Emacs worker or browser
user-image state as appropriate. The worker's ordinary editing bridge now
opens the active user file through real Emacs `find-file`, saves modified
file-visiting buffers through real `save-buffer`, and dispatches `C-/` to real
Emacs `(undo)` after command-loop-shaped `undo-boundary` insertion; it no
longer uses direct `write-region` on the live file-buffer path. Kill-ring and
minibuffer fidelity remain explicitly blocked on stable Emacs window/region/
minibuffer state and GC-safe host entrypoint usage.
The latest cross-eval probe proves a named Emacs buffer can survive across
separate host calls and write `alpha beta`, but `find-file` file-visiting
buffers and undo-list state still crash during GC marking when carried across
host eval calls. The file-buffer GC roots probe shows that host eval must
refresh the C stack-scan bottom and inhibit GC during the eval call; with that
temporary boundary, boot-only GC forms, temp buffers, named buffers, manual
`buffer-file-name`, `set-visited-file-name`, `insert-file-contents`, and
`find-file` buffers killed before returning pass. Live `find-file` buffers
can cross host eval calls if merely opened, switched to, or edited in memory.
The remaining crash is narrower: direct `write-region` against a live
file-visiting buffer poisons the next host eval, while `save-buffer` passes.
The new browser worker live `find-file`/`save-buffer` path passed the full
browser probe suite. The host eval entrypoint now catches Lisp signals and
returns safe `EVAL_STATUS:1` readbacks instead of wasm traps for uncaught
`user-error` paths. The undo tail probe now shows the key command-loop
requirement: high-level `undo` fails with `No further undo information` when
the synthetic setup lacks a post-edit `undo-boundary`, but passes for both
file-visiting and named buffers when the edit is followed by that boundary.
The browser worker now adds `undo-boundary` after edit commands and dispatches
`C-/` to real Emacs `undo-only`. The real-undo deterministic probe has now
been promoted to a browser UI smoke in
`logs/browser-real-undo-ui-smoke.txt`. The UI smoke exposed an important
ownership rule: after a file is live in Emacs, the worker must not rematerialize
that active path from the browser image before each command, or `save-buffer`
sees an externally changed visited file and attempts to read confirmation from
stdin. Multiple edits followed by repeated real Emacs `undo-only` now pass in
both the worker-shaped probe and browser UI smoke. Explicit redo now has the
same shape: `C-?` maps to real Emacs `undo-redo 1`, with worker-shaped and
browser UI evidence. The multi-edit redo blocker was narrowed to an important
host sync rule: undo/redo commands must not call `save-buffer` immediately
after changing the buffer, because that shifts the `buffer-undo-list` head away
from the `undo-equiv-table` redo mapping. With undo/redo treated as Emacs
buffer-state commands and browser persistence handled through the worker
readback, `A`, `B`, `undo-only`, `undo-redo` now passes in
`logs/wasm-browser-worker-redo-interleaving.txt`. Point movement now has
worker-shaped coverage in `logs/wasm-browser-worker-point-undo-redo.txt`:
`AB`, move-left, middle insert `X`, `undo-only`, and `undo-redo` all pass
against the same live file-visiting buffer. File switching now has
worker-shaped coverage in `logs/wasm-browser-worker-file-switch-undo.txt`: two
live file-visiting buffers retain separate undo/redo state across `find-file`
switches. The repo-local browser runner now exists as
`npm run browser:smoke`, and `npm run browser:smoke:all` now covers the
minibuffer echo check, real undo/repeated undo/redo UI smoke hooks, project
open/reload, file switching, textarea autosave, process-unavailable recovery,
clipboard-unavailable, and keyboard quit. Runner evidence is recorded in
`logs/browser-runner-smoke.txt` and checked by the browser editing evidence
validator. The runner now starts the app server on demand. Continue by either
retiring the older static browser smoke logs or keeping them as historical
fixtures, then implement the interactive/suspended command entrypoint described
in `docs/minibuffer-suspended-read-plan.md` and
`docs/minibuffer-asyncify-entrypoint-plan.md`: add the first explicit
`wasmacs_host_wait_for_input` import near the Emacs input wait path, narrow
Asyncify instrumentation around that waitpoint, move beyond the current
`unavailable:noninteractive-batch` probe, start a real
`read-from-minibuffer`, observe `active:true` / `depth:1`, reject reentrant
eval as `unavailable:busy`, and keep process and pty unavailable.

Do not fake Emacs-owned editor semantics in the browser UI. In particular,
real undo, kill-ring, region, minibuffer, and file-visiting buffer behavior
must come from stable Emacs-side buffer/window/command-loop state. Until that
state is safe, keep the current explicit unavailable boundaries rather than
adding browser-side substitutes that would diverge from Emacs. The next
debugging pass should treat the latest evidence as the starting point: named
buffers survive across `wasmacs_eval_string` calls, direct `primitive-undo` and
`undo-start`/`undo-more` pass, but `find-file` file-visiting buffers and
undo-list state crash during GC marking across host eval calls. Prioritize
host-entrypoint stack/GC root safety and file-visiting buffer lifetime before
enabling real undo/kill-ring/minibuffer fidelity.
