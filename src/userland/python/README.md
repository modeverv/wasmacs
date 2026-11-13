# CPython process image

`build.sh` builds CPython 3.14.10 for the existing wasmacs Process Service.
It emits `python.js` (factory `wasmacsProgram_python`), `python.wasm`, and
`python314.zip` and `python314-os.py` under `build/artifacts/userland/`.

The release archive comes from python.org. Every build verifies SHA256
`de414a57119abef52784d8993e341d53aed635fc2b05c2607d9f98a2c5b72032`, published
on the [official release page](https://www.python.org/downloads/release/python-31410/).
Work, downloaded sources and build logs stay under `build/userland/python/`.
CPython is copyright the Python Software Foundation and its contributors.
The distributed ZIP includes the complete upstream PSF license and historical
license notices as `LICENSE.txt`.
It also includes the bundled Expat and HACL* license notices under `licenses/`.

Build with `src/userland/build.sh python`, or run this directory's `build.sh`
directly. The prerequisites are the shared Emscripten toolchain, GNU make 4,
and native Python 3.14. `WASMACS_BUILD_PYTHON` can select that interpreter;
the native interpreter is used only for cross-build generation and packaging.
`JOBS` controls compilation concurrency. `build.sh --clean` removes the work
directory. Source and configuration hashes invalidate stale build trees.

The loader must install `python314.zip` at `/usr/lib/python314.zip`, install
`python314-os.py` at `/usr/lib/python3.14/os.py`, and create
`/usr/lib/python3.14/lib-dynload` before starting Python. The separate upstream
`os.py` is the real-file landmark used by CPython's prefix search. The prefix is compiled
as `/usr`, so no global `PYTHONHOME` is needed. This is a deterministic,
uncompressed ZIP of standard-library Python sources, plus target sysconfig
data; importing it requires no zlib. It is installed once in the shared FS,
not fetched or unpacked by each child. Sources are retained for tracebacks and
`inspect`. Regression tests, GUI examples and bundled pip are omitted.

The image uses the normal CPython CLI, including `-c`, script files, stdin and
the basic REPL with `-i`. Emacs `run-python` uses pipes and passes `-i` itself;
no pseudoterminal or alternative REPL is supplied. Standard streams and file
access use the same shared FS and process descriptors as other userland.

Two portability adaptations are necessary:

* `patches/0001-cooperative-interpreter-poll.patch` inserts the synchronous
  `void wasmacs_host_python_poll(void)` import into CPython's existing
  Emscripten signal checks and enables its periodic countdown independently
  of the unused upstream signal buffer. The Process Service can yield and
  deliver a signal through libc. CPython's existing SIGINT handler then raises
  `KeyboardInterrupt`. C operations that do not check signals still cannot
  be preempted; this is a cooperative scheduler.
* `Python/emscripten_syscalls.o` is excluded from the archive. Its upstream
  browser support registers a function on the shared FS and adds Promise/JSPI
  startup, read and poll wrappers. These conflict with the Process Service's
  synchronous lifecycle and retain a terminated interpreter. The shared child
  runtime already supplies the required POSIX calls. Other upstream
  Emscripten support, including function-pointer trampolines, is retained.

`config.site` preserves upstream platform exclusions while enabling the
working `sigaction` provided by the child libc/runtime. `Setup.local` excludes
TLS, GUI and external-library extensions from this image. C modules that remain
enabled are statically linked. This does not provide pip, native extension
wheels, multiprocessing or threads. Pure Python files can be imported from the
user filesystem.

`subprocess` works on the Process Service. Upstream marks `_posixsubprocess`
n/a for every Emscripten build and `subprocess.py` refuses processes on
`sys.platform == "emscripten"`; `Setup.local` builds the module statically and
`patches/0002-subprocess-on-the-process-service.patch` lifts the refusal.
`fork_exec` then forks the interpreter (the kernel copies its memory), and the
child executes the program; `os.fork`, `os.execv`, pipes and `waitpid` were
already provided. A `subprocess.run` costs a few milliseconds plus the
program's own start.

`urllib.request` reaches http and https URLs through the browser host, the
same import Git's HTTP helper uses (`doc/process-service.md`, "Process HTTP"):
the page hands the request to the Chrome companion extension, which applies its
allowlist and limits (GET and HEAD; POST only for Git). `Modules/_wasmacs_http.c`
exposes the import as `_wasmacs_http.fetch`, `Lib/_wasmacs_urllib.py` builds
an http/https handler on it, and
`patches/0003-urllib-through-the-browser-host.patch` makes `build_opener` use
that handler on Emscripten. Headers a browser sets itself (`Host`,
`User-Agent`, `Accept-Encoding`, ...) are dropped; redirects are followed by
the browser. `build.sh` copies `Modules/*.c` and `Lib/*.py` into the source
tree. `_socket` is built so that `socket` and the modules importing it load,
but there are no sockets: `socket.socket()` fails with `EAFNOSUPPORT`, so
`http.client` connections and socket-based libraries do not work.

Acceptance checks belong to the shared Process Service and actual Emacs
probes: REPL prompts and multiline input, file I/O, standard-library imports,
exception recovery, interruption of a CPU loop followed by another prompt,
EOF/exit, and process/descriptor/FS cleanup across repeated executions.
