# Emacs 30.2 Source Inventory

Milestone: 1

This inventory maps the GNU Emacs 30.2 source surfaces that matter for the
first wasm/browser MVP. It is intentionally source-grounded: each conclusion
points at files and functions in `vendor/emacs`.

## Source Tree Split

`vendor/emacs/README` describes the top-level split:

- `src/` holds the C code for the Emacs Lisp interpreter, primitives,
  redisplay, and basic editing functions.
- `lisp/` holds most of the Emacs Lisp code.
- `etc/`, `info/`, and `doc/` hold architecture-independent runtime data and
  documentation.

For wasmacs, the important implication is that `lisp/` cannot run on a small
standalone Elisp evaluator. The Lisp layer expects many C primitives registered
by `src/`.

## Startup And Dump Flow

Primary files:

- `vendor/emacs/src/emacs.c`
- `vendor/emacs/lisp/loadup.el`
- `vendor/emacs/src/pdumper.c`

Evidence:

- `emacs.c` initializes core Lisp structures and registers primitive families
  before normal top-level execution. The early sequence includes
  `init_alloc_once`, `init_obarray_once`, `init_eval_once`,
  `init_coding_once`, `syms_of_fileio`, `syms_of_coding`,
  `init_frame_once`, and `init_window_once`.
- `emacs.c` later registers standard Lisp-visible functions through
  `syms_of_lread`, `syms_of_eval`, `syms_of_bytecode`, `syms_of_callint`,
  `syms_of_process`, `syms_of_frame`, `syms_of_window`, and `syms_of_xdisp`.
- `emacs.c` sets `Vtop_level` to `(load "loadup.el")` unless `--no-loadup` is
  supplied.
- `loadup.el` loads generated `loaddefs`, then core Lisp such as `button`, and
  drives `dump-emacs` / `dump-emacs-portable` when a dump mode is active.
- `pdumper.c` provides `dump-emacs-portable` and `pdumper-stats`, and loads
  dump files through OS file mapping and relocation logic.

First treatment:

- Required for understanding startup.
- Do not depend on pdumper for the MVP. Treat dump support as deferred unless
  a later startup-performance milestone reopens it.
- Initial wasm batch proof should prefer scratch startup plus explicit
  `system-lisp.wasifs` loading over pdump compatibility.

## Evaluator And Loader

Primary files:

- `vendor/emacs/src/eval.c`
- `vendor/emacs/src/lread.c`
- `vendor/emacs/src/bytecode.c`
- `vendor/emacs/src/fns.c`

Evidence:

- `eval.c` defines special forms and evaluator entry points such as `if`,
  `cond`, `progn`, `setq`, `let`, `while`, `catch`, `throw`,
  `condition-case`, `eval`, `apply`, `funcall`, `autoload`, and
  `autoload-do-load`.
- `lread.c` defines `load`, `read`, `read-from-string`, `eval-buffer`,
  `eval-region`, symbol interning, obarrays, `get-load-suffixes`, and
  `locate-file-internal`.
- `bytecode.c` defines `byte-code`, which executes byte-compiled Lisp.
- `fns.c` supplies core list, string, sequence, hash, feature, `provide`, and
  `require` primitives used throughout the Lisp distribution.

First treatment:

- Required for MVP.
- Keep these as part of `emacs-core.wasm`; do not reimplement an Elisp subset.
- Loader behavior must see `/home/user` before `/system/lisp` in `load-path`.
- Bytecode support is required because the system Lisp image is `.el + .elc`.

## File And Coding Primitives

Primary files:

- `vendor/emacs/src/fileio.c`
- `vendor/emacs/src/coding.c`

Evidence:

- `fileio.c` defines path and file primitives including `expand-file-name`,
  `file-exists-p`, `file-directory-p`, `make-directory-internal`,
  `delete-file-internal`, `rename-file`, `unix-sync`,
  `insert-file-contents`, and `write-region`.
- `coding.c` defines coding-system primitives including
  `decode-coding-region`, `encode-coding-region`, `decode-coding-string`,
  and `encode-coding-string`.
- `insert-file-contents` and `write-region` are the first direct bridge from
  the Lisp/editor model into the host filesystem.

First treatment:

- Required for MVP.
- Route low-level file operations to a WASI-like host filesystem adapter.
- Keep coding conversion inside Emacs core; the host filesystem should provide
  bytes and metadata, not reinterpret text.
- Symlinks, ACLs, SELinux, and platform-specific mode details can be stubbed or
  reduced for the browser MVP.

## Input And Command Loop

Primary files:

- `vendor/emacs/src/keyboard.c`
- `vendor/emacs/src/callint.c`

Evidence:

- `keyboard.c` defines recursive edit, top-level command handling,
  `read-key-sequence`, `input-pending-p`, recent key tracking, input modes,
  mouse position helpers, and suspend/input control primitives.
- `callint.c` defines `call-interactively`, the bridge between command
  invocation and interactive specs.

First treatment:

- Required for MVP, but with a browser event adapter.
- Browser GUI should translate keyboard/composition events into Emacs event
  input; Emacs core remains owner of keymaps and command dispatch.
- Terminal and OS input-mode operations should be unavailable or reduced to
  no-op compatibility until a real host contract exists.

## Frame, Window, And Redisplay

Primary files:

- `vendor/emacs/src/frame.c`
- `vendor/emacs/src/window.c`
- `vendor/emacs/src/xdisp.c`
- `vendor/emacs/src/dispnew.c`

Evidence:

- `frame.c` defines frame primitives such as `frame-live-p` and
  `selected-frame`, plus frame sizing and visibility operations.
- `window.c` defines `selected-window`, `window-buffer`,
  `split-window-internal`, scrolling, margins/fringes, and window
  configuration primitives.
- `xdisp.c` defines redisplay helpers such as `format-mode-line`, bidi
  direction, display properties, text pixel sizing, and glyph/debug surfaces.
- `dispnew.c` defines `redisplay`, `redraw-display`, `redraw-frame`,
  `sleep-for`, `ding`, and terminal update plumbing.

First treatment:

- Required for a recognizable Emacs MVP, but host drawing must stay outside the
  core.
- Start with one frame and one window while preserving the Emacs frame/window
  model internally.
- Export a narrow redisplay protocol to the browser; do not embed DOM, Canvas,
  OPFS, or IndexedDB concerns in the C core.
- Images, scroll bars, fringe richness, and multiple window polish are deferred.

## Process Surfaces

Primary files:

- `vendor/emacs/src/process.c`
- `vendor/emacs/src/callproc.c`

Evidence:

- `callproc.c` defines synchronous subprocess primitives:
  `call-process`, `call-process-region`, and `getenv-internal`.
- `process.c` defines asynchronous and network process surfaces such as
  `make-process`, `make-network-process`, `delete-process`, and
  `accept-process-output`.
- `process.c` contains sockets and select/pselect-style waiting paths that do
  not map cleanly to the initial browser sandbox.

First treatment:

- Mostly deferred for MVP.
- Keep environment lookup because `getenv-internal` is used by core startup and
  Lisp behavior.
- Make `host.process` unavailable by default. Subprocess, pty, sockets, and
  network process behavior should fail clearly or route to later explicit
  browser/remote services.

## MVP Surface Table

| area | source files | required for MVP | wasm/browser risk | proposed first treatment |
| --- | --- | --- | --- | --- |
| startup | `src/emacs.c`, `lisp/loadup.el` | yes | high: dump/startup assumptions, load path, initialization order | Use scratch startup and explicit load path; defer pdumper. |
| dump/pdump | `src/pdumper.c`, `src/emacs.c`, `lisp/loadup.el` | no | high: mmap, relocation, dump file lifecycle | Defer. Revisit only for startup performance. |
| evaluator | `src/eval.c`, `src/fns.c` | yes | medium: stack/unwind and GC assumptions | Include in `emacs-core.wasm`; do not subset. |
| loader/reader | `src/lread.c` | yes | medium: filesystem suffix probing and generated loaddefs | Include; mount `/system/lisp` and user load-path entries. |
| bytecode | `src/bytecode.c` | yes | medium: VM correctness and byte strings | Include; required by `.elc` system image. |
| file primitives | `src/fileio.c` | yes | high: POSIX file descriptors, modes, locks, symlinks | Adapt core file operations to host FS; stub unsupported metadata. |
| coding | `src/coding.c` | yes | medium: locale and coding tables | Keep in core; host provides bytes. |
| input/commands | `src/keyboard.c`, `src/callint.c` | yes | high: terminal/input mode assumptions, timers, quit | Browser event adapter feeds core event queue; stub OS terminal controls. |
| frames/windows | `src/frame.c`, `src/window.c` | yes | high: native frame assumptions | Keep internal model; start with single frame/window. |
| redisplay | `src/xdisp.c`, `src/dispnew.c` | yes | high: terminal/window backend coupling | Expose narrow draw/invalidate protocol to browser host. |
| synchronous process | `src/callproc.c` | partial | high: subprocess and stdio pipes unavailable | Keep env lookup; make subprocess calls unavailable or explicit later. |
| async/network process | `src/process.c` | no | very high: pty, sockets, select, process sentinels | Defer; fail clearly in MVP. |

## Validation

Run:

```sh
scripts/validate-source-inventory.sh
```

This wraps the milestone search command and asserts that this inventory names
the required source files, treatment categories, and MVP table.
