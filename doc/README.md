# doc/

Design documents for wasmacs. Start with the repository `README.md` (what works
and how to use it) and `ARCHITECTURE.md` (ownership boundaries); the documents
here go into one subject each.

## Current design

| Document | Subject |
| --- | --- |
| `process-service.md` | The process kernel: processes, pipes, signals, pseudoterminals, process HTTP, the bundled programs, the rules for kernel code, tests. |
| `small-os-for-emacs.md` | wasmacs as a small compatibility OS for Emacs: the services Emacs needs and their contracts. |
| `os-compatibility-boundary.md` | Inventory of the OS compatibility layer: who owns memory, roots, lifecycle, preloaded state and entry points. |
| `host-abi.md` | The boundary between the Emacs core and the browser host. Checked by `tools/scripts/validate-host-abi.sh`. |
| `wasifs-format.md` | The `.wasifs` image format. Checked by `tools/scripts/validate-user-filesystem-image.sh`. |
| `clipboard-kill-ring-boundary.md` | Clipboard and kill ring: what Emacs owns and what the browser does. |
| `emacs.md` | Reference: the Emacs 30.2 source mechanics (GC, roots, pdump, input) the port depends on. |
| `use-package-fetch-sample.el` | Sample Elisp that installs a package through the network route. |

## history/

Plans and records of finished or superseded work. They describe the state at
the time they were written and are kept for the reasoning, not as a description
of the product.

| Document | What it was |
| --- | --- |
| `history/emacs-30.2-source-inventory.md` | Milestone 1: which Emacs sources matter for a first wasm build. |
| `history/build-strategy.md` | Milestone 2: the choice of the first build route. |
| `history/p.md` | The early wasm and browser runtime plan derived from `emacs.md`. |
| `history/os-change.md` | How the terminal input path was redesigned several times (Japanese). |
| `history/small-os-substrate-implementation.md` | Milestone 13.5: the first slice of the "small OS" substrate, from the Asyncify period. |
| `history/async.md` | The plan that made the Atomics input wait run Emacs timers (done 2026-06-09). |

## Elsewhere

- `PLAN.md`: milestones and dated implementation records (append-only).
- `LOG.md`, `MEMORY.md`: working log and project memory of the agent sessions.
- `AGENTS.md`: instructions for coding agents working in this repository.
- `archive/README.md`: retired mechanisms and why they were retired.
- `extension/README.md`, `src/c/README.md`, `src/userland/*/README.md`: the
  companion extension, the Emacs patch layer, and each bundled program.
