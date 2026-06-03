import test from "node:test";
import assert from "node:assert/strict";
import {
  BehaviorTreatment,
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
  operationContract,
  SmallOsFacades,
  SmallOsOperations,
  SmallOsServices,
  transitionLifecycle,
  validateFacadeContract,
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

test("pending command guard is the only current product scaffold facade", () => {
  const productScaffolds = Object.values(SmallOsFacades).filter((facade) => facade.status === FacadeStatus.productScaffold);
  assert.deepEqual(productScaffolds.map((facade) => facade.id), ["pending-command-guard-facade"]);
  assert.equal(productScaffolds[0].jsRole, JsRoles.browserCoordinator);
  assert.equal(productScaffolds[0].ownerServices.includes(SmallOsServices.blockingInputScheduler), true);
});
