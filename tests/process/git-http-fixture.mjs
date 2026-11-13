// A disposable Smart HTTP Git server backed by the host's real git-http-backend.
// It listens only on loopback, has no CORS headers, and never uses a user's repo
// or credentials. All writes and authentication secrets belong to the fixture.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function createGitHttpFixture({ requireAuth = false, tls = requireAuth } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "wasmacs-git-http-"));
  const repositories = join(directory, "repositories");
  const seed = join(directory, "seed");
  const bare = join(repositories, "test.git");
  await mkdir(repositories);
  const gitEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "wasmacs test", GIT_AUTHOR_EMAIL: "wasmacs-test@example.invalid",
    GIT_COMMITTER_NAME: "wasmacs test", GIT_COMMITTER_EMAIL: "wasmacs-test@example.invalid",
    GIT_TERMINAL_PROMPT: "0",
  };
  // Callers pass an argv array; shell syntax in test data is never evaluated.
  const git = (cwd, ...args) => execFileSync("git", args, {
    cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git(directory, "init", "-q", "-b", "main", seed);
  await writeFile(join(seed, "hello.txt"), "first commit\n");
  // Binary data exercises the base64 transport rather than text conversion.
  const binary = Buffer.from(Array.from({ length: 4096 }, (_, i) => i & 255));
  await writeFile(join(seed, "binary.bin"), binary);
  git(seed, "add", ".");
  git(seed, "commit", "-q", "-m", "initial");
  git(directory, "clone", "-q", "--bare", seed, bare);
  git(bare, "config", "http.receivepack", "true");
  git(seed, "remote", "add", "origin", bare);
  const initialCommit = git(bare, "rev-parse", "main");
  const username = "wasmacs-test";
  const password = randomBytes(24).toString("hex");
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  let serverRevision = 0;
  const requests = [];
  const delayedRequests = [];
  let delayNextRequest = false;
  const backends = new Set();
  let tlsOptions;
  if (tls) {
    const key = join(directory, "fixture.key");
    const cert = join(directory, "fixture.crt");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-keyout", key, "-out", cert, "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
    tlsOptions = { key: await readFile(key), cert: await readFile(cert) };
  }
  const handleRequest = async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const authenticated = request.headers.authorization === authorization;
    const record = { method: request.method, path: url.pathname, query: url.search, authenticated, status: null, requestBytes: 0 };
    requests.push(record);
    const finish = (status, message, headers = {}) => {
      record.status = status;
      response.writeHead(status, headers);
      response.end(message);
    };
    if (requireAuth && !authenticated) {
      request.resume();
      finish(401, "Authentication required", { "WWW-Authenticate": 'Basic realm="wasmacs-test"' });
      return;
    }
    if (!url.pathname.startsWith("/test.git/")) {
      request.resume();
      finish(404, "Not found");
      return;
    }
    if (delayNextRequest) {
      delayNextRequest = false;
      const delayed = { closed: false };
      delayedRequests.push(delayed);
      request.resume();
      response.once("close", () => { delayed.closed = true; });
      return;
    }
    const chunks = [];
    try {
      for await (const chunk of request) {
        record.requestBytes += chunk.length;
        if (record.requestBytes > 32 * 1024 * 1024) throw new Error("fixture request too large");
        chunks.push(chunk);
      }
      const input = Buffer.concat(chunks);
      const child = spawn("git", ["http-backend"], {
        cwd: directory,
        env: {
          ...gitEnv,
          GIT_PROJECT_ROOT: repositories,
          GIT_HTTP_EXPORT_ALL: "1",
          PATH_INFO: url.pathname,
          QUERY_STRING: url.search.slice(1),
          REQUEST_METHOD: request.method,
          CONTENT_TYPE: request.headers["content-type"] || "",
          CONTENT_LENGTH: String(input.length),
          REMOTE_ADDR: "127.0.0.1",
          REMOTE_USER: authenticated ? username : "",
          HTTP_GIT_PROTOCOL: request.headers["git-protocol"] || "",
          HTTP_CONTENT_ENCODING: request.headers["content-encoding"] || "",
          SERVER_PROTOCOL: "HTTP/1.1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      backends.add(child);
      child.once("close", () => backends.delete(child));
      let output = Buffer.alloc(0);
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (text) => { stderr += text; });
      child.stdout.on("data", (chunk) => { output = Buffer.concat([output, chunk]); });
      child.once("error", (error) => {
        if (!response.headersSent) finish(500, error.message);
      });
      child.once("close", (code) => {
        if (response.writableEnded) return;
        const split = output.indexOf("\r\n\r\n");
        if (code !== 0 || split < 0) {
          finish(500, `git-http-backend failed: ${stderr}`);
          return;
        }
        const headers = {};
        let status = 200;
        for (const line of output.subarray(0, split).toString().split("\r\n")) {
          const colon = line.indexOf(":");
          if (colon < 0) continue;
          const name = line.slice(0, colon).toLowerCase();
          const value = line.slice(colon + 1).trim();
          if (name === "status") status = Number(value.split(" ")[0]);
          else headers[name] = value;
        }
        record.status = status;
        response.writeHead(status, headers);
        response.end(output.subarray(split + 4));
      });
      child.stdin.end(input);
    } catch (error) {
      if (!response.headersSent) finish(500, error.message);
    }
  };
  const server = tls ? createHttpsServer(tlsOptions, handleRequest) : createServer(handleRequest);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `${tls ? "https" : "http"}://127.0.0.1:${server.address().port}`;
  return {
    directory, repositories, bare, seed, initialCommit, binary,
    origin, url: `${origin}/test.git`, username, password, authorization, requests, tls,
    delayedRequests,
    delayNextRequest() { delayNextRequest = true; },
    git,
    head: () => git(bare, "rev-parse", "main"),
    readFile: (name, ref = "main") => git(bare, "show", `${ref}:${name}`),
    async advance() {
      // The host seed produces a new remote commit for a real incremental fetch.
      git(seed, "fetch", "-q", "origin");
      git(seed, "reset", "--hard", "origin/main");
      await writeFile(join(seed, "hello.txt"), `server revision ${++serverRevision}\n`);
      git(seed, "add", "hello.txt");
      git(seed, "commit", "-q", "-m", `server update ${serverRevision}`);
      git(seed, "push", "-q", "origin", "main");
      return git(seed, "rev-parse", "HEAD");
    },
    async close() {
      for (const backend of backends) backend.kill("SIGTERM");
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
