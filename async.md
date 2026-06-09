# PLAN: Make Atomics terminal input wait scheduler-aware for Emacs timers

## Goal

Fix the issue where Emacs timers do not progress while wasmacs is blocked waiting for terminal input.

Observed behavior:

* `(run-at-time 0 0.1 (lambda () (message "tick %s" (float-time))))`
  updates on native macOS Emacs.
* In wasmacs Atomics/pdump/xterm mode, the tick value only changes after keyboard input.
* `M-x tetris` does not redraw new pieces until a key is pressed; then the piece appears already halfway down.

Current diagnosis:

* JavaScript `Atomics.wait(signal, 0, lastSeen, 50)` can timeout successfully.
* However, returning from the JS host wait does not make Emacs timers run.
* This means the C-side waitpoint treats the host wait as input-only and re-enters the same low-level read wait instead of returning to the higher Emacs scheduler/timer path.

The fix should not be a permanent 50ms polling loop. The final design should make the Atomics input wait aware of Emacs scheduler deadlines.

---

## Constraints

* Do not implement timer semantics in JavaScript.
* JavaScript may sleep, wake, transport bytes, and report wake reasons.
* Emacs must continue to own timer, command loop, redisplay, buffer, and TTY semantics.
* Do not patch `vendor/emacs` directly.
* Patch copied/generated source through existing patch scripts.
* Keep the Atomics profile separate from Asyncify.
* Keep diagnostic behavior separate from product behavior.

---

## Files likely involved

Generated/runtime artifact:

* `docs/artifacts/emacs-browser-atomics-pdump/temacs.js`
* `build/artifacts/emacs-browser-atomics-pdump/temacs.js`

Generation source:

* `tools/scripts/wasmacs-atomics-host-library.js`
* `tools/scripts/patch-emacs-host-entrypoint-spike.sh`
* `src/build/build-emacs-browser-atomics-pdump-profile.sh`

Patched copied Emacs source:

* `build/emacs-pdump-configure-probe/src/src/sysdep.c`
* `build/emacs-pdump-configure-probe/src/src/keyboard.c`

---

## Phase 0: Confirm active artifact path

### Task

Confirm which `temacs.js` is actually served by the local server.

The local server resolves `/artifacts/...` as:

1. `docs/artifacts/...` if it exists
2. otherwise `build/artifacts/...`

### Commands

```sh
ls -lh docs/artifacts/emacs-browser-atomics-pdump/temacs.js || true
ls -lh build/artifacts/emacs-browser-atomics-pdump/temacs.js || true

rg "wasmacs_host_wait_for_input|Atomics.wait\\(signal, 0, lastSeen" \
  docs/artifacts \
  build/artifacts \
  tools/scripts \
  build/emacs-pdump-configure-probe/src/src
```

### Acceptance

* The file shown in Chrome DevTools Network for `/artifacts/emacs-browser-atomics-pdump/temacs.js?v=...` is identified.
* A visible marker such as `console.warn("REAL TEMACS PATCH LOADED")` appears when inserted into the active served file.
* This marker is removed after diagnosis.

---

## Phase 1: Make JS host wait return explicit wake reasons

### Problem

Current JS host wait is effectively input-only:

```js
var result = Atomics.wait(signal, 0, lastSeen);
```

A diagnostic timeout works:

```js
var result = Atomics.wait(signal, 0, lastSeen, 50);
if (result === "timed-out") return 0;
```

But C does not currently treat `0` as a scheduler/timer wake reason.

### Task

Change `wasmacs_host_wait_for_input` in `tools/scripts/wasmacs-atomics-host-library.js` to return explicit reason codes.

### Proposed constants

Use integer constants in JS and mirror them in C.

```c
#define WASMACS_WAIT_TIMEOUT 0
#define WASMACS_WAIT_INPUT   1
#define WASMACS_WAIT_RESIZE  2
#define WASMACS_WAIT_ERROR  -1
```

### JS behavior

In `wasmacs_host_wait_for_input`:

```js
var result = Atomics.wait(signal, 0, lastSeen, timeoutMs);

if (result === "timed-out") {
  return 0; // WASMACS_WAIT_TIMEOUT
}

if (resizePending) {
  return 2; // WASMACS_WAIT_RESIZE
}

if (result === "ok" || Atomics.load(signal, 1) > 0) {
  break;
}
```

After input bytes are copied into `__wasmacsTerminalInputBytes`:

```js
return 1; // WASMACS_WAIT_INPUT
```

If no SAB exists or an exceptional state occurs:

```js
return -1; // WASMACS_WAIT_ERROR
```

### Temporary timeout

For Phase 1, use a diagnostic fixed timeout:

```js
var timeoutMs = 50;
```

This is diagnostic only and must later be replaced by an Emacs-derived timeout.

### Acceptance

* Console or worker messages confirm that `WASMACS_WAIT_TIMEOUT` is returned repeatedly when no input exists.
* Keyboard input still wakes immediately.
* Resize still wakes and remains functional.
* No permanent `continue` loop is introduced on timeout.

---

## Phase 2: Teach C-side waitpoints to respect timeout

### Problem

C likely contains calls like:

```c
wasmacs_host_wait_for_input ();
```

or:

```c
while (bytes_read == 0)
  {
    wasmacs_host_wait_for_input ();
  }
```

This discards the JS return value. Therefore, even when JS returns on timeout, C re-enters the same low-level read loop and never returns to the Emacs timer scheduler.

### Task

Find all C-side call sites.

```sh
rg -n -C 30 "wasmacs_host_wait_for_input" \
  build/emacs-pdump-configure-probe/src/src \
  tools/scripts
```

Expected call sites are likely in patched `sysdep.c` and/or `keyboard.c`.

### Required change

Change calls from:

```c
wasmacs_host_wait_for_input ();
```

to:

```c
int wait_reason = wasmacs_host_wait_for_input ();
```

Then handle timeout explicitly.

### Key rule

On `WASMACS_WAIT_TIMEOUT`, do not immediately re-enter the same low-level wait loop.

Instead, return to the higher caller with “no input available” so Emacs can check timers and redisplay.

### Example shape for a low-level read loop

Before:

```c
while (bytes_read == 0)
  {
    wasmacs_host_scheduler_checkpoint (100);
    wasmacs_host_wait_for_input ();
    wasmacs_host_scheduler_checkpoint (101);
  }
```

After:

```c
while (bytes_read == 0)
  {
    wasmacs_host_scheduler_checkpoint (100);
    int wait_reason = wasmacs_host_wait_for_input ();
    wasmacs_host_scheduler_checkpoint (101);

    if (wait_reason == WASMACS_WAIT_TIMEOUT)
      return 0;

    if (wait_reason == WASMACS_WAIT_RESIZE)
      return 0;

    if (wait_reason < 0)
      return -1;

    /* input case: continue to read available bytes */
  }
```

Exact return values must match the containing function’s semantics.

### Caution

Do not blindly return `0` everywhere.

For each call site, inspect the enclosing function:

* If it is a “read available input” function, `0` likely means no bytes read.
* If it is an event-fetching function, returning `0`/`nil` may mean no event.
* If it is a blocking read with POSIX-like semantics, `EAGAIN` may be more correct than EOF-like `0`.

### Acceptance

* JS logs show timeout wake reasons.
* C-side scheduler checkpoints show the timeout path is observed.
* `run-at-time` still may not be fully fixed in this phase, but the low-level infinite wait loop must no longer trap the timeout path forever.
* Keyboard input must still work.

---

## Phase 3: Add a timer smoke test

### Task

Add a repeatable diagnostic smoke for timer wake behavior.

Use this Lisp:

```elisp
(run-at-time 0 0.1
             (lambda ()
               (message "tick %s" (float-time))))
```

### Manual acceptance

* Native Emacs: tick updates continuously.
* wasmacs before fix: tick updates only after key input.
* wasmacs after Phase 1+2: tick should update without key input.

### Automated or semi-automated smoke

Add a browser smoke that:

1. Starts Atomics/pdump xterm session.
2. Evaluates the timer expression if an evaluation path exists.
3. Waits without keyboard input for at least 1 second.
4. Checks terminal output or message area updates.
5. Fails if updates only occur after input.

If direct eval is not available in this profile, document manual reproduction first.

### Acceptance

* A smoke log clearly distinguishes:

  * timer stopped without keyboard input
  * timer progressed without keyboard input

---

## Phase 4: Replace fixed polling with Emacs-derived timeout

### Problem

Fixed `50ms` timeout is polling. It is acceptable for diagnosis but not the final design.

### Target design

C should compute how long it may block before Emacs needs to wake for timer processing.

Desired conceptual API:

```c
int timeout_ms = wasmacs_compute_next_scheduler_timeout_ms ();
int reason = wasmacs_host_wait_for_scheduler_event (timeout_ms);
```

JS should only implement the wait:

```js
Atomics.wait(signal, 0, lastSeen, timeout_ms);
```

JS must not decide Emacs timer policy.

### Task

Find the existing Emacs timer deadline/wait timeout logic near input wait.

Search likely source surfaces:

```sh
rg -n "timer|timers|wait_reading_process_output|read_char|kbd_buffer_get_event|sit-for|timer_check" \
  build/emacs-pdump-configure-probe/src/src \
  vendor/emacs/src \
  vendor/emacs/lisp
```

Likely relevant areas:

* `keyboard.c`
* `sysdep.c`
* `process.c`
* timer-related C functions
* `wait_reading_process_output`
* `read_char`
* `kbd_buffer_get_event`

### Expected direction

Instead of inserting a blind wait deep in `emacs_intr_read`, integrate the wait with the layer that already knows or can derive:

* input wait
* timer deadline
* redisplay need
* resize
* process output, later

### Acceptance

* Fixed 50ms polling is removed from product path.
* Host wait receives a real timeout derived from Emacs scheduler/timer state.
* No input case wakes at the next timer deadline, not every fixed polling interval.
* `run-at-time 0 0.1` progresses without keyboard input.
* `M-x tetris` displays falling pieces without requiring keypresses.

---

## Phase 5: Separate terminal output flushing from input wait

### Problem

Current terminal output appears to be flushed at the start of `wasmacs_host_wait_for_input`.

This means output delivery is coupled to input wait entry.

### Desired design

Terminal output flushing should be callable independently.

Add or extract:

```js
function wasmacs_flush_terminal_output() {
  var outBytes = globalThis.__wasmacsTerminalOutputBytes || [];
  var sentCount = globalThis.__wasmacsSentOutputCount || 0;
  if (outBytes.length > sentCount) {
    var newBytes = Array.prototype.slice.call(outBytes, sentCount);
    globalThis.__wasmacsSentOutputCount = outBytes.length;
    self.postMessage({ type: "terminal-output-bytes", bytes: newBytes });
  }
}
```

Then `wasmacs_host_wait_for_input` calls:

```js
wasmacs_flush_terminal_output();
```

Later C/host code may call a dedicated flush entrypoint after redisplay or scheduler wake.

### Acceptance

* Terminal output still renders correctly.
* Output flushing is no longer conceptually owned by “input wait”.
* No excessive byte-by-byte `postMessage` is introduced.
* Output remains batched.

---

## Phase 6: Update issue and documentation

### Issue title

```text
Emacs timers do not wake the Atomics/browser input loop
```

### Root cause summary

```text
The Atomics terminal backend currently treats input waiting as an input-only blocking operation.
JavaScript can timeout from Atomics.wait, but the C-side waitpoint does not propagate that timeout to the higher Emacs scheduler/timer layer.
As a result, Emacs timers only run after keyboard input wakes the runtime.
```

### Documentation updates

Update or add notes to:

* `PLAN.md`
* `LOG.md`
* small OS / terminal service docs if present

Record:

* `M-x tetris` reproduction
* `run-at-time` reproduction
* JS timeout experiment result
* C-side return-value diagnosis
* final chosen scheduler-aware wait design

---

## Phase 7: Final acceptance checklist

The fix is complete when all are true:

* `Option/Alt as Meta` remains working.
* Arrow keys still work.
* `M-x` still works.
* Terminal resize still works.
* `run-at-time 0 0.1` updates without keyboard input.
* `M-x tetris` pieces appear and fall without requiring keypress wakeups.
* No fixed 50ms polling remains in the product path.
* Atomics wait uses an Emacs-derived timeout or an explicitly documented scheduler deadline.
* JS does not own Emacs timer semantics.
* C-side waitpoints do not trap timeout events in low-level read loops.
