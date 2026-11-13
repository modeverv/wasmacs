"""urllib.request support for wasmacs: HTTP(S) through the browser host.

wasmacs has no sockets.  A request goes to the browser page, and the Chrome
companion extension (extension/ in the wasmacs repository) performs it, with
its rules: only hosts it allows, GET and HEAD (POST only for Git), at most
25 MiB and 30 seconds.  Redirects are followed by the browser.
urllib.request.build_opener() uses this handler for http:// and https://
(see src/userland/python/patches/0003-urllib-through-the-browser-host.patch).
"""

import http.client
import io
import urllib.error
import urllib.request
import urllib.response

from _wasmacs_http import fetch

# Headers that a browser's fetch sets itself; a request cannot choose them.
_BROWSER_HEADERS = {"host", "connection", "content-length", "user-agent", "accept-encoding"}


class CompanionHandler(urllib.request.BaseHandler):
    """Open http and https URLs with the browser host's fetch."""

    def _open(self, req):
        headers = dict(req.unredirected_hdrs)
        headers.update((k, v) for k, v in req.headers.items() if k not in headers)
        lines = "".join(f"{name}: {value}\r\n" for name, value in headers.items()
                        if name.lower() not in _BROWSER_HEADERS)
        try:
            status, raw_headers, body, url = fetch(req.full_url, req.get_method(), lines,
                                                   req.data or b"")
        except OSError as error:
            raise urllib.error.URLError(error) from None
        message = http.client.parse_headers(io.BytesIO(raw_headers + b"\r\n"))
        response = urllib.response.addinfourl(io.BytesIO(body), message, url, status)
        response.msg = http.client.responses.get(status, "")
        return response

    http_open = _open
    https_open = _open
