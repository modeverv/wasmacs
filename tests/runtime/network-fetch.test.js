import test from "node:test";
import assert from "node:assert/strict";
import { CoreHost } from "../../src/runtime/host/core-host.js";
import {
  createNetworkPolicy,
  HostNetworkPermissionError,
  normalizeFetchHeaders,
} from "../../src/runtime/host/network-fetch.js";

function mockResponse({
  url = "https://elpa.gnu.org/packages/archive-contents",
  status = 200,
  statusText = "OK",
  headers = [["content-type", "text/plain"]],
  body = "payload",
} = {}) {
  return {
    url,
    status,
    statusText,
    headers,
    async arrayBuffer() {
      return new TextEncoder().encode(body).buffer;
    },
  };
}

test("host network fetch returns URL response bytes and normalized headers", async () => {
  const seen = [];
  const host = new CoreHost({
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return mockResponse({
        headers: new Headers({
          "Content-Type": "application/octet-stream",
          ETag: "\"abc\"",
        }),
        body: "archive-data",
      });
    },
  });

  const response = await host.fetchUrl({
    url: "https://elpa.gnu.org/packages/archive-contents",
    method: "GET",
    headers: [["accept", "text/plain"]],
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://elpa.gnu.org/packages/archive-contents");
  assert.equal(seen[0].init.method, "GET");
  assert.deepEqual(seen[0].init.headers, { accept: "text/plain" });
  assert.equal(response.status, 200);
  assert.equal(new TextDecoder().decode(response.body), "archive-data");
  assert.deepEqual(response.headers, [
    ["content-type", "application/octet-stream"],
    ["etag", "\"abc\""],
  ]);
});

test("host network policy rejects unsupported schemes and disallowed origins", async () => {
  const host = new CoreHost({
    fetchImpl: async () => mockResponse(),
    networkPolicy: createNetworkPolicy({
      allowedOrigins: ["https://elpa.gnu.org"],
    }),
  });

  await assert.rejects(
    host.fetchUrl({ url: "ftp://elpa.gnu.org/archive-contents" }),
    HostNetworkPermissionError,
  );
  await assert.rejects(
    host.fetchUrl({ url: "https://example.com/archive-contents" }),
    HostNetworkPermissionError,
  );
});

test("header normalization accepts arrays, Headers, and plain objects", () => {
  assert.deepEqual(normalizeFetchHeaders([["X-Test", "1"]]), [["x-test", "1"]]);
  assert.deepEqual(normalizeFetchHeaders(new Headers({ "X-Test": "1" })), [["x-test", "1"]]);
  assert.deepEqual(normalizeFetchHeaders({ "X-Test": 1 }), [["x-test", "1"]]);
});
