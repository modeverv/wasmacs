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

## Validation

```sh
scripts/validate-browser-mvp-readiness.sh
scripts/validate-browser-profile-spike.sh
npm test
```

The readiness check records that the Milestone 7 artifact is Node-only. The
browser profile check records the current non-`NODERAWFS` preload package proof.
