export function textToGridDrawMessage({ path, text, columns = 80, pointIndex = text.length }) {
  if (!Number.isInteger(columns) || columns <= 0) {
    throw new Error("columns must be a positive integer");
  }
  if (!Number.isInteger(pointIndex)) {
    throw new Error("pointIndex must be an integer");
  }

  const logicalLines = text.replace(/\r\n?/g, "\n").split("\n");
  const rows = [];
  const clampedPoint = Math.max(0, Math.min(text.length, pointIndex));
  let remainingPoint = clampedPoint;
  let pointRow = 0;
  let pointColumn = 0;
  let pointFound = false;

  for (const line of logicalLines) {
    const lineWithNewlineLength = line.length + 1;
    if (line.length === 0) {
      if (!pointFound && remainingPoint === 0) {
        pointRow = rows.length;
        pointColumn = 0;
        pointFound = true;
      }
      rows.push("");
      remainingPoint -= Math.min(remainingPoint, lineWithNewlineLength);
      continue;
    }
    for (let index = 0; index < line.length; index += columns) {
      const row = line.slice(index, index + columns);
      if (!pointFound && remainingPoint <= row.length) {
        pointRow = rows.length;
        pointColumn = remainingPoint;
        pointFound = true;
      }
      rows.push(row);
      remainingPoint -= Math.min(remainingPoint, row.length);
    }
    remainingPoint -= Math.min(remainingPoint, 1);
  }

  if (clampedPoint === text.length) {
    pointRow = Math.max(0, rows.length - 1);
    pointColumn = rows[pointRow]?.length ?? 0;
  }

  return {
    type: "text-grid-draw",
    version: 1,
    path,
    columns,
    rows,
    point: {
      index: clampedPoint,
      row: pointRow,
      column: pointColumn,
    },
    modeLine: `${path}  (${rows.length} rows)`,
  };
}

export function validateTextGridDrawMessage(message) {
  if (message?.type !== "text-grid-draw") return false;
  if (message.version !== 1) return false;
  if (typeof message.path !== "string") return false;
  if (!Number.isInteger(message.columns) || message.columns <= 0) return false;
  if (!Array.isArray(message.rows) || !message.rows.every((row) => typeof row === "string")) return false;
  if (
    !message.point ||
    !Number.isInteger(message.point.index) ||
    !Number.isInteger(message.point.row) ||
    !Number.isInteger(message.point.column)
  ) return false;
  if (typeof message.modeLine !== "string") return false;
  return true;
}
