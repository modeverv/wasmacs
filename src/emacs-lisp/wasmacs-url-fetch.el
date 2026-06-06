;;; url-fetch.el --- Fetch-backed URL loader for wasmacs -*- lexical-binding: t; -*-

;; This file is part of wasmacs.

;;; Commentary:

;; Register a narrow HTTP(S) loader for Emacs' url.el stack.  The host supplies
;; `wasmacs-url-fetch-function', which returns a complete HTTP response as data
;; rather than exposing `make-network-process' or raw sockets.

;;; Code:

(require 'url-methods)
(require 'url-parse)
(require 'url-vars)
(require 'json)

(defvar url-request-data)
(defvar url-request-extra-headers)
(defvar url-request-method)
(defvar url-current-object)
(defvar url-http-response-status)

(declare-function wasmacs-os-network-fetch-json nil (request-json))

(defvar wasmacs-url-fetch-function nil
  "Function used by `wasmacs-url-fetch' to retrieve HTTP(S) URLs.

The function is called with a plist containing `:url', `:method',
`:headers', and `:body'.  It must return a plist containing `:status',
`:status-text', `:headers', `:body', and optionally `:url'.  The body must be a
unibyte string or a byte vector.")

(defvar wasmacs-url-fetch-allowed-schemes '("http" "https")
  "URL schemes handled by the wasmacs fetch-backed loader.")

(defconst wasmacs-url-http-asynchronous-p nil
  "wasmacs fetch-backed HTTP(S) retrievals complete before returning.")

(defconst wasmacs-url-http-default-port 80)
(defconst wasmacs-url-https-default-port 443)

(defalias 'wasmacs-url-http-expand-file-name #'url-default-expander)
(defalias 'wasmacs-url-https-expand-file-name #'url-default-expander)

(defun wasmacs-url-fetch--string-bytes (value)
  "Return VALUE as a unibyte string."
  (cond
   ((stringp value)
    (if (multibyte-string-p value)
        (encode-coding-string value 'utf-8 t)
      value))
   ((vectorp value)
    (let ((string (make-string (length value) 0)))
      (dotimes (index (length value))
        (aset string index (logand (aref value index) #xff)))
      string))
   ((null value) "")
   (t (error "Unsupported wasmacs fetch body: %S" (type-of value)))))

(defun wasmacs-url-fetch--header-lines (headers)
  "Return HEADERS as CRLF-terminated HTTP header lines."
  (mapconcat
   (lambda (header)
     (let ((name (cond
                  ((plist-get header :name) (plist-get header :name))
                  ((consp header) (car header))
                  (t "")))
           (value (cond
                   ((plist-member header :value) (plist-get header :value))
                   ((consp header) (cdr header))
                   (t ""))))
       (format "%s: %s" name value)))
   headers
   "\r\n"))

(defun wasmacs-url-fetch--host-fetch (request)
  "Fetch REQUEST through the wasm host network primitive."
  (unless (fboundp 'wasmacs-os-network-fetch-json)
    (error "wasmacs-os-network-fetch-json is not available"))
  (let* ((json-request (json-serialize request))
         (json-response (wasmacs-os-network-fetch-json json-request))
         (response (json-parse-string json-response
                                      :object-type 'plist
                                      :array-type 'list
                                      :null-object nil
                                      :false-object nil))
         (error-message (plist-get response :error)))
    (when error-message
      (error "wasmacs host network fetch failed: %s" error-message))
    (when-let ((body-base64 (plist-get response :body-base64)))
      (setq response (plist-put response :body
                                (base64-decode-string body-base64))))
    response))

(defun wasmacs-url-fetch--request-headers ()
  "Return request headers from dynamically bound url.el variables."
  (let ((headers nil))
    (dolist (header url-request-extra-headers)
      (when (consp header)
        (push (cons (format "%s" (car header)) (format "%s" (cdr header)))
              headers)))
    (nreverse headers)))

(defun wasmacs-url-fetch--response-buffer (url response)
  "Create a url.el response buffer for URL from RESPONSE plist."
  (let* ((status (or (plist-get response :status) 200))
         (status-text (or (plist-get response :status-text) "OK"))
         (headers (or (plist-get response :headers) nil))
         (body (wasmacs-url-fetch--string-bytes (plist-get response :body)))
         (buffer (generate-new-buffer (format " *wasmacs-url-%s*" (url-host url)))))
    (with-current-buffer buffer
      (set-buffer-multibyte nil)
      (setq-local url-current-object url)
      (setq-local url-http-response-status status)
      (insert (format "HTTP/1.1 %d %s\r\n" status status-text))
      (let ((header-lines (wasmacs-url-fetch--header-lines headers)))
        (unless (string-empty-p header-lines)
          (insert header-lines "\r\n")))
      (insert "\r\n")
      (insert body)
      (goto-char (point-min)))
    buffer))

(defun wasmacs-url-fetch (url &optional callback cbargs)
  "Load URL through the wasmacs host fetch capability.
CALLBACK and CBARGS follow `url-retrieve' loader conventions."
  (unless (member (url-type url) wasmacs-url-fetch-allowed-schemes)
    (error "wasmacs fetch loader does not handle scheme: %s" (url-type url)))
  (unless (functionp wasmacs-url-fetch-function)
    (setq wasmacs-url-fetch-function #'wasmacs-url-fetch--host-fetch))
  (let* ((request (list :url (url-recreate-url url)
                        :method (or url-request-method "GET")
                        :headers (wasmacs-url-fetch--request-headers)
                        :body url-request-data))
         (response (funcall wasmacs-url-fetch-function request))
         (buffer (wasmacs-url-fetch--response-buffer url response)))
    (when callback
      (with-current-buffer buffer
        (apply callback (or (car cbargs) nil) (cdr cbargs))))
    buffer))

(defun wasmacs-url-fetch-enable ()
  "Route url.el HTTP(S) retrieval through `wasmacs-url-fetch'."
  (puthash "http"
           (list 'name "http"
                 'loader #'wasmacs-url-fetch
                 'asynchronous-p wasmacs-url-http-asynchronous-p
                 'default-port wasmacs-url-http-default-port
                 'expand-file-name #'wasmacs-url-http-expand-file-name
                 'parse-url #'url-generic-parse-url)
           url-scheme-registry)
  (puthash "https"
           (list 'name "https"
                 'loader #'wasmacs-url-fetch
                 'asynchronous-p wasmacs-url-http-asynchronous-p
                 'default-port wasmacs-url-https-default-port
                 'expand-file-name #'wasmacs-url-https-expand-file-name
                 'parse-url #'url-generic-parse-url)
           url-scheme-registry))

(provide 'wasmacs-url-fetch)

;;; url-fetch.el ends here
