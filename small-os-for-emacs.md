# Small OS For Emacs

This note reframes wasmacs as a small compatibility OS for GNU Emacs, not just
as a collection of wasm porting patches.

The goal is not to build a general OS in the browser. The goal is to provide
exactly the process, memory, filesystem, input, and lifecycle contracts that
Emacs needs in order to keep its real C core and Lisp machine alive inside
wasm.

Emacs remains the test oracle. Every service below should be justified by an
Emacs source requirement or by a probe that reaches real Emacs code. Avoid
inventing broad OS facilities that Emacs has not demanded yet.

## Why This Exists

The current ad-hoc path is starting to expose cross-service coupling:

- Asyncify pending commands decide when the browser event loop may resume Emacs.
- GC permission depends on stack boundaries, `specpdl`, backtrace args, and
  whether a command is suspended.
- `find-file` and undo depend on filesystem sync timing and live buffer roots.
- pdump/preloaded state depends on process lifecycle, object layout, pure
  space, static roots, relocation, and fingerprint compatibility.
- Browser UI state depends on command state but must not own Emacs semantics.

If each of these grows independently, later fixes can contradict each other.
This document defines the shared contract first, then lets individual probes
validate pieces of that contract.

## Top-Down Build Policy

Build the substrate from the top-level Emacs capability contract downward.
When a missing behavior appears, do not immediately add a local shim. First
decide which OS/runtime capability Emacs is asking for, then cut the interface,
then implement only the minimum quality needed to keep Emacs correct.

The order is:

1. List the OS/runtime capability Emacs requires.
   Do not limit this to POSIX syscalls. Include lifecycle, memory/root safety,
   preloaded state, blocking input, filesystem, host capabilities, and browser
   GUI boundaries.

2. Define the service interface before expanding the implementation.
   The first implementation may be dummy, diagnostic, or minimal. The important
   part is fixing what the service promises and which layer owns it.

3. Implement the lowest-quality version that preserves the contract.
   Performance, compactness, memory efficiency, and polish are deferred. The
   first quality bar is:
   - Emacs does not corrupt memory.
   - GC can run at declared safe points.
   - lifecycle and command states are observable.
   - product and diagnostic behavior remain separate.

4. Use Emacs source and probes as acceptance tests.
   A service is not real just because the interface exists. It becomes real
   when a probe reaches the corresponding Emacs source path and proves the
   contract.

5. Treat memory/root as central, but still facade-shaped.
   Segment tables, relocation tables, root tables, entrypoint refresh,
   preloaded-state loading, and explicit GC probes should first be exposed
   through simple facades. Stronger lower-level implementations can replace
   them later without changing the Emacs-facing contract.

This means the first small OS implementation is allowed to be simple and slow.
It is not allowed to be ambiguous. A temporary implementation that leaks or
uses logical read-only memory can be acceptable as a diagnostic or Level 1
runtime facade only if its lifecycle, ownership, and replacement path are
explicitly recorded.

## C-First Low-Level Substrate Policy

The low-level compatibility substrate should move toward C/wasm-first
interfaces. The current JavaScript small OS modules are useful as a browser
coordinator, policy mirror, diagnostic scaffold, and test harness. They must
not quietly become the owner of memory/root/lifecycle/preloaded-state
semantics.

Layering target:

```text
Emacs C core
  -> C small OS facade
       memory/root safety
       lifecycle state
       GC permission
       terminal / tty facade
       preloaded-state / pdump adapter (diagnostic only for now)
       control-flow and command guards
       low-level input injection helpers
  -> Emscripten / wasm runtime
  -> JS host capability provider
       browser event loop
       Promise / Asyncify wait resolution
       worker messages
       terminal byte rendering
       UI rendering
       OPFS / IndexedDB / import-export orchestration
       debug and smoke harnesses
```

Rules:

- Do not make `C -> JS -> C` the normal path for core memory/root/lifecycle
  work. JS may provide external host capabilities, but the substrate state that
  protects Emacs objects should live in C/wasm.
- JS must not own raw `Lisp_Object` values, Emacs GC roots, `specpdl` records,
  pure space, relocation tables, or preloaded-state object identity.
- JS-visible state should be copied bytes, status codes, structured snapshots,
  and protocol messages.
- C/wasm should own entrypoint root refresh, GC permission state, backtrace arg
  ownership, terminal/tty compatibility state, and low-level command guards.
  Preloaded-state loading remains a diagnostic lane, not the current product
  boot plan.
- The first C implementation may be intentionally simple: large fixed wasm
  linear memory, no memory growth, oversized stack, simple segment tables,
  logical read-only regions, slow relocation, and conservative root tables are
  acceptable if they keep Emacs correct.
- For the first Level 1 memory/root facade, prefer a deliberately overallocated
  fixed-memory profile over clever memory management. A concrete starting point
  can be around 512MB of wasm linear memory, `ALLOW_MEMORY_GROWTH=0`, and an
  oversized stack. This is not the product memory budget; it is a diagnostic
  stability profile that avoids JS typed-array view invalidation, growth-time
  relocation surprises, and premature allocator tuning while the C/wasm
  substrate proves root safety, pure space, relocation, and explicit GC
  behavior.
- Later stronger lower layers may be written in C, Rust, Zig, or another
  wasm-targeting language, but they should replace the same C-facing facade
  rather than forcing Emacs or the browser UI to learn a new contract.

Practical consequence: `app/src/small-os-services.js` and
`app/src/small-os-runtime.js` should remain browser-side coordination and
validation scaffolds. If a new feature concerns memory/root safety,
preloaded-state loading, purecopy/pure space, relocation, GC permission, or
entrypoint ownership, first design the C/wasm facade entrypoint and only then
mirror the state in JS if the browser needs to observe it.

## Core Invariants

1. Emacs owns editor semantics.
   Browser code may render state and inject input. It must not implement fake
   minibuffer, undo, kill-ring, region, file-visiting, or command history
   semantics.

2. Every JS-to-Emacs entrypoint has a root-safety policy.
   Before an entrypoint can allocate or run Lisp, it must either refresh wasm
   stack/root boundaries, run inside an Emacs-owned command stack, or be
   protected by a documented temporary GC guard.

3. GC permission is an explicit state.
   "Can GC run now?" must be answerable from lifecycle state, command state,
   stack/root state, and preloaded-state state. It must not be implicit in a
   random exported function.

4. Pending commands are single-owner operations.
   While an Emacs command is suspended through Asyncify, the worker owns one
   pending command handle. Reentrant command/eval entrypoints are rejected.
   State reads and input/cancel injection may be allowed only when they obey
   the root-safety policy.

5. Filesystem sync happens at Emacs-owned boundaries.
   `/home/user` reverse sync should run after Emacs commands complete or after
   explicit save/maintenance operations. It must not rematerialize the active
   visited file in the middle of command execution.

6. Terminal availability is a lifecycle contract.
   The current product direction is to let Emacs enter its normal `--nw`
   command loop through a minimal wasm fake tty, then attach browser I/O to
   that terminal stream. A failed `--nw` startup should be treated as a
   Terminal/Tty Service blocker before returning to pdump or custom GUI
   redisplay work.

7. Diagnostic paths do not become product paths by accident.
   Forced minibuffer probes, `specpdl` scrubs, direct eval strings, no-loadup
   boot probes, and native-assisted pdump workarounds must be labelled as
   diagnostics until they satisfy the service contract.

8. `vendor/emacs` stays read-only.
   Porting patches belong in generated/copied-source spike scripts until an
   explicit upstream patch experiment is chosen.

## Services

### 1. Lifecycle Service

Responsibilities:

- Define runtime phases:
  `uninitialized`, `cold-loadup`, `preloaded-state-generating`,
  `preloaded-state-loading`, `initialized`, `command-running`,
  `pending-input`, `shutting-down`, and `dead`.
- Decide when `initialized` may become true.
- Keep `-sEXIT_RUNTIME=0` / noExitRuntime behavior for browser sessions.
- Separate one-shot batch/probe artifacts from persistent browser sessions.
- Load or generate post-loadup Emacs state before real browser command-loop
  use.

Emacs source surfaces:

- `vendor/emacs/lisp/loadup.el`
- `vendor/emacs/src/emacs.c`
- `vendor/emacs/src/pdumper.c`
- `vendor/emacs/src/Makefile.in`

Acceptance tests:

- Cold wasm loadup probe records exact blockers instead of becoming product
  boot.
- Node-first pdump/preloaded-state probe can configure/build a generated
  artifact without touching `vendor/emacs`.
- Preloaded-state load happens before `initialized` and is followed by explicit
  GC and a simple eval/command smoke.

Open questions:

- Can upstream pdumper be made to produce/load a wasm `.pdmp` without product
  patches?
- If not, what snapshot format preserves pdumper-class relocation/static-root
  semantics without becoming an ad-hoc Lisp heap dump?
- What frees or retires temporary bootstrap roots after preloaded-state load?

### 2. Memory And Root Service

Responsibilities:

- Own wasm stack boundary refresh for every exported entrypoint.
- Track `stack_bottom`, `current_thread->stack_top`, and any Emscripten stack
  diagnostics needed to prove the active range.
- Define when GC is allowed, inhibited, or temporarily blocked.
- Keep `specpdl`, handler records, backtrace args, pure space, static roots,
  and live buffer roots valid across wasm entrypoints and Asyncify resumes.
- Replace copied-source backtrace arg pin leaks with a principled ownership
  policy.

Emacs source surfaces:

- `vendor/emacs/src/alloc.c`
- `vendor/emacs/src/thread.c`
- `vendor/emacs/src/eval.c`
- `vendor/emacs/src/lisp.h`
- `vendor/emacs/src/puresize.h`
- `vendor/emacs/src/pdumper.c`

Acceptance tests:

- Host entrypoint probe shows stack bottom and stack top refresh on repeated
  calls.
- Asyncify text completion returns to idle and survives explicit GC from a
  fresh entrypoint.
- Asyncify cancel returns to idle and survives explicit GC from a fresh
  entrypoint.
- Backtrace arg preservation keeps GC safe without erasing backtrace argument
  information.
- Purecopy/pure-space pdump probes identify whether object layout or root
  ownership is failing.

Open questions:

- Should stale bootstrap `SPECPDL_BACKTRACE` args be copied, rebased, or
  retired at a specific Emacs-owned boundary?
- When are copied backtrace arg arrays freed?
- Does wasm pdumper need a pure-space layout adjustment, or is the current
  crash caused by an unsupported root/object class during early loadup?

### 3. Control-Flow Service

Responsibilities:

- Keep `condition-case`, `throw`, `signal`, `unwind-protect`, and `C-g` inside
  valid Emacs dynamic extents.
- Prevent `longjmp` from crossing into JS callers that expect a normal return.
- Ensure every exported operation leaves `specpdl` balanced or explicitly
  pending.
- Define failure results as structured status responses, not wasm traps.

Emacs source surfaces:

- `vendor/emacs/src/eval.c`
- `vendor/emacs/src/keyboard.c`
- `vendor/emacs/src/minibuf.c`

Acceptance tests:

- Reentrant eval/command calls are rejected while pending.
- Cancel is queued through `Vunread_command_events` and consumed by the resumed
  Emacs reader.
- Lisp errors at exported boundaries return status/result text and do not trap.
- Pending-command completion/cancel unwinds GC inhibit and dynamic state.

Open questions:

- Which exported maintenance operations can safely run while a command is
  pending?
- Which state reads are non-allocating enough to allow during pending input?

### 4. Blocking Input Scheduler

Responsibilities:

- Convert native blocking input waits into browser worker async operations.
- Keep Asyncify imports narrow and named.
- Track one pending command and expose state to the browser.
- Inject real Emacs input events or unread command events before resolving the
  wait Promise.
- Select the durable waitpoint after root safety is proven.

Emacs source surfaces:

- `vendor/emacs/src/keyboard.c`
- `vendor/emacs/src/minibuf.c`
- `vendor/emacs/src/callint.c`
- `vendor/emacs/lisp/minibuffer.el`

Acceptance tests:

- Forced diagnostic minibuffer read can reach `pending-input`.
- Text injection completes and returns to idle.
- Cancel injection completes and returns to idle.
- Worker/browser protocol emits `starting`, `pending-input`, `completed`,
  `cancelled`, `failed`, and `unavailable` as needed.
- Real protocol path reproduces the Node/VM Asyncify success, not just the
  forced probe.

Open questions:

- Does final production wait at `read-char` / `kbd_buffer_get_event`, or keep a
  higher diagnostic waitpoint until more Emacs surfaces are stable?
- How much minibuffer state may be exported while pending without allocating or
  perturbing roots?

### 5. Filesystem And Persistence Service

Responsibilities:

- Present `/system`, `/home/user`, and `/tmp` with synchronous file semantics
  that Emacs `fileio.c` can use.
- Keep `system-lisp.wasifs` read-only and `user-filesystem.wasifs` writable.
- Reverse-sync browser persistence after Emacs-owned boundaries.
- Preserve file-visiting state through real `find-file`, `save-buffer`, and
  visited-file metadata updates.
- Keep OPFS/IndexedDB as backing stores, not as Emacs-visible semantics.

Emacs source surfaces:

- `vendor/emacs/src/fileio.c`
- `vendor/emacs/src/buffer.c`
- `vendor/emacs/lisp/files.el`
- `vendor/emacs/src/insdel.c`
- `vendor/emacs/lisp/simple.el`

Acceptance tests:

- `find-file` opens a real visited buffer under `/home/user/projects`.
- `save-buffer` writes through Emacs and reverse-sync preserves the file.
- Direct `write-region` poison cases remain diagnostic, not product path.
- One live file-visiting buffer survives explicit GC and retains usable undo.
- Two live file-visiting buffers retain independent undo/redo state after GC.

Open questions:

- What metadata must `.wasifs` carry for visited file modtime, locks, autosave,
  backups, and coding systems?
- Which browser persistence events trigger snapshot/export without disturbing
  live Emacs buffers?

### 6. Preloaded-State Service

Current status:

- Diagnostic and historical for the active product path.
- The project is deliberately dropping pdmp as the next normal browser runtime
  route. Pdump/pbootstrap evidence remains valuable source grounding for
  object layout, purecopy, relocation, and loadup behavior, but it should not
  drive the next MVP loop.
- Do not resume pdmp work unless the minimal Terminal/Tty Service proves
  insufficient or the user explicitly asks for a preloaded-state experiment.

Responsibilities:

- Produce or load an initialized Emacs Lisp-machine state without replaying
  cold loadup in the browser worker, if this lane is explicitly resumed.
- Preserve pdumper-class requirements: object layout, pure space, static roots,
  relocation, fingerprint compatibility, and early-before-initialized load.
- Keep generated artifacts release-pinned and separate from source checkout.

Emacs source surfaces:

- `vendor/emacs/src/pdumper.c`
- `vendor/emacs/src/alloc.c`
- `vendor/emacs/src/puresize.h`
- `vendor/emacs/lisp/loadup.el`
- `vendor/emacs/lisp/bindings.el`
- `vendor/emacs/src/Makefile.in`

Acceptance tests:

- Emscripten configure/build can enable pdumper in copied source.
- Fingerprint handling targets the wasm payload, not only the JS launcher.
- `loadup.el --temacs=pdump` gets past early purecopy/pure-space structures.
- A generated preloaded artifact loads in Node and survives explicit GC.
- If this lane is resumed, browser worker starts from preloaded state without
  cold loadup stack failure.

Open questions:

- Is upstream pdumper viable in wasm with generated-artifact fixes only?
- Is the `bindings.el` purecopy failure a pure-space allocation, closure/vector
  copy, static root, relocation, or unsupported syscall issue?
- Do `.elc` and generated Lisp artifacts need to be bundled before a full
  wasm pdump can complete?

### 7. Terminal/Tty Service

Responsibilities:

- Provide the minimum tty surface needed for `emacs --quick --no-splash --nw`
  to reach the real command loop.
- Make stdin/stdout/stderr look like a text terminal to Emacs without
  implementing a full POSIX pty, job control, process groups, or subprocess
  shell.
- Route terminal output bytes from wasm to JS, then to a terminal renderer such
  as xterm.js for the first browser-facing MVP.
- Route browser key bytes back into Emacs through the same terminal input path
  that `keyboard.c` / `term.c` expect.
- Keep the terminal stream as a compatibility layer. It is not the final
  browser GUI protocol, and it must not move Emacs editor semantics into JS.

Emacs source surfaces:

- `vendor/emacs/src/emacs.c`
- `vendor/emacs/src/dispnew.c`
- `vendor/emacs/src/term.c`
- `vendor/emacs/src/keyboard.c`
- `vendor/emacs/src/sysdep.c`

Minimum implementation surface:

- `isatty(0/1/2)` returns true for the browser terminal profile.
- `tcgetattr` / `tcsetattr` return success with a raw-ish fake terminal state.
- `ioctl(TIOCGWINSZ)` returns browser-provided rows and columns.
- `read(0, ...)` suspends through the existing Asyncify wait path until JS has
  input bytes.
- `write(1/2, ...)` posts bytes to the worker/main thread for xterm.js.
- `TERM` / `TERMCAP` are deterministic and release-pinned for the profile.

Acceptance tests:

- `emacs --quick --no-splash --nw` no longer exits before `command_loop`.
- The browser worker reaches `read_char` / `tty_read_avail_input` /
  `wasmacs_host_wait_for_input`.
- Initial redisplay bytes are observed on stdout/stderr and can be rendered by
  xterm.js or logged as ANSI output.
- Injecting a printable key byte mutates the selected Emacs buffer through the
  real command loop.
- `C-g` travels as terminal input and is handled by Emacs, not by a host-side
  fake interrupt.

Open questions:

- Is `TERM=dumb` sufficient for the first proof, or should the profile start
  with `xterm-256color` and xterm.js from the beginning?
- Which tty syscalls are required by Emacs startup, and which can remain
  harmless stubs?
- Should the terminal backend be an Emscripten device, direct libc syscall
  shims, or a narrower copied-source `wasmacs_tty_*` facade first?

### 8. Host Capability Service

Responsibilities:

- Provide environment, cwd, clocks, random, stdio, and debug logs.
- Stub or explicitly reject unsupported syscalls and process features.
- Keep process/pty unavailable for MVP unless routed to an explicit host or
  remote service.
- Avoid Node-only facilities in browser product profiles.

Emacs source surfaces:

- `vendor/emacs/src/emacs.c`
- `vendor/emacs/src/process.c`
- `vendor/emacs/src/callproc.c`
- `vendor/emacs/src/sysdep.c`
- `vendor/emacs/src/fileio.c`

Acceptance tests:

- Browser profile avoids `NODERAWFS`.
- Unsupported process paths report explicit unavailable states.
- TERM/TERMCAP/env defaults avoid startup crashes.
- Unsupported syscalls are logged and classified as harmless, required, or
  blockers.

Open questions:

- Which syscalls are harmless warnings, and which need browser-compatible
  shims?
- Which future process-like operations should become remote services?

### 9. Browser GUI Boundary

Responsibilities:

- Render frame, mode line, minibuffer, echo area, and debug state.
- Convert browser input into protocol messages.
- Never become the owner of Emacs editor semantics.
- Keep debug controls separate from the ordinary editor surface.
- For the first terminal MVP, render terminal bytes through xterm.js before
  attempting a custom text-grid renderer from Emacs redisplay internals.

Emacs source surfaces:

- `vendor/emacs/src/xdisp.c`
- `vendor/emacs/src/window.c`
- `vendor/emacs/src/keyboard.c`
- `vendor/emacs/src/minibuf.c`

Acceptance tests:

- Browser smoke observes pending-command protocol messages.
- UI reports unavailable boundaries without faking behavior.
- xterm.js smoke renders tty output bytes from Emacs.
- Future frame/minibuffer rendering consumes Emacs-owned state.

Open questions:

- What is the minimum frame protocol before moving beyond the current debug
  console shape?
- Which debug panels should be hidden by default once the compatibility OS
  substrate is stable?

## Cross-Service Checks

These checks prevent services from contradicting each other.

### Lifecycle x Memory

- Can GC run in each lifecycle phase?
- Are stack/root boundaries valid before `initialized`?
- Does preloaded-state loading retire or preserve bootstrap roots correctly?
- Does pdump load happen before any JS-visible command entrypoint?

### Memory x Input Scheduler

- Is GC inhibited only while a suspended command has unsafe roots?
- Are backtrace args valid after Asyncify resume?
- Can state reads during pending input avoid allocation or use a safe entrypoint?
- Does command completion restore GC permission before post-completion GC?

### Input Scheduler x Control Flow

- Does text completion unwind through normal Emacs frames?
- Does cancel travel through the resumed reader rather than host-side interrupt
  handling?
- Can errors report status without crossing a JS boundary by `longjmp`?

### Filesystem x Command Lifecycle

- Does reverse-sync happen only after command completion or explicit save?
- Does opening a file avoid rematerializing an already-live visited file?
- Does undo/redo avoid immediate save paths that destroy redo bookkeeping?

### Preloaded State x Filesystem

- Are `/system/lisp`, `.elc`, loaddefs, and generated artifacts available at the
  same paths the dump expects?
- Does a loaded preloaded state still see the mounted user filesystem?
- Are release fingerprints tied to the exact wasm/core/system image pair?

### Terminal x Lifecycle

- Does the browser terminal profile make stdin/stdout/stderr look like a tty
  before `init_display` / terminal startup decide to exit?
- Does Emacs reach `command_loop` and a real input waitpoint without relying on
  pdmp, daemon/server mode, or a forced minibuffer probe?
- Are terminal dimensions, TERM/TERMCAP, and raw-mode calls stable before the
  first redisplay?

### Terminal x Input Scheduler

- Does terminal input reach `read_char` / `tty_read_avail_input` through the
  same path as ordinary Emacs key input?
- Does Asyncify suspend only at the terminal read boundary and resume after JS
  provides bytes?
- Are `C-g`, ESC prefixes, and ordinary printable bytes delivered as Emacs
  input rather than browser-owned command semantics?

### Terminal x Browser GUI

- Are stdout/stderr terminal bytes copied to JS without JS interpreting
  Emacs buffer/window state?
- Does xterm.js remain a renderer for terminal bytes, not an editor model?
- Is the later custom text-grid renderer kept separate from the tty MVP?

### Host Capability x Browser GUI

- Are unsupported process/clipboard/pty paths surfaced as explicit unavailable
  boundaries?
- Does UI state come from validated protocol messages, not direct raw pointers
  or guessed Emacs state?

## Recommended Order

1. Write the contract down and gate it.
   Add a validation script that checks this document names every service,
   invariant, and cross-service check needed by Milestone 13.5. This prevents
   future work from drifting back into ad-hoc patches.

2. Finish memory/root safety for existing probes.
   Keep host entrypoint refresh, post-completion GC, backtrace arg preservation,
   and live file/undo GC probes as the first proof that the compatibility OS can
   keep Emacs objects alive.

3. Add the minimal Terminal/Tty Service.
   This is the active product route. Do not continue pdmp as the next normal
   runtime path. Make `isatty`, raw-mode calls, terminal size, stdin read, and
   stdout/stderr write good enough for Emacs `--nw` to reach `command_loop`.

4. Render the tty stream through xterm.js.
   Use xterm.js as the first browser-facing renderer so Emacs' existing
   `xdisp.c` -> `term.c` redisplay path can carry the early UI. Do not build a
   custom text-grid bridge until the terminal MVP proves real command-loop
   input and output.

5. Productize pending-command/input protocol on top of the tty path.
   Once the tty profile reaches `read_char` / `wasmacs_host_wait_for_input`,
   inject key bytes and compare the browser worker path to the Node/VM probes.

6. Connect filesystem and command lifecycle.
   Use the protocol path to run file-visiting commands, save through
   `save-buffer`, reverse-sync after completion, then verify undo and explicit
   GC.

7. Decide durable waitpoint and narrow Asyncify imports.
   Prefer the natural terminal `read-char` / `kbd_buffer_get_event` path if the
   tty MVP validates it. Keep `minibuf-setup` and forced minibuffer probes as
   diagnostics only.

8. Hide diagnostics and build the first normal UI.
   After the substrate is stable, demote debug panels and expose a simple frame,
   mode line, minibuffer, and command/status surface. The first normal UI may
   be terminal-backed; a custom GUI renderer can follow later.

## What Not To Do

- Do not implement broad POSIX compatibility just because an OS framing exists.
- Do not use browser-side substitutes for Emacs semantics.
- Do not treat a forced probe as product behavior.
- Do not keep adding exported entrypoints without assigning them a service and
  root-safety policy.
- Do not make cold `loadup.el` in a browser Asyncify worker the product boot
  path.
- Do not resume pdmp/pbootstrap as the next normal browser runtime route unless
  the Terminal/Tty Service path fails with source-backed evidence or the user
  explicitly asks for a preloaded-state experiment.
- Do not design a custom snapshot that ignores pdumper-class relocation and
  static-root requirements if the preloaded-state lane is resumed.
- Do not implement a full POSIX pty/job-control/process layer for the MVP.
  Build only the fake tty surface Emacs proves it needs.
- Do not patch `vendor/emacs` for product work without an explicit experiment.

## Working Rule For Future LLM Turns

When a probe fails, classify it before patching:

1. Which service owns this failure?
2. Which cross-service check is being violated?
3. Which Emacs source function proves the requirement?
4. Is the proposed fix product behavior or diagnostic behavior?
5. What acceptance test will prove it without relying on folklore?

If these five questions cannot be answered, stop and read more Emacs source
before changing code.
