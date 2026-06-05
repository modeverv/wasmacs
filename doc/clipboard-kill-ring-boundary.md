# Clipboard And Kill Ring Boundary

Milestone 13 treats clipboard commands as explicit protocol boundaries, not as
browser-side editor behavior.

## Source Grounding

GNU Emacs keeps clipboard integration and kill-ring semantics separate:

- `vendor/emacs/lisp/simple.el` defines `kill-ring`,
  `kill-ring-yank-pointer`, `interprogram-cut-function`,
  `interprogram-paste-function`, `kill-new`, and `current-kill`.
- `vendor/emacs/lisp/select.el` connects GUI selection and clipboard state via
  `gui-select-text`, `gui-selection-value`, and `gui-get-selection`.
- `ARCHITECTURE.md` keeps GUI clipboard messages in the GUI protocol, separate
  from filesystem host calls.

## MVP Decision

The browser host may receive `C-y`, `C-w`, and `M-w`, but the MVP must not fake
Emacs kill-ring state in JavaScript. A correct implementation needs:

- persistent Emacs buffers rather than per-command temp buffers
- mark/region state
- an explicit `clipboard.paste` / `clipboard.write` GUI protocol
- interprogram cut/paste functions wired to the browser clipboard adapter

Until those are present, the worker reports:

```text
clipboard/kill-ring requires GUI clipboard protocol plus persistent region and kill-ring state
```

That makes clipboard failure explicit while preserving the rule that editor
semantics stay in Emacs, not in the browser DOM.
