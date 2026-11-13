import test from "node:test";
import assert from "node:assert/strict";
import { isProxyMessage, makePong, validateBridgeMessage } from "../src/protocol.js";

test("protocol accepts v1 ping", () => {
  const message = { type: "WASMACS_PROXY_PING", version: 1, requestId: "ping-1" };
  assert.equal(isProxyMessage(message), true);
  assert.equal(validateBridgeMessage(message), null);
  assert.deepEqual(makePong("ping-1"), {
    type: "WASMACS_PROXY_PONG",
    version: 1,
    requestId: "ping-1",
    ok: true,
  });
});

test("protocol rejects unknown version and malformed request", () => {
  assert.equal(validateBridgeMessage({ type: "WASMACS_PROXY_PING", version: 2, requestId: "x" }).code, "UNSUPPORTED_VERSION");
  assert.equal(validateBridgeMessage({ type: "WASMACS_PROXY_REQUEST", version: 1, requestId: "x" }).code, "BAD_MESSAGE");
});

test("protocol accepts safe proxy request shape", () => {
  const message = {
    type: "WASMACS_PROXY_REQUEST",
    version: 1,
    requestId: "fetch-1",
    request: {
      url: "https://elpa.gnu.org/packages/archive-contents",
      method: "GET",
      headers: { Accept: "text/plain" },
      credentials: "omit",
      timeoutMs: 30000,
    },
  };
  assert.equal(validateBridgeMessage(message), null);
});

test("protocol accepts cancellation and Git binary request fields", () => {
  assert.equal(validateBridgeMessage({ type: "WASMACS_PROXY_CANCEL", version: 1, requestId: "fetch-1" }), null);
  const message = { type: "WASMACS_PROXY_REQUEST", version: 1, requestId: "git-1", request: {
    url: "https://github.com/example/repo.git/git-upload-pack", method: "POST",
    headers: [["Content-Type", "application/x-git-upload-pack-request"]], bodyBase64: "AA==",
  } };
  assert.equal(validateBridgeMessage(message), null);
  assert.equal(validateBridgeMessage({ ...message, request: { ...message.request, bodyBase64: [] } }).code, "BAD_MESSAGE");
  assert.equal(validateBridgeMessage({ ...message, request: { ...message.request, headers: [["bad"]] } }).code, "BAD_MESSAGE");
});
