export function keyEventToBufferCommand(event) {
  if (event.isComposing || event.metaKey) {
    return undefined;
  }

  if (event.prefix === "C-x") {
    if (event.ctrlKey && String(event.key).toLowerCase() === "f") {
      return { type: "find-file", path: event.path, pointIndex: event.pointIndex };
    }
    if (!event.ctrlKey && String(event.key).toLowerCase() === "b") {
      return { type: "switch-buffer", path: event.path, pointIndex: event.pointIndex };
    }
    return { type: "keyboard-quit", path: event.path, pointIndex: event.pointIndex };
  }

  if (event.altKey) {
    if (String(event.key).toLowerCase() === "w") {
      return { type: "clipboard-copy", path: event.path, pointIndex: event.pointIndex };
    }
    return undefined;
  }

  if (event.ctrlKey) {
    if (String(event.key).toLowerCase() === "x") {
      return { type: "key-prefix", prefix: "C-x", path: event.path, pointIndex: event.pointIndex };
    }
    if (String(event.key).toLowerCase() === "w") {
      return { type: "clipboard-cut", path: event.path, pointIndex: event.pointIndex };
    }
    if (String(event.key).toLowerCase() === "y") {
      return { type: "clipboard-yank", path: event.path, pointIndex: event.pointIndex };
    }
    if (String(event.key).toLowerCase() === "g") {
      return { type: "keyboard-quit", path: event.path, pointIndex: event.pointIndex };
    }
    if (String(event.key).toLowerCase() === "s") {
      return { type: "save-buffer", path: event.path, pointIndex: event.pointIndex };
    }
    if (event.key === "/" || event.key === "_") {
      return { type: "undo", path: event.path, pointIndex: event.pointIndex };
    }
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
    command?.type !== "save-buffer" &&
    command?.type !== "keyboard-quit" &&
    command?.type !== "undo" &&
    command?.type !== "clipboard-copy" &&
    command?.type !== "clipboard-cut" &&
    command?.type !== "clipboard-yank" &&
    command?.type !== "find-file" &&
    command?.type !== "switch-buffer" &&
    command?.type !== "process-probe" &&
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

export function nextPointIndexForCommand(pointIndex, command, textLength = Number.MAX_SAFE_INTEGER) {
  const current = Math.max(0, Number(pointIndex) || 0);
  if (command?.type === "insert-text") {
    return current + command.text.length;
  }
  if (command?.type === "backspace") {
    return Math.max(0, current - 1);
  }
  if (command?.type === "move-point" && command.direction === "left") {
    return Math.max(0, current - 1);
  }
  if (command?.type === "move-point" && command.direction === "right") {
    return Math.min(textLength, current + 1);
  }
  return current;
}
