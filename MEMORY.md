# MEMORY.md

Append-only project memory for `wasmacs`.

## 2026-06-03: OS Compatibility Boundary

- The OS compatibility layer should be organized around ownership and
  diagnosability before memory reduction.
- Low-level lifecycle, memory/root, GC permission, preloaded-state,
  relocation/root identity, and JS-to-Emacs entrypoint ownership belong to
  Emacs C core plus C/wasm facades.
- JavaScript remains browser coordinator, host capability provider, protocol
  mover, UI renderer, persistence layer, and diagnostic harness. It must not
  own raw `Lisp_Object`, GC roots, `specpdl`, pure space, relocation tables,
  preloaded-state identity, or editor semantics.
- `docs/os-compatibility-boundary.md` is the current ownership inventory.
  `app/src/small-os-services.js` mirrors it with
  `OsCompatibilityBoundaryInventory` for tests and browser-side diagnostics.
- The next useful diagnostic facades are copied-state probes such as
  `wasmacs_os_root_safety_probe`, `wasmacs_os_stack_bounds_probe`,
  `wasmacs_os_blocking_input_state`, and `wasmacs_os_terminal_state`.
- Memory reduction is not a success criterion for this boundary pass. The
  current real-route terminal smoke blocker remains Asyncify resume/memory
  layout after the first tty input.

## 2026-06-03: Diagnostic C/wasm OS Facades

- The first boundary-registry probes are diagnostic-only C/wasm exports:
  `wasmacs_os_lifecycle_state`, `wasmacs_os_stack_bounds_probe`,
  `wasmacs_os_gc_permission_state`, and
  `wasmacs_os_root_safety_probe`.
- They are generated through `scripts/patch-emacs-host-entrypoint-spike.sh`;
  `vendor/emacs` remains read-only.
- JS reads copied JSON snapshots only through the worker debug message
  `os-diagnostic-snapshot` or the probe script. JS still must not own
  `Lisp_Object`, GC roots, `specpdl`, pure space, relocation, or lifecycle
  state.
- The probe to rerun after rebuilding the persistent artifact is
  `node scripts/probe-browser-os-diagnostic-facade.mjs`.

## 2026-06-03: Resume Memory/Root Probe

- `scripts/probe-browser-os-resume-memory-root.mjs` records copied C/wasm
  diagnostic snapshots around Asyncify wait, input injection, resume, command
  completion, and explicit GC.
- Logs:
  `logs/wasm-browser-os-resume-memory-root.txt` and
  `logs/wasm-browser-os-resume-memory-root.jsonl`.
- Checkpoints: `after-boot`, `before-asyncify-wait`, `pending-input`,
  `before-input-injection`, `after-input-injection-before-resume`,
  `after-resume`, `after-command-complete`, and `after-explicit-gc`.
- Observed baseline: pending input blocks GC with reason
  `blocked:pending-command` and guard depth 1; after resume/completion/GC it
  returns to `initialized` / `idle` / GC `allowed` / guard depth 0. Stack roots
  stay fresh in these copied snapshots.
- JS-observed Asyncify wait can be active again immediately after resume; that
  points to Blocking Input Scheduler diagnostics next, not JS ownership of
  lifecycle or GC policy.

## 2026-06-03: Blocking Input Scheduler Probe

- `scripts/probe-browser-blocking-input-scheduler.mjs` records tty route
  scheduler checkpoints around `emacs --quick --no-splash --nw`, first
  Asyncify wait, terminal byte queueing, wait resolve, resume, and failure.
- Logs:
  `logs/wasm-browser-blocking-input-scheduler.txt` and
  `logs/wasm-browser-blocking-input-scheduler.jsonl`.
- Current observation: first tty wait is reached with wait id/count 1 and
  resolver present. Queueing printable `a` adds queued byte `[97]`. Resolving
  wait id 1 clears the resolver, but JS does not regain control for resume /
  next-wait before timeout; parent adds a `failure` checkpoint. The queued byte
  remains unconsumed.
- Copied C/wasm lifecycle, GC permission, and root-safety stay
  `initialized`, `allowed`, and `allowed` at the last snapshot. Treat the next
  blocker as Blocking Input Scheduler / tty Asyncify resume contract, not
  Memory and Root, unless a later lower-level probe contradicts this.
- Fine-grained boundary events now show `read_char` reached, JS wait import
  entered, resolver called, and resolve-after recorded. The import promise
  `.then`, `sysdep.c` tty wait return, terminal byte dequeue, and C-side byte
  dequeue are not recorded. The byte remains queued. The current stop point is
  before Asyncify resumes into the tty read/dequeue path.

## 2026-06-03: Asyncify Import Contract Probe

- `scripts/probe-asyncify-import-contract.mjs` is the minimal non-Emacs
  fixture for the Promise / Asyncify import contract. It builds
  `tests/fixtures/asyncify-import-contract.c` with
  `tests/fixtures/asyncify-import-contract-library.js`.
- `ASYNCIFY_IMPORTS` includes raw Promise, async-wrapper, and
  `Asyncify.handleAsync` import names. The flag recognizes the imports, but a
  JS import that only returns a Promise does not suspend C execution.
- Observed fixture result: raw Promise and `async function` wrapper imports
  both run their Promise `.then`, but C has already advanced to the post-import
  phase and sees return value 0. `Asyncify.handleAsync` is the path that keeps
  C suspended until the resolver runs and returns the resolved integer to C.
- Real `wasmacs_host_wait_for_input` currently matches the async-wrapper
  shape: Promise state has `createdPromiseId`, `resolverPromiseId`, and
  `thenPromiseId`, but the actual returned Promise is an unobservable async
  function wrapper; `callMain` returns 0, `.then` is not reached before
  timeout, and queued byte `[97]` remains unconsumed.
- Next likely fix target is diagnostic-only import wiring around
  `Asyncify.handleAsync`, not `sysdep.c` byte dequeue or Memory/Root.

## 2026-06-03: Blocking Input Scheduler HandleAsync Comparison

- `scripts/wasmacs-asyncify-host-library.js` now supports diagnostic wait
  import modes via `WASMACS_WAIT_IMPORT_MODE=async-wrapper|handleAsync`.
- `scripts/probe-browser-blocking-input-scheduler.mjs` runs both modes by
  default and writes mode-specific logs:
  `logs/wasm-browser-blocking-input-scheduler-async-wrapper.*` and
  `logs/wasm-browser-blocking-input-scheduler-handleasync.*`.
- async-wrapper reproduces the previous failure: `c-keyboard-after-wait-return`
  appears before resolver, resolver clears, no Promise `.then`, no sysdep tty
  wait/read, and queued byte `[97]` remains.
- handleAsync changes one important boundary: `c-keyboard-after-wait-return`
  is no longer observed before resolver, and the import records
  `js-import-handleasync-enter`,
  `js-import-handleasync-promise-created`, and
  `js-import-handleasync-returning`.
- handleAsync still does not complete resume after resolver in the observed
  run: no Promise `.then`, no C wait return after resolver, no
  `c-sysdep-before-wait`, no terminal byte dequeue, queued byte `[97]`
  remains, and `callMain` still returns 0 instead of a Promise.
- Next target is the Emscripten export/callMain Asyncify resume handoff
  (`Asyncify.currData`, `asyncPromiseHandlers`, async-aware entrypoint use),
  not sysdep byte dequeue yet.
## 2026-06-03: Asyncify Outer Entrypoint / callMain Resume Boundary

- Outer invocation form is NOT the root cause of the handleAsync probe failure.
  A minimal fixture confirms all three methods (`callMain`, `ccall+{async:true}`,
  direct `_fn()`) resume C correctly with `Asyncify.handleAsync`.
- Root cause of the blocking-input-scheduler handleAsync probe failure was the
  probe harness itself: a single `await setTimeout(0)` was insufficient to drain
  the vm context's microtask queue after `resolve(0)` is called cross-context.
  Replacing it with a poll loop (200 × 10ms) fixes it.
- `handleAsync` mode now PASSES end-to-end: byte consumed, C resumes, tty read
  dequeues byte, and the interactive command loop enters 3 consecutive input
  waits. This is the confirmed resume path for `wasmacs_host_wait_for_input`.
- `callMain` returning 0 (not a Promise) is by design: Asyncify.handleAsync does
  not need the outer caller to await a Promise to resume. Asyncify.currData is
  set after callMain returns, and the Promise chain fires asynchronously.
- New diagnostic accessor `__wasmacsGetAsyncifyState()` added to
  `wasmacs-asyncify-host-library.js` (requires artifact rebuild to activate).
  Exposes `Asyncify.currData`, `asyncPromiseHandlers`, `exportCallStackLength`.
- New outer-resume fixture probe: `scripts/probe-browser-asyncify-outer-resume.mjs`
  + `tests/fixtures/asyncify-outer-resume.{c,library.js}`.
  Logs: `logs/wasm-browser-asyncify-outer-resume*.{txt,jsonl}`.
- Next diagnostic target: confirm byte delivery path end-to-end via
  `wasmacs_host_terminal_read_byte` → `sysdep.c` → `keyboard.c` `read_char`.
  The `c-sysdep-before-wait` checkpoint is not reached because the wait import
  is called from `keyboard.c`, not through `sysdep.c`'s `read_avail_input`.

## 2026-06-03: handleAsync Product-Candidate Smoke

- `handleAsync` mode is confirmed as diagnostic success / product candidate for
  `wasmacs_host_wait_for_input`.
- `async-wrapper` mode is known-broken: do not use in product path.
- Continuous loop smoke (`probe-browser-blocking-input-handleasync-loop.mjs`)
  confirmed: FIFO input (a, b, c), multi-byte queue (xy), C-g transport (0x07),
  and no-input timeout stability. All 5 rounds pass. finalGuardDepth=0. 
  waitCountMonotone=true. allRoundsCResumed=true.
- vm-context microtask latency (~22s per round in Node.js vm) is a probe harness
  artifact. The 60s pollForEvent window is NOT needed in production browser context.
- Next: rebuild wasm artifact with handleAsync as default, then verify in browser.
- C-g semantic ownership is Emacs (Fkeyboard_quit path); JS only transports the byte.

## 2026-06-03: handleAsync Product Default

- `handleAsync` is now the product default for `wasmacs_host_wait_for_input`.
  Default changed in `scripts/wasmacs-asyncify-host-library.js` from
  `'async-wrapper'` to `'handleAsync'`. Artifact rebuilt and verified.
- `async-wrapper` retained as known-broken comparison mode; selectable via
  `WASMACS_WAIT_IMPORT_MODE=async-wrapper`.
- All probes pass without env var: `test:blocking-input-scheduler` (PASS),
  `test:handleasync-loop` (PASS 5 rounds), `test:worker-handleasync-smoke`
  (PASS 3 rounds, worker_threads), `npm test` (PASS).
- `scripts/probe-browser-worker-handleasync-input-smoke.mjs`: worker_threads
  correctness smoke. Mirrors browser Web Worker architecture (wasm + resolver
  in same thread). vm.runInContext latency (~30s/round) still applies; this
  probe verifies correctness only, not speed.
- `wasmacs_os_gc_permission_state` returns a JSON string (not a number); parse
  with JSON.parse and extract `wasmacsGcGuardDepth` or `garbageCollectionInhibited`.
- Next focus: keyboard.c event semantics / C-g semantics / product editor input
  integration. Byte transport is confirmed end-to-end.

## 2026-06-03: keyboard.c Event Semantics

- `wasmacs_eval_string` is callable while Emacs is suspended at
  `wasmacs_host_wait_for_input` when reached via `callMain`. This is because
  `wasmacs_command_busy = 0` in the `callMain` path (it is only set to 1 by
  explicit entrypoint exports like `wasmacs_command_begin_*`).
- Probe: `scripts/probe-browser-keyboard-event-semantics.mjs`. All 8 key types
  confirmed. Buffer text / point / last-command readback works.
- Confirmed semantics (Emacs owns them, JS transport only):
  printable → self-insert-command, CR → newline,
  DEL (0x7f) → delete-backward-char, C-g → keyboard-quit,
  ESC+x → execute-extended-command (M-x).
- `command-state = idle` at wait points; `this-command = nil`.
- finalGuardDepth=0 after all 8 keys.
- Next: product editor input integration (keyboard events → postMessage → byte
  queue → wait resolver in Web Worker).

## 2026-06-04: M260604 External Pdmp Load Audit

### Artifact Inventory

- 4 `.pdmp` files exist across 4 build profiles.
- `bootstrap-emacs.pdmp`: 3 identical copies (sha256: d84661b2...), 1 different
  (sha256: e1640c9c..., interactive profile).
- pdmp load was previously verified under Node (see
  `logs/emacs-pdump-node-load-pass.txt`): `VERSION:30.2`, `GC:PASS`,
  `PDUMP:loaded`.
- Full inventory recorded in `logs/pdmp-artifact-inventory.txt`.

### External Pdmp Load Probe

- New probe: `scripts/probe-browser-pdump-external-load.mjs`
- Logs: `logs/wasm-browser-pdump-external-load.txt` +
  `logs/wasm-browser-pdump-external-load.jsonl`
- Two profiles tested:
  1. **pdmp-profile** (artifacts/emacs-browser-pdump-profile): temacs has NO
     pdumper compiled in. `--dump-file` silently ignored; cold loadup fallback
     succeeds. VERSION:30.2 + GC:PASS via cold loadup, NOT pdmp.
  2. **pdump-probe-tree** (build/emacs-pdump-configure-probe): temacs.wasm was
     overwritten by interactive build (same sha256: b293443b...). OOM on load.
- Rebuild blocked: copied source tree has Asyncify patches
  (`wasmacs_host_wait_for_input`) that introduce undefined link symbols.

### Level Classification

| Level | Status | Evidence |
|-------|--------|----------|
| 0 (artifact exists) | PASS | 4 files, ~26MB each |
| 1 (MEMFS placement) | PASS | FS_createDataFile + NODERAWFS |
| 2 (pdumper load path) | PASS | PDUMP_STATS:loaded |
| 3 (simple eval) | PASS | VERSION:30.2 |
| 4 (explicit GC) | PASS | GC:PASS |
| 5 (tty command loop) | NOT VERIFIED | binary overwritten |
| 6 (browser worker) | NOT VERIFIED | depends on Level 5 |

### Service Classification

- **Preloaded-State Service**: external pdmp artifact exists and load route is
  proven. pdmp must match fingerprint of the loading emacs-core.wasm.
- **Memory And Root Service**: post-pdmp explicit GC passes. GC permission
  state returns to `allowed` after pdmp load.
- **Known Blockers**: pdmp-probe tree temacs was overwritten and needs rebuild
  with correct build flags (NODERAWFS=1, 512MB fixed memory, pdumper enabled).
  Source tree patches must be cleaned up or a fresh configure is needed.

### Manifest

- `artifacts/preloaded-state/emacs-30.2/manifest.json` records all 4 matching
  sets with sha256 cross-references, known patches, and load evidence.

### Test Scripts

- `npm run test:pdump` → runs external load probe (lightweight, ~65s)
- `npm run test:pdump:generate` → reserved for pdmp generation probe (not yet
  implemented; existing evidence validates current pdmp)

## 2026-06-05: M260605 atomic pdmp artifact recovery

- If `pdump-diagnostic.html` regresses after repeated build-script runs, first
  inspect generated-source duplication in
  `build/emacs-pdump-configure-probe/src/src/keyboard.c`. Repeated os-compat
  insertion can corrupt the generated copy even though `vendor/emacs` is clean.
- `bootstrap-emacs.pdmp` must be generated by the same final Atomics
  `temacs.wasm` that will load it. A stub-linked pdmp generator can produce a
  valid pdmp with a different fingerprint, but the browser runtime will reject
  it as `not built for this Emacs executable`.
- Browser-target final runtime has no NODERAWFS, so `--temacs=pbootstrap`
  creates `/bootstrap-emacs.pdmp` inside MEMFS. Extract it with
  `Module.FS.readFile("/bootstrap-emacs.pdmp")` and write that byte array to
  `artifacts/emacs-browser-atomics-pdump/bootstrap-emacs.pdmp`.
- Current proven-good artifact pair:
  - `temacs.wasm` sha256:
    `54b813bb07d12fe638f68bf03a1364974302098c9bc32d2f853c705b46df6d69`
  - `bootstrap-emacs.pdmp` sha256:
    `c0958f4c717f95bff00f027af79b370b5c0170d34b24c32a956817645842b0d2`
- Proven page path:
  `pdump-diagnostic.html` Generate pdmp → Reload + Eval + GC gives
  `version=30.2`, `pdump=LOADED`, `gc=GC-OK`, `D3+D4 PASS`.
- Still open:
  `Boot Test (--eval)` in the page can fall into `normal-top-level` and fail on
  missing `japan-util`; `--nw` still aborts before Atomics.wait. Treat these as
  separate callMain/argument lifecycle or TTY command-loop issues, not as pdmp
  artifact generation failures.

## 2026-06-05: M260605 pdmp + Atomics wait proof

- The `japan-util` and pre-wait abort blockers were resolved for the
  `emacs-browser-atomics-pdump` route. The copied pdump source tree must include
  native-generated `lisp/subdirs.el`, `international/charprop.el`, and all
  `international/uni-*.el` before pbootstrap.
- Source-backed causes:
  - `vendor/emacs/src/bidi.c:bidi_initialize` aborts when Unicode property
    char-tables such as `bidi-class` are missing.
  - `vendor/emacs/lisp/language/japanese.el` registers `features japan-util`;
    `vendor/emacs/lisp/international/mule-cmds.el` requires those features, so
    `lisp/subdirs.el` is needed to put `language/` on `load-path`.
- Use `-nw`, not `--nw`, for Emacs no-window-system startup. After restoring
  `subdirs.el`, Emacs reached option parsing far enough to report
  `Unknown option '--nw'`.
- Current proven artifact pair:
  - `temacs.wasm` sha256:
    `07b7fd96c63f36b93fbee8f5afcd0b8c5855e2b6d40d3877cbe4ec5c26002312`
  - `bootstrap-emacs.pdmp` sha256:
    `9b38b2761a1a0bbcfa3512fdcd44561bbcbccb8e5b99dc4d222e52e688828717`
- Proven browser path:
  `pdump-diagnostic.html` Generate + Boot Test reports `BOOT-VER: 30.2`,
  `BOOT-PDUMP: LOADED`, `BOOT-GC: PASS`; `xterm-atomics-pdump.html` reports
  `interactive wait ✓` with `wait-enter#1` and visible `*scratch*`.
- X4 input was initially incomplete after host input consumption, but the
  follow-up M260605b entry below now proves redisplayed `a` and `wait-enter#2`.

## 2026-06-05: M260605b pdmp Atomics X4 input/redisplay proof

- X4 is now proven for `xterm-atomics-pdump.html`: typing `a` through the
  browser reaches the host wait path, is consumed by Emacs, appears in
  `*scratch*`, and returns to the next Atomics waitpoint.
- Browser evidence:
  - `wait-enter#1 queue=0 out=2471`
  - `wait#1 bytes=1 queue=1`
  - `os-timing-checkpoint:1001` (`ASCII_KEYSTROKE_EVENT`)
  - `os-timing-checkpoint:1101`, `1121`, `42`, `420`, `421`
  - `wait-enter#2 queue=0 out=2565`
  - Page text extraction included a standalone `a` in `*scratch*`; the user also
    confirmed the `a` was visible on screen before automation text extraction
    caught up.
- Fix shape in `scripts/patch-emacs-host-entrypoint-spike.sh`:
  - After `wasmacs_host_wait_for_input()`, call `gobble_input()` so Emacs'
    terminal input path fills `kbd_buffer`.
  - For wasm tty keystrokes, set `*kbp = current_kboard` before the
    `event_to_kboard(&event->ie)` frame lookup.
  - For lispy tty keystrokes, use `selected_frame` before normal frame/focus
    resolution touches `XFRAME(frame)`.
  - Suppress wasm switch-frame synthesis for tty keystrokes.
- Latest proven artifact pair:
  - `temacs.wasm` sha256:
    `3812ecc58f01ac9c88e93b3af050d7036109488e412352347854f15edf478ab3`
  - `bootstrap-emacs.pdmp` sha256:
    `fe66c16d682ac8ecbbaafc15d029752db0262153a09351532d5ab2a31f6d5b0e`

## 2026-06-05: M260605c pdmp Atomics input latency fix

- The 30 second delay after typing `a` on `xterm-atomics-pdump.html` was not an
  Asyncify regression.  The route is `emacs-atomics-pdump-worker.js` using the
  Atomics / `NO Asyncify` artifact.
- Cause: Emacs' `auto-save-timeout` timer path caused the wasm process to spin
  in terminal availability checks until the ~30s timeout.  Before the fix,
  `a` to `wait-enter#2` was ~30.2s and `fio` reached `14534857`.
- Fix: start the pdmp Atomics worker with `(setq auto-save-timeout nil)`.
- Validation after the fix:
  - boot to `*scratch*`: ~3.2s
  - typed `a` to visible `a` and `wait-enter#2`: `50ms`
  - debug tail: `wait-enter#2 queue=0 out=2565 fio=4`
- A broad worker `setTimeout` shortening patch was tested first, but did not
  improve the latency by itself; keep the final fix narrow at the Emacs startup
  setting.

## 2026-06-05: M260605d pdmp generated loaddefs and Org

- Keep `auto-save-timeout nil` in the pdmp Atomics worker; it preserves the
  fast key-to-redisplay path after the 30 second timer/FIONREAD latency issue.
- `cl-subseq` / Org eager macro-expansion failures on
  `xterm-atomics-pdump.html` are caused by missing generated loaddefs in the
  copied pdump source tree.  The build must sync native-generated
  `*loaddefs*.el` and `loaddefs.el` from
  `build/native-emacs-30.2/src/lisp` before pbootstrap.
- Important generated files now expected in the pdump source tree:
  `emacs-lisp/cl-loaddefs.el`, `org/org-loaddefs.el`, and top-level
  `loaddefs.el`.
- Validation evidence after rebuild:
  - `(require 'org)` returns
    `org=t org-mode=t cl-subseq=t` and locates
    `/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-loaddefs.el`.
  - Opening `/home/user/test.org`, entering `org-mode`, and inserting
    `* Heading from wasmacs` returns
    `file="/home/user/test.org" mode=org-mode`.
- Browser `xterm-atomics-pdump.html` refreshed pdmp reaches `interactive wait ✓`
  and visible `*scratch*`; automated `C-x C-f` was blocked by the Browser tool's
  clipboard shortcut guard, so full UI key-driven `.org` editing still needs
  manual confirmation or a dedicated xterm input hook/probe.
