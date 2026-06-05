#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

test -x "${repo_root}/src/build/probe-emacs-pdump-configure.sh"
test -x "${repo_root}/tools/scripts/probe-emacs-pdump-temacs-build.sh"
test -x "${repo_root}/tools/scripts/probe-emacs-pdump-loadup-gc-split.sh"
test -x "${repo_root}/tools/scripts/probe-emacs-pdump-bindings-progress.sh"
test -x "${repo_root}/tools/scripts/probe-emacs-pdump-bindings-defvar-variants.sh"
test -x "${repo_root}/tools/scripts/probe-emacs-pdump-purecopy-trace.sh"
test -x "${repo_root}/tools/scripts/probe-emacs-pdump-bindings-purecopy-markers.sh"
test -x "${repo_root}/tools/scripts/probe-emacs-pdump-purecopy-enabled-trace.sh"

rg 'with-dumping=pdumper' "${repo_root}/src/build/probe-emacs-pdump-configure.sh" >/dev/null
rg 'with-pdumper=yes' "${repo_root}/src/build/probe-emacs-pdump-configure.sh" >/dev/null
rg 'STATUS:PASS pdumper configure completed' "${repo_root}/logs/emacs-pdump-configure-probe.txt" >/dev/null
rg '^DUMPING=pdumper$' "${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump/src/Makefile" >/dev/null
rg '^#define HAVE_PDUMPER 1$' "${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump/src/config.h" >/dev/null

rg 'wasm-side pdumper fingerprint workaround' "${repo_root}/tools/scripts/probe-emacs-pdump-temacs-build.sh" >/dev/null
rg 'missing fingerprint' "${repo_root}/logs/emacs-pdump-temacs-build.txt" >/dev/null
rg 'STATUS:PASS pdumper temacs build completed' "${repo_root}/logs/emacs-pdump-temacs-build.txt" >/dev/null
test -f "${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump/src/temacs"
test -f "${repo_root}/build/emacs-pdump-configure-probe/build-gnu-host-internal-termcap-pdump/src/temacs.wasm"

rg 'Loading bindings \(source\)' "${repo_root}/logs/emacs-pdump-node-dump.txt" >/dev/null
rg 'Loading bindings \(source\)' "${repo_root}/logs/emacs-pdump-node-dump-stackcheck0.txt" >/dev/null
rg 'RESULT:KNOWN_BLOCKER loadup status 139 without after-load GC' "${repo_root}/logs/emacs-pdump-loadup-gc-split.txt" >/dev/null
rg 'wasmacs bindings probe: completed top-level form from line 50' "${repo_root}/logs/emacs-pdump-bindings-progress.txt" >/dev/null
rg 'VARIANT_STATUS:both-map-defvars-nil:255' "${repo_root}/logs/emacs-pdump-bindings-defvar-variants.txt" >/dev/null
rg 'VARIANT_STATUS:both-maps-no-purecopy:255' "${repo_root}/logs/emacs-pdump-bindings-defvar-variants.txt" >/dev/null
rg 'VARIANT_STATUS:map-only:139' "${repo_root}/logs/emacs-pdump-bindings-defvar-variants.txt" >/dev/null
rg 'require pcase' "${repo_root}/logs/emacs-pdump-bindings-defvar-variants.txt" >/dev/null
rg 'RESULT:KNOWN_BLOCKER purecopy trace status 139' "${repo_root}/logs/emacs-pdump-purecopy-trace.txt" >/dev/null
rg 'WASMACS_PURECOPY' "${repo_root}/logs/emacs-pdump-purecopy-trace-run.txt" >/dev/null
rg 'WASMACS_PURE_ALLOC' "${repo_root}/logs/emacs-pdump-purecopy-trace-run.txt" >/dev/null
rg 'VARIANT_STATUS:both-marked:139' "${repo_root}/logs/emacs-pdump-bindings-purecopy-markers.txt" >/dev/null
rg 'VARIANT_STATUS:input-only:139' "${repo_root}/logs/emacs-pdump-bindings-purecopy-markers.txt" >/dev/null
rg 'VARIANT_STATUS:coding-only:139' "${repo_root}/logs/emacs-pdump-bindings-purecopy-markers.txt" >/dev/null
rg 'wasmacs purecopy marker: before input' "${repo_root}/logs/emacs-pdump-bindings-purecopy-markers.txt" >/dev/null
rg 'wasmacs purecopy marker: before input-only' "${repo_root}/logs/emacs-pdump-bindings-purecopy-markers.txt" >/dev/null
rg 'wasmacs purecopy marker: before coding-only' "${repo_root}/logs/emacs-pdump-bindings-purecopy-markers.txt" >/dev/null
! rg -q 'wasmacs purecopy marker: after input' "${repo_root}/logs/emacs-pdump-bindings-purecopy-markers.txt"
! rg -q 'wasmacs purecopy marker: after input-only' "${repo_root}/logs/emacs-pdump-bindings-purecopy-markers.txt"
! rg -q 'wasmacs purecopy marker: after coding-only' "${repo_root}/logs/emacs-pdump-bindings-purecopy-markers.txt"
rg 'RESULT:KNOWN_BLOCKER enabled purecopy trace status 139' "${repo_root}/logs/emacs-pdump-purecopy-enabled-trace.txt" >/dev/null
rg 'wasmacs enabled trace: before input-only purecopy' "${repo_root}/logs/emacs-pdump-purecopy-enabled-trace.txt" >/dev/null
rg 'kind=closure' "${repo_root}/logs/emacs-pdump-purecopy-enabled-trace.txt" >/dev/null
rg 'WASMACS_ENABLED_PURECOPY vector' "${repo_root}/logs/emacs-pdump-purecopy-enabled-trace.txt" >/dev/null
rg 'WASMACS_ENABLED_PURECOPY gethash #[0-9]+ hit=0' "${repo_root}/logs/emacs-pdump-purecopy-enabled-trace.txt" >/dev/null
rg 'WASMACS_ENABLED_PURECOPY gethash #[0-9]+ hit=1' "${repo_root}/logs/emacs-pdump-purecopy-enabled-trace.txt" >/dev/null
rg 'WASMACS_ENABLED_PURECOPY puthash' "${repo_root}/logs/emacs-pdump-purecopy-enabled-trace.txt" >/dev/null

echo "pdump preloaded-state probe validation passed"
