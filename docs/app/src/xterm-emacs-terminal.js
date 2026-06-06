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

export function createXtermEmacsTerminal(container, options = {}) {
  if (typeof window.Terminal === "undefined") {
    throw new Error("xterm.js Terminal global not found — check CDN script tag");
  }

  const initialDimensions = normalizeTerminalDimensions(options.initialDimensions);

  const term = new window.Terminal({
    convertEol: false,
    scrollback: 1000,
    fontFamily: "monospace",
    fontSize: options.fontSize ?? DEFAULT_XTERM_FONT_SIZE,
    cols: initialDimensions.cols,
    rows: initialDimensions.rows,
  });
  const fitAddon = createFitAddon();
  if (fitAddon) term.loadAddon(fitAddon);

  term.open(container);
  // Auto-focus so keyboard input works immediately after terminal is shown.
  term.focus();

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

  let dataHandler = null;
  term.onData((data) => {
    if (dataHandler) dataHandler(data);
  });
  const controlKeyFallback = (event) => {
    const bytes = terminalKeyEventToBytes(event);
    if (!bytes || !dataHandler) return;
    event.preventDefault();
    event.stopPropagation();
    dataHandler(String.fromCharCode(...bytes));
  };
  container.addEventListener("keydown", controlKeyFallback, { capture: true });

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
    dispose() {
      container.removeEventListener("keydown", controlKeyFallback, { capture: true });
      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener("resize", fit);
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

export function controlKeyEventToBytes(event) {
  if (!event?.ctrlKey || event.altKey || event.metaKey) return null;
  if (typeof event.key !== "string" || event.key.length !== 1) return null;
  const code = event.key.toLowerCase().charCodeAt(0);
  if (code < 97 || code > 122) return null;
  return [code - 96];
}

export function terminalKeyEventToBytes(event) {
  const controlBytes = controlKeyEventToBytes(event);
  if (controlBytes) return controlBytes;
  if (event?.ctrlKey || event?.altKey || event?.metaKey) return null;
  if (event?.key === "ArrowUp") return [27, 91, 65];
  if (event?.key === "ArrowDown") return [27, 91, 66];
  if (event?.key === "ArrowRight") return [27, 91, 67];
  if (event?.key === "ArrowLeft") return [27, 91, 68];
  return null;
}
