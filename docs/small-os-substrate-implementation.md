# Small OS Substrate Implementation

Milestone 13.5 now treats the wasm/browser compatibility layer as a small OS
for Emacs. The first implementation slice is intentionally thin: it does not
solve pdump, purecopy, or Asyncify browser-worker boot. It makes those problems
belong to explicit services before more probes or copied-source patches are
added.

## Runtime Contract Module

`app/src/small-os-services.js` is the current substrate registry.

This registry is a browser-side mirror, not the low-level owner. It may record
the compatibility contract, validate product-vs-diagnostic treatment, and give
the browser a copied snapshot or protocol label. It must not own raw
`Lisp_Object` values, `specpdl` records, GC roots, pure space, relocation
tables, or preloaded-state object identity. When a new substrate feature touches
those areas, the first design artifact is a C/wasm facade entrypoint and state
model; JS may observe the resulting status, provide host capabilities, or run a
diagnostic harness.

It defines:

- services: lifecycle, memory/root, control-flow, blocking input scheduler,
  filesystem/persistence, preloaded-state, host capability, and browser GUI
  boundary
- lifecycle phases from `uninitialized` through `dead`
- cross-service checks from `small-os-for-emacs.md`
- operation contracts for the active Milestone 13.5 blockers
- C/wasm facade contracts for low-level substrate work
- small state gates for GC, reverse sync, lifecycle transitions, and pending
  command start

Every operation contract names:

- owning services
- violated or protected cross-service checks
- Emacs source surfaces
- product vs diagnostic treatment
- acceptance text

Every C/wasm facade contract names:

- the OS/runtime capability Emacs is asking for
- owning service or services
- Emacs source surfaces that justify the facade
- proposed C/wasm entrypoint or state names
- the permitted JS role: observer, host capability provider, browser
  coordinator, or diagnostic harness
- diagnostic/product/placeholder status
- acceptance text before the facade can be promoted

## C/Wasm Facade Plan

These facades are planned C/wasm substrate surfaces. The JS registry is only a
policy mirror until the corresponding copied-source or generated-artifact lane
implements them.

| Facade | Owner service | Emacs source surface | JS role | Status | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `lifecycle-state-facade` | Lifecycle Service | `vendor/emacs/src/emacs.c`, `vendor/emacs/lisp/loadup.el`, `vendor/emacs/src/pdumper.c` | observer | placeholder | State read reports pre-initialized, loading, initialized, command-running, pending-input, and dead without JS owning lifecycle semantics. |
| `entrypoint-root-refresh-facade` | Memory And Root Service | `vendor/emacs/src/alloc.c`, `vendor/emacs/src/thread.c`, `vendor/emacs/src/eval.c`, `vendor/emacs/src/lisp.h` | observer | diagnostic | Repeated host-entrypoint probes show refreshed `stack_bottom` / `current_thread->stack_top` and survive explicit GC at declared safe points. |
| `gc-permission-facade` | Memory And Root Service, Lifecycle Service, Control-Flow Service | `vendor/emacs/src/alloc.c`, `vendor/emacs/src/thread.c`, `vendor/emacs/src/eval.c` | observer | placeholder | Text/cancel completion unwind to idle with GC allowed, and fresh-entry explicit GC passes without JS toggling raw Emacs GC roots. |
| `pending-command-guard-facade` | Blocking Input Scheduler, Control-Flow Service | `vendor/emacs/src/keyboard.c`, `vendor/emacs/src/minibuf.c`, `vendor/emacs/src/callint.c`, `vendor/emacs/lisp/minibuffer.el` | browser coordinator | product scaffold | Worker protocol emits `starting`, `pending-input`, `completed` / `cancelled` / `failed` / `unavailable` while reentrant command/eval entrypoints return `unavailable:busy`. |
| `backtrace-root-ownership-facade` | Memory And Root Service, Control-Flow Service | `vendor/emacs/src/eval.c`, `vendor/emacs/src/lisp.h`, `vendor/emacs/src/alloc.c`, `vendor/emacs/src/thread.c` | observer | diagnostic | Backtrace args remain valid after Asyncify resume, post-completion GC passes, and the copied-source pin has an explicit freeing/retirement policy. |
| `preloaded-state-pdump-facade` | Preloaded-State Service, Lifecycle Service, Memory And Root Service | `vendor/emacs/src/pdumper.c`, `vendor/emacs/src/alloc.c`, `vendor/emacs/src/puresize.h`, `vendor/emacs/lisp/loadup.el`, `vendor/emacs/lisp/bindings.el`, `vendor/emacs/src/Makefile.in` | host capability provider | placeholder | Generated artifact loads before `initialized`, preserves pdumper-class relocation/static-root semantics, then simple eval and explicit GC pass. |
| `segment-root-relocation-facade` | Memory And Root Service, Preloaded-State Service | `vendor/emacs/src/alloc.c`, `vendor/emacs/src/pdumper.c`, `vendor/emacs/src/puresize.h`, `vendor/emacs/src/lisp.h` | diagnostic harness | placeholder | Segment/root/relocation diagnostics explain purecopy or pdump failures without JS owning raw roots, pure space, or relocation tables. |

Suggested first C/wasm entrypoint names are also mirrored in
`SmallOsFacades`: `wasmacs_os_lifecycle_phase`,
`wasmacs_os_enter_host_entrypoint`, `wasmacs_os_gc_permission`,
`wasmacs_os_begin_command`, `wasmacs_os_pin_backtrace_args`,
`wasmacs_os_preloaded_state_load`, and
`wasmacs_os_segment_table_snapshot`. These names are intentionally plain and
facade-shaped; stronger implementations can replace the internals without
teaching JS about Emacs internals.

The first generated/copied-source facade slice is deliberately smaller than the
full plan. `scripts/patch-emacs-host-entrypoint-spike.sh` now exports:

- `wasmacs_os_lifecycle_phase`
- `wasmacs_os_root_state_snapshot`
- `wasmacs_os_gc_permission`
- `wasmacs_os_pending_command_state`
- `wasmacs_os_pin_backtrace_args`

These are wrappers around the existing diagnostic entrypoint/root and command
state logic, so they do not yet replace the old exported names. They establish
the C/wasm-owned facade surface while keeping JS in the observer/coordinator
role. Persistent-profile evidence is in
`logs/wasm-browser-host-entrypoint.txt`: the facade reports
`OS_LIFECYCLE_PHASE:initialized`, `OS_PENDING_COMMAND_STATE:idle`,
`OS_GC_PERMISSION_READBACK:gc-permission:allowed`, and refreshed root snapshots.

## Current Operation Contracts

`browser-worker-asyncify-boot`

- Owner: Lifecycle Service and Preloaded-State Service
- Treatment: diagnostic
- Purpose: prevent browser stack flag tuning from replacing the actual
  post-loadup/preloaded-state requirement

`pdump-purecopy-probe`

- Owner: Preloaded-State Service and Memory And Root Service
- Treatment: diagnostic
- Purpose: keep `bindings.el` purecopy recursion and pure-space behavior tied to
  pdumper-class preloaded-state acceptance

`asyncify-backtrace-pin`

- Owner: Memory And Root Service and Control-Flow Service
- Treatment: diagnostic
- Purpose: preserve the current root-safety evidence while making the missing
  ownership/freeing policy visible

`pending-command-protocol`

- Owner: Blocking Input Scheduler, Control-Flow Service, and Browser GUI
  Boundary
- Treatment: product scaffold
- Purpose: keep one worker-owned pending command and prevent browser-side
  minibuffer semantics

`filesystem-reverse-sync`

- Owner: Filesystem And Persistence Service and Lifecycle Service
- Treatment: product scaffold
- Purpose: keep `.wasifs` reverse sync at Emacs-owned boundaries only

`unavailable-browser-boundary`

- Owner: Browser GUI Boundary and Host Capability Service
- Treatment: product behavior
- Purpose: surface unsupported process, pty, clipboard, and GUI features without
  faking editor semantics

## Integration Points

`app/src/pending-command-protocol.js` now attaches a substrate record to
messages it creates. Worker-originated messages without this optional field are
still accepted for now because `app/src/wasm-worker.js` and
`app/src/asyncify-minibuffer-worker.js` are classic workers. The next integration
step is to make worker message creation consume the same registry, either by
moving those workers to module workers or by generating a classic-worker-safe
contract table.

`tests/runtime/small-os-services.test.js` gates the registry and lifecycle
invariants. `tests/runtime/small-os-runtime.test.js` gates the browser-side
coordinator that owns command-running, pending-input, resume, completion, and
reverse-sync boundaries. `tests/runtime/pending-command-protocol.test.js` gates
the pending-command product scaffold.

## Browser Coordinator

`app/src/small-os-runtime.js` is the first executable coordinator for the
non-preloaded-state services. It is deliberately small and product-facing:

- `beginCommand` moves the browser substrate from `initialized` to
  `command-running` and closes reverse sync
- `enterPendingInput` and `resumeCommand` model the blocking input scheduler
  without giving the browser ownership of minibuffer semantics
- `finishCommand` returns to `initialized` and may open reverse sync only after
  command completion
- `failCommand` returns to `initialized` with diagnostics and keeps reverse sync
  closed
- `assertReverseSyncAllowed` prevents `.wasifs` reverse sync while a command is
  running or pending input

`app/src/main.js` now uses this coordinator for the normal persistent worker
path. Worker `sync-file` messages are buffered until the worker reports command
exit; only a successful exit opens the reverse-sync boundary and applies the
file update to the browser user image. The Asyncify minibuffer smoke also enters
the same command lifecycle before starting its separate worker, but the actual
preloaded-state blocker remains outside this slice.

## Product vs Diagnostic Rule

Diagnostic contracts may explain a blocker and justify the next probe, but they
cannot become product-ready until their acceptance is met. In code this means a
diagnostic substrate record with `productReady: true` is invalid.

For the current blocker, this keeps the browser-worker Asyncify stack failure in
the Preloaded-State Service / Memory And Root Service lane until a Node-first
preloaded artifact loads before `initialized`, survives explicit GC, and can be
used by the browser worker without replaying cold `loadup.el`.
