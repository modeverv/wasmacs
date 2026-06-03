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
