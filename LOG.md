# LOG.md

## 2026-06-01

### Milestone 1: Emacs 30.2 Source Inventory

- Started the first implementation/research turn after the repo control plane.
- Confirmed Milestone 0 validation:
  - `git submodule status --recursive`
  - `git -C vendor/emacs describe --tags --exact-match HEAD`
- Result: `vendor/emacs` is pinned at `emacs-30.2`
  (`636f166cfc86aa90d63f592fd99f3fdd9ef95ebd`).
- Added a source-grounded inventory at
  `docs/emacs-30.2-source-inventory.md`.
- Added `scripts/validate-source-inventory.sh` to keep the inventory
  checkable as the plan moves forward.
- Validation passed: `scripts/validate-source-inventory.sh`.

### Milestone 2: Build Strategy Spike

- Inspected `vendor/emacs/configure.ac` for dumping, GUI, native-compilation,
  sound, D-Bus/GSettings, pty, sockets, termios, mmap, and setjmp/longjmp
  surfaces.
- Chose Emscripten-first as the initial route because the first target is a
  browser worker and Emscripten gives the shortest path to a browser-loadable
  wasm artifact with filesystem hooks.
- Kept WASI SDK / wasi-libc as the documented alternative for the later host
  ABI cleanup path.
- Added `docs/build-strategy.md`, `scripts/build-emacs-core-spike.sh`, and
  `scripts/validate-build-strategy.sh`.
- Validation passed: `scripts/validate-build-strategy.sh`.

### Milestone 3: Native Baseline Before Wasm

- Added `scripts/build-native-baseline.sh` to build from a copy of the pinned
  Emacs source under `build/native-emacs-30.2`, keeping generated files out of
  `vendor/emacs`.
- Added `scripts/validate-native-baseline.sh`.
- Updated `.gitignore` so `logs/*.txt` validation evidence can be tracked while
  generated logs and build output stay ignored.
- First attempt with an out-of-tree build failed during Lisp generation with
  missing `build/lisp/lisp` paths and `debug-early--handler` errors; switched
  the script to an in-tree build inside the ignored source copy.
- Native baseline configured and built successfully from
  `build/native-emacs-30.2/src` with GUI, sound, D-Bus, GSettings, native
  compilation, pdumper, and unexec disabled.
- Batch checks completed:
  - `(message "hello wasmacs")`
  - `(princ emacs-version)` -> `30.2`
  - `(byte-code-function-p (symbol-function 'byte-code))` -> printed
    `not-byte-code-function` for this specific primitive symbol check.
- Validation passed: `scripts/validate-native-baseline.sh`.
- Evidence log: `logs/native-baseline.txt`.

### Milestone 4: System Lisp Image Builder

- Added `scripts/build-system-lisp-image.sh` to stage the system Lisp tree as a
  tar-compatible `.wasifs` image rooted at `system/`.
- Added `tools/wasifs/inspect-system-lisp.sh` for custom-runtime-free image
  inspection.
- Added `scripts/validate-system-lisp-image.sh` to verify tar contents,
  manifest fields, and manifest/image sha256 agreement.
- Built `artifacts/system-lisp-emacs-30.2.wasifs` and
  `artifacts/system-lisp-emacs-30.2.manifest.json`.
- Current image contents: 1651 `.el`, 142 `.elc`, 20 generated
  `*loaddefs.el`, and selected `etc/` support files.
- Validation passed: `scripts/validate-system-lisp-image.sh`.
- Evidence log: `logs/system-lisp-image.txt`.
- Tried full `make lisp` after the first image build; with
  `--with-dumping=none`, each byte-compile reloads `loadup.el`, so the full
  compile is too slow for this milestone and is deferred to a later
  release/performance pass.

### Milestone 5: User Filesystem Image Builder

- Added `docs/wasifs-format.md` to document tar-compatible spike images,
  sidecar manifests, journal/snapshot placeholders, and stable vs spike-only
  format decisions.
- Added `scripts/create-user-filesystem-image.sh` to build an empty writable
  user image rooted at `home/user/`.
- Added `tools/wasifs/inspect-user-filesystem.sh` and
  `scripts/validate-user-filesystem-image.sh`.
- Built `artifacts/user-filesystem-empty.wasifs` and
  `artifacts/user-filesystem-empty.manifest.json`.
- Initial image contains `init.el`, `.emacs.d/lisp`, `.emacs.d/elpa`,
  `projects`, an empty `journal.jsonl`, and a reserved `snapshots/`
  directory.
- Validation passed: `scripts/validate-user-filesystem-image.sh`.
- Evidence log: `logs/user-filesystem-image.txt`.

### Milestone 6: Host ABI Draft

- Added `docs/host-abi.md` to define the first boundary between
  `emacs-core.wasm` and the runtime host.
- Added `wit/host-abi.wit` with separate interfaces for filesystem, clock,
  random, environment, stdio, process, and GUI.
- Kept GUI protocol messages separate from filesystem calls: input events,
  frame metrics, draw messages, and clipboard are under `interface gui`.
- Marked `host.process` unavailable by default for the MVP.
- Documented that Emscripten-first builds may use an adapter layer while still
  treating the WIT file as the contract.
- Validation passed: `scripts/validate-host-abi.sh`.

### Milestone 7: Wasm Batch Evaluation Spike

- Initial run failed before configure because `emconfigure` was not available.
- Installed Homebrew `emscripten` 5.0.7; `emconfigure`, `emmake`, and `emcc`
  are now available.
- Upstream Emacs configure rejects `wasm32-unknown-emscripten`; used
  `wasm32-unknown-linux-gnu` as a fallback configure host to expose later
  blockers.
- `scripts/build-emacs-core-spike.sh` now applies the current reproducible spike
  shape:
  - uses native baseline `make-docfile` and `make-fingerprint` as host build
    helpers
  - enables `--with-wide-int`
  - disables `malloc_trim`, Linux `sysinfo`, pthread signal forwarding, and
    external ncurses/terminfo assumptions for the fallback host
  - links with `NODERAWFS` for Node smoke access to source-tree files
- Built `artifacts/emacs-core-spike.wasm` and `artifacts/emacs-core-spike.js`.
- Node smoke with source-tree `EMACSDATA` and `EMACSLOADPATH` starts `temacs`
  and begins loading `loadup.el`, then fails in standard Lisp loadup with
  `invalid-function ("")` and `Wrong type argument: listp, 11185520`.
- Bare `temacs -nl --batch --eval ...` avoids loadup but fails with
  `Symbol's function definition is void: internal-timer-start-idle`.
- Validation passes in blocked-artifact mode:
  `scripts/validate-wasm-batch-eval.sh`.
- Continued blocker narrowing with a custom `loadup.el` in the ignored spike
  tree. Full `subr.el` loads when the standard pre-`subr.el` load-path message
  is omitted.
- Reproduced the `invalid-function ("")` / `Wrong type argument: listp, ...`
  failure by calling `(message "Using load-path %s" load-path)` before loading
  `subr.el`; `(prin1 load-path)` does not reproduce it.
- Reproduced the same failure with `(message "list %s" (list LONG LONG LONG))`
  once the printed payload is large enough. The threshold is not monotonic,
  which points toward memory-layout-sensitive wasm/runtime behavior rather than
  a deterministic Elisp syntax issue.
- Split the failure by GC behavior: raising `gc-cons-threshold` lets the
  focused `format` case pass, while `(garbage-collect)` after the format call
  reproduces the `invalid-function ("")` failure.
- Under the `format` + `garbage-collect` condition, `subr.el` prefix 5697
  loads and prefix 5717 fails. The first failing top-level form is
  `combine-and-quote-strings`, which contains a `mapconcat` / `lambda` closure.
- A larger-memory experiment with early GC deferred got past the original
  `subr.el` blocker and failed later in `cl-preloaded.el` with
  `memory access out of bounds` in `mem_insert -> allocate_vectorlike ->
  Fvector -> Fmake_interpreted_closure -> Ffunction`, reinforcing the
  closure/allocation/GC direction.
- Negative copied-tree experiments did not change the focused failure when
  disabling `print_object`'s local `stack_top` update, disabling
  stack-allocated temporary Lisp objects with `USE_STACK_LISP_OBJECTS=false`,
  or inhibiting GC only inside `Fmake_interpreted_closure`.
- Instrumented `maybe_garbage_collect` in the copied spike tree. The focused
  failure happens immediately after automatic GC fires during `subr.el` load.
  Raising `gc-cons-threshold` after an explicit GC and before loading `subr.el`
  lets the same focused case pass.
- With a 1GB initial wasm heap, higher thresholds move the failure later but do
  not solve it: 16MB reaches `cl-preloaded.el` and then hits
  `memory access out of bounds` in vector/closure allocation; 64MB reaches
  `files.el` and fails with eager macro-expansion `(invalid-function "")`.
- Tried Emscripten stack-boundary marking with
  `emscripten_stack_get_current/base/end`; it did not fix the focused failure.
- Tried forcing the setjmp path by disabling `HAVE___BUILTIN_UNWIND_INIT`; it
  also did not fix the focused failure.
- Rebuilt the copied spike tree with `CFLAGS=-g3 -O0`. This fixes the focused
  GC-sensitive `subr.el` cases: `scripts/debug-wasm-format-gc.sh` now reports
  all PASS, including prefix 5717.
- Updated `scripts/build-emacs-core-spike.sh` so the wasm spike defaults to
  `EMACS_WASM_CFLAGS="-g3 -O0"` and copies the rebuilt wasm/js artifacts into
  `artifacts/`.
- Clean `-O0` standard loadup reaches `files.el` and then fails with
  `memory access out of bounds` in `styled_format -> Fformat -> eval_sub`.
- Instrumented `files.el` confirmed the failure occurs while entering the
  compile-time `(require 'easy-mmode)` path, before `easy-mmode.el` top-level
  forms run. Re-linking with a 1MB Emscripten stack moves past this blocker.
- With a 1MB stack, the next failure is an Emscripten heap OOM around
  `international/characters.el`; adding a 256MB initial heap and memory growth
  lets standard `loadup.el` complete far enough for batch eval.
- `scripts/build-emacs-core-spike.sh` now defaults to the successful correctness
  profile: `CFLAGS=-g3 -O0`, `STACK_SIZE=1048576`,
  `STACK_OVERFLOW_CHECK=2`, `INITIAL_MEMORY=268435456`, and
  `ALLOW_MEMORY_GROWTH=1`.
- Node wasm `temacs --batch --eval` now prints both `hello wasmacs` and `6`.
  Evidence log: `logs/wasm-batch-eval.txt`.
- Validation passed: `scripts/validate-wasm-batch-eval.sh`.
- Historical source-level candidates for the earlier focused GC/format blocker
  were `vendor/emacs/src/editfns.c`
  (`Fmessage`, `Fformat_message`, `styled_format`) and
  `vendor/emacs/src/print.c` (`Fprin1_to_string`, `print_object`), plus
  `vendor/emacs/src/eval.c`, `vendor/emacs/src/alloc.c`, and
  `vendor/emacs/src/thread.c` for closure creation, GC/vector allocation, and
  conservative stack/root marking.
- Added reproduction helper: `scripts/debug-wasm-format-gc.sh`.
- Evidence log: `logs/wasm-debug-format-loadup.txt`.

### Milestone 8: Runtime Host Prototype

- Added a dependency-free Node test/runtime skeleton with `package.json`.
- Added `runtime/fs/tar.js` for parsing and writing the tar-compatible
  `.wasifs` spike format.
- Added `runtime/fs/wasifs.js` for mounting `/system` read-only and
  `/home/user` writable in memory.
- Added `runtime/host/core-host.js` for non-GUI host shims: clock, random,
  environment, stdio/log, and explicit process-unavailable behavior.
- Added `tests/runtime/wasifs.test.js`.
- Test coverage includes `/system` rejecting writes, `/home/user` accepting
  writes, read/write/stat/readdir/rename/unlink/sync, export/import roundtrip,
  and host shim behavior.
- Validation passed: `npm test`.
- Evidence log: `logs/runtime-host.txt`.

### Milestone 9: Browser Single-Buffer MVP

- Started Milestone 9 without replacing the Emacs core. Added
  `docs/browser-mvp-plan.md` to state that the browser UI is a host surface
  around the real Emacs wasm artifact.
- Confirmed the current Milestone 7 artifact is Node-only: the generated glue
  contains `NODERAWFS` and the browser-incompatible runtime error
  `NODERAWFS is currently only supported on Node.js environment.`
- Added `scripts/validate-browser-mvp-readiness.sh` to keep that packaging
  boundary testable. The next browser step is a second artifact/profile without
  `NODERAWFS`, with `lisp/` and `etc/` supplied through preload packaging or the
  wasifs host adapter.
- Added `scripts/build-emacs-browser-profile-spike.sh`. It relinks the existing
  copied Emacs wasm build without `NODERAWFS` and preloads `lisp/` and `etc/`
  into `/usr/local/share/emacs/30.2/`, producing
  `artifacts/emacs-browser-spike/{temacs,temacs.wasm,temacs.data}`.
- Added `scripts/validate-browser-profile-spike.sh`. The packaged non-Node-FS
  profile runs `--batch --eval '(princ "hello browser-profile")'` successfully;
  evidence is in `logs/wasm-browser-profile-batch.txt`.
- Current caveat: the browser profile still uses Emscripten preload data rather
  than `system-lisp.wasifs`, so it is a packaging proof, not the final
  filesystem architecture.
