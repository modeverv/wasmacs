import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const layoutSource = read("src/runtime/process/wasmacs-userland.js");
const workerSource = read("src/wasm/src/emacs-atomics-pdump-worker.js");
const loaderStart = workerSource.indexOf("function installProgramLoader(");
assert.notEqual(loaderStart, -1);
const loaderSource = workerSource.slice(loaderStart, workerSource.indexOf("\n}\n", loaderStart) + 3);
const archive = Uint8Array.of(0x50, 0x4b, 0, 0xff);
const manifest = {
  programs: {
    python: {
      applets: ["python3", "python"],
      directories: ["/usr/lib/python3.14/lib-dynload"],
      files: [{ source: "python314.zip", path: "/usr/lib/python314.zip", bytes: archive.length }],
    },
    grep: { applets: ["grep"] },
  },
};

function memoryFS() {
  const files = new Map();
  const directories = new Set(["/"]);
  const operations = [];
  const FS = {
    mkdir(path) {
      if (directories.has(path)) throw new Error("exists");
      directories.add(path);
      operations.push(["mkdir", path]);
    },
    writeFile(path, value) {
      files.set(path, { bytes: typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value) });
      operations.push(["write", path]);
    },
    chmod(path, mode) { files.get(path).mode = mode; operations.push(["chmod", path, mode]); },
    lookupPath(path) {
      if (path === "/dev/zero") return {};
      throw new Error("not found");
    },
  };
  return { FS, files, directories, operations };
}

function runtime(extras = {}) {
  const forbidden = () => { throw new Error("program loading must stay synchronous"); };
  const context = vm.createContext({ Uint8Array, ArrayBuffer,
    Promise: forbidden, fetch: forbidden, setTimeout: forbidden, setInterval: forbidden,
    queueMicrotask: forbidden, ...extras });
  context.self = context;
  vm.runInContext(layoutSource, context);
  return context;
}

test("userland setup installs Python commands without loading standard library data", () => {
  const { FS, files, directories } = memoryFS();
  const layout = runtime().WasmacsUserland;
  assert.equal(layout.install(FS, manifest), 3);
  for (const command of ["python", "python3"]) {
    assert.equal(new TextDecoder().decode(files.get(`/bin/${command}`).bytes), "\x7fwasmacs-exec python\n");
    assert.equal(files.get(`/bin/${command}`).mode, 0o755);
  }
  assert.equal(files.has("/usr/lib/python314.zip"), false);
  assert.equal(directories.has("/usr/lib/python3.14/lib-dynload"), false);
});

test("program data installs exact binary bytes into the shared filesystem", () => {
  const { FS, files, directories } = memoryFS();
  const originalKeys = Reflect.ownKeys(FS);
  const reads = [];
  runtime().WasmacsUserland.installProgramFiles(FS, manifest, "python", (source) => {
    reads.push(source);
    return archive;
  });
  assert.deepEqual(reads, ["python314.zip"]);
  assert.deepEqual(files.get("/usr/lib/python314.zip"), { bytes: archive, mode: 0o444 });
  assert.equal(directories.has("/usr/lib/python3.14/lib-dynload"), true);
  assert.deepEqual(Reflect.ownKeys(FS), originalKeys, "installer must not register process callbacks on shared FS");
});

test("failed data reads and asynchronous results leave the filesystem untouched", () => {
  const layout = runtime().WasmacsUserland;
  const twoFiles = structuredClone(manifest);
  twoFiles.programs.python.files.push({ source: "other.zip", path: "/usr/lib/other.zip" });
  const { FS, operations } = memoryFS();
  assert.throws(() => layout.installProgramFiles(FS, twoFiles, "python", (source) => {
    if (source === "other.zip") throw new Error("download failed");
    return archive;
  }), /download failed/);
  assert.deepEqual(operations, [], "all downloads must finish before any directory or file is written");
  for (const invalid of [Promise.resolve(archive), { then: () => assert.fail("must not await data") }, archive.buffer, "PK"]) {
    assert.throws(() => layout.installProgramFiles(FS, manifest, "python", () => invalid), /synchronous bytes/);
    assert.deepEqual(operations, []);
  }
  for (const truncated of [archive.subarray(0, 2), new Uint8Array(archive.length + 1)]) {
    assert.throws(() => layout.installProgramFiles(FS, manifest, "python", () => truncated), /program data size mismatch: python314.zip/);
    assert.deepEqual(operations, []);
  }
});

test("invalid program file paths are rejected before reads or filesystem writes", () => {
  const layout = runtime().WasmacsUserland;
  for (const [source, path] of [
    ["../stdlib.zip", "/usr/lib/python314.zip"],
    ["https://other.invalid/stdlib.zip", "/usr/lib/python314.zip"],
    ["..", "/usr/lib/python314.zip"],
    ["python314.zip", "relative.zip"],
    ["python314.zip", "/usr/../home/user/data"],
  ]) {
    const { FS, operations } = memoryFS();
    const invalid = { programs: { python: { files: [{ source, path }] } } };
    assert.throws(() => layout.installProgramFiles(FS, invalid, "python", () => assert.fail("invalid path fetched")), /invalid program data path/);
    assert.deepEqual(operations, []);
  }
});

function browserLoader() {
  const fs = memoryFS();
  const requests = [];
  const imports = [];
  const responses = new Map([
    ["python.wasm", { status: 200, bytes: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0) }],
    ["grep.wasm", { status: 200, bytes: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0) }],
    ["python314.zip", { status: 200, bytes: archive }],
  ]);
  let context;
  context = runtime({ WebAssembly, USERLAND_DIR: "/assets/userland", ARTIFACT_CACHE_BUST: "release-1",
    post: () => {},
    XMLHttpRequest: class {
      open(method, url, asynchronous) {
        assert.equal(method, "GET");
        assert.equal(asynchronous, false, "the blocked worker cannot await network callbacks");
        assert.match(url, /\?v=release-1$/);
        this.source = url.split("/").at(-1).split("?")[0];
      }
      send() {
        assert.equal(this.responseType, "arraybuffer");
        requests.push(this.source);
        const response = responses.get(this.source);
        this.status = response?.status ?? 404;
        this.response = response?.bytes.buffer;
      }
    },
    importScripts(url) {
      imports.push(url);
      const name = url.split("/").at(-1).split(".")[0];
      context[`wasmacsProgram_${name}`] = () => assert.fail("loading an image must not instantiate a process");
    },
  });
  vm.runInContext(loaderSource, context);
  context.installProgramLoader(fs.FS, manifest);
  return { ...fs, requests, imports, responses, load: context.__wasmacsLoadProgram };
}

test("browser loader defers standard library download and caches it with the image", () => {
  const { load, requests, imports, files } = browserLoader();
  assert.deepEqual(requests, []);
  load("grep");
  assert.deepEqual(requests, ["grep.wasm"]);
  assert.equal(files.has("/usr/lib/python314.zip"), false);
  const first = load("python");
  const installedFile = files.get("/usr/lib/python314.zip");
  assert.deepEqual(installedFile.bytes, archive);
  for (let i = 0; i < 20; i++) assert.equal(load("python"), first);
  assert.equal(files.get("/usr/lib/python314.zip"), installedFile);
  assert.deepEqual(requests, ["grep.wasm", "python.wasm", "python314.zip"]);
  assert.equal(imports.length, 2);
});

test("browser loader does not cache an image whose standard library failed to load", () => {
  const { load, responses, requests, operations, files } = browserLoader();
  responses.get("python314.zip").status = 503;
  assert.throws(() => load("python"), /python314.zip: HTTP 503/);
  assert.deepEqual(operations, []);
  responses.get("python314.zip").status = 200;
  const image = load("python");
  assert.equal(load("python"), image);
  assert.deepEqual(files.get("/usr/lib/python314.zip").bytes, archive);
  assert.deepEqual(requests, ["python.wasm", "python314.zip", "python.wasm", "python314.zip"]);
});
