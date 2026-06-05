# Build Strategy

Milestone: 2

This spike chooses the first practical route for `emacs-core.wasm`.

## Decision

Start with an Emscripten-first browser route.

Rationale:

- The first user-visible target is a browser worker, not a standalone WASI
  runtime.
- Emscripten already provides browser-oriented WebAssembly invocation and a
  filesystem layer that can be adapted toward the wasmacs host filesystem.
- Emacs 30.2 has no checked-in WebAssembly port, but `config.sub` recognizes
  `wasm32`, `emscripten`, and `wasi` system names. That makes both routes worth
  testing, while Emscripten is the shortest path to a browser artifact.
- WASI SDK remains the cleaner long-term ABI direction, but it is more likely
  to expose missing POSIX/process/terminal assumptions before producing a
  browser-loadable artifact.

## Configure Options For The First Spike

Source evidence:

- `vendor/emacs/configure.ac` defines `--with-dumping=VALUE`, with `pdumper`,
  `unexec`, and `none`.
- `vendor/emacs/configure.ac` defines `--with-pdumper` and `--with-unexec`.
- `vendor/emacs/configure.ac` defines `--with-native-compilation`, which pulls
  in libgccjit checks and should be disabled for wasm.
- `vendor/emacs/configure.ac` recommends `--without-x` when X development
  libraries are absent.
- `vendor/emacs/configure.ac` has feature gates for `pgtk`, `dbus`,
  `gsettings`, `sound`, `threads`, `modules`, image libraries, XML, GnuTLS,
  SQLite, and related optional surfaces.

Initial configure shape:

```sh
emconfigure ./configure \
  --host=wasm32-unknown-emscripten \
  --build="$(./build-aux/config.guess)" \
  --without-all \
  --without-x \
  --without-ns \
  --without-pgtk \
  --without-sound \
  --without-dbus \
  --without-gconf \
  --without-gsettings \
  --without-native-compilation \
  --with-dumping=none \
  --with-pdumper=no \
  --with-unexec=no
```

The exact flag set may shrink after the first configure run; `--without-all`
is included to keep optional native dependencies out of the first error set.

## Route Comparison

| route | strengths | expected blockers | first use |
| --- | --- | --- | --- |
| Emscripten-first | Fastest path to browser/worker wasm; JS glue and filesystem hooks available; easier to test alongside future browser GUI. | Autoconf cross-compile probes, native build tools during bootstrap, POSIX assumptions, subprocess/pty/socket stubs, signal behavior. | First implementation route. |
| WASI SDK / wasi-libc | Cleaner host ABI story; aligns with eventual Component Model; easier to run in Wasmtime for non-browser tests. | Browser integration is further away; Emacs process/terminal/file assumptions still surface; may need more libc/syscall shims before proof-of-life. | Keep as documented alternative after Emscripten produces or blocks on a concrete source issue. |

## Expected Compile Blockers

- signals: `emacs.c` initializes signals early through `init_signals`; quit and
  fatal-signal paths may need wasm-specific treatment.
- subprocesses: `callproc.c` provides `call-process` and
  `call-process-region`; these should be unavailable for MVP.
- pty: `configure.ac` defines `HAVE_PTYS` for non-MinGW systems and has a large
  pty detection section; wasm should disable or stub this path.
- sockets: `configure.ac` defines `HAVE_SOCKETS`; `process.c` uses socket and
  select/pselect style code for network processes.
- termios: `configure.ac` probes `termios.h`, `cfmakeraw`, and related terminal
  controls; browser input should not depend on these.
- mmap: pdumper and unexec paths use mmap-style assumptions; the first spike
  sets `--with-dumping=none`.
- setjmp/longjmp: `bytecode.c`, keyboard, event, and error paths rely on
  setjmp/longjmp behavior; Emscripten support must be verified rather than
  assumed.
- dumping/pdump: `loadup.el`, `emacs.c`, and `pdumper.c` show this is a real
  startup path, but it is out of MVP scope.

## Build Script

The first scratch command file is:

```text
tools/scripts/build-emacs-core-spike.sh
```

It copies the pinned submodule source into `build/emacs-core-spike/src`, runs
Autogen inside that ignored copy if needed, and keeps all generated files out of
`vendor/emacs`.

Current spike notes:

- Homebrew Emscripten 5.0.7 is sufficient to reach a linked `temacs.wasm`.
- GNU Emacs 30.2 configure rejects `wasm32-unknown-emscripten`, so the current
  spike uses `wasm32-unknown-linux-gnu` as a temporary configure fallback.
- The fallback host needs native build helpers for `make-docfile` and
  `make-fingerprint`; target wasm/JS helper binaries cannot be executed by the
  build host during `make`.
- Several configure probes are too optimistic for Emscripten when disguised as
  GNU/Linux. The spike disables `malloc_trim`, Linux `sysinfo`, pthread signal
  forwarding, and external ncurses/terminfo assumptions.
- The linked artifact uses `NODERAWFS` for Node smoke tests so `temacs` can read
  the source-tree `lisp/` and `etc/` directories.
- The current blocker is no longer configure or link: Node can start `temacs`
  and begin loading `loadup.el`, but standard Lisp loadup fails with
  `invalid-function ("")` / `Wrong type argument: listp, ...`.
- Follow-up narrowing shows that full `subr.el` can load under a custom
  `loadup.el` when the standard load-path message is skipped. The current
  blocker is the `message` / `format-message` path for sufficiently large list
  output before `subr.el` continues, with source candidates in
  `vendor/emacs/src/editfns.c` and `vendor/emacs/src/print.c`.
- GC-focused narrowing shows the failure is sensitive to collection timing:
  raising `gc-cons-threshold` lets the focused format case pass, while
  collecting after the format call reproduces it. The first failing `subr.el`
  prefix boundary is 5697 passing and 5717 failing at a `mapconcat` / `lambda`
  closure form, so `eval.c` closure creation and `alloc.c` GC/vector allocation
  are now part of the M7 blocker surface.
- Copied-tree experiments ruled out a few narrower explanations:
  `print_object`'s local `stack_top` update, stack-allocated temporary Lisp
  objects, and GC only inside `Fmake_interpreted_closure`. Instrumenting
  `maybe_garbage_collect` showed automatic GC firing immediately before the
  focused failure. With a 1GB wasm heap, raising the threshold only moves the
  failure later, so the current blocker is best described as early-loadup
  automatic GC missing or corrupting live Lisp roots under Emscripten wasm.
- The current spike build profile defaults to `CFLAGS=-g3 -O0`. This is not a
  performance choice; it is a correctness probe. Under `-O2`, live Lisp roots
  appear to be optimized into wasm locals / temporaries that Emacs'
  conservative C-stack GC cannot see. Under clean `-O0`, the focused
  `format`/GC and `subr.el` prefix cases pass.
- Standard `loadup.el` also needs explicit Emscripten runtime budgets. A 64KB
  default stack fails around `files.el` / `styled_format`; a 1MB stack moves
  past that and exposes the default initial heap as too small around
  `international/characters.el`. The successful Node batch profile uses
  `-sSTACK_SIZE=1048576`, `-sSTACK_OVERFLOW_CHECK=2`,
  `-sINITIAL_MEMORY=268435456`, and `-sALLOW_MEMORY_GROWTH=1`.
- With that profile, Node can run `temacs --batch --eval` against the source
  `lisp/` tree and print both `hello wasmacs` and `6`. This satisfies the
  Milestone 7 batch evaluation spike while still leaving performance and
  browser-host integration for later milestones.

## Validation

```sh
test -f doc/build-strategy.md
test -f tools/scripts/build-emacs-core-spike.sh
tools/scripts/validate-build-strategy.sh
```

The validation does not require Emscripten to be installed. It checks that the
strategy has a selected route, the alternative route, blocker inventory, and a
syntax-valid spike script.
