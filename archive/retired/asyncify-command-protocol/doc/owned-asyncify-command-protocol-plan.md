# Owned Asyncify Command Protocol Plan

Milestone 13.5 turns the current Asyncify/minibuffer spike into an owned
command protocol. The durable rule is simple: Emacs owns command, minibuffer,
file-visiting, undo, unwind, and GC semantics. The browser and worker may
transport state and input, but they must not replace those semantics.

## Script Classification

Active gates:

- `npm test`
- `npm run browser:smoke:all`
- `tools/scripts/validate-owned-asyncify-command-protocol-plan.sh`
- `tools/scripts/validate-minibuffer-asyncify-entrypoint-plan.sh`
- `node tools/scripts/probe-browser-host-entrypoint.mjs`
- `node tools/scripts/probe-browser-asyncify-minibuffer-suspend-state.mjs`
- `node tools/scripts/probe-browser-asyncify-minibuffer-input-injection.mjs`
- `node tools/scripts/probe-browser-asyncify-minibuffer-cancel.mjs`

Test tiers:

- `npm test` is the short default loop for runtime unit tests and lightweight
  plan/profile validation.
- `npm run test:asyncify` runs the active Asyncify artifact and pending-command
  probes.
- `npm run test:persistent` runs the persistent browser artifact probes.
- `npm run test:known-blockers` runs the long blocker matrices.
- `npm run test:heavy` composes the full regression suite and should be used at
  milestone boundaries, not after every local edit.

Baseline gates:

- `tools/scripts/validate-browser-persistent-spike.sh`
- `node tools/scripts/probe-browser-persistent-callmain.mjs`
- `node tools/scripts/probe-browser-host-entrypoint.mjs`
- `node tools/scripts/probe-browser-worker-real-undo.mjs`
- `node tools/scripts/probe-browser-worker-redo.mjs`
- `node tools/scripts/probe-browser-worker-file-switch-undo.mjs`

Diagnostic probes:

- `node tools/scripts/probe-browser-asyncify-interactive-start.mjs`
- `node tools/scripts/probe-browser-asyncify-minibuffer-waitpoint.mjs`
- `node tools/scripts/probe-browser-asyncify-minibuffer-suspend-state.mjs`
- `node tools/scripts/probe-browser-minibuffer-active-read-boundary.mjs`
- `node tools/scripts/probe-browser-file-buffer-gc-roots.mjs`
- `node tools/scripts/probe-browser-visited-file-cross-eval.mjs`
- `node tools/scripts/probe-browser-find-file-phases.mjs`
- `node tools/scripts/probe-browser-undo-tail-phases.mjs`

Known-blocker probes:

- `node tools/scripts/probe-browser-asyncify-gc-after-completion.mjs`
- `node tools/scripts/probe-browser-visited-file-cross-eval.mjs`
- `node tools/scripts/probe-browser-file-buffer-gc-roots.mjs`
- `node tools/scripts/probe-browser-find-file-phases.mjs`
- `node tools/scripts/probe-browser-undo-tail-phases.mjs`

Historical evidence:

- `logs/wasm-browser-asyncify-advise.txt`
- `logs/wasm-browser-asyncify-advise-summary.txt`
- `logs/wasm-browser-asyncify-minibuffer-waitpoint.txt`
- `logs/wasm-browser-asyncify-minibuffer-suspend-state.txt`
- `logs/wasm-browser-asyncify-minibuffer-input-injection.txt`
- `logs/wasm-browser-asyncify-minibuffer-cancel.txt`
- `logs/wasm-browser-file-buffer-gc-roots.txt`
- `logs/wasm-browser-visited-file-cross-eval.txt`

## Source-Backed Hazards

Stack refresh:
Every JS-to-Emacs host entrypoint that can run Lisp or allocate must refresh
the C/wasm stack root scan range. The source-backed shape comes from
`vendor/emacs/src/alloc.c` and `vendor/emacs/src/lisp.h`.

Current implementation:
`tools/scripts/patch-emacs-host-entrypoint-spike.sh` injects
`WASMACS_ENTER_HOST_ENTRYPOINT` / `WASMACS_LEAVE_HOST_ENTRYPOINT` into the
copied Emacs source. The macro refreshes both `stack_bottom` and
`current_thread->stack_top` from an entrypoint-local sentry before exported
host calls that may allocate or inspect Emacs state. The diagnostic export
`wasmacs_entrypoint_state` reports command state, pending Asyncify state,
minibuffer depth, command-loop level, specpdl depth, pending-command GC inhibit
depth, refresh count, and whether stack bottom/top were refreshed.

Pending-command GC inhibit:
GC is temporarily inhibited only while an exported Asyncify command is
suspended. After completion or cancel, explicit `(garbage-collect)` must run
from a fresh host entrypoint and the command state must be idle.

Asyncify import narrowing:
The production candidate keeps `ASYNCIFY_IMPORTS` narrow around
`wasmacs_host_wait_for_input` and the reachable command/input path.

Reentrant-call rejection:
While a command is pending, command start and `wasmacs_eval_string` must return
structured `unavailable:busy`. State reads and input/cancel injection remain
the only allowed pending-command operations.

File-visiting undo GC:
Live visited buffers must use real `find-file`, `save-buffer`, `undo-only`,
and `undo-redo`. Direct browser-side writes or direct `write-region` are not
the normal product path.

Browser event-loop ownership:
The worker owns the pending command handle and the browser renders state and
collects input. The browser must not own minibuffer, completion, undo,
kill-ring, region, or file-visiting semantics.

## Next Probes

Implemented probes that still record blockers:

- `node tools/scripts/probe-browser-asyncify-gc-after-completion.mjs`

It proves that text completion and cancel both unwind to `idle`,
`pending-asyncify-command:false`, `gc-inhibit-depth:0`, and
`emacs-gc-inhibited:0` before explicit GC. The explicit GC then crashes through
`mark_specpdl`, so the next implementation target is stale specpdl/root
ownership after Asyncify resume completion.

Latest diagnostic evidence:

- The probe now includes a `boot` baseline case. Explicit GC immediately after
  `callMain --batch` passes even though `specpdl` still contains 34 entries
  with 10 backtrace records.
- Text completion and cancel both unwind back to the same `specpdl` shape as
  the boot baseline, but explicit GC then fails in `mark_specpdl`.
- Raw backtrace argument words differ after Asyncify resume while the
  backtrace `args` pointers are unchanged. This points to stale backtrace
  argument slots on the wasm stack being overwritten by the suspended command
  path, not to an extra un-unwound Asyncify `specpdl` frame.
- A diagnostic `wasmacs_scrub_specpdl_backtrace_args` export confirms the
  narrowed failure: ordinary text/cancel completion still crash in
  `mark_specpdl`, but `text-scrub` and `cancel-scrub` pass explicit GC after
  clearing 8 non-empty backtrace `args` slots. This is not a product fix,
  because it erases debug/backtrace argument information. It is evidence that
  the durable fix needs to make backtrace argument roots valid after Asyncify
  resume, or remove/rebase stale bootstrap backtrace records before the
  suspended command can overwrite their wasm stack slots.
- `wasmacs_pin_specpdl_backtrace_args` is the first source-shaped fix spike.
  It copies non-empty baseline backtrace `args` vectors to durable `xmalloc`
  storage before the forced Asyncify command starts. With that one-time command
  boundary pin, ordinary `text` and `cancel` now pass explicit
  post-completion GC without scrub. This keeps argument words intact, but it is
  still a spike because pinned arrays intentionally leak until a real
  ownership/freeing policy is designed.

Implemented file/undo GC probe:

- `node tools/scripts/probe-browser-asyncify-file-undo-gc.mjs`

It uses a real `/home/user/projects` `find-file` buffer, saves through
`save-buffer`, runs real `undo-only` and `undo-redo`, runs explicit GC from a
fresh host entrypoint, and then proves a follow-up edit/undo pair still works.
It distinguishes "GC is inhibited while a command is suspended" from "GC is
allowed after the command has unwound", and preserves the pinned-backtrace
evidence so file/undo crashes are not conflated with the cleared
post-completion minibuffer `mark_specpdl` blocker.

Implemented two-file file-switch GC probe:

- `node tools/scripts/probe-browser-asyncify-file-switch-undo-gc.mjs`

It opens two real visited files, edits/saves A as `AX\n` and B as `BY\n`,
runs explicit GC from a fresh host entrypoint, then switches between both live
buffers and proves independent real `undo-only` / `undo-redo` state after GC.
Together with the single-file probe, this completes the Phase 6 file/undo GC
proof shape. The next implementation focus is Phase 7: represent the pending
Emacs command through a worker/browser protocol instead of exposing the forced
diagnostic minibuffer probe directly.

Implemented first Phase 7 protocol slice:

- `app/src/pending-command-protocol.js`
- `tests/runtime/pending-command-protocol.test.js`

The browser/worker boundary now has a structured `pending-command` message for
Emacs command lifecycle state. The first product-facing states are deliberately
conservative: the worker reports `starting` for `find-file` and
`switch-buffer`, then reports `unavailable` with the existing explicit
minibuffer error. The main thread validates the protocol message before
updating status/minibuffer UI. This does not expose the diagnostic Asyncify
minibuffer input path yet. It only establishes the command-boundary contract
that the real suspended-command protocol can extend to `pending-input`,
`resuming`, `completed`, `cancelled`, and `failed`.

Validation:

- `npm test`
- `npm run browser:smoke:all`

Added the repeatable browser assertion:

- `tools/scripts/run-browser-smoke.mjs`

The minibuffer smoke scenario now clears the smoke-visible pending-command
event list, sends `C-x C-f`, and asserts that the UI boundary observed
`find-file` `starting` and `unavailable` events plus the `Find file: ` prompt
before the final explicit minibuffer-unavailable state. This keeps the Phase 7
protocol observable without making the browser own minibuffer semantics.
Validation passed with `npm test` and `npm run browser:smoke:all`; the runner
log records `PASS pending-command find-file starting unavailable`.

Attempted first real browser-worker pending-input path:

- `app/src/asyncify-minibuffer-worker.js`
- `window.__wasmacsSmoke.asyncifyMinibufferReadSmoke`
- `node tools/scripts/run-browser-smoke.mjs asyncify`

The worker-side scaffold now loads the Asyncify artifact separately from the
persistent editing worker, starts the Emacs-owned
`wasmacs_command_begin_minibuffer_force_probe`, waits for the host input
waitpoint, accepts browser-provided text, and would report
`pending-input`, `resuming`, and `completed` through the same
`pending-command` protocol. This is the right protocol shape, but the real
browser worker currently fails before reaching `pending-input` with
`RangeError: Maximum call stack size exceeded`. The Node/VM probe still passes
with the enlarged Node stack:

- `node tools/scripts/probe-browser-asyncify-minibuffer-input-injection.mjs`

Evidence:

- `logs/browser-asyncify-protocol-smoke.txt` records
  `KNOWN_BLOCKER asyncify browser worker stack`.
- `logs/wasm-browser-asyncify-minibuffer-input-injection.txt` records
  `STATUS:PASS`, `WAITPOINT_REACHED:true`, and `INPUT_TEXT_ACCEPTED:true`.

Next Phase 7 step: solve or avoid the real browser-worker Asyncify stack
blocker before promoting pending-input beyond the diagnostic scaffold.

Source-backed boot diagnosis:

The browser-worker blocker should not be treated as a generic Chrome stack
flag problem. `vendor/emacs/lisp/loadup.el` describes itself as the path that
loads a bare Emacs into a dumpable one, and it raises bootstrap eval depth
because interpreted load/compile startup consumes much more stack than ordinary
runtime. `vendor/emacs/src/eval.c` shows this path goes through recursive
`eval_sub`, `Ffuncall`, and `funcall_lambda` call chains with stack-backed
backtrace roots. `vendor/emacs/src/Makefile.in`, `vendor/emacs/src/emacs.c`,
and `vendor/emacs/src/pdumper.c` show the intended normal shape: build-time
`temacs -batch -l loadup --temacs=pdump` creates a dumped state, and normal
startup can load that state before the Lisp universe is initialized. Therefore
the next Asyncify browser spike should avoid replaying cold `loadup.el` in a
fully Asyncify-instrumented worker. Wasm needs a release-pinned preloaded
Emacs Lisp-machine state, via a compatible pdump path, a post-loadup snapshot
artifact, or an equivalent generated artifact, before real browser
`pending-input` can be promoted.

Browser worker boot split:

- `node tools/scripts/run-browser-smoke.mjs asyncify-boot`

The explicit `--batch --no-loadup --eval` probe avoids the cold `loadup.el`
evaluation graph, but exits with status `-1` in the browser worker. This means
the next state should not be a bare no-loadup runtime. The needed wasm surface
is a post-loadup/preloaded Emacs Lisp-machine state that preserves the C
primitives, Lisp objects, load history, command-loop setup, and GC-visible
roots that `loadup.el` normally constructs before dumping.

Pdumper-specific conclusion:

`vendor/emacs/src/pdumper.c` makes the preloaded-state requirement more
specific. `pdumper_load` is an early boot operation: it asserts that the Lisp
universe is not yet `initialized`, loads the dump sections, applies dump and
Emacs relocations, runs dump hooks, and then marks the process initialized.
`dump_mmap_contiguous_heap` means the absence of browser/POSIX `mmap` is not
by itself enough to reject pdump, because Emacs has a heap-backed contiguous
mapping path. But `dump_do_all_emacs_relocations` proves that a substitute
snapshot cannot merely serialize Lisp objects. It must preserve relocation
records, static roots, object layout/fingerprint compatibility, and the
before-initialized boot point.

The next Asyncify boot spike should therefore be Node-first pdump or
pdump-equivalent feasibility. Try a generated build artifact that enables
`--with-pdumper` / `--with-dumping=pdumper`; if it can produce and load a
`.pdmp` under Node, only then move the proof into the browser worker. If
Emscripten configure/build blocks pdumper, record that blocker and design a
custom post-loadup snapshot only with pdumper-class relocation and static-root
semantics. Do not invent an ad hoc JSON/object snapshot as the runtime state.
In validator terms: the replacement must have pdumper-class relocation and
static-root semantics.

Current Node-first pdump probe result:

`src/build/probe-emacs-pdump-configure.sh` proves pdumper can be enabled at
configure time for the copied Emscripten source tree. `tools/scripts/probe-emacs-pdump-temacs-build.sh`
then builds a pdumper-enabled wasm `temacs`; the wasm-specific build wrinkle is
that upstream `make-fingerprint` is run on the CommonJS launcher
`temacs.tmp`, while the fingerprint bytes live in `temacs.wasm`. The probe
therefore records the upstream `missing fingerprint` failure and applies
`make-fingerprint` to `temacs.wasm` as a generated-artifact workaround. With
that workaround, Node can enter `loadup.el` with `--temacs=pdump`, but both the
normal stack-check build and a large-stack `STACK_OVERFLOW_CHECK=0` diagnostic
build exit 139 immediately after `Loading bindings (source)`. The next pdump
work is to instrument that early loadup crash in Node, not to move the artifact
to the browser yet.

The first `bindings.el` split points at purecopy rather than the load hook.
Removing the after-load GC hook still exits 139 at `Loading bindings (source)`.
Instrumenting completed top-level forms shows the crash after the defun at
line 50 and before the next top-level form completes. Replacing both early
mode-line keymap defvars, `mode-line-input-method-map` and
`mode-line-coding-system-map`, with nil gets past `bindings.el`; keeping both
keymaps and `define-key` calls while removing `purecopy` also gets past
`bindings.el`. Therefore the next wasm pdump runtime investigation is
`alloc.c` purecopy/pure-space handling for those keymap/closure structures.
The later `(require pcase) while preparing to dump` failure is separate and
belongs to the compiled-Lisp artifact path.
