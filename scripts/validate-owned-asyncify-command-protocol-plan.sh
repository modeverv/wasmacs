#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
plan="${repo_root}/PLAN.md"
arch="${repo_root}/ARCHITECTURE.md"
doc="${repo_root}/docs/owned-asyncify-command-protocol-plan.md"
substrate_doc="${repo_root}/docs/small-os-substrate-implementation.md"
boundary_doc="${repo_root}/docs/os-compatibility-boundary.md"
small_os="${repo_root}/small-os-for-emacs.md"
substrate_js="${repo_root}/app/src/small-os-services.js"
runtime_js="${repo_root}/app/src/small-os-runtime.js"
main_js="${repo_root}/app/src/main.js"
package_json="${repo_root}/package.json"

test -f "${plan}"
test -f "${arch}"
test -f "${doc}"
test -f "${substrate_doc}"
test -f "${boundary_doc}"
test -f "${small_os}"
test -f "${substrate_js}"
test -f "${runtime_js}"

rg 'Milestone 13\.5: Owned Asyncify Command Protocol And GC Root Safety' "${plan}" >/dev/null
rg 'small-os-for-emacs\.md' "${plan}" >/dev/null
rg 'Active blocker classification under `small-os-for-emacs\.md`' "${plan}" >/dev/null
rg 'Product behavior and diagnostic behavior' "${plan}" >/dev/null
rg 'scripts/validate-owned-asyncify-command-protocol-plan\.sh' "${plan}" >/dev/null
rg 'stack refresh|host entrypoints refresh stack root boundaries' "${plan}" >/dev/null
rg 'pending Asyncify command' "${plan}" >/dev/null
rg 'inhibit_garbage_collection' "${plan}" >/dev/null
rg 'ASYNCIFY_IMPORTS|Asyncify import' "${plan}" >/dev/null
rg 'unavailable:busy' "${plan}" >/dev/null
rg 'file-visiting buffer plus undo-list' "${plan}" >/dev/null
rg 'browser event-loop ownership|worker/browser command protocol' "${plan}" >/dev/null
rg 'garbage-collect' "${plan}" >/dev/null

rg 'host-entrypoint|stack/GC root safety|stack/root safety' "${arch}" >/dev/null
rg 'file-visiting buffer lifetime' "${arch}" >/dev/null
rg 'active minibuffer.*unavailable:busy|unavailable:busy' "${arch}" >/dev/null

rg 'Script Classification' "${doc}" >/dev/null
rg 'Active gates' "${doc}" >/dev/null
rg 'Test tiers' "${doc}" >/dev/null
rg 'Baseline gates' "${doc}" >/dev/null
rg 'Diagnostic probes' "${doc}" >/dev/null
rg 'Known-blocker probes' "${doc}" >/dev/null
rg 'Historical evidence' "${doc}" >/dev/null
rg 'Source-Backed Hazards' "${doc}" >/dev/null
rg 'Stack refresh' "${doc}" >/dev/null
rg 'WASMACS_ENTER_HOST_ENTRYPOINT' "${doc}" >/dev/null
rg 'wasmacs_entrypoint_state' "${doc}" >/dev/null
rg 'Pending-command GC inhibit' "${doc}" >/dev/null
rg 'Asyncify import narrowing' "${doc}" >/dev/null
rg 'Reentrant-call rejection' "${doc}" >/dev/null
rg 'File-visiting undo GC' "${doc}" >/dev/null
rg 'Browser event-loop ownership' "${doc}" >/dev/null
rg 'probe-browser-asyncify-gc-after-completion\.mjs' "${doc}" >/dev/null
rg 'probe-browser-asyncify-file-undo-gc\.mjs' "${doc}" >/dev/null
rg 'mark_specpdl' "${doc}" >/dev/null
rg 'stale backtrace|backtrace argument slots' "${doc}" >/dev/null
rg 'Source-backed boot diagnosis' "${doc}" >/dev/null
rg 'loadup\.el' "${doc}" >/dev/null
rg 'preloaded Emacs Lisp-machine state|post-loadup snapshot' "${doc}" >/dev/null
rg 'cold `loadup\.el`' "${plan}" >/dev/null
rg 'Terminal/Tty Service' "${plan}" >/dev/null
rg 'pdmp-free fake tty|fake tty startup' "${plan}" >/dev/null
rg 'xterm\.js' "${plan}" >/dev/null
rg 'fake tty path fails|source-backed evidence' "${plan}" >/dev/null
rg 'C/wasm facade plan' "${plan}" >/dev/null
rg 'real input waitpoint|command loop to a waitpoint' "${plan}" >/dev/null
rg 'pdumper-specific source memo' "${plan}" >/dev/null
rg 'pdump/preloaded-state probe result' "${plan}" >/dev/null
rg 'pdumper_load' "${plan}" >/dev/null
rg 'dump_mmap_contiguous_heap' "${plan}" >/dev/null
rg 'dump_do_all_emacs_relocations' "${plan}" >/dev/null
rg 'before `initialized`|before-initialized' "${plan}" >/dev/null
rg 'relocation/static-root semantics' "${plan}" >/dev/null
rg 'temacs\.wasm' "${plan}" >/dev/null
rg 'Loading bindings \(source\)' "${plan}" >/dev/null
rg 'STACK_OVERFLOW_CHECK=0' "${plan}" >/dev/null
rg 'pdump `bindings\.el` split' "${plan}" >/dev/null
rg 'mode-line-input-method-map' "${plan}" >/dev/null
rg 'mode-line-coding-system-map' "${plan}" >/dev/null
rg 'purecopying these early mode-line' "${plan}" >/dev/null
rg 'Preloaded-State Service' "${plan}" >/dev/null
rg 'Memory And Root Service' "${plan}" >/dev/null
rg 'Lifecycle Service' "${plan}" >/dev/null
rg 'Filesystem And Persistence Service' "${plan}" >/dev/null
rg 'keymap structures' "${plan}" >/dev/null
rg 'require pcase' "${plan}" >/dev/null

rg 'Small Compatibility OS Layer' "${arch}" >/dev/null
rg 'small-os-for-emacs\.md' "${arch}" >/dev/null
rg 'Product behavior と diagnostic behavior' "${arch}" >/dev/null
rg 'pdump/preloaded-state' "${arch}" >/dev/null
rg 'Preloaded-State' "${arch}" >/dev/null

rg 'Core Invariants' "${small_os}" >/dev/null
rg 'Lifecycle Service' "${small_os}" >/dev/null
rg 'Memory And Root Service' "${small_os}" >/dev/null
rg 'Control-Flow Service' "${small_os}" >/dev/null
rg 'Blocking Input Scheduler' "${small_os}" >/dev/null
rg 'Filesystem And Persistence Service' "${small_os}" >/dev/null
rg 'Preloaded-State Service' "${small_os}" >/dev/null
rg 'Host Capability Service' "${small_os}" >/dev/null
rg 'Browser GUI Boundary' "${small_os}" >/dev/null
rg 'Lifecycle x Memory' "${small_os}" >/dev/null
rg 'Memory x Input Scheduler' "${small_os}" >/dev/null
rg 'Preloaded State x Filesystem' "${small_os}" >/dev/null
rg 'Which service owns this failure' "${small_os}" >/dev/null
rg 'Small OS Substrate Implementation' "${substrate_doc}" >/dev/null
rg 'browser-side mirror, not the low-level owner' "${substrate_doc}" >/dev/null
rg 'C/Wasm Facade Plan' "${substrate_doc}" >/dev/null
rg 'lifecycle-state-facade' "${substrate_doc}" >/dev/null
rg 'entrypoint-root-refresh-facade' "${substrate_doc}" >/dev/null
rg 'gc-permission-facade' "${substrate_doc}" >/dev/null
rg 'pending-command-guard-facade' "${substrate_doc}" >/dev/null
rg 'backtrace-root-ownership-facade' "${substrate_doc}" >/dev/null
rg 'preloaded-state-pdump-facade' "${substrate_doc}" >/dev/null
rg 'segment-root-relocation-facade' "${substrate_doc}" >/dev/null
rg 'wasmacs_os_lifecycle_phase' "${substrate_doc}" >/dev/null
rg 'wasmacs_os_enter_host_entrypoint' "${substrate_doc}" >/dev/null
rg 'wasmacs_os_gc_permission' "${substrate_doc}" >/dev/null
rg 'wasmacs_os_begin_command' "${substrate_doc}" >/dev/null
rg 'wasmacs_os_pin_backtrace_args' "${substrate_doc}" >/dev/null
rg 'wasmacs_os_preloaded_state_load' "${substrate_doc}" >/dev/null
rg 'wasmacs_os_segment_table_snapshot' "${substrate_doc}" >/dev/null
rg 'browser-worker-asyncify-boot' "${substrate_doc}" >/dev/null
rg 'pdump-purecopy-probe' "${substrate_doc}" >/dev/null
rg 'asyncify-backtrace-pin' "${substrate_doc}" >/dev/null
rg 'pending-command-protocol' "${substrate_doc}" >/dev/null
rg 'filesystem-reverse-sync' "${substrate_doc}" >/dev/null
rg 'Product vs Diagnostic Rule' "${substrate_doc}" >/dev/null
rg 'Browser Coordinator' "${substrate_doc}" >/dev/null
rg 'OS Compatibility Boundary' "${boundary_doc}" >/dev/null
rg 'Service Inventory' "${boundary_doc}" >/dev/null
rg 'Current implementation and owner' "${boundary_doc}" >/dev/null
rg 'Current state owner' "${boundary_doc}" >/dev/null
rg 'Desired owner' "${boundary_doc}" >/dev/null
rg 'Ambiguous or Unsafe Ownership' "${boundary_doc}" >/dev/null
rg 'Minimal Facade Candidates' "${boundary_doc}" >/dev/null
rg 'wasmacs_os_lifecycle_state' "${boundary_doc}" >/dev/null
rg 'wasmacs_os_gc_permission_state' "${boundary_doc}" >/dev/null
rg 'wasmacs_os_entrypoint_begin' "${boundary_doc}" >/dev/null
rg 'wasmacs_os_entrypoint_end' "${boundary_doc}" >/dev/null
rg 'wasmacs_os_root_safety_probe' "${boundary_doc}" >/dev/null
rg 'wasmacs_os_stack_bounds_probe' "${boundary_doc}" >/dev/null
rg 'not a success criterion' "${boundary_doc}" >/dev/null
rg 'SmallOsServices' "${substrate_js}" >/dev/null
rg 'LifecyclePhases' "${substrate_js}" >/dev/null
rg 'OwnershipLayers' "${substrate_js}" >/dev/null
rg 'OsCompatibilityBoundaryInventory' "${substrate_js}" >/dev/null
rg 'validateBoundaryInventoryRecord' "${substrate_js}" >/dev/null
rg 'CrossServiceChecks' "${substrate_js}" >/dev/null
rg 'SmallOsFacades' "${substrate_js}" >/dev/null
rg 'FacadeStatus' "${substrate_js}" >/dev/null
rg 'JsRoles' "${substrate_js}" >/dev/null
rg 'validateFacadeContract' "${substrate_js}" >/dev/null
rg 'lifecycleState' "${substrate_js}" >/dev/null
rg 'entrypointRootRefresh' "${substrate_js}" >/dev/null
rg 'gcPermission' "${substrate_js}" >/dev/null
rg 'pendingCommandGuard' "${substrate_js}" >/dev/null
rg 'backtraceRootOwnership' "${substrate_js}" >/dev/null
rg 'preloadedStatePdump' "${substrate_js}" >/dev/null
rg 'segmentRootRelocation' "${substrate_js}" >/dev/null
rg 'SmallOsOperations' "${substrate_js}" >/dev/null
rg 'browserWorkerAsyncifyBoot' "${substrate_js}" >/dev/null
rg 'pdumpPurecopyProbe' "${substrate_js}" >/dev/null
rg 'asyncifyBacktracePin' "${substrate_js}" >/dev/null
rg 'pendingCommandProtocol' "${substrate_js}" >/dev/null
rg 'filesystemReverseSync' "${substrate_js}" >/dev/null
rg 'canRunGc' "${substrate_js}" >/dev/null
rg 'canReverseSync' "${substrate_js}" >/dev/null
rg 'createBrowserSmallOsCoordinator' "${runtime_js}" >/dev/null
rg 'beginCommand' "${runtime_js}" >/dev/null
rg 'enterPendingInput' "${runtime_js}" >/dev/null
rg 'finishCommand' "${runtime_js}" >/dev/null
rg 'assertReverseSyncAllowed' "${runtime_js}" >/dev/null
rg 'pendingWorkerSyncFile' "${main_js}" >/dev/null
rg 'smallOs\.beginCommand' "${main_js}" >/dev/null
rg 'smallOs\.finishCommand' "${main_js}" >/dev/null
rg 'applyWorkerSyncFile' "${main_js}" >/dev/null
rg 'smallOs: smallOs\.snapshot' "${main_js}" >/dev/null
rg 'Browser worker boot split' "${doc}" >/dev/null
rg 'post-loadup/preloaded Emacs Lisp-machine state' "${doc}" >/dev/null
rg 'Pdumper-specific conclusion' "${doc}" >/dev/null
rg 'Current Node-first pdump probe result' "${doc}" >/dev/null
rg 'pdumper_load' "${doc}" >/dev/null
rg 'dump_mmap_contiguous_heap' "${doc}" >/dev/null
rg 'dump_do_all_emacs_relocations' "${doc}" >/dev/null
rg 'before-initialized boot point' "${doc}" >/dev/null
rg 'pdumper-class relocation' "${doc}" >/dev/null
rg 'static-root semantics' "${doc}" >/dev/null
rg 'missing fingerprint' "${doc}" >/dev/null
rg 'temacs\.wasm' "${doc}" >/dev/null
rg 'Loading bindings \(source\)' "${doc}" >/dev/null
rg 'purecopy rather than the load hook' "${doc}" >/dev/null
rg 'mode-line-input-method-map' "${doc}" >/dev/null
rg 'mode-line-coding-system-map' "${doc}" >/dev/null
rg 'compiled-Lisp artifact path' "${doc}" >/dev/null
test -x "${repo_root}/scripts/validate-pdump-preloaded-state-probes.sh"

rg 'validate-owned-asyncify-command-protocol-plan' "${package_json}" >/dev/null
rg '"test:asyncify"' "${package_json}" >/dev/null
rg '"test:persistent"' "${package_json}" >/dev/null
rg '"test:known-blockers"' "${package_json}" >/dev/null
rg '"test:heavy"' "${package_json}" >/dev/null

rg 'WASMACS_ENTER_HOST_ENTRYPOINT' "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh" >/dev/null
rg 'WASMACS_LEAVE_HOST_ENTRYPOINT' "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh" >/dev/null
rg 'wasmacs_entrypoint_state' "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh" >/dev/null
rg 'wasmacs_os_lifecycle_phase' "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh" >/dev/null
rg 'wasmacs_os_lifecycle_state' "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh" >/dev/null
rg 'wasmacs_os_root_state_snapshot' "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh" >/dev/null
rg 'wasmacs_os_stack_bounds_probe' "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh" >/dev/null
rg 'wasmacs_os_gc_permission' "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh" >/dev/null
rg 'wasmacs_os_gc_permission_state' "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh" >/dev/null
rg 'wasmacs_os_root_safety_probe' "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh" >/dev/null
rg 'wasmacs_os_pending_command_state' "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh" >/dev/null
rg '_wasmacs_entrypoint_state' "${repo_root}/scripts/build-emacs-browser-persistent-spike.sh" >/dev/null
rg '_wasmacs_os_lifecycle_phase' "${repo_root}/scripts/build-emacs-browser-persistent-spike.sh" >/dev/null
rg '_wasmacs_os_lifecycle_state' "${repo_root}/scripts/build-emacs-browser-persistent-spike.sh" >/dev/null
rg '_wasmacs_os_root_state_snapshot' "${repo_root}/scripts/build-emacs-browser-persistent-spike.sh" >/dev/null
rg '_wasmacs_os_stack_bounds_probe' "${repo_root}/scripts/build-emacs-browser-persistent-spike.sh" >/dev/null
rg '_wasmacs_os_gc_permission' "${repo_root}/scripts/build-emacs-browser-persistent-spike.sh" >/dev/null
rg '_wasmacs_os_gc_permission_state' "${repo_root}/scripts/build-emacs-browser-persistent-spike.sh" >/dev/null
rg '_wasmacs_os_root_safety_probe' "${repo_root}/scripts/build-emacs-browser-persistent-spike.sh" >/dev/null
rg '_wasmacs_os_pending_command_state' "${repo_root}/scripts/build-emacs-browser-persistent-spike.sh" >/dev/null
rg '_wasmacs_entrypoint_state' "${repo_root}/scripts/build-emacs-browser-asyncify-spike.sh" >/dev/null
rg '_wasmacs_os_lifecycle_phase' "${repo_root}/scripts/build-emacs-browser-asyncify-spike.sh" >/dev/null
rg '_wasmacs_os_lifecycle_state' "${repo_root}/scripts/build-emacs-browser-asyncify-spike.sh" >/dev/null
rg '_wasmacs_os_root_state_snapshot' "${repo_root}/scripts/build-emacs-browser-asyncify-spike.sh" >/dev/null
rg '_wasmacs_os_stack_bounds_probe' "${repo_root}/scripts/build-emacs-browser-asyncify-spike.sh" >/dev/null
rg '_wasmacs_os_gc_permission' "${repo_root}/scripts/build-emacs-browser-asyncify-spike.sh" >/dev/null
rg '_wasmacs_os_gc_permission_state' "${repo_root}/scripts/build-emacs-browser-asyncify-spike.sh" >/dev/null
rg '_wasmacs_os_root_safety_probe' "${repo_root}/scripts/build-emacs-browser-asyncify-spike.sh" >/dev/null
rg '_wasmacs_os_pending_command_state' "${repo_root}/scripts/build-emacs-browser-asyncify-spike.sh" >/dev/null

test -x "${repo_root}/scripts/validate-minibuffer-asyncify-entrypoint-plan.sh"
test -f "${repo_root}/scripts/probe-browser-os-diagnostic-facade.mjs"
test -f "${repo_root}/scripts/probe-browser-os-resume-memory-root.mjs"
test -f "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs"
test -f "${repo_root}/scripts/probe-asyncify-import-contract.mjs"
test -f "${repo_root}/tests/fixtures/asyncify-import-contract.c"
test -f "${repo_root}/tests/fixtures/asyncify-import-contract-library.js"
rg 'after-boot' "${repo_root}/scripts/probe-browser-os-resume-memory-root.mjs" >/dev/null
rg 'pending-input' "${repo_root}/scripts/probe-browser-os-resume-memory-root.mjs" >/dev/null
rg 'after-input-injection-before-resume' "${repo_root}/scripts/probe-browser-os-resume-memory-root.mjs" >/dev/null
rg 'after-resume' "${repo_root}/scripts/probe-browser-os-resume-memory-root.mjs" >/dev/null
rg 'after-explicit-gc' "${repo_root}/scripts/probe-browser-os-resume-memory-root.mjs" >/dev/null
rg 'wasmacs_os_lifecycle_state' "${repo_root}/scripts/probe-browser-os-resume-memory-root.mjs" >/dev/null
rg 'wasmacs_os_stack_bounds_probe' "${repo_root}/scripts/probe-browser-os-resume-memory-root.mjs" >/dev/null
rg 'wasmacs_os_gc_permission_state' "${repo_root}/scripts/probe-browser-os-resume-memory-root.mjs" >/dev/null
rg 'wasmacs_os_root_safety_probe' "${repo_root}/scripts/probe-browser-os-resume-memory-root.mjs" >/dev/null
rg 'test:os-resume-memory-root' "${package_json}" >/dev/null
rg 'before-tty-read' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'before-input-queue' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'after-input-queue-before-resolve' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'before-wait-resolver-call' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'after-wait-resolve-before-resume' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'after-next-wait' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'queuedPreview' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'promiseIdentity' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'jsImportPromiseCreated' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'jsImportPromiseReturned' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'jsImportResolverBound' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'jsImportHandleAsyncEnter' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'WASMACS_WAIT_IMPORT_MODE' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'async-wrapper' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'handleAsync' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'host_wait_manual_promise,host_wait_async_wrapper,host_wait_handle_async' "${repo_root}/scripts/probe-asyncify-import-contract.mjs" >/dev/null
rg 'host_wait_manual_promise' "${repo_root}/tests/fixtures/asyncify-import-contract-library.js" >/dev/null
rg 'host_wait_async_wrapper' "${repo_root}/tests/fixtures/asyncify-import-contract-library.js" >/dev/null
rg 'host_wait_handle_async' "${repo_root}/tests/fixtures/asyncify-import-contract-library.js" >/dev/null
rg 'Asyncify\.handleAsync' "${repo_root}/tests/fixtures/asyncify-import-contract-library.js" >/dev/null
rg 'js-import-promise-created' "${repo_root}/scripts/wasmacs-asyncify-host-library.js" >/dev/null
rg 'js-import-promise-return-expression' "${repo_root}/scripts/wasmacs-asyncify-host-library.js" >/dev/null
rg 'js-import-resolver-bound' "${repo_root}/scripts/wasmacs-asyncify-host-library.js" >/dev/null
rg 'js-import-handleasync-enter' "${repo_root}/scripts/wasmacs-asyncify-host-library.js" >/dev/null
rg 'js-import-handleasync-promise-created' "${repo_root}/scripts/wasmacs-asyncify-host-library.js" >/dev/null
rg 'js-import-handleasync-returning' "${repo_root}/scripts/wasmacs-asyncify-host-library.js" >/dev/null
rg 'Asyncify\.handleAsync' "${repo_root}/scripts/wasmacs-asyncify-host-library.js" >/dev/null
rg 'WASMACS_WAIT_IMPORT_MODE' "${repo_root}/scripts/wasmacs-asyncify-host-library.js" >/dev/null
rg '__wasmacsWaitPromiseState' "${repo_root}/scripts/wasmacs-asyncify-host-library.js" >/dev/null
rg 'ASYNCIFY_IMPORTS=wasmacs_host_wait_for_input' "${repo_root}/scripts/build-emacs-browser-asyncify-spike.sh" >/dev/null
rg 'ASYNCIFY_IMPORTS=wasmacs_host_wait_for_input' "${repo_root}/scripts/build-emacs-browser-interactive.sh" >/dev/null
rg 'ASYNCIFY_IMPORTS=wasmacs_host_wait_for_input' "${repo_root}/scripts/build-emacs-browser-asyncify-pdump.sh" >/dev/null
rg 'test:asyncify-import-contract' "${package_json}" >/dev/null
rg 'lastResolvedWaitId' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'repeatedWaitCount' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'jsImportResolveAfter' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'jsImportPromiseThen' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'cSysdepAfterWaitReturn' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'jsTerminalReadByteDequeue' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'cKeyboardReadCharReached' "${repo_root}/scripts/probe-browser-blocking-input-scheduler.mjs" >/dev/null
rg 'wasmacs_host_scheduler_checkpoint' "${repo_root}/scripts/wasmacs-asyncify-host-library.js" >/dev/null
rg 'c-keyboard-read-char-reached' "${repo_root}/scripts/wasmacs-asyncify-host-library.js" >/dev/null
rg 'wasmacs_host_scheduler_checkpoint \(200\)' "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh" >/dev/null
rg 'wasmacs_host_scheduler_checkpoint \(101\)' "${repo_root}/scripts/patch-emacs-host-entrypoint-spike.sh" >/dev/null
rg 'test:blocking-input-scheduler' "${package_json}" >/dev/null
test -f "${repo_root}/scripts/probe-browser-asyncify-gc-after-completion.mjs"
test -f "${repo_root}/scripts/probe-browser-asyncify-minibuffer-input-injection.mjs"
test -f "${repo_root}/scripts/probe-browser-asyncify-minibuffer-cancel.mjs"
test -f "${repo_root}/scripts/probe-browser-visited-file-cross-eval.mjs"
test -f "${repo_root}/scripts/probe-browser-file-buffer-gc-roots.mjs"

echo "owned asyncify command protocol plan validation passed"
