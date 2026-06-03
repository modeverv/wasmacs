import { createSubstrateRecord, SmallOsOperations, validateSubstrateRecord } from "./small-os-services.js";

const pendingCommandStates = new Set([
  "idle",
  "starting",
  "pending-input",
  "resuming",
  "completed",
  "cancelled",
  "failed",
  "unavailable",
]);

const pendingCommandKinds = new Set([
  "find-file",
  "switch-buffer",
  "minibuffer-read",
]);

export function pendingCommandMessage(command = {}, state = "starting", details = {}) {
  return {
    type: "pending-command",
    id: details.id ?? `${command.type ?? "command"}:${command.path ?? ""}`,
    commandType: command.type ?? "unknown",
    path: command.path,
    pointIndex: command.pointIndex,
    state,
    minibuffer: details.minibuffer ?? "",
    result: details.result,
    error: details.error,
    substrate: details.substrate ?? createSubstrateRecord(SmallOsOperations.pendingCommandProtocol.id),
  };
}

export function validatePendingCommandMessage(message) {
  if (message?.type !== "pending-command") return false;
  if (!pendingCommandStates.has(message.state)) return false;
  if (typeof message.id !== "string" || message.id.length === 0) return false;
  if (typeof message.commandType !== "string" || message.commandType.length === 0) return false;
  if (message.path !== undefined && (typeof message.path !== "string" || !message.path.startsWith("/home/user/"))) {
    return false;
  }
  if (message.minibuffer !== undefined && typeof message.minibuffer !== "string") return false;
  if (message.substrate !== undefined && !validateSubstrateRecord(message.substrate)) return false;
  return true;
}

export function isPendingCommandBoundary(command) {
  return pendingCommandKinds.has(command?.type);
}

export function pendingCommandStatusText(message) {
  if (!validatePendingCommandMessage(message)) return "";
  if (message.state === "pending-input") return "pending emacs input";
  if (message.state === "resuming") return "resuming emacs command";
  if (message.state === "completed") return "emacs command completed";
  if (message.state === "cancelled") return "emacs command cancelled";
  if (message.state === "failed") return "emacs command failed";
  if (message.state === "unavailable") return "minibuffer unavailable";
  return "starting emacs command";
}
