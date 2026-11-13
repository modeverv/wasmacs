# Git browser HTTP transport

`build.sh` produces the local Git image and a separate `git-http` image. Both
use the pinned Git 2.52.1 tarball. `git-http` compiles **upstream
`remote-curl.c` unchanged**, linking the existing `libgit.a` with
`http-browser.c` instead of upstream `http.c` and libcurl. The private `curl/`
headers expose only the options referenced by this pinned helper; they are not
a general libcurl implementation.

Git continues to own discovery, protocol v0/v2, shallow and filtered fetch
options, pack production/validation, fetch-pack, send-pack and the remote-helper
protocol. The adapter supplies HTTP requests through `wasmacs_host_http_fetch`.
The Process Service suspends that import, and the page performs the asynchronous
browser/companion-extension request. Neither the Git process nor the Emacs
worker creates promises, timers, sockets or filesystem mounts.

The image is installed as `git-remote-http` and `git-remote-https` by the userland
layout. It supports Smart HTTP clone, fetch and push, including uploads larger
than Git's `http.postBuffer`: the upstream upload callback is read into a
bounded buffer before sending it to the browser. Requests and responses are
limited by the host to 25 MiB. This is buffered HTTP, not a streaming socket
transport. SSH, `git://`, dumb HTTP/WebDAV and cross-origin packfile URI
downloads are unsupported.

Authentication supports Git `http.extraHeader` (including URL-scoped settings),
Basic URL credentials and Git credential helpers. Browser cookies are omitted.
The adapter removes credentials from URLs before forwarding them, and refuses
off-origin helper downloads so repository headers cannot leak to another host.
Browser/extension permissions and redirect checks still apply. A user must
explicitly grant authenticated POST access in the companion extension for
private repositories and pushes.

TLS verification is performed by the browser. libcurl-specific proxy, client
certificate/key, pinned-public-key and redirect configuration is rejected with
an explicit error. Other libcurl-specific tuning is not implemented.

## ABI

```c
int wasmacs_host_http_fetch(const char *url, const char *method,
  const char *newline_separated_headers, const void *body, int body_len,
  struct host_response *out);
/* six wasm32 words, in order: */
struct host_response {
  int status;
  char *headers; int headers_len;
  unsigned char *body; int body_len;
  char *final_url;
};
```

Return zero for a received HTTP response, including HTTP errors, and nonzero
for transport failure. On failure, `headers` may hold a UTF-8 diagnostic.
Allocate each non-null pointer with the calling process's malloc; the adapter
frees all returned buffers. Callers zero-initialize `out` because an interrupted
restartable import may return without populating it.

## Validation

```sh
src/userland/build.sh git
tests/process/build-test-programs.sh
node src/userland/git/test-http.mjs
```

The targeted test runs the actual wasm Git/helper through the Process Service
against native `git-http-backend`, injecting HTTP responses at the host seam.
It checks v0/v2 clone, binary readback, remote changes fetched into wasm, small
and >1 MiB pushes verified in the server repository, URL-scoped headers, URL
credentials, authentication failure, and request suspension/cleanup. Browser
and extension behavior requires the separate browser integration probe.
