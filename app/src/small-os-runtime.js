import {
  canReverseSync,
  canStartPendingCommand,
  createSmallOsState,
  LifecyclePhases,
  SmallOsOperations,
  transitionLifecycle,
} from "./small-os-services.js";

export function createBrowserSmallOsCoordinator(overrides = {}) {
  let state = createSmallOsState({
    lifecyclePhase: LifecyclePhases.initialized,
    stackRootsFresh: true,
    reverseSyncAllowed: true,
    ...overrides,
  });

  function snapshot() {
    return {
      ...state,
      diagnostics: state.diagnostics.slice(),
    };
  }

  function beginCommand(command = {}, operationId = SmallOsOperations.filesystemReverseSync.id) {
    if (!canStartPendingCommand(state)) {
      throw new Error(`small OS cannot start command from ${state.lifecyclePhase}`);
    }
    state = transitionLifecycle(state, LifecyclePhases.commandRunning);
    state = createSmallOsState({
      ...state,
      pendingCommandId: commandId(command),
      pendingOperationId: operationId,
      reverseSyncAllowed: false,
    });
    return snapshot();
  }

  function enterPendingInput() {
    state = transitionLifecycle(state, LifecyclePhases.pendingInput);
    state = createSmallOsState({
      ...state,
      reverseSyncAllowed: false,
    });
    return snapshot();
  }

  function resumeCommand() {
    state = transitionLifecycle(state, LifecyclePhases.commandRunning);
    state = createSmallOsState({
      ...state,
      reverseSyncAllowed: false,
    });
    return snapshot();
  }

  function finishCommand({ allowReverseSync = true, diagnostic } = {}) {
    if (state.lifecyclePhase === LifecyclePhases.pendingInput) {
      state = transitionLifecycle(state, LifecyclePhases.commandRunning);
    }
    if (state.lifecyclePhase === LifecyclePhases.commandRunning) {
      state = transitionLifecycle(state, LifecyclePhases.initialized);
    }
    state = createSmallOsState({
      ...state,
      pendingCommandId: undefined,
      pendingOperationId: undefined,
      gcInhibited: false,
      reverseSyncAllowed: allowReverseSync,
      diagnostics: diagnostic ? [...state.diagnostics, diagnostic] : state.diagnostics,
    });
    return snapshot();
  }

  function failCommand(error) {
    return finishCommand({
      allowReverseSync: false,
      diagnostic: error && error.message ? error.message : String(error),
    });
  }

  function assertReverseSyncAllowed() {
    if (!canReverseSync(state)) {
      throw new Error(`small OS reverse sync outside Emacs-owned boundary: ${state.lifecyclePhase}`);
    }
  }

  return {
    snapshot,
    beginCommand,
    enterPendingInput,
    resumeCommand,
    finishCommand,
    failCommand,
    assertReverseSyncAllowed,
  };
}

export function commandId(command = {}) {
  return `${command.type ?? "command"}:${command.path ?? ""}`;
}
