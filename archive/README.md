# Archive

Old generated outputs, superseded backups, and mechanisms that no longer have a
live runtime or test role live here instead of next to the product sources.

Nothing under `archive/` is built, served, tested or published. Live files must
not depend on it; `tests/runtime/canonical-route.test.js` enforces that.

```text
archive/
  retired/     mechanisms retired on 2026-11-13, one directory per mechanism
  old-app/     earlier backups of the app directory
  old-logs/    validation and probe evidence from before the ignored-logs policy
```

`old-logs/` keeps historical validation and probe evidence from before the
current ignored-logs policy. New logs should be written to `logs/` and left
untracked.

## The live routes (for orientation)

- **Product: Atomics + pdump.** `src/wasm/xterm-atomics-pdump.html` →
  `src/wasm/src/emacs-atomics-pdump-worker.js` →
  `build/artifacts/emacs-browser-atomics-pdump`, built by
  `src/build/build-emacs-browser-atomics-pdump-profile.sh` from `vendor/emacs` +
  `src/c/patches` with `tools/scripts/wasmacs-atomics-host-library.js`.
- **VS Code `.wasifs` lane (in development): Asyncify.**
  `extensions/vscode-wasifs`, `src/wasm/src/asyncify-minibuffer-worker.js`,
  `tools/scripts/build-emacs-browser-asyncify-spike.sh` (with the perl patcher
  `tools/scripts/patch-emacs-host-entrypoint-spike.sh` and
  `tools/scripts/wasmacs-asyncify-host-library.js`), artifacts under `build2/`.
- Chrome companion extension (`extension/`) and fetch proxy samples (`proxy/`).

## retired/

Each directory keeps the original repository-relative paths, so
`archive/retired/<mechanism>/tools/scripts/foo.sh` used to be
`tools/scripts/foo.sh`. To resurrect something, move it back with `git mv` and
restore its `package.json` script from the history of that file.

| Directory | What it was | Why it is retired |
| --- | --- | --- |
| `retired/textarea-app-command-bridge` | The first browser UI (Milestones 9–13): `index.html` + `main.js` with a text grid and a DOM minibuffer, the per-key command bridge workers (`wasm-worker.js`, `browser-runtime-worker.js`), their protocol modules and unit tests, the persistent-worker probes that replayed its Lisp forms, the old smoke scenarios, and the Milestone 9 plan. | Replaced by real terminal Emacs on xterm.js. Emacs owns the command loop, minibuffer, undo and redisplay; the browser only moves terminal bytes. The command bridge was declared legacy on 2026-06-03 (PLAN.md "Old Command Bridge Retirement"). |
| `retired/asyncify-command-protocol` | The owned Asyncify command protocol (Milestone 13.5): suspended minibuffer reads, forced-read probes, GC/root-safety matrices, the handleAsync input scheduler experiments, the persistent-spike and interactive builds, and the plan documents plus the validators that pinned those plans into `npm test`. | The product no longer suspends Emacs with Asyncify. It blocks in `Atomics.wait` inside the real command loop, so none of the suspend/resume protocol is needed. The builds these probes need are not produced by any live script. |
| `retired/asyncify-xterm-browser-page` | `xterm.html`, the browser page of the Asyncify xterm route, its key-byte helper and its smoke probes. | Superseded as the browser product by the Atomics + pdump page. The Asyncify worker and build stay live for the VS Code lane only. |
| `retired/atomics-without-pdump` | The first Atomics route that booted by cold `loadup.el`: `xterm-atomics.html`, the timing test page, its build script and probes. | Superseded by Atomics + pdump (boot from `bootstrap-emacs.pdmp`). `src/wasm/src/emacs-atomics-worker.js` stays in place because the VS Code extension still lists it as a preflight asset. |
| `retired/pdump-bringup-experiments` | Probes and alternative builds used to get pdumper working under wasm (purecopy tracing, `bindings.el` bisects, `-O2` experiments, Asyncify pdump profiles, the assertions build, the diagnostic page). | pdump works and is part of the product build. Several of these scripts rewrite the live product build tree, so they must not be run casually. |
| `retired/early-build-spikes` | Milestone 2/7 core and batch spikes and the milestone validators that still assumed the pre-`tools/` layout. | Superseded by the canonical build chain in `src/build/`. |
| `retired/stale-c-patch-layer` | `src/c/patches/0001-wasmacs-host-entrypoint-and-terminal.patch` and `src/build/prepare-emacs-source.sh`. | The patch had drifted from the product (the build patched Emacs with a perl script instead) and the prepared tree was consumed by nothing. Replaced by `src/c/patches/000*.patch` + `src/build/apply-emacs-patches.sh`, which the product build applies. |

The npm scripts that drove these mechanisms (`test:asyncify`, `test:persistent`,
`test:known-blockers`, `test:heavy`, `browser:smoke:editing`, …) were removed
from `package.json`; most of them already failed at their first step because
their artifacts were no longer built.

`PLAN.md`, `LOG.md` and `MEMORY.md` are dated logs. They still name these files
by their old paths; read those entries as history.
