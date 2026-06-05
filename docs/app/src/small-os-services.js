export const SmallOsServices = Object.freeze({
  lifecycle: "lifecycle",
  memoryRoot: "memory-root",
  controlFlow: "control-flow",
  blockingInputScheduler: "blocking-input-scheduler",
  filesystemPersistence: "filesystem-persistence",
  preloadedState: "preloaded-state",
  terminalTty: "terminal-tty",
  hostCapability: "host-capability",
  browserGuiBoundary: "browser-gui-boundary",
});

export const LifecyclePhases = Object.freeze({
  uninitialized: "uninitialized",
  coldLoadup: "cold-loadup",
  preloadedStateGenerating: "preloaded-state-generating",
  preloadedStateLoading: "preloaded-state-loading",
  initialized: "initialized",
  commandRunning: "command-running",
  pendingInput: "pending-input",
  shuttingDown: "shutting-down",
  dead: "dead",
});

export const BehaviorTreatment = Object.freeze({
  product: "product",
  diagnostic: "diagnostic",
});

export const CrossServiceChecks = Object.freeze({
  lifecycleMemory: "Lifecycle x Memory",
  memoryInputScheduler: "Memory x Input Scheduler",
  inputSchedulerControlFlow: "Input Scheduler x Control Flow",
  filesystemCommandLifecycle: "Filesystem x Command Lifecycle",
  preloadedStateFilesystem: "Preloaded State x Filesystem",
  terminalLifecycle: "Terminal x Lifecycle",
  terminalInputScheduler: "Terminal x Input Scheduler",
  terminalBrowserGui: "Terminal x Browser GUI",
  hostCapabilityBrowserGui: "Host Capability x Browser GUI",
});

export const EmacsSourceSurfaces = Object.freeze({
  loadup: "vendor/emacs/lisp/loadup.el",
  emacs: "vendor/emacs/src/emacs.c",
  pdumper: "vendor/emacs/src/pdumper.c",
  makefile: "vendor/emacs/src/Makefile.in",
  alloc: "vendor/emacs/src/alloc.c",
  thread: "vendor/emacs/src/thread.c",
  eval: "vendor/emacs/src/eval.c",
  lisp: "vendor/emacs/src/lisp.h",
  puresize: "vendor/emacs/src/puresize.h",
  keyboard: "vendor/emacs/src/keyboard.c",
  dispnew: "vendor/emacs/src/dispnew.c",
  term: "vendor/emacs/src/term.c",
  minibuf: "vendor/emacs/src/minibuf.c",
  callint: "vendor/emacs/src/callint.c",
  minibufferEl: "vendor/emacs/lisp/minibuffer.el",
  fileio: "vendor/emacs/src/fileio.c",
  diredC: "vendor/emacs/src/dired.c",
  buffer: "vendor/emacs/src/buffer.c",
  filesEl: "vendor/emacs/lisp/files.el",
  diredEl: "vendor/emacs/lisp/dired.el",
  lsLispEl: "vendor/emacs/lisp/ls-lisp.el",
  insdel: "vendor/emacs/src/insdel.c",
  bindingsEl: "vendor/emacs/lisp/bindings.el",
  process: "vendor/emacs/src/process.c",
  callproc: "vendor/emacs/src/callproc.c",
  sysdep: "vendor/emacs/src/sysdep.c",
  xdisp: "vendor/emacs/src/xdisp.c",
  window: "vendor/emacs/src/window.c",
});

export const FacadeStatus = Object.freeze({
  productScaffold: "product-scaffold",
  diagnostic: "diagnostic",
  placeholder: "placeholder",
});

export const JsRoles = Object.freeze({
  observer: "observer",
  hostCapabilityProvider: "host-capability-provider",
  browserCoordinator: "browser-coordinator",
  diagnosticHarness: "diagnostic-harness",
});

export const OwnershipLayers = Object.freeze({
  emacsC: "Emacs C core",
  cWasmFacade: "C/wasm facade",
  emscriptenRuntime: "Emscripten runtime",
  jsWorker: "JS worker",
  browserMain: "browser main thread",
  appUi: "app UI",
});

export const BoundaryRisk = Object.freeze({
  jsOwnsLowLevelState: "js-owns-low-level-state",
  ambiguousOwner: "ambiguous-owner",
  diagnosticOnly: "diagnostic-only",
  productScaffold: "product-scaffold",
});

export const OsCompatibilityBoundaryInventory = Object.freeze({
  lifecycle: Object.freeze({
    service: SmallOsServices.lifecycle,
    currentOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.cWasmFacade,
      OwnershipLayers.emscriptenRuntime,
      OwnershipLayers.jsWorker,
    ],
    currentStateOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.cWasmFacade,
      OwnershipLayers.jsWorker,
    ],
    desiredOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.cWasmFacade,
    ],
    jsAllowedRoles: [
      JsRoles.observer,
      JsRoles.browserCoordinator,
    ],
    risk: BoundaryRisk.ambiguousOwner,
    sourceSurfaces: [
      EmacsSourceSurfaces.emacs,
      EmacsSourceSurfaces.loadup,
      EmacsSourceSurfaces.pdumper,
    ],
    nextFacadeOrProbe: "wasmacs_os_lifecycle_state",
  }),
  memoryRoot: Object.freeze({
    service: SmallOsServices.memoryRoot,
    currentOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.cWasmFacade,
      OwnershipLayers.emscriptenRuntime,
    ],
    currentStateOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.cWasmFacade,
    ],
    desiredOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.cWasmFacade,
    ],
    jsAllowedRoles: [JsRoles.observer, JsRoles.diagnosticHarness],
    risk: BoundaryRisk.diagnosticOnly,
    sourceSurfaces: [
      EmacsSourceSurfaces.alloc,
      EmacsSourceSurfaces.thread,
      EmacsSourceSurfaces.eval,
      EmacsSourceSurfaces.lisp,
    ],
    nextFacadeOrProbe: "wasmacs_os_root_safety_probe",
  }),
  controlFlow: Object.freeze({
    service: SmallOsServices.controlFlow,
    currentOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.cWasmFacade,
      OwnershipLayers.jsWorker,
    ],
    currentStateOwners: [
      OwnershipLayers.cWasmFacade,
      OwnershipLayers.jsWorker,
    ],
    desiredOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.cWasmFacade,
    ],
    jsAllowedRoles: [JsRoles.browserCoordinator, JsRoles.observer],
    risk: BoundaryRisk.productScaffold,
    sourceSurfaces: [
      EmacsSourceSurfaces.keyboard,
      EmacsSourceSurfaces.minibuf,
      EmacsSourceSurfaces.callint,
    ],
    nextFacadeOrProbe: "wasmacs_os_reentrant_entrypoint_probe",
  }),
  blockingInputScheduler: Object.freeze({
    service: SmallOsServices.blockingInputScheduler,
    currentOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.cWasmFacade,
      OwnershipLayers.emscriptenRuntime,
      OwnershipLayers.jsWorker,
    ],
    currentStateOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.emscriptenRuntime,
      OwnershipLayers.jsWorker,
    ],
    desiredOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.cWasmFacade,
      OwnershipLayers.jsWorker,
    ],
    jsAllowedRoles: [JsRoles.hostCapabilityProvider, JsRoles.browserCoordinator],
    risk: BoundaryRisk.ambiguousOwner,
    sourceSurfaces: [
      EmacsSourceSurfaces.keyboard,
      EmacsSourceSurfaces.sysdep,
      EmacsSourceSurfaces.term,
    ],
    nextFacadeOrProbe: "wasmacs_os_blocking_input_state",
  }),
  filesystemPersistence: Object.freeze({
    service: SmallOsServices.filesystemPersistence,
    currentOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.emscriptenRuntime,
      OwnershipLayers.jsWorker,
      OwnershipLayers.browserMain,
    ],
    currentStateOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.emscriptenRuntime,
      OwnershipLayers.browserMain,
    ],
    desiredOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.cWasmFacade,
      OwnershipLayers.browserMain,
    ],
    jsAllowedRoles: [JsRoles.hostCapabilityProvider, JsRoles.browserCoordinator],
    risk: BoundaryRisk.productScaffold,
    sourceSurfaces: [
      EmacsSourceSurfaces.fileio,
      EmacsSourceSurfaces.diredC,
      EmacsSourceSurfaces.buffer,
      EmacsSourceSurfaces.filesEl,
      EmacsSourceSurfaces.diredEl,
      EmacsSourceSurfaces.lsLispEl,
      EmacsSourceSurfaces.insdel,
    ],
    nextFacadeOrProbe: "wasmacs_os_dired_without_ls_probe",
  }),
  preloadedState: Object.freeze({
    service: SmallOsServices.preloadedState,
    currentOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.cWasmFacade,
      OwnershipLayers.emscriptenRuntime,
      OwnershipLayers.jsWorker,
    ],
    currentStateOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.cWasmFacade,
      OwnershipLayers.jsWorker,
    ],
    desiredOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.cWasmFacade,
    ],
    jsAllowedRoles: [JsRoles.hostCapabilityProvider, JsRoles.diagnosticHarness],
    risk: BoundaryRisk.diagnosticOnly,
    sourceSurfaces: [
      EmacsSourceSurfaces.pdumper,
      EmacsSourceSurfaces.alloc,
      EmacsSourceSurfaces.puresize,
      EmacsSourceSurfaces.loadup,
      EmacsSourceSurfaces.bindingsEl,
    ],
    nextFacadeOrProbe: "wasmacs_os_preloaded_state_status",
  }),
  terminalTty: Object.freeze({
    service: SmallOsServices.terminalTty,
    currentOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.emscriptenRuntime,
      OwnershipLayers.jsWorker,
    ],
    currentStateOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.emscriptenRuntime,
      OwnershipLayers.jsWorker,
    ],
    desiredOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.cWasmFacade,
      OwnershipLayers.jsWorker,
    ],
    jsAllowedRoles: [JsRoles.hostCapabilityProvider, JsRoles.diagnosticHarness],
    risk: BoundaryRisk.ambiguousOwner,
    sourceSurfaces: [
      EmacsSourceSurfaces.emacs,
      EmacsSourceSurfaces.dispnew,
      EmacsSourceSurfaces.term,
      EmacsSourceSurfaces.keyboard,
      EmacsSourceSurfaces.sysdep,
    ],
    nextFacadeOrProbe: "wasmacs_os_terminal_state",
  }),
  hostCapability: Object.freeze({
    service: SmallOsServices.hostCapability,
    currentOwners: [
      OwnershipLayers.emscriptenRuntime,
      OwnershipLayers.jsWorker,
      OwnershipLayers.browserMain,
    ],
    currentStateOwners: [
      OwnershipLayers.emscriptenRuntime,
      OwnershipLayers.jsWorker,
      OwnershipLayers.browserMain,
    ],
    desiredOwners: [
      OwnershipLayers.cWasmFacade,
      OwnershipLayers.emscriptenRuntime,
      OwnershipLayers.jsWorker,
      OwnershipLayers.browserMain,
    ],
    jsAllowedRoles: [JsRoles.hostCapabilityProvider, JsRoles.diagnosticHarness],
    risk: BoundaryRisk.productScaffold,
    sourceSurfaces: [
      EmacsSourceSurfaces.process,
      EmacsSourceSurfaces.callproc,
      EmacsSourceSurfaces.sysdep,
    ],
    nextFacadeOrProbe: "wasmacs_os_host_capability_state",
  }),
  browserGuiBoundary: Object.freeze({
    service: SmallOsServices.browserGuiBoundary,
    currentOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.jsWorker,
      OwnershipLayers.browserMain,
      OwnershipLayers.appUi,
    ],
    currentStateOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.browserMain,
      OwnershipLayers.appUi,
    ],
    desiredOwners: [
      OwnershipLayers.emacsC,
      OwnershipLayers.browserMain,
      OwnershipLayers.appUi,
    ],
    jsAllowedRoles: [JsRoles.browserCoordinator, JsRoles.observer],
    risk: BoundaryRisk.productScaffold,
    sourceSurfaces: [
      EmacsSourceSurfaces.xdisp,
      EmacsSourceSurfaces.window,
      EmacsSourceSurfaces.keyboard,
      EmacsSourceSurfaces.minibuf,
    ],
    nextFacadeOrProbe: "terminal-byte-renderer-smoke",
  }),
});

export const SmallOsFacades = Object.freeze({
  lifecycleState: Object.freeze({
    id: "lifecycle-state-facade",
    capability: "Expose Emacs runtime phase and reject command entrypoints before initialized state.",
    ownerServices: [SmallOsServices.lifecycle],
    sourceSurfaces: [
      EmacsSourceSurfaces.emacs,
      EmacsSourceSurfaces.loadup,
      EmacsSourceSurfaces.pdumper,
    ],
    cWasmEntrypoints: [
      "wasmacs_os_lifecycle_phase",
      "wasmacs_os_lifecycle_state",
      "wasmacs_os_mark_preloaded_state_loading",
      "wasmacs_os_mark_initialized",
    ],
    jsRole: JsRoles.observer,
    status: FacadeStatus.placeholder,
    acceptance: "State read reports pre-initialized, loading, initialized, command-running, pending-input, and dead without JS owning lifecycle semantics.",
  }),
  entrypointRootRefresh: Object.freeze({
    id: "entrypoint-root-refresh-facade",
    capability: "Refresh wasm stack/root boundaries for every exported JS-to-Emacs entrypoint before allocation or Lisp evaluation.",
    ownerServices: [SmallOsServices.memoryRoot],
    sourceSurfaces: [
      EmacsSourceSurfaces.alloc,
      EmacsSourceSurfaces.thread,
      EmacsSourceSurfaces.eval,
      EmacsSourceSurfaces.lisp,
    ],
    cWasmEntrypoints: [
      "wasmacs_os_enter_host_entrypoint",
      "wasmacs_os_leave_host_entrypoint",
      "wasmacs_os_root_state_snapshot",
      "wasmacs_os_stack_bounds_probe",
      "wasmacs_os_root_safety_probe",
    ],
    jsRole: JsRoles.observer,
    status: FacadeStatus.diagnostic,
    acceptance: "Repeated host-entrypoint probes show refreshed stack_bottom/current_thread->stack_top and survive explicit GC at declared safe points.",
  }),
  gcPermission: Object.freeze({
    id: "gc-permission-facade",
    capability: "Answer whether GC is allowed, inhibited, or blocked from lifecycle, command, stack/root, and preloaded-state state.",
    ownerServices: [SmallOsServices.memoryRoot, SmallOsServices.lifecycle, SmallOsServices.controlFlow],
    sourceSurfaces: [
      EmacsSourceSurfaces.alloc,
      EmacsSourceSurfaces.thread,
      EmacsSourceSurfaces.eval,
    ],
    cWasmEntrypoints: [
      "wasmacs_os_gc_permission",
      "wasmacs_os_gc_permission_state",
      "wasmacs_os_push_gc_guard",
      "wasmacs_os_pop_gc_guard",
    ],
    jsRole: JsRoles.observer,
    status: FacadeStatus.diagnostic,
    acceptance: "Text/cancel completion unwind to idle with GC allowed, and fresh-entry explicit GC passes without JS toggling raw Emacs GC roots.",
  }),
  pendingCommandGuard: Object.freeze({
    id: "pending-command-guard-facade",
    capability: "Own one suspended Emacs command, reject reentrant command/eval calls, and allow only safe state reads plus input/cancel injection.",
    ownerServices: [SmallOsServices.blockingInputScheduler, SmallOsServices.controlFlow],
    sourceSurfaces: [
      EmacsSourceSurfaces.keyboard,
      EmacsSourceSurfaces.minibuf,
      EmacsSourceSurfaces.callint,
      EmacsSourceSurfaces.minibufferEl,
    ],
    cWasmEntrypoints: [
      "wasmacs_os_begin_command",
      "wasmacs_os_pending_command_state",
      "wasmacs_os_enter_pending_input",
      "wasmacs_os_resume_command",
      "wasmacs_os_finish_command",
      "wasmacs_os_cancel_command",
    ],
    jsRole: JsRoles.browserCoordinator,
    status: FacadeStatus.productScaffold,
    acceptance: "Worker protocol emits starting, pending-input, completed/cancelled/failed/unavailable while reentrant command/eval entrypoints return unavailable:busy.",
  }),
  backtraceRootOwnership: Object.freeze({
    id: "backtrace-root-ownership-facade",
    capability: "Preserve, rebase, or retire SPECPDL_BACKTRACE argument roots across Asyncify suspension/resume without JS seeing Lisp_Object words.",
    ownerServices: [SmallOsServices.memoryRoot, SmallOsServices.controlFlow],
    sourceSurfaces: [
      EmacsSourceSurfaces.eval,
      EmacsSourceSurfaces.lisp,
      EmacsSourceSurfaces.alloc,
      EmacsSourceSurfaces.thread,
    ],
    cWasmEntrypoints: [
      "wasmacs_os_pin_backtrace_args",
      "wasmacs_os_release_backtrace_args",
      "wasmacs_os_backtrace_root_state",
    ],
    jsRole: JsRoles.observer,
    status: FacadeStatus.diagnostic,
    acceptance: "Backtrace args remain valid after Asyncify resume, post-completion GC passes, and the pin has an explicit xfree-safe freeing policy (matches pin nargs>0 condition).",
  }),
  preloadedStatePdump: Object.freeze({
    id: "preloaded-state-pdump-facade",
    capability: "Load or generate post-loadup Emacs state before initialized without replaying cold loadup in the browser worker.",
    ownerServices: [SmallOsServices.preloadedState, SmallOsServices.lifecycle, SmallOsServices.memoryRoot],
    sourceSurfaces: [
      EmacsSourceSurfaces.pdumper,
      EmacsSourceSurfaces.alloc,
      EmacsSourceSurfaces.puresize,
      EmacsSourceSurfaces.loadup,
      EmacsSourceSurfaces.bindingsEl,
      EmacsSourceSurfaces.makefile,
    ],
    cWasmEntrypoints: [
      "wasmacs_os_preloaded_state_load",
      "wasmacs_os_preloaded_state_status",
      "wasmacs_os_preloaded_state_retire_bootstrap_roots",
    ],
    jsRole: JsRoles.hostCapabilityProvider,
    status: FacadeStatus.placeholder,
    acceptance: "Generated artifact loads before initialized, preserves pdumper-class relocation/static-root semantics, then simple eval and explicit GC pass.",
  }),
  segmentRootRelocation: Object.freeze({
    id: "segment-root-relocation-facade",
    capability: "Represent fixed wasm memory segments, logical read-only regions, conservative root tables, and slow relocation for preloaded artifacts.",
    ownerServices: [SmallOsServices.memoryRoot, SmallOsServices.preloadedState],
    sourceSurfaces: [
      EmacsSourceSurfaces.alloc,
      EmacsSourceSurfaces.pdumper,
      EmacsSourceSurfaces.puresize,
      EmacsSourceSurfaces.lisp,
    ],
    cWasmEntrypoints: [
      "wasmacs_os_segment_table_snapshot",
      "wasmacs_os_register_static_root_range",
      "wasmacs_os_apply_relocations",
    ],
    jsRole: JsRoles.diagnosticHarness,
    status: FacadeStatus.placeholder,
    acceptance: "Segment/root/relocation diagnostics explain purecopy or pdump failures without JS owning raw roots, pure space, or relocation tables.",
  }),
  terminalTty: Object.freeze({
    id: "terminal-tty-facade",
    capability: "Make stdin/stdout/stderr and /dev/tty look like a minimal text terminal so --nw startup reaches the real Emacs command loop.",
    ownerServices: [
      SmallOsServices.terminalTty,
      SmallOsServices.lifecycle,
      SmallOsServices.blockingInputScheduler,
      SmallOsServices.browserGuiBoundary,
    ],
    sourceSurfaces: [
      EmacsSourceSurfaces.emacs,
      EmacsSourceSurfaces.dispnew,
      EmacsSourceSurfaces.term,
      EmacsSourceSurfaces.keyboard,
      EmacsSourceSurfaces.sysdep,
    ],
    cWasmEntrypoints: [
      "wasmacs_os_terminal_isatty",
      "wasmacs_os_terminal_getattr",
      "wasmacs_os_terminal_setattr",
      "wasmacs_os_terminal_get_winsize",
      "wasmacs_os_terminal_read_byte",
      "wasmacs_os_terminal_write_bytes",
    ],
    jsRole: JsRoles.hostCapabilityProvider,
    status: FacadeStatus.productScaffold,
    acceptance: "Browser worker --nw startup reaches command_loop/read_char/tty_read_avail_input, terminal bytes are observed in JS, and printable bytes resume Emacs through tty input.",
  }),
  diredWithoutLs: Object.freeze({
    id: "dired-without-ls-facade",
    capability: "Make Dired use Emacs filesystem primitives through ls-lisp instead of host.process, shell, or an external ls binary.",
    ownerServices: [
      SmallOsServices.filesystemPersistence,
      SmallOsServices.hostCapability,
    ],
    sourceSurfaces: [
      EmacsSourceSurfaces.fileio,
      EmacsSourceSurfaces.diredC,
      EmacsSourceSurfaces.filesEl,
      EmacsSourceSurfaces.diredEl,
      EmacsSourceSurfaces.lsLispEl,
      EmacsSourceSurfaces.callproc,
    ],
    cWasmEntrypoints: [
      "wasmacs_os_configure_dired_without_ls",
      "wasmacs_os_dired_without_ls_probe",
      "wasmacs_os_filesystem_dired_state",
    ],
    jsRole: JsRoles.hostCapabilityProvider,
    status: FacadeStatus.productScaffold,
    acceptance: "Dired listing setup requires ls-lisp, forces ls-lisp-use-insert-directory-program to nil, and insert-directory over a mounted directory succeeds without calling insert-directory-program or host.process.",
  }),
});

export const SmallOsOperations = Object.freeze({
  browserWorkerAsyncifyBoot: Object.freeze({
    id: "browser-worker-asyncify-boot",
    ownerServices: [SmallOsServices.lifecycle, SmallOsServices.preloadedState],
    crossServiceChecks: [CrossServiceChecks.lifecycleMemory, CrossServiceChecks.preloadedStateFilesystem],
    sourceSurfaces: [
      EmacsSourceSurfaces.loadup,
      EmacsSourceSurfaces.emacs,
      EmacsSourceSurfaces.pdumper,
      EmacsSourceSurfaces.makefile,
    ],
    treatment: BehaviorTreatment.diagnostic,
    acceptance: "Browser worker starts from post-loadup/preloaded state before exposing pending-input.",
  }),
  pdumpPurecopyProbe: Object.freeze({
    id: "pdump-purecopy-probe",
    ownerServices: [SmallOsServices.preloadedState, SmallOsServices.memoryRoot],
    crossServiceChecks: [CrossServiceChecks.lifecycleMemory, CrossServiceChecks.preloadedStateFilesystem],
    sourceSurfaces: [
      EmacsSourceSurfaces.pdumper,
      EmacsSourceSurfaces.alloc,
      EmacsSourceSurfaces.puresize,
      EmacsSourceSurfaces.loadup,
      EmacsSourceSurfaces.bindingsEl,
    ],
    treatment: BehaviorTreatment.diagnostic,
    acceptance: "Node-first preloaded artifact loads before initialized and survives explicit GC.",
  }),
  asyncifyBacktracePin: Object.freeze({
    id: "asyncify-backtrace-pin",
    ownerServices: [SmallOsServices.memoryRoot, SmallOsServices.controlFlow],
    crossServiceChecks: [CrossServiceChecks.memoryInputScheduler, CrossServiceChecks.inputSchedulerControlFlow],
    sourceSurfaces: [
      EmacsSourceSurfaces.eval,
      EmacsSourceSurfaces.lisp,
      EmacsSourceSurfaces.thread,
      EmacsSourceSurfaces.alloc,
    ],
    treatment: BehaviorTreatment.diagnostic,
    acceptance: "Text and cancel completion return to idle, unwind GC inhibit, preserve backtrace args, and pass fresh-entry GC.",
  }),
  pendingCommandProtocol: Object.freeze({
    id: "pending-command-protocol",
    ownerServices: [
      SmallOsServices.blockingInputScheduler,
      SmallOsServices.controlFlow,
      SmallOsServices.browserGuiBoundary,
    ],
    crossServiceChecks: [CrossServiceChecks.inputSchedulerControlFlow, CrossServiceChecks.hostCapabilityBrowserGui],
    sourceSurfaces: [
      EmacsSourceSurfaces.keyboard,
      EmacsSourceSurfaces.minibuf,
      EmacsSourceSurfaces.callint,
      EmacsSourceSurfaces.minibufferEl,
    ],
    treatment: BehaviorTreatment.product,
    acceptance: "Worker owns one pending command and browser renders state without owning minibuffer semantics.",
  }),
  terminalTtyStartup: Object.freeze({
    id: "terminal-tty-startup",
    ownerServices: [
      SmallOsServices.terminalTty,
      SmallOsServices.lifecycle,
      SmallOsServices.blockingInputScheduler,
      SmallOsServices.browserGuiBoundary,
    ],
    crossServiceChecks: [
      CrossServiceChecks.terminalLifecycle,
      CrossServiceChecks.terminalInputScheduler,
      CrossServiceChecks.terminalBrowserGui,
    ],
    sourceSurfaces: [
      EmacsSourceSurfaces.emacs,
      EmacsSourceSurfaces.dispnew,
      EmacsSourceSurfaces.term,
      EmacsSourceSurfaces.keyboard,
      EmacsSourceSurfaces.sysdep,
    ],
    treatment: BehaviorTreatment.product,
    acceptance: "Minimal fake tty lets emacs --quick --no-splash --nw avoid synchronous status 1, reach command_loop/read_char/tty input wait, emit terminal bytes, and consume JS-provided printable input.",
  }),
  filesystemReverseSync: Object.freeze({
    id: "filesystem-reverse-sync",
    ownerServices: [SmallOsServices.filesystemPersistence, SmallOsServices.lifecycle],
    crossServiceChecks: [CrossServiceChecks.filesystemCommandLifecycle],
    sourceSurfaces: [
      EmacsSourceSurfaces.fileio,
      EmacsSourceSurfaces.buffer,
      EmacsSourceSurfaces.filesEl,
      EmacsSourceSurfaces.insdel,
    ],
    treatment: BehaviorTreatment.product,
    acceptance: "Reverse sync happens after command completion or explicit save, then live visited buffers keep undo state.",
  }),
  diredWithoutLs: Object.freeze({
    id: "dired-without-ls",
    ownerServices: [SmallOsServices.filesystemPersistence, SmallOsServices.hostCapability],
    crossServiceChecks: [CrossServiceChecks.filesystemCommandLifecycle, CrossServiceChecks.hostCapabilityBrowserGui],
    sourceSurfaces: [
      EmacsSourceSurfaces.fileio,
      EmacsSourceSurfaces.diredC,
      EmacsSourceSurfaces.filesEl,
      EmacsSourceSurfaces.diredEl,
      EmacsSourceSurfaces.lsLispEl,
      EmacsSourceSurfaces.callproc,
    ],
    treatment: BehaviorTreatment.product,
    acceptance: "Mounted filesystem supports directory-files, directory-files-and-attributes, file-attributes, file-directory-p, file-readable-p, and file-symlink-p well enough for ls-lisp insert-directory to build a Dired listing without host.process.",
  }),
  unavailableBrowserBoundary: Object.freeze({
    id: "unavailable-browser-boundary",
    ownerServices: [SmallOsServices.browserGuiBoundary, SmallOsServices.hostCapability],
    crossServiceChecks: [CrossServiceChecks.hostCapabilityBrowserGui],
    sourceSurfaces: [
      EmacsSourceSurfaces.xdisp,
      EmacsSourceSurfaces.window,
      EmacsSourceSurfaces.keyboard,
      EmacsSourceSurfaces.minibuf,
      EmacsSourceSurfaces.process,
      EmacsSourceSurfaces.callproc,
    ],
    treatment: BehaviorTreatment.product,
    acceptance: "Unsupported process, pty, clipboard, and GUI paths report unavailable states instead of fake semantics.",
  }),
});

const allowedPhaseTransitions = new Map([
  [LifecyclePhases.uninitialized, new Set([LifecyclePhases.coldLoadup, LifecyclePhases.preloadedStateLoading, LifecyclePhases.preloadedStateGenerating, LifecyclePhases.dead])],
  [LifecyclePhases.coldLoadup, new Set([LifecyclePhases.initialized, LifecyclePhases.dead])],
  [LifecyclePhases.preloadedStateGenerating, new Set([LifecyclePhases.preloadedStateLoading, LifecyclePhases.dead])],
  [LifecyclePhases.preloadedStateLoading, new Set([LifecyclePhases.initialized, LifecyclePhases.dead])],
  [LifecyclePhases.initialized, new Set([LifecyclePhases.commandRunning, LifecyclePhases.shuttingDown, LifecyclePhases.dead])],
  [LifecyclePhases.commandRunning, new Set([LifecyclePhases.pendingInput, LifecyclePhases.initialized, LifecyclePhases.dead])],
  [LifecyclePhases.pendingInput, new Set([LifecyclePhases.commandRunning, LifecyclePhases.initialized, LifecyclePhases.dead])],
  [LifecyclePhases.shuttingDown, new Set([LifecyclePhases.dead])],
  [LifecyclePhases.dead, new Set([])],
]);

export function operationContract(operationId) {
  return SmallOsOperations[operationId] ?? Object.values(SmallOsOperations).find((operation) => operation.id === operationId);
}

export function validateOperationContract(contract) {
  if (!contract || typeof contract.id !== "string") return false;
  if (!Array.isArray(contract.ownerServices) || contract.ownerServices.length === 0) return false;
  if (!contract.ownerServices.every((service) => Object.values(SmallOsServices).includes(service))) return false;
  if (!Array.isArray(contract.crossServiceChecks) || contract.crossServiceChecks.length === 0) return false;
  if (!Array.isArray(contract.sourceSurfaces) || contract.sourceSurfaces.length === 0) return false;
  if (!Object.values(BehaviorTreatment).includes(contract.treatment)) return false;
  return typeof contract.acceptance === "string" && contract.acceptance.length > 0;
}

export function createSmallOsState(overrides = {}) {
  return {
    lifecyclePhase: overrides.lifecyclePhase ?? LifecyclePhases.uninitialized,
    pendingCommandId: overrides.pendingCommandId,
    pendingOperationId: overrides.pendingOperationId,
    gcInhibited: Boolean(overrides.gcInhibited),
    stackRootsFresh: Boolean(overrides.stackRootsFresh),
    preloadedStateReady: Boolean(overrides.preloadedStateReady),
    reverseSyncAllowed: Boolean(overrides.reverseSyncAllowed),
    diagnostics: Array.isArray(overrides.diagnostics) ? [...overrides.diagnostics] : [],
  };
}

export function transitionLifecycle(state, nextPhase) {
  const current = state?.lifecyclePhase ?? LifecyclePhases.uninitialized;
  if (!Object.values(LifecyclePhases).includes(nextPhase)) {
    throw new Error(`unknown small OS lifecycle phase: ${nextPhase}`);
  }
  if (current === nextPhase) return createSmallOsState({ ...state, lifecyclePhase: nextPhase });
  if (!allowedPhaseTransitions.get(current)?.has(nextPhase)) {
    throw new Error(`invalid small OS lifecycle transition: ${current} -> ${nextPhase}`);
  }
  return createSmallOsState({ ...state, lifecyclePhase: nextPhase });
}

export function canRunGc(state) {
  if (!state) return false;
  if (state.gcInhibited) return false;
  if (!state.stackRootsFresh) return false;
  return [
    LifecyclePhases.initialized,
    LifecyclePhases.commandRunning,
  ].includes(state.lifecyclePhase);
}

export function canStartPendingCommand(state) {
  return Boolean(
    state &&
    state.lifecyclePhase === LifecyclePhases.initialized &&
    !state.pendingCommandId &&
    state.stackRootsFresh &&
    (state.preloadedStateReady || state.pendingOperationId !== SmallOsOperations.browserWorkerAsyncifyBoot.id),
  );
}

export function canReverseSync(state) {
  if (!state) return false;
  if (!state.reverseSyncAllowed) return false;
  if (state.pendingCommandId) return false;
  return state.lifecyclePhase === LifecyclePhases.initialized;
}

export function createSubstrateRecord(operationId, overrides = {}) {
  const contract = operationContract(operationId);
  if (!validateOperationContract(contract)) {
    throw new Error(`unknown or invalid small OS operation contract: ${operationId}`);
  }
  return {
    operationId: contract.id,
    ownerServices: [...contract.ownerServices],
    crossServiceChecks: [...contract.crossServiceChecks],
    sourceSurfaces: [...contract.sourceSurfaces],
    treatment: overrides.treatment ?? contract.treatment,
    acceptance: overrides.acceptance ?? contract.acceptance,
    productReady: Boolean(overrides.productReady),
  };
}

export function validateSubstrateRecord(record) {
  if (!record || typeof record.operationId !== "string") return false;
  if (!Array.isArray(record.ownerServices) || record.ownerServices.length === 0) return false;
  if (!Array.isArray(record.crossServiceChecks) || record.crossServiceChecks.length === 0) return false;
  if (!Array.isArray(record.sourceSurfaces) || record.sourceSurfaces.length === 0) return false;
  if (!Object.values(BehaviorTreatment).includes(record.treatment)) return false;
  if (record.treatment === BehaviorTreatment.diagnostic && record.productReady) return false;
  return typeof record.acceptance === "string" && record.acceptance.length > 0;
}

export function facadeContract(facadeId) {
  return SmallOsFacades[facadeId] ?? Object.values(SmallOsFacades).find((facade) => facade.id === facadeId);
}

export function validateFacadeContract(contract) {
  if (!contract || typeof contract.id !== "string") return false;
  if (typeof contract.capability !== "string" || contract.capability.length === 0) return false;
  if (!Array.isArray(contract.ownerServices) || contract.ownerServices.length === 0) return false;
  if (!contract.ownerServices.every((service) => Object.values(SmallOsServices).includes(service))) return false;
  if (!Array.isArray(contract.sourceSurfaces) || contract.sourceSurfaces.length === 0) return false;
  if (!Array.isArray(contract.cWasmEntrypoints) || contract.cWasmEntrypoints.length === 0) return false;
  if (!Object.values(JsRoles).includes(contract.jsRole)) return false;
  if (!Object.values(FacadeStatus).includes(contract.status)) return false;
  return typeof contract.acceptance === "string" && contract.acceptance.length > 0;
}

export function validateBoundaryInventoryRecord(record) {
  if (!record || !Object.values(SmallOsServices).includes(record.service)) return false;
  if (!Array.isArray(record.currentOwners) || record.currentOwners.length === 0) return false;
  if (!record.currentOwners.every((owner) => Object.values(OwnershipLayers).includes(owner))) return false;
  if (!Array.isArray(record.currentStateOwners) || record.currentStateOwners.length === 0) return false;
  if (!record.currentStateOwners.every((owner) => Object.values(OwnershipLayers).includes(owner))) return false;
  if (!Array.isArray(record.desiredOwners) || record.desiredOwners.length === 0) return false;
  if (!record.desiredOwners.every((owner) => Object.values(OwnershipLayers).includes(owner))) return false;
  if (!Array.isArray(record.jsAllowedRoles) || record.jsAllowedRoles.length === 0) return false;
  if (!record.jsAllowedRoles.every((role) => Object.values(JsRoles).includes(role))) return false;
  if (!Object.values(BoundaryRisk).includes(record.risk)) return false;
  if (!Array.isArray(record.sourceSurfaces) || record.sourceSurfaces.length === 0) return false;
  return typeof record.nextFacadeOrProbe === "string" && record.nextFacadeOrProbe.length > 0;
}
