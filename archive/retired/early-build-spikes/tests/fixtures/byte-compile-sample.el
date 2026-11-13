;;; byte-compile-sample.el --- Minimal fixture for byte-compile checks -*- lexical-binding: t; -*-

;; This file is part of wasmacs.

;;; Commentary:

;; A tiny, dependency-free library used to confirm that wasmacs can
;; byte-compile an .el file with `byte-compile-file' and then load and run
;; the resulting .elc with `load'.
;;
;; Manual check inside the running Emacs (xterm-atomics-pdump.html):
;;
;;   M-x byte-compile-file RET /path/to/byte-compile-sample.el RET
;;   M-: (load "/path/to/byte-compile-sample") RET
;;   M-: (wasmacs-byte-compile-sample-add 1 2) RET   => 3
;;   M-: (wasmacs-byte-compile-sample-marker) RET    => "byte-compile-sample-elc"
;;
;; `byte-compile-file' writes byte-compile-sample.elc next to the .el file.
;; `load' prefers the .elc when both are present and up to date, so the
;; marker string distinguishes a byte-compiled load from a source load.

;;; Code:

(defun wasmacs-byte-compile-sample-add (a b)
  "Return the sum of A and B."
  (+ a b))

(defvar wasmacs-byte-compile-sample--load-file-name load-file-name
  "Value of `load-file-name' captured while this file was being loaded.

`load-file-name' is only bound during `load' itself, so it must be
captured into a variable here at top level; reading it later from
inside a function would always see nil.")

(defun wasmacs-byte-compile-sample-marker ()
  "Return a string identifying how this file was loaded.

Returns \"byte-compile-sample-elc\" when the .elc was loaded and
\"byte-compile-sample-el\" when the .el source was loaded directly."
  (if (and wasmacs-byte-compile-sample--load-file-name
           (string-suffix-p ".elc" wasmacs-byte-compile-sample--load-file-name))
      "byte-compile-sample-elc"
    "byte-compile-sample-el"))

(provide 'byte-compile-sample)

;;; byte-compile-sample.el ends here
