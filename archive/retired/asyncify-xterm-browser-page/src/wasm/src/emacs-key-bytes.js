// Pure function: browser KeyboardEvent fields → Emacs byte sequence.
// Returns an array of byte values, or null if the key has no Emacs mapping.
// JS is the transport layer only — Emacs owns all command semantics.
// Arrow keys use VT100/xterm escape sequences matching --nw terminal mode.
export function browserKeyEventToEmacsBytes({
  key,
  ctrlKey = false,
  altKey = false,
  metaKey = false,
  isComposing = false,
}) {
  if (isComposing || metaKey) return null;

  if (ctrlKey) {
    const k = String(key).toLowerCase();
    if (k === "g") return [7]; // C-g → keyboard-quit (BEL)
    if (k === "/") return [31]; // C-/ → undo (C-_)
    if (k.length === 1 && k >= "a" && k <= "z") return [k.charCodeAt(0) - 96];
    return null;
  }

  if (altKey) {
    // Alt+key → ESC prefix sequence; Emacs reads both bytes in one wait cycle
    if (key.length === 1) return [27, key.charCodeAt(0)];
    return null;
  }

  if (key === "Enter") return [13];
  if (key === "Backspace") return [127];
  if (key === "Delete") return [27, 91, 51, 126]; // VT sequence
  if (key === "Escape") return [27];
  if (key === "Tab") return [9];
  if (key === "ArrowUp") return [27, 91, 65];
  if (key === "ArrowDown") return [27, 91, 66];
  if (key === "ArrowRight") return [27, 91, 67];
  if (key === "ArrowLeft") return [27, 91, 68];
  if (key.length === 1) return [key.charCodeAt(0)];

  return null;
}
