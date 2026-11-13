import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const kernelSource = read("src/runtime/process/wasmacs-kernel.js");
const httpSource = read("src/runtime/process/wasmacs-http.js");
const pageSource = read("src/wasm/xterm-atomics-pdump.html");
const childSource = read("src/runtime/process/child/wasmacs-child-library.js");

test("published plain-JS process helpers match current sources", () => {
  for (const name of ["wasmacs-http.js", "wasmacs-userland.js"]) {
    const artifact = new URL(`../../docs/artifacts/userland/${name}`, import.meta.url);
    assert.equal(existsSync(artifact), true, `missing published helper: ${name}; rebuild the site bundle`);
    assert.equal(readFileSync(artifact, "utf8"), read(`src/runtime/process/${name}`),
      `stale published ${name}; source-only fixes do not update the running browser`);
  }
});

function runtime(overrides = {}) {
  const forbidden = () => { throw new Error("the worker must not schedule asynchronous work"); };
  const context = vm.createContext({ SharedArrayBuffer, Atomics, TextDecoder, TextEncoder,
    Uint8Array, Int32Array, Promise: forbidden, setTimeout: forbidden, setInterval: forbidden,
    queueMicrotask: forbidden, ...overrides });
  vm.runInContext(kernelSource, context);
  vm.runInContext(httpSource, context);
  return context;
}

function makeKernel(startNetworkFetch) {
  const context = runtime();
  const kernel = context.WasmacsKernel.create({
    FS: { streams: [], currentPath: "/" }, now: () => 100, startNetworkFetch,
  });
  let pid = 100;
  const process = () => {
    const p = new kernel.emacs.constructor(pid++, 1);
    p.state = "running";
    kernel.procs.set(p.pid, p);
    kernel.emacs.children.add(p);
    return p;
  };
  return { kernel, process };
}

function reply(message, value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  new Uint8Array(message.responseSAB, 16).set(bytes);
  const state = new Int32Array(message.responseSAB, 0, 4);
  Atomics.store(state, 1, bytes.length);
  Atomics.store(state, 0, 2);
}

test("HTTP syscall starts a write once across cooperative restarts", () => {
  let starts = 0;
  let serializations = 0;
  let result = null;
  const { kernel, process } = makeKernel((request) => {
    starts++;
    assert.equal(request.method, "POST");
    return { poll: () => result, cancel: () => assert.fail("completed write must not be cancelled") };
  });
  const p = process();
  const request = () => { serializations++; return { method: "POST" }; };
  for (let i = 0; i < 5; i++) {
    const blocked = kernel.sys_http_fetch(p, request);
    assert.equal(blocked instanceof kernel.BlockRequest, true);
    assert.equal(blocked.wait.interruptible, true);
    assert.equal(blocked.wait.until, 120);
  }
  assert.equal(starts, 1);
  assert.equal(serializations, 1);
  assert.equal(kernel.httpRequests.size, 1);
  result = { status: 200, bodyBase64: "AA==" };
  assert.equal(kernel.sys_http_fetch(p, request), result);
  assert.equal(kernel.httpRequests.size, 0);
  assert.equal(p.restart, null);
});

test("HTTP syscall limits concurrent requests and releases slots on completion", () => {
  const calls = [];
  const { kernel, process } = makeKernel((request) => {
    const call = { request, result: null, cancelCount: 0 };
    calls.push(call);
    return { poll: () => call.result, cancel: () => { call.cancelCount++; } };
  });
  const procs = Array.from({ length: 5 }, process);
  const serializeCounts = Array(5).fill(0);
  const requests = procs.map((_p, i) => () => { serializeCounts[i]++; return { id: i }; });
  procs.forEach((p, i) => assert.equal(kernel.sys_http_fetch(p, requests[i]) instanceof kernel.BlockRequest, true));
  assert.equal(calls.length, 4);
  assert.equal(serializeCounts[4], 0);
  assert.equal(procs[4].restart, null);
  calls[1].result = { status: 204 };
  assert.equal(kernel.sys_http_fetch(procs[1], requests[1]).status, 204);
  assert.equal(kernel.sys_http_fetch(procs[4], requests[4]) instanceof kernel.BlockRequest, true);
  assert.equal(calls.length, 5);
  assert.equal(serializeCounts[4], 1);
  procs.forEach((p) => kernel.cancelRestart(p));
  assert.equal(kernel.httpRequests.size, 0);
  assert.deepEqual(calls.map((call) => call.cancelCount), [1, 0, 1, 1, 1]);
});

test("process death cancels HTTP and removes scheduler and instance references", () => {
  let cancellations = 0;
  const { kernel, process } = makeKernel(() => ({ poll: () => null, cancel: () => { cancellations++; } }));
  const p = process();
  p.inst = { heap: new Uint8Array(32) };
  p.image = {};
  p.pending = {};
  const blocked = kernel.sys_http_fetch(p, () => ({ method: "POST" }));
  kernel.block(p, blocked);
  assert.equal(kernel.sleepers.has(p), true);
  kernel._terminate(p, kernel.C.SIGTERM);
  assert.equal(cancellations, 1);
  assert.equal(kernel.httpRequests.size, 0);
  assert.equal(kernel.sleepers.has(p), false);
  assert.equal(kernel.runq.includes(p), false);
  assert.equal(p.state, "zombie");
  for (const key of ["restart", "pending", "wait", "inst", "image"]) assert.equal(p[key], null, key);
  kernel._terminate(p, kernel.C.SIGTERM);
  assert.equal(cancellations, 1);
});

test("HTTP transport errors release kernel state even when cancellation throws", () => {
  let cancellations = 0;
  const { kernel, process } = makeKernel(() => ({
    poll: () => { throw new Error("relay closed"); },
    cancel: () => { cancellations++; throw new Error("page gone"); },
  }));
  const p = process();
  p.pending = {};
  assert.equal(kernel.sys_http_fetch(p, () => ({})).error, "HTTP relay failed");
  assert.equal(cancellations, 1);
  assert.equal(kernel.httpRequests.size, 0);
  assert.equal(p.restart, null);
  assert.equal(p.pending, null);
});

test("shared HTTP client is synchronous and isolates late replies after cancellation", () => {
  const context = runtime({ TextDecoder: class extends TextDecoder {
    decode(input, options) {
      assert.equal(input.buffer instanceof SharedArrayBuffer, false, "browser TextDecoder does not accept shared views");
      return super.decode(input, options);
    }
  } });
  const messages = [];
  const wakeSAB = new SharedArrayBuffer(8);
  const start = context.WasmacsHttp.createClient({ postMessage: (m) => messages.push(m), wakeSAB, now: () => 0 });
  const old = start({ method: "POST", bodyBase64: "AA==" });
  const oldMessage = messages[0];
  assert.equal(JSON.parse(oldMessage.requestJson).processHttp, true);
  assert.equal(oldMessage.wakeSAB, wakeSAB);
  assert.equal(old.poll(), null);
  old.cancel();
  old.cancel();
  assert.equal(messages.filter((m) => m.type === "host-network-cancel").length, 1);
  const current = start({ method: "GET" });
  const currentMessage = messages.at(-1);
  assert.notEqual(currentMessage.requestId, oldMessage.requestId);
  assert.notEqual(currentMessage.responseSAB, oldMessage.responseSAB);
  reply(oldMessage, { status: 500 });
  assert.equal(current.poll(), null);
  assert.match(old.poll().error, /released/);
  reply(currentMessage, { status: 200, bodyBase64: "AP8=" });
  assert.equal(current.poll().bodyBase64, "AP8=");
  assert.match(current.poll().error, /released/);
});

test("shared HTTP client times out once and rejects corrupt response lengths or JSON", () => {
  const context = runtime();
  let now = 0;
  const messages = [];
  const start = context.WasmacsHttp.createClient({ postMessage: (m) => messages.push(m), now: () => now, timeoutMs: 10 });
  const pending = start({});
  now = 10;
  assert.match(pending.poll().error, /timed out/);
  pending.cancel();
  assert.equal(messages.filter((m) => m.type === "host-network-cancel").length, 1);
  for (const length of [-1, 0, context.WasmacsHttp.RESPONSE_BYTES + 1, 1]) {
    const handle = start({});
    const signal = new Int32Array(messages.at(-1).responseSAB, 0, 4);
    Atomics.store(signal, 1, length);
    Atomics.store(signal, 0, 2);
    assert.match(handle.poll().error, /Invalid HTTP relay response/);
    assert.match(handle.poll().error, /released/);
  }
});

test("new HTTP clients do not reuse request IDs after worker restart", () => {
  let client = 0;
  const context = runtime({ crypto: { randomUUID: () => `client-${++client}` } });
  const messages = [];
  const options = { postMessage: (message) => messages.push(message), now: () => 0 };
  const first = context.WasmacsHttp.createClient(options)({});
  const second = context.WasmacsHttp.createClient(options)({});
  assert.notEqual(messages[0].requestId, messages[1].requestId);
  first.cancel();
  second.cancel();
});

function pageFunction(start, end, context) {
  const first = pageSource.indexOf(start);
  const last = pageSource.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `page seam ${start}`);
  vm.runInContext(pageSource.slice(first, last), context);
}

test("Git POST never falls back after extension failure or an ambiguous response", async () => {
  let companionCalls = 0;
  const context = vm.createContext({ URL,
    location: { href: "https://wasmacs.example/app" }, pageParams: new URLSearchParams(),
    requestHeadersObject: (headers) => Object.fromEntries(headers || []),
    companionNetworkFetch: async () => { companionCalls++; throw new Error("reply lost after push"); },
    fetch: () => assert.fail("POST must not be replayed through direct/proxy transport"),
    configuredProxyUrls: () => ["https://proxy.example"],
  });
  pageFunction("async function hostNetworkFetch(", "const pendingNetworkRequests", context);
  await assert.rejects(context.hostNetworkFetch({
    url: "https://github.com/example/repo.git/git-receive-pack", method: "POST", processHttp: true,
  }), /reply lost after push/);
  assert.equal(companionCalls, 1);
});

test("page relay ignores a cancelled shared buffer and wakes the worker for completed responses", async () => {
  const pending = [];
  const context = vm.createContext({ URL, Int32Array, Uint8Array, TextEncoder, Atomics, AbortController,
    window: { addEventListener() {} },
    addLog() {}, hostNetworkFetch: () => new Promise((resolve) => pending.push(resolve)),
  });
  pageFunction("const pendingNetworkRequests", "// Emacs takes one chunk", context);
  const message = { requestId: "first", responseSAB: new SharedArrayBuffer(128), wakeSAB: new SharedArrayBuffer(8),
    requestJson: JSON.stringify({ url: "https://github.com/repo", method: "GET" }) };
  const state = new Int32Array(message.responseSAB, 0, 4);
  Atomics.store(state, 0, 1);
  const first = context.handleHostNetworkFetch(message);
  Atomics.store(state, 0, 3);
  pending.shift()({ status: 200 });
  await first;
  assert.equal(Atomics.load(state, 0), 3);
  assert.equal(Atomics.load(new Int32Array(message.wakeSAB), 0), 0);
  const next = { ...message, requestId: "next", responseSAB: new SharedArrayBuffer(128) };
  Atomics.store(new Int32Array(next.responseSAB), 0, 1);
  const second = context.handleHostNetworkFetch(next);
  pending.shift()({ status: 200 });
  await second;
  assert.equal(Atomics.load(new Int32Array(next.responseSAB), 0), 2);
  assert.equal(Atomics.load(new Int32Array(next.wakeSAB), 0), 1);
});

test("page relay does not start a POST cancelled before its message was handled", async () => {
  const context = vm.createContext({ URL, Int32Array, Uint8Array, TextEncoder, Atomics, AbortController,
    window: { addEventListener() {} }, addLog() {},
    hostNetworkFetch: () => assert.fail("already cancelled POST must not be sent"),
  });
  pageFunction("const pendingNetworkRequests", "// Emacs takes one chunk", context);
  const responseSAB = new SharedArrayBuffer(512);
  const state = new Int32Array(responseSAB, 0, 4);
  Atomics.store(state, 0, 3);
  await context.handleHostNetworkFetch({ requestId: "early-cancel", responseSAB,
    requestJson: JSON.stringify({ url: "https://github.com/repo.git/git-receive-pack", method: "POST" }) });
  assert.equal(Atomics.load(state, 0), 3);
  assert.equal(vm.runInContext("pendingNetworkRequests.size", context), 0);
});

test("page teardown cancels current requests even when an older reply used the same ID", async () => {
  const calls = [];
  const events = new Map();
  const context = vm.createContext({ URL, Int32Array, Uint8Array, TextEncoder, Atomics, AbortController,
    window: { addEventListener: (name, listener) => events.set(name, listener) }, addLog() {},
    hostNetworkFetch: (_request, signal) => new Promise((resolve, reject) => {
      calls.push({ resolve, signal });
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  pageFunction("const pendingNetworkRequests", "// Emacs takes one chunk", context);
  const message = () => {
    const responseSAB = new SharedArrayBuffer(512);
    Atomics.store(new Int32Array(responseSAB), 0, 1);
    return { requestId: "same-id", responseSAB,
      requestJson: JSON.stringify({ url: "https://github.com/repo", method: "POST" }) };
  };
  const old = context.handleHostNetworkFetch(message());
  const current = context.handleHostNetworkFetch(message());
  calls[0].resolve({ status: 200 });
  await old;
  assert.equal(vm.runInContext("pendingNetworkRequests.size", context), 1);
  events.get("pagehide")();
  assert.equal(calls[1].signal.aborted, true);
  await current;
  assert.equal(vm.runInContext("pendingNetworkRequests.size", context), 0);
});

test("page relay reports oversized results inside its bounded shared slot", async () => {
  const context = vm.createContext({ URL, Int32Array, Uint8Array, TextEncoder, Atomics, AbortController,
    window: { addEventListener() {} }, addLog() {},
    hostNetworkFetch: async () => ({ status: 200, bodyBase64: "A".repeat(1000) }),
  });
  pageFunction("const pendingNetworkRequests", "// Emacs takes one chunk", context);
  const responseSAB = new SharedArrayBuffer(512);
  const state = new Int32Array(responseSAB, 0, 4);
  Atomics.store(state, 0, 1);
  await context.handleHostNetworkFetch({ requestId: "large", responseSAB,
    requestJson: JSON.stringify({ url: "https://github.com/repo" }) });
  assert.equal(Atomics.load(state, 0), 2);
  const result = JSON.parse(new TextDecoder().decode(new Uint8Array(responseSAB, 16, Atomics.load(state, 1))));
  assert.match(result.error, /too large for relay buffer/);
});

function childImport(response, { failAllocation = 0 } = {}) {
  const buffer = new ArrayBuffer(128 * 1024);
  const HEAPU8 = new Uint8Array(buffer), HEAP32 = new Int32Array(buffer);
  let nextPtr = 1024, count = 0;
  const freed = [], allocated = [];
  const text = (ptr) => new TextDecoder().decode(HEAPU8.subarray(ptr, HEAPU8.indexOf(0, ptr)));
  const context = vm.createContext({ HEAPU8, HEAP32, TextEncoder, Uint8Array, btoa, atob,
    UTF8ToString: text, _free: (ptr) => freed.push(ptr),
    _malloc: (size) => { if (++count === failAllocation) return 0;
      const ptr = nextPtr; nextPtr += size; allocated.push(ptr); return ptr; },
    WK: { sys: (fn) => fn({ BlockRequest: class {}, sys_http_fetch: () => response }, {}) },
  });
  const begin = childSource.indexOf("  wasmacs_host_http_fetch: ");
  const end = childSource.indexOf("\n  // ---- sockets", begin);
  assert.ok(begin >= 0 && end > begin);
  vm.runInContext(`globalThis.bridge = ({${childSource.slice(begin, end)}}).wasmacs_host_http_fetch`, context);
  return { context, HEAPU8, HEAP32, allocated, freed, text };
}

test("child HTTP import returns binary body pointers owned by the calling process", () => {
  const fixture = childImport({ status: 200, headers: [["Content-Type", "application/x-git-upload-pack-result"]],
    bodyBase64: "AP+A", url: "https://github.com/example/repo" });
  assert.equal(fixture.context.bridge(0, 0, 0, 0, 0, 64), 0);
  const out = fixture.HEAP32.subarray(16, 22);
  assert.equal(out[0], 200);
  assert.match(fixture.text(out[1]), /Content-Type: application\/x-git-upload-pack-result/);
  assert.deepEqual(fixture.HEAPU8.slice(out[3], out[3] + out[4]), new Uint8Array([0, 255, 128]));
  assert.equal(fixture.text(out[5]), "https://github.com/example/repo");
  assert.equal(fixture.allocated.length, 3);
  assert.equal(fixture.freed.length, 0);
});

test("child HTTP import frees partial allocations and clears outputs on allocation failure", () => {
  const fixture = childImport({ status: 200, headers: {}, bodyBase64: "AA==", url: "https://example.test" },
    { failAllocation: 3 });
  fixture.HEAPU8.fill(255, 64, 88);
  assert.equal(fixture.context.bridge(0, 0, 0, 0, 0, 64), 1);
  assert.deepEqual(fixture.freed, fixture.allocated);
  assert.deepEqual(fixture.HEAPU8.slice(64, 88), new Uint8Array(24));
});
