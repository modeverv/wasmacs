import test from "node:test";
import assert from "node:assert/strict";
import {
  isPendingCommandBoundary,
  pendingCommandMessage,
  pendingCommandStatusText,
  validatePendingCommandMessage,
} from "../../app/src/pending-command-protocol.js";
import { BehaviorTreatment, SmallOsOperations, SmallOsServices } from "../../app/src/small-os-services.js";

test("pending command messages carry worker-owned command state", () => {
  const message = pendingCommandMessage(
    { type: "find-file", path: "/home/user/projects/demo.txt", pointIndex: 3 },
    "pending-input",
    { minibuffer: "Find file: " },
  );

  assert.equal(message.type, "pending-command");
  assert.equal(message.id, "find-file:/home/user/projects/demo.txt");
  assert.equal(message.commandType, "find-file");
  assert.equal(message.path, "/home/user/projects/demo.txt");
  assert.equal(message.pointIndex, 3);
  assert.equal(message.state, "pending-input");
  assert.equal(message.minibuffer, "Find file: ");
  assert.equal(message.result, undefined);
  assert.equal(message.error, undefined);
  assert.equal(message.substrate.operationId, SmallOsOperations.pendingCommandProtocol.id);
  assert.equal(message.substrate.treatment, BehaviorTreatment.product);
  assert.deepEqual(message.substrate.ownerServices, [
    SmallOsServices.blockingInputScheduler,
    SmallOsServices.controlFlow,
    SmallOsServices.browserGuiBoundary,
  ]);
  assert.equal(validatePendingCommandMessage(message), true);
  assert.equal(pendingCommandStatusText(message), "pending emacs input");
});

test("pending command protocol keeps command boundaries explicit", () => {
  assert.equal(isPendingCommandBoundary({ type: "find-file" }), true);
  assert.equal(isPendingCommandBoundary({ type: "switch-buffer" }), true);
  assert.equal(isPendingCommandBoundary({ type: "insert-text" }), false);
  assert.equal(validatePendingCommandMessage(pendingCommandMessage({ type: "find-file", path: "/system/foo" })), false);
  assert.equal(pendingCommandStatusText(pendingCommandMessage({ type: "find-file", path: "/home/user/a.txt" }, "unavailable")), "minibuffer unavailable");
  const invalidSubstrate = pendingCommandMessage({ type: "find-file", path: "/home/user/a.txt" });
  invalidSubstrate.substrate = { operationId: "missing-services" };
  assert.equal(validatePendingCommandMessage(invalidSubstrate), false);
});
