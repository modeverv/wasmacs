import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const appUrl = process.env.WASMACS_BROWSER_URL || "http://127.0.0.1:5173/?clear-storage=1&browser-smoke=minibuffer";
const scenarios = process.argv.slice(2);
if (scenarios.length === 0) scenarios.push("minibuffer");

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.opened = new Promise((resolve, reject) => {
      this.socket = new WebSocket(url);
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
      this.socket.addEventListener("message", (event) => this.receive(event.data));
    });
  }

  receive(data) {
    const message = JSON.parse(data);
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`${message.error.message}: ${message.error.data || ""}`));
    } else {
      pending.resolve(message.result || {});
    }
  }

  async send(method, params = {}, sessionId) {
    await this.opened;
    const id = this.nextId++;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify(payload));
    return result;
  }

  close() {
    this.socket.close();
  }
}

function waitForDevToolsUrl(process) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for Chrome DevTools URL")), 20_000);
    process.stderr.setEncoding("utf8");
    process.stderr.on("data", (chunk) => {
      const match = chunk.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[1]);
    });
    process.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before DevTools became ready: ${code}`));
    });
  });
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result.value;
}

async function waitFor(client, sessionId, expression, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await evaluate(client, sessionId, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${expression}`);
}

function assertPassed(name, result) {
  if (!result?.passed) {
    throw new Error(`${name} failed: ${JSON.stringify(result)}`);
  }
}

const userDataDir = await mkdtemp(join(tmpdir(), "wasmacs-browser-smoke-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=0",
  `--user-data-dir=${userDataDir}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let client;
try {
  const devToolsUrl = await waitForDevToolsUrl(chrome);
  client = new CdpClient(devToolsUrl);
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  await client.send("Page.enable", {}, sessionId);
  await client.send("Page.navigate", { url: appUrl }, sessionId);
  await waitFor(client, sessionId, "document.readyState === 'complete' || document.readyState === 'interactive'", 30_000);
  await waitFor(client, sessionId, "Boolean(window.__wasmacsSmoke && document.querySelector('#minibuffer'))", 300_000);

  if (scenarios.includes("minibuffer")) {
    await evaluate(client, sessionId, "window.__wasmacsSmoke.keydown({ ctrlKey: true, key: 'x' }); true");
    const prefixState = await evaluate(client, sessionId, "window.__wasmacsSmoke.state()");
    if (prefixState.minibuffer !== "C-x" || prefixState.status !== "C-x") {
      throw new Error(`expected C-x prefix in minibuffer, got ${JSON.stringify(prefixState)}`);
    }

    await evaluate(client, sessionId, "window.__wasmacsSmoke.keydown({ ctrlKey: true, key: 'f' }); true");
    await waitFor(client, sessionId, "window.__wasmacsSmoke.state().status === 'minibuffer unavailable'", 30_000);
    const unavailableState = await evaluate(client, sessionId, "window.__wasmacsSmoke.state()");
    if (!unavailableState.minibuffer.includes("minibuffer unavailable")) {
      throw new Error(`expected minibuffer unavailable echo, got ${JSON.stringify(unavailableState)}`);
    }
    console.log("browser smoke scenario passed: minibuffer");
  }

  if (scenarios.includes("editing")) {
    assertPassed(
      "realUndoSmoke",
      await evaluate(client, sessionId, "window.__wasmacsSmoke.realUndoSmoke()", 300_000),
    );
    assertPassed(
      "repeatedUndoSmoke",
      await evaluate(client, sessionId, "window.__wasmacsSmoke.repeatedUndoSmoke()", 300_000),
    );
    assertPassed(
      "redoSmoke",
      await evaluate(client, sessionId, "window.__wasmacsSmoke.redoSmoke()", 300_000),
    );
    console.log("browser smoke scenario passed: editing");
  }

  console.log(`browser smoke passed: ${scenarios.join(",")} ${appUrl}`);
} finally {
  if (client) client.close();
  chrome.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    chrome.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  await rm(userDataDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 200 });
}
