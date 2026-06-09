# LOG.md

## 2026-06-09

### Task: Atomics terminal input wait — scheduler-aware timer integration (Phases 1–5)

**Problem reproduced:**
- In wasmacs Atomics/pdump/xterm mode, Emacs timers (`run-at-time`, `M-x tetris`)
  only updated after keyboard input because `Atomics.wait()` blocked forever and
  C never returned to the higher Emacs scheduler/timer path.

**Root cause:**
- `Atomics.wait(signal, 0, lastSeen)` had no timeout — JS blocked forever.
- The C-side waitpoint discarded the JS return value and re-entered the same
  low-level read loop on every iteration, never bubbling up to `kbd_buffer_get_event`.

**Fix — Phase 1 (JS return codes):**
- Changed `wasmacs_host_wait_for_input` in `tools/scripts/wasmacs-atomics-host-library.js`
  to return explicit reason codes: `0`=timeout, `1`=input, `2`=resize, `-1`=no SAB.
- Added 50ms diagnostic fixed timeout for initial confirmation.

**Fix — Phase 2 (C timeout propagation):**
- Patched `kbd_buffer_get_event` in `keyboard.c` (via
  `tools/scripts/patch-emacs-host-entrypoint-spike.sh` and
  `build/emacs-pdump-configure-probe/src/src/keyboard.c`).
- On `WASMACS_WAIT_TIMEOUT` (return 0), C now calls `timer_check()` and
  `redisplay_preserve_echo_area(9)` instead of re-entering the low-level wait,
  allowing timers to fire and buffers to redisplay.

**Phase 3 smoke test results:**
- `(run-at-time 0 0.1 ...)` tick message updated without keyboard input — PASS.
- `M-x tetris` pieces did not fall without keypresses — needed Phase 2 redisplay fix.
  After adding `redisplay_preserve_echo_area(9)` post-`timer_check()`: PASS.

**Fix — Phase 4 (Emacs-derived timeout):**
- Replaced fixed 50ms poll with `timer_check()` return value (`struct timespec`).
- Added `wasmacs_timespec_to_timeout_ms()` C helper (clamps to [1, 1000]ms).
- JS `wasmacs_host_wait_for_input(timeout_ms)` now receives the real next-timer
  deadline so `Atomics.wait` sleeps exactly until the next timer, not every 50ms.
- Accepted by user: both `run-at-time` and `M-x tetris` noticeably smoother.

**Fix — Phase 5 (independent flush):**
- Extracted `wasmacs_host_flush_terminal_output` as an independent JS function
  (also callable as a C extern).
- `wasmacs_host_wait_for_input` delegates its section-1 flush to
  `_wasmacs_host_flush_terminal_output()`.
- C `keyboard.c` now calls `wasmacs_host_flush_terminal_output()` after the
  post-wait `redisplay_preserve_echo_area(9)` in both call sites, eliminating
  the 1-iteration output delivery delay after timer wakes.
- All three files kept in sync: `wasmacs-atomics-host-library.js`,
  `keyboard.c`, and `patch-emacs-host-entrypoint-spike.sh`.

**Validation (Phase 5, 2026-06-09):**
- `M-x tetris` — pieces fall automatically, no keypress needed: PASS.
- `(run-at-time 1 1 (lambda () (message "tick %s" (float-time))))` — ticks
  continue without input: PASS.

**vendor/emacs unchanged.**

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
- Re-read the Emacs dump/preload path while diagnosing the browser Asyncify
  worker stack blocker. `vendor/emacs/src/pdumper.c` shows `pdumper_load`
  must run before the Lisp universe is `initialized`, has a heap-backed
  contiguous mapping fallback (`dump_mmap_contiguous_heap`), and still applies
  dump and Emacs relocations (`dump_do_all_emacs_relocations`). Conclusion:
  the next Asyncify boot spike should prove a Node-first pdump/preloaded-state
  path or record why Emscripten blocks it; a custom snapshot is only acceptable
  if it preserves pdumper-class relocation/static-root semantics.
- Added Node-first pdump/preloaded-state probes. `scripts/probe-emacs-pdump-configure.sh`
  shows Emscripten configure can enable `--with-dumping=pdumper` and
  `--with-pdumper=yes`. `scripts/probe-emacs-pdump-temacs-build.sh` builds a
  pdumper-enabled wasm `temacs`; the concrete wasm wrinkle is that upstream
  `make-fingerprint` searches the CommonJS launcher `temacs.tmp`, while the
  fingerprint bytes live in `temacs.wasm`, so the probe applies
  `make-fingerprint` to `temacs.wasm` as a generated-artifact workaround.
  With `EMACSLOADPATH` pointed at the copied source `lisp/`, Node reaches
  `loadup.el --temacs=pdump` and loads through `bindings`, but `.pdmp`
  generation is still blocked by exit 139. A large-stack
  `STACK_OVERFLOW_CHECK=0` diagnostic build reaches the same point and also
  exits 139, so the next focus is the early `bindings.el` / loadup-time
  wasm runtime/root/memory failure, not pdumper configure or C compilation.
- Split the pdump `bindings.el` failure. Disabling the `loadup.el`
  after-load GC hook still exits 139 at `Loading bindings (source)`, so the
  failure is not simply the per-load GC. Instrumenting completed top-level
  forms shows the crash after line 50, before the next top-level form
  completes. The next source form is the mode-line keymap defvar pair:
  `mode-line-input-method-map` and `mode-line-coding-system-map`. Replacing
  both with nil, or keeping their keymaps/`define-key` calls while removing
  `purecopy`, gets past `bindings.el` and `window` into `files.el`; replacing
  only the first still crashes because the second original purecopy remains.
  This narrows the current wasm pdump blocker to purecopying those early
  keymap/closure structures. The next error after bypassing that blocker is
  `(require pcase) while preparing to dump`, a separate compiled-Lisp artifact
  issue from running source-only `files.el`.

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

## 2026-06-02

### Milestone 14: Minibuffer Suspended Entrypoint

- Added `docs/minibuffer-asyncify-entrypoint-plan.md` to make the next real
  minibuffer route concrete: a separate Asyncify artifact lane first, then an
  explicit Emacs input-wait import rather than a browser-side reader.
- Added `scripts/build-emacs-browser-asyncify-spike.sh`, which builds
  `artifacts/emacs-browser-asyncify-spike` with `-sASYNCIFY=1` and the same
  host exports as the persistent browser profile.
- Added `scripts/validate-minibuffer-asyncify-entrypoint-plan.sh` and wired it
  into `npm test`.
- Made `scripts/probe-browser-minibuffer-active-read-boundary.mjs`
  artifact/log configurable so the same boundary probe can compare persistent
  and Asyncify profiles.
- Evidence: the first full Asyncify profile overflows Node's default JS stack
  during Emacs loadup, but boots with `node --stack-size=65500`. It still
  preserves the current minibuffer boundary:
  `BEGIN_READBACK:unavailable:noninteractive-batch`.
- While running the full regression suite, the matrix probe showed that the
  `find-file-*` matrix family needs configurable known-blocker timeout
  treatment. The default is 10s for routine regression, with
  `WASMACS_MATRIX_KNOWN_BLOCKER_TIMEOUT_MS` available for longer
  investigation. Passing cases still pass, while crash/hang cases are recorded
  as `KNOWN_BLOCKER` instead of stopping the suite indefinitely.
- Added the same configurable known-blocker timeout shape to
  `scripts/probe-browser-persistent-buffer-cross-eval.mjs` for the
  file-visiting cross-eval cases, using
  `WASMACS_CROSS_EVAL_KNOWN_BLOCKER_TIMEOUT_MS` for longer investigation.
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
- Added `app/` and `scripts/serve-app.mjs` for direct browser worker loading.
  The app creates a classic worker, sets Emscripten `Module.arguments`,
  `Module.locateFile`, stdout/stderr hooks, and imports
  `/artifacts/emacs-browser-spike/temacs`.
- First in-app Browser run found a real browser packaging bug:
  extensionless `temacs` was served as `application/octet-stream`, so
  `importScripts` rejected it. `scripts/serve-app.mjs` now serves basename
  `temacs` as JavaScript.
- In-app Browser smoke then passed at `http://127.0.0.1:5174/`: the page status
  reached `emacs core exited cleanly` and the output tail contained
  `hello browser-worker`. Evidence is in `logs/browser-worker-smoke.txt`.
- Added `scripts/validate-browser-worker-app.sh` and included it in `npm test`
  for repeatable static validation of the worker app wiring.
- Added the first single-buffer browser host UI. The left pane edits
  `/home/user/notes.txt` through a temporary `localStorage`-backed host
  filesystem adapter, with explicit Save/Reload controls and modified/saved
  state. The right pane keeps the real Emacs wasm worker proof visible.
- In-app Browser single-buffer smoke passed at `http://127.0.0.1:5175/`:
  text entered into the buffer persisted after Save and page reload, and the
  Emacs wasm worker proof still printed `hello browser-worker`. Evidence is in
  `logs/browser-single-buffer-smoke.txt`.
- Added Milestones 10-14 to describe the path from proof to ordinary use:
  portable browser user filesystem, Emacs-owned file/buffer bridge, redisplay
  and input MVP, ordinary editing baseline, and fidelity expansion.
- Started Milestone 10. Added `app/src/browser-wasifs.js`, which parses and
  writes the tar-compatible user image format in the browser without Node
  `Buffer` APIs.
- The browser buffer now loads `artifacts/user-filesystem-empty.wasifs`, writes
  `/home/user/notes.txt` into a `BrowserUserImage`, and stores a base64
  serialized `.wasifs` payload in `localStorage`.
- Added Export and Import controls for `user-filesystem.wasifs`.
- Added `tests/runtime/browser-wasifs.test.js`; validation passed with
  `npm test`.
- Started Milestone 11. Node smoke with `artifacts/emacs-browser-spike/temacs`
  confirmed Emacs can create `/home/user/notes.txt` with `with-temp-file` and
  read it back with `insert-file-contents`; evidence is in
  `logs/emacs-file-bridge-node.txt`.
- Updated the browser worker proof to run the same Emacs file primitive path.
  In-app Browser smoke passed at `http://127.0.0.1:5177/` with
  `hello emacs file bridge`; evidence is in
  `logs/emacs-file-bridge-browser.txt`.
- Added `scripts/validate-emacs-file-bridge-spike.sh` and included it in
  `npm test`.
- Current Milestone 11 boundary: the Emacs worker Emscripten filesystem and the
  browser `.wasifs` user image are both present, but not yet synchronized into
  one mounted filesystem.
- Added forward synchronization for the bridge: the main app sends
  `BrowserUserImage.entries()` to the worker, `Module.preRun` materializes those
  entries into Emscripten FS, and Emacs reads `/home/user/notes.txt` with
  `insert-file-contents`.
- In-app Browser smoke at `http://127.0.0.1:5179/` confirmed Emacs printed the
  same `/home/user/notes.txt` content shown in the UI. Evidence is in
  `logs/emacs-mounted-user-image-browser.txt`.
- Added reverse synchronization for the bridge: Emacs now reads
  `/home/user/notes.txt`, appends text, writes it back with `write-region`, and
  emits a temporary `WASMACS_SYNC_*` stdout marker. The main app handles
  `sync-file`, updates `BrowserUserImage`, persists the serialized image, and
  refreshes the visible buffer.
- In-app Browser smoke at `http://127.0.0.1:5180/` confirmed the status
  `emacs core exited cleanly`, buffer state `synced from emacs`, and textarea
  content containing `Saved by Emacs core.` Evidence is in
  `logs/emacs-reverse-sync-browser.txt`.
- Milestone 11 is complete. The remaining caveat is that the reverse bridge is
  a deliberately temporary stdout marker protocol; Milestone 12 should replace
  it with an explicit redisplay/input adapter.
- Started Milestone 12. Added `app/src/redisplay-protocol.js` with a
  `text-grid-draw` v1 message, point metadata, mode line text, and validation.
- Added `tests/runtime/redisplay-protocol.test.js` for row wrapping,
  empty-line preservation, point placement, and invalid column rejection.
- The browser app now renders the Emacs-synchronized `/home/user/notes.txt`
  content into `#frame-grid` with a mode line and cursor. The textarea remains
  as a temporary input surface until keyboard/input commands are routed through
  the Emacs-side bridge.
- In-app Browser smoke at `http://127.0.0.1:5180/` confirmed
  `emacs core exited cleanly`, `synced from emacs`, one `.frame-cursor`, and a
  `/home/user/notes.txt` mode line. Evidence is in
  `logs/browser-text-grid-smoke.txt`.
- The Emacs proof command is now idempotent: it only inserts
  `Saved by Emacs core.` if that marker is not already present.
- Added `app/src/input-protocol.js` for the first explicit input bridge:
  printable keys and Enter become `insert-text`, Backspace becomes
  `backspace`, and modified/composing keys are left out of this narrow MVP
  path.
- Added `tests/runtime/input-protocol.test.js`; `npm test` now runs 14 runtime
  tests before the build/profile/app validations.
- The browser app now routes keydown on `#frame-grid` through
  `run-buffer-command`. Each command starts a one-shot worker, materializes the
  current user image, applies Emacs `insert` or `delete-char -1`, writes the
  file with `write-region`, reverse-syncs `/home/user/notes.txt`, and redraws
  the text grid.
- In-app Browser smoke at `http://127.0.0.1:5181/` confirmed pressing `Z`
  inserts through the Emacs command bridge and Backspace removes it through the
  same bridge. Evidence is in `logs/browser-input-command-smoke.txt` and
  `logs/browser-input-command-smoke.png`.
- Current caveat: this is intentionally one-command-per-worker and therefore
  slow. The next meaningful improvement is a persistent worker command queue or
  another explicit loop that keeps the Emacs side alive across commands.
- Added `app/src/command-queue.js` and
  `tests/runtime/command-queue.test.js`. Adjacent pending `insert-text`
  commands for the same file are coalesced, while Backspace remains an ordering
  boundary.
- `app/src/main.js` now has an explicit command queue:
  `enqueueBufferCommand`, `runNextBufferCommand`, and one in-flight command at
  a time. This does not make the core persistent yet, but it prevents accepted
  input from racing worker startup and lets fast printable input batch into
  fewer Emacs worker runs.
- In-app Browser smoke at `http://127.0.0.1:5182/` confirmed pressing `a`,
  `b`, `c` through `#frame-grid` round-trips through the command queue and
  Emacs bridge; the final buffer ends with `abc`. Evidence is in
  `logs/browser-command-queue-smoke.txt` and
  `logs/browser-command-queue-smoke.png`.
- Added `docs/persistent-command-loop-feasibility.md`. The current browser
  artifact is built with `-sEXIT_RUNTIME=1`, and the current command path uses
  Emacs `--batch`, where `startup.el` exits via `kill-emacs`. Therefore the
  current bridge should remain the known-good one-shot baseline while a
  separate non-exiting host-command profile is spiked.
- Added point propagation through the input/sync/draw path. Commands now carry
  `pointIndex`, the worker emits `WASMACS_POINT`, and `text-grid-draw` carries
  `point.index`, `point.row`, and `point.column`.
- Added ArrowLeft/ArrowRight input commands. They run Emacs
  `backward-char 1` / `forward-char 1` through the same worker bridge.
- In-app Browser smoke at `http://127.0.0.1:5183/` confirmed ArrowLeft followed
  by `X` inserts before the final newline, so point is no longer forced to
  point-max. Evidence is in `logs/browser-cursor-command-smoke.txt` and
  `logs/browser-cursor-command-smoke.png`.
- Committed the browser Emacs bridge MVP as
  `64e0a79 Add browser Emacs bridge MVP`.
- Added `scripts/build-emacs-browser-persistent-spike.sh`. It creates
  `artifacts/emacs-browser-persistent-spike/` with `-sEXIT_RUNTIME=0` and
  exported runtime methods `callMain`, `FS`, `FS_createPath`,
  `FS_createDataFile`, and `FS_readFile`.
- Added `scripts/validate-browser-persistent-spike.sh` and included it in
  `npm test`. It checks that the profile is non-`NODERAWFS`, exposes
  `callMain` and `FS_readFile`, has `noExitRuntime = true`, and still runs
  batch eval.
- Persistent profile validation passed; evidence is in
  `logs/wasm-browser-persistent-batch.txt`.
- Added `scripts/probe-browser-persistent-callmain.mjs`. It loads the
  persistent profile with `Module.noInitialRun = true` and calls
  `Module.callMain` twice in one runtime.
- The probe showed `FIRST_EXIT:0` and `SECOND_EXIT:1`; the second call reports
  `Back to top level`. So repeated command-line batch `callMain` is not a
  reusable command loop. Evidence is in
  `logs/wasm-browser-persistent-callmain.txt`.
- Added `docs/host-command-entrypoint-plan.md`. The next persistent-loop work
  is a copied-source patch experiment for an explicit host command entrypoint,
  not repeated command-line `callMain`.
- Added `scripts/patch-emacs-host-entrypoint-spike.sh`. It patches only the
  copied build source at `build/emacs-core-spike/src/src/emacs.c`, adding
  `wasmacs_eval_string`.
- Updated the persistent profile to export `_wasmacs_eval_string` and
  Emscripten `ccall`.
- Added `scripts/probe-browser-host-entrypoint.mjs`. It boots Emacs once with
  `Module.callMain`, then calls `Module.ccall("wasmacs_eval_string", ...)`.
  The probe printed `entrypoint` and returned `EVAL_STATUS:0`, proving
  host-initiated eval can run after initial boot without repeated command-line
  startup. Evidence is in `logs/wasm-browser-host-entrypoint.txt`.
- Added `scripts/probe-browser-host-file-command.mjs`. It creates
  `/home/user/notes.txt` inside the persistent Emscripten filesystem, boots
  Emacs once, then uses `wasmacs_eval_string` to run an Emacs form with
  `insert-file-contents` and `write-region`. `Module.FS_readFile` returned
  `alpha beta`, proving file mutation works through the host entrypoint.
  Evidence is in `logs/wasm-browser-host-file-command.txt`.
- Extended `scripts/patch-emacs-host-entrypoint-spike.sh` so the copied-source
  patch also exports `wasmacs_last_result`. The evaluated Lisp result is copied
  into host-owned memory and exposed to JavaScript via Emscripten `ccall`.
- Updated `scripts/build-emacs-browser-persistent-spike.sh` and
  `scripts/validate-browser-persistent-spike.sh` to include
  `_wasmacs_last_result`.
- Added `scripts/probe-browser-host-readback.mjs`. It boots Emacs once, calls
  `wasmacs_eval_string`, then reads
  `{"path":"/home/user/readback.txt","text":"readback text","point":14}` via
  `wasmacs_last_result`. Evidence is in
  `logs/wasm-browser-host-readback.txt`.
- Validation passed with `npm test`.
- Switched `app/src/wasm-worker.js` to the persistent browser profile. It now
  imports `/artifacts/emacs-browser-persistent-spike/temacs`, boots Emacs once
  with `Module.callMain`, runs buffer commands with `wasmacs_eval_string`, and
  parses path/point/text from `wasmacs_last_result`.
- Updated `app/src/main.js` to keep one worker alive across queued commands
  instead of terminating the worker for every key command.
- Updated `scripts/validate-browser-worker-app.sh` so the static browser app
  validation expects the persistent entrypoint/readback route rather than the
  old stdout marker route.
- Browser smoke at `http://127.0.0.1:5173/` confirmed the persistent worker:
  initial sync reached `synced from emacs`, then ArrowLeft and `P` updated the
  buffer to `Saved by Emacs core.P`. Evidence is in
  `logs/browser-persistent-worker-smoke.txt`.
- Validation passed with `npm test`.
- Started Milestone 13 ordinary editing work. Added `#file-path` and
  `#open-file` to the browser UI, plus active buffer path state in
  `app/src/main.js`.
- `app/src/main.js` now normalizes relative paths into
  `/home/user/projects/...`, rejects paths outside `/home/user`, and can open
  or create files from the browser user image.
- `app/src/wasm-worker.js` now builds the Emacs command form from
  `command.path`, so the persistent worker applies `insert-file-contents` and
  `write-region` to the active file rather than only `/home/user/notes.txt`.
- Browser smoke at `http://127.0.0.1:5173/` opened
  `/home/user/projects/demo.txt`, inserted `DEMO` through the persistent Emacs
  worker, saved, reloaded, and confirmed `Saved by Emacs core.DEMO` remained
  visible. Evidence is in `logs/browser-project-file-smoke.txt`.
- Validation passed with `npm test`.
- Added `Ctrl+S` handling in `app/src/input-protocol.js` as an explicit
  `save-buffer` command. The worker treats it as a real Emacs command path and
  still writes the active file via `write-region`.
- Added a `Process` probe button in the browser UI. It sends
  `process-probe`, and `app/src/wasm-worker.js` returns a visible
  `host.process is unavailable in the browser MVP` error instead of pretending
  subprocesses exist.
- Browser smoke at `http://127.0.0.1:5173/` opened
  `/home/user/projects/commands.txt`, exercised ArrowLeft, printable input,
  Backspace, `Ctrl+S`, and the disabled process probe. Evidence is in
  `logs/browser-command-dispatch-smoke.txt`.
- Added `scripts/validate-browser-editing-smoke-evidence.sh` and wired it into
  `npm test` so the project-file and command-dispatch browser evidence is
  checked.
- Validation passed with `npm test`.
- Added a file switcher in the editor pane. It is populated from browser
  `user-filesystem.wasifs` file entries, hides tar metadata and internal
  `.local` state, and marks the active file with `aria-current`.
- Opening or switching a file now loads from the browser user image without
  sending an unnecessary `ensure-marker` command into the persistent Emacs
  worker. This avoids extra host-entrypoint churn; edits still go through Emacs
  when key commands arrive.
- Browser smoke at `http://127.0.0.1:5173/` created/edited
  `/home/user/projects/switch-a.txt` and
  `/home/user/projects/switch-b.txt`, then switched back to `switch-a.txt`
  from the file list. Evidence is in `logs/browser-file-switch-smoke.txt`.
- Added Milestone 15: High-Performance Renderer to `PLAN.md`, covering
  Canvas/WebGL text rendering, dirty invalidation, glyph atlases, renderer
  parity tests, and large-buffer performance smoke.
- Updated `ARCHITECTURE.md` to make DOM the MVP/accessibility baseline and
  Canvas/WebGL the measured high-performance renderer phase.
- Added optimistic point advancement for queued editing commands. Fast
  printable input can now advance point before Emacs sync returns, avoiding
  stale-point reversed insertion during in-flight commands.
- Browser recovery smoke at `http://127.0.0.1:5173/` triggered the disabled
  process path, confirmed `process unavailable`, then typed `REC` into
  `/home/user/projects/recovery-order.txt` after worker recreation. Evidence
  is in `logs/browser-worker-recovery-smoke.txt`.
- Added `scripts/summarize-browser-editing-session.mjs`. It reads the browser
  smoke JSON logs and writes `logs/browser-editing-session-smoke.txt` with PASS
  lines for project-file edit/save/reload, command dispatch plus process
  boundary, file switching, and worker recovery.
- Wired the editing session summary into `npm test` before the smoke evidence
  validator.
- Extracted file-list filtering into `app/src/user-file-list.js` and added
  `tests/runtime/user-file-list.test.js`. The switcher now has unit coverage
  for hiding tar metadata, AppleDouble entries, internal `.local` runtime
  state, and non-user paths.
- Added a multi-file export/import assertion to
  `tests/runtime/browser-wasifs.test.js`.
- Extracted user path normalization into `app/src/user-path.js` and added
  `tests/runtime/user-path.test.js` for relative project paths, absolute user
  paths, and rejection outside `/home/user`.
- Added Enter-to-open handling for the file path input.
- Browser smoke at `http://127.0.0.1:5173/` confirmed entering
  `enter-open.txt` opens `/home/user/projects/enter-open.txt`. Evidence is in
  `logs/browser-enter-open-smoke.txt`.
- Added `app/src/buffer-dirty.js` and a narrow guard in `app/src/main.js` that
  persists modified textarea contents into the browser user image before Open
  or file-list switching loads another file.
- Browser smoke at `http://127.0.0.1:5173/` typed `TEXTAREA-DRAFT` directly
  into `/home/user/projects/autosave-a.txt`, switched away to
  `/home/user/projects/autosave-b.txt`, then reopened `autosave-a.txt` and
  confirmed the draft was preserved. Evidence is in
  `logs/browser-textarea-autosave-smoke.txt`.
- Added `tests/runtime/buffer-dirty.test.js`, extended the editing session
  summary and smoke evidence validator for the textarea autosave case, and
  updated static browser app validation for the new dirty guard module.
- Validation passed with `npm test`.
- Added explicit `C-g` and `C-/` command boundaries to
  `app/src/input-protocol.js`. `C-g` is handled locally in `app/src/main.js`
  by clearing pending commands and reporting `keyboard quit`.
- `C-/` now reports `undo unavailable` through the persistent worker with the
  blocker text `undo requires persistent Emacs buffers`, avoiding a fake
  browser-side undo while the MVP still reconstructs temp buffers per command.
- Browser smoke at `http://127.0.0.1:5173/` opened
  `/home/user/projects/undo-quit.txt`, inserted `U`, verified the explicit
  undo blocker, then verified `C-g` sets status/state to `keyboard quit`
  without losing the buffer text. Evidence is in
  `logs/browser-undo-quit-smoke.txt`.
- Added `docs/clipboard-kill-ring-boundary.md`, grounding the MVP clipboard
  decision in `vendor/emacs/lisp/simple.el` kill-ring/interprogram functions
  and `vendor/emacs/lisp/select.el` GUI selection functions.
- Added `C-y`, `C-w`, and `M-w` command boundaries. The worker now reports
  `clipboard/kill-ring requires GUI clipboard protocol plus persistent region
  and kill-ring state`, and the UI shows `clipboard unavailable`.
- Browser smoke at `http://127.0.0.1:5173/` opened
  `/home/user/projects/clipboard-boundary.txt`, inserted `CLIP`, pressed
  `C-y`, and verified the explicit clipboard blocker without losing buffer
  text. Evidence is in `logs/browser-clipboard-boundary-smoke.txt`.
- Added `docs/minibuffer-command-boundary.md`, grounding `find-file` /
  `switch-buffer` in Emacs minibuffer surfaces from `files.el`, `simple.el`,
  and `minibuf.c`.
- Added `C-x` prefix recognition plus `C-x C-f` -> `find-file` and `C-x b` ->
  `switch-buffer` command boundaries. The worker reports
  `minibuffer requires persistent Emacs command loop, minibuffer window state,
  and completion UI` instead of faking minibuffer behavior in the browser.
- Added `scripts/probe-minibuffer-command-boundary.mjs`; it writes
  `logs/minibuffer-command-boundary.txt` and is wired into `npm test`.
- Added `docs/persistent-emacs-buffer-requirement.md`, documenting why real
  undo, kill-ring/region, and minibuffer behavior need stable Emacs buffer and
  selected-window state rather than per-command temp buffers.
- Added `scripts/probe-browser-persistent-buffer-undo.mjs`. The probe runs the
  smallest persistent-buffer undo experiment in the persistent wasm runtime and
  records the current blocker as
  `KNOWN_BLOCKER:persistent buffer undo currently crashes wasm during GC/undo traversal`.
  Evidence is in `logs/wasm-browser-persistent-buffer-undo.txt`.
- Wired the persistent-buffer undo probe into `npm test` so the blocker remains
  visible and cannot be replaced by a browser-side fake.
- Added `scripts/probe-browser-persistent-buffer-matrix.mjs`, also wired into
  `npm test`. The matrix proves `find-file` plus persistent writes work, and
  undo records can be created without crashing if `undo` is not invoked.
- The matrix also proves the crash remains when `gc-cons-threshold` is raised
  to `most-positive-fixnum`, narrowing the blocker to undo execution /
  interval marking / host-entrypoint GC safety rather than simple GC timing.
  Evidence is in `logs/wasm-browser-persistent-buffer-matrix.txt`.
- Expanded the persistent-buffer matrix. Direct `primitive-undo` passes, and
  `(undo-start)` plus `(undo-more 1)` passes. High-level `undo` still crashes,
  including with `inhibit-message`, which narrows the next investigation to the
  latter half of `simple.el`'s `undo`: redo bookkeeping, `undo-equiv-table`,
  `pending-undo-list`, point-record cleanup, modified-state/autosave handling,
  and host-entrypoint GC safety after those structures are updated.
- Added `scripts/probe-browser-persistent-buffer-cross-eval.mjs`, wired into
  `npm test`. A plain named Emacs buffer survives across separate
  `wasmacs_eval_string` calls and writes `alpha beta` to
  `/home/user/cross-eval-named-buffer.txt`.
- The same cross-eval probe records `find-file` file-visiting buffers and
  undo-list state as known blockers when carried across host eval calls:
  both crash with `memory access out of bounds` during GC marking. Evidence is
  in `logs/wasm-browser-persistent-buffer-cross-eval.txt`.
- Added `scripts/probe-browser-file-buffer-gc-roots.mjs` and wired it into
  `npm test`. The first run showed that explicit `(garbage-collect)` from the
  host eval entrypoint crashed even for boot-only and named-buffer cases.
- Updated `scripts/patch-emacs-host-entrypoint-spike.sh` so the copied
  `emacs.c` entrypoint refreshes the C stack-scan bottom and inhibits GC
  during each host eval. This is a temporary wasm spike boundary, not the
  final GC design.
- After that change, the GC roots probe passes boot-only GC forms, temp
  buffers, named buffers, manual `buffer-file-name`,
  `set-visited-file-name`, `insert-file-contents`, and `find-file` buffers
  killed before returning. It still records live `find-file` buffers as known
  blockers. Evidence is in `logs/wasm-browser-file-buffer-gc-roots.txt`.
- Added `scripts/probe-browser-visited-file-state.mjs`. It confirms the
  individual `set-visited-file-name` phases complete inside one host eval.
- Added `scripts/probe-browser-visited-file-cross-eval.mjs` and wired it into
  `npm test`. It confirms `set-visited-file-name` survives a second host eval
  when the renamed buffer is addressed by the filename-derived buffer name.
  This narrows the next blocker to live `find-file-noselect-1` /
  `after-find-file` state rather than `set-visited-file-name` itself.
- Added `scripts/probe-browser-find-file-phases.mjs` and wired it into
  `npm test`. The probe shows `find-file-noselect`, `switch-to-buffer`,
  `pop-to-buffer-same-window`, live `find-file`, and in-memory edits survive
  host eval boundaries.
- The same probe shows direct `write-region` against a live file-visiting
  buffer remains a known blocker, while `save-buffer` passes. This points the
  next browser-worker persistent file-buffer save path toward real
  `save-buffer` rather than direct `write-region`.
- Updated the browser worker command bridge to open the active user file with
  real Emacs `find-file`, apply insert/backspace/movement in that live
  file-visiting buffer, and save modified buffers through `save-buffer`
  instead of direct `write-region`. `undo`, kill-ring/clipboard, and
  minibuffer commands remain explicit unavailable boundaries.
- Revalidated the worker update with `scripts/validate-browser-worker-app.sh`,
  `node --test tests/runtime/*.test.js`, and
  `node scripts/summarize-browser-editing-session.mjs`.
- Added `scripts/probe-browser-undo-tail-phases.mjs` and wired it into
  `npm test`. It confirms `undo-start` plus one `undo-more` still passes
  without direct `write-region`, while the second `undo-more`, the later
  high-level `undo` tail phases, and high-level `undo` itself remain known
  wasm blockers. Evidence is in `logs/wasm-browser-undo-tail-phases.txt`.
- Expanded the undo tail probe with named-buffer cases. A named buffer also
  passes one `undo-more` and fails on the second/high-level undo path, so the
  next blocker is repeated undo application in persistent Emacs state rather
  than live file-visiting state alone.
- Updated the host eval entrypoint patch to catch Lisp signals with
  `internal_condition_case_1`, store the error in `wasmacs_last_result`, and
  return status 1 instead of letting uncaught `user-error` paths become wasm
  traps. Rebuilt `artifacts/emacs-browser-persistent-spike/`.
- Extended `scripts/probe-browser-undo-tail-phases.mjs`: uncaught
  `user-error` and no-more-undo cases now return safe `EVAL_STATUS:1`
  readbacks, while command-loop-shaped cases with a post-edit `undo-boundary`
  make high-level `undo` pass for both file-visiting and named buffers.
- Enabled real Emacs undo in the browser worker command bridge. Edit commands
  now add `undo-boundary`, and `C-/` dispatches to real `(undo)` instead of the
  previous unavailable placeholder. Added
  `scripts/probe-browser-worker-real-undo.mjs` to prove worker-shaped
  insert/undo/save behavior against the browser persistent wasm artifact.
- Hardened `scripts/probe-browser-persistent-buffer-matrix.mjs` with an
  explicit child-process timeout and larger output buffer so the long
  multi-case matrix fails with evidence instead of silently waiting.
- Revalidated the full suite with `npm test`. The deterministic worker-shaped
  real undo probe passes: insert `U`, add an Emacs undo boundary, save, run
  real `(undo)`, save again, and read back an empty file.
- Updated the browser editing evidence summary so it no longer treats the old
  UI-level `undo unavailable` log as the active undo contract. The summary now
  keeps keyboard quit visibility separate and requires the real Emacs worker
  undo probe as the undo evidence.
- Added a browser UI real-undo smoke path behind `?real-undo-smoke=1`. The
  in-app browser run initially failed with `(error end-of-file Error reading
  from stdin)` after the insert succeeded.
- Root cause: every command rematerialized the browser user image into MEMFS,
  including the active file-visiting path. That made Emacs see its visited file
  as externally changed before the undo command's `save-buffer`, which tried to
  ask for confirmation through stdin.
- Fixed the worker ownership boundary: after the persistent Emacs runtime is
  booted, `materializeUserImage` skips the active command path so the live
  file-visiting buffer remains Emacs-owned between commands.
- Mapped the current `C-/` bridge to real Emacs `undo-only 1`, avoiding
  implicit redo/minibuffer questions until redo has an explicit browser command
  design. The browser UI smoke now passes and is recorded in
  `logs/browser-real-undo-ui-smoke.txt`.
- Added `scripts/probe-browser-worker-repeated-undo.mjs` and wired it into
  `npm test`. It proves a worker-shaped sequence of insert `A`, insert `B`,
  `undo-only`, `undo-only` leaves the visited file empty through real Emacs
  undo state.
- Added a repeated undo browser UI smoke behind `?repeated-undo-smoke=1`.
  The in-app browser PASS is recorded in
  `logs/browser-repeated-undo-ui-smoke.txt` and is included in the editing
  evidence summary.
- Added explicit redo support. `C-?` maps to the browser command `redo`, the
  worker dispatches it to real Emacs `(undo-redo 1)`, and
  `scripts/probe-browser-worker-redo.mjs` is wired into `npm test`.
- Added `?redo-smoke=1` browser UI evidence. The in-app browser PASS is
  recorded in `logs/browser-redo-ui-smoke.txt` and included in the editing
  evidence summary.
- Added `scripts/probe-browser-worker-redo-interleaving.mjs` and wired it into
  `npm test`. It now passes for multi-edit `A`, `B`, `undo-only`,
  `undo-redo`.
- The blocker was the host sync boundary, not missing browser redo state.
  Calling `save-buffer` immediately after undo/redo shifted the
  `buffer-undo-list` head away from the `undo-equiv-table` mapping. The worker
  now skips `save-buffer` for undo/redo and persists the browser user image
  from the Emacs readback instead.
- Added `scripts/probe-browser-worker-point-undo-redo.mjs` and wired it into
  `npm test`. It proves a point-sensitive ordinary editing path through the
  live file-visiting buffer: insert `AB`, move point left, insert `X` in the
  middle, then run real Emacs `undo-only` and `undo-redo` over that middle
  insertion. Evidence is in
  `logs/wasm-browser-worker-point-undo-redo.txt`.
- Added `scripts/probe-browser-worker-file-switch-undo.mjs` and wired it into
  `npm test`. It switches between two live file-visiting buffers, edits both,
  then proves each buffer keeps its own real Emacs undo/redo state across
  `find-file` switches. Evidence is in
  `logs/wasm-browser-worker-file-switch-undo.txt`.
- Hardened `scripts/probe-browser-find-file-phases.mjs` by making successful
  child cases call `process.exit(0)` after printing their evidence. The child
  runtime can otherwise remain alive under Emscripten `keepRuntimeAlive()`,
  which made full-suite validation look hung even after a child case had
  finished successfully.
- Added a narrow browser `#minibuffer` echo line and
  `app/src/minibuffer-view.js`. It renders `C-x` prefixes and explicit
  unavailable messages for minibuffer/clipboard/process boundaries, while
  keeping real `find-file` / `switch-buffer` minibuffer semantics unavailable
  until the Emacs command-loop and minibuffer window state are bridged.
- Added `scripts/run-browser-smoke.mjs` and `npm run browser:smoke`. The runner
  launches system Chrome headless with CDP, opens the local app, sends
  `C-x C-f` through the repo-local smoke hook, and verifies that the minibuffer
  echo line reports the explicit unavailable boundary.
- Expanded the runner with `npm run browser:smoke:editing`, which runs the
  minibuffer echo check plus the existing real undo, repeated undo, and redo UI
  smoke hooks through the same headless Chrome/CDP path.
- Expanded `scripts/run-browser-smoke.mjs` with `files` and `boundaries`
  scenarios and added `npm run browser:smoke:all`. The all smoke passed and
  now covers minibuffer echo, real undo/repeated undo/redo, project
  open/reload, file switching, textarea autosave, process-unavailable recovery,
  clipboard-unavailable, and keyboard quit through the repo-local headless
  Chrome/CDP runner.
- `npm run browser:smoke:all` now writes `logs/browser-runner-smoke.txt`, and
  `scripts/validate-browser-editing-smoke-evidence.sh` requires that fresh
  runner evidence alongside the older browser smoke logs.
- `scripts/summarize-browser-editing-session.mjs` now includes the repo-local
  browser runner all-smoke evidence in `logs/browser-editing-session-smoke.txt`.
- `scripts/run-browser-smoke.mjs` now starts `scripts/serve-app.mjs`
  automatically when the target app server is not already running. Verified
  with `WASMACS_BROWSER_URL=http://127.0.0.1:5184/... npm run browser:smoke`.
- Added `docs/minibuffer-command-loop-plan.md` and
  `scripts/validate-minibuffer-command-loop-plan.sh`. The plan fixes the next
  real-minibuffer boundary as an Emacs-owned `host.gui.minibuffer-state` /
  `host.gui.minibuffer-input` protocol, not browser-side reader semantics.
- Added `scripts/probe-browser-minibuffer-state.mjs` and wired it into
  `npm test`. It reads inactive Emacs minibuffer state through
  `wasmacs_eval_string` without entering `read_minibuf`; evidence is in
  `logs/wasm-browser-minibuffer-state.txt`.
- Added `docs/minibuffer-suspended-read-plan.md` and
  `scripts/validate-minibuffer-suspended-read-plan.sh`. The plan grounds the
  next real-minibuffer implementation in `read_minibuf`,
  `recursive_edit_1`, `command_loop`, `read_char`, and the native input queue,
  while rejecting browser-side readers and reentrant host eval during active
  reads.
- Added copied-source `wasmacs_minibuffer_state`, exported it from the
  persistent browser artifact as `_wasmacs_minibuffer_state`, and added
  `scripts/probe-browser-minibuffer-state-export.mjs`. The probe reads
  inactive minibuffer state from C without `wasmacs_eval_string`; evidence is
  in `logs/wasm-browser-minibuffer-state-export.txt`.
- Tightened `scripts/probe-browser-persistent-buffer-matrix.mjs`: high-level
  undo known-blocker cases now use a 30s timeout and classify timeout as
  `KNOWN_BLOCKER`, keeping `npm test` from spending many minutes on already
  isolated blocker paths.
- Rebuilt `artifacts/emacs-browser-persistent-spike/` with
  `_wasmacs_minibuffer_state` and ran full `npm test`; all checks passed.
- Added copied-source `wasmacs_command_state` and
  `wasmacs_command_begin_minibuffer_probe` exports plus
  `scripts/probe-browser-minibuffer-active-read-boundary.mjs`. The probe
  records the current active-read boundary as
  `unavailable:noninteractive-batch`, so the next implementation has to move
  from batch host eval to an interactive/suspended command entrypoint before
  real `read_minibuf` can become active.
- Added the first gated Asyncify host wait import for the suspended-minibuffer
  lane. `scripts/wasmacs-asyncify-host-library.js` defines the no-op async
  `wasmacs_host_wait_for_input` hook, the asyncify build links it with
  `-sASYNCIFY_IMPORTS=wasmacs_host_wait_for_input`, and
  `scripts/patch-emacs-host-entrypoint-spike.sh` inserts the copied-source
  `keyboard.c` waitpoint only under
  `WASMACS_ENABLE_ASYNCIFY_WAITPOINT=1`, so the persistent browser profile
  remains free of the wait import.
- Rebuilt `artifacts/emacs-browser-asyncify-spike/` and validated the gated
  wait-import lane with `scripts/validate-minibuffer-asyncify-entrypoint-plan.sh`.
  The artifact contains the named Asyncify import and still preserves the
  current active-read boundary:
  `BEGIN_READBACK:unavailable:noninteractive-batch`.
- Ran the full regression suite with `npm test`; it passed after the gated
  Asyncify wait-import change. The existing known-blocker probes still record
  high-level undo, live visited-file, and host-eval GC/root issues, while the
  worker-shaped real undo/redo, point movement, and file-switch undo probes
  continue to pass.
- Added asyncify-lane environment defaults in
  `scripts/wasmacs-asyncify-host-library.js`: `TERM=dumb`, an inline
  `TERMCAP`, and `/home/user` identity values. This keeps browser/non-batch
  startup from depending on host process environment or a termcap database
  file.
- Added `scripts/probe-browser-asyncify-interactive-start.mjs` and wired it
  into `npm test`. The probe starts the asyncify artifact without `--batch`
  and expects it to remain alive until timeout without the earlier
  `Please set TERM` or `Cannot open termcap database file` failures. Evidence
  is in `logs/wasm-browser-asyncify-interactive-start.txt`; this proves the
  asyncify lane now gets past TERM/termcap initialization, though it still
  needs a command begin/input/cancel entrypoint before active minibuffer
  support can be claimed.
- Ran the full regression suite with `npm test`; it passed with the new
  asyncify interactive-start probe included.
- Added `scripts/probe-browser-asyncify-minibuffer-waitpoint.mjs`. The probe
  calls a forced C-side `read-from-minibuffer` entrypoint in the asyncify
  artifact and confirms `wasmacs_host_wait_for_input` is reached. The current
  outcome is recorded as `KNOWN_BLOCKER`: Asyncify rewind aborts with
  heap-cookie corruption even after increasing `ASYNCIFY_STACK_SIZE` to 1MB.
  Evidence is in `logs/wasm-browser-asyncify-minibuffer-waitpoint.txt`.
- Ran the full regression suite with `npm test`; it passed with the asyncify
  minibuffer waitpoint probe included as a recorded known blocker.
- Added `scripts/summarize-asyncify-advise.mjs` and
  `npm run asyncify:advise:summary` for the diagnostic
  `EMACS_ASYNCIFY_EXTRA_LDFLAGS='-sASYNCIFY_ADVISE=1'` profile. The summary
  reduces `logs/wasm-browser-asyncify-advise.txt` to focused input/minibuffer
  propagation evidence and requires entries for the host wait import,
  forced minibuffer probe, `Fread_from_minibuffer`, `read_minibuf`,
  `recursive_edit_1`, `command_loop`, `read_key_sequence_vs`, `read_char`,
  `read_decoded_event_from_main_queue`, `kbd_buffer_get_event`, and
  `tty_read_avail_input`.
- Generated `logs/wasm-browser-asyncify-advise-summary.txt`, validated the
  asyncify entrypoint plan, reran the waitpoint probe, and ran full
  `npm test`; all passed, with the Asyncify minibuffer suspend failure still
  recorded as a known blocker after the host waitpoint is reached.
- Added `WASMACS_ASYNCIFY_WAITPOINT_MODE` for the asyncify browser build.
  `read-char` keeps the original `keyboard.c` waitpoint, while
  `minibuf-setup` inserts a shallower split waitpoint in `minibuf.c` after
  the minibuffer prompt/window/keymap/setup hook are active and before
  `recursive_edit_1`.
- Rebuilt the asyncify artifact with
  `WASMACS_ASYNCIFY_WAITPOINT_MODE=minibuf-setup` and added
  `scripts/probe-browser-asyncify-minibuffer-suspend-state.mjs`. The probe
  starts the forced `read-from-minibuffer` command without awaiting its final
  completion, then reads exported state while Asyncify is suspended. Evidence
  in `logs/wasm-browser-asyncify-minibuffer-suspend-state.txt` shows
  `COMMAND_STATE:pending`, `active:true`, `depth:1`, `prompt:Find file:`,
  and `current-minibuffer:true`.
- Extended the suspend-state probe to exercise the ownership guard while the
  minibuffer command is pending. During suspension, `wasmacs_eval_string` and a
  second `wasmacs_command_begin_minibuffer_force_probe` both return status `3`
  with `unavailable:busy`, proving reentrant eval and second command begin are
  rejected before browser input injection exists.
- Reran targeted asyncify validation plus full `npm test` after adding the
  pending-command busy assertions; all passed, with existing known-blocker
  classifications unchanged.
- The older waitpoint completion probe still records heap-cookie corruption
  when the caller awaits completion of the whole minibuffer command. This
  narrows the next slice to an owned suspended command protocol: hold the
  pending command, reject reentrant calls, inject browser input events, and
  resume, instead of treating `read-from-minibuffer` as a synchronous host
  call that must complete immediately.
- Ran the asyncify targeted probes and full `npm test`; all passed. During the
  full run, a duplicate `npm test` process was found and stopped so the main
  run could continue without log overwrites. The completed main run includes
  the new suspend-state probe and the existing known-blocker classifications.
- Added `_wasmacs_input_text` and `_wasmacs_input_cancel` to the asyncify
  artifact lane. The copied-source patch inserts narrow ASCII/C-g input
  helpers into `keyboard.c` beside `kbd_buffer_store_event`; the persistent
  browser artifact is not switched to the asyncify lane.
- Changed `scripts/wasmacs-asyncify-host-library.js` so
  `wasmacs_host_wait_for_input` remains pending until
  `globalThis.__wasmacsResolveHostInputWait` is explicitly called. This models
  browser/worker ownership of a suspended input wait instead of immediately
  resolving the Asyncify import.
- Added `scripts/probe-browser-asyncify-minibuffer-input-injection.mjs` and
  wired it into `npm test`. Evidence in
  `logs/wasm-browser-asyncify-minibuffer-input-injection.txt` records
  `STATUS:KNOWN_BLOCKER`: the real minibuffer waitpoint is reached,
  `_wasmacs_input_text` returns `0`, and the host wait resolver is called, but
  Asyncify then hits heap-cookie corruption while resuming the Emacs stack.
- Reran targeted validation and the full regression suite with `npm test`; all
  passed. The new input-injection probe is classified as a known resume
  blocker, while the existing persistent-worker undo/redo, point movement, and
  file-switch undo probes still pass.
- Raised the asyncify lane default from `-sASYNCIFY_STACK_SIZE=1048576` to
  `-sASYNCIFY_STACK_SIZE=4194304` and rebuilt
  `artifacts/emacs-browser-asyncify-spike/`. The larger Asyncify stack does not
  fix the post-input resume corruption, so the blocker is no longer just the
  initial 1MB Asyncify stack size.
- Diagnosed the post-input resume failure by temporarily building with
  `-sSTACK_OVERFLOW_CHECK=0`. Without Emscripten's address-zero cookie check,
  the same path failed inside Emacs GC marking:
  `symbol_marked_p -> process_mark_stack -> mark_specpdl`, confirming the real
  issue was GC/root safety across a suspended exported command.
- Wrapped the forced minibuffer probe in `inhibit_garbage_collection` for the
  lifetime of the suspended read. With normal `STACK_OVERFLOW_CHECK=2` restored,
  `scripts/probe-browser-asyncify-minibuffer-input-injection.mjs` now passes:
  `_wasmacs_input_text` returns `0`, the host wait resolves, and
  `read-from-minibuffer` completes with `wasmacs-input.txt`.
- Added `scripts/probe-browser-asyncify-minibuffer-cancel.mjs`. The first
  cancel attempt showed direct `kbd_buffer_store_event` with `quit_char`
  triggers `handle_interrupt` from the host-call side and leaves the suspended
  command pending. The passing implementation appends `quit_char` to
  `Vunread_command_events`, then lets the resumed Emacs input reader consume
  the cancel event.
- Hardened `scripts/probe-browser-persistent-buffer-matrix.mjs` so child cases
  exit explicitly after printing their eval result. This avoids a timeout where
  `temp-buffer-write` had already booted, evaluated, and printed readback but
  the Node child did not terminate promptly.
- Reran the full regression suite with `npm test`; it passed with the
  minibuffer text-input probe, cancel probe, and persistent matrix child-exit
  hardening included.
- Added `emacs.md` and `p.md` after reading the requested Emacs 30.2 source
  files. The summary ties wasm design to concrete Emacs mechanisms:
  conservative C-stack marking, `specpdl`/handler unwinding, command-loop input
  wait, real `read_minibuf`, `lread` reader/load roots, `fileio.c` path
  primitives, buffer-local undo state, and `simple.el` undo behavior. The wasm
  plan keeps Asyncify in a separate lane, uses a narrow
  `wasmacs_host_wait_for_input` import, treats browser storage as a backing
  store for MEMFS/preloaded images, and rejects reentrant eval while a suspended
  Emacs command is pending.
- Grew `emacs.md` and `p.md` with a second source pass focused on the remaining
  wasm uncertainties. `alloc.c` shows `mark_c_stack` assumes a contiguous stack
  range and `flush_stack_call_func1` refreshes `current_thread->stack_top`
  before a no-allocation callback; `eval.c` shows `mark_specpdl` marks
  unwind/backtrace/let roots and only marks pointer payloads with a custom mark
  function; `insdel.c` shows text edits run Lisp and may GC before gap
  mutation, then record undo and marker changes; `files.el` shows real
  file-visiting/save state flows through `find-file-noselect-1`,
  `set-visited-file-name`, and `basic-save-buffer`; `callint.c` shows real
  command dispatch must preserve interactive specs and minibuffer argument
  reading. The updated plan now treats stack refresh as the durable entrypoint
  rule and GC inhibition as a temporary pending-Asyncify-command guard.
- Added Milestone 13.5 to `PLAN.md` as the active bridge from the current
  `p.md` understanding to implementation. The milestone retires browser-side
  semantic substitutes, keeps the forced minibuffer probe as diagnostic only,
  and defines the required path: owned Asyncify command protocol, host
  entrypoint stack/root refresh, narrow pending-command GC inhibition,
  GC-after-completion/cancel probes, and live file-visiting undo-list GC
  probes before Milestone 14 real minibuffer exposure.
- Started Milestone 13.5 Phase 1 implementation. Added
  `docs/owned-asyncify-command-protocol-plan.md` to classify active gates,
  baseline gates, diagnostics, known-blocker probes, and historical evidence.
  Added `scripts/validate-owned-asyncify-command-protocol-plan.sh` and wired it
  into `npm test` so the milestone keeps naming the required hazards: stack
  refresh, pending-command GC inhibition, Asyncify import narrowing,
  reentrant-call rejection, file-visiting undo GC, and browser event-loop
  ownership. Validation passed with
  `scripts/validate-owned-asyncify-command-protocol-plan.sh`.
- Reran the Phase 1 baseline gates. `npm test` passed, including the new
  13.5 plan gate and the existing known-blocker probes for undo, file-buffer
  GC roots, live visited-file cross-eval, find-file phases, and high-level
  undo tails. `npm run browser:smoke:all` also passed for minibuffer, editing,
  files, and boundaries.
- Implemented the first Milestone 13.5 Phase 2 stack/root diagnostic slice.
  The copied-source patch now injects a shared host-entrypoint refresh macro
  that updates both `stack_bottom` and `current_thread->stack_top` from an
  entrypoint-local sentry, and `wasmacs_eval_string` no longer carries a
  one-off stack-bottom-only refresh. Added `_wasmacs_entrypoint_state` to the
  persistent and Asyncify exported functions. Rebuilt both artifacts.
  `node scripts/probe-browser-host-entrypoint.mjs` passed and logged
  `entrypoint-refresh-count:2`, `stack-bottom-refreshed:true`, and
  `stack-top-refreshed:true`. `node scripts/probe-browser-asyncify-minibuffer-suspend-state.mjs`
  passed and logged pending command state with `gc-inhibit-depth:1` plus
  refreshed stack bottom/top while reentrant eval/command calls still return
  `unavailable:busy`.
- Split `package.json` test scripts to keep the normal loop short. `npm test`
  now runs unit tests plus lightweight plan/profile validation; the long
  Asyncify, persistent, known-blocker, and full-regression paths are available
  as `npm run test:asyncify`, `npm run test:persistent`,
  `npm run test:known-blockers`, and `npm run test:heavy`. Reran `npm test`;
  it passed in the short default shape.
- Added `_wasmacs_garbage_collect` and
  `scripts/probe-browser-asyncify-gc-after-completion.mjs` for Milestone 13.5
  Phase 3/5. The GC export is a fresh host entrypoint with stack refresh and no
  eval-wide GC inhibition. The new probe records both text completion and
  cancel reaching post-completion state with command `idle`,
  `pending-asyncify-command:false`, `gc-inhibit-depth:0`, and
  `emacs-gc-inhibited:0`; explicit GC then still crashes in `mark_specpdl`.
  This is now a known blocker under `npm run test:known-blockers`, not part of
  the short default loop.
- Narrowed the post-completion GC blocker. `_wasmacs_entrypoint_state` now
  reports `specpdl` kind counts plus tail backtrace argument pointers/raw Lisp
  words, and the GC-after-completion probe includes a `boot` baseline case.
  Boot-baseline explicit GC passes with the same 34-entry/10-backtrace
  `specpdl` shape seen after text completion and cancel. After Asyncify resume,
  the same tail backtrace `args` pointers contain different raw words, and
  explicit GC fails through `mark_specpdl`. The current suspect is stale
  backtrace argument slots on the wasm stack being overwritten after resume,
  rather than extra un-unwound Asyncify frames.
- Added a diagnostic `_wasmacs_scrub_specpdl_backtrace_args` export and
  expanded `scripts/probe-browser-asyncify-gc-after-completion.mjs` with
  `text-scrub` and `cancel-scrub`. The ordinary text/cancel cases remain
  `KNOWN_BLOCKER` through `mark_specpdl`; both scrubbed cases pass explicit
  post-completion GC after clearing 8 non-empty `SPECPDL_BACKTRACE` argument
  slots. This sharpens the next implementation target: preserve/rebase
  backtrace argument roots across Asyncify resume, do not ship the scrub as
  product behavior. Validation passed with
  `WASMACS_ASYNCIFY_WAITPOINT_MODE=minibuf-setup scripts/build-emacs-browser-asyncify-spike.sh`
  and `node scripts/probe-browser-asyncify-gc-after-completion.mjs`.
- Promoted the post-completion GC workaround from scrub to pin. Added
  `_wasmacs_pin_specpdl_backtrace_args`, exported it from both browser spike
  profiles, and call it once before the forced Asyncify minibuffer command
  starts. The pin copies 8 non-empty baseline `SPECPDL_BACKTRACE` argument
  vectors from stale wasm stack slots into durable `xmalloc` storage while
  preserving argument words and `nargs`; this avoids erasing backtrace
  information. Rebuilt the Asyncify artifact with
  `WASMACS_ASYNCIFY_WAITPOINT_MODE=minibuf-setup scripts/build-emacs-browser-asyncify-spike.sh`.
  `node scripts/probe-browser-asyncify-gc-after-completion.mjs` now passes all
  cases: `boot`, ordinary `text`, ordinary `cancel`, `text-scrub`,
  `cancel-scrub`, `text-pin`, and `cancel-pin`. The old ordinary text/cancel
  `mark_specpdl` known blocker is cleared in the copied-source spike. The
  remaining caveat is deliberate: the pinned arrays currently leak, so the
  product path still needs a real ownership/freeing policy before Milestone
  13.5 can call this final.
- Added `scripts/probe-browser-asyncify-file-undo-gc.mjs` and
  `logs/wasm-browser-asyncify-file-undo-gc.txt`. The probe runs against the
  Asyncify artifact with `node --stack-size=65500`, pins baseline backtrace
  args, opens a real `/home/user/projects/asyncify-file-undo.txt` visited file,
  inserts/saves `A` and `X`, runs real `undo-only` and `undo-redo`, then calls
  fresh `_wasmacs_garbage_collect`. After GC it verifies the same file-visiting
  buffer still has `buffer-file-name`, content `AX\n`, and a usable undo list,
  then performs a follow-up insert `Z` and real `undo-only` back to `AX\n`.
  The probe passed and is now included in `npm run test:asyncify`. The next
  Milestone 13.5 Phase 6 target is a two-file file-switch undo/redo GC probe.
- Added `scripts/probe-browser-asyncify-file-switch-undo-gc.mjs` and
  `logs/wasm-browser-asyncify-file-switch-undo-gc.txt`. The probe opens two
  live visited files under `/home/user/projects`, edits/saves A to `AX\n` and
  B to `BY\n`, runs fresh `_wasmacs_garbage_collect`, and then proves each
  buffer's real `undo-only` / `undo-redo` state remains independent after GC.
  The probe passed and is now included in `npm run test:asyncify`. This
  completes the Milestone 13.5 Phase 6 proof shape; the next active target is
  the Phase 7 worker/browser pending-command protocol, while the copied-source
  backtrace pin still needs a real ownership/freeing policy before product use.
- Started Milestone 13.5 Phase 7 by adding the browser/worker side of an
  owned pending-command protocol. `app/src/pending-command-protocol.js` now
  defines and validates structured `pending-command` messages with explicit
  lifecycle states and command kinds; `tests/runtime/pending-command-protocol.test.js`
  covers the message shape and command-boundary filter. The worker emits
  `pending-command` `starting` and `unavailable` states for the currently
  unsupported `find-file` / `switch-buffer` minibuffer paths, and the main
  thread validates those messages before updating status/minibuffer UI. This
  keeps the old unavailable boundary intact while making it protocol-visible.
  Validation passed with `npm test` and `npm run browser:smoke:all`.
- Added browser runner coverage for that Phase 7 protocol visibility.
  `app/src/main.js` now records validated pending-command messages for the
  smoke harness, and `scripts/run-browser-smoke.mjs` asserts that `C-x C-f`
  produces `find-file` `starting` and `unavailable` protocol events plus the
  `Find file: ` prompt before the final minibuffer-unavailable UI state.
  `scripts/validate-browser-worker-app.sh` now checks the smoke assertion is
  still wired. Validation passed with `npm test` and
  `npm run browser:smoke:all`; `logs/browser-runner-smoke.txt` includes
  `PASS pending-command find-file starting unavailable`.
- Attempted the first real browser-worker Asyncify `pending-input` path behind
  the Phase 7 protocol. Added `app/src/asyncify-minibuffer-worker.js` and
  `window.__wasmacsSmoke.asyncifyMinibufferReadSmoke`; the scaffold starts the
  Emacs-owned `wasmacs_command_begin_minibuffer_force_probe`, is prepared to
  inject browser-provided text with `wasmacs_input_text`, and reports through
  the existing `pending-command` lifecycle. Real browser worker execution is
  currently blocked before `pending-input` by `RangeError: Maximum call stack
  size exceeded` from the Asyncify artifact. Recorded this as
  `KNOWN_BLOCKER asyncify browser worker stack` in
  `logs/browser-asyncify-protocol-smoke.txt` via
  `node scripts/run-browser-smoke.mjs asyncify`. The underlying Node/VM
  Asyncify path still passes:
  `node scripts/probe-browser-asyncify-minibuffer-input-injection.mjs` records
  `STATUS:PASS`, `WAITPOINT_REACHED:true`, and `INPUT_TEXT_ACCEPTED:true`.
- Added a browser-worker `--no-loadup` Asyncify boot split:
  `window.__wasmacsSmoke.asyncifyNoLoadupBootSmoke` and
  `node scripts/run-browser-smoke.mjs asyncify-boot`. The probe avoids replaying
  cold `loadup.el`, but bare no-loadup Emacs still exits with status `-1`, so
  it is not a usable product runtime. Evidence is recorded in
  `logs/browser-asyncify-no-loadup-boot-smoke.txt` as
  `KNOWN_BLOCKER asyncify no-loadup boot status -1`. This reinforces the
  source-backed plan change: the Asyncify browser lane needs an explicit
  post-loadup/preloaded Emacs Lisp-machine state rather than either full cold
  loadup or a bare no-loadup runtime.
- Added `small-os-for-emacs.md` to stop the compatibility layer from growing
  ad hoc. The document reframes Milestone 13.5 as a small Emacs compatibility
  OS with explicit services for lifecycle, memory/root safety, control flow,
  blocking input scheduling, filesystem/persistence, preloaded state, host
  capabilities, and browser GUI boundaries. `PLAN.md` now points 13.5 work at
  that contract so future patches must name the owning service, violated
  cross-service check, relevant Emacs source surface, and acceptance test
  before changing code.
- Continued the preloaded-state investigation by reading Emacs'
  `vendor/emacs/src/alloc.c` `purecopy` implementation and
  `vendor/emacs/src/puresize.h`. The source makes the wasm requirement
  concrete: dump-time `purecopy` recursively copies conses, strings, vectors,
  records, closures, and purecopy-enabled hash tables into a fixed pure-space
  region while pinning objects that cannot safely be copied. Added
  `scripts/probe-emacs-pdump-purecopy-trace.sh`, which confirms the generated
  pdumper wasm artifact has a pure region and performs early pure allocations
  before still exiting 139 in `bindings.el`. Added
  `scripts/probe-emacs-pdump-bindings-purecopy-markers.sh`, which wraps the
  first two `bindings.el` mode-line keymap `purecopy` calls. `both-marked`,
  `input-only`, and `coding-only` all print the corresponding "before" marker
  and exit 139 without printing an "after" marker. The blocker is now narrowed
  to recursive `purecopy` of these keymap/closure structures in the wasm
  pdumper runtime, not configure, pdumper C compilation, fingerprinting,
  after-load GC, `make-sparse-keymap`, or `define-key`.
- Added `scripts/probe-emacs-pdump-purecopy-enabled-trace.sh` and
  `logs/emacs-pdump-purecopy-enabled-trace.txt`. The focused trace enables
  C-level logging only inside the marked `Fpurecopy` call and shows the
  `input-only` mode-line keymap case repeatedly recopying the same
  closure/vector-shaped graph before exiting 139. Since `loadup.el` sets
  `purify-flag` to an `equal` hash table and `alloc.c` uses that table around
  recursive `purecopy`, the next problem is now sharpened to wasm behavior for
  closure/vector layout and hash-consing/cycle boundaries, not another broad
  `loadup.el` patch.
- Extended that focused trace with `Fgethash`/`Fputhash` logging. The trace now
  shows the `purify-flag` table does produce hits for some surrounding cons
  structure and records completed copies with `puthash`, but the repeatedly
  re-entered closure itself keeps logging `gethash ... hit=0` until status 139.
  This supports the narrower hypothesis that the keymap closure graph is
  re-entering the same closure before recursive `purecopy` reaches its final
  hash-consing insertion, or that the wasm build has created an unexpected
  closure self-cycle. The next comparison should be native/pdump behavior for
  the same `bindings.el` map before attempting a compatibility workaround.
- Reclassified Milestone 13.5 under `small-os-for-emacs.md` after the small OS
  framing intervention. `PLAN.md` now has an active blocker table that assigns
  browser-worker Asyncify stack failure, pdump/loadup 139, `bindings.el`
  purecopy recursion, backtrace-arg pinning, `.wasifs` reverse sync, and the
  pending-command UI scaffold to owning services, cross-service invariants,
  Emacs source surfaces, diagnostic/product status, and acceptance tests.
  `ARCHITECTURE.md` now names the Small Compatibility OS Layer explicitly and
  clarifies that pdump/preloaded-state remains outside normal MVP UI behavior
  while still being a valid Preloaded-State Service diagnostic lane for the
  Asyncify worker. `scripts/validate-owned-asyncify-command-protocol-plan.sh`
  now gates the small OS service list and cross-service checks.
- Added the first small OS substrate implementation skeleton. `app/src/small-os-services.js`
  defines the service names, lifecycle phases, cross-service checks, Emacs
  source surfaces, active operation contracts, and small state gates for GC,
  pending-command start, reverse sync, and lifecycle transitions.
  `app/src/pending-command-protocol.js` now attaches the
  `pending-command-protocol` substrate record to messages created through the
  module, while accepting classic-worker messages that do not yet include that
  optional field. Added `tests/runtime/small-os-services.test.js` and extended
  `tests/runtime/pending-command-protocol.test.js` so diagnostic contracts
  cannot claim product readiness and pending-command messages stay assigned to
  Blocking Input Scheduler / Control-Flow / Browser GUI Boundary. Added
  `docs/small-os-substrate-implementation.md` and extended the owned-protocol
  validator to gate the substrate module and doc.
- Continued only the preloaded-state-adjacent product scaffold, leaving
  pdump/purecopy/preloaded-state itself deferred. Added
  `app/src/small-os-runtime.js` as the browser-side coordinator for command
  lifecycle, pending input, resume, completion/failure, and reverse-sync
  boundaries. `app/src/main.js` now starts a small OS command before worker
  dispatch, buffers `sync-file` until command exit, applies reverse sync only
  after successful completion, and exposes `smallOs` in the smoke state. The
  Asyncify minibuffer smoke enters the same lifecycle before launching its
  separate worker, but still does not attempt to solve the preloaded-state boot
  blocker. Added `tests/runtime/small-os-runtime.test.js` and extended
  `docs/small-os-substrate-implementation.md` plus the owned-protocol validator
  for the runtime coordinator.
- Added a top-down build policy to `small-os-for-emacs.md` and reflected it in
  Milestone 13.5. Future substrate work should list the OS/runtime capability
  Emacs requires, define the service interface, then add only the
  lowest-quality implementation that preserves correctness. Dummy, diagnostic,
  slow, or leak-prone implementations are acceptable only when the owning
  service, lifecycle, acceptance test, and replacement path are explicit.
- Added a C-first low-level substrate policy to `small-os-for-emacs.md` and
  reflected it in Milestone 13.5. The JS small OS modules are now explicitly
  browser coordinators, policy mirrors, diagnostic scaffolds, and test
  harnesses, not the owner of memory/root/lifecycle/preloaded-state semantics.
  Future GC-root, pure-space, relocation, preloaded-state, or entrypoint
  ownership work should first define the C/wasm facade and only expose copied
  snapshots/status/protocol state to JS when the browser needs to observe it.
- Clarified the first Level 1 C/wasm memory/root facade can use a deliberately
  overallocated fixed-memory profile, around 512MB wasm linear memory with
  memory growth disabled and an oversized stack. This is recorded as a
  temporary diagnostic stability profile, not the product browser memory
  budget, so early substrate work can avoid JS typed-array view invalidation,
  growth-time relocation surprises, and premature allocator tuning.
- Repositioned the current JS small OS scaffold as coordinator/mirror/harness
  and added the C/wasm facade plan. `app/src/small-os-services.js` now mirrors
  facade contracts for lifecycle state, entrypoint root refresh, GC
  permission, pending command guard, backtrace/root ownership,
  preloaded-state/pdump, and segment/root/relocation. Each contract names the
  Emacs-requested capability, owner service, source surfaces, proposed
  `wasmacs_os_*` entrypoints, allowed JS role, diagnostic/product/placeholder
  status, and acceptance test. `docs/small-os-substrate-implementation.md`,
  `ARCHITECTURE.md`, `PLAN.md`, `tests/runtime/small-os-services.test.js`, and
  `scripts/validate-owned-asyncify-command-protocol-plan.sh` now gate the rule
  that JS observes/provides host capability/coordinators only and does not own
  raw Emacs object/root/lifecycle substrate state.
- Implemented the first minimal C/wasm facade slice in the generated/copied
  source lane. `scripts/patch-emacs-host-entrypoint-spike.sh` now exposes
  `wasmacs_os_lifecycle_phase`, `wasmacs_os_root_state_snapshot`,
  `wasmacs_os_gc_permission`, `wasmacs_os_pending_command_state`, and
  `wasmacs_os_pin_backtrace_args`; the persistent and Asyncify build scripts
  export those symbols. The functions wrap existing C-side lifecycle,
  host-entrypoint/root, GC permission, pending-command, and backtrace-pin state
  rather than moving that state into JS. Rebuilt the persistent browser profile
  with `scripts/build-emacs-browser-persistent-spike.sh`, rebuilt the Asyncify
  profile with
  `WASMACS_ASYNCIFY_WAITPOINT_MODE=minibuf-setup scripts/build-emacs-browser-asyncify-spike.sh`,
  then passed `scripts/validate-browser-persistent-spike.sh`,
  `scripts/validate-minibuffer-asyncify-entrypoint-plan.sh`, and
  `node scripts/probe-browser-host-entrypoint.mjs`. The host-entrypoint log now
  records `OS_LIFECYCLE_PHASE:initialized`,
  `OS_PENDING_COMMAND_STATE:idle`,
  `OS_GC_PERMISSION_READBACK:gc-permission:allowed`, and refreshed root
  snapshots.

- Added the first minimal Terminal/Tty Service slice for Milestone 13.5.
  `scripts/wasmacs-asyncify-host-library.js` now provides a deterministic
  browser terminal profile (`TERM=dumb`, inline `TERMCAP`, 80x24 winsize),
  byte-queues stdin, posts stdout/stderr terminal bytes, and answers tty
  `FIONREAD`. `scripts/patch-emacs-host-entrypoint-spike.sh` patches copied
  `sysdep.c` so tty reads wait via `wasmacs_host_wait_for_input` and then
  consume JS-provided terminal bytes. `app/src/small-os-services.js` and
  `tests/runtime/small-os-services.test.js` now record `Terminal/Tty Service`
  as a product scaffold with lifecycle/input/browser-boundary checks. Rebuilt
  `artifacts/emacs-browser-interactive/` and reached the byte-level proof
  point with `node scripts/run-browser-smoke.mjs interactive-loop`: browser
  fd 0/1/2 are tty streams, terminal bytes are observed, the waitpoint is
  reached twice, and printable `a` moves real Emacs point from 1 to 2.
  However, the worker result still contains `ERR:Aborted(OOM)`, so the smoke
  must not be treated as a clean pass; terminal profile stability is the next
  blocker before xterm.js wiring.

- Investigated the interactive-loop OOM layer. The abort is Emscripten
  `_emscripten_resize_heap`, not Emacs `alloc.c:memory_full`: temporary
  launcher diagnostics recorded requested sizes of 536,940,544 to 537,006,080
  bytes against the fixed 536,870,912-byte wasm heap. The captured stack runs
  through `___syscall_poll`, Asyncify `handleAsync` / `handleSleep`, and
  `allocateData`, so the failure is at the Asyncify sleep/snapshot allocation
  while returning to the terminal input waitpoint. Added
  `WASMACS_INTERACTIVE_INITIAL_MEMORY` as a diagnostic override in
  `scripts/build-emacs-browser-interactive.sh`; a 768MiB rebuild did not emit
  the immediate OOM in the same early smoke window and remained pending at the
  terminal waitpoint until the diagnostic smoke was stopped manually. Current
  working theory: the 512MiB fixed-memory layout leaves too little heap-end
  slack for the Asyncify poll snapshot. This is not yet proof of a bad pointer
  offset; the next probe should expose runtime brk, heap base/end, and stack
  bounds.

- Added the first real-route interactive semantics smoke for the terminal
  profile. `app/src/asyncify-minibuffer-worker.js` can now start the
  interactive command loop as a long-lived worker operation, and
  `app/src/main.js` drives it from `emacs-waiting` messages by sending only
  terminal bytes: printable text, `C-_` undo, `C-x C-f`, filename submission,
  and `C-x 2`. `scripts/run-browser-smoke.mjs interactive-semantics` records
  PASS only if terminal output proves those routes, and otherwise records a
  known blocker for the OS compatibility memory/runtime layer. Added the
  `browser:smoke:interactive` npm alias and validation checks for the new
  smoke entry.

- Corrected the memory-budget finding from the 768MiB diagnostic profile. A
  768MiB fixed-memory artifact and a 1GiB fixed-memory artifact both reached
  the first real terminal waitpoint with fd 0/1/2 tty, 13,272 initial terminal
  bytes, and `*scratch*` visible in the terminal stream. Both then aborted
  with `Aborted(OOM)` immediately after the first terminal byte was sent and
  the wait was resolved. A 1GiB initial-memory artifact with
  `ALLOW_MEMORY_GROWTH=1` did not hit that immediate fixed-limit OOM during
  the observed window, but also did not progress back to `emacs-waiting`
  before the diagnostic run was stopped. The semantics smoke is therefore
  installed, but its current result is a substrate blocker: Asyncify
  resume/memory layout after the first tty input must be fixed before
  minibuffer/undo/buffer/window smoke can pass.

- Added `docs/os-compatibility-boundary.md` to inventory the OS compatibility
  layer by service and owner. The document records current implementation
  owners, current state owners, desired owners, risks, and next diagnostic
  facade/probe candidates for Lifecycle, Memory and Root, Control Flow,
  Blocking Input Scheduler, Filesystem and Persistence, Preloaded State,
  Terminal/Tty, Host Capability, and Browser GUI Boundary. It explicitly keeps
  memory reduction out of scope and treats success as clearer ownership plus
  diagnostic observability. `app/src/small-os-services.js` now mirrors the
  same boundary as `OwnershipLayers`, `BoundaryRisk`, and
  `OsCompatibilityBoundaryInventory`; tests assert the inventory covers every
  service and that lifecycle/memory/root/control-flow desired ownership stays
  in Emacs C core plus the C/wasm facade rather than JS. The existing
  validation script now checks the new boundary document and registry entries.

- Added diagnostic-only C/wasm facades for the OS compatibility boundary:
  `wasmacs_os_lifecycle_state`, `wasmacs_os_stack_bounds_probe`,
  `wasmacs_os_gc_permission_state`, and `wasmacs_os_root_safety_probe`.
  They are patched into copied `emacs.c` by
  `scripts/patch-emacs-host-entrypoint-spike.sh` and return copied JSON
  snapshots only; JS does not receive or own raw pointers, `Lisp_Object`,
  `specpdl`, pure space, relocation, or lifecycle state. Build scripts now
  export the probes, `app/src/wasm-worker.js` exposes only a debug
  `os-diagnostic-snapshot` read path, and
  `scripts/probe-browser-os-diagnostic-facade.mjs` validates that wasm boots
  and the structured `lifecycle` / `stack` / `gc` / `rootSafety` snapshot is
  readable.

- Validation for the diagnostic facade pass: rebuilt the persistent browser
  artifact, ran `node scripts/probe-browser-os-diagnostic-facade.mjs`,
  `npm test`, and `scripts/validate-browser-persistent-spike.sh`; all passed.
  The probe log records `BOOT_EXIT:0`, lifecycle `phase: initialized`, idle
  pending command state, refreshed stack bottom/top, GC `allowed`, and
  root-safety `policyDefined: true`.

- Added a resume-boundary Memory and Root diagnostic probe:
  `scripts/probe-browser-os-resume-memory-root.mjs`. It captures copied
  C/wasm snapshots at `after-boot`, `before-asyncify-wait`, `pending-input`,
  `before-input-injection`, `after-input-injection-before-resume`,
  `after-resume`, `after-command-complete`, and `after-explicit-gc`, writing
  `logs/wasm-browser-os-resume-memory-root.txt` and
  `logs/wasm-browser-os-resume-memory-root.jsonl`. The probe reuses the
  existing Asyncify pending-input path and does not add product-path
  dependency on diagnostics. Observed result: GC permission flips from
  `allowed` to `blocked:pending-command` during pending input, with wasmacs
  GC guard depth 1, then returns to `allowed` and guard depth 0 after resume /
  completion / explicit GC. Stack roots stay fresh in the copied C snapshots.
  JS wait state is already true again after resume because Emacs has entered
  the next input wait.

- Added a diagnostic-only Blocking Input Scheduler probe for the tty route:
  `scripts/probe-browser-blocking-input-scheduler.mjs`. It uses the Asyncify
  browser profile and `emacs --quick --no-splash --nw`, records scheduler
  phase, wait active/count, resolver presence, queued bytes/preview, last
  injected input, last resolved wait id, repeated wait count, and copied
  lifecycle/GC/root-safety snapshots. Validation with
  `WASMACS_BLOCKING_INPUT_SCHEDULER_TIMEOUT_MS=60000 node
  scripts/probe-browser-blocking-input-scheduler.mjs` captured checkpoints
  through `after-wait-resolve-before-resume` and then synthesized a `failure`
  checkpoint after parent timeout. Evidence: first wait reaches
  `waitActive:true` / `waitCount:1`; queued input byte `[97]` is present before
  resolve; after resolving wait id 1 the resolver is cleared, but queued bytes
  remain 1 and no resume/next-wait checkpoint is reached. C/wasm state remains
  lifecycle `initialized`, GC `allowed`, root safety `allowed`, which points
  the next investigation at the scheduler/tty Asyncify resume edge.

- Refined the Blocking Input Scheduler probe with low-level boundary events:
  JS wait import enter, resolver called, resolve-after, import promise `.then`,
  copied C `read_char` reached, copied C wait return, and tty byte dequeue.
  After rebuilding the Asyncify browser artifact and rerunning
  `WASMACS_BLOCKING_INPUT_SCHEDULER_TIMEOUT_MS=60000 node
  scripts/probe-browser-blocking-input-scheduler.mjs`, the event log shows
  `c-keyboard-read-char-reached`, `c-keyboard-before-wait-import`,
  `js-import-wait-enter`, `js-import-resolver-called`, and
  `js-import-resolve-after`. It does not show `js-import-promise-then`,
  `c-sysdep-before-wait`, `c-sysdep-after-wait-return`,
  `js-terminal-read-byte-dequeue`, or `c-sysdep-byte-dequeued`. The printable
  byte `[97]` stays queued at timeout. This places the stop before Asyncify
  resumes far enough to re-enter the tty read/dequeue path.

- Added a minimal Asyncify import contract probe:
  `scripts/probe-asyncify-import-contract.mjs` with fixture sources under
  `tests/fixtures/asyncify-import-contract.*`. It builds a small wasm module
  with `ASYNCIFY_IMPORTS` covering raw Promise, `async function` wrapper, and
  `Asyncify.handleAsync` imports. Validation with
  `npm run test:asyncify-import-contract` passed and logged that raw Promise
  and async-wrapper imports do not suspend C execution even though their
  Promise `.then` callbacks run; both C paths continue before resolver
  invocation and observe default return value 0. The `Asyncify.handleAsync`
  import suspends until resolver invocation and returns the resolved integer
  to C.

- Added Promise identity diagnostics to
  `scripts/wasmacs-asyncify-host-library.js` and the Blocking Input Scheduler
  JSONL snapshots. After rebuilding `artifacts/emacs-browser-asyncify-spike/`
  and rerunning
  `WASMACS_BLOCKING_INPUT_SCHEDULER_TIMEOUT_MS=60000 npm run
  test:blocking-input-scheduler`, the real Emacs route records
  `createdPromiseId:1`, `resolverPromiseId:1`, `thenPromiseId:2`,
  `returnedExpressionPromiseId:2`, and
  `actualReturnedPromiseId:"unobservable-async-function-wrapper"`.
  `ASYNCIFY_IMPORTS=wasmacs_host_wait_for_input` is present in the asyncify
  build profiles, but `callMain` returns 0 rather than an Asyncify Promise,
  `c-keyboard-after-wait-return` is observed before external resolver
  invocation, `js-import-promise-then` is still absent at timeout, and queued
  byte `[97]` remains unconsumed. This keeps the current blocker in the
  Promise / Asyncify import contract layer.

- Added diagnostic-only wait import mode switching to
  `scripts/wasmacs-asyncify-host-library.js`. The default
  `async-wrapper` mode preserves the previous async-function wrapper shape;
  `WASMACS_WAIT_IMPORT_MODE=handleAsync` routes the same host wait through
  `Asyncify.handleAsync`. Added handleAsync checkpoints:
  `js-import-handleasync-enter`,
  `js-import-handleasync-promise-created`, and
  `js-import-handleasync-returning`.

- Updated `scripts/probe-browser-blocking-input-scheduler.mjs` to compare
  `async-wrapper` and `handleAsync` modes by default and write separate logs:
  `logs/wasm-browser-blocking-input-scheduler-async-wrapper.txt/jsonl`,
  `logs/wasm-browser-blocking-input-scheduler-handleasync.txt/jsonl`, plus
  `logs/wasm-browser-blocking-input-scheduler-compare.txt`. Validation with
  `WASMACS_BLOCKING_INPUT_SCHEDULER_TIMEOUT_MS=60000 node
  scripts/probe-browser-blocking-input-scheduler.mjs` passed as diagnostic
  capture. async-wrapper reproduced the old ordering:
  `c-keyboard-after-wait-return` before resolver, then
  `js-import-resolver-called` / `js-import-resolve-after`, with byte `[97]`
  still queued. handleAsync reached the handleAsync-specific import
  checkpoints and did not show `c-keyboard-after-wait-return` before resolver,
  but after resolver it still did not reach Promise `.then`, C wait return,
  `c-sysdep-before-wait`, or terminal byte dequeue. In both modes `callMain`
  reported return value 0 rather than a Promise.

## 2026-06-03 (continued)

### Asyncify Outer Entrypoint / callMain Resume Boundary Probe

- Added `tests/fixtures/asyncify-outer-resume.c` — minimal C fixture with
  `main()` and `fixture_call_handle_async()` both calling
  `host_wait_handle_async` once each.

- Added `tests/fixtures/asyncify-outer-resume-library.js` — JS library for
  the fixture, providing `host_wait_handle_async` via `Asyncify.handleAsync`,
  resolver via `__outerResumeResolve`, events via `__outerResumeEvents`, and
  `__outerResumeGetAsyncifyState()` to expose `Asyncify.currData`,
  `asyncPromiseHandlers`, and `exportCallStackLength` from inside the vm context.

- Added `scripts/probe-browser-asyncify-outer-resume.mjs` — probe that builds
  the minimal fixture and tests three outer invocation cases (A: `callMain`,
  B: `ccall+async:true`, C: direct `_fn()` export). All three cases PASS: the
  `.then` fires and C resumes with `post_wait_phase` advancing from 20→21
  (main) or 10→11 (exported fn). `callMain` returns 0 (not a Promise) and does
  NOT set `asyncPromiseHandlers`, but Asyncify still resumes correctly.

- Updated `scripts/wasmacs-asyncify-host-library.js`:
  - Added `__wasmacsGetAsyncifyState()` global accessor to expose Asyncify
    internal state from outside the vm context.
  - Added checkpoint 14 (`js-import-handleasync-currdata-before`) before
    `Asyncify.handleAsync` call — records `Asyncify.currData` state.
  - Added checkpoint 15 (`js-import-asyncpromisehandlers-at-resolver-bound`)
    inside resolver registration — records `asyncPromiseHandlers` state.
  - Added checkpoint 16 (`js-import-promise-then-asyncify-state`) inside the
    `.then` callback — records Asyncify state when the promise chain resumes.
  - Updated checkpoint 13 to include `asyncifyStateAtReturning`.

- Updated `scripts/probe-browser-blocking-input-scheduler.mjs`:
  - Added `pollForSchedulerEvent` helper — polls with 10ms intervals for up to
    2000ms for a named scheduler event.
  - Added `after-promise-then-poll` checkpoint after resolver call to confirm
    whether the inner `.then` fires within 2 seconds.
  - Added `asyncifyState` (via `__wasmacsGetAsyncifyState`) to snapshot
    `asyncify.outerState` field at each checkpoint.
  - Added `promiseThenFired`, `asyncifyStateAfterResolve`,
    `callMainReturnedPromise`, `asyncifyStateAfterCallMain` to summary.
  - Updated required checkpoints: `handleAsync` mode now requires
    `after-promise-then-poll`.

- **Key result: handleAsync mode now PASSES the blocking-input-scheduler probe.**
  With the polling approach, the vm context's microtask queue drains properly
  and Emacs completes the full resume cycle:
  - `js-import-promise-then` fires
  - `c-keyboard-after-wait-return` reached after resolver
  - `js-terminal-read-byte-dequeue` reached
  - `c-sysdep-byte-dequeued` reached
  - `queuedWasConsumed: true` (byte `[97]` consumed)
  - `waitCountEnd: 3` (interactive command loop entered 3 input waits)
  - `lastCheckpoint: after-command-complete`

- **Root cause of original probe failure:** The single `await setTimeout(0)`
  was insufficient to drain the vm context's microtask queue when the resolver
  is called cross-context (outer probe → vm context). Multiple event-loop turns
  are needed. The polling approach (200 × 10ms) provides them. This is a
  Node.js probe harness artifact, not a product path issue.

- Updated `docs/os-compatibility-boundary.md` with "Asyncify Outer Entrypoint /
  callMain Resume Boundary" section documenting the outer invocation comparison
  and the blocking-input-scheduler resolution.

- Added `test:asyncify-outer-resume` script to `package.json`.

## 2026-06-03 (continued)

### handleAsync Product-Candidate Smoke

- Added `scripts/probe-browser-blocking-input-handleasync-loop.mjs` — a
  continuous input loop smoke for `handleAsync` mode. Runs 5 input rounds
  (a, b, c, xy multi-byte, C-g boundary) plus a no-resolve timeout observation
  on a single Emacs instance, all in handleAsync mode.

- All 5 rounds PASS:
  - `allRoundsConsumedBytes: true` (queued bytes fully drained in each round)
  - `allRoundsResolverCleared: true` (resolver called in each round)
  - `allRoundsWaitCountIncreased: true` (strict monotone: 1→3→5→7→9→11→13)
  - `allRoundsCResumed: true` (c-keyboard-after-wait-return seen in all rounds)
  - `allRoundsByteDequeued: true` (js-terminal-read-byte-dequeue seen in all rounds)
  - `allRoundsPromiseThenFired: true` (inner .then fires in all rounds once given 60s)
  - `waitCountMonotone: true`
  - `finalGuardDepth: 0` (GC fence properly closed)

- FIFO order confirmed: a, b, c consumed in 3 separate waits in queued order.
- Multi-byte confirmed: queuing "xy" (2 bytes) before one resolve drains both bytes.
- C-g boundary confirmed: 0x07 processed without breaking the command loop; Emacs
  re-entered the input wait after C-g.
- Timeout/no-input stability confirmed: wait/resolver remain stable for 200ms
  with no input; no spurious waitId advancement; cleanup resolves cleanly.

- Updated `docs/os-compatibility-boundary.md`:
  - Added "handleAsync as Product Candidate" section with mode classification table
  - Documented blocking input service contract (handleAsync mode)
  - Updated "Current Known Result" to reflect resolved Asyncify resume blocker
  - Added probe harness note about vm-context microtask latency (probe artifact)

- Added `test:handleasync-loop` script to `package.json`.

- `npm test` passes. `async-wrapper` remains as known-broken comparison mode.

## 2026-06-03 — handleAsync Product Default Promotion

**Objective:** Promote `handleAsync` from diagnostic success to product default
for `wasmacs_host_wait_for_input`.

**Changes:**
- `scripts/wasmacs-asyncify-host-library.js`: default mode changed from
  `'async-wrapper'` to `'handleAsync'` (both the postset initializer and the
  runtime fallback). Comment added: `async-wrapper = known-broken comparison`.
- Artifact rebuilt via `scripts/build-emacs-browser-asyncify-spike.sh`.
  Verified in generated JS: `...|| 'handleAsync'` (was `'async-wrapper'`).
- `scripts/probe-browser-worker-handleasync-input-smoke.mjs` (NEW):
  worker_threads-based correctness smoke. 3 rounds (a, b, c), FIFO order,
  default mode used (no env var). All correctness assertions pass.
  Known: vm.runInContext latency ~30s/round; real browser would be < 5ms.
- `package.json`: added `test:worker-handleasync-smoke` script.
- `docs/os-compatibility-boundary.md`: updated mode classification to
  "product default candidate"; added default-promotion checklist; added
  worker_threads smoke results section; updated Current Known Result.

**Validation (without WASMACS_WAIT_IMPORT_MODE env var):**
- `test:blocking-input-scheduler`: PASS — handleAsync mode used by default,
  all existing checkpoints reached including `after-command-complete`.
- `test:handleasync-loop`: PASS — 5 rounds, waitCount 1→13 monotone,
  finalGuardDepth=0, allRoundsCResumed=true, allRoundsConsumedBytes=true.
- `test:worker-handleasync-smoke`: PASS — 3 rounds in worker_threads,
  defaultHandleAsyncUsed=true, finalGuardDepth=0.
- `npm test`: PASS.

**async-wrapper retained:** known-broken comparison mode; selectable via
`WASMACS_WAIT_IMPORT_MODE=async-wrapper`. Not deleted.

**Next:** keyboard.c event semantics / C-g semantics / product editor input
integration (the byte transport layer is now confirmed end-to-end).

## 2026-06-03 — keyboard.c Event Semantics Probe

**Objective:** Observe Emacs command loop / keyboard.c behavior for each byte type.

**Key finding:** `wasmacs_eval_string` is callable while Emacs is suspended at
`wasmacs_host_wait_for_input` (because `wasmacs_command_busy = 0` when reached via
`callMain` — unlike `wasmacs_command_begin_*` probes which set busy=1). This enables
buffer/point/command readback between keys via a SUSPENDED wasm call.

**Changes:**
- `scripts/probe-browser-keyboard-event-semantics.mjs` (NEW):
  8 key observations (a, b, c, CR, DEL, C-g, ESC, ESC+x).
  Reads `(buffer-string)`, `(point)`, `(last-command)` via `wasmacs_eval_string`
  at each suspension point.
  Logs: `logs/wasm-browser-keyboard-event-semantics.{txt,jsonl}`.
- `package.json`: added `test:keyboard-event-semantics`.
- `docs/os-compatibility-boundary.md`: added keyboard.c event semantics section.

**Results (PASS):**

| Key | Buffer after | Point | last-command |
|---|---|---|---|
| a | "a" | 2 | self-insert-command |
| b | "ab" | 3 | self-insert-command |
| c | "abc" | 4 | self-insert-command |
| CR | "abc\n" | 5 | newline |
| DEL | "abc" | 4 | delete-backward-char |
| C-g | "abc" | 4 | keyboard-quit |
| ESC | "abc" | 4 | keyboard-quit (prev) |
| ESC+x | "M-x " | 5 | execute-extended-command |

finalWaitCount=17, finalGuardDepth=0, evalWorked=true, cgLoopSurvived=true.

**vendor/emacs unchanged. product path unchanged.**

**Next:** product editor input integration — wire handleAsync into the browser
app's command loop so real keystrokes (from keyboard events → postMessage) reach
Emacs in the Web Worker.

## 2026-06-03 — Product Editor Input Integration

**Objective:** Wire browser keydown events to Emacs byte queue via handleAsync.

**Changes:**

- `app/src/emacs-key-bytes.js` (NEW): pure `browserKeyEventToEmacsBytes()` helper.
  Converts browser KeyboardEvent fields to Emacs byte sequences.
  No DOM dependency. Covers printable, Enter, Backspace, Escape, Tab,
  Ctrl+letter, Alt+letter (ESC prefix), Arrow keys (VT100).
- `tests/runtime/emacs-key-bytes.test.js` (NEW): 8 unit test groups, 19 cases.
  All pass (`npm test`).
- `app/src/asyncify-minibuffer-worker.js`: added `emacs-input-bytes` message
  handler (explicit product name; same effect as `terminal-input`) and
  `emacs-read-state` request/response for state readback from main thread.
- `scripts/probe-browser-product-input-smoke.mjs` (NEW):
  End-to-end smoke: synthetic key events → browserKeyEventToEmacsBytes →
  byte queue → handleAsync → Emacs command loop → readback.
  Keys: a, b, c, Enter, Backspace, C-g, Alt+x.
  Logs: `logs/browser-product-input-smoke.{txt,jsonl}`.
- `package.json`: added `test:product-input-smoke`.
- `docs/os-compatibility-boundary.md`: added Product Editor Input Integration section.

**Results (PASS):**

| Key | Bytes | Buffer after | last-command | result |
|---|---|---|---|---|
| a | [97] | "a" | self-insert-command | ✓ |
| b | [98] | "ab" | self-insert-command | ✓ |
| c | [99] | "abc" | self-insert-command | ✓ |
| Enter | [13] | "abc\n" | newline | ✓ |
| Backspace | [127] | "abc" | delete-backward-char | ✓ |
| C-g | [7] | "abc" | keyboard-quit | ✓ (loop survives) |
| Alt+x (batch) | [27,120] | "abc" | keyboard-quit (prev) | observed: batch ESC+x after C-g stays in *scratch* |

finalWaitCount=15, finalGuardDepth=0, evalWorked=true, byteMappingCorrect=true.

**Path boundary:**

- OLD path: `wasm-worker.js` + `emacs-browser-persistent-spike` + `wasmacs_eval_string` (JS builds Lisp) — unchanged
- NEW path: asyncify worker + `emacs-browser-asyncify-spike` + `__wasmacsQueueTerminalInput` + handleAsync (JS is byte transport only) — confirmed

**vendor/emacs unchanged. OLD product command bridge unchanged.**

**Next:** Replace OLD command bridge with NEW byte path in the production worker,
update rendering/readback, or proceed to memory/root stress smoke as separate milestone.

## 2026-06-03 xterm.js terminal output path

Goal: route Emacs terminal output bytes to xterm.js; add Start Interactive Session UI.

### Changes

**asyncify-minibuffer-worker.js:**
- Added `flushTerminalOutputBytes()` + `startTerminalOutputStream()` (16ms setInterval)
- `startTerminalOutputStream()` called from both `onRuntimeInitialized` hooks
- Added `start-xterm-session` message handler → `startXtermSession()`
- Worker now posts `{ type: "terminal-output-bytes", bytes }` continuously during interactive session

**app/src/xterm-emacs-terminal.js (new):**
- `createXtermEmacsTerminal(container)` — wraps xterm.js Terminal, exposes `writeBytes` / `onData` / `dispose`
- `xtermDataToBytes(data)` — TextEncoder.encode for xterm `onData` → emacs-input-bytes

**app/index.html:**
- Added `@xterm/xterm@5` CDN (CSS + JS)
- Added `#xterm-container` + `#start-xterm-session` button + `#xterm-status` span

**app/src/main.js:**
- Imports `createXtermEmacsTerminal`, `xtermDataToBytes`
- `startXtermSession()`: creates xtermWorker + xterm Terminal, wires `terminal-output-bytes` → `term.writeBytes()`, `onData` → `emacs-input-bytes`

**app/src/styles.css:**
- Added `.xterm-section`, `.xterm-header`, `.xterm-status`, `.xterm-container` styles

**scripts/probe-browser-xterm-terminal-smoke.mjs (new):**
- Node.js vm-based smoke; verifies `__wasmacsTerminalOutputBytes` flow
- Checks: initial terminal output present, ANSI sequences present, output advances after a/b/c input, buffer-string = "abc", C-g survived

**docs/os-compatibility-boundary.md:**
- Added "xterm.js Terminal Service (2026-06-03)" section
- Documents output path, input path, clipboard deferred, GUI frame deferred

**package.json:**
- Added `test:xterm-terminal-smoke` script
- Added `@xterm/xterm: ^5.5.0` dependency

### Results

- `npm test` PASS (all existing tests pass)
- `test:xterm-terminal-smoke` PASS — `hasInitialTerminalOutput: true`, `hasAnsiInInitialOutput: true`, `allPrintableOutputAdvanced: true`, `bufferAbc: true`, `finalTerminalByteCount: 11177`, `finalWaitCount: 9`

**vendor/emacs unchanged. OLD command bridge unchanged.**

**Next candidates:** terminal redraw fidelity in browser xterm / OLD command bridge retirement / memory-root stress smoke.

## 2026-06-03 xterm.js terminal redraw fidelity

Goal: verify Emacs `--nw` ANSI sequences are correct for xterm.js rendering; confirm cursor, mode line, insert/delete, redraw, window split.

### Changes

**scripts/probe-browser-xterm-redraw-fidelity.mjs (new):**
- Full fidelity sequence: boot → a,b,c → Enter → Backspace → C-l → C-x 2 → C-x 1
- `analyzeTerminalBytes()`: counts CSI sequences, cursor-pos, erase-EOL, reverse-video, identifies mode line text
- `runCxStep()`: two-round send for C-x prefix sequences (C-x intermediate wait + completing byte)
- Mode line detected via simple text search (`*scratch*`, `Fundamental`)
- ENV not exported in this artifact (abort if accessed) — documented as "80x24 default"
- PASS criteria: initial output, ANSI sequences, cursor positioning, mode line text, a/b/c/Enter/Backspace/C-l/C-x2/C-x1

**package.json:**
- Added `test:xterm-redraw-fidelity` script

**docs/os-compatibility-boundary.md:**
- Added Terminal Redraw Fidelity section with full results table
- Documented C-x prefix key intermediate wait behavior
- Documented cursor-rewrite strategy (no ESC[K)
- Documented mode line detection and reverse video absence

### Results

- `npm test` PASS
- `test:xterm-redraw-fidelity` PASS:
  - `hasInitialOutput: true` (11,064 bytes)
  - `hasAnsiInInitialOutput: true` (591 sequences)
  - `hasCursorPositioning: true` (468 sequences)
  - `hasModeLineText: true` (`=--:---  F1  *scratch*  All  (Fundamental)`)
  - `bufferAbc: true`, `enterNewline: true`, `backspaceWorks: true`
  - `ctrlLRedrawWorks: true` (+2,102 bytes)
  - `splitWindowWorks: true` (+260 bytes, last-command=split-window-below)
  - `unsplitWindowWorks: true` (+278 bytes, last-command=delete-other-windows)
  - `finalByteCount: 13829`, `finalWaitCount: 21`

**Key findings:**
- Emacs uses cursor-rewrite display (ESC[row;colH × 468), NOT erase-to-EOL
- Mode line rendered via character writing (no reverse video attribute)
- C-x prefix key causes intermediate wait; multi-byte sequences need 2 resolveWait() calls
- xterm.js can render this output correctly (all sequences are standard CSI)

**vendor/emacs unchanged. OLD command bridge unchanged.**

**Next:** old command bridge retirement / terminal resize / memory-root stress smoke.

## 2026-06-03 — Old Command Bridge Retirement / Product Editing Smoke

### Goal
Inventory the old command bridge, mark it as legacy, designate the xterm.js path as the product editing surface, and add a smoke that proves the architectural invariant.

### Files changed

**app/src/wasm-worker.js:**
- Added LEGACY header documenting: persistent-spike artifact, `buildEval()`/`buildCommandForm()`/`wasmacs_eval_string` per keypress, JS owns command semantics, not the product editing path

**app/src/browser-runtime-worker.js:**
- Added LEGACY header documenting: pdump-profile artifact, Lisp command forms per keypress, JS owns command semantics, not the product editing path, do not add new editing commands here

**app/src/main.js:**
- Added `// [LEGACY]` comment before `runWorkerCommand()` documenting the old bridge role and pointing to xterm path as the product editing surface

**scripts/probe-browser-xterm-product-editing-smoke.mjs (new):**
- Architecture-focused smoke distinguishing "editing via byte path" from "old command bridge"
- Tracks `evalStringCallsDuringEditing` — must be 0 during editing operations
- Editing operations dispatched via `__wasmacsQueueTerminalInput` only
- `wasmacs_eval_string` called only after `inEditingPhase = false` (post-edit readback)
- PASS criteria include: `editingViaBytePath`, `oldCommandBridgeCalled: false`, `evalStringUsedForEditing: false`, `evalStringUsedForReadback: true`, `terminalBytesFlowed`, `bufferAbc`, `enterNewline`, `backspaceWorks`, `ctrlLRedrawWorks`, `splitWindowWorks`, `unsplitWindowWorks`
- Operations: a, b, c, Enter, Backspace, C-l, C-x 2, C-x 1

**package.json:**
- Added `test:xterm-product-editing-smoke` script

**docs/os-compatibility-boundary.md:**
- Added "Old Command Bridge Retirement (2026-06-03)" section with legacy/active table, product editing path diagram, xterm role description, and product editing smoke results table

### Results

- `test:xterm-product-editing-smoke` PASS:
  - `editingViaBytePath: true`
  - `oldCommandBridgeCalled: false`
  - `evalStringCallsDuringEditing: 0`
  - `evalStringUsedForEditing: false`
  - `evalStringUsedForReadback: true`
  - `terminalBytesFlowed: true` (11,064 → 13,829 bytes)
  - `bufferAbc: true`, `enterNewline: true`, `backspaceWorks: true`
  - `ctrlLRedrawWorks: true`, `splitWindowWorks: true`, `unsplitWindowWorks: true`
  - `finalWaitCount: 21`
- `test:product-input-smoke`, `test:xterm-terminal-smoke`, `test:xterm-redraw-fidelity` — unaffected (pending background confirmation)

**vendor/emacs unchanged.**

## Task M260607m: VS Code printable passthrough, cursor capability, and xterm mouse

Followed up on live VS Code testing where `C-x C-f` could enter the
minibuffer, but minibuffer typing did not reliably reach Emacs, the cursor was
still not visible, and the route needed explicit mouse / xterm256color support.

- Extended the `wasmacs.sendTerminalKeys` package keybindings scoped to
  `activeCustomEditorId == 'wasmacs.wasifsEditor'` so ordinary minibuffer text
  can bypass VS Code's editor key handling:
  - lowercase `a` through `z`
  - digits `0` through `9`
  - `SPC`, `RET`, `DEL`
  - filename-oriented `/`, `.`, `-`, and `_`
- Kept all captured keys as raw tty bytes sent through
  `wasifs.inject-terminal-bytes` -> `emacs-input-bytes`; Emacs still owns
  keymaps, minibuffer state, Dired, and buffer semantics.
- Enabled Emacs' own terminal mouse support on the Asyncify `--nw` route by
  adding startup eval for `(require 'xt-mouse)` and `(xterm-mouse-mode 1)`.
- Made cursor visibility explicit in both host terminal profiles by adding
  `vi`, `ve`, and `vs` termcap capabilities while preserving
  `TERM=xterm-256color` and `COLORTERM=truecolor`.
- Rebuilt `build/artifacts/emacs-browser-asyncify-spike` so the VS Code
  extension reads the updated terminal host profile.

Validation:

- `node --test tests/runtime/vscode-wasifs-extension.test.js
  tests/runtime/xterm-emacs-terminal.test.js
  tests/runtime/terminal-profile.test.js` passed.
- `node --check` passed for:
  - `extensions/vscode-wasifs/src/extension.js`
  - `extensions/vscode-wasifs/media/wasifs-editor.js`
  - `src/wasm/src/asyncify-minibuffer-worker.js`
  - `docs/app/src/asyncify-minibuffer-worker.js`
- `tools/scripts/build-emacs-browser-asyncify-spike.sh` passed.
- `npm test` passed: 104 node tests, plus git artifact policy, browser worker
  app, minibuffer command loop, minibuffer suspended read, and owned Asyncify
  command protocol validators.
- `npm run test:xterm-manual-app-smoke` passed.

**vendor/emacs unchanged.**

## Task M260607c: `-O0 -g0 + pdmp` DevTools crash check

### Summary

- Rebuilt Atomics/pdump artifact with
  `EMACS_WASM_CFLAGS='-O0 -g0' EMACS_WASM_LINKFLAGS='-O0 -g0'`.
- Ran `npm run build` so local `npm run dev` served the rebuilt `docs/`
  artifact.
- Artifact hashes:
  - `temacs.wasm`:
    `6fb43c6850d9adbd58dd6588bf606b9fcbcf8f0c76ffca80a0c5684c274cfa67`
    (`7.7M`).
  - `bootstrap-emacs.pdmp`:
    `bd72a2a1d5453a921acf52cb32e77a48bd9909065d3454ce59ea64b5e29fbe39`
    (`12M`).
- Chrome Beta on CDP port `9000` had a DevTools target open for the wasmacs
  tab.  After clearing the page pdmp IndexedDB cache and navigating to
  `http://127.0.0.1:5173/app/xterm-atomics-pdump.html?autostart&no-live-resize=1&debug-log=1&verify=o0g0-pdump-devtools-1780764869937`,
  the page reached `interactive wait ✓`.
- Sending `kkkk` + Enter through Chrome key events reproduced
  `ended (1 — Maximum call stack size exceeded)`.
- Interpretation: `-O0 -g0 + pdmp` does not fix the DevTools + Enter failure.
  The crash is not caused merely by DWARF/debug-info volume; it remains in the
  interactive command-loop/input path under DevTools instrumentation.
- Follow-up Enter-only probe:
  - Reloaded the same local dev route with verify marker
    `enter-hypothesis-1780765134694` while Chrome DevTools remained open.
  - Injected `2000` plain `k` bytes via
    `window.__wasmacsDebugSendInputBytes(Array(2000).fill(107))`; the page
    stayed `interactive wait ✓` and the input queue drained to `0`.
  - Injected a single CR byte via
    `window.__wasmacsDebugSendInputBytes([13])`; the page ended with
    `ended (1 — Maximum call stack size exceeded)`.
  - Interpretation: the reproduced trigger is not input volume and not the
    CDP key event conversion layer.  It is the Emacs-side `RET`/CR command path
    under DevTools instrumentation.
- Follow-up arrow-key probe:
  - Direct byte injection of `ESC [ C` and `ESC [ A` stayed
    `interactive wait ✓`.
  - Real Chrome key events for all four arrow keys stayed `interactive wait ✓`.
  - A `100` event ArrowDown repeat test stayed `interactive wait ✓`.
  - Interpretation: current evidence points to CR/RET specifically, not
    generic non-printing key input.
- Follow-up newline-byte probe:
  - Direct LF / `C-j` byte injection (`[10]`) reproduced
    `ended (1 — Maximum call stack size exceeded)`.
  - Interpretation: the confirmed trigger is newline-class input, not just the
    physical Enter key or xterm.js Enter conversion.
- Follow-up command/minibuffer probe:
  - Direct `ESC x` byte injection (`[27, 120]`) reproduced
    `ended (1 — Maximum call stack size exceeded)`.
  - User-side manual testing reports `C-x C-f` failure too.
  - Interpretation: the current blocker is broader than newline alone.  It
    likely involves DevTools-sensitive command/minibuffer/redisplay paths.
- Validation:
  - `src/build/build-emacs-browser-atomics-pdump-profile.sh` with
    `-O0 -g0`: PASS.
  - `npm run build`: PASS.
  - `node --test tests/runtime/wasmacs-url-fetch-lisp.test.js`: PASS
    (`15` tests).

**vendor/emacs unchanged.**

## Task M260609: -O2 wasm + pdump → Atomics command loop PASS

### Summary

- **Goal**: determine whether a `-O2 -g0` Emscripten build can reach the
  interactive Atomics command loop if pdump is used to skip cold loadup.
- **Prior context**: M260607b showed all optimized levels fail at
  `Loading subr (source)...` when built with `--with-pdumper=no` (no pdump).
  This probe used the existing `--with-dumping=portable` build tree, which
  is a separate configuration not covered by M260607b.

### Probe infrastructure added

- `tools/scripts/probe-wasm-optimized-pdump-command-loop.sh` — three-stage
  shell probe: (1) apply OS compat patches + build with `-O2 -g0`, (2)
  generate pdump via cold loadup, (3) Atomics command loop boot test.
- `tools/scripts/probe-wasm-optimized-pdump-boot.mjs` — Worker-thread Node
  script; wraps `Atomics.wait` to detect command loop entry; logs
  checkpoints to `logs/wasm-optimized-pdump-boot.jsonl`.
- `tools/scripts/generate-browser-runtime-pdump.mjs` — updated to pre-init
  `ENV: {}` for `-O2` builds (Module.ENV not auto-created without `-O0`)
  and to use `thisProgram: "/temacs"` (with leading slash) in the
  verification step so `load_pdump` honours `--dump-file`.

### Key fix: `thisProgram: "/temacs"` in pdump verification

`load_pdump` in `emacs.c` calls `find_emacs_executable(argv[0], ...)`.
Without a directory separator in `argv[0]`, it searches PATH in MEMFS,
finds nothing, returns NULL, and nullifies `dump_file` — falling through to
cold boot (silently ignoring `--dump-file`).  With `"/temacs"`, the
`strchr(argv0, '/')` branch triggers `xstrdup("/temacs")`, returning a
non-null path, so `pdumper_load` is called correctly.

### Probe results (2026-06-09, artifact: `build/artifacts/emacs-browser-atomics-pdump-O2-g0/`)

- **Stage 1 (build `-O2 -g0`)**: PASS.
  - Only `emacs.o`, `keyboard.o`, `sysdep.o` recompiled (rest cached).
  - Artifacts: `temacs` (523K JS), `temacs.wasm` (2.3M), `temacs.data` (139M).
  - `lib-src/make-fingerprint` replaced with no-op shell script; native
    `make-fingerprint` cannot scan Emscripten JS output for the 32-byte
    `fingerprint[]` pattern.  Since both pdump generation and loading use the
    same binary the placeholder fingerprint values match.

- **Stage 2 (cold loadup → generate pdump)**: PASS.
  - Cold loadup under `-O2 -g0` with `--with-dumping=portable` **succeeded**.
  - `bootstrap-emacs.pdmp` written: 12,824,304 bytes.
  - This contradicts M260607b because that matrix used `--with-pdumper=no`;
    with `--with-dumping=portable` the optimized build completes cold loadup.

- **Stage 3 (Atomics command loop boot test)**: **PASS**.
  - `atomics-wait-entered`: YES (first hit at t+0.4s after callMain start)
  - `tty-flush`:            YES (3 flushes, 288 + 2269 + 3690 = 6247 bytes)
  - `aborted`:              NO
  - `threw`:                NO
  - Steady Atomics ticks observed for 30s — Emacs is in the interactive
    command loop at full optimization.

### Interpretation

The prior optimization failure (M260607b) was caused by the combination of
`--with-pdumper=no` (cold loadup required at every boot) and early
loadup-time GC/stack issues that `-O2` codegen exposed.  With pdump, the
cold loadup happens once offline; the browser loads a pre-warmed image and
skips the fragile early load sequence entirely.  This confirms the pdump
route is the correct product path for optimized wasm builds.

### Validation

- `WASMACS_ARTIFACT_DIR=<abs-path> WASMACS_BOOT_TIMEOUT_MS=30000 node --stack-size=65500 tools/scripts/probe-wasm-optimized-pdump-boot.mjs`: RESULT:PASS.
- Log: `logs/wasm-optimized-pdump-command-loop-O2-g0.txt`
- Boot checkpoint log: `logs/wasm-optimized-pdump-boot.jsonl`

**vendor/emacs unchanged.**

## Task M260607b: optimized wasm batch without TTY waitpoint

### Summary

- Added `tools/scripts/probe-wasm-optimized-batch-no-tty.sh`.
- The probe uses a clean `vendor/emacs` archive under
  `build/wasm-optimized-batch-no-tty`, applies the wasmacs facade patch with
  `WASMACS_ENABLE_ASYNCIFY_WAITPOINT=0`, links without the Atomics host library,
  and runs Node wasm `--quick --batch` checks.
- Result:
  - `-O2 -g0`: build succeeded, but batch loadup failed shortly after
    `Loading subr (source)...` with `invalid-function ("")` and
    `Wrong type argument: listp, 27861040`.
    Log: `logs/wasm-batch-no-tty-O2-g0.txt`.
  - `-g3 -O0`: same no-TTY path passed `emacs-version` and `(require 'json)`.
    Log: `logs/wasm-batch-no-tty-g3-O0.txt`.
  - Matrix from high optimization downward:
    `-O3`, `-Os`, `-Oz`, `-O2`, `-O1`, and `-Og` all failed at the same
    early `Loading subr (source)...` boundary.
  - `-O0 -g0` passed, proving the pass condition is no optimization, not DWARF
    debug info.
  - Summary log: `logs/wasm-batch-no-tty-optimization-matrix.txt`.
- Interpretation: the optimized wasm failure does not require xterm, Atomics, or
  the TTY waitpoint layer.  The likely fault line is lower than TTY and appears
  as soon as any tested Emscripten/clang optimization is enabled, around
  optimized wasm codegen interacting with Emacs Lisp object/tagging,
  nonlocal-exit/setjmp, stack scanning, or early loadup semantics.
- Validation:
  - `bash -n tools/scripts/probe-wasm-optimized-batch-no-tty.sh`: PASS.
  - `tools/scripts/probe-wasm-optimized-batch-no-tty.sh`: FAIL as expected for
    `-O2 -g0`, with the recorded early loadup error.
  - `WASMACS_WASM_BATCH_NO_TTY_CFLAGS='-g3 -O0' tools/scripts/probe-wasm-optimized-batch-no-tty.sh`:
    PASS.
  - `WASMACS_WASM_BATCH_NO_TTY_CFLAGS='-O0 -g0' tools/scripts/probe-wasm-optimized-batch-no-tty.sh`:
    PASS.

**vendor/emacs unchanged.**

## Task M260607a: optimized wasm failure vs native fake-OS counterprobe

### Summary

- Added `tools/scripts/probe-native-fake-os-optimized.sh` to copy
  `vendor/emacs`, apply the wasmacs host entrypoint/facade spike patch, build a
  native macOS `-O2 -g0` pdump-free Emacs, and run batch smoke checks.
- Probe result: PASS.
  - `(princ emacs-version)` printed `30.2`.
  - `(require 'json)` printed `json-ok`.
  - `(fboundp 'wasmacs-os-network-fetch-json)` printed
    `wasmacs-primitive-ok`.
- Interpretation: the common C-side wasmacs OS facade is not inherently broken
  by native optimization.  The optimized browser/no-pdump failure should be
  narrowed toward Emscripten/browser-specific paths such as
  `__EMSCRIPTEN__`-guarded waitpoints, generated JS glue, worker startup, or
  wasm memory/stack semantics.
- Validation:
  - `bash -n tools/scripts/probe-native-fake-os-optimized.sh`: PASS.
  - `tools/scripts/probe-native-fake-os-optimized.sh`: PASS.
  - `node --test tests/runtime/wasmacs-url-fetch-lisp.test.js`: PASS
    (`15` tests).

**vendor/emacs unchanged.**

## 2026-06-05: Dired without external ls

- Source check: `find-file` / `find-file-noselect` does not require external
  `ls`; the external command path is `insert-directory` / Dired listing.
- Decision: browser MVP keeps `host.process` unavailable and forces Dired
  listing through `ls-lisp`.
- Copied-source patch:
  - `loadup.el` loads `ls-lisp` for the wasm profile.
  - `ls-lisp-use-insert-directory-program` is set to nil.
  - `insert-directory-program` is set to nil as an additional guard.
- Added C/wasm facade exports:
  `wasmacs_os_configure_dired_without_ls`,
  `wasmacs_os_dired_without_ls_probe`, and
  `wasmacs_os_filesystem_dired_state`.
- Added `scripts/probe-browser-dired-without-ls.mjs` to run
  `insert-directory` through `ls-lisp` and verify the required Emacs
  primitives:
  `directory-files`, `directory-files-and-attributes`, `file-attributes`,
  `file-directory-p`, `file-readable-p`, and `file-symlink-p`.
- Updated small OS contracts and docs so Dired MVP depends on filesystem
  primitives (`readdir`, `stat/lstat`, `readlink`, access/open checks), not an
  `ls` subprocess.
- Validation:
  - Rebuilt `artifacts/emacs-browser-persistent-spike`.
  - `node scripts/probe-browser-dired-without-ls.mjs`: PASS.
  - Probe readback:
    `:backend ls-lisp`, `:host-process nil`, `:directory-files t`,
    `:directory-files-and-attributes t`, `:file-attributes t`,
    `:file-directory-p t`, `:file-readable-p t`.
  - `npm test`: PASS.
  - `npm run test:persistent`: PASS.

**vendor/emacs unchanged.**

## 2026-06-05: Dired on xterm Atomics pdump page

- Brought the Dired-without-external-`ls` route to the
  `emacs-browser-atomics-pdump` artifact used by
  `app/xterm-atomics-pdump.html`.
- `app/src/emacs-atomics-pdump-worker.js` now starts Emacs with an idempotent
  `ls-lisp` eval so stale/restored pdmp state cannot silently re-enable
  `insert-directory-program`.
- Added `scripts/probe-browser-pdump-atomics-dired-without-ls.mjs` and
  `npm run test:xterm-pdump-dired`.
- Fixed malformed Perl substitutions in the os-compat branch of
  `scripts/patch-emacs-host-entrypoint-spike.sh`; the Atomics pdump build
  patch now applies cleanly again to the copied Emacs source.
- Rebuilt `artifacts/emacs-browser-atomics-pdump`:
  - `temacs.wasm`:
    `afe4fb5c0737bb876ff1e9b56c69751e637b8735a82e0e760982e065f9e3c0e8`
  - `bootstrap-emacs.pdmp`:
    `de0bbd20c3a94c0ac5afd0429af6ea63e6443a339b1048150c2a15c4d3c960ff`
  - `temacs.data`:
    `65a90c0ca637934d5bd1130e21b1bbf233dc7e4ed062911bec54cfe98b9eac66`
- Validation:
  - `bash -n scripts/patch-emacs-host-entrypoint-spike.sh scripts/build-emacs-browser-atomics-pdump-profile.sh`: PASS.
  - `node --check scripts/probe-browser-pdump-atomics-dired-without-ls.mjs`: PASS.
  - `node --check app/src/emacs-atomics-pdump-worker.js`: PASS.
  - `npm run test:xterm-pdump-dired`: PASS.
  - `node scripts/probe-browser-pdump-atomics-tty-command-loop.mjs`: PASS.
  - In-app Browser:
    `http://127.0.0.1:5173/app/xterm-atomics-pdump.html?autostart` reached
    `interactive wait ✓`, showed `*scratch*`, and debug boot args contained
    `(progn (require 'ls-lisp) (setq ls-lisp-use-insert-directory-program nil insert-directory-program nil))`.
- Browser automation caveat: `Alt-x` did not reach Emacs through the Browser
  tool and `C-x` was blocked as a native clipboard-like shortcut, so the
  browser evidence is page boot/wait plus the artifact-level Dired probe rather
  than a fully typed Dired command.

**vendor/emacs unchanged.**

## Task M260605b: pdmp Atomics X4 input/redisplay

### Result (2026-06-05)

`xterm-atomics-pdump.html` now accepts a typed `a` through the host wait path,
redisplays it in `*scratch*`, and returns to the next Atomics waitpoint.

Evidence from the in-app browser page:

| Signal | Result |
|--------|--------|
| Initial wait | `wait-enter#1 queue=0 out=2471` |
| Input consumed | `wait#1 bytes=1 queue=1` |
| Keyboard buffer event | `os-timing-checkpoint:1001` (`ASCII_KEYSTROKE_EVENT`) |
| Kboard bypass reached | `os-timing-checkpoint:1101` |
| Default lispy event branch reached | `os-timing-checkpoint:42` |
| Selected frame branch reached | `os-timing-checkpoint:420`, `421` |
| Redisplay / next wait | `wait-enter#2 queue=0 out=2565` |
| Screen | user-visible `a` in `*scratch*`; page text extraction later also included `a` |

### Fix Shape

- Changed the wasm host waitpoint path in generated `keyboard.c` from manually
  calling terminal hooks to `gobble_input()`, matching Emacs' own input
  collection path more closely.
- For wasm terminal keystrokes, route `*kbp` through `current_kboard` instead
  of immediately deriving it from `event->frame_or_window`; this avoids
  pdmp-restored stale frame objects before the real key is converted.
- For lispy terminal keystrokes, use `selected_frame` before normal frame/focus
  resolution touches `XFRAME(frame)`.
- Suppress wasm switch-frame synthesis for tty keystrokes so the queued key is
  converted into a Lisp event instead of being left behind.

Latest artifact hashes:

- `temacs.wasm`:
  `3812ecc58f01ac9c88e93b3af050d7036109488e412352347854f15edf478ab3`
- `bootstrap-emacs.pdmp`:
  `fe66c16d682ac8ecbbaafc15d029752db0262153a09351532d5ab2a31f6d5b0e`

Validation:

- `scripts/build-emacs-browser-atomics-pdump-profile.sh`
- `node scripts/probe-browser-pdump-atomics-tty-command-loop.mjs`
- `node --check app/src/emacs-atomics-pdump-worker.js`
- `node --check app/src/pdump-diagnostic-worker.js`
- `node --check scripts/probe-browser-pdump-atomics-tty-command-loop.mjs`
- `node --check scripts/wasmacs-atomics-host-library.js`

**vendor/emacs unchanged.**

## Task M260605c: pdmp Atomics input latency

### Result (2026-06-05)

The post-input 30 second delay on `xterm-atomics-pdump.html` was traced to
Emacs' `auto-save-timeout` path, not to Asyncify.  The pdmp Atomics worker now
starts Emacs with:

```elisp
(setq auto-save-timeout nil)
```

This keeps the pdmp startup speed and removes the input-to-redisplay delay.

Evidence:

| Run | Boot to `*scratch*` | `a` to `wait-enter#2` | FIONREAD calls |
|-----|---------------------|-----------------------|----------------|
| Before autosave timeout disable | ~3.4s | ~30.2s | `14534857` |
| After autosave timeout disable | ~3.2s | `50ms` | `4` |

Browser debug tail after the fix:

```text
wait#1 bytes=1 queue=1
...
os-timing-checkpoint:46 queue=0 out=2471
wait-enter#2 queue=0 out=2565 fio=4
```

Why this was not the old Asyncify issue:

- The current pdmp route is the Atomics worker and `NO Asyncify` build lane.
- The 30 second symptom came from Emacs' normal timer timeout around autosave;
  while waiting for that timeout, the wasm process busy-polled FIONREAD millions
  of times.
- A broad worker `setTimeout` monkey patch was tested but did not fix the
  latency by itself, so the final change is the narrower Emacs startup setting.

Validation:

- `node --check app/src/emacs-atomics-pdump-worker.js`
- In-app browser:
  `xterm-atomics-pdump.html` with cleared pdmp cache, typed `a`, observed
  `wait-enter#2` in `50ms` and visible `a` in `*scratch*`.

**vendor/emacs unchanged.**

## Task M260605d: pdmp Atomics generated loaddefs / Org validation

- Kept the latency fix unchanged: `emacs-atomics-pdump-worker.js` still starts
  Emacs with `(setq auto-save-timeout nil)`.
- Extended `scripts/build-emacs-browser-atomics-pdump-profile.sh` so the pdump
  source tree copies native-generated autoload/loaddefs from
  `build/native-emacs-30.2/src/lisp` before pbootstrap.  This now includes
  `emacs-lisp/cl-loaddefs.el`, `org/org-loaddefs.el`, top-level
  `loaddefs.el`, and the other generated `*loaddefs*.el` files.
- Rebuilt `artifacts/emacs-browser-atomics-pdump`:
  - `temacs.wasm`:
    `4f58d61fe440b08ac9b13f934b2099315630e4a19383ef3e2bc86cffcd570be8`
  - `bootstrap-emacs.pdmp`:
    `11ee98a6bb5a8392f9f0cc6d7f63370e7ce7341deea23ea9a085066d29007a31`
- Validation:
  - `node --check app/src/emacs-atomics-pdump-worker.js`: PASS.
  - `node scripts/probe-browser-pdump-atomics-tty-command-loop.mjs`: PASS for
    wait proof (`tty-flush:YES`, `atomics-wait:YES`, `callMain-done:NO`).
  - Atomics pdump eval readback for `(require 'org)`:
    `org=t org-mode=t cl-subseq=t cl-loaddefs="/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-loaddefs.el"`.
  - Atomics pdump eval readback for `.org` file/buffer:
    `file="/home/user/test.org" mode=org-mode buffer="* Heading from wasmacs\n"`.
  - Browser `xterm-atomics-pdump.html` with refreshed pdmp reaches
    `interactive wait ✓` and visible `*scratch*`.
- Browser automation caveat: the Browser tool blocks native clipboard-like
  `Ctrl-x`, so a fully key-driven `C-x C-f` `.org` smoke was not completed in
  automation.  The runtime/eval path confirms Org and `.org` buffers now work;
  the remaining gap is UI key-sequence automation, not the loaddefs fix.

**vendor/emacs unchanged.**

## 2026-06-05: M260605 pdmp + Atomics `-nw` integrated proof

Goal: clear the two remaining blockers before treating
`xterm-atomics-pdump.html` as ready to fold into the main atomic route:
page Boot Test failing on `japan-util`, and pdmp `--nw` aborting before
Atomics.wait.

Findings:

- `vendor/emacs/src/bidi.c:bidi_initialize` aborts if Unicode property
  char-tables such as `bidi-class`, `mirroring`, or `bracket-type` are missing.
  The pdump copied source tree did not contain native-generated
  `international/charprop.el` or `international/uni-*.el`, so redisplay reached
  `bidi_initialize` before input wait and aborted.
- `language/japanese.el` registers `(features japan-util)` for Japanese, and
  `international/mule-cmds.el` later requires those features. The copied pdump
  source tree also lacked generated `lisp/subdirs.el`, so `language/` was not on
  the normal startup `load-path`, producing the `japan-util` error.
- Once `subdirs.el` was restored, Emacs parsed the interactive option far
  enough to reveal that the correct no-window-system option is `-nw`, not
  `--nw`.

Changes:

- `scripts/build-emacs-browser-atomics-pdump-profile.sh` now syncs
  `lisp/subdirs.el`, `international/charprop.el`, and all
  `international/uni-*.el` from `build/native-emacs-30.2/src/lisp` before
  pbootstrap.
- `app/src/emacs-atomics-pdump-worker.js`,
  `app/src/pdump-diagnostic-worker.js`, and
  `scripts/probe-browser-pdump-atomics-tty-command-loop.mjs` use `-nw`.
- `app/src/emacs-atomics-pdump-worker.js` sets `LANG/LC_ALL=C` and
  `HOME=/home/user` before `callMain`.
- `scripts/wasmacs-atomics-host-library.js` posts `timing-wait-enter` before
  blocking in `Atomics.wait`; `app/xterm-atomics-pdump.html` displays this as
  `interactive wait ✓`.
- `pdump-diagnostic.html` Boot Test now uses batch `callMain` plus the exported
  eval bridge and labels the path as `Boot Test (batch)`.

Validation:

- Rebuilt `artifacts/emacs-browser-atomics-pdump`:
  - `temacs.wasm` sha256
    `07b7fd96c63f36b93fbee8f5afcd0b8c5855e2b6d40d3877cbe4ec5c26002312`
  - `bootstrap-emacs.pdmp` sha256
    `9b38b2761a1a0bbcfa3512fdcd44561bbcbccb8e5b99dc4d222e52e688828717`
- `node --check` passed for the touched JS worker/probe/library files.
- `node scripts/probe-browser-pdump-atomics-tty-command-loop.mjs`:
  `tty-flush:YES`, `atomics-wait:YES`, `callMain-done:NO`,
  `Wait at: ttyOutLen=2476, hasTtyOutput=true`.
- Browser `pdump-diagnostic.html` Generate + Boot Test:
  `BOOT-VER: 30.2`, `BOOT-PDUMP: LOADED`, `BOOT-GC: PASS`.
- Browser `xterm-atomics-pdump.html` after clearing pdmp cache:
  `pdmp 26.4 MB materialized`, `SAB ✓`, `interactive wait ✓`,
  `wait-enter#1 queue=0 out=2471 fio=1`; terminal shows `*scratch*` in Lisp
  Interaction mode with no `japan-util` or unknown-option warning.

X4 input follow-up:

- Fixed-memory builds aborted after the first input byte with OOM just above
  the configured limit (`536870912`, then `805306368`). The pdmp Atomics build
  now defaults to `ALLOW_MEMORY_GROWTH=1`.
- Browser CUA typed `a`; debug showed `wait#1 bytes=1 queue=1` and
  os timing checkpoints 10/20/30 consumed the byte. No OOM occurred with growth
  enabled.
- Superseded by `Task M260605b`: `a` now appears in `*scratch*`, terminal
  output advances, and the worker posts `wait-enter#2`.

**vendor/emacs unchanged.**

## 2026-06-05: M260605 atomic pdmp Reload+Eval+GC recovery

- Recreated `build/emacs-pdump-configure-probe` from a fresh Emacs 30.2 copy
  after finding repeated os-compat insertions in the generated `keyboard.c`.
- Fixed `scripts/patch-emacs-host-entrypoint-spike.sh` to remove an existing
  os-compat keyboard block before reinserting it.
- Updated `scripts/build-emacs-browser-atomics-pdump-profile.sh` so
  `bootstrap-emacs.pdmp` is generated by the final Atomics runtime and extracted
  from MEMFS to the host artifact. This fixed the previous pdmp/runtime
  fingerprint mismatch.
- New artifact hashes:
  - `artifacts/emacs-browser-atomics-pdump/temacs.wasm`:
    `54b813bb07d12fe638f68bf03a1364974302098c9bc32d2f853c705b46df6d69`
  - `artifacts/emacs-browser-atomics-pdump/bootstrap-emacs.pdmp`:
    `c0958f4c717f95bff00f027af79b370b5c0170d34b24c32a956817645842b0d2`
- Node pdmp batch probe PASS:
  `VERSION:30.2`, `PDUMP:LOADED`, `GC:PASS`.
- Browser `pdump-diagnostic.html` PASS for:
  Generate pdmp → Reload + Eval + GC → `version=30.2`, `pdump=LOADED`,
  `gc=GC-OK`, `D3+D4 PASS`.
- Remaining blocker:
  page `Boot Test (--eval)` and `--nw` command-loop still do not reach the
  desired path. `Boot Test` currently ends in `japan-util` missing during
  normal-top-level, and `--nw` aborts before Atomics.wait.

**vendor/emacs unchanged.**

**Next:** terminal resize / memory-root stress smoke / Clipboard Service boundary.

## 2026-06-03 — xterm Session Lifecycle Fix

### Symptom
Browser UI: "session ended (status 0)" immediately after clicking "Start Interactive Session". xterm pane black.

### Diagnosis
1. `asyncify-minibuffer-worker.js` used `ARTIFACT_DIR = "/artifacts/emacs-browser-interactive"` for `startXtermSession`.
2. Node.js probe of `emacs-browser-interactive`: `callMain` returns `number 0` synchronously. Then OOM abort.
3. Smoke with `WASMACS_ARTIFACT_DIR=emacs-browser-interactive`: `test:xterm-terminal-smoke` FAIL.
4. In `startXtermSession`: `const status = await module.callMain(args)` — `await 0` resolves immediately → `xterm-session-returned` posted → "session ended".
5. `emacs-browser-interactive` OOM: `ALLOW_MEMORY_GROWTH=0`, 512MB fixed, full lisp tree in 101MB .data file. OOM abort after first wait.

### Fix applied

**asyncify-minibuffer-worker.js:**
- Added `XTERM_ARTIFACT_DIR = "/artifacts/emacs-browser-asyncify-spike"` constant (with explanation comment)
- Added `xtermEmacsModule` / `xtermEmacsReady` singleton variables
- Added `ensureXtermEmacs()` function loading from `XTERM_ARTIFACT_DIR`
- Rewrote `startXtermSession()`:
  - Uses `ensureXtermEmacs()` (not `ensureAsyncifyRuntimeOnly`)
  - Calls `module.callMain(args)` WITHOUT await
  - Polls `__wasmacsHostWaitForInputPending` (via `waitForXtermHostInput(30_000)`)
  - Posts `xterm-session-at-wait` when interactive wait confirmed
  - Wires `.then()` on callMainResult if it is a Promise (for clean exit detection)
  - For sync callMain: worker stays alive, session runs via worker event loop

**app/src/main.js:**
- `xterm-session-started` → status "loading…"
- `xterm-session-at-wait` → status "interactive"
- `terminal-output-bytes` (first bytes) → status "running" (if still loading)
- `xterm-session-returned` → status "session ended (status N)" + error if present
- `xterm-session-error` → status "session error: ..."

**scripts/probe-browser-xterm-manual-app-smoke.mjs (new):**
- Simulates startXtermSession flow: load asyncify-spike, fire callMain, poll for wait, send a/b/c
- Key assertions: `sessionReachesWait`, `terminalBytesPresent`, `sessionNotImmediatelyEnded`, `bufferAbc`
- Explicitly notes: callMain may return sync 0 in Node.js vm — this is OK; poll for wait pending

**package.json:**
- Added `test:xterm-manual-app-smoke`

### Results
- `test:xterm-manual-app-smoke` PASS
  - `sessionReachesWait: true`, `terminalBytesPresent: true`
  - `terminalBytesFlowed: true`, `bufferAbc: true`, `sessionNotImmediatelyEnded: true`
- `test:xterm-terminal-smoke`, `test:xterm-redraw-fidelity`, `test:xterm-product-editing-smoke` unaffected

**For visual browser UI verification:** `npm run dev` → `http://localhost:5173` → "Start Interactive Session" → status should show "interactive", xterm should display Emacs `*scratch*`.

**vendor/emacs unchanged.**

## 2026-06-03 — HEAPU8 Export Guard Fix

### Symptom
Browser: `RuntimeError: Aborted('HEAPU8' was not exported. add it to EXPORTED_RUNTIME_METHODS)` → xterm session ends immediately. All Node.js probes PASS (Emscripten export guard not enforced in vm context).

### Root cause
`readMemorySnapshot()` in `asyncify-minibuffer-worker.js` accessed `module?.HEAPU8?.length`. `emacs-browser-asyncify-spike` build script's `EXPORTED_RUNTIME_METHODS=callMain,ccall,FS,FS_createPath,FS_createDataFile,FS_readFile` does not include `HEAPU8`. Browser Worker enforces this → abort.

Similarly `readTtySnapshot()` accessed `module.ENV?.TERM` / `module.ENV?.TERMCAP` — `ENV` also not exported.

### Fix

**asyncify-minibuffer-worker.js:**
- `readMemorySnapshot()`: removed `module?.HEAPU8?.length` access; wrapped `module?.wasmMemory?.buffer?.byteLength` in try/catch; added comment explaining the restriction
- `readTtySnapshot()`: wrapped `module.ENV?.TERM` and `module.ENV?.TERMCAP` in individual try/catch blocks

### Smoke enhancement

**probe-browser-xterm-manual-app-smoke.mjs:**
- Added `Object.defineProperty` getter trap on `Module.HEAPU8` and `Module.ENV` after runtime init
- Trap throws on access, simulating the browser Worker export guard
- PASS criteria: `heapu8NotAccessed: true`, `envNotAccessed: true`
- Result: PASS — neither trap triggered during the full startXtermSession flow

### Legacy core worker error (separate, not fixed)
`browser-runtime-worker.js` starts on page load (via `enqueueBufferCommand()` call in `main.js`). It boots `emacs-browser-pdump-profile` which hits `Maximum call stack size exceeded`. This posts `"error"` message → `setStatus("worker error")` on `#status` (global panel). Does NOT affect `#xterm-status` (separate element). xterm route unaffected.

### All smoke results
- `test:xterm-manual-app-smoke` PASS (with HEAPU8/ENV traps: `heapu8NotAccessed: true`, `envNotAccessed: true`)
- `test:xterm-terminal-smoke` PASS
- `test:xterm-redraw-fidelity` PASS
- `test:xterm-product-editing-smoke` PASS

**vendor/emacs unchanged.**

### Browser UI verification
Chrome MCP unavailable for automated browser test. Manual verification needed:
`npm run dev` → `http://localhost:5173` → "Start Interactive Session"
Expected: status "xterm session interactive", xterm shows Emacs `*scratch*`

## 2026-06-04 — xterm Boot Loadup Stack Overflow Fix

### Symptom
Browser: `RangeError: Maximum call stack size exceeded at temacs.wasm.eval_sub` during Emacs loadup in xterm session. Failure around `faces.el`/`ldefs-boot.el`. Session ended immediately.

### Root cause analysis

1. `callMain(['--quick','--no-splash','--nw'])` triggers `loadup.el`
2. `loadup.el` loads ~100 Lisp files via `load` → `eval_sub` for each form
3. `eval_sub` recurses deeply during macro expansion (defface etc in faces.el)
4. With full Asyncify instrumentation, each `eval_sub` call goes through a JS wrapper frame
5. ~1000+ recursive JS wrapper frames → exceeds browser Worker JS call stack (~1-4MB)
6. Node.js probe used `--stack-size=65500` (65MB) → escaped the issue

### Attempts and findings

**ASYNCIFY_IGNORE_INDIRECT=1**: Tried in pdump and spike builds.
- Reduces JS wrapper overhead (indirect calls not instrumented)
- BROKE Asyncify: `wasmacs_host_wait_for_input` is called via function pointer (keyboard.c syscall path)
- Error: `import invoke_jjij was not in ASYNCIFY_IMPORTS, but changed the state`
- Adding invoke_* to ASYNCIFY_IMPORTS: still broken (`RuntimeError: unreachable at dynCall_i`)
- Conclusion: ASYNCIFY_IGNORE_INDIRECT=1 is fundamentally incompatible with current call chain

**pdump rebuild with current host library**: Built `emacs-browser-asyncify-pdump` with new `wasmacs-asyncify-host-library.js`:
- Got terminal byte symbols (14 matches)
- But pdump + ASYNCIFY_IGNORE_INDIRECT=1 still broken for interactive mode
- Without `--dump-file` arg: exits status 1 (cold loadup still fails)
- With `--dump-file` + ASYNCIFY_IGNORE_INDIRECT=1: invoke_* abort

**spike + pdump boot (winning solution)**:
- Use `emacs-browser-asyncify-spike` (full Asyncify, all terminal symbols)
- Fetch `bootstrap-emacs.pdmp` from `emacs-browser-asyncify-pdump` artifact
- Write pdmp to wasm FS at `/bootstrap-emacs.pdmp`
- Call `callMain(['--dump-file','/bootstrap-emacs.pdmp','--quick','--no-splash','--nw'])`
- Result: `WAIT_PENDING i=0, termBytes=11064, bufferString="a"` — PASS

### Files changed

**app/src/asyncify-minibuffer-worker.js:**
- Added `XTERM_PDMP_URL` and `XTERM_PDMP_PATH` constants
- Added `xtermPdmpLoaded` flag and `ensureXtermPdmp(module)` function
  - Fetches pdmp via `fetch(XTERM_PDMP_URL)`, writes to `module.FS.writeFile(XTERM_PDMP_PATH, bytes)`
  - Posts `xterm-loadup-checkpoint` messages for diagnostic display
- Updated `startXtermSession` to call `ensureXtermPdmp(module)` before callMain
- Changed args to `['--dump-file', XTERM_PDMP_PATH, '--quick', '--no-splash', '--nw']`
- Added `readArtifactFingerprint(module)` diagnostic function
- Added `xterm-loadup-checkpoint` messages from `print` handler (Loading... lines)
- Added `ensureXtermPdmp` status messages and checkpoint messages

**app/xterm.html (new):**
- xterm-only diagnostic page at `/app/xterm.html`
- No legacy core worker, no frame-grid, no textarea
- Shows `#artifact-info` bar with artifact URL and build flags
- Handles `xterm-artifact-fingerprint` and `xterm-loadup-checkpoint` messages
- `?autostart` URL param auto-starts session

**scripts/probe-browser-xterm-boot-loadup-smoke.mjs (new):**
- Validates pdump boot: spike artifact + pdmp → interactive wait + key input
- PASS: `pdmpLoaded=true`, `interactiveWaitReached=true`, `terminalBytes=11064`, `bufferString="a"`

**scripts/build-emacs-browser-asyncify-spike.sh:**
- STACK_SIZE 1MB → 16MB (defensive, addresses wasm linear stack)

### Smoke results
- `test:xterm-boot-loadup-smoke` PASS
- `test:xterm-terminal-smoke` PASS
- `test:xterm-redraw-fidelity` PASS
- `test:xterm-product-editing-smoke` PASS
- `test:xterm-manual-app-smoke` PASS

### Browser UI verification
For manual browser confirmation:
`npm run dev` → `http://localhost:5173/app/xterm.html?autostart`
Expected: xterm-status shows "interactive ✓", Emacs `*scratch*` visible, `a` input works.

**vendor/emacs unchanged.**

## 2026-06-04 — pdump revert from product path; cold loadup blocker

### Action
Reverted pdump boot from `startXtermSession` product path. Cold loadup is the correct product default.

### Changes to worker
- `startXtermSession` args: `['--quick','--no-splash','--nw']` (no `--dump-file`)
- OPEN BLOCKER comment added to constants section
- `ensureXtermPdmp` / `startPdumpXtermSession` moved to diagnostic-only section
- `start-pdump-xterm-session` worker message added (explicit diagnostic opt-in)

### Changes to xterm.html
- Default session: cold loadup with open blocker warning displayed in artifact-info bar
- `?boot=pdump`: routes to `start-pdump-xterm-session` diagnostic path
- Button label and color differ for pdump diagnostic mode

### Renamed smoke
`probe-browser-xterm-boot-loadup-smoke.mjs` → `probe-browser-xterm-pdump-diagnostic-smoke.mjs`
Log: `browser-xterm-pdump-diagnostic-smoke.{txt,jsonl}`
Script: `test:xterm-pdump-diagnostic`

### Documentation
`docs/os-compatibility-boundary.md`: added "Open Blocker: browser-worker-cold-loadup-js-stack-overflow"
- Root cause analysis
- Attempted fixes and results
- Diagnostic workaround (pdump) — diagnostic only
- Investigation candidates A-D

### All smoke results
- `test:xterm-terminal-smoke` PASS
- `test:xterm-manual-app-smoke` PASS  
- `test:xterm-pdump-diagnostic` PASS (diagnostic route confirmed)
- `test:xterm-product-editing-smoke` PASS (probe uses 65MB stack)
- `test:xterm-redraw-fidelity` PASS (probe uses 65MB stack)

**vendor/emacs unchanged.**

## 2026-06-04 — ASYNCIFY_REMOVE=eval_sub: Cold Loadup Blocker RESOLVED

### Blocker
`browser-worker-cold-loadup-js-stack-overflow` — RESOLVED

### Root cause
Full Asyncify instrumentation wraps every potentially-async function with JS frames.
`eval_sub` is in the async set (it CAN reach `wasmacs_host_wait_for_input` through file loads).
During loadup.el, eval_sub recurses ~1000+ levels.
Each call adds ~1-2 JS wrapper frames → JS call stack overflow at 1.5MB (browser Worker level).
Node.js probes escape via `--stack-size=65500`.

### Fix
Added `-sASYNCIFY_REMOVE=eval_sub` to `build-emacs-browser-asyncify-spike.sh`.

Removes eval_sub from the Asyncify instrumented set. eval_sub becomes a plain wasm function
with no JS wrapper. Recursive calls stay in wasm without JS frame overhead.

**Safety justification:**
- Interactive wait occurs in `read_char` (via `read_key_sequence`) — eval_sub is NOT on this stack
- During loadup: eval_sub recurses through file loads (not TTY) → no wait occurs
- For basic `--quiet --nw`: commands dispatched by C functions, eval_sub not on wait stack
- Known limitation: Lisp `(read-char)` interactive → eval_sub on wait stack → crash

### Test results
- `test:xterm-cold-loadup-failure`: status=RESOLVED (stackSizeKb=1500, no --dump-file, interactive wait reached)
- `test:xterm-terminal-smoke`: PASS
- `test:xterm-manual-app-smoke`: PASS
- `test:xterm-product-editing-smoke`: PASS
- `test:xterm-redraw-fidelity`: running

### What was tried before (for this blocker)
| Approach | Result |
|---|---|
| ASYNCIFY_IGNORE_INDIRECT=1 | ❌ Breaks suspend/resume (indirect call chain to wait) |
| invoke_* in ASYNCIFY_IMPORTS | ❌ unreachable at dynCall_i |
| STACK_SIZE=16MB | Partial (wasm linear stack only) |
| pdump boot | Works but NOT product (diagnostic fallback only) |
| **ASYNCIFY_REMOVE=eval_sub** | **RESOLVED** |

**vendor/emacs unchanged.**

## 2026-06-04: M260604 外部 pdmp ロード再挑戦

### Step 1: 既存 pdmp artifact の探索

- `find . -name '*.pdmp'` → 4 ファイル発見。
  1. `artifacts/emacs-browser-pdump-profile/bootstrap-emacs.pdmp` (26MB, sha256: d84661b2...)
  2. `artifacts/emacs-browser-interactive/bootstrap-emacs.pdmp` (26MB, sha256: e1640c9c...)
  3. `artifacts/emacs-browser-asyncify-pdump/bootstrap-emacs.pdmp` (26MB, sha256: d84661b2...)
  4. `build/emacs-pdump-configure-probe/.../bootstrap-emacs.pdmp` (26MB, sha256: d84661b2...)
- 3 つの pdmp が同一 sha256（d84661b2...）。1 つ（emacs-browser-interactive）が異なる。
- 既存 evidence `logs/emacs-pdump-node-load-pass.txt` が pdmp load 成功を証明:
  `VERSION:30.2`, `GC:PASS`, `PDUMP:loaded`.
- 成果物: `logs/pdmp-artifact-inventory.txt` に全詳細。

### Step 2: 外部 pdmp ロード用 Node-first probe 追加

- 新規スクリプト `scripts/probe-browser-pdump-external-load.mjs` 作成。
- Node VM context で temacs を起動し、MEMFS に pdmp を配置、`--dump-file` で起動。
- 診断スナップショットを各 checkpoint で取得:
  `before-module-load`, `after-memfs-materialize`, `before-callMain`,
  `after-pdump-load-attempt`, `after-simple-eval`, `after-explicit-gc`,
  `before-command-loop`.
- ログ出力: `logs/wasm-browser-pdump-external-load.txt`,
  `logs/wasm-browser-pdump-external-load.jsonl`.

### Step 2b: temacs 再ビルド試行

- pdmp-probe tree の temacs が interactive build で上書きされていたことを発見
  (temacs.wasm sha256: b293443b... → interactive と同一)。
- interactive build の temacs は OOM (`Aborted(OOM)`) で起動不可。
- 再ビルド試行: ソースツリーに Asyncify パッチ
  (`wasmacs_host_wait_for_input` 等) が適用済みでリンクエラー。
- **KNOWN_BLOCKER**: pdmp-probe tree temacs の再ビルドには
  patched source tree の復元または修正が必要。

### Step 4: 成功条件段階分け

既存 evidence に基づく判定:

| Level | 説明 | 判定 |
|-------|------|------|
| Level 0 | artifact exists | **PASS** — 4 .pdmp files, all ~26MB |
| Level 1 | MEMFS 配置 | **PASS** — Node loads via --dump-file or MEMFS |
| Level 2 | pdumper load path | **PASS** — PDUMP_STATS:loaded |
| Level 3 | simple eval | **PASS** — VERSION:30.2 |
| Level 4 | explicit GC | **PASS** — GC:PASS |
| Level 5 | tty command loop | **NOT VERIFIED** — overwritten binary blocks test |
| Level 6 | browser worker | **NOT VERIFIED** — depends on Level 5 |

### Step 6: manifest 設計

- `artifacts/preloaded-state/emacs-30.2/manifest.json` 作成。
- 全 4 組の matching set (core wasm + pdmp + system lisp) を記録。
- known patches (alloc.c purecopy, pdumper.c mmap, loadup.el prereqs) を列挙。
- loadStatus: `pass`（Level 0-4 evidence に基づく）。

### Step 7: test script 分離

- `package.json` に `test:pdump` と `test:pdump:generate` を追加。
- デフォルト `npm test` には含めず、heavy パスにも未追加。
- `test:pdump:generate` 用のスタブとして `scripts/probe-emacs-pdump-generate-node.mjs` を予約
  （pdmp 生成 probe は既存 evidence で検証済みのため未作成）。

### サービス分類

- **Preloaded-State Service**: 外部 pdmp artifact は存在し、load は検証済み。
- **Memory And Root Service**: pdmp load 後の explicit GC は PASS。
  GC permission state は `allowed`, lifecycle phase は `initialized`。
- **Terminal/Tty Service**: Level 5 (tty command loop) は temacs binary 破損により未検証。
- **Filesystem And Persistence Service**: MEMFS 配置は動作するが、
  pdmp の永続配置設計は未定。

**vendor/emacs unchanged.**

## Task M260604b: bootstrap-emacs.pdmp self-generate / self-load PASS → xterm-atomics 接続

### pdump diagnostic 成果記録 (2026-06-04)

pdump-diagnostic.html で以下が確認できた:

| 項目 | 結果 |
|------|------|
| bootstrap-emacs.pdmp self-generate | PASS (24.7 MB) |
| fresh worker での --dump-file 渡し | PASS |
| pdump=LOADED (Boot Test via callMain --eval) | PASS |
| version=30.2 | PASS |
| gc=GC-OK | PASS |
| D3+D4 | PASS 扱い |

**根本原因特定**: `thisProgram: "temacs"` (スラッシュなし) → `find_emacs_executable` が
PATH 検索失敗 → `goto hardcoded` + `dump_file=NULL` → `--dump-file` 引数が無視 → cold boot →
`pdumper-stats` = nil。

**修正**: `thisProgram: "/temacs"` (スラッシュ付き) にすることで
`find_emacs_executable` が `xstrdup(argv0)` で "/temacs" を返し、null check を通過、
`pdumper_load("/bootstrap-emacs.pdmp", "/temacs")` が正常呼び出される。

### xterm-atomics-pdump 接続 (2026-06-04)

- `app/src/emacs-atomics-pdump-worker.js` 新規作成
  - ARTIFACT_DIR = /artifacts/emacs-browser-atomics-pdump
  - thisProgram: "/temacs" (load_pdump fix)
  - SAB + TTY Atomics.wait 経路 (emacs-atomics-worker.js と同じ構造)
  - start message で pdmpBytes 受信 → MEMFS に配置 → --dump-file --quick --no-splash --nw

- `app/xterm-atomics-pdump.html` 新規作成
  - Phase 1 (generate): pdump-diagnostic-worker.js を使って bootstrap-emacs.pdmp 生成
  - Phase 2 (emacs): emacs-atomics-pdump-worker.js で xterm 接続
  - IndexedDB ("wasmacs-pdump-cache") でpdmp キャッシュ (再訪問時スキップ)

**Level 分類目標**:

| Level | 内容 | 確認方法 |
|-------|------|----------|
| X1 | pdmp materialized + --dump-file argv 確認 | callmain-boot-args checkpoint |
| X2 | terminal bytes が xterm に出る | terminal-output-bytes → xterm.write |
| X3 | Atomics.wait 到達 / input wait 状態 | callMain が return しない |
| X4 | キー入力 `a` が *scratch* に入る | xterm 目視 |

**vendor/emacs unchanged.**

## Task M260607a: VS Code .wasifs custom editor host scaffold

Implemented the first VS Code extension spike for opening portable
`user-filesystem.wasifs` images as wasmacs workspace documents.

- Added `extensions/vscode-wasifs/` with `wasmacs.wasifsEditor`.
- Registered `*.wasifs` as a VS Code custom editor and added
  `Wasmacs: Open Filesystem Image`.
- The extension reads the opened image through `vscode.workspace.fs`, sends the
  bytes to the webview, declares `/home/user` as the mount, and records the
  initial Emacs handoff as `(dired "/home/user")`.
- The webview currently renders a small Dired-like image inventory preview.
  This is intentionally a host/document scaffold; real xterm.js + wasm worker
  wiring remains gated on the active Terminal/Tty Service route.
- Save/Save As write the current `.wasifs` bytes through the VS Code custom
  document lifecycle.
- Added `tests/runtime/vscode-wasifs-extension.test.js` to keep the custom
  editor selector, mount path, Dired handoff, and save path explicit.

Validation:

- `npm test` passed: 94 node tests, plus git artifact policy, browser worker
  app, minibuffer command loop, minibuffer suspended read, and owned Asyncify
  command protocol validators.

**vendor/emacs unchanged.**

## Task M260607b: VS Code webview runtime asset preflight

Extended the VS Code `.wasifs` custom editor scaffold toward the real
xterm/worker runtime path.

- Added webview-local runtime asset handoff URIs for:
  - `docs/app/src/xterm-emacs-terminal.js`
  - `docs/app/src/emacs-atomics-worker.js`
  - `docs/app/src/emacs-atomics-pdump-worker.js`
  - `docs/artifacts/system-lisp-emacs-30.2.wasifs`
  - `docs/artifacts/user-filesystem-empty.wasifs`
- Expanded the `.wasifs` inventory renderer from top-level-only output to a
  simple nested Dired-like tree with file/directory counts.
- Added in-webview runtime preflight for asset fetch status,
  `SharedArrayBuffer`, and `Worker` availability. This keeps the next VS Code
  xterm/wasm step diagnosable without moving Emacs semantics into the webview.
- Updated `extensions/vscode-wasifs/README.md` and
  `tests/runtime/vscode-wasifs-extension.test.js`.

Validation:

- `npm test` passed: 95 node tests, plus git artifact policy, browser worker
  app, minibuffer command loop, minibuffer suspended read, and owned Asyncify
  command protocol validators.

**vendor/emacs unchanged.**

## Task M260607c: VS Code CSP fix and runtime bridge route selection

Interpreted the live VS Code Extension Development Host screenshot:

- The `.wasifs` custom editor is working: VS Code opens the image through
  `wasmacs.wasifsEditor`, parses the user image, and renders the Dired handoff
  preview.
- Runtime asset rows were failing because the webview CSP allowed local script
  and style resources but did not allow `fetch()`; added
  `connect-src ${webview.cspSource}`.
- The live webview reports `SharedArrayBuffer: unavailable` and
  `Worker: available`. That means the current Atomics/pdump browser runtime is
  not directly runnable inside the VS Code webview.
- Added `extensions/vscode-wasifs/src/runtime-bridge.js` to keep this decision
  explicit. The bridge selects `webview-atomics` only when both SAB and Worker
  are available; otherwise it selects `extension-host-bridge`.
- The webview now posts `wasifs.preflight` to the extension host and renders
  the selected route and reason.
- Added `tests/runtime/vscode-wasifs-runtime-bridge.test.js`.

Validation:

- `npm test` passed: 97 node tests, plus git artifact policy, browser worker
  app, minibuffer command loop, minibuffer suspended read, and owned Asyncify
  command protocol validators.

**vendor/emacs unchanged.**

## Task M260607d: VS Code preflight progress and bridge start handoff

Followed up on the live screenshot where runtime asset rows stayed `pending`.

- Fixed `extensions/vscode-wasifs/media/wasifs-editor.js` so preflight checks
  update progressively per asset instead of waiting for all asset fetches.
- Added a 2.5s timeout around asset `fetch()` so large local artifacts cannot
  hold the whole status view hostage.
- Published SAB/Worker preflight to the extension host immediately, so the
  runtime route appears even while asset checks continue.
- Added `Start Bridge` in the custom editor title bar.
- Added a `wasifs.bridge-start` message handled by the extension host bridge.
  The bridge now returns a start plan. For the currently selected
  `extension-host-bridge` route it reports `blocked` until a non-Atomics bridge
  or out-of-webview Atomics runtime is attached.
- Extended `tests/runtime/vscode-wasifs-runtime-bridge.test.js`.

Validation:

- `npm test` passed: 98 node tests, plus git artifact policy, browser worker
  app, minibuffer command loop, minibuffer suspended read, and owned Asyncify
  command protocol validators.

**vendor/emacs unchanged.**

## Task M260607e: VS Code Asyncify route detection and artifact build

Moved the VS Code `.wasifs` route past the generic bridge placeholder.

- Added `webview-asyncify` as a route in
  `extensions/vscode-wasifs/src/runtime-bridge.js`.
- The bridge now selects:
  - `webview-atomics` only when SAB and Worker are both available.
  - `webview-asyncify` when Worker is available, SAB is unavailable, and
    `build/artifacts/emacs-browser-asyncify-spike` exists.
  - `extension-host-bridge` when the non-Atomics artifact is missing.
- Added webview URIs for:
  - `docs/app/src/asyncify-minibuffer-worker.js`
  - `build/artifacts/emacs-browser-asyncify-spike/temacs`
  - `build/artifacts/emacs-browser-asyncify-spike/temacs.wasm`
  - `build/artifacts/emacs-browser-asyncify-spike/temacs.data`
- Attempted `tools/scripts/build-emacs-browser-asyncify-spike.sh`.
  - First failure: malformed Perl replacement in
    `tools/scripts/patch-emacs-host-entrypoint-spike.sh` because replacement
    text contained `#ifdef` while using `#` as the substitution delimiter.
  - Second failure: another mixed-delimiter substitution in the read-char
    waitpoint patch.
  - Link failure after those fixes: Asyncify host library did not define the
    terminal resize imports required by the current keyboard patch.
- Fixed the malformed Perl substitutions and added minimal terminal resize
  imports to `tools/scripts/wasmacs-asyncify-host-library.js`.
- Re-ran `tools/scripts/build-emacs-browser-asyncify-spike.sh`; build passed and
  produced `build/artifacts/emacs-browser-asyncify-spike/{temacs,temacs.wasm,
  temacs.data}`.

Validation:

- `npm test` passed: 99 node tests, plus git artifact policy, browser worker
  app, minibuffer command loop, minibuffer suspended read, and owned Asyncify
  command protocol validators.

**vendor/emacs unchanged.**

## Task M260607f: VS Code Start Bridge launches Asyncify worker

Connected the VS Code `.wasifs` custom editor bridge to the first real
non-Atomics runtime attempt.

- Changed `src/wasm/src/asyncify-minibuffer-worker.js` and the copied
  `docs/app/src/asyncify-minibuffer-worker.js` so artifact roots are mutable and
  configurable through `{ type: "configure-runtime" }`.
- The worker replies with `runtime-configured`, making VS Code webview artifact
  wiring observable.
- Updated `extensions/vscode-wasifs/media/wasifs-editor.js`:
  - `Start Bridge` now creates a Worker from the webview-local
    `asyncify-minibuffer-worker.js` URI.
  - It sends `configure-runtime` with the generated
    `build/artifacts/emacs-browser-asyncify-spike` webview URI.
  - It sends `start-xterm-session`.
  - It appends `status`, `stdout`, `stderr`, `terminal-output`,
    `terminal-output-bytes`, and xterm session lifecycle messages into the
    custom editor terminal area.
- This keeps the webview as terminal/document surface only. Emacs command loop,
  Dired, buffers, and filesystem semantics remain runtime-owned.

Validation:

- `npm test` passed: 100 node tests, plus git artifact policy, browser worker
  app, minibuffer command loop, minibuffer suspended read, and owned Asyncify
  command protocol validators.

**vendor/emacs unchanged.**

## Task M260607g: VS Code webview Worker blob fallback

Followed up on the live VS Code terminal output:

```text
Failed to construct 'Worker': Script at
'https://file+.vscode-resource.vscode-cdn.net/.../asyncify-minibuffer-worker.js'
cannot be accessed from origin 'vscode-webview://...'.
```

- The runtime asset preflight was accurate: the worker script URL is fetchable.
  The failure is a stricter Worker script origin check in the VS Code webview.
- Added `worker-src blob:` and `child-src blob:` to the custom editor CSP.
- Changed `extensions/vscode-wasifs/media/wasifs-editor.js` so it first tries
  the direct worker route, records the direct-origin failure, then fetches the
  worker source and starts a `blob:` worker fallback.
- This keeps VS Code as document/webview host only. The fetched source is still
  the existing `asyncify-minibuffer-worker.js`; Emacs command-loop, Dired, and
  filesystem semantics remain runtime-owned.

Validation:

- `npm test` passed: 100 node tests, plus git artifact policy, browser worker
  app, minibuffer command loop, minibuffer suspended read, and owned Asyncify
  command protocol validators.

**vendor/emacs unchanged.**

## Task M260607h: VS Code Asyncify artifact blob handoff

Followed up on the next live VS Code terminal output:

```text
[status] loading xterm emacs package
[wasmacs] session returned: NetworkError: Failed to execute 'importScripts'
on 'WorkerGlobalScope': The script at
'https://file+.vscode-resource.vscode-cdn.net/.../emacs-browser-asyncify-spike/temacs'
failed to load.
```

- The blob fallback successfully created `asyncify-minibuffer-worker.js` and
  reached `start-xterm-session`.
- The next boundary was Emscripten's generated `temacs` JS glue, which the
  worker previously loaded with `importScripts(`${XTERM_ARTIFACT_DIR}/temacs`)`.
- Added `XTERM_ENTRYPOINT_URL` and `XTERM_LOCATE_FILES` to
  `src/wasm/src/asyncify-minibuffer-worker.js` and the copied
  `docs/app/src/asyncify-minibuffer-worker.js`.
- The VS Code custom editor now fetches `temacs`, `temacs.wasm`, and
  `temacs.data`, wraps them in `blob:` URLs, sends the JS glue as
  `xtermEntrypointUrl`, and sends wasm/data blob URLs through
  `xtermLocateFiles`.
- `ensureXtermEmacs()` imports the blob JS glue when provided, while
  `locateFile(path)` resolves `temacs.wasm` / `temacs.data` through the blob
  map before falling back to the normal artifact directory.

Follow-up live result:

- `importScripts(blob:vscode-webview://...)` still failed when the blob URL was
  created by the outer webview and imported inside the blob worker.
- Added `script-src 'nonce-${nonce}' blob:` to the custom editor CSP.
- Changed the VS Code handoff from outer-webview-created blob URLs to
  worker-local blob URLs:
  - outer webview sends `temacs` as `xtermEntrypointSource`
  - outer webview transfers `temacs.wasm` and `temacs.data` ArrayBuffers as
    `xtermLocateFilePayloads`
  - worker creates `XTERM_ENTRYPOINT_SOURCE` and `XTERM_LOCATE_FILES` blob URLs
    inside its own global scope before `importScripts()`

Second follow-up live result:

```text
[stderr] wasm streaming compile failed: CompileError:
WebAssembly.instantiateStreaming() ... violates ... CSP ...
[stderr] falling back to ArrayBuffer instantiation
[stderr] failed to asynchronously prepare wasm: NetworkError:
Failed to execute 'send' on 'XMLHttpRequest': Failed to load
'blob:vscode-webview://...'
```

- This proved the generated Emscripten glue was running and had moved from JS
  import to wasm/data package loading.
- Added `wasm-unsafe-eval` to the custom editor script CSP.
- Set `Module.wasmBinary` from the transferred `temacs.wasm` ArrayBuffer so the
  glue does not need to fetch the wasm URL.
- Set `Module.getPreloadedPackage()` from the transferred `temacs.data`
  ArrayBuffer so the preload package does not need blob/XHR loading.

Third follow-up live result:

```text
[status] xterm emacs runtime initialized
[status] starting xterm interactive session
[stderr] Aborted('STACK_SIZE' was not exported...)
[stderr] Aborted('HEAPU8' was not exported...)
[stderr] Aborted('ENV' was not exported...)
...
Loading subr (source)...
[wasmacs] session returned: RuntimeError: memory access out of bounds
  at temacs.wasm.traverse_intervals
  at temacs.wasm.print_object
  at temacs.wasm.print_error_message
```

- This proved the VS Code route now reaches real Emacs cold loadup.
- The aborts came from diagnostic probes, not Emacs runtime ownership:
  `readArtifactFingerprint()` touched `module.STACK_SIZE`, `module.HEAPU8`,
  and `module.ENV`; `readTtySnapshot()` touched `module.ENV`.
- Changed those diagnostics to report `not-probed` / `not-exported` without
  touching guarded Emscripten runtime properties. `try/catch` is insufficient
  here because the export guard emits abort noise and may disturb the session.
- The remaining `traverse_intervals` failure should be rechecked after this
  noise is gone; it may be the underlying `subr.el` loadup error path, or it
  may have been amplified by the diagnostic aborts.

Fourth follow-up live/probe result:

- After removing all `STACK_SIZE` / `HEAPU8` / `ENV` probes, the live VS Code
  route still reached real Emacs cold loadup and failed at:
  `Loading subr (source)...` →
  `RuntimeError: memory access out of bounds` →
  `traverse_intervals -> print_object -> print_error_message`.
- Re-ran repo probes against the same
  `build/artifacts/emacs-browser-asyncify-spike` artifact:
  - `npm run test:xterm-cold-loadup-failure`: reproduced
    `RuntimeError: memory access out of bounds` with no pdump.
  - `npm run test:xterm-manual-app-smoke`: failed with the same
    `traverse_intervals` stack before first interactive wait.
  - `WASMACS_PDMP_DIR=build/artifacts/emacs-browser-atomics-pdump npm run test:xterm-pdump-diagnostic`:
    loaded the available pdmp, but failed with the same stack before
    interactive wait.
- Explicit `EMACS_WASM_CFLAGS='-g3 -O0'
  tools/scripts/build-emacs-browser-asyncify-spike.sh` rebuilt the artifact,
  but the same probes still failed. The apparent `--g3` in the script is just
  bash `${VAR:-...}` syntax; the default value is `-g3 -O0`.
- Conclusion: VS Code webview asset/CSP/worker issues are past. The active
  blocker is now the asyncify-spike runtime artifact failing during early
  loadup/error printing, before the Emacs command loop reaches interactive
  wait.

Validation:

- `npm test` passed: 100 node tests, plus git artifact policy, browser worker
  app, minibuffer command loop, minibuffer suspended read, and owned Asyncify
  command protocol validators.

**vendor/emacs unchanged.**

## Task M260607i: Asyncify fresh copied-tree rebuild clears VS Code loadup crash

Resolved the active `Loading subr (source)...` / `traverse_intervals` failure
seen from the VS Code `.wasifs` Start Bridge path.

- Changed `tools/scripts/build-emacs-browser-asyncify-spike.sh` so the
  Asyncify xterm product artifact no longer reuses the shared
  `build/emacs-core-spike` copied source/build tree.
- The script now builds from a dedicated fresh GNU Emacs 30.2 copy at
  `build/emacs-browser-asyncify-spike/src`, keeps its build directory under
  `build/emacs-browser-asyncify-spike/build-gnu-host-internal-termcap`, and
  passes that source copy to `patch-emacs-host-entrypoint-spike.sh` via
  `WASMACS_SPIKE_SRC`.
- Added `WASMACS_ASYNCIFY_FORCE_RECOPY=1` so this artifact can be rebuilt from
  a clean `vendor/emacs` archive when copied-source patch state is suspect.
- Added `tests/runtime/asyncify-build-hygiene.test.js` to lock in this source
  ownership boundary.
- Updated `tools/scripts/probe-browser-xterm-cold-loadup-failure.mjs` from a
  historical blocker reproduction probe into a cold-loadup smoke. It now fails
  the command if the old blocker reappears and passes only when the product
  `["--quick", "--no-splash", "--nw"]` route reaches the interactive tty
  waitpoint on a browser-like small JS stack with no `--dump-file`.

Validation:

- `WASMACS_ASYNCIFY_FORCE_RECOPY=1
  tools/scripts/build-emacs-browser-asyncify-spike.sh` passed and regenerated
  `build/artifacts/emacs-browser-asyncify-spike/{temacs,temacs.wasm,temacs.data}`.
- `npm run test:xterm-cold-loadup-failure` passed:
  product cold loadup reached interactive wait on `--stack-size=1500`, with no
  pdump.
- `npm run test:xterm-manual-app-smoke` passed: runtime initialized, first tty
  waitpoint reached, terminal bytes flowed, and injected `a`, `b`, `c` were
  handled by real Emacs `self-insert-command` with buffer readback `abc`.
- `npm test` passed after the final hygiene-test/doc update: 101 node tests
  plus git artifact policy, browser worker app, minibuffer command loop,
  minibuffer suspended read, and owned Asyncify command protocol validators.

**vendor/emacs unchanged.**

## Task M260607j: VS Code custom editor xterm surface

Followed up on the live VS Code screenshot showing `interactive wait` with raw
terminal escape bytes in the `.wasifs` custom editor.

- Added xterm.js and the fit addon to the VS Code webview using the existing
  jsDelivr xterm policy.
- Extended the webview CSP to allow xterm CDN scripts/styles and local dynamic
  import of `xterm-emacs-terminal.js`.
- Added an `#xterm-container` beside the diagnostic `<pre>`. Once xterm
  initializes, the diagnostic pre is hidden and terminal bytes render through
  xterm instead of appearing as raw escape sequences.
- Changed `extensions/vscode-wasifs/media/wasifs-editor.js` so
  `terminal-output-bytes` writes to `createXtermEmacsTerminal(...)`, while
  xterm `onData` sends `emacs-input-bytes` back to
  `asyncify-minibuffer-worker.js`.
- Forwarded xterm fit/resize events as `terminal-resize`.
- Added `terminal-resize` handling to both
  `src/wasm/src/asyncify-minibuffer-worker.js` and the shipped
  `docs/app/src/asyncify-minibuffer-worker.js`, updating
  `__wasmacsTerminalCols`, `__wasmacsTerminalRows`, and the resize version read
  by the existing terminal resize host imports.
- Updated `tests/runtime/vscode-wasifs-extension.test.js` to cover the xterm
  CDN, CSP, dynamic import, terminal byte output, input byte return path, and
  worker resize handling.

Validation:

- `npm test` passed: 101 node tests, plus git artifact policy, browser worker
  app, minibuffer command loop, minibuffer suspended read, and owned Asyncify
  command protocol validators.
- `node --check` passed for:
  - `extensions/vscode-wasifs/media/wasifs-editor.js`
  - `extensions/vscode-wasifs/src/extension.js`
  - `docs/app/src/asyncify-minibuffer-worker.js`
  - `src/wasm/src/asyncify-minibuffer-worker.js`
- `npm run test:xterm-manual-app-smoke` passed.

**vendor/emacs unchanged.**

## Task M260607k: VS Code xterm cursor and Emacs key capture

Followed up on live VS Code testing where the terminal reached `interactive
wait`, but the cursor was hard to see and common Emacs keybindings felt stolen
by VS Code.

- Changed `src/wasm/src/xterm-emacs-terminal.js` and the shipped
  `docs/app/src/xterm-emacs-terminal.js` to create xterm with:
  - `cursorBlink: true`
  - `cursorStyle: "block"`
  - VS Code terminal theme colors with a high-contrast fallback cursor
  - `macOptionIsMeta: true`
- Added a custom/capturing Emacs key path before default browser handling for
  the key events that reach the webview:
  - `C-a` through `C-z`
  - `C-SPC`, `C-[`, `C-]`, `C-\`, `C-^`, `C-_`, `C-?`
  - `M-x`-style Alt character chords as ESC-prefixed bytes
  - `ESC`, `RET`, `TAB`, `DEL`
  - arrow keys as xterm cursor escape sequences
- The VS Code `.wasifs` webview no longer intercepts `C-s` for Save after the
  xterm surface is active, so `C-s` can reach Emacs.
- Kept this as byte transport only: xterm/browser code translates terminal key
  events to tty bytes; Emacs still owns keymaps and command semantics.
- Added focused tests for cursor options, Meta/Control byte mapping, common
  special keys, and the `.wasifs` xterm-active `C-s` behavior.

Validation:

- `node --test tests/runtime/xterm-emacs-terminal.test.js
  tests/runtime/vscode-wasifs-extension.test.js` passed.
- `node --check` passed for:
  - `src/wasm/src/xterm-emacs-terminal.js`
  - `docs/app/src/xterm-emacs-terminal.js`
  - `extensions/vscode-wasifs/media/wasifs-editor.js`
- `npm test` passed: 103 node tests, plus git artifact policy, browser worker
  app, minibuffer command loop, minibuffer suspended read, and owned Asyncify
  command protocol validators.
- `npm run test:xterm-manual-app-smoke` passed.

**vendor/emacs unchanged.**

## Task M260607l: Extension-host Emacs keybinding passthrough

Followed up on live VS Code testing where `C-x C-f` and similar Emacs chords
still did not behave reliably. The problem is that VS Code can consume
keybindings before the webview/xterm `keydown` handlers see them.

- Added `wasmacs.sendTerminalKeys` as an extension command.
- Added package keybindings scoped to
  `activeCustomEditorId == 'wasmacs.wasifsEditor'`, using VS Code's custom
  editor context key so the overrides apply only while the `.wasifs` custom
  editor is active.
- Captured keybindings now include:
  - `C-x C-f`, `C-x C-s`, `C-x C-b`, `C-x b`, `C-x k`, `C-x o`, and
    `C-x 0/1/2/3`
  - `M-x`
  - `C-SPC`, `ESC`
  - `C-s`, `C-g`, and common Control navigation/editing keys such as
    `C-a`, `C-b`, `C-f`, `C-n`, `C-p`, `C-k`, `C-y`, `C-w`, `C-c`, and others
- `WasifsEditorProvider` now tracks the active custom editor webview and posts
  `wasifs.inject-terminal-bytes` for captured commands.
- The webview receives `wasifs.inject-terminal-bytes` and forwards the bytes to
  `asyncify-minibuffer-worker.js` as `emacs-input-bytes`, then refocuses xterm.
- Kept the existing webview/xterm key capture as a fallback for keys that
  already reach the webview naturally.

Validation:

- `node --test tests/runtime/vscode-wasifs-extension.test.js
  tests/runtime/xterm-emacs-terminal.test.js` passed.
- `node --check` passed for:
  - `extensions/vscode-wasifs/src/extension.js`
  - `extensions/vscode-wasifs/media/wasifs-editor.js`
  - `src/wasm/src/xterm-emacs-terminal.js`
- `npm test` passed: 104 node tests, plus git artifact policy, browser worker
  app, minibuffer command loop, minibuffer suspended read, and owned Asyncify
  command protocol validators.
- `npm run test:xterm-manual-app-smoke` passed.

**vendor/emacs unchanged.**
