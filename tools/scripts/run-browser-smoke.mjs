import { spawn } from "node:child_process";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Drives the canonical app page in headless Chrome over the DevTools protocol.
//
//   node tools/scripts/run-browser-smoke.mjs [scenario...]     (default: xterm)
//
// Environment:
//   CHROME_PATH                        the Chrome binary
//   WASMACS_BROWSER_URL                page URL (default: the dev server, started if needed)
//   WASMACS_BROWSER_SMOKE_LOG          log file (default: logs/browser-runner-smoke.txt)
//   WASMACS_BROWSER_SMOKE_SPAWNS       processes started in a row by "shell" (default 300)
//   WASMACS_BROWSER_SMOKE_SCREENSHOT   write a PNG of the page at the end of "shell"
//   WASMACS_BROWSER_JS_FLAGS           extra V8 flags, e.g. --expose-gc
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const repoRoot = new URL("../..", import.meta.url).pathname;
const logPath = process.env.WASMACS_BROWSER_SMOKE_LOG || `${repoRoot}/logs/browser-runner-smoke.txt`;
// Scenarios run against the canonical app page (Atomics + pdump).  The
// scenarios of the retired textarea app live in
// archive/retired/textarea-app-command-bridge/tools/scripts/run-browser-smoke.legacy-scenarios.mjs.
//   xterm    the page boots Emacs from the bundled pdmp and reaches its idle wait
//   shell    on top of that: M-x shell, git, a pipeline through GNU grep,
//            C-c C-c, C-g during a blocking call-process, M-x grep, hundreds
//            of processes in a row, and Emacs really sleeps while idle
//   persist  a git repository made in /home/user is still there, clean and
//            with its executable bits, after the page is loaded again
const knownScenarios = new Set(["xterm", "shell", "persist"]);
const scenarios = process.argv.slice(2);
if (scenarios.length === 0) scenarios.push("xterm");
for (const scenario of scenarios) {
  if (!knownScenarios.has(scenario)) {
    console.error(`unknown browser smoke scenario: ${scenario} (known: ${[...knownScenarios].join(", ")})`);
    process.exit(2);
  }
}
const defaultAppPath = "/app/xterm-atomics-pdump.html?clear-storage=1";
const appUrl = process.env.WASMACS_BROWSER_URL || `http://127.0.0.1:5173${defaultAppPath}`;
const evidence = [];

async function logEvent(message) {
  await appendFile(logPath, `[${new Date().toISOString()}] ${message}\n`);
}

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
    if (!message.id) {
      if (this.onEvent && message.method) this.onEvent(message.method, message.params || {}, message.sessionId);
      return;
    }
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

async function waitFor(client, sessionId, expression, timeoutMs = 60_000, label = expression) {
  await logEvent(`WAIT_START ${label} timeout=${timeoutMs}`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // The page may be reloading (coi-serviceworker does that once): an
    // evaluation that fails is "not yet".
    if (await evaluate(client, sessionId, expression).catch(() => false)) {
      await logEvent(`WAIT_PASS ${label} elapsed_ms=${Date.now() - start}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  
  throw new Error(`timed out waiting for ${expression}`);
}

async function isAppServerReady(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureAppServer(url) {
  const origin = new URL(url).origin;
  if (await isAppServerReady(origin)) return undefined;

  const server = spawn(process.execPath,  ["tools/scripts/serve-app.mjs"], {
    cwd: repoRoot,
    env: { ...process.env, PORT: new URL(origin).port || "5173" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    if (await isAppServerReady(origin)) return server;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  server.kill("SIGTERM");
  throw new Error(`timed out waiting for app server at ${origin}`);
}

function assertPassed(name, result) {
  if (!result?.passed) {
    throw new Error(`${name} failed: ${JSON.stringify(result)}`);
  }
}

function assertIncludes(name, value, needle) {
  if (!String(value).includes(needle)) {
    throw new Error(`${name} expected ${JSON.stringify(value)} to include ${JSON.stringify(needle)}`);
  }
}

const userDataDir = await mkdtemp(join(tmpdir(), "wasmacs-browser-smoke-"));
const appServer = await ensureAppServer(appUrl);
await writeFile(logPath, `URL:${appUrl}\nSCENARIOS:${scenarios.join(",")}\n`);
await logEvent("SMOKE_START");
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  `--js-flags=--stack_size=65500${process.env.WASMACS_BROWSER_JS_FLAGS ? ` ${process.env.WASMACS_BROWSER_JS_FLAGS}` : ""}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=0",
  `--user-data-dir=${userDataDir}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let client;
try {
  await logEvent("CHROME_WAIT_DEVTOOLS");
  const devToolsUrl = await waitForDevToolsUrl(chrome);
  await logEvent(`CHROME_DEVTOOLS ${devToolsUrl}`);
  client = new CdpClient(devToolsUrl);
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  await client.send("Page.enable", {}, sessionId);
  // Warnings and errors of the page and of its workers (Emacs runs in one)
  // go to the log: that is where a failing scenario explains itself.
  client.onEvent = (method, params, eventSession) => {
    if (method === "Target.attachedToTarget") {
      client.send("Runtime.enable", {}, params.sessionId).catch(() => {});
      client.send("Runtime.runIfWaitingForDebugger", {}, params.sessionId).catch(() => {});
    } else if (method === "Runtime.consoleAPICalled" && (params.type === "warning" || params.type === "error")) {
      const text = (params.args || []).map((arg) => arg.value ?? arg.description ?? "").join(" ");
      logEvent(`CONSOLE ${eventSession === sessionId ? "page" : "worker"} ${params.type}: ${text.slice(0, 600)}`).catch(() => {});
    } else if (method === "Runtime.exceptionThrown") {
      const details = params.exceptionDetails || {};
      logEvent(`EXCEPTION ${eventSession === sessionId ? "page" : "worker"}: ${(details.exception?.description || details.text || "").slice(0, 600)}`).catch(() => {});
    }
  };
  await client.send("Runtime.enable", {}, sessionId);
  await client.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
  // Rows keep the blanks Emacs wrote; compare without them.
  const screen = async () => (await evaluate(client, sessionId, "window.__wasmacsDebugScreenText()"))
    .split("\n").map((row) => row.trimEnd()).join("\n");
  const sendKeys = (text) => evaluate(client, sessionId,
    `window.__wasmacsDebugSendInputBytes(${JSON.stringify([...Buffer.from(text, "latin1")])}); true`);
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitForScreen = async (pattern, label, timeoutMs = 30_000) => {
    const start = Date.now();
    let text = "";
    while (Date.now() - start < timeoutMs) {
      text = await screen();
      if (pattern.test(text)) {
        await logEvent(`SCREEN_PASS ${label} elapsed_ms=${Date.now() - start}`);
        evidence.push(`PASS ${label} (${Date.now() - start}ms)`);
        return text;
      }
      await pause(100);
    }
    await logEvent(`SCREEN_FAIL ${label}\n${text}`);
    throw new Error(`timed out waiting for ${label}; screen:\n${text}`);
  };
  // Load the page and start Emacs (the Start button), until it is idle.
  const bootPage = async (label) => {
    await logEvent(`PAGE_NAVIGATE ${label} ${appUrl}`);
    await client.send("Page.navigate", { url: appUrl }, sessionId);
    // On a static host the service worker installs itself and reloads the
    // page before SharedArrayBuffer is available.
    await waitFor(client, sessionId, "document.readyState === 'complete' && window.crossOriginIsolated === true", 60_000, "cross-origin-isolated");
    await waitFor(client, sessionId, "Boolean(document.querySelector('#start-btn') && document.querySelector('#xterm-container'))", 30_000, "xterm-page-ready");
    await evaluate(client, sessionId, "document.querySelector('#start-btn').click(); true");
    await waitFor(client, sessionId, "document.querySelector('#status')?.classList.contains('interactive')", 180_000, "xterm-interactive-status");
    await waitForScreen(/\*scratch\*/, `${label}: emacs is up`, 60_000);
  };

  {
    await logEvent("SCENARIO_START xterm");
    await bootPage("boot");
    const xtermState = await evaluate(client, sessionId, `({
      status: document.querySelector('#status')?.textContent,
      className: document.querySelector('#status')?.className,
      pdmp: document.querySelector('#pdmp-status')?.textContent,
      binary: document.querySelector('#bin-info')?.textContent,
    })`);
    await logEvent(`XTERM_STATE ${JSON.stringify(xtermState)}`);
    if (!String(xtermState.binary || "").includes("emacs-browser-atomics-pdump")) {
      throw new Error(`expected Atomics pdump binary info, got ${JSON.stringify(xtermState)}`);
    }
    evidence.push("PASS xterm atomics pdump interactive");
    await logEvent("SCENARIO_PASS xterm");
    console.log("browser smoke scenario passed: xterm");
  }

  if (scenarios.includes("shell")) {
    await logEvent("SCENARIO_START shell");
    // Idle waits Emacs entered per second (each one posts a message).
    const idleWaitsPerSecond = async (label) => {
      const count = () => evaluate(client, sessionId, "window.__wasmacsDebugIdleWaitCount");
      const before = await count();
      await pause(3000);
      const rate = ((await count()) - before) / 3;
      await logEvent(`IDLE_WAITS ${label} ${rate.toFixed(1)}/s`);
      // Emacs's own timers wake it a few times per second at most; hundreds
      // would mean it is spinning instead of sleeping in Atomics.wait.
      if (rate > 20) throw new Error(`shell scenario: Emacs is not idle (${label}): ${rate.toFixed(1)} waits/s`);
      evidence.push(`PASS idle ${label} (${rate.toFixed(1)} waits/s)`);
    };

    await idleWaitsPerSecond("before any process");

    await sendKeys("\x1bxshell\r");
    await waitForScreen(/^\S* ?[#$]$/m, "M-x shell prompt", 60_000);
    await sendKeys("echo answer-$((6 * 7))\r");
    await waitForScreen(/^answer-42$/m, "command output");
    await sendKeys("git --version\r");
    await waitForScreen(/^git version 2\./m, "git runs from the shell", 60_000);
    await sendKeys("cd /tmp && git init -q demo && cd demo && echo hello > a.txt && git add a.txt && git commit -q -m first && git log --oneline | wc -l\r");
    await waitForScreen(/^1$/m, "git init, add, commit, log");
    await sendKeys("ls /bin | grep -c .\r");
    await waitForScreen(/^1[0-9][0-9]$/m, "pipeline through GNU grep", 60_000);
    await sendKeys("sleep 100\r");
    await pause(500);
    await sendKeys("\x03\x03");
    // The output can land right behind the prompt that the interrupt
    // brought back, so look for text that only the command's output has.
    await sendKeys("echo back-$((40 + 2))\r");
    await waitForScreen(/back-42$/m, "C-c C-c interrupts the job");

    // Emacs blocked in a synchronous subprocess still sees C-g.
    await sendKeys('\x1b:(call-process "sleep" nil nil nil "30")\r');
    await pause(700);
    await sendKeys("\x07");
    await waitForScreen(/Quit/, "C-g interrupts call-process", 10_000);

    await sendKeys("\x1bxgrep\r");
    await waitForScreen(/Run grep/, "M-x grep prompt");
    await sendKeys("root /etc/passwd\r");
    await waitForScreen(/Grep finished with 1 match found/, "M-x grep finds the line", 60_000);

    // Every process is a new wasm instance with its own memory: a few
    // hundred in a row must not exhaust the tab.
    await sendKeys("\x1bxshell\r");
    await pause(300);
    const spawnCount = Number(process.env.WASMACS_BROWSER_SMOKE_SPAWNS || 300);
    await sendKeys(`i=0; n=0; while [ $i -lt ${spawnCount} ]; do git --version > /dev/null && n=$((n + 1)); i=$((i + 1)); done; echo spawned-$((n * 2))\r`);
    await waitForScreen(/spawned-[0-9]+$/m, `${spawnCount} git processes in a row`, 300_000);
    const spawned = /spawned-([0-9]+)$/m.exec(await screen());
    if (!spawned || Number(spawned[1]) !== spawnCount * 2) {
      throw new Error(`shell scenario: only ${spawned ? Number(spawned[1]) / 2 : "?"} of ${spawnCount} processes ran`);
    }

    await idleWaitsPerSecond("after the processes");
    if (process.env.WASMACS_BROWSER_SMOKE_SCREENSHOT) {
      const shot = await client.send("Page.captureScreenshot", { format: "png" }, sessionId);
      await writeFile(process.env.WASMACS_BROWSER_SMOKE_SCREENSHOT, Buffer.from(shot.data, "base64"));
    }
    await logEvent("SCENARIO_PASS shell");
    console.log("browser smoke scenario passed: shell");
  }

  if (scenarios.includes("persist")) {
    await logEvent("SCENARIO_START persist");
    if (scenarios.includes("shell")) await bootPage("fresh boot");
    await sendKeys("\x1bxshell\r");
    await waitForScreen(/^\S* ?[#$]$/m, "persist: shell prompt", 60_000);
    await sendKeys("cd /home/user && git init -q repo && cd repo && printf '#!/bin/sh\\necho ran-$((20 + 3))\\n' > run.sh && chmod +x run.sh && echo text > notes.txt && git add . && git commit -q -m first && echo committed-$(git status --porcelain | wc -l)\r");
    await waitForScreen(/^committed-0$/m, "persist: repository created and clean");
    // /home/user is saved when Emacs goes idle; the page stores it.
    await pause(2500);

    await bootPage("second boot");
    await sendKeys("\x1bxshell\r");
    await waitForScreen(/^\S* ?[#$]$/m, "persist: shell prompt after reload", 60_000);
    await sendKeys("cd /home/user/repo && ls -l run.sh | cut -c1-10 && ./run.sh && echo status-$(git status --porcelain | wc -l)-log-$(git log --oneline | wc -l)\r");
    await waitForScreen(/^-rwxr-xr-x$/m, "persist: executable bit survived");
    await waitForScreen(/^ran-23$/m, "persist: script runs");
    await waitForScreen(/^status-0-log-1$/m, "persist: repository is clean after reload");
    await logEvent("SCENARIO_PASS persist");
    console.log("browser smoke scenario passed: persist");
  }

  console.log(`browser smoke passed: ${scenarios.join(",")} ${appUrl}`);
  await logEvent("SMOKE_PASS");
  await appendFile(logPath, `${evidence.join("\n")}\n`);
} catch (error) {
  await logEvent(`SMOKE_FAIL ${error && error.stack ? error.stack : String(error)}`);
  throw error;
} finally {
  await logEvent("SMOKE_CLEANUP");
  if (client) client.close();
  chrome.kill("SIGTERM");
  if (appServer) appServer.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    chrome.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  await rm(userDataDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 200 });
}
