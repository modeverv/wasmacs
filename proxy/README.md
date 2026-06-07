# wasmacs fetch proxies

These examples provide a self-hosted network gateway for browser-hosted Emacs
package downloads. They implement the same request/response shape used by the
development `__wasmacs_network_fetch` route.

The proxy accepts only `POST` requests with JSON:

```json
{
  "url": "https://elpa.gnu.org/packages/archive-contents",
  "method": "GET",
  "headers": [["accept", "text/plain"]]
}
```

It returns JSON:

```json
{
  "url": "https://elpa.gnu.org/packages/archive-contents",
  "status": 200,
  "statusText": "OK",
  "headers": [{"name": "content-type", "value": "text/plain"}],
  "bodyBase64": "..."
}
```

All samples require an allowlist. By default they allow GNU ELPA and MELPA:

```text
https://elpa.gnu.org
https://melpa.org
https://stable.melpa.org
```

Override this with `WASMACS_PROXY_ALLOWED_ORIGINS`, using a comma-separated
origin list:

```sh
WASMACS_PROXY_ALLOWED_ORIGINS=https://elpa.gnu.org,https://melpa.org
```

The samples also accept `PORT`, defaulting to `8787`.

## Node

```sh
PORT=8787 node proxy/node/server.mjs
```

## PHP

```sh
PORT=8787 php -S 127.0.0.1:8787 proxy/php/proxy.php
```

## Go

```sh
PORT=8787 go run proxy/go/main.go
```

## Rust

```sh
PORT=8787 cargo run --manifest-path proxy/rust/Cargo.toml
```

## Perl

```sh
PORT=8787 perl proxy/perl/server.pl
```

## Ruby

```sh
PORT=8787 ruby proxy/ruby/server.rb
```

## Python

```sh
PORT=8787 python3 proxy/python/server.py
```

On Windows with the Python launcher:

```powershell
$env:PORT = "8787"; py -3 proxy/python/server.py
```

## PowerShell

```sh
PORT=8787 pwsh -NoProfile -File proxy/powershell/server.ps1
```

PowerShell 7 is the most convenient built-in-adjacent option on Windows. On
macOS and Linux, install `pwsh` or use one of the other samples.

## Local runtime coverage

With these samples, a local proxy can usually be started without adding a web
server:

- macOS: Ruby and Perl are commonly present; Python 3 is present on many
  developer machines, but may need Command Line Tools, Homebrew, or mise.
- Linux: Python 3 is commonly present; Perl is also common; distro packages can
  provide the rest.
- Windows: PowerShell is the native path. Python works when the Python launcher
  or `python`/`python3` is installed.

For repeatable development, `mise` can install missing runtimes.
