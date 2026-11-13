# wasmacs

`wasmacs` is a project for running GNU Emacs in the browser.

This is not a project to build an "Emacs-like editor." Its goal is to run the real Emacs on WebAssembly by keeping the GNU Emacs 30.2 C core and Elisp runtime at the center, while the browser side provides display, input, persistence, and portable filesystem images.

The current main route is the browser runtime built on `SharedArrayBuffer`, `Atomics.wait`, pdump, and xterm.js. It has reached `*scratch*`, Dired, Org mode, Elisp loading through `load-file`, import/export of `.wasifs` images, and subprocesses: `M-x shell`, eshell, git, grep, and Magit run inside the browser tab.

## Current Capabilities

- Boot the GNU Emacs 30.2 C core in the browser
- Display Emacs `--nw` through xterm.js
- Handle truecolor, control keys, cursor movement, mouse input, bracketed paste, and resizing with `TERM=xterm-256color`
- Materialize the bundled `bootstrap-emacs.pdmp` and reach the interactive waitpoint
- Import/export `user-filesystem.wasifs`
- Load Elisp from the user-side `.wasifs` image with `load-file`
- Boot from static hosting on GitHub Pages
- Route `url.el` / `package.el` HTTP(S) requests through `host.network.fetch`
- Use a user-operated self-hosted proxy for package archives that cannot be fetched directly because of CORS
- Copy yanked text to the browser clipboard
- Start subprocesses from Emacs: `call-process`, `make-process`, `shell-command`, `M-x shell`, eshell with external commands and pipelines
- Run a POSIX shell (BusyBox `ash`) and about 150 command line tools, git 2.52 (local repositories), and GNU grep 3.12 as real processes with pipes, signals, `fork` and `exec`
- Use `M-x grep`, `rgrep`, `lgrep`, the xref/project search commands, `vc-git`, and Magit (status, staging, commit with the message edited in Emacs, log, diff)

## Current Limitations

- Processes are provided by wasmacs's own process service, not by the host: only the bundled programs (BusyBox tools, git, GNU grep) can run. See [Subprocesses](#subprocesses-shell-git-grep).
- There are no pseudoterminals or raw sockets. `M-x term` / `ansi-term` do not work; `M-x shell` and eshell do. Git `clone`, `fetch` and `push` support Smart HTTP(S) through the Chrome companion, as well as local repositories.
- Scheduling is cooperative on one thread. A program that computes for a long time without any system call cannot be interrupted until it makes one.
- Network features such as `package-refresh-contents` are constrained by browser fetch, CORS, and proxy configuration.
- This is not a port of native GUI Emacs frames. The current route is terminal Emacs running on xterm.js.
- Pages artifacts under `docs/` are split and constrained so they can be hosted by GitHub Pages.
- A separate build route can generate the VS Code `.wasifs` extension.

## Repository Layout

```text
src/wasm/   browser wasm app source
src/assets/ source assets copied into generated docs output
src/build/  docs and artifact generation scripts
src/c/      Emacs C-side patch layer
src/runtime/ host/runtime libraries used by tests and tools
src/runtime/process/ process service: kernel, per-process runtime, filesystem layout of the userland
src/userland/ builds of the programs that run as processes (BusyBox, git, GNU grep)
tools/      build / validation / probe / inspection tools
proxy/      self-hosted fetch proxy samples for package archives
vendor/     pinned upstream GNU Emacs source; read-only
build/      copied Emacs working tree, temporary state, and generated artifacts
build/artifacts/ generated wasm / pdmp / wasifs build products
build2/     VS Code-only copied Emacs workspace and runtime artifacts
doc/        architecture and planning notes
docs/       GitHub Pages output
vscode/     generated VS Code webview app bundle
logs/       ignored runtime logs; only .gitkeep is kept in Git
tests/      automated test code
archive/    retired mechanisms (archive/retired/, indexed in archive/README.md) and old outputs
```

`vendor/emacs` is the pinned upstream GNU Emacs source tree. Do not edit it directly. The product's changes to Emacs are the numbered patches in `src/c/patches/`, applied to a copied build tree (see `src/c/README.md`).

The product route is one page, one worker and one build: `src/wasm/xterm-atomics-pdump.html`, `src/wasm/src/emacs-atomics-pdump-worker.js`, and `src/build/build-emacs-browser-atomics-pdump-profile.sh`. Earlier mechanisms (the textarea app with its command bridge, the Asyncify command protocol, early build spikes) live under `archive/retired/`; `tests/runtime/canonical-route.test.js` keeps live files from depending on them.

## Browser App

The main development route is available at the following URL after running `npm run dev`.

```text
http://127.0.0.1:5173/app/xterm-atomics-pdump.html
```

`make docs` generates the GitHub Pages bundle. `docs/index.html` redirects `/` to the canonical app page, `/app/xterm-atomics-pdump.html`.

The Pages bundle follows these rules:

- Use the root `coi-serviceworker.js` to provide a COOP/COEP-like environment for `SharedArrayBuffer`.
- Keep app and artifact URLs relative so project pages also work.
- Publish the Emscripten glue as `temacs.js` so static servers return a JavaScript MIME type.
- Store the large Emscripten preload package as chunks under `docs/artifacts/temacs.data.parts/` instead of a single oversized `temacs.data` file.

Routine diagnostic logs are quiet by default. Append the following query parameter to enable verbose logs:

```text
?debug-log=1
```

When inspecting the page with DevTools while resizing the viewport, this query parameter keeps the post-boot terminal size stable:

```text
?no-live-resize=1
```

## Screenshots

### Startup

![wasmacs startup screen](src/assets/screenshots/start.png)

### Dired

![wasmacs Dired buffer](src/assets/screenshots/dired.png)

### Org File

![wasmacs Org file buffer](src/assets/screenshots/org.png)

## Requirements

- Node.js 24 or newer
- npm
- Emscripten toolchain
- GNU make

xterm.js is not vendored through `node_modules`. Browser pages load it from the jsDelivr CDN. The checked-in HTML directly references `https://cdn.jsdelivr.net/npm/@xterm/xterm@5/...`.

After cloning, run:

```sh
npm ci
```

## Common Commands

```sh
make check-patches
make test
make build
make userland
make test-process
make vscode-build
make docs
make dev
```

`make check-patches` verifies that `src/c/patches/*.patch` apply to the pinned `vendor/emacs`. The product build applies them to its copied tree itself (`src/build/apply-emacs-patches.sh`). Do not edit `vendor/emacs` directly.

`make build` regenerates the Emacs wasm / pdmp / wasifs artifacts and the process userland under `build/artifacts/`, then refreshes the GitHub Pages bundle under `docs/`.

`make userland` builds only the programs that run as processes (`build/artifacts/userland/`). The first run downloads the BusyBox, git and GNU grep release tarballs into `build/userland/dl/`; their sha256 sums are pinned in the build scripts.

`make test` (`npm test`) is what CI runs: the runtime contract tests, including one that boots the checked-in `docs/` bundle under Node and lets Emacs run `sh`, `git` and `grep`. `make test-process` runs the full process suites (kernel tests, then real Emacs driving real subprocesses); `npm run browser:smoke:processes` drives the page in headless Chrome.

`make dev` starts the development server. The development server exposes runtime files at `/artifacts/...`, so workers and smoke URLs use the same URL contract as Pages.

`make vscode-build` generates the separate route for the VS Code `.wasifs` extension. VS Code-only artifacts are written under `build2/artifacts/`, and the webview app bundle is written under `vscode/app/`. This route does not consume or update `docs/app` or `docs/artifacts`.

## Subprocesses: shell, git, grep

A browser has no processes, so wasmacs brings a small UNIX-like kernel of its own (`src/runtime/process/wasmacs-kernel.js`). It lives in the Emacs worker. Emacs is process 1; every other process is a separate WebAssembly instance of a program built with Emscripten and Asyncify, with its own memory, sharing Emacs's filesystem. The kernel provides `fork`, `exec`, `posix_spawn`, `wait`, pipes, signals, process groups and timers, and switches between processes whenever one of them (or Emacs) makes a system call.

```text
Emacs (callproc.c, process.c)        emacs_spawn / waitpid / kill / pipe / poll
  -> process kernel                  scheduler, pipes, signals, fd tables
       -> /bin/sh, /bin/ls, ...      BusyBox (one image, ~150 commands)
       -> /bin/git                   git 2.52
       -> /bin/grep                  GNU grep 3.12
```

What that gives Emacs:

- `M-x shell` and eshell, including pipelines, redirection, background jobs, `C-c C-c`
- `C-g` interrupts a synchronous subprocess
- git on repositories in the filesystem: `vc-git` and Magit work, and a repository under `/home/user` survives a page reload (executable bits and modification times are saved with the user image)
- `M-x grep`, `rgrep`, `lgrep`, `project-find-regexp`, `xref-find-references` with the unmodified Emacs defaults
- shell scripts, `find`, `sed`, `awk`, `diff`, `tar`, `gzip` and the other BusyBox tools

What it does not give:

- no pseudoterminals: programs see pipes, so `M-x term` does not work and full-screen programs are of no use
- no raw sockets: Git HTTP(S) uses the browser host capability; SSH and `git://` are unavailable
- no other programs than the bundled ones; there is no compiler, no Python, no package manager
- `ediff` needs GNU `diff` output formats that the BusyBox `diff` does not produce (`M-x diff` and `vc-diff` are fine)
- the whole of `/home/user` is saved as one image whenever it changed, so very large repositories make saving slow

Magit is not bundled. Install it with `package.el` (see Network Access below), or bring it in a packed `.wasifs` image.

The design is described in `doc/process-service.md`.

## Network Access

wasmacs treats network access as an explicit browser host capability.

The Emacs core does not receive raw sockets. The checked-in `wasmacs-url-fetch` Lisp overlay routes `url.el` HTTP(S) requests through `host.network.fetch`. This lets `package-refresh-contents`, `package-install`, `use-package :ensure`, and similar features run as request/response services. Git's HTTP helper uses the same request/response boundary through a restartable process import.

However, direct browser `fetch` is constrained by CORS. If the remote package archive does not allow the page origin, JavaScript cannot read the response body. Service Workers can help with app caching and COOP/COEP, but they cannot make an unreadable cross-origin response readable.

When an archive is blocked by CORS, users can configure a self-hosted fetch proxy under their own control. wasmacs does not provide a central proxy service.

### Git clone, fetch and push

Load or reload the unpacked extension from `extension/`, then reload the wasmacs
page. In `M-x shell` or eshell, use ordinary Smart HTTP(S) remotes:

```sh
git clone https://github.com/OWNER/REPOSITORY.git
cd REPOSITORY
git fetch origin
git push origin main
```

Git HTTP uses the companion by default. The target must have both Chrome host
permission and an extension allowlist entry; GitHub is already included.
For private repositories and authenticated pushes, enable **Allow credentials**
in the extension's options and use an exact HTTPS host in the allowlist. Supply
authentication using Git credentials or a URL-scoped `http.extraHeader` inside
wasmacs. The extension does not import credentials from the host machine or
store tokens. Credentials saved under `/home/user` are part of the portable
user image. Use the canonical remote URL: authenticated requests and POST do
not follow redirects.

The helper is built from pinned Git's original `remote-curl.c`; Git still owns
negotiation, pack validation and ref updates. It supports protocol v0/v2. HTTP
bodies are buffered and limited to **25 MiB per request and response**, with a
**30 second request timeout**. Large repositories may exceed these limits.
SSH, `git://`, dumb HTTP/WebDAV and cross-origin packfile downloads are not
provided. `C-g`/process termination cancels pending requests; a cancelled or
failed push can have reached the server, so inspect the remote before retrying.

For CORS-enabled servers, `?network-transport=direct` explicitly selects direct
fetch. `?network-transport=proxy&network-proxy=...` selects one configured HTTP
proxy (it must support Git POST and authentication). Process HTTP never falls
back to another transport after a failure, so a push is not silently replayed.
Package downloads keep their existing fallback behavior.

Run `npm run test:git-http` for real Chrome/extension clone, fetch and push
against a disposable HTTPS repository, or `npm run test:git-http:transport`
for the wasm Git transport test. Neither test pushes to a user's remote.
Implementation details: [Git HTTP adapter](src/userland/git/README.md).

### Chrome companion extension

For Chrome-based local/dev use, wasmacs also includes an unpacked companion
extension in `extension/`. The extension provides the same explicit
`host.network.fetch` capability without disabling CORS globally:

```text
wasmacs page
  -> content-script bridge
  -> extension service worker
  -> allowlisted fetch
  -> status / filtered headers / base64 body
```

Load it from `chrome://extensions` with Developer mode enabled, then choose
`extension/` with Load unpacked. The default extension policy allows local
wasmacs pages at `http://localhost/*` and `http://127.0.0.1/*`, plus the
published Pages app at `https://modeverv.github.io/wasmacs/*`. It allows target
fetches for GNU ELPA, MELPA, raw GitHub files, and GitHub. It rejects
private-network targets and credentialed requests by default.

On the Atomics/pdump page, `host.network.fetch` detects the companion with
`WASMACS_PROXY_PING`. When the extension is available, package archive requests
use `WASMACS_PROXY_REQUEST` / `WASMACS_PROXY_RESPONSE` before falling back to
direct browser fetch or a configured self-hosted proxy. This path has been
manually verified with `package-refresh-contents` reaching the GNU ELPA package
menu from:

```text
http://127.0.0.1:5173/app/xterm-atomics-pdump.html?autostart
```

An Emacs-side smoke expression:

```elisp
(progn
  (require 'wasmacs-url-fetch)
  (setq wasmacs-url-fetch-proxy-url nil)
  (wasmacs-url-fetch-enable)

  (require 'package)
  (setq package-user-dir "/home/user/.emacs.d/elpa"
        package-check-signature nil
        package-archives '(("gnu" . "https://elpa.gnu.org/packages/")))
  (package-initialize)
  (unless package-archive-contents
    (package-refresh-contents))

  (require 'use-package)
  (setq use-package-always-ensure t)
  (use-package rainbow-mode
    :ensure t
    :demand t))
```

See `extension/README.md` for the ping test, safe GET test, options page, and
audit log notes.

### Self-hosted proxy samples

The `proxy/` directory includes sample implementations in Node, PHP, Rust, Perl, Ruby, Python, and PowerShell. Each sample accepts the same JSON request shape as the local development `__wasmacs_network_fetch` route and returns the response status, headers, and base64-encoded response bytes.

The proxy samples are allowlist-based by default. The Ruby sample is the exception: it defaults to `*` for localhost-only development.

Specify allowed archive origins as follows:

```sh
WASMACS_PROXY_ALLOWED_ORIGINS=https://elpa.gnu.org,https://melpa.org
```

When a local proxy is running, pass it to the browser runtime with `network-proxy`:

```text
http://127.0.0.1:5173/app/xterm-atomics-pdump.html?network-proxy=http%3A%2F%2F127.0.0.1%3A8787%2F
```

The runtime first tries direct browser fetch. If CORS prevents reading the archive, it falls back to the configured proxy endpoint. On localhost development pages, it can also use the same-origin `__wasmacs_network_fetch` route provided by `make dev`. Static hosts such as GitHub Pages do not provide that route.

On the Atomics/pdump route, the worker relays `host.network.fetch` to the main page. The actual direct/proxy `fetch` runs on the main page thread, not as worker-local synchronous XHR, and the result is returned through a SharedArrayBuffer result slot.

When a public HTTPS page calls a localhost proxy, modern browsers may send a Private Network Access preflight. For that reason, the bundled proxy samples return `Access-Control-Allow-Private-Network: true` and echo the requesting `Origin` instead of using wildcard CORS.

A proxy can also be configured from Emacs Lisp for a specific user image or init flow:

```elisp
(require 'wasmacs-url-fetch)
(setq wasmacs-url-fetch-proxy-url "http://127.0.0.1:8787/")
(wasmacs-url-fetch-enable)
```

The Emacs-side `wasmacs-url-fetch-proxy-url` value is sent with each `url.el` / `package.el` request and takes precedence over the page-level `network-proxy` default.

## `.wasifs` Images

`.wasifs` files are portable filesystem images used by the browser runtime.

The current spike format is tar-compatible. A plain `tar` command can be used for low-level inspection:

```sh
tar tf user-filesystem.wasifs
```

For normal repository work, use the npm scripts:

```sh
npm run wasifs:list -- user-filesystem.wasifs
npm run wasifs:pack -- ./home-user user-filesystem.wasifs --root home/user
npm run wasifs:unpack -- user-filesystem.wasifs ./out
```

`wasifs:pack` packs a local directory under the requested image root.

- Use `--root home/user` for writable user images.
- Use `--root system` for read-only system image experiments.

`wasifs:list` and `wasifs:unpack` hide tar metadata noise such as `PaxHeader`, AppleDouble `._*`, and `.DS_Store`, so the visible tree matches the portable filesystem contents.

### Example: Importing Helm via a Packed Image

![helm-mini buffer](src/assets/screenshots/helm.png)

## Artifact Policy

Build outputs are generated under `build/artifacts/`.

The publishable `docs/` tree contains only the checked-in browser bundle and Pages-safe runtime artifacts. Files allowed under `docs/artifacts/` are validated by `tools/scripts/validate-git-artifact-policy.sh`.

The old 512MB pdump restore failure is not the current browser status. The current Atomics/pdump xterm route has been verified to materialize the bundled pdmp and reach the interactive waitpoint from both the development server and the static Pages bundle.

`make clean` removes legacy `dist/` if it exists and empties `build/` and `docs/`. It intentionally leaves `build2/` and `vscode/` alone so the Pages route and VS Code route can be validated independently.

Runtime and validation logs are written under `logs/`, but log files are ignored by Git. Historical logs from before the reorganization baseline are kept under `archive/old-logs/`.

`build/artifacts/host-abi.wit` is generated by `src/build/generate-host-abi-wit.mjs`. It is a build artifact, not source under `src/`. It is validated by `tools/scripts/validate-host-abi.sh`.

`dist/` is not part of the current layout.

## Architecture

wasmacs is built around three core pieces:

```text
emacs-core.wasm
system-lisp.wasifs
user-filesystem.wasifs
```

`emacs-core.wasm` contains the GNU Emacs C core, Elisp interpreter, bytecode runtime, and built-in primitives.

`system-lisp.wasifs` is a read-only image tied to a fixed Emacs release. It contains GNU Emacs `lisp/`, `.el` files, `.elc` files, autoload/loaddefs artifacts, and `etc/` support files.

`user-filesystem.wasifs` is a writable portable image. It contains `init.el`, ELPA packages, site-lisp, working files, and journal/snapshot metadata.

The intended mount layout at startup is:

```text
/system    read-only
/home/user writable
/tmp       volatile
```

`load-path` gives the user image priority over the system image:

```text
/home/user/.emacs.d/lisp
/home/user/.emacs.d/elpa/*/
/system/lisp
```

This design separates the update cycles of the Emacs runtime, the standard Lisp distribution, and the user's workspace.

Before changing runtime ownership boundaries or C/wasm host surfaces, read:

```text
ARCHITECTURE.md
PLAN.md
doc/small-os-for-emacs.md
```

## Design Principles

- The Emacs core owns editor semantics.
- The browser UI is a display/input host; it must not fake undo, kill-ring, region, minibuffer, or file-visiting semantics.
- `.wasifs` is the unit of portable workspaces.
- `vendor/emacs` is read-only.
- Processes are a service of the compatibility layer (`src/runtime/process`), not of the host: Emacs's own process code runs unchanged against it. Ptys and sockets stay explicit unavailable boundaries.
- Product behavior and diagnostic behavior are kept separate.
- The low-level substrate is C/wasm-first. JavaScript remains the browser coordinator, host capability provider, and diagnostic harness.

## In Development: VS Code `.wasifs` Extension

The VS Code `.wasifs` extension is a separate lane from the Pages bundle.

```sh
make vscode-build
```

This command generates VS Code-only runtime artifacts under `build2/artifacts/` and the webview app bundle under `vscode/app/`. It does not update `docs/app` or `docs/artifacts`.

This keeps the GitHub Pages browser app and the VS Code webview extension experiment coexisting in the same repository while keeping artifact ownership separate.

## Development Notes

This project is not only a browser port of Emacs. It is also an attempt to provide, inside the browser, the small compatibility OS that Emacs expects.

The important part is not to accumulate ad-hoc shims, but to organize the lifecycle, memory/root safety, control flow, blocking input, filesystem/persistence, preloaded state, host capabilities, and browser GUI boundary that Emacs requires.

When changing runtime ownership boundaries or C/wasm host surfaces, do not just add a patch that happens to work. Make clear which service and which invariant the change satisfies.
