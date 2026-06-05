# C Patch Layer

`vendor/emacs` stays read-only. Wasmacs C-side changes live as unified diff
patches in `src/c/patches/` and are applied to a copied Emacs tree under
`build/`.

Use:

```sh
make prepare
```

The default prepared tree is:

```text
build/emacs-30.2-patched/src
```

Build scripts should consume this copied tree or their own copied tree, never
edit `vendor/emacs` directly.
