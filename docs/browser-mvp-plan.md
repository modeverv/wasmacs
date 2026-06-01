# Browser Single-Buffer MVP Plan

Milestone 9 starts from the real Emacs wasm artifact proven in Milestone 7.
The browser UI must be a host surface around that artifact, not a separate
Emacs-like editor.

## Current Artifact Boundary

`artifacts/emacs-core-spike.js` is a Node smoke artifact. It links with
`NODERAWFS` so Node can expose the copied Emacs source tree directly during
batch loadup. That is correct for Milestone 7, but it is intentionally not the
browser packaging shape.

Evidence:

- `artifacts/emacs-core-spike.js` contains `NODERAWFS`.
- The generated glue says `NODERAWFS is currently only supported on Node.js
  environment.`
- `logs/wasm-batch-eval.txt` proves the Node artifact can run standard
  `loadup.el` and evaluate Elisp.

## Browser Artifact Shape

The browser MVP needs a second packaging profile rather than a fake editor
runtime:

1. Re-link or package without `NODERAWFS`.
2. Provide `lisp/` and `etc/` through an Emscripten filesystem adapter,
   preload package, or a host filesystem bridge backed by `system-lisp.wasifs`.
3. Set Emacs runtime paths inside the worker:
   - `EMACSDATA=/etc` or its packaged equivalent.
   - `EMACSLOADPATH=/lisp` or its mounted equivalent.
4. Start the worker with a minimal proof command before wiring editing:
   - `--batch --eval '(princ "hello wasmacs")'`
5. Only after the worker can host the Emacs core, add the single-buffer GUI
   protocol:
   - browser keyboard input -> worker
   - worker/core state -> renderer
   - file persistence through `/home/user`

## Current Browser Profile Spike

`scripts/build-emacs-browser-profile-spike.sh` builds the first browser-shaped
artifact directory:

```text
artifacts/emacs-browser-spike/
  package.json
  temacs
  temacs.wasm
  temacs.data
```

This profile does not use `NODERAWFS`. Instead, it preloads the copied GNU
Emacs tree into the paths that this configure currently expects:

```text
/usr/local/share/emacs/30.2/lisp
/usr/local/share/emacs/30.2/etc
```

That is not the final filesystem architecture. It is a packaging proof that
keeps the real Emacs core intact while moving away from Node-only filesystem
access. A later adapter should replace the preload package with
`system-lisp.wasifs` and the host filesystem boundary.

Validation:

```sh
scripts/build-emacs-browser-profile-spike.sh
scripts/validate-browser-profile-spike.sh
```

The validation runs the packaged artifact and checks that
`--batch --eval '(princ "hello browser-profile")'` succeeds.

## First MVP UI Contract

The first browser screen should stay small:

- one frame
- one buffer backed by `/home/user/notes.txt`
- basic text input
- explicit save through the runtime host filesystem
- reload persistence by exporting/importing the user image

The implementation may use a temporary line-oriented buffer adapter while the
full Emacs redisplay protocol is still absent, but it must be documented as a
host adapter. It must not become a replacement Lisp/editor core.

Current implementation:

- `app/src/browser-wasifs.js` parses and writes the tar-compatible user image
  format in the browser.
- `app/src/main.js` keeps a serialized `.wasifs` payload in `localStorage`
  under `wasmacs:user-filesystem.wasifs:v1`.
- `/home/user/notes.txt` is the single writable file exposed by the first UI.
- The editor marks the buffer `modified` on input and `saved` after explicit
  save.
- Reload persistence is currently browser `localStorage`, but the stored value
  is now the base64 form of a tar-compatible `user-filesystem.wasifs` payload.
- Export downloads `user-filesystem.wasifs`; Import accepts a `.wasifs` file
  and reloads `/home/user/notes.txt` from it.

## Worker Proof

`app/` currently verifies that the browser can host the real Emacs wasm
artifact before the editor UI is widened:

```text
app/index.html
app/src/main.js
app/src/wasm-worker.js
app/src/styles.css
scripts/serve-app.mjs
```

The worker currently sets Emscripten `Module.arguments` to an Emacs file bridge
proof:

```text
--batch --eval '(progn
  (make-directory "/home/user" t)
  (with-temp-file "/home/user/notes.txt"
    (insert "hello emacs file bridge"))
  (with-temp-buffer
    (insert-file-contents "/home/user/notes.txt")
    (princ (buffer-string))))'
```

It imports `/artifacts/emacs-browser-spike/temacs` and routes
`temacs.wasm`/`temacs.data` through `Module.locateFile`. The earlier worker
proof passed with `hello browser-worker`; the current proof also exercises
Emacs file primitives for `/home/user/notes.txt` and passes with
`hello emacs file bridge`.

The core worker proof runs alongside the temporary buffer adapter. It proves
that the page is hosting the real Emacs wasm artifact, but it does not yet own
the visible text buffer or redisplay state.

## User Image To Worker Mount

The main app now sends `BrowserUserImage.entries()` to the worker. The worker
uses `Module.preRun` to materialize those entries into the Emscripten
filesystem before Emacs starts:

```text
/home/user/notes.txt
```

Emacs then reads that file with `insert-file-contents`. This is the first
forward synchronization step from the browser `.wasifs` image into the real
Emacs core filesystem.

The current reverse synchronization is intentionally narrow and temporary.
Emacs writes `/home/user/notes.txt` with `write-region`, prints a
`WASMACS_SYNC_FILE` / `WASMACS_SYNC_BEGIN` / `WASMACS_SYNC_END` stdout marker,
and the main thread handles the worker `sync-file` message by updating the
`BrowserUserImage`, persisting the serialized `.wasifs` payload, and refreshing
the visible single-buffer textarea.

This completes the file/buffer bridge proof, but it is not the final GUI
protocol. Milestone 12 should replace marker-based stdout synchronization with
an explicit redisplay/input adapter where the browser is a renderer and input
host rather than the owner of editor state.

The dev server must serve the extensionless `temacs` glue as JavaScript;
otherwise browser `importScripts` rejects it.

## First Redisplay Adapter

Milestone 12 starts with a small `text-grid-draw` v1 message:

```text
{
  type: "text-grid-draw",
  version: 1,
  path: "/home/user/notes.txt",
  columns: 80,
  rows: [...],
  point: { row, column },
  modeLine: "..."
}
```

`app/src/redisplay-protocol.js` converts synchronized buffer text into that
message and validates it. `app/src/main.js` renders the message into
`#frame-grid` with a cursor and mode line. The textarea remains as a temporary
input surface, but the visible Emacs-like frame now comes from an explicit draw
message instead of directly from the editable DOM control.

Next, keyboard input should be converted into explicit command messages and
round-tripped through the Emacs-side buffer/file bridge before the draw message
is refreshed.

The first command bridge handles only a tiny key subset:

```text
printable key -> { type: "insert-text", path, text }
Enter         -> { type: "insert-text", path, text: "\n" }
Backspace     -> { type: "backspace", path }
```

`app/src/input-protocol.js` rejects modified keys, composition events, and
non-user paths. `app/src/main.js` listens on `#frame-grid`, prevents the
browser from owning accepted editing keys, and sends `run-buffer-command` to a
one-shot worker. The worker converts that command into Emacs batch Elisp,
opens `/home/user/notes.txt`, applies `insert` or `delete-char -1`, writes the
file with `write-region`, emits the current temporary sync marker, and the app
refreshes the `text-grid-draw` frame.

This proves the input path crosses the Emacs bridge, but it is still slow
because each accepted key starts a fresh worker. The next architecture step is
a persistent command loop or queue that keeps the core-side command owner alive
between inputs.

The first latency mitigation is a browser-side command queue. It keeps one
command in flight at a time and coalesces adjacent pending `insert-text`
commands for the same file:

```text
insert "a" + insert "b" -> insert "ab"
```

Backspace and later movement commands stay as ordering boundaries. This does
not make Emacs itself persistent yet, but it avoids racing worker startup and
lets fast printable input use fewer one-shot Emacs runs. The next step is to
investigate a core-side persistent command loop or a new browser build profile
that can keep the Emacs command owner alive between host messages.

Point is now part of the bridge. Accepted key commands carry `pointIndex`,
the worker emits `WASMACS_POINT`, and `text-grid-draw` renders the cursor from
the returned point. ArrowLeft and ArrowRight are routed as `move-point`
commands and run Emacs `backward-char 1` / `forward-char 1`.

See `docs/persistent-command-loop-feasibility.md` for the current persistent
loop boundary: the known-good profile is `-sEXIT_RUNTIME=1` and uses Emacs
`--batch`, so a real persistent command owner should be a separate build or
host-entrypoint spike rather than a mutation of the working batch proof.

## Validation

```sh
scripts/validate-browser-mvp-readiness.sh
scripts/validate-browser-profile-spike.sh
scripts/validate-browser-worker-app.sh
npm test
```

The readiness check records that the Milestone 7 artifact is Node-only. The
browser profile check records the current non-`NODERAWFS` preload package
proof. The worker app check records the static browser worker wiring.
