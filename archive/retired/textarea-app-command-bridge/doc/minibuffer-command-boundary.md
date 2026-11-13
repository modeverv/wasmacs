# Minibuffer Command Boundary

Milestone 13 recognizes minibuffer-oriented key sequences without pretending
that the browser DOM owns the minibuffer.

## Source Grounding

Relevant GNU Emacs surfaces:

- `vendor/emacs/lisp/files.el` defines `find-file` and routes file prompts
  through minibuffer readers such as `read-file-name`.
- `vendor/emacs/lisp/window.el` / `vendor/emacs/lisp/simple.el` use
  `switch-to-buffer`, `read-buffer`, `completing-read`, and
  `read-from-minibuffer` for buffer selection and completion flows.
- `vendor/emacs/src/minibuf.c` owns the C-side minibuffer primitives that make
  the Lisp readers work.

## MVP Decision

The browser input protocol recognizes:

```text
C-x C-f -> find-file
C-x b   -> switch-buffer
```

For now both commands report:

```text
minibuffer requires persistent Emacs command loop, minibuffer window state, and completion UI
```

This keeps `find-file` and `switch-buffer` in the Emacs command/minibuffer
world. The browser path can expose a temporary path field and file list for
M13 editing, but it must not become the semantic owner of Emacs minibuffer
behavior.

## Browser Echo Slice

The browser now includes a narrow `#minibuffer` echo line below the frame grid.
It displays command prefixes such as `C-x` and explicit unavailable messages
from the worker, but it does not read input, complete paths, keep minibuffer
history, or own `find-file` / `switch-buffer` semantics.

That split is deliberate: the line is a display surface for Emacs-facing
state, while real minibuffer behavior remains blocked on a persistent Emacs
command loop, selected-window state, minibuffer buffer/window state, and a
completion UI bridge.

The follow-on contract for that bridge is in
`doc/minibuffer-command-loop-plan.md`.
