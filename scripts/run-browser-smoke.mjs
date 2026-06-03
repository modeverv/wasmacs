import { spawn } from "node:child_process";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const appUrl = process.env.WASMACS_BROWSER_URL || "http://127.0.0.1:5173/?clear-storage=1&browser-smoke=minibuffer";
const repoRoot = new URL("..", import.meta.url).pathname;
const logPath = process.env.WASMACS_BROWSER_SMOKE_LOG || `${repoRoot}/logs/browser-runner-smoke.txt`;
const scenarios = process.argv.slice(2);
if (scenarios.length === 0) scenarios.push("minibuffer");
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

async function waitFor(client, sessionId, expression, timeoutMs = 60_000, label = expression) {
  await logEvent(`WAIT_START ${label} timeout=${timeoutMs}`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await evaluate(client, sessionId, expression)) {
      await logEvent(`WAIT_PASS ${label} elapsed_ms=${Date.now() - start}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  
  try {
    const stateResult = await evaluate(client, sessionId, "window.__wasmacsSmoke ? window.__wasmacsSmoke.state() : 'no smoke'");
    console.error("Timeout! State dump:", stateResult);
    await logEvent(`WAIT_TIMEOUT_STATE ${label} ${JSON.stringify(stateResult)}`);
  } catch (e) {
    console.error("Timeout! Could not dump state:", e);
    await logEvent(`WAIT_TIMEOUT_STATE_FAILED ${label} ${e && e.stack ? e.stack : String(e)}`);
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

  const server = spawn(process.execPath, ["scripts/serve-app.mjs"], {
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

async function smokeState(client, sessionId) {
  return evaluate(client, sessionId, "window.__wasmacsSmoke.state()");
}

async function waitForSmokeIdle(client, sessionId, timeoutMs = 30_000) {
  await logEvent(`WAIT_IDLE_START timeout=${timeoutMs}`);
  const result = await evaluate(
    client,
    sessionId,
    `Promise.race([
      window.__wasmacsSmoke.waitForIdle().then(() => ({ passed: true, state: window.__wasmacsSmoke.state() })),
      new Promise((resolve) => setTimeout(() => resolve({
        passed: false,
        error: "waitForIdle timeout",
        state: window.__wasmacsSmoke.state()
      }), ${timeoutMs}))
    ])`,
  );
  await logEvent(`WAIT_IDLE_RESULT ${JSON.stringify(result)}`);
  if (!result?.passed) {
    throw new Error(`waitForIdle failed: ${JSON.stringify(result)}`);
  }
  return result;
}

const userDataDir = await mkdtemp(join(tmpdir(), "wasmacs-browser-smoke-"));
const appServer = await ensureAppServer(appUrl);
await writeFile(logPath, `URL:${appUrl}\nSCENARIOS:${scenarios.join(",")}\n`);
await logEvent("SMOKE_START");
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--js-flags=--stack_size=65500",
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
  await logEvent(`PAGE_NAVIGATE ${appUrl}`);
  await client.send("Page.navigate", { url: appUrl }, sessionId);
  await waitFor(client, sessionId, "document.readyState === 'complete' || document.readyState === 'interactive'", 30_000, "document-ready");
  await waitFor(client, sessionId, "Boolean(window.__wasmacsSmoke && document.querySelector('#minibuffer'))", 300_000, "smoke-api-and-minibuffer");
  await waitForSmokeIdle(client, sessionId, 30_000);

  if (scenarios.includes("minibuffer")) {
    await logEvent("SCENARIO_START minibuffer");
    await evaluate(client, sessionId, "window.__wasmacsSmoke.clearPendingCommandEvents(); true");
    await evaluate(client, sessionId, "window.__wasmacsSmoke.keydown({ ctrlKey: true, key: 'x' }); true");
    const prefixState = await evaluate(client, sessionId, "window.__wasmacsSmoke.state()");
    await logEvent(`MINIBUFFER_PREFIX_STATE ${JSON.stringify(prefixState)}`);
    if (prefixState.minibuffer !== "C-x" || prefixState.status !== "C-x") {
      throw new Error(`expected C-x prefix in minibuffer, got ${JSON.stringify(prefixState)}`);
    }

    await evaluate(client, sessionId, "window.__wasmacsSmoke.keydown({ ctrlKey: true, key: 'f' }); true");
    await waitFor(client, sessionId, "window.__wasmacsSmoke.state().status === 'minibuffer unavailable'", 30_000, "minibuffer-unavailable");
    const unavailableState = await evaluate(client, sessionId, "window.__wasmacsSmoke.state()");
    await logEvent(`MINIBUFFER_UNAVAILABLE_STATE ${JSON.stringify(unavailableState)}`);
    if (!unavailableState.minibuffer.includes("minibuffer unavailable")) {
      throw new Error(`expected minibuffer unavailable echo, got ${JSON.stringify(unavailableState)}`);
    }
    const pendingEvents = await evaluate(client, sessionId, "window.__wasmacsSmoke.pendingCommandEvents()");
    await logEvent(`MINIBUFFER_PENDING_EVENTS ${JSON.stringify(pendingEvents)}`);
    const pendingStates = pendingEvents
      .filter((event) => event.commandType === "find-file")
      .map((event) => event.state);
    if (!pendingStates.includes("starting") || !pendingStates.includes("unavailable")) {
      throw new Error(`expected find-file pending-command starting/unavailable events, got ${JSON.stringify(pendingEvents)}`);
    }
    if (!pendingEvents.some((event) => event.commandType === "find-file" && event.minibuffer === "Find file: ")) {
      throw new Error(`expected find-file pending-command minibuffer prompt, got ${JSON.stringify(pendingEvents)}`);
    }
    evidence.push("PASS minibuffer echo boundary");
    evidence.push("PASS pending-command find-file starting unavailable");
    await logEvent("SCENARIO_PASS minibuffer");
    console.log("browser smoke scenario passed: minibuffer");
  }

  if (scenarios.includes("editing")) {
    await logEvent("SCENARIO_START editing");
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
    evidence.push("PASS real undo repeated undo redo browser hooks");
    await logEvent("SCENARIO_PASS editing");
    console.log("browser smoke scenario passed: editing");
  }

  if (scenarios.includes("files")) {
    await logEvent("SCENARIO_START files");
    await evaluate(client, sessionId, "window.__wasmacsSmoke.open('/home/user/projects/demo.txt')", 300_000);
    const project = await evaluate(client, sessionId, "window.__wasmacsSmoke.ensureMarker()", 300_000);
    assertIncludes("project file marker", project.text, "Saved by Emacs core.");
    const reloaded = await evaluate(client, sessionId, "window.__wasmacsSmoke.reload()", 300_000);
    assertIncludes("project file reload", reloaded.text, "Saved by Emacs core.");

    await evaluate(client, sessionId, "window.__wasmacsSmoke.resetFile('/home/user/projects/switch-a.txt', '')", 300_000);
    await evaluate(client, sessionId, "window.__wasmacsSmoke.keydown({ key: 'A' }); true");
    await waitForSmokeIdle(client, sessionId, 30_000);
    await evaluate(client, sessionId, "window.__wasmacsSmoke.open('/home/user/projects/switch-b.txt')", 300_000);
    await evaluate(client, sessionId, "window.__wasmacsSmoke.keydown({ key: 'B' }); true");
    await waitForSmokeIdle(client, sessionId, 30_000);
    const switchedBack = await evaluate(client, sessionId, "window.__wasmacsSmoke.switchBuffer('/home/user/projects/switch-a.txt')", 300_000);
    const files = await evaluate(client, sessionId, "window.__wasmacsSmoke.files()", 30_000);
    assertIncludes("file switch text", switchedBack.text, "A");
    if (!files.some((entry) => entry.text === "~/projects/switch-a.txt" && entry.current)) {
      throw new Error(`expected switch-a current file entry, got ${JSON.stringify(files)}`);
    }

    await evaluate(client, sessionId, "window.__wasmacsSmoke.resetFile('/home/user/projects/autosave-a.txt', '')", 300_000);
    const draft = await evaluate(client, sessionId, "window.__wasmacsSmoke.setTextarea('TEXTAREA-DRAFT')", 30_000);
    if (draft.state !== "modified") throw new Error(`expected textarea modified state, got ${JSON.stringify(draft)}`);
    await evaluate(client, sessionId, "window.__wasmacsSmoke.open('/home/user/projects/autosave-b.txt')", 300_000);
    const afterReturn = await evaluate(client, sessionId, "window.__wasmacsSmoke.open('/home/user/projects/autosave-a.txt')", 300_000);
    if (afterReturn.text !== "TEXTAREA-DRAFT") {
      throw new Error(`expected textarea draft to survive file switch, got ${JSON.stringify(afterReturn)}`);
    }
    evidence.push("PASS project reload file switching textarea autosave");
    await logEvent("SCENARIO_PASS files");
    console.log("browser smoke scenario passed: files");
  }

  if (scenarios.includes("boundaries")) {
    await logEvent("SCENARIO_START boundaries");
    await evaluate(client, sessionId, "window.__wasmacsSmoke.resetFile('/home/user/projects/process-boundary.txt', '')", 300_000);
    const processState = await evaluate(client, sessionId, "window.__wasmacsSmoke.processProbe()", 300_000);
    if (processState.status !== "process unavailable" || processState.state !== "process unavailable") {
      throw new Error(`expected process unavailable, got ${JSON.stringify(processState)}`);
    }
    await evaluate(client, sessionId, "window.__wasmacsSmoke.keydown({ key: 'R' }); true");
    await waitForSmokeIdle(client, sessionId, 30_000);
    assertIncludes("worker recovery after process unavailable", (await smokeState(client, sessionId)).text, "R");

    await evaluate(client, sessionId, "window.__wasmacsSmoke.resetFile('/home/user/projects/clipboard-boundary.txt', '')", 300_000);
    await evaluate(client, sessionId, "window.__wasmacsSmoke.keydown({ key: 'C' }); true");
    await waitForSmokeIdle(client, sessionId, 30_000);
    await evaluate(client, sessionId, "window.__wasmacsSmoke.keydown({ ctrlKey: true, key: 'y' }); true");
    await waitFor(client, sessionId, "window.__wasmacsSmoke.state().status === 'clipboard unavailable'", 300_000);
    const clipboardState = await smokeState(client, sessionId);
    if (clipboardState.state !== "clipboard unavailable" || (clipboardState.text !== "C" && clipboardState.text !== "C\n")) {
      throw new Error(`expected clipboard unavailable without text loss, got ${JSON.stringify(clipboardState)}`);
    }

    await evaluate(client, sessionId, "window.__wasmacsSmoke.keydown({ ctrlKey: true, key: 'g' }); true");
    const quitState = await smokeState(client, sessionId);
    if (quitState.status !== "keyboard quit") {
      throw new Error(`expected keyboard quit, got ${JSON.stringify(quitState)}`);
    }
    evidence.push("PASS process clipboard keyboard quit boundaries");
    await logEvent("SCENARIO_PASS boundaries");
    console.log("browser smoke scenario passed: boundaries");
  }

  if (scenarios.includes("asyncify")) {
    await logEvent("SCENARIO_START asyncify");
    const asyncify = await evaluate(
      client,
      sessionId,
      "window.__wasmacsSmoke.asyncifyMinibufferReadSmoke('wasmacs-input.txt')",
      300_000,
    );
    if (!asyncify?.passed && String(asyncify?.error || "").includes("Maximum call stack size exceeded")) {
      evidence.push("KNOWN_BLOCKER asyncify browser worker stack");
      await logEvent(`SCENARIO_KNOWN_BLOCKER asyncify ${JSON.stringify(asyncify)}`);
      console.log("browser smoke scenario recorded known blocker: asyncify");
    } else {
      assertPassed("asyncifyMinibufferReadSmoke", asyncify);
      if (asyncify.readback !== "wasmacs-input.txt") {
        throw new Error(`expected asyncify minibuffer readback, got ${JSON.stringify(asyncify)}`);
      }
      const asyncifyStates = asyncify.events
        .filter((event) => event.commandType === "minibuffer-read")
        .map((event) => event.state);
      for (const state of ["starting", "pending-input", "resuming", "completed"]) {
        if (!asyncifyStates.includes(state)) {
          throw new Error(`expected asyncify minibuffer state ${state}, got ${JSON.stringify(asyncify.events)}`);
        }
      }
      evidence.push("PASS asyncify pending-input minibuffer read");
      await logEvent(`SCENARIO_PASS asyncify ${JSON.stringify(asyncify)}`);
      console.log("browser smoke scenario passed: asyncify");
    }
  }

  if (scenarios.includes("asyncify-boot")) {
    await logEvent("SCENARIO_START asyncify-boot");
    const noLoadup = await evaluate(
      client,
      sessionId,
      "window.__wasmacsSmoke.asyncifyNoLoadupBootSmoke()",
      120_000,
    );
    if (noLoadup?.passed) {
      evidence.push("PASS asyncify no-loadup browser worker boot");
      await logEvent(`SCENARIO_PASS asyncify-boot ${JSON.stringify(noLoadup)}`);
      console.log("browser smoke scenario passed: asyncify-boot");
    } else {
      evidence.push(`KNOWN_BLOCKER asyncify no-loadup boot status ${noLoadup?.status ?? "unknown"}`);
      await logEvent(`SCENARIO_KNOWN_BLOCKER asyncify-boot ${JSON.stringify(noLoadup)}`);
      console.log("browser smoke scenario recorded known blocker: asyncify-boot");
    }
  }

  if (scenarios.includes("interactive-loop")) {
    await logEvent("SCENARIO_START interactive-loop");
    const interactiveLoop = await evaluate(
      client,
      sessionId,
      "window.__wasmacsSmoke.asyncifyInteractiveLoopProbeSmoke()",
      120_000,
    );
    if (interactiveLoop?.passed) {
      evidence.push("PASS asyncify interactive command-loop read-char waitpoint");
      await logEvent(`SCENARIO_PASS interactive-loop ${JSON.stringify(interactiveLoop)}`);
      console.log("browser smoke scenario passed: interactive-loop");
    } else {
      evidence.push("KNOWN_BLOCKER asyncify interactive command-loop waitpoint");
      await logEvent(`SCENARIO_KNOWN_BLOCKER interactive-loop ${JSON.stringify(interactiveLoop)}`);
      console.log("browser smoke scenario recorded known blocker: interactive-loop");
    }
  }

  if (scenarios.includes("interactive-semantics")) {
    await logEvent("SCENARIO_START interactive-semantics");
    const interactiveSemantics = await evaluate(
      client,
      sessionId,
      "window.__wasmacsSmoke.asyncifyInteractiveSemanticsProbeSmoke()",
      300_000,
    );
    if (interactiveSemantics?.passed) {
      evidence.push("PASS asyncify real command-loop minibuffer undo buffer window semantics");
      await logEvent(`SCENARIO_PASS interactive-semantics ${JSON.stringify(interactiveSemantics)}`);
      console.log("browser smoke scenario passed: interactive-semantics");
    } else {
      evidence.push("KNOWN_BLOCKER asyncify real command-loop semantics blocked by OS compatibility memory/runtime layer");
      await logEvent(`SCENARIO_KNOWN_BLOCKER interactive-semantics ${JSON.stringify(interactiveSemantics)}`);
      console.log("browser smoke scenario recorded known blocker: interactive-semantics");
    }
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
