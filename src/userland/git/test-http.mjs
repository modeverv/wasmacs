// Real wasm Git + upstream remote-curl against native git-http-backend.
// The HTTP host seam is injected; browser/extension behavior is tested separately.
// Run after building userland and tests/process/build-test-programs.sh:
//   node src/userland/git/test-http.mjs
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const images = join(root, 'build/artifacts/userland');
const require = createRequire(join(images, 'package.json'));
const dir = mkdtempSync(join(tmpdir(), 'wasmacs-git-adapter-'));
const serverEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
 GIT_AUTHOR_NAME: 'HTTP test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
 GIT_COMMITTER_NAME: 'HTTP test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
const native = (cwd, ...args) => execFileSync('git', args, { cwd, env: serverEnv,
 encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const origin = 'https://git.example.invalid/test.git';
const auth = `Basic ${Buffer.from('test:disposable').toString('base64')}`;
let requests = 0, suspended = 0;
try {
 const seed = join(dir, 'seed'), bare = join(dir, 'test.git');
 native(dir, 'init', '-q', '-b', 'main', seed);
 writeFileSync(join(seed, 'hello.txt'), 'initial\n');
 const binary = Buffer.from(Array.from({ length: 4096 }, (_, i) => i & 255));
 writeFileSync(join(seed, 'binary.bin'), binary);
 native(seed, 'add', '.'); native(seed, 'commit', '-qm', 'initial');
 native(dir, 'clone', '-q', '--bare', seed, bare);
 native(bare, 'config', 'http.receivepack', 'true');
 native(seed, 'remote', 'add', 'origin', bare);

 for (const file of ['wasmacs-kernel.js', 'wasmacs-userland.js'])
  vm.runInThisContext(readFileSync(join(root, 'src/runtime/process', file), 'utf8'), { filename: file });
 const host = await require(join(root, 'build/process-tests/fshost.js'))();
 host.callMain?.([]);
 const FS = host.FS, scratch = host._malloc(256);
 const sleep = new Int32Array(new SharedArrayBuffer(4));
 const kernel = globalThis.WasmacsKernel.create({
  FS,
  views: () => ({ HEAPU8: host.HEAPU8, HEAP32: host.HEAP32, HEAP16: host.HEAP16 }),
  now: () => performance.now(),
  log: msg => console.error(msg),
  loadProgram: name => ({ factory: require(join(images, `${name}.js`)),
                         wasm: readFileSync(join(images, `${name}.wasm`)) }),
  raiseSignal: sig => host._fshost_raise(sig), requestQuit() {}, drainKeyboard() {},
  keyboardPending: () => false, takeQuitChar: () => false, flushTerminalOutput() {},
  waitForInput: ms => Atomics.wait(sleep, 0, 0, Math.max(0, Math.min(ms, 100))),
  startNetworkFetch(request) {
   requests++;
   const url = new URL(request.url);
   assert.equal(url.username, ''); assert.equal(url.password, '');
   assert.equal(url.origin, 'https://git.example.invalid');
   const headers = Object.fromEntries(request.headers.map(([k, v]) => [k.toLowerCase(), v]));
   let response;
   if (headers.authorization !== auth) {
    response = { status: 401, headers: [['www-authenticate', 'Basic realm="test"']], bodyBase64: '', url: request.url };
   } else {
    const body = Buffer.from(request.bodyBase64, 'base64');
    const raw = execFileSync('git', ['http-backend'], { env: {
     ...serverEnv, GIT_PROJECT_ROOT: dir, GIT_HTTP_EXPORT_ALL: '1',
     PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1),
     REQUEST_METHOD: request.method, CONTENT_TYPE: headers['content-type'] || '',
     CONTENT_LENGTH: String(body.length), HTTP_CONTENT_ENCODING: headers['content-encoding'] || '',
     HTTP_GIT_PROTOCOL: headers['git-protocol'] || '', REMOTE_USER: 'test', REMOTE_ADDR: '127.0.0.1',
    }, input: body, maxBuffer: 32 * 1024 * 1024 });
    const split = raw.indexOf('\r\n\r\n'); assert.ok(split >= 0);
    const pairs = raw.subarray(0, split).toString().split('\r\n').map(line => {
     const pos = line.indexOf(':'); return [line.slice(0, pos).toLowerCase(), line.slice(pos + 1).trim()];
    });
    response = { status: Number(pairs.find(([k]) => k === 'status')?.[1].slice(0, 3) || '200'),
     headers: pairs.filter(([k]) => k !== 'status'), bodyBase64: raw.subarray(split + 4).toString('base64'), url: request.url };
   }
   let polls = 0;
   return { poll() { if (!polls++) { suspended++; return null; } return response; }, cancel() {} };
  },
 });
 const manifest = JSON.parse(readFileSync(join(images, 'manifest.json'), 'utf8'));
 globalThis.WasmacsUserland.install(FS, manifest);
 FS.mkdirTree('/work'); FS.mkdirTree('/home/user');
 FS.writeFile('/home/user/.gitconfig', `[http "${origin}"]\n extraHeader = Authorization: ${auth}\n`);
 const nullFd = FS.open('/dev/null', 'r').fd;
 const run = (args, { failure = false } = {}) => {
  assert.equal(kernel.emacsPipe2(scratch, 0), 0);
  const r = host.HEAP32[scratch >> 2], w = host.HEAP32[(scratch + 4) >> 2];
  const pid = kernel.emacsSpawn(['/bin/git', ...args], ['PATH=/bin', 'HOME=/home/user',
   'GIT_TERMINAL_PROMPT=0'], '/work', [nullFd, w, w]);
  FS.close(FS.getStream(w)); assert.ok(pid > 0);
  const chunks = [], buf = new Uint8Array(65536);
  for (;;) {
   const n = FS.read(FS.getStream(r), buf, 0, buf.length);
   if (!n) break;
   chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  FS.close(FS.getStream(r));
  assert.equal(kernel.emacsWaitpid(pid, scratch, 0), pid);
  const output = Buffer.concat(chunks).toString();
  if (failure) assert.notEqual(host.HEAP32[scratch >> 2], 0, 'command unexpectedly succeeded');
  else assert.equal(host.HEAP32[scratch >> 2], 0, `${args.join(' ')}\n${output}`);
  assert.equal(kernel.liveCount(), 0); assert.equal(kernel.httpRequests.size, 0);
  return output;
 };
 run(['clone', origin, '/work/v2']);
 assert.deepEqual(Buffer.from(FS.readFile('/work/v2/binary.bin')), binary);
 run(['-c', 'protocol.version=0', 'clone', origin, '/work/v0']);
 writeFileSync(join(seed, 'hello.txt'), 'updated remotely\n');
 native(seed, 'add', '.'); native(seed, 'commit', '-qm', 'remote update'); native(seed, 'push', '-q', 'origin', 'main');
 const serverCommit = native(bare, 'rev-parse', 'main');
 run(['-C', '/work/v2', 'fetch', 'origin']);
 assert.equal(run(['-C', '/work/v2', 'rev-parse', 'origin/main']).trim(), serverCommit);
 run(['-C', '/work/v2', 'merge', '--ff-only', 'origin/main']);
 FS.writeFile('/work/v2/from-wasm.txt', 'pushed by wasm Git\n');
 run(['-C', '/work/v2', 'add', '.']); run(['-C', '/work/v2', 'commit', '-qm', 'wasm push']);
 run(['-C', '/work/v2', 'push', 'origin', 'main']);
 assert.equal(native(bare, 'show', 'main:from-wasm.txt'), 'pushed by wasm Git');
 assert.equal(native(bare, 'rev-parse', 'main'), run(['-C', '/work/v2', 'rev-parse', 'HEAD']).trim());
 // Incompressible >1 MiB data takes upstream rpc_out's streaming-upload
 // branch, including its authentication probe and repeated pipe reads.
 const large = randomBytes(2 * 1024 * 1024);
 FS.writeFile('/work/v2/large.bin', large);
 run(['-C', '/work/v2', 'add', '.']); run(['-C', '/work/v2', 'commit', '-qm', 'large binary']);
 run(['-C', '/work/v2', 'push', 'origin', 'main']);
 const serverLarge = execFileSync('git', ['show', 'main:large.bin'], { cwd: bare, env: serverEnv, maxBuffer: 4 * 1024 * 1024 });
 assert.deepEqual(serverLarge, large);
 for (let i = 0; i < 5; i++) run(['-C', '/work/v2', 'fetch', 'origin']);
 FS.writeFile('/home/user/.gitconfig', '');
 run(['clone', 'https://test:disposable@git.example.invalid/test.git', '/work/url-auth']);
 const denied = run(['ls-remote', origin], { failure: true });
 assert.match(denied, /terminal prompts disabled|Authentication failed/);
 assert.equal(requests, suspended);
 console.log(`PASS: wasm Git v0/v2 clone, binary readback, fetch, small/large push verified at server, URL auth and auth failure; ${requests} HTTP requests suspended/resumed, no remaining processes or HTTP handles`);
} finally { rmSync(dir, { recursive: true, force: true }); }
