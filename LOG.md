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
