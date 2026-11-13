import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { gzipSync, gunzipSync } from "node:zlib";
import { handleRuntimeMessage } from "../src/service-worker.js";

let nextId = 0;
function memoryStorage(initial = {}) {
  const state = { ...initial };
  return { state,
    get(keys, callback) { callback(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, state[key]]))); },
    set(value, callback) { Object.assign(state, value); callback(); },
  };
}

function envelope(request, requestId = `git-${++nextId}`, type = "WASMACS_PROXY_REQUEST") {
  return { channel: "WASMACS_COMPANION", callerOrigin: "http://localhost:8175",
    message: { type, version: 1, requestId, ...(request ? { request } : {}) } };
}

function gitRequest(overrides = {}) {
  return { url: "https://github.com/example/repo.git/git-upload-pack", method: "POST",
    headers: { "Content-Type": "application/x-git-upload-pack-request", "Git-Protocol": "version=2" },
    bodyBase64: Buffer.from([0, 255, 128, 10, 0]).toString("base64"), ...overrides };
}

test("Git RPC POST preserves binary bytes and version header in both directions", async () => {
  const request = gitRequest();
  const storage = memoryStorage();
  const response = await handleRuntimeMessage(envelope(request), { storage,
    fetchImpl: async (url, init) => {
      assert.equal(url, request.url);
      assert.equal(init.method, "POST");
      assert.equal(init.credentials, "omit");
      assert.equal(init.redirect, "error");
      assert.equal(init.headers["git-protocol"], "version=2");
      assert.deepEqual(new Uint8Array(init.body), new Uint8Array([0, 255, 128, 10, 0]));
      return new Response(new Uint8Array([255, 0, 128]), {
        headers: { "Content-Type": "application/x-git-upload-pack-result" },
      });
    } });
  assert.equal(response.ok, true);
  assert.deepEqual(Buffer.from(response.response.bodyBase64, "base64"), Buffer.from([255, 0, 128]));
  assert.equal(storage.state.auditLog[0].method, "POST");
  assert.equal(JSON.stringify(storage.state.auditLog).includes(request.bodyBase64), false);
});

test("POST requires a Git RPC endpoint, matching media type and a valid bounded body", async () => {
  const cases = [
    [gitRequest({ url: "https://github.com/example/delete" }), {}, "METHOD_NOT_ALLOWED"],
    [gitRequest({ headers: { "Content-Type": "text/plain" } }), {}, "METHOD_NOT_ALLOWED"],
    [gitRequest({ headers: { "Content-Type": "application/x-git-receive-pack-request" } }), {}, "METHOD_NOT_ALLOWED"],
    [gitRequest({ bodyBase64: null }), {}, "BAD_MESSAGE"],
    [gitRequest({ bodyBase64: "a!==" }), {}, "BAD_MESSAGE"],
    [gitRequest({ bodyBase64: "abc" }), {}, "BAD_MESSAGE"],
    [gitRequest(), { maxRequestBytes: 4 }, "REQUEST_TOO_LARGE"],
    [gitRequest({ method: "GET" }), {}, "BAD_MESSAGE"],
  ];
  for (const [request, options, expected] of cases) {
    const response = await handleRuntimeMessage(envelope(request), {
      storage: memoryStorage(options), fetchImpl: () => assert.fail("must not send a rejected request"),
    });
    assert.equal(response.error?.code, expected);
  }
});

test("large Git negotiations can use byte-preserving gzip POST encoding", async () => {
  const negotiation = Buffer.from("0032want " + "a".repeat(40) + "\n0000");
  const compressed = gzipSync(negotiation);
  const request = gitRequest({ headers: {
    "Content-Type": "application/x-git-upload-pack-request", "Content-Encoding": "gzip",
  }, bodyBase64: compressed.toString("base64") });
  const response = await handleRuntimeMessage(envelope(request), {
    storage: memoryStorage(), fetchImpl: async (_url, init) => {
      assert.equal(init.headers["content-encoding"], "gzip");
      assert.deepEqual(Buffer.from(init.body), compressed);
      assert.deepEqual(gunzipSync(Buffer.from(init.body)), negotiation);
      return new Response("0000");
    },
  });
  assert.equal(response.ok, true);
  for (const invalid of [
    { ...request, method: "GET", bodyBase64: null },
    { ...request, headers: { ...request.headers, "Content-Encoding": "br" } },
  ]) {
    const rejected = await handleRuntimeMessage(envelope(invalid), {
      storage: memoryStorage(), fetchImpl: () => assert.fail("invalid encoding must not be sent"),
    });
    assert.equal(rejected.error?.code, "HEADER_NOT_ALLOWED");
  }
});

test("explicit Authorization needs permission, an exact origin and HTTPS", async () => {
  const authorization = "Basic dXNlcjp0b2tlbg==";
  const request = gitRequest({ headers: [
    ["Content-Type", "application/x-git-upload-pack-request"], ["Authorization", authorization],
  ] });
  for (const [url, options] of [
    [request.url, {}],
    [request.url, { allowCredentials: true, targetAllowlist: ["https://*.com/*"] }],
    [request.url.replace("https:", "http:"), { allowCredentials: true, targetAllowlist: ["http://github.com/*"] }],
  ]) {
    const response = await handleRuntimeMessage(envelope({ ...request, url }), {
      storage: memoryStorage(options), fetchImpl: () => assert.fail("credentials must not be sent"),
    });
    assert.equal(response.error?.code, "CREDENTIALS_NOT_ALLOWED");
  }
  const storage = memoryStorage({ allowCredentials: true });
  const response = await handleRuntimeMessage(envelope(request), { storage,
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.authorization, authorization);
      assert.equal(init.credentials, "omit");
      assert.equal(init.redirect, "error");
      return new Response("authentication needed", { status: 401,
        headers: { "WWW-Authenticate": "Basic realm=Git", "Set-Cookie": "secret=1" } });
    } });
  assert.equal(response.ok, true);
  assert.equal(response.response.status, 401);
  assert.equal(response.response.headers["www-authenticate"], "Basic realm=Git");
  assert.equal(response.response.headers["set-cookie"], undefined);
  assert.equal(JSON.stringify(storage.state.auditLog).includes(authorization), false);
});

test("credentials in URLs are rejected and query strings are absent from audit logs", async () => {
  const storage = memoryStorage();
  const response = await handleRuntimeMessage(envelope({
    url: "https://user:SECRET@github.com/repo/info/refs?token=SECRET", method: "GET",
  }), { storage, fetchImpl: () => assert.fail("URL credentials must not be sent") });
  assert.equal(response.error?.code, "CREDENTIALS_NOT_ALLOWED");
  assert.equal(JSON.stringify(storage.state.auditLog).includes("SECRET"), false);
});

test("authenticated GET refuses redirects and unauthenticated discovery keeps its final URL", async () => {
  const response = await handleRuntimeMessage(envelope({
    url: "https://github.com/example/old.git/info/refs?service=git-upload-pack", method: "GET",
    headers: { Authorization: "Basic dXNlcjp0b2tlbg==" },
  }), { storage: memoryStorage({ allowCredentials: true }),
    fetchImpl: async (_url, init) => {
      assert.equal(init.redirect, "error");
      return new Response(null, { status: 307, headers: { Location: "https://evil.test/" } });
    } });
  assert.equal(response.error?.code, "REDIRECT_NOT_ALLOWED");
  const finalUrl = "https://github.com/example/new.git/info/refs?service=git-upload-pack";
  const redirected = await handleRuntimeMessage(envelope({
    url: "https://github.com/example/old.git/info/refs?service=git-upload-pack", method: "GET",
  }), { storage: memoryStorage(), fetchImpl: async (_url, init) => {
    assert.equal(init.redirect, "follow");
    const result = new Response("0000");
    Object.defineProperty(result, "url", { value: finalUrl });
    return result;
  } });
  assert.equal(redirected.response.url, finalUrl);
});

test("a real HTTP 307 cannot replay a Git push POST", async (t) => {
  const received = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({ url: request.url, body: Buffer.concat(chunks) });
    response.writeHead(307, { Location: "/replayed" });
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = gitRequest({ url: `${origin}/repo.git/git-receive-pack`,
    headers: { "Content-Type": "application/x-git-receive-pack-request" } });
  const result = await handleRuntimeMessage(envelope(request), {
    storage: memoryStorage({ allowPrivateNetworkTargets: true, targetAllowlist: [`${origin}/*`] }),
    fetchImpl: fetch,
  });
  assert.equal(result.error?.code, "FETCH_FAILED");
  assert.equal(received.length, 1);
  assert.equal(received[0].url, "/repo.git/git-receive-pack");
  assert.deepEqual(received[0].body, Buffer.from(request.bodyBase64, "base64"));
});

test("streaming response limits stop downloads without relying on Content-Length", async () => {
  let cancelled = false;
  let signal;
  const result = await handleRuntimeMessage(envelope(gitRequest()), {
    storage: memoryStorage({ maxResponseBytes: 3 }),
    fetchImpl: async (_url, init) => {
      signal = init.signal;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(4)); },
        cancel() { cancelled = true; },
      }));
    },
  });
  assert.equal(result.error?.code, "RESPONSE_TOO_LARGE");
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
});

test("cancellation is document scoped and aborts the original fetch", async () => {
  const requestId = `cancel-${++nextId}`;
  const storage = memoryStorage();
  const sender = { tab: { id: 17 }, documentId: "document-1", frameId: 0 };
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const pending = handleRuntimeMessage(envelope(gitRequest(), requestId), { storage, sender,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      started();
    }),
  });
  await ready;
  const cancel = envelope(null, requestId, "WASMACS_PROXY_CANCEL");
  const other = await handleRuntimeMessage(cancel, { storage, sender: { ...sender, documentId: "document-2" } });
  assert.equal(other.cancelled, false);
  const own = await handleRuntimeMessage(cancel, { storage, sender });
  assert.equal(own.type, "WASMACS_PROXY_CANCELLED");
  assert.equal(own.cancelled, true);
  assert.equal((await pending).error?.code, "FETCH_ABORTED");
  assert.equal((await handleRuntimeMessage(cancel, { storage, sender })).cancelled, false);
});

test("fetch timeout remains distinguishable from explicit cancellation", async () => {
  const response = await handleRuntimeMessage(envelope(gitRequest({ timeoutMs: 5 })), {
    storage: memoryStorage(), fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  });
  assert.equal(response.error?.code, "FETCH_TIMEOUT");
});

test("cancellation during settings loading prevents the POST from starting", async () => {
  const storage = memoryStorage();
  const get = storage.get;
  let finishLoading;
  storage.get = (keys, callback) => {
    storage.get = get;
    finishLoading = () => get(keys, callback);
  };
  const requestId = `early-cancel-${++nextId}`;
  const pending = handleRuntimeMessage(envelope(gitRequest(), requestId), {
    storage, fetchImpl: () => assert.fail("cancelled POST must not start"),
  });
  const cancelled = await handleRuntimeMessage(envelope(null, requestId, "WASMACS_PROXY_CANCEL"), { storage });
  assert.equal(cancelled.cancelled, true);
  finishLoading();
  assert.equal((await pending).error?.code, "FETCH_ABORTED");
});
