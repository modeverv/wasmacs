// xterm.js integration for Emacs terminal output rendering.
// xterm.js is loaded as a global (Terminal) via CDN script tag in index.html.
// This module is the integration layer only — no Emacs semantics here.
//
// Input path: xterm onData → bytes → emacs-input-bytes (worker)
// Output path: terminal-output-bytes (worker) → writeBytes() → xterm.write()
//
// xterm is the renderer. Emacs owns all command semantics.
// Clipboard and kill-ring are deferred (separate Clipboard Service).

const DEFAULT_TERMINAL_DIMENSIONS = Object.freeze({ cols: 80, rows: 24 });
const MIN_TERMINAL_COLS = 20;
const MIN_TERMINAL_ROWS = 3;
export const DEFAULT_XTERM_FONT_SIZE = 20;
const FALLBACK_XTERM_THEME = Object.freeze({
  background: "#1e1e1e",
  foreground: "#d4d4d4",
  cursor: "#ffd866",
  cursorAccent: "#1e1e1e",
});

function normalizeTerminalDimensions(dimensions = {}) {
  const cols = Number.isInteger(dimensions.cols) ? dimensions.cols : DEFAULT_TERMINAL_DIMENSIONS.cols;
  const rows = Number.isInteger(dimensions.rows) ? dimensions.rows : DEFAULT_TERMINAL_DIMENSIONS.rows;
  return {
    cols: Math.max(MIN_TERMINAL_COLS, cols),
    rows: Math.max(MIN_TERMINAL_ROWS, rows),
  };
}

export function calculateFallbackTerminalDimensions({
  width,
  height,
  fontSize = DEFAULT_XTERM_FONT_SIZE,
  horizontalPadding = 0,
  verticalPadding = 0,
} = {}) {
  const usableWidth = Math.max(0, Number(width) - Number(horizontalPadding));
  const usableHeight = Math.max(0, Number(height) - Number(verticalPadding));
  const cellWidth = Math.max(1, Number(fontSize) * 0.62);
  const cellHeight = Math.max(1, Number(fontSize) * 1.35);
  return normalizeTerminalDimensions({
    cols: Math.floor(usableWidth / cellWidth),
    rows: Math.floor(usableHeight / cellHeight),
  });
}

function readContainerPadding(container) {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return { horizontalPadding: 0, verticalPadding: 0 };
  }
  const style = window.getComputedStyle(container);
  const left = Number.parseFloat(style.paddingLeft) || 0;
  const right = Number.parseFloat(style.paddingRight) || 0;
  const top = Number.parseFloat(style.paddingTop) || 0;
  const bottom = Number.parseFloat(style.paddingBottom) || 0;
  return {
    horizontalPadding: left + right,
    verticalPadding: top + bottom,
  };
}

function createFitAddon() {
  if (typeof window === "undefined") return null;
  if (typeof window.FitAddon?.FitAddon === "function") return new window.FitAddon.FitAddon();
  if (typeof window.FitAddon === "function") return new window.FitAddon();
  return null;
}

function readCssColor(name, fallback) {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return fallback;
  if (typeof document === "undefined" || !document.documentElement) return fallback;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function createXtermTheme() {
  return {
    background: readCssColor("--vscode-terminal-background", FALLBACK_XTERM_THEME.background),
    foreground: readCssColor("--vscode-terminal-foreground", FALLBACK_XTERM_THEME.foreground),
    cursor: readCssColor("--vscode-terminalCursor-foreground", FALLBACK_XTERM_THEME.cursor),
    cursorAccent: readCssColor("--vscode-terminalCursor-background", FALLBACK_XTERM_THEME.cursorAccent),
    selectionBackground: readCssColor("--vscode-terminal-selectionBackground", "#555555"),
  };
}

export function createXtermEmacsTerminal(container, options = {}) {
  if (typeof window.Terminal === "undefined") {
    throw new Error("xterm.js Terminal global not found — check CDN script tag");
  }

  const initialDimensions = normalizeTerminalDimensions(options.initialDimensions);
  let dataHandler = null;
  const captureEmacsKey = (event) => {
    const bytes = terminalKeyEventToBytes(event);
    if (!bytes || !dataHandler) return true;
    event.preventDefault();
    event.stopPropagation();
    dataHandler(String.fromCharCode(...bytes));
    return false;
  };

  const term = new window.Terminal({
    convertEol: false,
    cursorBlink: true,
    cursorStyle: "block",
    scrollback: 1000,
    fontFamily: "monospace",
    fontSize: options.fontSize ?? DEFAULT_XTERM_FONT_SIZE,
    cols: initialDimensions.cols,
    rows: initialDimensions.rows,
    macOptionIsMeta: true,
    theme: createXtermTheme(),
    customKeyEventHandler: captureEmacsKey,
  });
  const fitAddon = createFitAddon();
  if (fitAddon) term.loadAddon(fitAddon);

  term.open(container);
  // Auto-focus so keyboard input works immediately after terminal is shown.
  term.focus();

  // Bridge Emacs gui-set-selection (OSC 52, see term/xterm.el shim) to the
  // browser clipboard. Emacs writes "\e]52;c;<base64>\a" on M-w/C-w.
  const oscClipboardHandler = term.parser?.registerOscHandler?.(52, (data) => {
    const payload = decodeOsc52ClipboardPayload(data);
    if (payload === null) return false;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(payload).catch(() => {});
    }
    return true;
  });

  let currentDimensions = initialDimensions;
  const notifyResize = (dimensions) => {
    const next = normalizeTerminalDimensions(dimensions);
    if (next.cols === currentDimensions.cols && next.rows === currentDimensions.rows) return;
    currentDimensions = next;
    if (typeof options.onResize === "function") options.onResize(next);
  };
  const fit = () => {
    if (!container.isConnected) return currentDimensions;
    if (fitAddon) {
      fitAddon.fit();
      notifyResize({ cols: term.cols, rows: term.rows });
      return currentDimensions;
    }
    const fallbackDimensions = calculateFallbackTerminalDimensions({
      width: container.clientWidth,
      height: container.clientHeight,
      fontSize: term.options.fontSize,
      ...readContainerPadding(container),
    });
    term.resize(fallbackDimensions.cols, fallbackDimensions.rows);
    notifyResize(fallbackDimensions);
    return currentDimensions;
  };

  requestAnimationFrame(() => fit());
  let resizeObserver = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => fit());
    resizeObserver.observe(container);
  } else {
    window.addEventListener("resize", fit);
  }

  term.onData((data) => {
    if (dataHandler) dataHandler(data);
  });
  const emacsKeyFallback = (event) => {
    captureEmacsKey(event);
  };
  container.addEventListener("keydown", emacsKeyFallback, { capture: true });
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("keydown", emacsKeyFallback, { capture: true });
  }

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
    fit,
    getDimensions() {
      return currentDimensions;
    },
    focus() {
      term.focus();
    },
    dispose() {
      container.removeEventListener("keydown", emacsKeyFallback, { capture: true });
      if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
        document.removeEventListener("keydown", emacsKeyFallback, { capture: true });
      }
      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener("resize", fit);
      oscClipboardHandler?.dispose();
      term.dispose();
    },
  };
}

// Convert xterm onData string to byte array for emacs-input-bytes message.
// xterm sends typed characters and escape sequences as a raw string.
// TextEncoder produces UTF-8 bytes, which Emacs reads from its tty input.
export function xtermDataToBytes(data) {
  return Array.from(new TextEncoder().encode(stripBracketedPasteMarkers(data)));
}

export function stripBracketedPasteMarkers(data) {
  if (typeof data !== "string" || data === "") return data;
  return data.replaceAll("\x1b[200~", "").replaceAll("\x1b[201~", "");
}

// Decode an OSC 52 payload ("c;<base64>") emitted by gui-backend-set-selection
// into the clipboard text it carries. Returns null for selection types other
// than CLIPBOARD ("c"), paste queries ("?"), or malformed payloads.
export function decodeOsc52ClipboardPayload(data) {
  if (typeof data !== "string") return null;
  const sep = data.indexOf(";");
  if (sep === -1) return null;
  const kind = data.slice(0, sep);
  const base64 = data.slice(sep + 1);
  if (kind !== "c" || base64 === "?") return null;
  try {
    return new TextDecoder("utf-8").decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

export function controlKeyEventToBytes(event) {
  if (!event?.ctrlKey || event.altKey || event.metaKey) return null;
  if (event.key === " ") return [0];
  if (event.key === "[") return [27];
  if (event.key === "]") return [29];
  if (event.key === "\\") return [28];
  if (event.key === "^") return [30];
  if (event.key === "_") return [31];
  if (event.key === "?") return [127];
  if (typeof event.key !== "string" || event.key.length !== 1) return null;
  const code = event.key.toLowerCase().charCodeAt(0);
  if (code < 97 || code > 122) return null;
  return [code - 96];
}

//export function metaKeyEventToBytes(event) {
//  if (!event?.altKey || event.ctrlKey || event.metaKey) return null;
//  if (typeof event.key !== "string" || event.key.length !== 1) return null;
//  return [27, ...Array.from(new TextEncoder().encode(event.key))];
//}

function printableAsciiFromCode(event) {
  if (typeof event?.code !== "string") return null;

  if (/^Key[A-Z]$/.test(event.code)) {
    const ch = event.code.slice(3).toLowerCase();
    return event.shiftKey ? ch.toUpperCase() : ch;
  }

  if (/^Digit[0-9]$/.test(event.code)) {
    return event.code.slice(5);
  }

  return null;
}

export function metaKeyEventToBytes(event) {
  if (!event?.altKey || event.ctrlKey || event.metaKey || event.isComposing) {
    return null;
  }

  const ch = printableAsciiFromCode(event);

  if (ch) {
    return [27, ch.charCodeAt(0)];
  }

  // fallback: Optionで特殊文字化していない普通のASCIIだけ通す
  if (
    typeof event.key === "string" &&
    event.key.length === 1 &&
    event.key.charCodeAt(0) < 128
  ) {
    return [27, event.key.charCodeAt(0)];
  }

  return null;
}

export function terminalKeyEventToBytes(event) {
  const controlBytes = controlKeyEventToBytes(event);
  if (controlBytes) return controlBytes;
  const metaBytes = metaKeyEventToBytes(event);
  if (metaBytes) return metaBytes;
  if (event?.ctrlKey || event?.altKey || event?.metaKey) return null;
  if (event?.key === "Escape") return [27];
  if (event?.key === "Backspace") return [127];
  if (event?.key === "Enter") return [13];
  if (event?.key === "Tab") return [9];
  if (event?.key === "ArrowUp") return [27, 91, 65];
  if (event?.key === "ArrowDown") return [27, 91, 66];
  if (event?.key === "ArrowRight") return [27, 91, 67];
  if (event?.key === "ArrowLeft") return [27, 91, 68];
  return null;
}
