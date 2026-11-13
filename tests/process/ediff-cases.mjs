// Shared acceptance cases for the real Emacs Lisp Ediff implementation. These
// do not substitute an Elisp diff implementation or mock the subprocesses.
export const fixtureContents = {
  "/tmp/ediff-A.txt": "start\nred\nmid\none\ntail\n",
  "/tmp/ediff-B.txt": "start\nblue\nmid\ntwo\ntail\n",
  "/tmp/ediff-C.txt": "start\ngreen\nmid\nthree\ntail\n",
  "/tmp/merge-base.txt": "head\nbase-one\nmiddle-one\nbase-two\nmiddle-two\nbase-conflict\ntail\n",
  "/tmp/merge-A.txt": "head\nA-only\nmiddle-one\nbase-two\nmiddle-two\nA-conflict\ntail\n",
  "/tmp/merge-B.txt": "head\nbase-one\nmiddle-one\nB-only\nmiddle-two\nB-conflict\ntail\n",
  "/tmp/merge-clean-A.txt": "head\nA-only\nmiddle-one\nbase-two\nmiddle-two\nbase-conflict\ntail\n",
  "/tmp/merge-clean-B.txt": "head\nbase-one\nmiddle-one\nB-only\nmiddle-two\nbase-conflict\ntail\n",
};

export function prepareEdiffFixtures(emacs) {
  for (const [path, text] of Object.entries(fixtureContents)) emacs.FS.writeFile(path, text);
}

export const ediffSetup = `(require 'ediff)
  (setq ediff-keep-variants t ediff-quit-merge-hook nil)
  (defun wasmacs-ediff-buffer (name file)
    (with-current-buffer (get-buffer-create name)
      (let ((inhibit-read-only t)) (erase-buffer) (insert-file-contents file))
      (set-buffer-modified-p nil) (current-buffer)))`;

export const twoWayForm = `(progn ${ediffSetup}
  (let* ((a (wasmacs-ediff-buffer "*ediff-test-A*" "/tmp/ediff-A.txt"))
         (b (wasmacs-ediff-buffer "*ediff-test-B*" "/tmp/ediff-B.txt"))
         (ctl (ediff-buffers a b)))
    (with-current-buffer ctl
      (let ((count ediff-number-of-differences) first second before after)
        (ediff-next-difference)
        (setq first ediff-current-difference
              before (list (ediff-get-region-contents first 'A ctl)
                           (ediff-get-region-contents first 'B ctl)))
        (ediff-copy-A-to-B nil)
        (setq after (with-current-buffer b (buffer-string)))
        (ediff-next-difference)
        (setq second ediff-current-difference)
        (ediff-copy-A-to-B nil)
        (prog1 (list count first second before after
                     (equal (with-current-buffer a (buffer-string))
                            (with-current-buffer b (buffer-string))))
          (ediff-really-quit nil))))))`;

export const threeWayForm = `(progn ${ediffSetup}
  (let* ((a (wasmacs-ediff-buffer "*ediff-test-A*" "/tmp/ediff-A.txt"))
         (b (wasmacs-ediff-buffer "*ediff-test-B*" "/tmp/ediff-B.txt"))
         (c (wasmacs-ediff-buffer "*ediff-test-C*" "/tmp/ediff-C.txt"))
         (ctl (ediff-buffers3 a b c)))
    (with-current-buffer ctl
      (ediff-next-difference)
      (let ((count ediff-number-of-differences)
            (three (and ediff-3way-comparison-job t))
            (regions (mapcar (lambda (type) (ediff-get-region-contents 0 type ctl)) '(A B C))))
        (ediff-next-difference)
        (prog1 (list count three regions ediff-current-difference)
          (ediff-really-quit nil))))))`;

export const mergeForm = `(progn ${ediffSetup}
  (let* ((a (wasmacs-ediff-buffer "*merge-test-A*" "/tmp/merge-A.txt"))
         (b (wasmacs-ediff-buffer "*merge-test-B*" "/tmp/merge-B.txt"))
         (base (wasmacs-ediff-buffer "*merge-test-base*" "/tmp/merge-base.txt"))
         (ctl (ediff-merge-buffers-with-ancestor a b base)))
    (with-current-buffer ctl
      (let ((count ediff-number-of-differences)
            (states (mapcar (lambda (n) (ediff-get-state-of-merge n)) (number-sequence 0 (1- ediff-number-of-differences))))
            (before (with-current-buffer ediff-buffer-C (buffer-string))))
        (setq ediff-show-clashes-only t)
        (ediff-next-difference)
        (let ((conflict ediff-current-difference))
          (ediff-copy-B-to-C nil)
          (prog1 (list count states conflict
                       (and (string-match-p "<<<<<<< variant A" before) t)
                       (with-current-buffer ediff-buffer-C (buffer-string)))
            (ediff-really-quit nil)))))))`;

export const cleanMergeForm = `(progn ${ediffSetup}
  (let* ((a (wasmacs-ediff-buffer "*merge-clean-A*" "/tmp/merge-clean-A.txt"))
         (b (wasmacs-ediff-buffer "*merge-clean-B*" "/tmp/merge-clean-B.txt"))
         (base (wasmacs-ediff-buffer "*merge-clean-base*" "/tmp/merge-base.txt"))
         (ctl (ediff-merge-buffers-with-ancestor a b base)))
    (with-current-buffer ctl
      (prog1 (list ediff-number-of-differences
                   (with-current-buffer ediff-buffer-C (buffer-string)))
        (ediff-really-quit nil)))))`;

export const ediffCases = [
  {
    name: "Ediff two-way regions, next-difference and A-to-B copying",
    form: twoWayForm,
    expected: '(2 0 1 ("red\n" "blue\n") "start\nred\nmid\ntwo\ntail\n" t)',
  },
  {
    name: "Ediff three-way comparison parses diff3 regions",
    form: threeWayForm,
    expected: '(2 t ("red\n" "blue\n" "green\n") 1)',
  },
  {
    name: "Ediff ancestor merge combines independent changes and resolves a conflict",
    form: mergeForm,
    expected: '(3 ("prefer-A" "prefer-B" "combined") 2 t "head\nA-only\nmiddle-one\nB-only\nmiddle-two\nB-conflict\ntail\n")',
  },
  {
    name: "Ediff ancestor merge automatically combines non-conflicting changes",
    form: cleanMergeForm,
    expected: '(2 "head\nA-only\nmiddle-one\nB-only\nmiddle-two\nbase-conflict\ntail\n")',
  },
];
