;;; use-package-fetch-sample.el --- wasmacs package fetch smoke -*- lexical-binding: t; -*-

;; Paste/evaluate this in wasmacs after building an artifact that includes
;; `wasmacs-url-fetch.el` and the `wasmacs-os-network-fetch-json` primitive.

(require 'wasmacs-url-fetch)
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
  :defer t
  :config
  (message "wasmacs use-package fetch smoke: rainbow-mode is ready"))

;;; use-package-fetch-sample.el ends here
