export function isEditorModified(savedText, editorText) {
  return String(savedText) !== String(editorText);
}
