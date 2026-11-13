export function coalesceBufferCommand(queue, command) {
  const nextQueue = queue.slice();
  const previous = nextQueue[nextQueue.length - 1];
  if (
    previous?.type === "insert-text" &&
    command.type === "insert-text" &&
    previous.path === command.path &&
    previous.pointIndex + previous.text.length === command.pointIndex
  ) {
    nextQueue[nextQueue.length - 1] = {
      ...previous,
      text: `${previous.text}${command.text}`,
    };
    return nextQueue;
  }

  nextQueue.push(command);
  return nextQueue;
}
