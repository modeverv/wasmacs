// Chrome DevTools Protocol helpers for probes that drive headless Chrome.
export const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class CdpClient {
  constructor(url) {
    this.sequence = 0;
    this.pending = new Map();
    this.opened = new Promise((resolve, reject) => {
      this.socket = new WebSocket(url);
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
      this.socket.addEventListener("close", () => {
        this.closed = true;
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("Chrome DevTools connection closed"));
        }
        this.pending.clear();
      });
      this.socket.addEventListener("message", ({ data }) => {
        const message = JSON.parse(data);
        if (!message.id) { this.onEvent?.(message); return; }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${message.error.message}: ${message.error.data || ""}`));
        else pending.resolve(message.result || {});
      });
    });
  }
  async send(method, params = {}, sessionId) {
    await this.opened;
    if (this.closed) throw new Error("Chrome DevTools connection closed");
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timed out: ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() {
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
    this.socket.close();
  }
}

export async function evaluate(client, sessionId, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

export async function waitUntil(check, label, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await check();
    if (result) return result;
    await pause(100);
  }
  throw new Error(`timed out: ${label}`);
}

export function devToolsUrl(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Chrome DevTools startup timed out: ${output.slice(-1000)}`)), 20_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Chrome exited (${code}): ${output.slice(-1000)}`)); });
  });
}
