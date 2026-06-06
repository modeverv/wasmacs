# Host ABI Draft

## Purpose

This draft names the first boundary between `emacs-core.wasm` and the
browser/runtime host. It is intentionally small: enough filesystem, clock,
random, environment, stdio, and GUI protocol shape to keep future wasm work
from accidentally depending on browser APIs inside the Emacs core.

The ABI is split into two surfaces:

- `wasmacs:host/*`: host capabilities that look like WASI-style services.
- `wasmacs:gui/*`: browser GUI protocol messages, kept out of filesystem calls.

`emacs-core.wasm` must not call DOM, OPFS, IndexedDB, Clipboard API, Canvas, or
File System Access API directly. Those are runtime host implementation details.

## Filesystem

The first filesystem surface is path-oriented and capability-scoped by the
runtime mount table:

```text
/system     read-only  system-lisp.wasifs
/home/user  writable   user-filesystem.wasifs
/tmp        volatile   memory filesystem
```

MVP calls:

```text
path_open(path, flags) -> file_handle
read(file_handle, length) -> bytes
write(file_handle, bytes) -> bytes_written
stat(path) -> file_stat
readdir(path) -> directory_entry[]
rename(old_path, new_path) -> unit
unlink(path) -> unit
mkdir(path) -> unit
sync(file_handle?) -> unit
close(file_handle) -> unit
```

Rules:

- `/system` writes fail with `permission-denied`.
- `/home/user` writes are journalable by the runtime host.
- `/tmp` does not survive export.
- Paths are UTF-8 absolute paths after Emacs-side expansion.
- The host returns ABI errors, not browser exceptions.

## Clock, Random, Env, Stdio

Clock:

- `wall-now-ms()` returns Unix epoch milliseconds.
- `monotonic-now-ms()` returns a monotonic timestamp for timers and profiling.
- `set-timer-ms(delay_ms)` schedules wakeups through the host event loop.

Random:

- `random-bytes(length)` returns cryptographically strong random bytes from the
  host.

Environment:

- `getenv(name)` returns a configured string or nothing.
- `environ()` returns the configured environment snapshot.
- `cwd()` returns the current working directory.
- `set-cwd(path)` updates the virtual current directory.

Stdio/logging:

- `stdout(bytes)` writes process-style stdout.
- `stderr(bytes)` writes process-style stderr.
- `debug-log(level, message)` writes structured runtime diagnostics.

## Network Fetch

`host.network` is a narrow HTTP(S) request surface for url.el/package.el style
downloads. It is not a socket API and must not expose browser fetch objects to
the Emacs core.

MVP call:

```text
fetch(request) -> response
```

Request:

```text
url
method
headers
body?
```

Response:

```text
final-url
status
status-text
headers
body
```

Rules:

- Only `http:` and `https:` are in scope for the first loader.
- Workspace or runtime capability policy may restrict origins.
- TLS is handled by the browser/runtime host, not by GnuTLS inside wasm.
- Redirects, CORS failures, permission denials, and network failures are
  returned as ABI errors.
- `url.el` may adapt this response into a normal URL response buffer for
  `package.el`, `url-retrieve`, and `url-retrieve-synchronously`.

## GUI Protocol

GUI messages are separate from host filesystem calls. The runtime host owns
browser rendering and input plumbing; Emacs core owns editor semantics.

Input messages:

```text
key
text
composition-start
composition-update
composition-end
pointer
wheel
focus
resize
```

Frame metrics:

```text
frame-id
pixel-width
pixel-height
cell-width
cell-height
device-pixel-ratio
font-family
font-size
```

Redisplay/draw messages:

```text
begin-frame
draw-text-run
clear-rect
set-cursor
set-mode-line
end-frame
```

Clipboard messages:

```text
read-clipboard
write-clipboard
```

The GUI protocol should be serializable over a worker message channel. It
should not assume direct DOM access, because the same core should also be
testable in Node, Wasmtime, or a non-browser shell.

## Process Surface

`host.process` is unavailable by default for the MVP.

Process-like features in Emacs should fail explicitly or route later through
separate services. Initial behavior:

- `call-process`, shell commands, pty, and network subprocess workflows are
  disabled or stubbed.
- The host ABI does not expose arbitrary host command execution.
- Later remote-worker or browser-service integrations must cross a deliberate
  boundary and should not be smuggled through filesystem calls.

## Emscripten Compatibility

Milestone 2 selected Emscripten-first for the browser route. Emscripten may not
consume generated `build/artifacts/host-abi.wit` directly in the first build
spike.

For that route, this WIT file is still the contract:

- JS glue may implement an adapter that maps Emscripten filesystem hooks to
  `host.fs` semantics.
- Browser event code may map worker messages to `wasmacs:gui/*` messages.
- Any temporary Emscripten-specific function names should stay behind the host
  adapter.

The long-term cleanup path can move the same contract toward WASI Preview 2 /
Component Model without changing the architecture boundary.
