# wasmacs

`wasmacs` は、GNU Emacs をブラウザ上で動かすプロジェクトです。

これは「Emacs 風のエディタ」を作るプロジェクトではありません。GNU Emacs 30.2 の C core と Elisp runtime を中心に置き、表示、入力、永続化、可搬ファイルシステムイメージをブラウザ側で支えることで、本物の Emacs を WebAssembly 上で動かすことを目指しています。

現在の主ルートは、`SharedArrayBuffer` / `Atomics.wait` / pdump / xterm.js を使うブラウザ実行ルートです。`*scratch*`、Dired、Org-mode、`load-file` による Elisp 読み込み、`.wasifs` の import/export まで到達しています。

## 現在できること

- ブラウザ上で GNU Emacs 30.2 の C core を起動する
- xterm.js 上で Emacs の `--nw` 画面を表示する
- `TERM=xterm-256color` で truecolor、制御キー、カーソル、マウス、bracketed paste、リサイズを扱う
- bundled `bootstrap-emacs.pdmp` を materialize して interactive waitpoint まで到達する
- `user-filesystem.wasifs` を import/export する
- `load-file` によってユーザー側 `.wasifs` 内の Elisp を読み込む
- GitHub Pages 上の静的配信でも起動する
- `url.el` / `package.el` 系の HTTP(S) リクエストを `host.network.fetch` 経由に流す
- CORS で直接 fetch できない package archive については、ユーザー管理の self-hosted proxy を使える
- emacsでのヤンクをブラウザ clipboard に流す

## まだ制限があること

- ブラウザ内の Emacs core には raw socket や通常の POSIX process はありません
- `host.process` は 利用不可です
- 外部コマンドや subprocess に依存する Emacs 機能は、そのままでは動きません
- `package-refresh-contents` などのネットワーク機能は、ブラウザ fetch / CORS / proxy の制約を受けます
- GUI Emacs の native frame を移植しているわけではなく、現状は xterm.js 上の terminal Emacs です
- `docs/` に置く Pages 用 artifact は、GitHub Pages で扱える形に分割・制限しています
- VS Code `.wasifs` extension 用の別ビルドルートを生成できる

## リポジトリ構成

```text
src/wasm/   ブラウザ wasm app のソース
src/assets/ 生成 docs にコピーされるソースアセット
src/build/  docs と artifact 生成用スクリプト
src/c/      Emacs C 側の patch layer
src/runtime/ host/runtime libraries used by tests and tools
tools/      build / validation / probe / prototype / inspection tools
tools/probs/ prototype and exploratory probe code
proxy/      package archive 用の self-hosted fetch proxy サンプル
vendor/     pinned upstream GNU Emacs source。read-only
build/      copied Emacs working tree、temporary state、generated artifacts
build/artifacts/ generated wasm / pdmp / wasifs build products
build2/     VS Code 専用 copied Emacs workspace と runtime artifacts
doc/        architecture and planning notes
docs/       GitHub Pages output
vscode/     generated VS Code webview app bundle
logs/       ignored runtime logs。Git には .gitkeep のみ残す
tests/      automated test code
archive/    old outputs and superseded files
```

`vendor/emacs` は pinned upstream GNU Emacs source です。直接編集しません。実験用 patch は copied build tree に対して適用します。

## ブラウザアプリ

開発中の主ルートは次です。 `npm run dev` で起動します。

```text
http://127.0.0.1:5173/app/xterm-atomics-pdump.html
```

`make docs` は GitHub Pages 用 bundle を生成します。`docs/index.html` は `/` から canonical app page である `/app/xterm-atomics-pdump.html` へ redirect します。

Pages bundle は次の方針で構成されています。

- `SharedArrayBuffer` のために root の `coi-serviceworker.js` で COOP/COEP 相当の環境を作る
- project pages でも動くように app / artifact URL は relative にする
- Emscripten glue は `temacs.js` として配信し、静的サーバーが JavaScript MIME type を返せるようにする
- 大きな Emscripten preload package は、単一の巨大な `temacs.data` ではなく `docs/artifacts/temacs.data.parts/` 以下の chunk として置く

通常の diagnostic log は静かにしています。詳細ログを見たい場合は次の query を付けます。

```text
?debug-log=1
```

DevTools で viewport をリサイズしながら調査する場合は、起動後の terminal size を安定させるために次も使えます。

```text
?no-live-resize=1
```

## スクリーンショット

### Startup

![wasmacs startup screen](docs/screenshots/wasmacs-startup.jpg)

### Dired

![wasmacs Dired buffer](docs/screenshots/wasmacs-dired.jpg)

### Org File

![wasmacs Org file buffer](docs/screenshots/wasmacs-org-file.jpg)

## 必要なもの

- Node.js 24 以上
- npm
- Emscripten toolchain
- GNU make

xterm.js は `node_modules` に vendor せず、ブラウザページから jsDelivr CDN 経由で読み込みます。checked-in HTML は `https://cdn.jsdelivr.net/npm/@xterm/xterm@5/...` を直接参照します。

clone 後はまず次を実行します。

```sh
npm ci
```

## よく使うコマンド

```sh
make prepare
make test
make build
make vscode-build
make docs
make dev
```

`make prepare` は `vendor/emacs` を `build/emacs-30.2-patched/src` にコピーし、`src/c/patches/*.patch` を適用します。`vendor/emacs` を直接編集しないでください。

`make build` は Emacs wasm / pdmp / wasifs artifact を `build/artifacts/` 以下に再生成し、その後 GitHub Pages 用 bundle を `docs/` に反映します。

`make dev` は開発サーバーを起動します。開発サーバーでは runtime file を `/artifacts/...` として公開し、Pages と同じ URL contract で worker / smoke URL が動くようにしています。

`make vscode-build` は VS Code `.wasifs` extension 用の別ルートを生成します。VS Code 専用 artifact は `build2/artifacts/` に置かれ、webview app bundle は `vscode/app/` に置かれます。このルートは `docs/app` や `docs/artifacts` を消費・更新しません。

## ネットワークアクセス

wasmacs では、ネットワークアクセスをブラウザ host capability として明示的に扱います。

Emacs core に raw socket や `host.process` を渡して package download をさせるのではありません。代わりに、checked-in の `wasmacs-url-fetch` Lisp overlay が `url.el` の HTTP(S) リクエストを `host.network.fetch` に流します。これにより、`package-refresh-contents`、`package-install`、`use-package :ensure` などは request/response service として実行できます。

ただし、ブラウザの直接 `fetch` は CORS の制約を受けます。remote package archive が page origin を許可していない場合、JavaScript から response body を読むことはできません。Service Worker は app cache や COOP/COEP には使えますが、CORS で読めない cross-origin response を読めるようにはできません。

CORS で archive が読めない場合、ユーザー自身が管理する self-hosted fetch proxy を設定できます。wasmacs は中央 proxy service を提供しません。

`proxy/` には Node、PHP、Rust、Perl、Ruby、Python、PowerShell のサンプルがあります。各サンプルは、local development の `__wasmacs_network_fetch` route と同じ JSON request shape を受け取り、status、headers、base64 response bytes を返します。

proxy sample は基本的に allowlist-based です。ただし Ruby sample は localhost-only development 向けに `*` を default とします。

許可する archive origin は次のように指定します。

```sh
WASMACS_PROXY_ALLOWED_ORIGINS=https://elpa.gnu.org,https://melpa.org
```

local proxy を起動したら、browser runtime に `network-proxy` を渡します。

```text
http://127.0.0.1:5173/app/xterm-atomics-pdump.html?network-proxy=http%3A%2F%2F127.0.0.1%3A8787%2F
```

runtime はまず direct browser fetch を試します。CORS で archive が読めない場合、設定された proxy endpoint に fallback します。localhost development pages では `make dev` が提供する same-origin `__wasmacs_network_fetch` route も使えます。GitHub Pages のような静的 host にはこの route はありません。

Atomics/pdump route では、worker が `host.network.fetch` を main page に relay します。実際の direct/proxy `fetch` は worker-local synchronous XHR ではなく、main page thread 側で実行され、結果は SharedArrayBuffer result slot 経由で返されます。

public HTTPS page から localhost proxy を呼ぶ場合、modern browser は Private Network Access preflight を送ることがあります。そのため bundled proxy sample は `Access-Control-Allow-Private-Network: true` を返し、wildcard CORS ではなく requesting `Origin` を echo します。

Emacs Lisp 側から user image や init flow ごとに proxy を設定することもできます。

```elisp
(require 'wasmacs-url-fetch)
(setq wasmacs-url-fetch-proxy-url "http://127.0.0.1:8787/")
(wasmacs-url-fetch-enable)
```

Emacs 側の `wasmacs-url-fetch-proxy-url` は各 `url.el` / `package.el` request と一緒に送られ、page-level の `network-proxy` default より優先されます。

## `.wasifs` イメージ

`.wasifs` は、ブラウザ runtime で使う可搬ファイルシステムイメージです。

現在の spike format は tar-compatible です。そのため、低レベル確認には通常の `tar` が使えます。

```sh
tar tf user-filesystem.wasifs
```

通常の repo 作業では npm script を使います。

```sh
npm run wasifs:list -- user-filesystem.wasifs
npm run wasifs:pack -- ./home-user user-filesystem.wasifs --root home/user
npm run wasifs:unpack -- user-filesystem.wasifs ./out
```

`wasifs:pack` は local directory を指定された image root に pack します。

- writable user image の場合は `--root home/user`
- read-only system image 実験の場合は `--root system`

`wasifs:list` と `wasifs:unpack` は、`PaxHeader`、AppleDouble `._*`、`.DS_Store` などの tar metadata noise を隠します。見える tree は可搬 filesystem contents に寄せています。

### Helmをpack経由でインポートして動作する例



## artifact policy

build output は `build/artifacts/` に生成します。

publishable な `docs/` tree には、checked-in browser bundle と Pages-safe runtime artifacts だけを含めます。`docs/artifacts/` に置けるものは `tools/scripts/validate-git-artifact-policy.sh` で検証します。

古い 512MB pdump restore failure は現在の browser status ではありません。現在の Atomics/pdump xterm route は、bundled pdmp を materialize し、dev server と static Pages bundle の両方で interactive waitpoint に到達することを確認しています。

`make clean` は legacy `dist/` があれば削除し、`build/` と `docs/` を空にします。ただし、`build2/` と `vscode/` は意図的に残します。Pages 用ルートと VS Code 用ルートを独立して検証できるようにするためです。

runtime / validation log は `logs/` に書かれますが、log file は Git ignore されます。reorganization baseline 以前の historical logs は `archive/old-logs/` に置きます。

`build/artifacts/host-abi.wit` は `src/build/generate-host-abi-wit.mjs` から生成される build artifact です。`src/` 以下の source ではありません。検証は `tools/scripts/validate-host-abi.sh` が担当します。

`dist/` は現在の layout には含まれません。

## アーキテクチャ

wasmacs の基本構成は次の 3 つです。

```text
emacs-core.wasm
system-lisp.wasifs
user-filesystem.wasifs
```

`emacs-core.wasm` は GNU Emacs の C core、Elisp interpreter、bytecode runtime、built-in primitives を含みます。

`system-lisp.wasifs` は固定された Emacs release に対応する read-only image です。GNU Emacs の `lisp/`、`.el`、`.elc`、autoload/loaddefs、`etc/` support files を含めます。

`user-filesystem.wasifs` は writable portable image です。`init.el`、ELPA packages、site-lisp、作業ファイル、journal/snapshot metadata などを含めます。

起動時の基本 mount は次の形を想定しています。

```text
/system    read-only
/home/user writable
/tmp       volatile
```

`load-path` は user image を system image より優先します。

```text
/home/user/.emacs.d/lisp
/home/user/.emacs.d/elpa/*/
/system/lisp
```

この設計により、Emacs runtime、標準 Lisp distribution、ユーザー workspace の更新サイクルを分離できます。

詳しい設計変更や runtime ownership boundary を触る前に、以下を読んでください。

```text
ARCHITECTURE.md
PLAN.md
doc/small-os-for-emacs.md
```

## 設計上の原則

- Emacs core が editor semantics を所有する
- Browser UI は表示と入力の host であり、undo、kill-ring、region、minibuffer、file-visiting semantics を偽装しない
- `.wasifs` は可搬 workspace の単位として扱う
- `vendor/emacs` は read-only とする
- process / pty / socket は MVP では明示的に unavailable boundary として扱う
- product behavior と diagnostic behavior を分ける
- low-level substrate は C/wasm-first とし、JavaScript は browser coordinator / host capability provider / diagnostic harness に留める

## (開発中) VS Code `.wasifs` extension

VS Code `.wasifs` extension は Pages bundle とは別の lane です。

```sh
make vscode-build
```

このコマンドは VS Code 専用 runtime artifacts を `build2/artifacts/` に生成し、webview app bundle を `vscode/app/` に生成します。`docs/app` や `docs/artifacts` は更新しません。

これにより、GitHub Pages 用 browser app と VS Code webview extension 実験を同じ repository 内で共存させつつ、artifact の責務を分離しています。

## 開発メモ

このプロジェクトは、Emacs をブラウザに移植するだけでなく、Emacs が期待する小さな compatibility OS をブラウザ内に与える試みでもあります。

重要なのは、shim を場当たり的に増やすことではなく、Emacs が必要とする lifecycle、memory/root safety、control-flow、blocking input、filesystem/persistence、preloaded state、host capability、browser GUI boundary を、それぞれ責務として整理することです。

そのため、runtime ownership boundary や C/wasm host surface を変更する場合は、単に「動く patch」を入れるのではなく、どの service のどの invariant を満たすのかを明確にしてください。
