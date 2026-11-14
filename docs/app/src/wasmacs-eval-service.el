;;; wasmacs-eval-service.el --- evaluate Lisp for a JavaScript host  -*- lexical-binding: t; -*-

;; The Lisp half of the wasmacs eval service (emacs-eval-core.js).  The host
;; hands over Lisp source or a function call and gets one JSON document back:
;;
;;   {"ok": true,  "value": ...}
;;   {"ok": false, "error": {"symbol": "void-variable",
;;                           "message": "Symbol's value as variable is void: x",
;;                           "data": "(void-variable x)"}}
;;
;; Values cross the boundary as JSON, with Emacs's own conventions
;; (`json-serialize', `json-parse-string'):
;;
;;   Lisp -> JSON   plist with keyword keys, alist or hash table -> object;
;;                  vector -> array; string, number -> the same;
;;                  t -> true; :false -> false; nil -> null
;;   JSON -> Lisp   object -> plist with keyword keys; array -> vector;
;;                  true -> t; false and null -> nil
;;
;; A Lisp list is not an array: return a vector (`vconcat').

;;; Code:

(defun wasmacs-eval-service--reply (reply)
  (json-serialize reply :null-object nil :false-object :false))

(defun wasmacs-eval-service--error (err)
  (list :ok :false
        :error (list :symbol (symbol-name (car err))
                     :message (error-message-string err)
                     :data (prin1-to-string err))))

(defun wasmacs-eval-service--value (value format)
  "VALUE as it is put into the reply: JSON data, or its printed form."
  (if (eq format 'lisp)
      (prin1-to-string value)
    ;; Fail here, with the value in the error, rather than in the reply.
    (condition-case nil
        (wasmacs-eval-service--reply value)
      (error (signal 'wasmacs-eval-service-not-json (list (prin1-to-string value)))))
    value))

(define-error 'wasmacs-eval-service-not-json
  "Value cannot be returned as JSON (use a vector, a plist with keyword keys, or the lisp format)")

(defun wasmacs-eval-service--eval-source (source)
  "Evaluate every form in SOURCE; return the value of the last one."
  (with-temp-buffer
    (insert source)
    (goto-char (point-min))
    (let ((value nil))
      (with-syntax-table emacs-lisp-mode-syntax-table
        (while (progn (forward-comment (buffer-size)) (not (eobp)))
          (setq value (eval (read (current-buffer)) t))))
      value)))

(defun wasmacs-eval-service-eval (source format)
  "Evaluate the forms in the string SOURCE, with lexical binding.
The reply carries the value of the last form: as JSON data when FORMAT is
`json', as its printed representation (a string) when it is `lisp'."
  (wasmacs-eval-service--reply
   (condition-case err
       (list :ok t
             :value (wasmacs-eval-service--value (wasmacs-eval-service--eval-source source)
                                                 format))
     (error (wasmacs-eval-service--error err)))))

(defun wasmacs-eval-service-call (function arguments format)
  "Call the function named FUNCTION with ARGUMENTS, a JSON array (a string)."
  (wasmacs-eval-service--reply
   (condition-case err
       (list :ok t
             :value (wasmacs-eval-service--value
                     (apply (intern function)
                            (append (json-parse-string arguments :object-type 'plist
                                                       :null-object nil :false-object nil)
                                    nil))
                     format))
     (error (wasmacs-eval-service--error err)))))

(provide 'wasmacs-eval-service)
;;; wasmacs-eval-service.el ends here
