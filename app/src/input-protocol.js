export function keyEventToBufferCommand(event) {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
    return undefined;
  }

  if (event.key === "Backspace") {
    return { type: "backspace", path: event.path, pointIndex: event.pointIndex };
  }

  if (event.key === "ArrowLeft") {
    return { type: "move-point", direction: "left", path: event.path, pointIndex: event.pointIndex };
  }

  if (event.key === "ArrowRight") {
    return { type: "move-point", direction: "right", path: event.path, pointIndex: event.pointIndex };
  }

  if (event.key === "Enter") {
    return { type: "insert-text", path: event.path, pointIndex: event.pointIndex, text: "\n" };
  }

  if (event.key?.length === 1) {
    return { type: "insert-text", path: event.path, pointIndex: event.pointIndex, text: event.key };
  }

  return undefined;
}

export function validateBufferCommand(command) {
  if (
    command?.type !== "insert-text" &&
    command?.type !== "backspace" &&
    command?.type !== "move-point" &&
    command?.type !== "ensure-marker"
  ) {
    return false;
  }
  if (typeof command.path !== "string" || !command.path.startsWith("/home/user/")) {
    return false;
  }
  if (command.type === "insert-text") {
    return typeof command.text === "string" && command.text.length > 0;
  }
  if (command.type === "move-point") {
    return command.direction === "left" || command.direction === "right";
  }
  return true;
}
