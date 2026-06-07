#!/usr/bin/env python3
import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_ALLOWED_ORIGINS = [
    "https://elpa.gnu.org",
    "https://melpa.org",
    "https://stable.melpa.org",
]

BLOCKED_HEADERS = {
    "connection",
    "content-length",
    "cookie",
    "host",
    "origin",
    "referer",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "transfer-encoding",
}


def allowed_origins():
    raw = os.environ.get("WASMACS_PROXY_ALLOWED_ORIGINS", "")
    values = raw.split(",") if raw.strip() else DEFAULT_ALLOWED_ORIGINS
    return {value.strip() for value in values if value.strip()}


def assert_allowed_url(raw_url):
    parsed = urllib.parse.urlparse(str(raw_url or ""))
    if not parsed.scheme or not parsed.netloc:
        raise ValueError("invalid URL")
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"unsupported URL scheme: {parsed.scheme}")
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin not in allowed_origins():
        raise ValueError(f"URL origin is not allowed: {origin}")
    return urllib.parse.urlunparse(parsed)


def normalize_headers(headers):
    if isinstance(headers, list):
        source = headers
    elif isinstance(headers, dict):
        source = headers.items()
    else:
        source = []

    normalized = {}
    for item in source:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        name = str(item[0]).lower()
        if not name or name in BLOCKED_HEADERS:
            continue
        normalized[name] = str(item[1])
    return normalized


def request_body(payload, method):
    if method in {"GET", "HEAD"}:
        return None
    if isinstance(payload.get("bodyBase64"), str):
        return base64.b64decode(payload["bodyBase64"])
    if "body" in payload:
        return str(payload["body"]).encode("utf-8")
    return None


def header_pairs(response):
    return [
        {"name": name.lower(), "value": value}
        for name, value in response.headers.items()
    ]


class ProxyHandler(BaseHTTPRequestHandler):
    server_version = "wasmacs-fetch-proxy-python/0.1"

    def log_message(self, _format, *_args):
        return

    def write_json(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.send_response(405)
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Allow", "POST")
        self.end_headers()
        self.wfile.write(b"method not allowed")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("content-length", "0"))
            if length > 16 * 1024 * 1024:
                raise ValueError("request body too large")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            target = assert_allowed_url(payload.get("url"))
            method = str(payload.get("method") or "GET").upper()
            request = urllib.request.Request(
                target,
                data=request_body(payload, method),
                headers=normalize_headers(payload.get("headers")),
                method=method,
            )
            try:
                with urllib.request.urlopen(request, timeout=30) as upstream:
                    body = upstream.read()
                    self.write_json(200, {
                        "url": upstream.geturl(),
                        "status": upstream.status,
                        "statusText": upstream.reason or "",
                        "headers": header_pairs(upstream),
                        "bodyBase64": base64.b64encode(body).decode("ascii"),
                    })
            except urllib.error.HTTPError as upstream:
                body = upstream.read()
                self.write_json(200, {
                    "url": upstream.geturl(),
                    "status": upstream.code,
                    "statusText": upstream.reason or "",
                    "headers": header_pairs(upstream),
                    "bodyBase64": base64.b64encode(body).decode("ascii"),
                })
        except Exception as error:
            self.write_json(400, {"error": str(error)})


def main():
    port = int(os.environ.get("PORT", "8787"))
    server = ThreadingHTTPServer(("127.0.0.1", port), ProxyHandler)
    print(f"wasmacs fetch proxy listening at http://127.0.0.1:{port}/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
