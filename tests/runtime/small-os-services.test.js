import test from "node:test";
import assert from "node:assert/strict";
import {
  BehaviorTreatment,
  BoundaryRisk,
  canReverseSync,
  canRunGc,
  canStartPendingCommand,
  createSmallOsState,
  createSubstrateRecord,
  CrossServiceChecks,
  FacadeStatus,
  facadeContract,
  JsRoles,
  LifecyclePhases,
  OwnershipLayers,
  OsCompatibilityBoundaryInventory,
  operationContract,
  SmallOsFacades,
  SmallOsOperations,
  SmallOsServices,
  transitionLifecycle,
  validateFacadeContract,
  validateBoundaryInventoryRecord,
  validateOperationContract,
  validateSubstrateRecord,
} from "../../app/src/small-os-services.js";

test("small OS operations name owner services, invariants, sources, and acceptance", () => {
  for (const operation of Object.values(SmallOsOperations)) {
    assert.equal(validateOperationContract(operation), true, operation.id);
    const record = createSubstrateRecord(operation.id);
    assert.equal(validateSubstrateRecord(record), true, operation.id);
  }
});

test("pdump and asyncify boot blockers stay diagnostic until acceptance passes", () => {
  const boot = createSubstrateRecord(SmallOsOperations.browserWorkerAsyncifyBoot.id);
  assert.deepEqual(boot.ownerServices, [
    SmallOsServices.lifecycle,
    SmallOsServices.preloadedState,
  ]);
  assert.equal(boot.treatment, BehaviorTreatment.diagnostic);
  assert.equal(boot.crossServiceChecks.includes(CrossServiceChecks.lifecycleMemory), true);
  assert.equal(boot.sourceSurfaces.includes("vendor/emacs/lisp/loadup.el"), true);

  const productClaim = { ...boot, productReady: true };
  assert.equal(validateSubstrateRecord(productClaim), false);
});

test("backtrace pin is recorded as root-safety diagnostic, not product behavior", () => {
  const pin = createSubstrateRecord(SmallOsOperations.asyncifyBacktracePin.id);
  assert.deepEqual(pin.ownerServices, [
    SmallOsServices.memoryRoot,
    SmallOsServices.controlFlow,
  ]);
  assert.equal(pin.treatment, BehaviorTreatment.diagnostic);
  assert.equal(pin.sourceSurfaces.includes("vendor/emacs/src/eval.c"), true);
  assert.equal(pin.sourceSurfaces.includes("vendor/emacs/src/lisp.h"), true);
});

test("lifecycle transitions reject command exposure before initialized state", () => {
  let state = createSmallOsState();
  assert.throws(() => transitionLifecycle(state, LifecyclePhases.pendingInput), /invalid small OS lifecycle transition/);
  state = transitionLifecycle(state, LifecyclePhases.preloadedStateLoading);
  state = transitionLifecycle({ ...state, preloadedStateReady: true }, LifecyclePhases.initialized);
  assert.equal(state.lifecyclePhase, LifecyclePhases.initialized);
});

test("GC and reverse sync are allowed only at Emacs-owned boundaries", () => {
  const initialized = createSmallOsState({
    lifecyclePhase: LifecyclePhases.initialized,
    stackRootsFresh: true,
    preloadedStateReady: true,
    reverseSyncAllowed: true,
  });
  assert.equal(canRunGc(initialized), true);
  assert.equal(canReverseSync(initialized), true);

  const pending = {
    ...initialized,
    lifecyclePhase: LifecyclePhases.pendingInput,
    pendingCommandId: "find-file:/home/user/a.txt",
    gcInhibited: true,
  };
  assert.equal(canRunGc(pending), false);
  assert.equal(canReverseSync(pending), false);
});

test("pending command start requires initialized runtime and fresh roots", () => {
  assert.equal(canStartPendingCommand(createSmallOsState()), false);
  assert.equal(canStartPendingCommand(createSmallOsState({
    lifecyclePhase: LifecyclePhases.initialized,
    stackRootsFresh: false,
    preloadedStateReady: true,
  })), false);
  assert.equal(canStartPendingCommand(createSmallOsState({
    lifecyclePhase: LifecyclePhases.initialized,
    stackRootsFresh: true,
    preloadedStateReady: true,
  })), true);
});

test("operation lookup accepts both registry key and operation id", () => {
  assert.equal(operationContract("pendingCommandProtocol").id, SmallOsOperations.pendingCommandProtocol.id);
  assert.equal(operationContract("pending-command-protocol").id, SmallOsOperations.pendingCommandProtocol.id);
});

test("C/wasm facade contracts name capability, service owner, JS role, and acceptance", () => {
  for (const facade of Object.values(SmallOsFacades)) {
    assert.equal(validateFacadeContract(facade), true, facade.id);
    assert.match(facade.id, /-facade$/);
    assert.equal(facade.cWasmEntrypoints.every((entrypoint) => entrypoint.startsWith("wasmacs_os_")), true, facade.id);
  }
});

test("low-level root, pdump, and relocation facades are not JS-owned product behavior", () => {
  const rootRefresh = facadeContract("entrypoint-root-refresh-facade");
  assert.equal(rootRefresh.jsRole, JsRoles.observer);
  assert.equal(rootRefresh.status, FacadeStatus.diagnostic);
  assert.equal(rootRefresh.sourceSurfaces.includes("vendor/emacs/src/alloc.c"), true);
  assert.equal(rootRefresh.cWasmEntrypoints.includes("wasmacs_os_stack_bounds_probe"), true);
  assert.equal(rootRefresh.cWasmEntrypoints.includes("wasmacs_os_root_safety_probe"), true);

  const lifecycle = facadeContract("lifecycle-state-facade");
  assert.equal(lifecycle.jsRole, JsRoles.observer);
  assert.equal(lifecycle.cWasmEntrypoints.includes("wasmacs_os_lifecycle_state"), true);

  const gc = facadeContract("gc-permission-facade");
  assert.equal(gc.status, FacadeStatus.diagnostic);
  assert.equal(gc.cWasmEntrypoints.includes("wasmacs_os_gc_permission_state"), true);

  const pdump = facadeContract("preloadedStatePdump");
  assert.equal(pdump.jsRole, JsRoles.hostCapabilityProvider);
  assert.equal(pdump.status, FacadeStatus.placeholder);
  assert.deepEqual(pdump.ownerServices, [
    SmallOsServices.preloadedState,
    SmallOsServices.lifecycle,
    SmallOsServices.memoryRoot,
  ]);

  const relocation = facadeContract("segment-root-relocation-facade");
  assert.equal(relocation.jsRole, JsRoles.diagnosticHarness);
  assert.equal(relocation.status, FacadeStatus.placeholder);
  assert.equal(relocation.capability.includes("fixed wasm memory segments"), true);
});

test("current product scaffold facades are pending command and terminal tty", () => {
  const productScaffolds = Object.values(SmallOsFacades).filter((facade) => facade.status === FacadeStatus.productScaffold);
  assert.deepEqual(productScaffolds.map((facade) => facade.id).sort(), [
    "pending-command-guard-facade",
    "terminal-tty-facade",
  ]);

  const pending = facadeContract("pending-command-guard-facade");
  assert.equal(pending.jsRole, JsRoles.browserCoordinator);
  assert.equal(pending.ownerServices.includes(SmallOsServices.blockingInputScheduler), true);

  const terminal = facadeContract("terminal-tty-facade");
  assert.equal(terminal.jsRole, JsRoles.hostCapabilityProvider);
  assert.equal(terminal.ownerServices.includes(SmallOsServices.terminalTty), true);
  assert.equal(terminal.sourceSurfaces.includes("vendor/emacs/src/term.c"), true);
});

test("terminal tty startup is a product route with lifecycle and browser boundary checks", () => {
  const terminal = createSubstrateRecord(SmallOsOperations.terminalTtyStartup.id);
  assert.equal(terminal.treatment, BehaviorTreatment.product);
  assert.equal(terminal.ownerServices.includes(SmallOsServices.terminalTty), true);
  assert.equal(terminal.crossServiceChecks.includes(CrossServiceChecks.terminalLifecycle), true);
  assert.equal(terminal.crossServiceChecks.includes(CrossServiceChecks.terminalInputScheduler), true);
  assert.equal(terminal.crossServiceChecks.includes(CrossServiceChecks.terminalBrowserGui), true);
  assert.equal(terminal.sourceSurfaces.includes("vendor/emacs/src/dispnew.c"), true);
  assert.match(terminal.acceptance, /command_loop/);
});

test("OS compatibility boundary inventory covers every small OS service", () => {
  const inventoriedServices = new Set(
    Object.values(OsCompatibilityBoundaryInventory).map((record) => record.service),
  );
  assert.deepEqual(inventoriedServices, new Set(Object.values(SmallOsServices)));

  for (const record of Object.values(OsCompatibilityBoundaryInventory)) {
    assert.equal(validateBoundaryInventoryRecord(record), true, record.service);
  }
});

test("low-level lifecycle, memory, root, and GC ownership stays in C/wasm", () => {
  for (const key of ["lifecycle", "memoryRoot", "controlFlow"]) {
    const record = OsCompatibilityBoundaryInventory[key];
    assert.equal(record.desiredOwners.includes(OwnershipLayers.cWasmFacade), true, key);
    assert.equal(record.desiredOwners.includes(OwnershipLayers.jsWorker), false, key);
    assert.equal(record.jsAllowedRoles.includes(JsRoles.observer) || record.jsAllowedRoles.includes(JsRoles.browserCoordinator), true, key);
  }

  assert.equal(OsCompatibilityBoundaryInventory.memoryRoot.nextFacadeOrProbe, "wasmacs_os_root_safety_probe");
  assert.equal(OsCompatibilityBoundaryInventory.lifecycle.nextFacadeOrProbe, "wasmacs_os_lifecycle_state");
  assert.equal(
    [BoundaryRisk.ambiguousOwner, BoundaryRisk.diagnosticOnly].includes(OsCompatibilityBoundaryInventory.memoryRoot.risk),
    true,
  );
});
