// End-to-end Git Smart HTTP through the real Chrome companion extension.
//
//   node tools/scripts/probe-git-http.mjs
//   node tools/scripts/probe-git-http.mjs --http
//   node tools/scripts/probe-git-http.mjs --public   (also clone a small public GitHub repo)
//   node tools/scripts/probe-git-http.mjs --fixture-only
//   node tools/scripts/probe-git-http.mjs --extension-only
//
// Requires built product/userland artifacts (npm run build after rebuilding),
// a Chrome build supporting Extensions.loadUnpacked, and host git. Everything
// writable lives in temporary directories: no user's Git remote or Chrome
// profile is accessed. A temporary copy of the extension grants loopback access
// solely for the disposable fixture. Production permissions remain unchanged.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createGitHttpFixture } from "../../tests/process/git-http-fixture.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const logPath = process.env.WASMACS_GIT_HTTP_LOG || join(repoRoot, "logs/git-http-probe.txt");
const fixtureOnly = process.argv.includes("--fixture-only");
const extensionOnly = process.argv.includes("--extension-only");
const plainHttp = process.argv.includes("--http");
const publicClone = process.argv.includes("--public");
const runFile = promisify(execFile);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evidence = [];

function pass(message) {
  evidence.push(`PASS ${message}`);
  console.log(`PASS ${message}`);
}

class CdpClient {
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

async function evaluate(client, sessionId, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitUntil(check, label, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await check();
    if (result) return result;
    await pause(100);
  }
  throw new Error(`timed out: ${label}`);
}

function devToolsUrl(child) {
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

async function availablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function nativeFixtureCheck(fixture) {
  const clone = join(fixture.directory, "native-clone");
  const git = async (...args) => (await runFile("git", args, {
    cwd: fixture.directory,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  })).stdout.trim();
  const config = ["-c", "http.sslVerify=false", "-c", `http.extraHeader=Authorization: ${fixture.authorization}`];
  await git(...config, "clone", "-q", fixture.url, clone);
  assert.equal(await git("-C", clone, "rev-parse", "HEAD"), fixture.initialCommit);
  assert.deepEqual(await readFile(join(clone, "binary.bin")), fixture.binary);
  const advanced = await fixture.advance();
  await git("-C", clone, ...config, "fetch", "origin");
  assert.equal(await git("-C", clone, "rev-parse", "origin/main"), advanced);
  await git("-C", clone, "merge", "--ff-only", "origin/main");
  await writeFile(join(clone, "pushed.txt"), "native fixture proof\n");
  await git("-C", clone, "add", "pushed.txt");
  await git("-C", clone, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "-m", "fixture push");
  await git("-C", clone, ...config, "push", "origin", "main");
  assert.equal(fixture.head(), await git("-C", clone, "rev-parse", "HEAD"));
  assert.equal(fixture.readFile("pushed.txt"), "native fixture proof");
  pass("fixture: native Git clone, binary contents, incremental fetch, authenticated push and remote ref");
}

const fixture = await createGitHttpFixture({ requireAuth: !plainHttp, tls: !plainHttp });
let workDir, chrome, appServer, client, sessionId, extensionSessionId, screen;
try {
  if (fixtureOnly) {
    await nativeFixtureCheck(fixture);
  } else {
    workDir = await mkdtemp(join(tmpdir(), "wasmacs-git-browser-"));
    const extensionPath = join(workDir, "extension");
    await cp(join(repoRoot, "extension"), extensionPath, { recursive: true });
    const manifestPath = join(extensionPath, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.host_permissions.push(`${plainHttp ? "http" : "https"}://127.0.0.1/*`);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const port = await availablePort();
    const appUrl = new URL(process.env.WASMACS_BROWSER_URL || `http://127.0.0.1:${port}/app/xterm-atomics-pdump.html`);
    appUrl.searchParams.set("clear-storage", "1");
    appUrl.searchParams.set("network-transport", "extension");
    if (!process.env.WASMACS_BROWSER_URL) {
      appServer = spawn(process.execPath, ["tools/scripts/serve-app.mjs"], {
        cwd: repoRoot, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"],
      });
      await waitUntil(async () => {
        try { return (await fetch(appUrl, { method: "HEAD" })).ok; } catch { return false; }
      }, "app server");
    }
    chrome = spawn(chromePath, [
      "--headless=new", "--disable-gpu", "--js-flags=--stack_size=65500",
      // Only this temporary browser profile accepts our disposable TLS cert.
      "--ignore-certificate-errors",
      "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0",
      "--enable-unsafe-extension-debugging", `--user-data-dir=${join(workDir, "profile")}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    client = new CdpClient(await devToolsUrl(chrome));
    const { id: extensionId } = await client.send("Extensions.loadUnpacked", { path: extensionPath });
    assert.ok(extensionId, "Chrome returned an extension ID");
    const target = await waitUntil(async () => {
      const { targetInfos } = await client.send("Target.getTargets");
      return targetInfos.find((item) => item.type === "service_worker" && item.url.startsWith(`chrome-extension://${extensionId}/`));
    }, "extension service worker");
    ({ sessionId: extensionSessionId } = await client.send("Target.attachToTarget", { targetId: target.targetId, flatten: true }));
    await client.send("Runtime.enable", {}, extensionSessionId);
    await waitUntil(() => evaluate(client, extensionSessionId,
      "typeof chrome !== 'undefined' && !!chrome.storage?.local").catch(() => false), "extension execution context");
    await evaluate(client, extensionSessionId, `chrome.storage.local.set(${JSON.stringify({
      allowedCallerOrigins: [appUrl.origin],
      targetAllowlist: [`${fixture.origin}/*`, ...(publicClone ? ["https://github.com/*"] : [])],
      allowPrivateNetworkTargets: true,
      allowCredentials: true,
      auditLog: [],
      auditLogLimit: 200,
    })}).then(() => true)`);
    pass("Chrome loaded the actual companion with an isolated test allowlist");

    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
    ({ sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true }));
    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.enable", {}, sessionId);
    client.onEvent = (event) => {
      if (event.method === "Runtime.exceptionThrown") {
        evidence.push(`BROWSER_EXCEPTION ${event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text}`);
      }
    };
    // Fail closed in the test even if the page selector regresses: direct fetch
    // and the development proxy cannot silently replace the extension path.
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `{
      const nativeFetch = globalThis.fetch.bind(globalThis);
      globalThis.__gitHttpFallbackAttempts = 0;
      globalThis.fetch = (input, init) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
        if (url.origin === ${JSON.stringify(fixture.origin)} || url.pathname === '/__wasmacs_network_fetch') {
          globalThis.__gitHttpFallbackAttempts++;
          return Promise.reject(new Error('Git HTTP test forbids page/proxy fallback'));
        }
        return nativeFetch(input, init);
      };
    }` }, sessionId);
    await client.send("Page.navigate", { url: appUrl.href }, sessionId);
    await waitUntil(() => evaluate(client, sessionId,
      "document.readyState === 'complete' && window.crossOriginIsolated && !!document.querySelector('#start-btn')").catch(() => false), "app page ready", 60_000);

    if (extensionOnly) {
      const response = await evaluate(client, sessionId, `new Promise((resolve, reject) => {
        const requestId = 'git-http-extension-proof';
        const timer = setTimeout(() => reject(new Error('extension response timeout')), 10000);
        const onMessage = (event) => {
          if (event.source !== window || event.data?.requestId !== requestId) return;
          if (event.data.type !== 'WASMACS_PROXY_RESPONSE') return;
          clearTimeout(timer); window.removeEventListener('message', onMessage); resolve(event.data);
        };
        window.addEventListener('message', onMessage);
        window.postMessage({ type: 'WASMACS_PROXY_REQUEST', version: 1, requestId,
          request: { url: ${JSON.stringify(`${fixture.url}/info/refs?service=git-upload-pack`)}, method: 'GET',
          headers: ${JSON.stringify(plainHttp ? {} : { authorization: fixture.authorization })}, responseType: 'arrayBuffer' }
        }, location.origin);
      })`);
      assert.equal(response.ok, true, JSON.stringify(response.error));
      assert.equal(response.response.status, 200);
      assert.ok(Buffer.from(response.response.bodyBase64, "base64").includes(Buffer.from("# service=git-upload-pack")));
      pass(`extension: ${plainHttp ? "HTTP" : "authenticated HTTPS"} Smart HTTP discovery from the real browser`);
    } else {
      screen = async () => (await evaluate(client, sessionId, "window.__wasmacsDebugScreenText()"))
        .split("\n").map((line) => line.trimEnd()).join("\n");
      const keys = (text) => evaluate(client, sessionId,
        `window.__wasmacsDebugSendInputBytes(${JSON.stringify([...Buffer.from(text, "latin1")])}); true`);
      const waitScreen = async (pattern, label, timeoutMs = 60_000) => {
        try {
          await waitUntil(async () => {
            const text = await screen();
            if (pattern.test(text)) return true;
            if (/^fatal:|^error:|RuntimeError:|^Aborted/m.test(text)) throw new Error(`command failed: ${label}`);
            return false;
          }, label, timeoutMs);
        }
        catch (error) { throw new Error(`${error.message}\n${await screen()}`); }
        pass(label);
      };
      await evaluate(client, sessionId, "document.querySelector('#start-btn').click(); true");
      await waitUntil(() => evaluate(client, sessionId, "document.querySelector('#status')?.classList.contains('interactive')"), "Emacs boot", 180_000);
      await waitScreen(/\*scratch\*/, "actual Emacs command loop booted");
      // Scope the disposable authentication header to the one fixture URL.
      // Inject via Lisp before opening a shell so no credential appears in its
      // scrollback or in any failing command's diagnostics.
      if (!plainHttp) {
        const config = `[http "${fixture.url}"]\n\textraHeader = Authorization: ${fixture.authorization}\n`;
        await keys(`\x1b:(with-temp-file "/home/user/.gitconfig" (insert ${JSON.stringify(config)}))\r`);
        await pause(300);
      }
      await keys("\x1bxshell\r");
      await waitScreen(/^\S* ?[#$]$/m, "M-x shell prompt");
      await keys(`git clone ${fixture.url} /home/user/http-repo && cd /home/user/http-repo && echo clone-$(git rev-parse HEAD)\r`);
      await waitScreen(new RegExp(`^clone-${fixture.initialCommit}$`, "m"), "clone checks out the exact advertised commit", 120_000);
      const binaryHash = createHash("sha256").update(fixture.binary).digest("hex");
      await keys("echo binary-$(sha256sum binary.bin | cut -d' ' -f1)\r");
      await waitScreen(new RegExp(`^binary-${binaryHash}$`, "m"), "full binary file checksum survives the Git HTTP transport");
      const advanced = await fixture.advance();
      await keys("git fetch origin && echo fetch-$(git rev-parse origin/main)\r");
      await waitScreen(new RegExp(`^fetch-${advanced}$`, "m"), "fetch receives a newly created server commit", 120_000);
      await keys("git merge --ff-only origin/main && echo pushed-from-wasm > pushed.txt && git add pushed.txt && git commit -q -m wasm-push && git push origin main && echo push-$(git rev-parse HEAD)\r");
      await waitScreen(/^push-[0-9a-f]{40}$/m, "push finishes through the companion", 120_000);
      const pushed = /^push-([0-9a-f]{40})$/m.exec(await screen())[1];
      assert.equal(fixture.head(), pushed, "server branch equals wasm HEAD");
      assert.equal(fixture.readFile("pushed.txt"), "pushed-from-wasm");
      pass("server ref and pushed blob match the wasm commit");
      const competing = await fixture.advance();
      await keys("echo local-only > conflict.txt && git add conflict.txt && git commit -q -m local-divergence; git push origin main > /tmp/rejected-push.log 2>&1; echo rejected-push-$?\r");
      await waitScreen(/^rejected-push-[1-9][0-9]*$/m, "non-fast-forward push returns failure", 120_000);
      assert.equal(fixture.head(), competing, "rejected push leaves the remote branch unchanged");
      pass("rejected push preserves the independently advanced remote ref");
      await keys("i=0; n=0; while [ $i -lt 3 ]; do git fetch origin && n=$((n + 1)); i=$((i + 1)); done; echo repeated-fetch-$((n * 2))\r");
      await waitScreen(/^repeated-fetch-6$/m, "three more fetches complete in the same Emacs session", 120_000);
      fixture.delayNextRequest();
      await keys('\x1b:(call-process "git" nil nil nil "-C" "/home/user/http-repo" "fetch" "origin")\r');
      await waitUntil(() => fixture.delayedRequests.length === 1, "synchronous Git fetch reaches delayed HTTP request");
      await keys("\x07");
      await waitScreen(/Quit/, "C-g interrupts synchronous Git HTTP wait", 10_000);
      await waitUntil(() => fixture.delayedRequests[0].closed, "cancel closes the in-flight HTTP request", 10_000);
      pass("C-g aborts the actual extension fetch connection");
      await keys("git fetch origin && echo cancel-recovery-$((21 * 2))\r");
      await waitScreen(/^cancel-recovery-42$/m, "Git fetch works after C-g cancellation", 60_000);
      fixture.delayNextRequest();
      await keys("git fetch origin\r");
      await waitUntil(() => fixture.delayedRequests.length === 2, "asynchronous shell Git reaches delayed HTTP request");
      await keys("\x03\x03");
      await waitUntil(() => fixture.delayedRequests[1].closed, "C-c C-c closes shell Git HTTP request", 10_000);
      await keys("git fetch origin && echo interrupt-recovery-$((20 * 3))\r");
      await waitScreen(/^interrupt-recovery-60$/m, "C-c C-c interrupts shell Git and later fetch works", 60_000);
      if (publicClone) {
        await keys("git clone --depth 1 https://github.com/octocat/Hello-World.git /tmp/github-hello && test -s /tmp/github-hello/README && echo github-$(git -C /tmp/github-hello rev-parse HEAD)\r");
        await waitScreen(/^github-[0-9a-f]{40}$/m, "public GitHub shallow clone through the companion", 120_000);
      }
      assert.ok(fixture.requests.some((request) => request.method === "POST" && request.path.endsWith("/git-upload-pack") && request.status === 200 && request.requestBytes > 0));
      assert.ok(fixture.requests.some((request) => request.method === "POST" && request.path.endsWith("/git-receive-pack") && request.status === 200 && request.requestBytes > 0));
    }
    const audit = await evaluate(client, extensionSessionId, "chrome.storage.local.get('auditLog').then(value => value.auditLog || [])");
    assert.ok(audit.some((entry) => entry.url?.startsWith(fixture.origin) && entry.result === "ok"), "extension audit proves HTTP forwarding");
    if (!extensionOnly) {
      assert.ok(audit.some((entry) => entry.method === "POST" && entry.url?.endsWith("/git-receive-pack") && entry.result === "ok"), "extension audit proves the push POST");
      if (publicClone) assert.ok(audit.some((entry) => entry.url?.startsWith("https://github.com/octocat/Hello-World.git/") && entry.method === "POST" && entry.result === "ok"), "extension audit proves the public GitHub clone");
    }
    assert.equal(await evaluate(client, sessionId, "window.__gitHttpFallbackAttempts"), 0, "no page or proxy fallback was attempted");
    if (!plainHttp) assert.ok(fixture.requests.filter((request) => request.status === 200).every((request) => request.authenticated), "every successful request used the disposable credential");
    pass(`extension audit confirms ${audit.length} requests, with no direct/proxy fallback`);
  }
} catch (error) {
  // Redact the generated credential even if a browser/minibuffer error happens
  // to include it. Nothing from the real user's credentials is loaded.
  const message = String(error.stack || error).replaceAll(fixture.authorization, "<fixture authorization>")
    .replaceAll(fixture.password, "<fixture password>");
  evidence.push(`FAIL ${message}`);
  console.error(message);
  process.exitCode = 1;
} finally {
  evidence.push(`REQUESTS ${JSON.stringify(fixture.requests)}`);
  await mkdir(join(repoRoot, "logs"), { recursive: true });
  await writeFile(logPath, `${evidence.join("\n")}\n`);
  client?.close();
  if (chrome) {
    chrome.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), pause(2000)]);
  }
  appServer?.kill("SIGTERM");
  await fixture.close();
  if (workDir) await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
