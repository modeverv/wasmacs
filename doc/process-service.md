# Process Service

## Purpose

Emacs expects an operating system with processes. `M-x shell`, `shell-command`,
`vc`, Magit, `M-x grep` and eshell all end in the same few calls of
`vendor/emacs/src/callproc.c` and `vendor/emacs/src/process.c`: start a program,
talk to it through pipes, wait for it, signal it. A browser has none of that,
and Emscripten's libc answers `fork`, `posix_spawn` and `waitpid` with `ENOSYS`
or `ECHILD`.

The Process Service supplies the missing part. It does not use processes of the
host machine (`host.process` stays unavailable). It is a small cooperative
UNIX-like kernel that the worker boots first and that then starts an init
program on top of itself: Emacs by default. It runs other WebAssembly programs
as processes. Emacs's process code is not rewritten; it runs against this
kernel the way it runs against Linux.

```text
boot                               src/runtime/process/wasmacs-boot.js
  kernel on the system filesystem, console, program loader; then init
    |
kernel                             src/runtime/process/wasmacs-kernel.js
  process table, fd tables, pipes, pseudoterminals, signals, timers, scheduler
    |
init: Emacs (pid 1)                vendor/emacs/src/{callproc,process,sysdep,keyboard}.c
  emacs_spawn, waitpid, kill       src/c/patches/0006-process-service.patch
  pipe2, poll, ioctl, idle wait    tools/scripts/wasmacs-atomics-host-library.js
  (or another init: /bin/sh, vi, ... as pid 1 on the console terminal)
    |
process                            src/runtime/process/child/
  one WebAssembly instance per process, own linear memory, Asyncify
    |
programs                           src/userland/{busybox,git,grep,diffutils,python}
  /bin/sh and ~150 tools (BusyBox), /bin/git, /bin/grep (GNU grep)
  /bin/diff, /bin/diff3 (GNU diffutils)
  /bin/python3, /bin/python (CPython)
```

## Boot and init

The worker (`src/wasm/src/emacs-atomics-pdump-worker.js`) and the Node
harnesses bring the system up in the same order:

1. A *system module* provides the one filesystem: Emacs's Emscripten module,
   or, when Emacs is not init, the base module
   (`src/runtime/process/base/wasmacs-base.c`: an empty program linked with the
   complete Emscripten FS).
2. `WasmacsBoot.boot()` creates the kernel on that filesystem and connects it
   to the console (the keyboard `SharedArrayBuffer` and the terminal output the
   page reads) and to the program loader.
3. `/home/user` is mounted and the userland installed (`/bin`, `/etc`).
4. Init starts.

**Emacs as init** (the default). The worker calls Emacs's `main`. With its
first process system call the host library attaches Emacs to the kernel
(`kernel.attachHost`) as the *host process*, pid 1: the one process that is
not built with Asyncify, cannot be unwound, and whose system calls are the
scheduling points. Emacs brings what only it has: its heap, and the C entry
points that run its signal handlers and request a quit.

**Another init** (`?init=sh` on the page, or any command line of the userland:
`?init=vi`, `?init=python3`). Emacs is not loaded or downloaded.
`WasmacsBoot.runInit()` opens a pseudoterminal, starts the program on its slave
side as pid 1 (its controlling terminal) and then is the terminal: console
input goes to the master side, output comes back to the page, a page resize
becomes a window size change (`SIGWINCH`). This loop is the kernel's *console
task*: the host process in this configuration, pid 0, the parent of init. It
runs the scheduler until init exits; then the system halts ("init ... exited:
system halted") and the page has to be loaded again. `/home/user` is the same
persistent image as under Emacs and is saved whenever the system goes idle.

What is not there with another init: Emacs cannot be started from that shell
(it is not a userland program), and the limits below (no job control) weigh
more in a plain terminal than under Emacs.

## What Emacs gets

- `call-process`, `call-process-region`, `process-file`, `shell-command`,
  `shell-command-to-string`: exit status, signal name, output until EOF,
  stderr to a file, `default-directory` as the working directory.
- `make-process`, `start-process`: filters, sentinels, `process-send-string`,
  `process-send-eof`, `kill-process`, `interrupt-process`, `signal-process`.
  With `process-connection-type` t the child gets a pseudoterminal as its
  controlling terminal (see "Pseudoterminals" below).
- An idle Emacs runs filters and sentinels as output arrives, without
  `accept-process-output`, and sleeps otherwise.
- `C-g` interrupts a synchronous subprocess (`call-process` returns with a
  quit, the child is killed).
- `M-x shell` and eshell; `vc-git`; Magit, including the commit message edited
  in an Emacs buffer; `M-x grep`, `rgrep`, `lgrep`, `xref-matches-in-files`.
- `M-x run-python` with the bundled CPython and standard library; Python
  scripts use the same filesystem as Emacs.
- `M-x term` and `ansi-term`: an interactive shell with line editing, `vi`,
  `less`, `stty`, `^C`, window resizing.

## What it does not provide

| Missing | Consequence |
|---|---|
| Job control | `ash` is built without it: `&`, `wait`, `kill` work, `fg`/`bg`/`C-z` do not. Processes are never stopped (`SIGTSTP`, `SIGTTIN`, `SIGTTOU` are ignored). |
| Sockets | `socket()` fails with `EAFNOSUPPORT`. Git Smart HTTP(S) and Python's `urllib.request` use the explicit host HTTP service; SSH and `git://` are unavailable. |
| Threads in processes | Programs are single-threaded. |
| Preemption | Scheduling is cooperative. A program that computes without a system call or polling point keeps running. CPython's interpreter has explicit polling points. |
| Other programs | Only what `src/userland` builds exists. `/bin/<name>` for anything else is "not found". |
| Users | Everything runs as uid 0 (`root`, home `/home/user`). |

Ediff uses GNU diffutils `diff` (normal format) and `diff3` (three-way
comparison / common-ancestor merge). BusyBox's unified-only `diff` applet is
disabled so the standalone shell cannot shadow GNU `diff`. `M-x diff` and
`vc-diff` also use the GNU implementation. Ediff's existing parser and UI run
unchanged; no browser-specific output conversion is involved.

## The seam in Emacs

Patch `src/c/patches/0006-process-service.patch` touches five places. Nothing
else in Emacs knows that anything is unusual.

| Emacs | Change |
|---|---|
| `callproc.c` `emacs_spawn` | The one function that starts every subprocess. Under `__EMSCRIPTEN__` it calls `wasmacs_host_proc_spawn (argv, envp, cwd, stdin, stdout, stderr, pty_name)` and returns the pid. `std_err < 0` means "same as stdout". For a pty process it first runs `child_setup_tty` on the slave side. |
| `sysdep.c` `get_child_status` | `waitpid` becomes `wasmacs_host_proc_waitpid`. |
| `callproc.c`, `process.c` | `kill` becomes `wasmacs_os_kill`, which signals Emacs itself with `raise` and everything else through `wasmacs_host_proc_kill`. |
| `callproc.c` | Two exported entry points for the kernel: `wasmacs_os_raise_signal` (runs Emacs's own `SIGCHLD` handler) and `wasmacs_os_request_quit` (sets `Vquit_flag`). |
| `keyboard.c` | The idle wait returns `WASMACS_WAIT_PROCESS` when processes did something; `wasmacs_os_service_subprocesses` then calls `wait_reading_process_output` once, which runs filters and sentinels. |

`pipe2`, `poll` and `ioctl` need no patch: the host library overrides the
libc system calls (`pselect` ends in `__syscall_poll`).

Patch `0007-keyboard-honor-read-timeout.patch` is a fix this work depended on:
`sit-for` and `read-event` with a timeout used to wait a full second.

## The kernel

`wasmacs-kernel.js` is plain JavaScript without Emscripten macros. The `env`
object passed to `WasmacsKernel.create` (by `WasmacsBoot.boot`) supplies the
filesystem, the console and the program loader; Emacs adds its own pieces with
`attachHost` (see `$wasmacs_process` in the host library). The tests run the
same file with a 30-line stand-in for Emacs.

**Processes.** The host process is Emacs (pid 1; other pids start at 100) or
the console task (pid 0; init is pid 1). A process has a parent,
a process group and session, an fd table, a working directory, an environment,
a program image and an instance of it. At most 64 processes exist at a time.

**One filesystem.** There is exactly one filesystem: the Emscripten `FS`
object of the system module (Emacs's, or the base module's). Every process uses that same JS object. What is per process, the fd
table (`FS.streams`) and the working directory (`FS.currentPath`), is swapped
at each context switch. A file written by `git` is the file Emacs reads.

**Blocking system calls.** A process is built with Asyncify. When a system call
has to wait, the kernel returns a `BlockRequest`; the process unwinds to the
scheduler and is rewound later, into the same system call, which is then simply
issued again. So a system call must not have side effects before it blocks.
Emacs is not built with Asyncify and cannot be unwound. When Emacs has to wait
(`_emacsBlock`) it runs the scheduler in a loop instead, and sleeps in
`Atomics.wait` when nothing can run.

**Scheduling.** A process runs until it blocks, exits, execs or its 10 ms time
slice is over at one of the preemption points (`read`, `write`, `open`, `stat`,
`getdents`, `poll`). Emacs's system calls are the scheduling points on its
side: the idle keyboard wait, `poll`, a blocking pipe read or write, `waitpid`
and `kill` each let processes run for up to 20 ms.

**fork, vfork, exec, posix_spawn.** `fork` unwinds the parent, creates a second
instance of the same module, copies the parent's linear memory and Asyncify
state into it, and rewinds both; the child's `fork` returns 0. `exec` replaces
the image and keeps pid and descriptors (close-on-exec descriptors are closed).
`posix_spawn` and Emacs's `emacs_spawn` start a new instance directly, without
copying memory. `vfork` suspends the parent until the child execs or exits.

**Pipes.** A bounded ring buffer of 64 KiB with reader and writer counts: EOF
when the last writer closes, `SIGPIPE` then `EPIPE` when the last reader is
gone, writes of up to `PIPE_BUF` bytes are atomic, `O_NONBLOCK` and `poll` are
honoured.

**Signals.** Dispositions are read from the process (`sigaction`). A handler
runs on top of the interrupted system call, which then fails with `EINTR`;
default actions terminate the process; `kill` with a negative pid signals a
process group. A child's exit reaches Emacs as `SIGCHLD`. Emacs starts every
child in its own session, so `interrupt-process` reaches the whole pipeline of
a shell.

**Keyboard quit.** While Emacs waits for a subprocess, the kernel still looks
at the keyboard. A `C-g` is taken out of the input queue, `Vquit_flag` is set
and the wait ends with `EINTR`, which is what a tty driver's interrupt
character does.

**Output before exit.** A child that writes and exits within one scheduling
round has its exit reported (`SIGCHLD`) at Emacs's next poll, after the
output has been readable. Emacs stops reading a process once it knows that
the process is gone, so `accept-process-output` with a timeout could
otherwise return without its last output.

## Pseudoterminals

`M-x term` and `ansi-term` bind `process-connection-type` to t. Emacs's
`allocate_pty` (UNIX98, unchanged) opens `/dev/ptmx`, unlocks it and asks for
its name; `create_process` keeps the master side. The kernel provides the
devices in the shared filesystem:

| Device | |
|---|---|
| `/dev/ptmx` | Opening it creates a pseudoterminal and returns its master side; `/dev/pts/N` appears. |
| `/dev/pts/N` | The slave side. Locked until `unlockpt`. Removed when neither side is open. |
| `/dev/tty` | The caller's controlling terminal; `ENXIO` for a process without one. For Emacs it stays Emacs's own terminal (the console). |

`emacs_spawn` sets the terminal modes with Emacs's own `child_setup_tty`
(the modes belong to the terminal, so doing it in Emacs is the same as in the
child) and passes the slave's name to the kernel, which opens it as the
child's descriptors and makes it the controlling terminal of the child's new
session; the child's process group is the foreground group.

Between the two sides sits a line discipline after Linux's n_tty:

- input: `ICRNL`/`INLCR`/`IGNCR`, `ISTRIP`, `IXON` stop/start
- canonical mode: lines, `VERASE`, `VKILL`, `VWERASE`, `VLNEXT`, `VREPRINT`,
  `VEOF`, `VEOL`/`VEOL2`; non-canonical mode with `VMIN`/`VTIME`
- echo with `ECHOE`, `ECHOK`, `ECHOKE`, `ECHOCTL`, `ECHONL`
- `VINTR`, `VQUIT`, `VSUSP` signal the foreground process group (flushing the
  queues unless `NOFLSH`)
- output: `OPOST` with `ONLCR`, `OCRNL`, `ONOCR`, `ONLRET`, tab expansion

`ioctl` on either side goes to the kernel (the child library and the Emacs
host library route it there; Emscripten's own handler only knows the console):
`TCGETS`/`TCSETS*` keep the whole `struct termios` as written, which Emacs and
`stty` compare after setting it; `TIOCGWINSZ`/`TIOCSWINSZ` (a change sends
`SIGWINCH` to the foreground group: `set-process-window-size` and `stty rows`);
`TIOCGPGRP`/`TIOCSPGRP`/`TIOCGSID`/`TIOCSCTTY`/`TIOCNOTTY`;
`TIOCGPTN`/`TIOCSPTLCK`; `FIONREAD`, `FIONBIO`, `TCFLSH`, `TCXONC`.
`isatty()` asks `fd_fdstat_get`, which the child library answers with a
character device for a pseudoterminal.

As on Linux, the master reads `EIO` once no slave descriptor is open (Emacs
then lets the exit status speak); closing the master hangs up the session:
slave reads return end-of-file, writes fail, the session leader and the
foreground group get `SIGHUP`. A session leader that exits takes its
controlling terminal with it.

The pseudoterminal's master side is never `stream.tty`: that property marks
Emacs's own terminal, whose bytes Emacs reads as keyboard input.

Not provided: job control (above), `ECHOPRT`, break and parity handling.
In `term`'s char mode ESC is a meta prefix, so ESC and the next key reach the
program as one sequence; BusyBox `vi` drops that as an unknown escape
sequence, as it would on Linux.

## Programs

A program image is a pair `<name>.js` + `<name>.wasm`, built with the flags in
`src/runtime/process/child/wasmacs-child-flags.sh` and linked with
`wasmacs-child-library.js`, `wasmacs-child-pre.js` and `wasmacs-child-rt.c`.
Images are not stored in the filesystem. What the filesystem holds is a marker
file per command,

```text
/bin/git:   <DEL>wasmacs-exec git
```

and the kernel asks the host for the named image when such a file is executed
(`globalThis.__wasmacsLoadProgram`: a synchronous XHR plus `importScripts` in
the worker). The first use of `git` therefore costs one download of about 6 MB;
after that a new process takes about a millisecond. Scripts with a `#!` line
and scripts without one work as usual (the latter through the shell's `ENOEXEC`
fallback).

| Image | Source | Notes |
|---|---|---|
| `busybox` | BusyBox 1.38.0, `src/userland/busybox` | `ash` as `/bin/sh`, about 150 applets, standalone shell (applets run without `exec`). Two small patches, a recorded `.config`. |
| `git` | git 2.52.1, `src/userland/git` | Unpatched. No libcurl, OpenSSL, Perl, Python, Tcl, iconv or threads. `/etc/gitconfig` sets a default identity, `core.pager=cat` and `color.ui=false`. |
| `git-http` | same pinned Git source | Original `remote-curl.c` with a browser HTTP adapter. Provides `git-remote-http` and `git-remote-https` for Smart HTTP clone/fetch/push. |
| `grep` | GNU grep 3.12, `src/userland/grep` | Unpatched. Emacs uses `--null`, `--color`, `--exclude` and `--directories=skip`, which the BusyBox applet lacks. `egrep` and `fgrep` are two-line shell scripts. |
| `diff`, `diff3` | GNU diffutils 3.12, `src/userland/diffutils` | Separate process images. Normal/context/unified diff and three-way comparison for Emacs's existing Ediff implementation. |
| `python` | CPython 3.14.10, `src/userland/python` | `python3` and `python` aliases; basic pipe REPL, static modules and standard-library ZIP. Startup/I/O glue and evaluator polling adapted to the child runtime. Built without OpenSSL: `hashlib` has the SHA functions and `hmac` and `os.urandom` work, but `hashlib.pbkdf2_hmac`, `hashlib.scrypt` and `ssl` are missing. |

`src/userland/build.sh` builds the programs and Git HTTP helper and writes
`build/artifacts/userland/manifest.json`; `src/build/build-site.mjs` publishes
the directory with the Pages bundle. Release tarballs are cached under
`build/userland/`, and each build script pins the sha256.

An image may also declare `files` (`source`, absolute FS `path`, byte count)
and `directories` in its manifest entry. The host installs these synchronously
before caching the image. Python uses this for `/usr/lib/python314.zip`; no
standard-library bytes are downloaded until Python is first executed. Data
files contain bytes only and do not keep child instances alive. The browser
loader and Node harness use the same `installProgramFiles` implementation.

CPython's evaluator calls `wasmacs_host_python_poll` periodically. This runs
through `WK.sys`, yields at the normal time-slice boundary and delivers pending
signals using the existing child signal dispositions. SIGINT becomes Python's
own `KeyboardInterrupt`, so the REPL remains usable. CPython's upstream
Promise-based Emscripten startup and async I/O are excluded. Long C operations
that do not check signals may still defer interruption. Python's `subprocess`
(`run`, `Popen`, `os.system`, `os.popen`) starts processes through the same
kernel: `_posixsubprocess` forks the interpreter and execs the program
(`src/userland/python/README.md`). `urllib.request` opens http and https URLs
through the host HTTP service (Process HTTP below). Python sockets, threads,
multiprocessing, pip and native wheel loading are outside this build.

`WasmacsUserland.EMACS_SETTINGS` (`src/runtime/process/wasmacs-userland.js`)
holds the three Emacs settings that follow from the above; the worker evaluates
them at startup: `process-connection-type` nil (`M-x shell`, `compile`,
`run-python` and Magit keep pipes; `term` binds it to t itself),
`grep-highlight-matches` `always` (`--color=auto` never colours a pipe), and
`with-editor-emacsclient-executable` nil (there is no emacsclient; with-editor
then uses its shell-script editor, which Emacs wakes with a signal).

### Adding a program

1. Build it with `emcc`, link at `-O2` with `${wasmacs_child_ldflags}` and
   `-sEXPORT_NAME=wasmacsProgram_<name>`, and add `wasmacs-child-rt.c`.
2. Add it to `src/userland/build.sh` (build step and manifest entry).
3. If BusyBox has an applet of the same name, remove the applet: the standalone
   shell runs applets by name before it looks at `PATH`.
4. Add a kernel test and a check in the Emacs probe.

## Rules

These are the mistakes that pass a quick test and fail in a browser tab.

1. **Nothing asynchronous, anywhere.** Emacs never returns to the worker's
   event loop. A promise reaction, a timer callback, a message handler or a
   `FinalizationRegistry` callback never runs, and whatever it references is
   never freed. `WeakRef` keeps its target alive until the end of the current
   job, which never ends. One `promise.catch()` on the factory promise of each
   process kept every dead process alive.
2. **A process leaves nothing behind.** The filesystem is shared, so anything a
   program registers in it at startup outlives the process and keeps its
   instance and its memory alive. Emscripten's `SOCKFS` and `PIPEFS` mount
   themselves that way; git pulled in `SOCKFS`, and a tab ran out of memory
   after about a hundred git commands. Sockets are therefore stubbed out, and
   the kernel refuses `FS.mount` while a program starts.
3. **A blocking system call has no side effects before it blocks.** It will be
   issued again from the top.
4. **Every process's stdout is line buffered.** Emscripten's libc does not
   switch to full buffering for pipes and files, so programs issue many tiny
   writes. Kernel data structures must not care (the pipe was once a queue of
   chunks and went quadratic).
5. **An executable marker is not a `#!` script.** eshell reads `#!` lines
   itself and would run the "interpreter".
6. **The environment is fixed before the runtime starts.** libc copies it in a
   static constructor; set `ENV` in `Module.preRun`.

## Process HTTP

`wasmacs_host_http_fetch` is a restartable import in the child library. It
copies a request to the page once, then suspends in `Kernel.sys_http_fetch`.
`wasmacs-http.js` only polls a per-request SharedArrayBuffer; the page and
extension own the actual asynchronous fetch. No promise or callback is retained
inside the Emacs worker. `C-g`, signals and other runnable processes remain
serviceable while HTTP waits. The kernel permits at most four in-flight HTTP
requests and releases/cancels them on signal interruption or process death.

The HTTP ABI returns status, response headers, bytes and final URL allocated in
the calling process's heap. HTTP errors such as 401 are responses, while a
transport failure is a separate return code. The helper frees all buffers.
Limits and authentication are documented in `src/userland/git/README.md`.

Two programs use it: Git's `remote-curl.c` adapter and CPython's
`_wasmacs_http` module, on which `urllib.request`'s http/https handler is
built. A signal that interrupts the wait cancels the request; in Python, C-c
then raises `KeyboardInterrupt`.

## Memory

Every process has its own linear memory (16 MB to start with), allocated when
the instance is created and released by the garbage collector once nothing
references the instance. That makes rule 1 and rule 2 matters of correctness,
not of tidiness. Two tests watch them: the kernel suite counts the nodes of the
shared filesystem and the JavaScript heap across 600 process images, and the
Emacs probe measures the heap across 900 process images from inside Emacs's
idle wait, the state in which nothing asynchronous can run. The browser
scenario runs 300 git processes in a row in a real tab.

## Persistence

`/home/user` is saved as one tar image when Emacs goes idle, and the page
stores it in IndexedDB. For repositories to be usable across reloads the image
keeps file modes (executable bits of scripts and hooks) and modification times
(git compares them with its index), stores paths of up to 255 bytes, and is
written again only when the tree changed. It is still one image for the whole
tree: a very large repository makes every save slow.

## Tests

| Command | What runs |
|---|---|
| `npm test` | CI. Includes `tests/runtime/process-service-bundle.test.js`: the checked-in `docs/` bundle boots under Node and Emacs runs `sh`, `git`, `grep`. |
| `npm run test:process:kernel` | `tests/process/run-kernel-tests.mjs`: the kernel alone, with a stand-in for Emacs. Needs `emcc` for the test programs. |
| `npm run test:process:emacs` | `tools/scripts/probe-process-service.mjs`: the real Emacs build under Node, batch and interactive (keystrokes into the real command loop). The Magit checks use the packages installed on the machine (`~/.emacs.d/elpa`) and are skipped without them. |
| `npm run test:ediff` | Real Emacs: diff output/exit status, two-/three-way Ediff, copy and ancestor merge, repeated process cleanup. |
| `npm run browser:smoke:ediff` | Real Chrome: rendered Ediff control panel, difference navigation, copying and merge resolution. |
| `npm run test:python` | Real Emacs: Python expressions, multiline input, imports/files, exceptions, interruption/recovery and process cleanup. |
| `npm run browser:smoke:python` | Real Chrome: `run-python` interaction, CPU-loop interruption and continued REPL use. |
| `npm run browser:smoke:processes` | `tools/scripts/run-browser-smoke.mjs shell persist`: the page in headless Chrome. |
| `npm run browser:smoke:term` | Real Chrome: `M-x term` on a pseudoterminal, `vi`, `less`, `^C`, a page resize reaching the shell as `SIGWINCH`. |
| `npm run browser:smoke:init` | Real Chrome: `?init=sh` (sh as pid 1 without Emacs: `vi` with a real ESC, git, `^C`, resize, a file surviving a reload, `exit` halting the system) and `?init=vi`. |

The kernel tests also boot systems without Emacs (`init:` tests), and
`npm test` does so with the published bundle.

The kernel is not linked into Emacs: the worker loads
`artifacts/userland/wasmacs-kernel.js` and `wasmacs-boot.js` (published by
`src/userland/build.sh` and `src/build/build-site.mjs`), so a kernel change
needs `npm run build`, not an Emacs build. Development aids:
`WASMACS_KERNEL_JS=<file>` makes the Node harness use that kernel, and on a
local development host the page parameter
`?process-kernel=/src/runtime/process/wasmacs-kernel.js` does the same in the
browser.

## Possible next steps

- Starting Emacs from a shell that is init, and returning to the shell when
  Emacs exits. Emacs can only be the host process, one at a time.
- Job control: stopped processes (`SIGTSTP`, `SIGTTIN`, `SIGTTOU`, `SIGCONT`,
  `WUNTRACED`), background reads, and BusyBox `ash` built with job control.
  The pseudoterminal already keeps a foreground process group.
- Saving `/home/user` incrementally instead of as one image.
