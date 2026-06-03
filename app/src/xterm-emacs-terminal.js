// xterm.js integration for Emacs terminal output rendering.
// xterm.js is loaded as a global (Terminal) via CDN script tag in index.html.
// This module is the integration layer only — no Emacs semantics here.
//
// Input path: xterm onData → bytes → emacs-input-bytes (worker)
// Output path: terminal-output-bytes (worker) → writeBytes() → xterm.write()
//
// xterm is the renderer. Emacs owns all command semantics.
// Clipboard and kill-ring are deferred (separate Clipboard Service).

export function createXtermEmacsTerminal(container) {
  if (typeof window.Terminal === "undefined") {
    throw new Error("xterm.js Terminal global not found — check CDN script tag");
  }

  const term = new window.Terminal({
    convertEol: false,
    scrollback: 1000,
    fontFamily: "monospace",
    fontSize: 14,
    cols: 80,
    rows: 24,
  });

  term.open(container);
  // Auto-focus so keyboard input works immediately after terminal is shown.
  term.focus();

  let dataHandler = null;
  term.onData((data) => {
    if (dataHandler) dataHandler(data);
  });

  let focusedOnFirstOutput = false;
  return {
    writeBytes(bytes) {
      term.write(new Uint8Array(bytes));
      // Re-focus after first Emacs output arrives so keyboard is ready immediately.
      if (!focusedOnFirstOutput) {
        focusedOnFirstOutput = true;
        term.focus();
      }
    },
    // handler(data: string) — xterm's escape-sequence-encoded input string
    // Caller converts data to bytes via TextEncoder before sending to worker
    onData(handler) {
      dataHandler = handler;
    },
    dispose() {
      term.dispose();
    },
  };
}

// Convert xterm onData string to byte array for emacs-input-bytes message.
// xterm sends typed characters and escape sequences as a raw string.
// TextEncoder produces UTF-8 bytes, which Emacs reads from its tty input.
export function xtermDataToBytes(data) {
  return Array.from(new TextEncoder().encode(data));
}
