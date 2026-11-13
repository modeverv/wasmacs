# C Patch Layer

`vendor/emacs` stays read-only. Every wasmacs change to Emacs C or Lisp sources
is a unified diff in `src/c/patches/`, taken against the pinned `vendor/emacs`
revision (GNU Emacs 30.2).

```text
src/c/patches/
  0001-emacs-host-entrypoints-and-os-services.patch   src/emacs.c
  0002-keyboard-os-compat-waitpoint.patch             src/keyboard.c
  0003-term-tty-direct-color.patch                    src/term.c
  0004-pdumper-heap-backed-dump-mapping.patch         src/pdumper.c
  0005-loadup-wasm-preload-and-dired.patch            lisp/loadup.el
  0006-process-service.patch                          src/callproc.c src/process.c src/sysdep.c
                                                      src/keyboard.c src/lisp.h
  0007-keyboard-honor-read-timeout.patch              src/keyboard.c
```

`0006` is the seam of the Process Service (`doc/process-service.md`):
`emacs_spawn`, `waitpid` and `kill` go to the process kernel, and the idle wait
services subprocess output. `0007` makes `sit-for` / `read-event` honour their
timeout in the wasmacs idle wait.

The product build (`src/build/build-emacs-browser-atomics-pdump-profile.sh`)
applies them to its copied tree with:

```sh
src/build/apply-emacs-patches.sh build/emacs-pdump-configure-probe/src
```

`apply-emacs-patches.sh` rebuilds every patched file from the pristine
`vendor/emacs` copy and applies all patches in file-name order with
`git apply` (strict, no fuzz). The result depends only on `vendor/emacs` and the
patch files, and an up-to-date tree is left untouched.

Check that the patches still apply (also part of `npm test`):

```sh
make check-patches
```

## Changing Emacs sources

1. Edit the file in the copied tree, e.g.
   `build/emacs-pdump-configure-probe/src/src/keyboard.c`, and rebuild.
2. Regenerate the patch from the tree, or add a new numbered patch for a new
   concern.  `make-emacs-patch.sh` writes the difference between
   `vendor/emacs` plus every earlier patch and the edited tree, so several
   patches may touch the same file:

   ```sh
   src/build/make-emacs-patch.sh build/emacs-pdump-configure-probe/src \
     0007-keyboard-honor-read-timeout.patch src/keyboard.c
   ```
3. Run `src/build/apply-emacs-patches.sh --check build/emacs-pdump-configure-probe/src`
   to confirm the tree and the patch layer agree.

Build scripts must never edit `vendor/emacs`.

The VS Code Asyncify lane does not use this layer yet; it still patches its own
copied tree with `tools/scripts/patch-emacs-host-entrypoint-spike.sh`.
