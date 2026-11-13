// Kernel tests without Emacs: a plain Emscripten module (fshost) owns the
// shared FS and plays pid 1; the processes are instances of ktest.
//
//   tests/process/build-test-programs.sh && node tests/process/run-kernel-tests.mjs [filter]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import v8 from "node:v8";
import vm from "node:vm";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const buildDir = `${repoRoot}build/process-tests`;
const userlandDir = `${repoRoot}build/artifacts/userland`;
const require = createRequire(`${buildDir}/package.json`);
const filter = process.argv[2] || "";

for (const file of ["wasmacs-kernel.js", "wasmacs-userland.js"]) {
  vm.runInThisContext(readFileSync(`${repoRoot}src/runtime/process/${file}`, "utf8"), { filename: file });
}
const { WasmacsKernel, WasmacsUserland } = globalThis;
const C = WasmacsKernel.constants;

const host = await require(`${buildDir}/fshost.js`)();
host.callMain?.([]);
const FS = host.FS;
const scratch = host._malloc(256);
const sleepCell = new Int32Array(new SharedArrayBuffer(4));
const hostState = { quitRequested: 0, takeQuit: false, signals: [], log: [] };

// Program images that exist only for one test: name -> { factory, wasm }.
const fakeImages = new Map();
// A full, synchronous garbage collection (to see what stays reachable).
v8.setFlagsFromString("--expose-gc");
const collectGarbage = vm.runInNewContext("gc");

const kernel = WasmacsKernel.create({
  FS,
  views: () => ({ HEAPU8: host.HEAPU8, HEAP32: host.HEAP32, HEAP16: host.HEAP16 }),
  now: () => performance.now(),
  log: (msg) => hostState.log.push(msg),
  loadProgram: (name) => {
    if (fakeImages.has(name)) return fakeImages.get(name);
    const dir = existsSync(`${buildDir}/${name}.js`) ? buildDir : userlandDir;
    return { factory: require(`${dir}/${name}.js`), wasm: readFileSync(`${dir}/${name}.wasm`) };
  },
  raiseSignal: (sig) => { hostState.signals.push(sig); host._fshost_raise(sig); },
  requestQuit: () => { hostState.quitRequested++; },
  drainKeyboard: () => {},
  keyboardPending: () => false,
  takeQuitChar: () => { const t = hostState.takeQuit; hostState.takeQuit = false; return t; },
  flushTerminalOutput: () => {},
  waitForInput: (ms) => { Atomics.wait(sleepCell, 0, 0, Math.max(0, Math.min(ms, 1000))); },
});

// ---- the "Emacs side" of the tests ----------------------------------------
FS.mkdirTree("/bin");
FS.mkdirTree("/work");
FS.writeFile("/bin/ktest", "\x7fwasmacs-exec ktest\n");
FS.chmod("/bin/ktest", 0o755);
const nullFd = FS.open("/dev/null", "r").fd;

function pipe(flags = 0) {
  const r = kernel.emacsPipe2(scratch, flags);
  if (r !== 0) throw new Error(`pipe2 failed: ${r}`);
  return [host.HEAP32[scratch >> 2], host.HEAP32[(scratch >> 2) + 1]];
}
const close = (fd) => FS.close(FS.getStream(fd));
function spawn(argv, { stdin = nullFd, stdout, stderr, cwd = "/work", env = ["PATH=/bin", "KTEST_VAR=from-host"] } = {}) {
  return kernel.emacsSpawn(argv, env, cwd, [stdin, stdout, stderr ?? stdout]);
}
// Blocking read like Emacs's call_process loop: until EOF.
function readAll(fd) {
  const chunks = [];
  const buf = new Uint8Array(65536);
  for (;;) {
    const n = FS.read(FS.getStream(fd), buf, 0, buf.length);
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks);
}
function readLine(fd) {
  const buf = new Uint8Array(1);
  let line = "";
  for (;;) {
    const n = FS.read(FS.getStream(fd), buf, 0, 1);
    if (n === 0) return line;
    line += String.fromCharCode(buf[0]);
    if (buf[0] === 10) return line;
  }
}
function write(fd, text) {
  const bytes = Buffer.from(text);
  let off = 0;
  while (off < bytes.length) off += FS.write(FS.getStream(fd), bytes, off, bytes.length - off);
}
function waitpid(pid, options = 0) {
  host.HEAP32[scratch >> 2] = -1;
  const r = kernel.emacsWaitpid(pid, scratch, options);
  const status = host.HEAP32[scratch >> 2];
  return { r, status, exited: (status & 0x7f) === 0, code: (status >> 8) & 0xff, signal: status & 0x7f };
}
// Run a program to completion with its output on a pipe (a synchronous call-process).
function run(argv, options = {}) {
  const [r, w] = pipe();
  const pid = spawn(argv, { ...options, stdout: w });
  close(w);
  if (pid < 0) { close(r); return { pid, out: "" }; }
  const out = readAll(r).toString();
  close(r);
  return { pid, out, ...waitpid(pid) };
}

// ---- tiny test runner -------------------------------------------------------
let failures = 0, ran = 0;
function test(name, fn) {
  if (filter && !name.includes(filter)) return;
  ran++;
  const t0 = performance.now();
  try {
    fn();
    console.log(`PASS ${name} (${Math.round(performance.now() - t0)}ms)`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}: ${e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n   ") : e}`);
    for (const line of hostState.log.splice(0)) console.log(`   log: ${line}`);
  }
  hostState.log.length = 0;
}
function eq(actual, expected, what = "value") {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function has(text, needle) {
  if (!String(text).includes(needle)) throw new Error(`expected ${JSON.stringify(text)} to include ${JSON.stringify(needle)}`);
}
function noLeak() {
  eq(kernel.liveCount(), 0, "live processes");
  eq(kernel.procs.size, 1, "process table entries");
}
// What the shared filesystem holds: every node (files, directories, the
// roots of mounts) is in FS.nameTable.
function fsNodeCount() {
  let count = 0;
  for (let node of FS.nameTable) for (; node; node = node.name_next) count++;
  return count;
}
function heapUsedAfterGc() {
  collectGarbage();
  collectGarbage();
  return process.memoryUsage().heapUsed;
}

// ---- tests ---------------------------------------------------------------------
test("constants match the Emscripten headers", () => {
  const headers = JSON.parse(execFileSync(process.execPath, [`${buildDir}/consts.js`], { encoding: "utf8" }));
  for (const [name, value] of Object.entries(headers)) {
    if (name in C) eq(C[name], value, name);
  }
  eq(headers.sizeof_pollfd, 8, "sizeof(struct pollfd)");
  eq(headers.F_DUPFD_CLOEXEC, 1030, "F_DUPFD_CLOEXEC");
});

test("spawn: argv, environment, cwd, ids, exit status", () => {
  const r = run(["/bin/ktest", "hello", "a", "b c"]);
  has(r.out, "argc=4\n");
  has(r.out, "argv[0]=/bin/ktest\n");
  has(r.out, "argv[3]=b c\n");
  has(r.out, "KTEST_VAR=from-host\n");
  has(r.out, "cwd=/work\n");
  has(r.out, `pid=${r.pid} ppid=1 pgid=${r.pid}\n`);
  has(r.out, "isatty=000\n");
  has(r.out, "hello-stderr\n");
  eq(r.r, r.pid, "waitpid");
  eq(r.exited && r.code, 4, "exit status");
  eq(FS.cwd(), "/", "host cwd");
  noLeak();
});

test("spawn errors: ENOENT, EACCES, ENOEXEC, missing image", () => {
  const [r, w] = pipe();
  eq(spawn(["/bin/nope"], { stdout: w }), -C.ENOENT, "missing file");
  FS.writeFile("/bin/plain", "\x7fwasmacs-exec ktest\n");
  FS.chmod("/bin/plain", 0o644);
  eq(spawn(["/bin/plain"], { stdout: w }), -C.EACCES, "no x bit");
  FS.writeFile("/bin/binary", "\x7fELF garbage");
  FS.chmod("/bin/binary", 0o755);
  eq(spawn(["/bin/binary"], { stdout: w }), -C.ENOEXEC, "not a program");
  FS.writeFile("/bin/ghost", "\x7fwasmacs-exec no-such-image\n");
  FS.chmod("/bin/ghost", 0o755);
  eq(spawn(["/bin/ghost"], { stdout: w }), -C.ENOEXEC, "image not available");
  eq(spawn(["/bin/ktest"], { stdout: w, cwd: "/no/such/dir" }), -C.ENOENT, "missing cwd");
  close(r); close(w);
  noLeak();
});

test("script with #! runs through its interpreter", () => {
  FS.writeFile("/work/script", "#!/bin/ktest hello\nignored body\n");
  FS.chmod("/work/script", 0o755);
  const r = run(["/work/script", "x"]);
  has(r.out, "argv[0]=/bin/ktest\nargv[1]=hello\nargv[2]=/work/script\nargv[3]=x\n");
  eq(r.code, 4, "exit status");
});

test("pipes: stdin in steps, EOF on close, output until EOF", () => {
  const [inR, inW] = pipe();
  const [outR, outW] = pipe();
  const pid = spawn(["/bin/ktest", "cat"], { stdin: inR, stdout: outW });
  close(inR); close(outW);
  write(inW, "first\n");
  eq(readLine(outR), "first\n", "echo 1");
  write(inW, "second\n");
  eq(readLine(outR), "second\n", "echo 2");
  eq(waitpid(pid, C.WNOHANG).r, 0, "still running");
  close(inW);
  eq(readAll(outR).toString(), "cat: 13 bytes\n", "stderr summary then EOF");
  close(outR);
  const w = waitpid(pid);
  eq(w.exited && w.code, 0, "exit status");
  noLeak();
});

test("shared filesystem: child and host see each other's files", () => {
  FS.mkdirTree("/work/fs");
  FS.writeFile("/work/fs/from-host.txt", "written by the host\n");
  const r = run(["/bin/ktest", "fsops", "/work/fs"]);
  has(r.out, "host-file=written by the host\n");
  has(r.out, "entries=3 cwd=/work/fs\n");
  has(r.out, "mmap=written by the child\n");
  eq(r.code, 0, `exit status (${r.out})`);
  eq(FS.readFile("/work/fs/renamed.txt", { encoding: "utf8" }), "written by the child\n", "child file");
  eq(FS.stat("/work/fs/renamed.txt").mode & 0o777, 0o600, "chmod");
  eq(FS.cwd(), "/", "host cwd unchanged by the child's chdir");
});

test("fork: copied memory, shared descriptors, deep stack, exit status", () => {
  const r = run(["/bin/ktest", "fork"]);
  has(r.out, "unflushed-before-fork child counter=1000 heap=child-heap\n");
  has(r.out, "unflushed-before-fork parent counter=42 heap=heap-before-fork status=7 msg=from the forked child\n");
  eq(r.code, 0, "exit status");
  noLeak();
});

test("fork + exec pipeline (what a shell does)", () => {
  const r = run(["/bin/ktest", "pipeline", "/bin/ktest", "20000"]);
  has(r.out, "lines=20000 bytes=");
  has(r.out, "pipeline status=0,0\n");
  noLeak();
});

test("vfork + exec pipeline", () => {
  const r = run(["/bin/ktest", "vpipeline", "/bin/ktest", "300"]);
  has(r.out, "lines=300 bytes=");
  has(r.out, "pipeline status=0,0\n");
  noLeak();
});

test("posix_spawnp, ECHILD, system()", () => {
  FS.writeFile("/bin/sh", "\x7fwasmacs-exec ktest\n");   // "sh -c 'exit 9'" -> ktest: unknown mode -> 2
  FS.chmod("/bin/sh", 0o755);
  const r = run(["/bin/ktest", "spawn"]);
  has(r.out, "argv[2]=spawned\n");
  has(r.out, "spawn status=3\n");
  has(r.out, "spawn missing=ENOENT\n");
  has(r.out, "system=2\n");
  FS.unlink("/bin/sh");
  noLeak();
});

test("close-on-exec is honoured by exec", () => {
  const r = run(["/bin/ktest", "cloexec", "/bin/ktest"]);
  has(r.out, "flags keep=0 gone=1 dupped=1 cleared=0\n");
  const lines = r.out.split("\n").filter((l) => l.startsWith("fd "));
  eq(lines.map((l) => l.split(" ")[2]).join(","), "open,closed,closed,open", "descriptors after exec");
});

test("signals: handler interrupts a blocked read (EINTR), twice", () => {
  const [inR, inW] = pipe();
  const [outR, outW] = pipe();
  const pid = spawn(["/bin/ktest", "sigread"], { stdin: inR, stdout: outW });
  close(inR); close(outW);
  eq(readLine(outR), "ready\n", "ready");
  eq(kernel.emacsKill(pid, 10 /* SIGUSR1, ignored */), 0, "ignored signal");
  eq(kernel.emacsKill(pid, C.SIGINT), 0, "kill");
  eq(readLine(outR), "read=-1 errno=EINTR got=2\n", "first read");
  eq(kernel.emacsKill(pid, C.SIGINT), 0, "kill again");
  eq(readLine(outR), "second=-1 got=2\n", "second read");
  eq(readAll(outR).length, 0, "EOF");
  const w = waitpid(pid);
  eq(w.exited && w.code, 5, "exit status");
  close(inW); close(outR);
  noLeak();
});

test("signals: handler longjmps out of a blocked read", () => {
  const [inR, inW] = pipe();
  const [outR, outW] = pipe();
  const pid = spawn(["/bin/ktest", "sigjmp"], { stdin: inR, stdout: outW });
  close(inR); close(outW);
  eq(readLine(outR), "ready\n", "ready");
  kernel.emacsKill(pid, C.SIGINT);
  eq(readAll(outR).toString(), "jumped out of read with signal 2\n", "output");
  eq(waitpid(pid).code, 0, "exit status");
  close(inW); close(outR);
});

test("signals: default action kills a blocked process; process groups; ESRCH", () => {
  const [inR, inW] = pipe();
  const [outR, outW] = pipe();
  const pid = spawn(["/bin/ktest", "block"], { stdin: inR, stdout: outW });
  close(inR); close(outW);
  eq(readLine(outR), "ready\n", "ready");
  eq(kernel.emacsKill(-pid, C.SIGTERM), 0, "kill the process group");
  eq(readAll(outR).length, 0, "EOF after death");
  const w = waitpid(pid);
  eq(w.exited, false, "signaled");
  eq(w.signal, C.SIGTERM, "WTERMSIG");
  eq(kernel.emacsKill(pid, C.SIGTERM), -C.ESRCH, "ESRCH");
  eq(waitpid(pid).r, -C.ECHILD, "ECHILD");
  close(inW); close(outR);
  noLeak();
});

test("SIGCHLD reaches the host when a child exits", () => {
  const before = host._fshost_sigchld_count();
  const [outR, outW] = pipe();
  const pid = spawn(["/bin/ktest", "hello"], { stdout: outW });
  close(outW);
  readAll(outR);
  close(outR);
  eq(kernel.emacsAttention(), true, "attention");
  eq(host._fshost_sigchld_count(), before + 1, "SIGCHLD handler ran in the host");
  eq(kernel.emacsAttention(), false, "attention is edge triggered");
  waitpid(pid);
});

test("exit statuses: exit, return, abort, trap, kill(self)", () => {
  eq(run(["/bin/ktest", "crash", "exit3"]).code, 3, "exit(3)");
  eq(run(["/bin/ktest", "crash", "return4"]).code, 4, "return 4");
  const a = run(["/bin/ktest", "crash", "abort"]);
  eq(!a.exited && a.signal, C.SIGABRT, "abort()");
  const s = run(["/bin/ktest", "crash", "segv"]);
  eq(!s.exited && s.signal, C.SIGSEGV, "wild pointer");
  const k = run(["/bin/ktest", "crash", "kill-self"]);
  eq(!k.exited && k.signal, C.SIGTERM, "kill(getpid(), SIGTERM)");
  noLeak();
});

test("SIGPIPE: writing to a pipe nobody reads kills the writer", () => {
  const [outR, outW] = pipe();
  const pid = spawn(["/bin/ktest", "big", "1000000"], { stdout: outW });
  close(outW);
  close(outR);
  const w = waitpid(pid);
  eq(!w.exited && w.signal, C.SIGPIPE, "killed by SIGPIPE");
});

test("bounded pipe: 5 MB arrive intact through a 64 KiB pipe", () => {
  const r = run(["/bin/ktest", "big", "5000000"]);
  eq(r.out.length, 5000000, "length");
  let ok = true;
  for (let i = 0; i < r.out.length; i += 7919) if (r.out.charCodeAt(i) !== 97 + (i % 65536) % 26) { ok = false; break; }
  eq(ok, true, "pattern");
  eq(r.code, 0, "exit status");
});

test("sleep: kernel timers wake a sleeper while nothing is runnable", () => {
  const t0 = performance.now();
  const r = run(["/bin/ktest", "sleep", "150"]);
  has(r.out, "slept>=150 ok\n");
  const elapsed = performance.now() - t0;
  if (elapsed < 145 || elapsed > 1500) throw new Error(`elapsed ${elapsed}ms`);
});

test("poll: timeout, then readiness on a pipe", () => {
  const [inR, inW] = pipe();
  const [outR, outW] = pipe();
  const pid = spawn(["/bin/ktest", "poll"], { stdin: inR, stdout: outW });
  close(inR); close(outW);
  eq(readLine(outR), "poll-timeout=0\n", "timeout");
  write(inW, "x");
  eq(readLine(outR), "poll-ready=1 revents=1 read=1\n", "ready");
  close(inW);
  readAll(outR); close(outR);
  eq(waitpid(pid).code, 0, "exit status");
});

test("preemption: a busy process does not starve the host", () => {
  const [outR, outW] = pipe();
  const pid = spawn(["/bin/ktest", "spin", "200"], { stdout: outW });
  close(outW);
  let longest = 0, pumps = 0;
  const t0 = performance.now();
  while (waitpid(pid, C.WNOHANG).r === 0) {
    const a = performance.now();
    kernel.pump(20);
    longest = Math.max(longest, performance.now() - a);
    pumps++;
    if (performance.now() - t0 > 5000) throw new Error("spin did not finish");
  }
  has(readAll(outR).toString(), "spin done");
  close(outR);
  if (longest > 80) throw new Error(`a single pump ran for ${longest.toFixed(1)}ms`);
  if (pumps < 4) throw new Error(`only ${pumps} scheduling rounds`);
});

test("C-g while the host is blocked ends the wait with EINTR", () => {
  const [inR, inW] = pipe();
  const [outR, outW] = pipe();
  const pid = spawn(["/bin/ktest", "block"], { stdin: inR, stdout: outW });
  close(inR); close(outW);
  eq(readLine(outR), "ready\n", "ready");
  hostState.takeQuit = true;
  let errno = 0;
  try { FS.read(FS.getStream(outR), new Uint8Array(1), 0, 1); } catch (e) { errno = e.errno; }
  eq(errno, C.EINTR, "read errno");
  eq(hostState.quitRequested, 1, "quit requested in the host");
  hostState.takeQuit = true;
  eq(waitpid(pid).r, -C.EINTR, "waitpid is interruptible too");
  kernel.emacsKill(pid, C.SIGKILL);
  eq(waitpid(pid).signal, C.SIGKILL, "killed");
  close(inW); close(outR);
  noLeak();
});

test("a program that mounts a filesystem at startup is refused", () => {
  // Emscripten's SOCKFS and PIPEFS do that; in the shared FS the mount would
  // outlive the process and keep its instance alive.
  fakeImages.set("mounter", {
    factory: async (M) => { M.wasmacsFS.mount({ mount: () => null }, {}, null); },
    wasm: new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
  });
  FS.writeFile("/bin/mounter", "\x7fwasmacs-exec mounter\n");
  FS.chmod("/bin/mounter", 0o755);
  const nodes = fsNodeCount();
  const [r, w] = pipe();
  const pid = spawn(["/bin/mounter"], { stdout: w });
  if (pid >= 0) throw new Error(`spawn succeeded (pid ${pid})`);
  has(hostState.log.join("\n"), "mounts a filesystem at startup");
  eq(fsNodeCount(), nodes, "nodes in the shared FS");
  eq(typeof FS.mount, "function", "FS.mount is back");
  close(r); close(w);
  noLeak();
});

test("300 spawn/exit cycles", () => {
  const t0 = performance.now();
  for (let i = 0; i < 300; i++) {
    const r = run(["/bin/ktest", "crash", "exit3"]);
    if (r.code !== 3) throw new Error(`cycle ${i}: ${JSON.stringify(r)}`);
  }
  const per = (performance.now() - t0) / 300;
  console.log(`   ${per.toFixed(2)} ms per spawn+exit`);
  noLeak();
});

// ---- userland (only when it has been built) ----------------------------------
const manifest = existsSync(`${userlandDir}/manifest.json`)
  ? JSON.parse(readFileSync(`${userlandDir}/manifest.json`, "utf8"))
  : { programs: {} };
const haveBusybox = Boolean(manifest.programs.busybox);
const haveGit = Boolean(manifest.programs.git);
const haveGrep = Boolean(manifest.programs.grep);
function installBusybox() {
  WasmacsUserland.install(FS, manifest);
  FS.mkdirTree("/home/user");
}
const shEnv = ["PATH=/bin:/usr/bin", "HOME=/home/user", "TERM=dumb", "PWD=/work"];
const sh = (script, options = {}) => run(["/bin/sh", "-c", script], { env: shEnv, ...options });

if (haveBusybox) {
  installBusybox();

  test("busybox sh: builtins, variables, loops, exit status", () => {
    const r = sh('x=3; for i in 1 2 3; do x=$((x + i)); done; echo "x=$x"; pwd; test -d /bin && echo dir; exit 7');
    eq(r.out, "x=9\n/work\ndir\n", "output");
    eq(r.exited && r.code, 7, "exit status");
    noLeak();
  });

  test("busybox sh: external commands, pipelines, redirection, command substitution", () => {
    FS.writeFile("/work/words.txt", "pear\napple\nfig\napple\n");
    const r = sh('sort words.txt | uniq -c | sort -rn | head -1 | tr -s " "; n=$(wc -l < words.txt); echo "n=$n"; ' +
                 'grep -c apple words.txt > count.txt; cat count.txt; ls /work/*.txt | wc -l');
    has(r.out, " 2 apple\n");
    has(r.out, "n=4\n");
    has(r.out, "\n2\n");
    eq(r.code, 0, `exit status (${JSON.stringify(r.out)})`);
    eq(FS.readFile("/work/count.txt", { encoding: "utf8" }), "2\n", "redirected file");
    noLeak();
  });

  test("busybox tools: find, sed, awk, diff, tar, gzip", () => {
    const r = sh('mkdir -p t/a t/b && echo one > t/a/1.txt && echo two > t/b/2.txt && ' +
                 'find t -name "*.txt" | sort && sed -e s/one/ONE/ t/a/1.txt && ' +
                 "awk '{ print NR \":\" $0 }' t/b/2.txt && " +
                 '(diff -u t/a/1.txt t/b/2.txt | tail -2; true) && ' +
                 'tar czf t.tgz t && rm -r t && tar xzf t.tgz && cat t/a/1.txt t/b/2.txt');
    eq(r.out, "t/a/1.txt\nt/b/2.txt\nONE\n1:two\n-one\n+two\none\ntwo\n", "output");
    eq(r.code, 0, "exit status");
    noLeak();
  });

  test("busybox sh: background job, wait, kill, trap", () => {
    const r = sh('sleep 5 & pid=$!; kill $pid; wait $pid; echo "status=$?"; ' +
                 "trap 'echo trapped' TERM; kill -TERM $$; echo after");
    eq(r.out, "status=143\ntrapped\nafter\n", "output");
    noLeak();
  });

  test("busybox sh: a shell script without #! is run by the shell (ENOEXEC)", () => {
    FS.writeFile("/work/plain.sh", "echo plain-script $1\n");
    FS.chmod("/work/plain.sh", 0o755);
    FS.writeFile("/work/shebang.sh", "#!/bin/sh\necho shebang-script $1\n");
    FS.chmod("/work/shebang.sh", 0o755);
    const r = sh("./plain.sh a; ./shebang.sh b; ./missing.sh; echo rc=$?");
    has(r.out, "plain-script a\nshebang-script b\n");
    has(r.out, "rc=127\n");
    noLeak();
  });

  test("interactive sh over pipes (what M-x shell does)", () => {
    const [inR, inW] = pipe();
    const [outR, outW] = pipe();
    const pid = spawn(["/bin/sh", "-i"], { stdin: inR, stdout: outW, env: [...shEnv, "PS1=$ "] });
    close(inR); close(outW);
    const until = (needle) => {
      let acc = "";
      const buf = new Uint8Array(4096);
      while (!acc.includes(needle)) {
        const n = FS.read(FS.getStream(outR), buf, 0, buf.length);
        if (n === 0) throw new Error(`EOF while waiting for ${JSON.stringify(needle)}; got ${JSON.stringify(acc)}`);
        acc += Buffer.from(buf.subarray(0, n)).toString();
      }
      return acc;
    };
    until("$ ");
    write(inW, "echo hello from sh\n");
    has(until("$ "), "hello from sh\n");
    write(inW, "cd /tmp && pwd\n");
    has(until("$ "), "/tmp\n");
    write(inW, "ls /bin | grep -c .\n");
    const count = Number(until("$ ").trim().split("\n")[0]);
    if (!(count > 100)) throw new Error(`expected many applets, got ${count}`);
    write(inW, "sleep 30\n");
    kernel.pump(50);
    eq(kernel.emacsKill(-pid, C.SIGINT), 0, "C-c C-c (SIGINT to the process group)");
    until("$ ");
    write(inW, "echo still alive\n");
    has(until("$ "), "still alive\n");
    write(inW, "exit 3\n");
    readAll(outR);
    const w = waitpid(pid);
    eq(w.exited && w.code, 3, "exit status");
    close(inW); close(outR);
    noLeak();
  });

  test("userland layout: marker files, /usr/bin/env, /etc", () => {
    eq(FS.readFile("/bin/ls", { encoding: "utf8" }), "\x7fwasmacs-exec busybox\n", "/bin/ls");
    eq(FS.stat("/bin/sh").mode & 0o777, 0o755, "/bin/sh mode");
    FS.writeFile("/work/envscript", "#!/usr/bin/env sh\necho via-env $0\n");
    FS.chmod("/work/envscript", 0o755);
    eq(sh("./envscript").out, "via-env ./envscript\n", "#!/usr/bin/env sh");
    has(sh("whoami; id -u").out, "root\n0\n");
  });

  test("pipes: many small writes stay cheap, data survives the ring buffer wrapping", () => {
    // Emscripten's stdout is line buffered even into a pipe, so "yes" issues
    // two tiny writes per line: 400000 writes for these 2 MB.
    const t0 = performance.now();
    let r = sh("yes abcdefghi | head -c 2000000 | wc -c");
    eq(r.out, "2000000\n", "byte count");
    const ms = performance.now() - t0;
    if (ms > 5000) throw new Error(`2 MB of small writes took ${Math.round(ms)}ms`);
    r = sh("seq 1 60000 > n.txt; cat n.txt | cat | cat | cmp - n.txt && echo same; seq 1 60000 | tail -1");
    eq(r.out, "same\n60000\n", "content after many wrap-arounds");
    noLeak();
  });
} else {
  console.log("SKIP userland tests (run src/userland/build.sh)");
}

if (haveBusybox && haveGit) {
  // Dead processes must be garbage: nothing of theirs may stay registered in
  // the shared FS or in the kernel.  (git used to leave a SOCKFS mount per
  // process, which kept the instance and its 16 MB memory alive; a browser
  // tab ran out of memory after about a hundred git commands.)
  test("processes leave nothing behind (shared FS, JS heap)", () => {
    const loop = (n) => sh(`i=0; n=0; while [ $i -lt ${n} ]; do git --version > /dev/null && n=$((n + 1)); i=$((i + 1)); done; echo ok-$n`);
    eq(loop(20).out, "ok-20\n", "warm-up");
    const nodes = fsNodeCount();
    const heap = heapUsedAfterGc();
    eq(loop(300).out, "ok-300\n", "300 x (fork + exec of git)");
    eq(fsNodeCount(), nodes, "nodes in the shared FS");
    const growth = heapUsedAfterGc() - heap;
    console.log(`   heap growth after 600 process images: ${(growth / 1024).toFixed(0)} KiB`);
    if (growth > 8 * 1024 * 1024) throw new Error(`dead processes are still reachable: heap grew by ${(growth / 1e6).toFixed(1)} MB`);
    noLeak();
  });
}

if (haveBusybox && haveGrep) {
  test("GNU grep: the options Emacs uses (--null, --color, --exclude, -r, exit status)", () => {
    FS.mkdirTree("/work/g/sub");
    FS.writeFile("/work/g/a.txt", "alpha\nbeta gamma\nBETA\n");
    FS.writeFile("/work/g/sub/b.el", "(defun beta-fn () 1)\n");
    FS.writeFile("/work/g/sub/c.o", "beta\0binary\n");
    let r = sh("grep --version | head -1");
    has(r.out, "(GNU grep)");
    r = sh("cd g && grep -nH --null -e beta a.txt | tr '\\000' '@'");
    eq(r.out, "a.txt@2:beta gamma\n", "--null");
    r = sh("cd g && grep -rn --exclude='*.o' beta . | sort");
    eq(r.out, "./a.txt:2:beta gamma\n./sub/b.el:1:(defun beta-fn () 1)\n", "-r --exclude");
    r = sh("cd g && grep -n beta sub/c.o");
    eq(r.out, "grep: sub/c.o: binary file matches\n", "binary file: a message instead of the line");
    r = sh("cd g && grep --color=always -i beta a.txt | head -1");
    has(r.out, "\x1b[01;31m\x1b[Kbeta\x1b[m\x1b[K");
    r = sh("cd g && grep --directories=skip -c alpha a.txt sub; grep -q beta a.txt; echo $?; grep -q nope a.txt; echo $?; grep -s x missing; echo $?");
    eq(r.out, "a.txt:1\n0\n1\n2\n", "exit status");
    noLeak();
  });

  test("grep in pipelines, egrep and fgrep, find -exec grep, xargs -0 grep", () => {
    let r = sh("printf 'one\\ntwo\\nthree\\n' | grep -c t; echo 'a.b' | fgrep a.b; echo abc | egrep 'a(b|x)c'");
    eq(r.out, "2\na.b\nabc\n", "pipelines");
    r = sh("cd g && find . -type f -exec grep -nH -e alpha \\{\\} + | sort");
    eq(r.out, "./a.txt:1:alpha\n", "find -exec ... +");
    r = sh("cd g && find . -type f -print0 | xargs -0 grep -l beta | sort");
    eq(r.out, "./a.txt\n./sub/b.el\n./sub/c.o\n", "xargs -0");
    // grep -m stops reading: the writer upstream gets SIGPIPE.
    r = sh("yes abcdefghi | grep -m 3 -n abc; echo rc=$?");
    eq(r.out, "1:abcdefghi\n2:abcdefghi\n3:abcdefghi\nrc=0\n", "-m");
    let expected = 0;
    for (let i = 1; i <= 200000; i++) if (String(i).includes("7")) expected += 1;
    r = sh("seq 1 200000 | grep -c 7");
    eq(r.out, `${expected}\n`, "count over a large stream");
    noLeak();
  });
} else {
  console.log("SKIP grep tests (run src/userland/build.sh)");
}

if (haveBusybox && haveGit) {
  const git = (script) => sh(`cd /home/user/repo && ${script}`);

  test("git: init, add, commit, log, status", () => {
    const r = sh('rm -rf /home/user/repo && mkdir -p /home/user/repo && cd /home/user/repo && git init -q && ' +
                 'echo "hello" > a.txt && mkdir d && echo "x" > d/b.txt && git add . && ' +
                 'git commit -q -m "first commit" && git log --format="%an <%ae> %s" && git status --porcelain && ' +
                 'git rev-parse --abbrev-ref HEAD && git ls-files');
    eq(r.out, "wasmacs user <user@wasmacs.invalid> first commit\nmain\na.txt\nd/b.txt\n", "output");
    eq(r.code, 0, "exit status");
    noLeak();
  });

  test("git: diff, branch, merge, stash, tag, blame", () => {
    let r = git('echo "more" >> a.txt && git diff --stat && git status --porcelain');
    has(r.out, " a.txt | 1 +\n");
    has(r.out, " M a.txt\n");
    r = git('git checkout -q -b topic && git commit -q -am "topic change" && git checkout -q main && ' +
            'echo "main side" > c.txt && git add c.txt && git commit -q -m "main change" && ' +
            'git merge -q --no-edit topic && git log --oneline | wc -l && git log --merges --format=%s');
    has(r.out, "4\n");
    has(r.out, "Merge branch \'topic\'");
    eq(r.code, 0, `merge (${JSON.stringify(r.out)})`);
    r = git('echo dirty >> c.txt && git stash -q && git status --porcelain | wc -l && git stash pop -q && git status --porcelain && ' +
            'git tag v1 && git tag && git blame -s a.txt | wc -l && git grep -n main -- c.txt');
    has(r.out, "0\n M c.txt\nv1\n2\nc.txt:1:main side\n");
    eq(r.code, 0, `exit status (${JSON.stringify(r.out)})`);
    noLeak();
  });

  test("git: clone of a local repository, fsck, gc", () => {
    const r = sh('cd /home/user && rm -rf clone && git clone -q repo clone && cd clone && git log --oneline | wc -l && ' +
                 'git fsck --no-progress && git gc -q && git count-objects -v | grep -c "^in-pack: [1-9]"');
    has(r.out, "4\n");
    has(r.out, "\n1\n");
    eq(r.code, 0, `exit status (${JSON.stringify(r.out)})`);
    noLeak();
  });

  test("git: commit runs hooks (fork + exec of a shell script)", () => {
    FS.mkdirTree("/home/user/repo/.git/hooks");
    FS.writeFile("/home/user/repo/.git/hooks/pre-commit", "#!/bin/sh\necho hook-ran > /home/user/hook.txt\n");
    FS.chmod("/home/user/repo/.git/hooks/pre-commit", 0o755);
    const r = git('echo h >> a.txt && git commit -q -am "with hook" && cat /home/user/hook.txt');
    eq(r.out, "hook-ran\n", "hook output");
    FS.unlink("/home/user/repo/.git/hooks/pre-commit");
    noLeak();
  });
} else {
  console.log("SKIP git tests (run src/userland/build.sh)");
}

console.log(`\n${ran - failures}/${ran} kernel tests passed`);
process.exitCode = failures ? 1 : 0;
