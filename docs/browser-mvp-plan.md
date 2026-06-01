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
- one active buffer backed by a `/home/user/...` file
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
- `/home/user/notes.txt` is the initial file. The UI also has a path field and
  Open button for user files such as `/home/user/projects/demo.txt`.
- The editor marks the buffer `modified` on input and `saved` after explicit
  save.
- Reload persistence is currently browser `localStorage`, but the stored value
  is now the base64 form of a tar-compatible `user-filesystem.wasifs` payload.
- Export downloads `user-filesystem.wasifs`; Import accepts a `.wasifs` file
  and reloads the active buffer path from it.

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
persistent worker. The worker converts that command into Emacs Lisp, opens the
active `/home/user/...` file with real Emacs `find-file`, applies `insert`,
`delete-char -1`, or movement in the live file-visiting buffer, saves modified
buffers with `save-buffer`, and returns path/point/text through
`wasmacs_last_result` so the app can refresh the `text-grid-draw` frame.

The first latency mitigation is a browser-side command queue. It keeps one
command in flight at a time and coalesces adjacent pending `insert-text`
commands for the same file:

```text
insert "a" + insert "b" -> insert "ab"
```

Backspace and later movement commands stay as ordering boundaries. The queue
still prevents command pileups, even though the Emacs worker is now persistent.

Point is now part of the bridge. Accepted key commands carry `pointIndex`, and
`text-grid-draw` renders the cursor from the point returned by
`wasmacs_last_result`. ArrowLeft and ArrowRight are routed as `move-point`
commands and run Emacs `backward-char 1` / `forward-char 1`.

See `docs/persistent-command-loop-feasibility.md` for the current persistent
loop boundary: the known-good profile is `-sEXIT_RUNTIME=1` and uses Emacs
`--batch`, so a real persistent command owner should be a separate build or
host-entrypoint spike rather than a mutation of the working batch proof.

The first separate profile exists as
`artifacts/emacs-browser-persistent-spike/`, built by
`scripts/build-emacs-browser-persistent-spike.sh`. It uses
`-sEXIT_RUNTIME=0`, exports `callMain`, `wasmacs_eval_string`,
`wasmacs_last_result`, and Emscripten FS helpers including `FS_readFile`.
Validation is in `scripts/validate-browser-persistent-spike.sh` and
`logs/wasm-browser-persistent-batch.txt`.

The persistent profile can now boot once, run host-initiated Elisp commands,
mutate files through Emacs file primitives, and return a path/text/point
payload through `wasmacs_last_result`. The browser worker now uses this path
for buffer commands and stays alive across queued key commands. The current
smoke evidence is in `logs/browser-persistent-worker-smoke.txt`.

Milestone 13 has started with project-file editing. The UI can open
`/home/user/projects/demo.txt`, create it in the user image if needed, edit it
through the persistent Emacs worker, save, and reload it. Evidence is in
`logs/browser-project-file-smoke.txt`.

Command dispatch now includes `Ctrl+S` as an explicit `save-buffer` command.
The visible `Process` probe documents the MVP process boundary by showing
`host.process is unavailable in the browser MVP` instead of silently failing or
pretending subprocesses are available. Evidence is in
`logs/browser-command-dispatch-smoke.txt`.

The editor pane now includes a file switcher backed by the browser
`user-filesystem.wasifs` entries. It hides tar metadata and internal runtime
state, marks the active file, and switches buffers from browser user-image
state without launching Emacs until an edit command arrives. Evidence is in
`logs/browser-file-switch-smoke.txt`.

Queued editing commands now advance point optimistically on the browser side.
That keeps fast printable input in order while a persistent Emacs command is
still in flight. Recovery after the disabled process path is covered by
`logs/browser-worker-recovery-smoke.txt`.

`scripts/summarize-browser-editing-session.mjs` rolls the individual browser
smoke logs into `logs/browser-editing-session-smoke.txt`, so `npm test` has one
session-level check for project-file editing, command dispatch, file switching,
and worker recovery.

Find/open semantics now have a tested path normalizer. Relative names open
under `/home/user/projects`, absolute `/home/user/...` paths are normalized,
and paths outside `/home/user` are rejected. The file path input also opens on
Enter; evidence is in `logs/browser-enter-open-smoke.txt`.

The textarea remains a temporary compatibility/input surface while the
frame-grid path becomes the primary Emacs-owned UI. To avoid dropping ordinary
browser edits during this transition, `app/src/main.js` persists modified
textarea contents into the browser user image before Open or file-list
switching loads another file. Evidence is in
`logs/browser-textarea-autosave-smoke.txt`, and the session summary now checks
that autosaved text survives switching away and back.

`C-g` and `C-/` are now explicit command boundaries. `C-g` clears pending
browser-side commands and reports `keyboard quit`. `C-/` is deliberately not
faked yet: the current command bridge reconstructs a temporary Emacs buffer for
each command, so real Emacs undo history cannot survive. The worker reports
`undo requires persistent Emacs buffers` until the browser path owns persistent
Emacs buffers. Evidence is in `logs/browser-undo-quit-smoke.txt`.

Clipboard commands are also explicit boundaries. `C-y`, `C-w`, and `M-w` are
accepted by `app/src/input-protocol.js`, but the worker reports
`clipboard unavailable` until persistent region/kill-ring state and the GUI
clipboard protocol are connected. The design note is
`docs/clipboard-kill-ring-boundary.md`; browser evidence is in
`logs/browser-clipboard-boundary-smoke.txt`.

Minibuffer-oriented command sequences are now recognized without being faked.
`C-x C-f` maps to `find-file` and `C-x b` maps to `switch-buffer`, but both
report `minibuffer unavailable` until the browser host has a persistent Emacs
command loop, minibuffer window state, and completion UI. The design note is
`docs/minibuffer-command-boundary.md`; deterministic probe evidence is in
`logs/minibuffer-command-boundary.txt`.

The next shared dependency for undo, kill-ring, and minibuffer fidelity is a
stable persistent Emacs buffer path.
`docs/persistent-emacs-buffer-requirement.md` records why the current
per-command temp-buffer bridge is insufficient.
`scripts/probe-browser-persistent-buffer-undo.mjs` attempts the smallest
`find-file` plus undo path and records the current wasm blocker in
`logs/wasm-browser-persistent-buffer-undo.txt`: persistent-buffer undo crashes
during GC/undo traversal with `memory access out of bounds`.
`scripts/probe-browser-persistent-buffer-matrix.mjs` narrows this further:
`find-file` and persistent writes pass, undo recording without calling `undo`
passes, direct `primitive-undo` passes, and `undo-start` plus `undo-more` also
passes. Both normal high-level `undo` and high-level `undo` with a very high
`gc-cons-threshold` remain known blockers, so the issue is now narrowed to the
latter half of the Lisp `undo` command rather than basic persistent buffer
mutation.

The cross-eval persistent-buffer probe adds one more boundary. A plain named
Emacs buffer survives across separate `wasmacs_eval_string` calls and can be
written back as `alpha beta`, so persistent buffer identity is viable in the
browser-hosted wasm runtime. However, carrying a file-visiting buffer created
by `find-file` across host eval calls still crashes during GC marking, and
carrying undo-list state across host eval calls also crashes. Evidence is in
`logs/wasm-browser-persistent-buffer-cross-eval.txt`. The next worker change
should therefore introduce a dedicated persistent command mode only after the
host entrypoint is made stack/GC-safe for file-visiting buffers.

The file-buffer GC roots probe narrows this further. Host eval now refreshes
the C stack-scan bottom and inhibits GC during the eval call. With that
temporary boundary, boot-only GC forms, temp buffers, named buffers, manual
`buffer-file-name`, `set-visited-file-name`, `insert-file-contents`, and
`find-file` buffers killed before returning all pass. Live `find-file` buffers
still crash after `find-file-noselect-1` / `after-find-file` state is kept
across host eval calls. Evidence is in
`logs/wasm-browser-file-buffer-gc-roots.txt` and
`logs/wasm-browser-visited-file-cross-eval.txt`. Browser
undo/kill-ring/minibuffer behavior remains explicitly unavailable rather than
faked.

`logs/wasm-browser-find-file-phases.txt` narrows the live file-buffer blocker
again: `find-file-noselect`, `switch-to-buffer`, `pop-to-buffer-same-window`,
live `find-file`, and in-memory edits survive host eval boundaries. Direct
`write-region` against a live file-visiting buffer remains a known blocker,
while `save-buffer` passes. The browser worker should therefore migrate live
file-buffer saves toward the real Emacs `save-buffer` path instead of using
direct `write-region` once persistent file buffers are enabled.

The browser worker now uses that path for ordinary editing commands: it opens
the active `/home/user/...` file with `find-file`, applies the command, and
saves modified buffers with `save-buffer`. Direct `write-region` is kept only
in older non-live proof probes. Undo, kill-ring/clipboard, and minibuffer
commands still report explicit unavailable states rather than browser-side
substitutes.

Undo has now crossed the first real-fidelity threshold. The worker records
`undo-boundary` after edit commands and maps `C-/` to Emacs `undo-only` in the
same live file-visiting buffer. This is not a browser-side undo stack:
`scripts/probe-browser-worker-real-undo.mjs` verifies the worker-shaped
insert/undo/save sequence against the persistent wasm artifact, and
`logs/browser-real-undo-ui-smoke.txt` records the same flow through the browser
UI. `scripts/probe-browser-worker-repeated-undo.mjs` and
`logs/browser-repeated-undo-ui-smoke.txt` extend the proof to two edits
followed by two real Emacs `undo-only` commands. `C-?` now maps to real Emacs
`undo-redo 1`; `scripts/probe-browser-worker-redo.mjs` and
`logs/browser-redo-ui-smoke.txt` prove insert/undo/redo through the worker and
browser UI. `scripts/probe-browser-worker-redo-interleaving.mjs` records the
next known blocker: multi-edit `A`, `B`, `undo-only`, `undo-redo` currently
returns `No undone changes to redo`, so redo bookkeeping still needs a
multi-edit command-loop pass. The worker now treats the active file-visiting
buffer as Emacs-owned after boot, skipping browser image rematerialization for
that path before subsequent commands so `save-buffer` does not see its visited
file as externally changed. Clipboard / kill-ring and minibuffer commands
remain explicit unavailable boundaries.

## Validation

```sh
scripts/validate-browser-mvp-readiness.sh
scripts/validate-browser-profile-spike.sh
scripts/validate-browser-persistent-spike.sh
scripts/validate-browser-worker-app.sh
npm test
```

The readiness check records that the Milestone 7 artifact is Node-only. The
browser profile check records the current non-`NODERAWFS` preload package
proof. The worker app check records the static browser worker wiring.
