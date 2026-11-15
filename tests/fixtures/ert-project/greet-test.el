;;; greet-test.el --- its tests  -*- lexical-binding: t; -*-
(require 'ert)
(require 'greet)
(ert-deftest greet-says-hello () (should (equal (greet "page") "hello page")))
(ert-deftest greet-in-emacs-30 () (should (equal emacs-version "30.2")))
(ert-deftest greet-fails () :tags '(failing) (should (equal (greet "x") "bye")))
