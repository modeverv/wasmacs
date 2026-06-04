# OS互換層の変遷と入力ブロッキング問題の記録

## 概要

`emacs --quick --no-splash --nw` をブラウザ wasm worker で動かすにあたり、
Terminal/Tty Service の中核である「ブラウザ入力 → Emacs kbdイベント」の
経路が何度も設計変更を要した。
本文書はその経緯、試みた解決策、現在の設計と残課題をまとめる。

---

## 1. 基本構造

Emacs wasm は Web Worker 内でシングルスレッド同期実行される。
ブラウザ（main thread）からの入力をWorkerに渡す必要があるが、
Worker側では `Atomics.wait` しか使えない（asyncify版は除く）。

```
Main thread                   Worker (wasm)
──────────                   ─────────────
xterm.js onData               callMain → command_loop → read_char
   ↓                              ↑
sendInputToEmacs()          wasmacs_host_wait_for_input()
   ↓                              │
SharedArrayBuffer          Atomics.wait(SAB, 0, lastSeen)
Atomics.add / notify    →  wakes up → reads bytes → [???]
```

「`[???]`の部分をどう実装するか」が問題の核心だった。

---

## 2. 試したアプローチ

### 2.1 sysdep.c パッチ（emfile_read 差し替え）

**アイデア**: `emfile_read`（Emacs の低レベル read）を `#ifdef __EMSCRIPTEN__`
で差し替え、TTY fd への read を `wasmacs_host_terminal_read_byte` に向ける。

```c
// sysdep.c に追加
if (wasmacs_host_is_tty_fd(fd)) {
    while (bytes_read == 0) {
        int byte = wasmacs_host_terminal_read_byte();
        if (byte < 0) {
            wasmacs_host_wait_for_input();  // SABブロック
            continue;
        }
        buf[bytes_read++] = byte;
    }
    return bytes_read;
}
```

**問題**: このパスが実際には呼ばれなかった。

Emacs の TTY入力経路は：
```
kbd_buffer_get_event
  → wait_reading_process_output  ← select() / poll() を使う
  → tty_read_avail_input
  → emacs_read(fd=0)
  → emfile_read  ← sysdep.c パッチが刺さる
```

しかし wasm 環境では `wait_reading_process_output` 内の `select()` が
実際の fd readiness を返さない（emscripten の select は TTY fd を
readable と判定しない）ため、`tty_read_avail_input` が呼ばれず、
`emfile_read` まで到達しなかった。

### 2.2 keyboard.c kbd_buffer_get_event パッチ

**アイデア**: `wait_reading_process_output` の呼び出し箇所を
`wasmacs_host_wait_for_input` に丸ごと置き換える。

```c
// keyboard.c kbd_buffer_get_event 内
#ifdef __EMSCRIPTEN__
    if (kbd_fetch_ptr == kbd_store_ptr)
        wasmacs_host_wait_for_input();
#else
    wait_reading_process_output(0, 0, -1, do_display, Qnil, NULL, 0);
#endif
```

**問題**: `wasmacs_host_wait_for_input` がブロックして bytes を
`__wasmacsTerminalInputBytes` に積んでも、`kbd_buffer_get_event` の
ループには kbd イベントが生成されない。
`wait_reading_process_output` の代替として呼ばれているが、
その後に `tty_read_avail_input` が走らないため、bytes はキューに
残ったまま kbd バッファは空のまま。

### 2.3 read_char レベルのウェイトポイント

**アイデア**: より上位の `read_char` で wait を挿入する。

```c
// keyboard.c read_char 内
if (!noninteractive && !end_time) {
    wasmacs_host_wait_for_input();  // SABブロック
}
c = read_decoded_event_from_main_queue(...);
```

**問題**: wait から返ると bytes が `__wasmacsTerminalInputBytes` に入るが、
その後 `read_decoded_event_from_main_queue` → `kbd_buffer_get_event` に
行っても kbd バッファは空のまま（2.2 と同じ問題）。

結果として：
- wait #1: SABブロック → bytes [97] を JS キューに積む
- `kbd_buffer_get_event` の wait #2: キューに bytes あり → 即リターン
- しかし kbd バッファはまだ空 → ループ継続
- wait #3, #4... → 全て即リターン（busy loop）
- 最終的に Emacs が何らかのエラーで exit(1)

観測されたログ：
```
[atomics host] wait #1 called, inputQueue=0
[atomics host] wait returned, byteCount: 1 counter: 1
[atomics host] queued bytes: [97]
callMain returned: 1  waitCount: 1  termBytes: 11064
```

wait #1 の後に read_byte ログが出ず、wait #2 も出ずに即終了。
bytes は消費されないまま Emacs が exit した。

### 2.4 TTY ops パッチ（onRuntimeInitialized）

emscripten の TTY ops を直接パッチする方法も試みた。

```js
// emacs-atomics-worker.js onRuntimeInitialized 内
stream.tty.ops.get_char = () => {
    const q = globalThis.__wasmacsTerminalInputBytes || [];
    return q.length ? q.shift() : undefined;
};
stream.tty.ops.put_char = (tty, val) => {
    globalThis.__wasmacsTerminalOutputBytes.push(val & 255);
};
stream.tty.ops.ioctl_tcgets = () => ({
    c_iflag:0, c_oflag:0, c_cflag:2237, c_lflag:0, ...
});
stream.tty.ops.ioctl_tiocgwinsz = () => [24, 80];
```

`get_char` が `__wasmacsTerminalInputBytes` から読むように設定したが、
これは emscripten の select() が TTY fd readiness を判定する際に参照
される可能性があった。しかし `wait_reading_process_output` が
`tty_read_avail_input` を呼ばないという根本問題は変わらず。

---

## 3. 根本原因の特定

**コールパスの断絶**: bytes が `__wasmacsTerminalInputBytes` に入っても、
それを Emacs の kbd イベントバッファ（`kbd_buffer_store_event`）に
変換する経路が wasm 環境では機能しない。

正常な POSIX 環境でのパスは：
```
select(fd=0, readable) → tty_read_avail_input → emacs_read → emfile_read
→ bytes → ASCII_KEYSTROKE_EVENT → kbd_buffer_store_event
```

wasm 環境では：
- emscripten の `select()` は TTY fd=0 を readable と判定しない
- そのため `tty_read_avail_input` が呼ばれない
- bytes は JS キューに留まり、kbd バッファに到達しない

つまり「本格的な select() 対応」が必要とされるのは、まさにここの問題だった。

### select() への対応について

emscripten の `select()` を TTY readiness に正しく応答させるには：

**案A**: emscripten の TTY fd 実装に hook を入れ、
`__wasmacsTerminalInputBytes` に bytes があれば readable を返すようにする。
→ emscripten 内部への深い介入が必要。維持コスト高。

**案B**: `wait_reading_process_output` ごと差し替え、その後に
`tty_read_avail_input` を手動で呼ぶ C パッチを書く。
→ kbd イベント生成まで届くが、内部状態の一貫性が難しい。

**案C（採用）**: 最上流で bytes を kbd イベントとして直接注入する。
JS から `_wasmacs_input_text`（C エクスポート）を呼ぶ。

---

## 4. 採用した解決策

### 4.1 設計

`wasmacs_host_wait_for_input`（JS）が SAB から bytes を読んだ後、
`__wasmacsTerminalInputBytes` ではなく `_wasmacs_input_text`（C 関数）を
呼び出して kbd バッファに直接注入する。

```
Atomics.wait wakes up
  → read bytes from SAB
  → _malloc(byteCount + 1)
  → HEAPU8.set(data, ptr)
  → _wasmacs_input_text(ptr)    ← C を呼び戻す
      → wasmacs_input_text (keyboard.c)
          → kbd_buffer_store_event (ASCII_KEYSTROKE_EVENT)
  → _free(ptr)
  → return to C call stack
```

`_wasmacs_input_text` は C → JS → C の再入だが、
wasm（asyncify なし）はシングルスレッド同期なので問題ない。

### 4.2 コールスタック

```
C: read_char
  → C: wasmacs_host_wait_for_input (extern, JS import)
    → JS: Atomics.wait (blocks)
    → JS: _wasmacs_input_text(ptr)  (wasm export を呼び戻す)
      → C: wasmacs_input_text
        → C: kbd_buffer_store_event   ← kbd バッファに入る
    → JS: return
  ← C: returns from wasmacs_host_wait_for_input
C: read_decoded_event_from_main_queue
  → kbd_buffer_get_event
    → kbd バッファに event あり → 即リターン ✓
```

### 4.3 kbd_buffer_get_event パッチとの整合

```c
#ifdef __EMSCRIPTEN__
    if (kbd_fetch_ptr == kbd_store_ptr)
        wasmacs_host_wait_for_input();  // 空なら wait → inject
#else
    wait_reading_process_output(...);
#endif
```

read_char レベルで wait → inject が済んでいれば、
kbd バッファは非空 → `kbd_fetch_ptr != kbd_store_ptr` → 
`kbd_buffer_get_event` の wait は呼ばれない。
double-wait 問題は自然に解消される。

### 4.4 変更箇所

**`scripts/wasmacs-atomics-host-library.js`** — ソース（次ビルドで反映）

変更前:
```js
// bytes を __wasmacsTerminalInputBytes キューに積む
if (inputQueue.length > 0) { return; }  // early return
// Atomics.wait ...
queue.push(dataView[i]);  // JS キューに積むだけ
```

変更後:
```js
// Atomics.wait ...
var ptr = _malloc(byteCount + 1);
HEAPU8.set(data, ptr);
HEAPU8[ptr + byteCount] = 0;
_wasmacs_input_text(ptr);   // kbd バッファへ直接注入
_free(ptr);
```

**`artifacts/emacs-browser-atomics/temacs`** — ホットパッチ済み（即時有効）

---

## 5. 残課題と設計上の懸念

### 5.1 sysdep.c パッチの扱い

現在 `sysdep.c` の `emfile_read` パッチは残っているが、
新しい経路では `__wasmacsTerminalInputBytes` を経由しないため、
`wasmacs_host_terminal_read_byte` は常に -1 を返す。
`emfile_read` パッチが別の経路で呼ばれた場合（`tty_read_avail_input` が
何らかの理由で呼ばれた場合）は再度 SAB でブロックしてしまう。

次のビルドでは sysdep.c パッチを外すか、
または `__wasmacsTerminalInputBytes` 経路を明示的に dead code として除去すべき。

### 5.2 マルチバイト入力（エスケープシーケンス）

`_wasmacs_input_text` は byte ごとに `ASCII_KEYSTROKE_EVENT` を生成する。
矢印キーは `\x1b[A`（3バイト）として届くが、各バイトが独立した
イベントとして kbd バッファに入る。

Emacs の TTY ターミナルドライバが `ESC [ A` を up-arrow として認識するには、
TERM/TERMCAP の設定と、Emacs のターミナルキーマップ処理が必要。
`TERM=dumb` ではエスケープシーケンスの解釈が限定的。

実用的なキー入力（矢印キー、ファンクションキー）のためには
TERM を `xterm` か `xterm-256color` に変更する必要がある。

### 5.3 出力フラッシュのタイミング

terminal output bytes は `wasmacs_host_wait_for_input` の先頭で
まとめてフラッシュされる設計。
コマンド実行の途中で wait が呼ばれない場合、
出力が画面に現れないまま Emacs がループし続ける可能性がある。

kbd_buffer_get_event 内の wait（bytes があれば即リターン）でも
フラッシュは走るが、idle 中に出力がたまった場合のフラッシュ契機が
wait 呼び出しに依存している点は設計上の弱点。

### 5.4 `wait_reading_process_output` の代替

現在 `kbd_buffer_get_event` で `wait_reading_process_output` を
完全に除去しているため、do_display（表示の定期更新）が行われない。
Emacs が長時間処理を行う場合、redisplay が呼ばれないまま続く可能性がある。

small-os-for-emacs.md の「Blocking Input Scheduler」サービス設計と照合すると、
この点は「Input Scheduler x Terminal」の cross-service check に該当する。

---

## 6. 設計方針の整理（small-os-for-emacs.md との対応）

| サービス | 現状 |
|---------|------|
| Lifecycle | EXIT_RUNTIME=0、noInitialRun、onRuntimeInitialized で管理 ✓ |
| Memory/Root | ENTER/LEAVE_HOST_ENTRYPOINT マクロで管理 ✓ |
| Control-Flow | ExitStatus 例外のハンドリング ✓ |
| Blocking Input Scheduler | **本ドキュメントの主題。kbd 直接注入で暫定解決** |
| Terminal/Tty | isatty/tcgetattr/tiocgwinsz は fake ✓。`read()` 経路は迂回中 |
| Filesystem | emscripten preload-file で /usr/local/share/emacs/30.2 をマウント ✓ |
| Preloaded State | 非対象（diagnostic only） |
| Host Capability | TERM=dumb（要変更）、ENV 設定済み |
| Browser GUI | xterm.js terminal-output-bytes メッセージで接続 ✓ |

---



## 8. OS 互換層: `tty_read_avail_input` → `emacs_read` → `emfile_read` チェーンの導入

### 設計方針

4.1 の kbd 直接注入アプローチは `select(fd=0)` 問題を迂回したが、
標準的な `tty_read_avail_input → emacs_read → emfile_read → read()` チェーンを
使うことで、以下の利点がある：

- Emacs の端末ドライバ（キーマップ変換、メタキー処理、エスケープシーケンス）が自然に使える
- `wait_reading_process_output` の全機能（do_display, タイマー, プロセス）への拡張が容易
- `small-os-for-emacs.md` の Terminal/Tty Service 設計と整合する

### 実装の核心

3 つの変更だけで成立する：

#### 1. JS: `wasmacs_host_wait_for_input` を queue 注入に変更

**変更前** (4.1 方式):
```js
// bytes を _wasmacs_input_text で直接 kbd buffer に注入
_wasmacs_input_text(ptr);
```

**変更後** (os-compat 方式):
```js
// bytes を __wasmacsTerminalInputBytes に投入。
// TTY get_char op から read() syscall 経由で読み取られる。
var queue = globalThis.__wasmacsTerminalInputBytes;
for (var i = 0; i < byteCount; i++) queue.push(data[i]);
```

#### 2. JS: TTY stream_ops に FIONREAD ioctl を追加

Emacs の `tty_read_avail_input` は read 前に `ioctl(FIONREAD)` で利用可能バイト数を確認する。
emscripten の TTY stream_ops には ioctl がないため、追加する：

```js
TTY.stream_ops.ioctl = function(stream, cmd, arg) {
    if (cmd === 0x541B) {  // FIONREAD
        var available = (globalThis.__wasmacsTerminalInputBytes || []).length;
        HEAP32[arg >> 2] = available;
        return 0;
    }
    return -25; // ENOTTY
};
```

#### 3. C: `kbd_buffer_get_event` で wait 後に terminal drain

```c
#ifdef __EMSCRIPTEN__
  if (kbd_fetch_ptr == kbd_store_ptr) {
      wasmacs_host_wait_for_input ();
      /* drain terminal bytes through tty_read_avail_input chain */
      struct terminal *t;
      struct input_event ie;
      for (t = terminal_list; t; t = t->next_terminal)
          if (t->read_socket_hook)
              while ((*t->read_socket_hook) (t, &ie) > 0)
                  ;
  }
#else
  wait_reading_process_output (0, 0, -1, do_display, Qnil, NULL, 0);
#endif
```

### データフロー

```text
ブラウザ main thread          Worker (wasm)
──────────────                ────────────
xterm.js onData               command_loop → read_char
   ↓                              ↓
SharedArrayBuffer             kbd_buffer_get_event
   ↓                              ↓
Atomics.notify                wasmacs_host_wait_for_input
   ↓                              ↓ Atomics.wait (blocks)
                              wakes → __wasmacsTerminalInputBytes
                                  ↓
                              t->read_socket_hook
                              = tty_read_avail_input
                                  ↓ ioctl(FIONREAD) → TTY.stream_ops.ioctl
                                  ↓ emacs_read(0, cbuf, n)
                                  ↓ emfile_read → read()
                                  ↓ TTY get_char → bytes from queue
                                  ↓ kbd_buffer_store_event
```

### 変更ファイル

- `scripts/wasmacs-atomics-host-library.js` — FIONREAD ioctl 追加、queue 注入に変更
- `scripts/patch-emacs-host-entrypoint-spike.sh` — `os-compat` モード追加
- `scripts/build-emacs-browser-atomics.sh` — `os-compat` モードを使用

### sysdep.c パッチの除去

`emfile_read` の sysdep.c パッチは os-compat モードでは不要。
`read(0, ...)` は emscripten TTY → get_char を通るため、
C レベルでのインターセプトが不要になった。

### 残課題

1. **Node.js テスト出力**: vm.createContext で `console.log` が `Module.print` 経由で失われる
2. **ブラウザ実環境テスト**: Web Worker + SharedArrayBuffer + xterm.js との統合
3. **`do_display` の復活**: `read_socket_hook` 後に `redisplay_preserve_echo_area` が必要

## 7. 結論（旧）

**本格的な select() 対応は必要なかった**。
問題は「select() が TTY fd を readable と判定しないこと」ではなく、
「bytes を kbd イベントバッファに変換する経路が存在しなかったこと」だった。

解決策は emscripten のシステムコールレベルに降りるのではなく、
Emacs が既にエクスポートしている `wasmacs_input_text`（C関数）を
JS から呼び戻すという、シンプルな C/wasm-first アプローチだった。

この変更により、`wasmacs_host_wait_for_input` は「bytes をキューに積む」
役割から「bytes を kbd イベントとして直接注入する」役割に変わった。
`__wasmacsTerminalInputBytes` / `wasmacs_host_terminal_read_byte` 経路は
実質的に不要になっている。

次の優先課題:
1. ブラウザで 'a' 入力後にクラッシュしないことの確認（ホットパッチ済み）
2. TERM 設定の変更（dumb → xterm-256color）によるエスケープシーケンス対応
3. sysdep.c パッチの整理（不要経路の除去）
4. 出力フラッシュの改善（wait 依存からの脱却）
