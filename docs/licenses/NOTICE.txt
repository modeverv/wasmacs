# Licences

wasmacs is two kinds of things: code written for it, and other people's
programs, which it changes, compiles and publishes.  They are under
different licences.

## Code written for wasmacs: MIT

Everything in this repository that the next two sections do not name is
under the MIT licence, [LICENSE](LICENSE): the process kernel, the host
runtime, the pages, the eval service and its client, the Chrome companion,
the build and test scripts, the Emacs Lisp, the documents.

Some of this code runs inside GNU Emacs or is linked into the programs
below.  The MIT licence is compatible with the GNU GPL (the FSF lists it as
the [Expat licence](https://www.gnu.org/licenses/license-list.html#Expat)),
which is what the GPL asks of
[code that is combined with a GPL program](https://www.gnu.org/licenses/gpl-faq.html#GPLAndPlugins).
The combination, such as the published `temacs.wasm`, is under the GPL as a
whole.

## Changes to other programs: the licence of the program

These files are parts of other programs, or changes to them, and are under
the licence of that program.

| Files | Licence | They belong to |
|---|---|---|
| `src/c/patches/*.patch`, `archive/retired/stale-c-patch-layer/` | GPL-3.0-or-later | GNU Emacs |
| `src/userland/busybox/patches/*.patch`, `src/userland/busybox/config/` | GPL-2.0-only | BusyBox |
| `src/userland/git/http-browser.c`, `src/userland/git/curl/` | GPL-2.0-only | git: written against its internal interfaces and compiled into it |
| `src/userland/python/patches/*.patch` | PSF-2.0 | CPython |
| `src/wasm/coi-serviceworker.js` and its copies under `docs/` | MIT, Copyright (c) 2021 Guido Zuidhof | [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) 0.1.7, unchanged |

The texts are in [LICENSES/](LICENSES).

## What the site publishes

`docs/`, published as <https://modeverv.github.io/wasmacs/>, holds compiled
programs.  Each is under its own licence, not under MIT.  Paths are under
`docs/artifacts/`.

| Files | Program | Licence |
|---|---|---|
| `emacs-browser-atomics-pdump/temacs.wasm`, `temacs.js`, `bootstrap-emacs.pdmp`, `temacs.data.parts/`, `temacs.core.data` (a part of the same `lisp/` and `etc/`) | GNU Emacs 30.2, with its `lisp/` and `etc/`, changed by `src/c/patches/` | GPL-3.0-or-later |
| `emacs-browser-atomics-pdump/temacs.files.json`, `temacs.core.files.json` | wasmacs: where the files of Emacs are in those packages | MIT |
| (linked into Emacs) | SQLite 3.54.1 | public domain |
| `userland/busybox.wasm`, `busybox.js` | BusyBox 1.38.0, changed by `src/userland/busybox/patches/` | GPL-2.0-only |
| `userland/git.wasm`, `git.js`, `git-http.wasm`, `git-http.js` | git 2.52.1, with `src/userland/git/http-browser.c` in place of its libcurl transport; zlib 1.3.1 | GPL-2.0-only; zlib: Zlib |
| `userland/grep.wasm`, `grep.js` | GNU grep 3.12 | GPL-3.0-or-later |
| `userland/diff.wasm`, `diff.js`, `diff3.wasm`, `diff3.js` | GNU diffutils 3.12 | GPL-3.0-or-later |
| `userland/python.wasm`, `python.js`, `python314.zip`, `python314-os.py` | CPython 3.14.10, changed by `src/userland/python/patches/` | PSF-2.0; the ZIP carries CPython's `LICENSE.txt` and the notices of what it bundles in `licenses/` |
| `userland/wasmacs-*.js`, `wasmacs-base.wasm`, everything under `docs/app/` except `coi-serviceworker.js` | wasmacs | MIT |
| inside every `.wasm` and the `.js` next to it | Emscripten 5.0.7: its JavaScript runtime, musl libc, compiler-rt | MIT or NCSA; musl: MIT; compiler-rt: Apache-2.0 WITH LLVM-exception |

The page also loads [xterm.js](https://github.com/xtermjs/xterm.js) (MIT)
from a CDN; it is not in this repository.

## Source of the published programs

The exact source archives the programs were built from are kept with this
repository, as files of the release
[`sources-2026-11-15`](https://github.com/modeverv/wasmacs/releases/tag/sources-2026-11-15):

| Archive | SHA-256 | Where it came from |
|---|---|---|
| `emacs-30.2-636f166.tar.xz` | `2438c857befc0e0f2ea4142fae5285acf314a33c8c660bb43b3a9bad3e6486f5` | `git archive` of commit `636f166cfc86aa90d63f592fd99f3fdd9ef95ebd` (tag `emacs-30.2`) of <https://github.com/emacs-mirror/emacs>, the submodule `vendor/emacs` |
| `busybox-1.38.0.tar.bz2` | `34f9ea6ff8636f2c9241153b9114eefa9e65674a45318ae1ef95bb5f31c53bb2` | <https://busybox.net/downloads/> |
| `git-2.52.1.tar.xz` | `2c85e1fabf6000f732657999d015562ca8af2c988723625ef8d0ba0a8e494b39` | <https://mirrors.edge.kernel.org/pub/software/scm/git/> |
| `grep-3.12.tar.xz` | `2649b27c0e90e632eadcd757be06c6e9a4f48d941de51e7c0f83ff76408a07b9` | <https://ftp.gnu.org/gnu/grep/> |
| `diffutils-3.12.tar.xz` | `7c8b7f9fc8609141fdea9cece85249d308624391ff61dedaf528fcb337727dfd` | <https://ftp.gnu.org/gnu/diffutils/> |
| `Python-3.14.10.tar.xz` | `de414a57119abef52784d8993e341d53aed635fc2b05c2607d9f98a2c5b72032` | <https://www.python.org/ftp/python/3.14.10/> |
| `sqlite-amalgamation-3540100.zip` | `0a9c8e34352dad46006aa82836d5383bff9dc6bc9ce5a60553c05aa30e6ad1f9` | <https://www.sqlite.org/2026/> |

Together with this repository at that tag (the patches, the configuration
and the build scripts under `src/build/` and `src/userland/`) they are the
complete corresponding source.  The README says how to build.  Emscripten
and zlib are not mirrored: their licences do not ask for it, and the build
takes them from an Emscripten 5.0.7 installation.

When the published programs are built again from other sources, a new
release holds those, and this file names it.  If an archive is missing, open
an issue at <https://github.com/modeverv/wasmacs/issues> and it will be
provided.

## If you copy the published files

Whoever puts the files of `docs/artifacts/` on another site (elisp-studio's
`fetch-emacs.sh` does that) distributes these programs, under the licences
above.  The site publishes this file and the licence texts under
`licenses/`; keep that directory next to the copy.
