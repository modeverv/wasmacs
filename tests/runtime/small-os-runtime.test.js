import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserSmallOsCoordinator } from "../../app/src/small-os-runtime.js";
import { LifecyclePhases, SmallOsOperations } from "../../app/src/small-os-services.js";

test("browser small OS coordinator owns command lifecycle before reverse sync", () => {
  const os = createBrowserSmallOsCoordinator();

  os.beginCommand(
    { type: "insert-text", path: "/home/user/projects/a.txt" },
    SmallOsOperations.filesystemReverseSync.id,
  );
  assert.equal(os.snapshot().lifecyclePhase, LifecyclePhases.commandRunning);
  assert.equal(os.snapshot().pendingCommandId, "insert-text:/home/user/projects/a.txt");
  assert.throws(() => os.assertReverseSyncAllowed(), /reverse sync outside Emacs-owned boundary/);

  os.finishCommand({ allowReverseSync: true });
  assert.equal(os.snapshot().lifecyclePhase, LifecyclePhases.initialized);
  assert.equal(os.snapshot().pendingCommandId, undefined);
  assert.doesNotThrow(() => os.assertReverseSyncAllowed());
});

test("pending input and resume stay inside one command owner", () => {
  const os = createBrowserSmallOsCoordinator();

  os.beginCommand(
    { type: "minibuffer-read", path: "/home/user/projects/a.txt" },
    SmallOsOperations.pendingCommandProtocol.id,
  );
  os.enterPendingInput();
  assert.equal(os.snapshot().lifecyclePhase, LifecyclePhases.pendingInput);
  assert.equal(os.snapshot().pendingCommandId, "minibuffer-read:/home/user/projects/a.txt");
  assert.throws(() => os.assertReverseSyncAllowed(), /reverse sync outside Emacs-owned boundary/);

  os.resumeCommand();
  assert.equal(os.snapshot().lifecyclePhase, LifecyclePhases.commandRunning);
  os.finishCommand({ allowReverseSync: false });
  assert.equal(os.snapshot().lifecyclePhase, LifecyclePhases.initialized);
  assert.throws(() => os.assertReverseSyncAllowed(), /reverse sync outside Emacs-owned boundary/);
});

test("failed commands return to initialized and record diagnostics", () => {
  const os = createBrowserSmallOsCoordinator();

  os.beginCommand(
    { type: "find-file", path: "/home/user/projects/a.txt" },
    SmallOsOperations.pendingCommandProtocol.id,
  );
  os.failCommand(new Error("minibuffer unavailable"));

  const snapshot = os.snapshot();
  assert.equal(snapshot.lifecyclePhase, LifecyclePhases.initialized);
  assert.equal(snapshot.pendingCommandId, undefined);
  assert.equal(snapshot.diagnostics.at(-1), "minibuffer unavailable");
});
