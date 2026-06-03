# OS Compatibility Boundary

This document inventories the current wasmacs OS compatibility layer as a
small runtime contract for GNU Emacs. The goal of this pass is not memory
reduction. The goal is to make ownership explicit enough that memory, root,
lifecycle, GC, preloaded-state, and entrypoint failures can be diagnosed
without moving Emacs editor semantics into JavaScript.

`vendor/emacs` remains read-only. Source patches live in generated/copied
source scripts such as `scripts/patch-emacs-host-entrypoint-spike.sh` until an
explicit upstream patch experiment is chosen.

## Boundary Rule

Emacs owns editor semantics and low-level runtime safety.

JavaScript may coordinate the browser, provide host capabilities, render UI,
move protocol messages, persist/import/export filesystem images, and run
diagnostic harnesses. JavaScript must not own raw `Lisp_Object` values, Emacs
GC roots, `specpdl`, pure space, relocation tables, preloaded-state object
identity, undo, kill-ring, minibuffer, buffer, or window semantics.

## Layer Names

| Layer | Allowed role |
| --- | --- |
| Emacs C core | Owns editor state, Lisp machine state, GC roots, command loop, buffers, windows, undo, minibuffer, and source-truth lifecycle. |
| C/wasm facade | Owns explicit wasmacs OS contract state at JS-to-Emacs boundaries: lifecycle snapshots, GC permission, entrypoint stack/root refresh, pending-command state, root-safety probes, and terminal C-side compatibility decisions. |
| Emscripten runtime | Owns wasm memory, JS syscall glue, Asyncify suspension mechanics, libc/FS/TTY runtime objects, and browser worker integration points. |
| JS worker | Coordinates one wasm instance, passes terminal bytes, observes copied state strings/status codes, resolves Asyncify waits, and runs diagnostics. |
| Browser main thread | Owns page event loop, UI rendering, user gestures, xterm.js or future renderer integration, and smoke orchestration. |
| App UI | Displays state and unavailable boundaries. It never implements Emacs editor semantics. |

## Service Inventory

| Service | Current implementation and owner | Current state owner | Desired owner | Current risk | Next minimal facade or probe |
| --- | --- | --- | --- | --- | --- |
| Lifecycle | `app/src/small-os-runtime.js` mirrors browser command phases; copied `emacs.c` exposes `wasmacs_os_lifecycle_phase`; Emscripten `EXIT_RUNTIME=0` keeps the wasm runtime alive. | Mixed: Emacs C core has `initialized`, `command_loop_level`, `minibuf_level`; JS coordinator has mirrored phases; Emscripten owns process-exit behavior. | Emacs C core plus C/wasm facade. JS only reads copied lifecycle snapshots. | JS mirror can drift from Emacs after Asyncify aborts or early exits; browser can think command lifecycle is clean while Emacs is still suspended or dead. | Keep `wasmacs_os_lifecycle_phase`; add diagnostic `wasmacs_os_lifecycle_state` that reports initialized, command loop level, minibuffer level, pending command flag, and last exit/abort marker. |
| Memory and Root | Copied `emacs.c` refreshes `stack_bottom` / `current_thread->stack_top` in exported entrypoint macros; backtrace pin and GC guard are diagnostic facades; JS calls snapshot exports. | Emacs C core and copied C/wasm facade for stack/root snapshots; JS stores only strings. Emscripten owns wasm memory bounds. | C/wasm facade owns every entrypoint root refresh, GC permission, and root-safety probe. JS observes copied text/status. | Some exports still bypass a named begin/end facade; Asyncify resume OOM/root failures are hard to classify; backtrace pin is diagnostic and still not the final ownership policy. | Add diagnostic `wasmacs_os_entrypoint_begin`, `wasmacs_os_entrypoint_end`, `wasmacs_os_root_safety_probe`, and `wasmacs_os_stack_bounds_probe`. Do not let JS read raw roots. |
| Control Flow | `wasmacs_os_begin_command`, `wasmacs_os_finish_command`, `wasmacs_os_cancel_command`, worker pending-command state, and Asyncify wait resolution. | Mixed: C facade has `wasmacs_command_busy` and GC guard depth; JS worker has pending command messages and Asyncify resolver. | C/wasm facade owns command guard and reentrancy decision. JS worker owns protocol message lifecycle only. | Reentrant eval/command calls can appear safe from JS but unsafe from Emacs stack/root state; forced minibuffer probes can be mistaken for product APIs. | Add `wasmacs_os_pending_command_state` as the only product-read state, plus diagnostic `wasmacs_os_reentrant_entrypoint_probe` for explicit unavailable/busy evidence. |
| Blocking Input Scheduler | `wasmacs_host_wait_for_input` is an Asyncify import; JS worker resolves waits and queues terminal bytes; `sysdep.c` copied-source patch routes tty reads to JS byte queue. | JS worker owns browser wait resolution and input queue; Emacs C core owns command loop and `read_char`; Emscripten/Asyncify owns suspension machinery. | Emacs C core owns command/input semantics; C/wasm facade owns blocking-input state; JS only resolves host wait and supplies bytes. | Input wait resolution can resume into Asyncify memory/runtime failure before semantics are testable; terminal input queue and wait resolver can get out of sync. | Add diagnostic `wasmacs_os_blocking_input_state` reporting waitpoint kind, pending resolver flag, queued bytes count, and command-loop level as copied data. |
| Filesystem and Persistence | Browser persistent worker materializes user files into Emscripten FS; `.wasifs` import/export lives in JS/runtime modules; reverse sync is gated by `small-os-runtime.js`. | JS app owns portable image persistence and browser storage; Emscripten owns in-memory FS; Emacs owns visited buffer/file semantics. | JS owns persistence media and import/export artifacts. Emacs C core owns file-visiting and buffer state. C/wasm facade should define safe sync boundaries. | Reverse sync can corrupt live buffer/undo if it runs during a command; JS file state can look authoritative when Emacs has unsaved buffer state. | Keep reverse sync at command completion; add diagnostic `wasmacs_os_filesystem_sync_boundary_state` before productizing deeper sync. |
| Preloaded State | pdump/pbootstrap and cold-loadup probes are diagnostic lanes; browser terminal route currently avoids returning to pdmp as the active product path. | Mixed: Emacs/pdumper owns object identity and relocation semantics; copied C/wasm probes expose status; JS may fetch/bootstrap artifacts for diagnostics. | Emacs C core plus C/wasm facade own preloaded-state identity, relocation, pure space, static roots, and retirement of bootstrap roots. JS only provides artifact bytes and diagnostics. | JS artifact handling can be mistaken for ownership of preloaded object identity; pdump diagnostics can accidentally become product startup. | Keep `wasmacs_os_preloaded_state_status` / load probes diagnostic until relocation/static-root semantics and explicit GC pass. |
| Terminal/Tty | `scripts/wasmacs-asyncify-host-library.js` installs fake TTY, TERM/TERMCAP, winsize, terminal byte queues, and stdout/stderr byte reporting; copied `sysdep.c` blocks tty reads through Asyncify. | Emscripten TTY/FS and JS worker own byte transport; Emacs C core owns terminal startup, redisplay, command loop, and key handling. | C/wasm facade owns terminal compatibility decisions; JS owns byte transport and renderer only. | JS TTY state can silently become a pty substitute; memory/runtime failure after first resume currently blocks real semantics smoke. | Add `wasmacs_os_terminal_state` diagnostic around fd tty status, termios mode, winsize, pending input, output count, and source waitpoint. |
| Host Capability | JS provides wall-clock-ish runtime, environment, random/urandom, terminal bytes, browser events, and unavailable process/clipboard boundaries. | JS worker/main thread and Emscripten runtime. | JS remains host capability provider; C/wasm facade defines what capability is being requested and how failure is reported. | Broad JS shims can grow into product semantics or hide missing Emacs-required host APIs. | Add per-capability diagnostics only when Emacs source asks for them; keep process/pty/clipboard unavailable until a source-backed contract exists. |
| Browser GUI Boundary | App UI renders current adapter state, terminal smoke output, file list, unavailable boundaries, and smoke results; xterm.js is still deferred. | Browser main thread/app UI. | Browser main thread owns rendering and user input collection only. Emacs C core owns minibuffer, undo, kill-ring, buffer, and window semantics. | Existing adapter smokes can be confused with real command-loop semantics; UI can accidentally fake editor behavior. | Keep real-route terminal smokes separate from adapter smokes. Add xterm.js only after byte-level tty I/O and OS memory/runtime blocker are stable. |

## Ambiguous or Unsafe Ownership

| Area | Why it is ambiguous or unsafe | Current evidence | Treatment |
| --- | --- | --- | --- |
| JS small OS lifecycle mirror | It is useful for UI and reverse-sync gating, but it can drift from real Emacs lifecycle after Asyncify failure. | `app/src/small-os-runtime.js` owns `lifecyclePhase` while copied C also exports `wasmacs_os_lifecycle_phase`. | Keep as browser coordinator mirror; never treat it as source of truth for Emacs lifecycle. |
| Entry point root refresh | Some exports refresh stack bounds through local macros, but the named product facade is not yet a uniform begin/end pair. | `scripts/patch-emacs-host-entrypoint-spike.sh` defines `WASMACS_ENTER_HOST_ENTRYPOINT` and `WASMACS_LEAVE_HOST_ENTRYPOINT`. | Add diagnostic begin/end facade names and stack/root probes before widening exported calls. |
| GC permission | JS can observe `wasmacs_os_gc_permission`, but the actual permission combines lifecycle, pending command, stack/root, and Emacs GC inhibition. | C facade has `wasmacs_pending_gc_inhibit_depth` and `wasmacs_os_gc_permission`; JS only reads status. | Keep C/wasm owner; add richer copied status fields rather than JS-side policy. |
| Backtrace root pin | The copied-source pin is evidence for root safety, not product ownership. | Prior probes showed backtrace args/root issues across Asyncify resume. | Keep diagnostic until freeing/retirement and root-table policy are explicit. |
| Asyncify wait resolver | JS must resolve waits, but should not decide command semantics. | Worker sends terminal bytes and resolves `wasmacs_host_wait_for_input`; command loop remains in Emacs. | JS remains host scheduler only. Add copied blocking-input state to classify resume failures. |
| Preloaded state / pdump | Browser worker cold loadup and pdump evidence are diagnostic lanes, not current product startup. | `small-os-for-emacs.md` demotes pdmp/pbootstrap; terminal path is current product route. | Do not resume pdump as product work until terminal route fails with source-backed evidence or user asks. |
| Terminal TTY | JS owns Emscripten TTY byte transport today; Emacs owns terminal semantics. | The real-route smoke reaches `*scratch*` and tty waitpoint, then hits OS memory/runtime OOM on first resume. | Keep TTY as compatibility transport; do not fake editor behavior in JS. |

## Minimal Facade Candidates

These are diagnostic/probe candidates unless explicitly promoted later. They
are intentionally contract-shaped and source-backed.

| Candidate | Status | Owner | Source surfaces protected | Purpose |
| --- | --- | --- | --- | --- |
| `wasmacs_os_lifecycle_state()` | Diagnostic candidate | C/wasm facade | `vendor/emacs/src/emacs.c`, `vendor/emacs/lisp/loadup.el`, `vendor/emacs/src/pdumper.c` | Return copied lifecycle fields that explain whether Emacs is uninitialized, cold-loading, initialized, command-running, pending-input, shutting down, or dead. |
| `wasmacs_os_gc_permission_state()` | Diagnostic candidate | C/wasm facade | `vendor/emacs/src/alloc.c`, `vendor/emacs/src/thread.c`, `vendor/emacs/src/eval.c` | Return copied reasoned state: allowed, inhibited, blocked by lifecycle, blocked by pending command, blocked by stale roots. |
| `wasmacs_os_entrypoint_begin()` / `wasmacs_os_entrypoint_end()` | Diagnostic candidate | C/wasm facade | `vendor/emacs/src/thread.c`, `vendor/emacs/src/lisp.h`, `vendor/emacs/src/eval.c` | Make stack/root refresh a named pair rather than an implicit macro pattern. |
| `wasmacs_os_pending_command_state()` | Existing diagnostic/product scaffold | C/wasm facade | `vendor/emacs/src/keyboard.c`, `vendor/emacs/src/minibuf.c`, `vendor/emacs/src/callint.c` | Report idle, command-running, or pending-input without JS owning command semantics. |
| `wasmacs_os_root_safety_probe()` | Diagnostic candidate | C/wasm facade | `vendor/emacs/src/alloc.c`, `vendor/emacs/src/eval.c`, `vendor/emacs/src/lisp.h` | Prove the current exported entrypoint can safely allocate, inspect state, and survive explicit GC at declared safe points. |
| `wasmacs_os_stack_bounds_probe()` | Diagnostic candidate | C/wasm facade | `vendor/emacs/src/thread.c`, `vendor/emacs/src/lisp.h` | Return copied stack bottom/top/current pointer bounds, Emscripten stack current if available, and refresh counters. |
| `wasmacs_os_blocking_input_state()` | Diagnostic candidate | C/wasm facade plus JS copied transport fields | `vendor/emacs/src/keyboard.c`, `vendor/emacs/src/sysdep.c`, `vendor/emacs/src/term.c` | Classify waitpoint, pending input, queued bytes, and command-loop level before and after Asyncify resume. |
| `wasmacs_os_terminal_state()` | Diagnostic candidate | C/wasm facade plus Emscripten TTY provider | `vendor/emacs/src/dispnew.c`, `vendor/emacs/src/term.c`, `vendor/emacs/src/sysdep.c` | Make terminal availability, termios, winsize, input/output counters, and fd tty status observable as copied state. |

## Implemented Diagnostic Facades

2026-06-03 added the first copied-source diagnostic facade set in
`scripts/patch-emacs-host-entrypoint-spike.sh`. These entrypoints are exported
for wasm probes and read by JS as structured snapshots only. They are not
product command paths, do not reduce memory, and do not change Emacs editor
semantics.

| Facade | Service | Desired owner | Emacs source surface | Observes | Diagnostic-only unresolved item |
| --- | --- | --- | --- | --- | --- |
| `wasmacs_os_lifecycle_state()` | Lifecycle | Emacs C core plus C/wasm facade | `vendor/emacs/src/emacs.c`, `vendor/emacs/src/keyboard.c`, `vendor/emacs/src/minibuf.c`, `vendor/emacs/lisp/loadup.el` | Copied JSON with phase, initialized flag, command busy flag, minibuffer depth, command-loop level, and pending command state. | Add explicit dead/abort marker after Asyncify/runtime aborts; JS must still treat this as observed state, not lifecycle ownership. |
| `wasmacs_os_stack_bounds_probe()` | Memory and Root | C/wasm facade | `vendor/emacs/src/thread.c`, `vendor/emacs/src/lisp.h`, `vendor/emacs/src/eval.c` | Copied JSON with stack bottom/top refresh booleans, diagnostic address strings, current stack probe address, and entrypoint refresh count. | Replace implicit macro evidence with a named begin/end facade after root refresh policy is stable. |
| `wasmacs_os_gc_permission_state()` | Memory and Root / Lifecycle / Control Flow | C/wasm facade | `vendor/emacs/src/alloc.c`, `vendor/emacs/src/thread.c`, `vendor/emacs/src/eval.c` | Copied JSON with allowed flag, reason, Emacs GC inhibit depth, wasmacs guard depth, pending command state, and stack-root freshness. | Fold in Asyncify suspended-input and preloaded-state blockers before promoting any GC action path. |
| `wasmacs_os_root_safety_probe()` | Memory and Root | C/wasm facade | `vendor/emacs/src/alloc.c`, `vendor/emacs/src/eval.c`, `vendor/emacs/src/lisp.h` | Copied JSON with policy-defined marker, entrypoint refresh count, stack refresh booleans, backtrace-arg pin state, GC permission summary, and pending command state. | Define the final backtrace/specpdl root retirement policy; JS must not read or own `Lisp_Object` words. |

The JS worker debug route is `os-diagnostic-snapshot` in
`app/src/wasm-worker.js`. It calls these exports and parses the copied JSON into
`lifecycle`, `stack`, `gc`, and `rootSafety` keys. The route is a diagnostic
read path; the existing `run-buffer-command` product scaffold does not pass
through these facades.

Validation:

```sh
node scripts/probe-browser-os-diagnostic-facade.mjs
```

## Resume Memory/Root Comparison Probe

2026-06-03 added `scripts/probe-browser-os-resume-memory-root.mjs` as a
diagnostic-only comparison harness for Asyncify wait and resume boundaries. It
uses the existing copied-state facades and the existing Asyncify pending-input
path; it does not route product editing or command behavior through the
diagnostic facade.

The probe records JSONL checkpoints in
`logs/wasm-browser-os-resume-memory-root.jsonl` and a text summary in
`logs/wasm-browser-os-resume-memory-root.txt`.

Checkpoint names:

- `after-boot`
- `before-asyncify-wait`
- `pending-input`
- `before-input-injection`
- `after-input-injection-before-resume`
- `after-resume`
- `after-command-complete`
- `after-explicit-gc`
- `failure` if an exception or abort is observed before the expected terminal
  checkpoint set completes

Each checkpoint contains copied diagnostic data only:

- `lifecycle` from `wasmacs_os_lifecycle_state()`
- `stack` from `wasmacs_os_stack_bounds_probe()`
- `gc` from `wasmacs_os_gc_permission_state()`
- `rootSafety` from `wasmacs_os_root_safety_probe()`
- `pendingCommandState` from `wasmacs_os_pending_command_state()`
- JS-observed Asyncify wait state: wait active, wait count, queued input bytes,
  and terminal output byte count
- sequence number and timestamp

Observed source surfaces:

| Surface | Why it is observed |
| --- | --- |
| `vendor/emacs/src/alloc.c` | GC permission and explicit GC outcome. |
| `vendor/emacs/src/thread.c` | `current_thread->stack_top` / stack-bound refresh evidence. |
| `vendor/emacs/src/eval.c` | Lisp evaluation, `specpdl`, and host-entrypoint state reads. |
| `vendor/emacs/src/lisp.h` | `Lisp_Object` / thread/root representation boundary that JS must not own. |
| `vendor/emacs/src/keyboard.c` | Asyncify waitpoint and pending input through real Emacs input flow. |
| `vendor/emacs/src/sysdep.c` | host wait and input-read boundary for wasm/browser runtime shims. |
| `vendor/emacs/src/emacs.c` | lifecycle and exported copied-source facade state. |

Current diagnostic result: the pending-input checkpoints show lifecycle
`pending-input`, pending command state `pending-input`, GC blocked by
`blocked:pending-command`, and guard depth 1. After resume/command completion,
the copied C state returns to lifecycle `initialized`, pending command `idle`,
GC `allowed`, guard depth 0, and root-safety `allowed`. The JS-observed
Asyncify wait can already be active again after resume because Emacs has
returned to its next input wait. That state is an observation by the harness,
not JS ownership of lifecycle or GC policy.

## Blocking Input Scheduler Probe

2026-06-03 added `scripts/probe-browser-blocking-input-scheduler.mjs` as a
diagnostic-only harness for the tty route. It starts the Asyncify browser
profile, enters `emacs --quick --no-splash --nw`, waits for the first tty
input wait, queues one printable byte, resolves the current wait, and records
whether Emacs consumes the queued byte and reaches resume / next wait. This is
not a product editing or command path.

Logs:

- `logs/wasm-browser-blocking-input-scheduler.txt`
- `logs/wasm-browser-blocking-input-scheduler.jsonl`

Checkpoint names:

- `after-boot`
- `before-tty-read`
- `before-asyncify-wait`
- `pending-input`
- `before-input-queue`
- `after-input-queue-before-resolve`
- `after-wait-resolve-before-resume`
- `after-resume` if JS control returns after resolving the wait
- `after-next-wait` if Emacs reaches the next input wait
- `after-command-complete` if the probed route has a completion boundary
- `failure` if the route times out or aborts before resume / next wait

Scheduler snapshot fields:

- scheduler phase
- wait active / Asyncify wait active
- wait count
- pending resolver / resolver present
- queued byte count and preview
- last injected input bytes
- last resolved wait id
- repeated wait count
- command guard depth as observed from the copied GC permission facade
- lifecycle, GC permission, root-safety, and stack snapshots from the existing
  C/wasm diagnostic facades

Observed owner split:

| Area | Observed owner | Desired owner |
| --- | --- | --- |
| Emacs command loop and input semantics | Emacs C core (`keyboard.c`, `sysdep.c`) | Emacs C core |
| Asyncify wait suspension/resume mechanics | Emscripten runtime plus JS host import | Emscripten runtime plus explicit C/wasm/JS scheduler contract |
| Wait resolver and queued terminal bytes | JS diagnostic harness / host capability provider | JS may own byte transport and resolver only |
| Lifecycle, GC permission, root safety | C/wasm facade observing Emacs C state | Emacs C core plus C/wasm facade |

Current diagnostic result: the tty route reaches `pending-input` with
`waitActive: true`, `waitCount: 1`, and a resolver present. Queueing `a`
records one queued byte (`[97]`). After resolving wait id 1, the resolver is
cleared (`resolverPresent: false`) but the queued byte remains (`queuedBytes:
1`) and no `after-resume` / `after-next-wait` checkpoint is observed before
the parent diagnostic timeout. C/wasm lifecycle, GC permission, and root-safety
remain `initialized`, `allowed`, and `allowed` at the last copied snapshot, so
the active blocker is now the Blocking Input Scheduler / tty Asyncify resume
contract rather than Memory and Root in this diagnostic lane.

Fine-grained resume boundary result: the route records
`c-keyboard-read-char-reached`, `c-keyboard-before-wait-import`,
`js-import-wait-enter`, `js-import-resolver-called`, and
`js-import-resolve-after`. It does not record `js-import-promise-then`,
`c-sysdep-before-wait`, `c-sysdep-after-wait-return`,
`js-terminal-read-byte-dequeue`, `c-sysdep-byte-dequeued`, or
`c-keyboard-after-wait-return` after the resolver. The queued byte remains
visible at the final `failure` checkpoint. This narrows the current stop point
to the JS import resolve / Asyncify resume boundary before the tty read/dequeue
path is re-entered.

Unresolved items:

- determine why the resolved wait does not reach the import promise `.then`
  / Asyncify resume boundary and therefore never reaches the `sysdep.c`
  tty-read byte dequeue path
- add lower-level scheduler counters only as diagnostics; do not make JS own
  Emacs input semantics
- keep xterm.js and broader Terminal/Tty product work deferred until the byte
  queue / resolver / resume contract is stable

Promise / Asyncify import contract result: the diagnostic fixture
`scripts/probe-asyncify-import-contract.mjs` shows that `ASYNCIFY_IMPORTS`
recognizes `host_wait_manual_promise`, `host_wait_async_wrapper`, and
`host_wait_handle_async`, but a JS import that merely returns a Promise does
not suspend C execution. In both the manual Promise and `async function`
wrapper cases the Promise `.then` runs after resolver invocation, but C has
already advanced to the post-import phase with return value 0. The
`Asyncify.handleAsync` case is the only fixture path that suspends before the
post-import phase, rewinds after resolver invocation, and returns the resolved
integer value to C.

Real-route Promise identity result: `wasmacs_host_wait_for_input` currently
matches the async-wrapper fixture shape. The diagnostic state records
`createdPromiseId: 1`, `resolverPromiseId: 1`, `thenPromiseId: 2`,
`returnedExpressionPromiseId: 2`, and
`actualReturnedPromiseId: "unobservable-async-function-wrapper"`. In the
real Emacs route, `callMain` returns 0 rather than an Asyncify Promise, the
copied C checkpoint `c-keyboard-after-wait-return` is already visible before
the external resolver is called, and after `resolve(0)` the import promise
`.then` is still not observed before parent timeout. This keeps the stop point
inside the Promise / Asyncify import contract, before `sysdep.c` tty read and
byte dequeue can be meaningfully blamed.

Next unresolved items:

- convert the diagnostic wait import wiring to an `Asyncify.handleAsync`
  shape, still diagnostic-only, and compare whether `callMain` becomes
  Promise-returning and whether `c-sysdep-before-wait` /
  `js-terminal-read-byte-dequeue` are reached
- keep resolver ownership limited to the host scheduler/byte transport; JS
  still must not synthesize Emacs command completion or editor semantics
- preserve `ASYNCIFY_IMPORTS=wasmacs_host_wait_for_input` validation, but do
  not treat that flag alone as evidence that Promise-returning imports suspend

HandleAsync comparison result: the diagnostic host import can now be selected
with `WASMACS_WAIT_IMPORT_MODE=async-wrapper` or
`WASMACS_WAIT_IMPORT_MODE=handleAsync`, and
`scripts/probe-browser-blocking-input-scheduler.mjs` records both modes into
separate logs. The async-wrapper mode reproduces the known failure:
`c-keyboard-after-wait-return` appears before `js-import-resolver-called`,
the resolver clears, no `js-import-promise-then` is observed, no
`c-sysdep-before-wait` / terminal byte dequeue is reached, and queued byte
`[97]` remains.

In handleAsync mode, the import records `js-import-handleasync-enter`,
`js-import-handleasync-promise-created`, `js-import-resolver-bound`, and
`js-import-handleasync-returning`. This changes the C-side timing:
`c-keyboard-after-wait-return` is no longer observed before the resolver. That
supports the hypothesis that `Asyncify.handleAsync` moves the wait return
boundary in the right direction. However, after resolver invocation the route
still stops at `js-import-resolve-after`: no `js-import-promise-then`, no
`c-keyboard-after-wait-return` after resolver, no `c-sysdep-before-wait`, and
no terminal byte dequeue are observed before diagnostic timeout. `callMain`
still returns 0 rather than a Promise in both modes.

The next boundary is therefore narrower than the previous raw Promise
question: handleAsync prevents premature C progress, but the outer callMain /
Asyncify resume handoff still does not complete. The next diagnostic should
inspect Emscripten's export/callMain Asyncify wrapper state, `Asyncify.currData`
/ `asyncPromiseHandlers`, and whether `callMain` must be invoked through a
different async-aware entrypoint before expanding observation to `sysdep.c`
tty dequeue.

## Current Known Result

The real-route terminal smoke can start `emacs --quick --no-splash --nw`,
observe fd 0/1/2 as tty streams, collect initial terminal bytes, and reach the
first command-loop waitpoint. It is currently blocked by the OS compatibility
memory/runtime layer on first input resume, not by browser-side minibuffer,
undo, buffer, or window semantics.

That blocker should be handled by making Asyncify resume, stack/root state, and
terminal input state observable through copied C/wasm facade snapshots. Memory
reduction is explicitly not a success criterion for this document.

## Acceptance For This Boundary Pass

- `npm test` passes.
- Existing smoke evidence is not reclassified as product-ready without passing
  the service contract.
- The ownership boundary above names current owner, desired owner, risk, and
  next facade/probe per service.
- Any added facade/probe names the Emacs source surface it protects.
- JavaScript remains browser coordinator/protocol/UI/persistence/diagnostic
  harness only.
