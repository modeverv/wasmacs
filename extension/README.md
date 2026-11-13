# wasmacs CORS Companion

This is an unpacked Manifest V3 Chrome extension that gives wasmacs a user-granted network capability for package archives, raw files, and Git smart HTTP requests that normal page `fetch()` cannot read because of CORS.

It is not a global CORS disable switch. It does not intercept all browser traffic, rewrite arbitrary response headers, read cookies, or forward credentials by default.

## Load Unpacked

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this `extension/` directory.
5. Open a wasmacs page from `http://localhost/...`, `http://127.0.0.1/...`,
   or `https://modeverv.github.io/wasmacs/...`.
6. Inspect the extension service worker if Chrome reports any errors.

## Ping Test

On a local wasmacs page, run this in DevTools:

```js
window.addEventListener("message", (event) => {
  if (event.data?.type === "WASMACS_PROXY_PONG") console.log(event.data);
});
window.postMessage({
  type: "WASMACS_PROXY_PING",
  version: 1,
  requestId: crypto.randomUUID()
}, window.location.origin);
```

## Safe GET Test

```js
window.addEventListener("message", (event) => {
  if (event.data?.type === "WASMACS_PROXY_RESPONSE") console.log(event.data);
});
window.postMessage({
  type: "WASMACS_PROXY_REQUEST",
  version: 1,
  requestId: crypto.randomUUID(),
  request: {
    url: "https://elpa.gnu.org/packages/archive-contents",
    method: "GET",
    headers: { "Accept": "text/plain,*/*" },
    responseType: "arrayBuffer",
    credentials: "omit",
    timeoutMs: 30000
  }
}, window.location.origin);
```

The response body is returned as `bodyBase64`.

## Git smart HTTP

The existing message bridge also accepts binary Git requests:

- GET discovery at `repo.git/info/refs?service=git-upload-pack` or `git-receive-pack`.
- POST to `repo.git/git-upload-pack` or `repo.git/git-receive-pack`, with the matching
  `application/x-git-upload-pack-request` or `application/x-git-receive-pack-request`
  Content-Type and a base64-encoded `bodyBase64`.
- Git RPC POST may carry `Content-Encoding: gzip` for compressed negotiation
  requests; the compressed bytes are forwarded unchanged.
- `Git-Protocol`, `Accept`, and explicit `Authorization` request headers;
  `WWW-Authenticate` is preserved in HTTP responses. Headers may be an object or
  `[name, value]` pairs. HTTP errors such as 401 remain HTTP responses.

For authenticated remotes, enable **Allow credentials** in the options page and
allow the exact HTTPS target origin. The Git transport must supply its own
Authorization header; the extension does not store tokens. `credentials: "omit"`
still omits browser cookies even when an Authorization header is supplied.
Credentials embedded in URLs are rejected. Adding a server outside the default
four hosts also requires its matching `host_permissions` entry in `manifest.json`.

Git POST and authenticated requests reject redirects, so configure the canonical
remote URL. They are not retried by the extension. Public GET discovery may follow
redirects and returns the final URL after checking its allowlist. Request and
response bodies each default to a 25 MiB limit; downloads are stopped while
reading if they exceed the response limit.

To abort a request, post `WASMACS_PROXY_CANCEL` with protocol version 1 and the
original `requestId`. The acknowledgement is `WASMACS_PROXY_CANCELLED`; the original
request receives `FETCH_ABORTED`. Cancellation is scoped to the originating tab
and document. Timeout remains a separate `FETCH_TIMEOUT` error.

## Defaults

Allowed page origins:

- `http://localhost:*`
- `http://127.0.0.1:*`
- `https://modeverv.github.io`

Content script injection is enabled for:

- `http://localhost/*`
- `http://127.0.0.1/*`
- `https://modeverv.github.io/wasmacs/*`

Allowed network targets:

- `https://elpa.gnu.org/*`
- `https://melpa.org/*`
- `https://raw.githubusercontent.com/*`
- `https://github.com/*`

Credentials and private network targets are disabled by default. The extension keeps a bounded audit log in `chrome.storage.local` without storing headers, bodies, URL credentials, or query strings.

## Options

Open the extension options page from `chrome://extensions` to edit:

- allowed wasmacs origins
- allowed target URL patterns
- max request and response sizes
- timeout
- credentialed request mode
- private network target mode
- audit log

Adding non-local wasmacs origins may also require editing `manifest.json` content script `matches`, because Chrome decides content script injection before this extension reads its own options.

## Remove

Open `chrome://extensions`, find `wasmacs CORS Companion`, and click Remove.
