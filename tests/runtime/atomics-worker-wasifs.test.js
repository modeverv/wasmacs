import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

const repoRoot = new URL("../..", import.meta.url).pathname;

async function loadWorkerContext(relativePath) {
  const source = await readFile(join(repoRoot, relativePath), "utf8");
  const context = {
    console,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    SharedArrayBuffer,
    ArrayBuffer,
    Map,
    Set,
    self: { postMessage() {} },
    postMessage() {},
    atob(text) {
      return Buffer.from(text, "base64").toString("binary");
    },
    btoa(text) {
      return Buffer.from(text, "binary").toString("base64");
    },
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: relativePath });
  return context;
}

function createFakeMemfs() {
  const nodes = new Map([["/", { kind: "directory" }]]);
  const parentOf = (path) => {
    const slash = path.lastIndexOf("/");
    return slash <= 0 ? "/" : path.slice(0, slash);
  };
  const assertParent = (path) => {
    const parent = parentOf(path);
    if (nodes.get(parent)?.kind !== "directory") {
      throw new Error(`parent is not a directory: ${parent}`);
    }
  };

  return {
    nodes,
    mkdir(path) {
      assertParent(path);
      if (nodes.has(path)) throw new Error(`exists: ${path}`);
      nodes.set(path, { kind: "directory" });
    },
    unlink(path) {
      const node = nodes.get(path);
      if (!node || node.kind !== "file") throw new Error(`not a file: ${path}`);
      nodes.delete(path);
    },
    rmdir(path) {
      const node = nodes.get(path);
      if (!node || node.kind !== "directory") throw new Error(`not a directory: ${path}`);
      for (const child of nodes.keys()) {
        if (child.startsWith(`${path}/`)) throw new Error(`directory not empty: ${path}`);
      }
      nodes.delete(path);
    },
    createDataFile(parent, name, data) {
      if (nodes.get(parent)?.kind !== "directory") {
        throw new Error(`parent is not a directory: ${parent}`);
      }
      const path = parent === "/" ? `/${name}` : `${parent}/${name}`;
      if (nodes.has(path)) throw new Error(`exists: ${path}`);
      nodes.set(path, { kind: "file", data: new Uint8Array(data) });
    },
  };
}

for (const workerPath of [
  "src/wasm/src/emacs-atomics-worker.js",
  "src/wasm/src/emacs-atomics-pdump-worker.js",
]) {
  test(`${workerPath} imports file entries as files, not directories`, async () => {
    const context = await loadWorkerContext(workerPath);
    const tarBytes = context.createUserTar(new Map([
      ["/home/user", { isDir: true, data: null }],
      ["/home/user/h.org", { isDir: false, data: new TextEncoder().encode("* h\n") }],
    ]));
    const parsed = context.parseUserTar(tarBytes);
    const fs = createFakeMemfs();

    context.mountUserImage(fs, parsed);

    assert.equal(fs.nodes.get("/home/user/h.org")?.kind, "file");
    assert.equal(new TextDecoder().decode(fs.nodes.get("/home/user/h.org").data), "* h\n");
  });
}

// ---- product worker: what a git working tree needs from the user image ----------

const productWorker = "src/wasm/src/emacs-atomics-pdump-worker.js";

// A little in-memory tree with the FS calls the snapshot code uses.
function createStatFs(files) {
  const dirs = new Set(["/home/user"]);
  for (const path of Object.keys(files)) {
    for (let slash = path.indexOf("/", 1); slash !== -1; slash = path.indexOf("/", slash + 1)) dirs.add(path.slice(0, slash));
  }
  return {
    files,
    readdir(dir) {
      const names = new Set([".", ".."]);
      for (const path of [...dirs, ...Object.keys(files)]) {
        if (path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes("/")) names.add(path.slice(dir.length + 1));
      }
      return [...names];
    },
    stat(path) {
      if (dirs.has(path)) return { mode: 0o40755, size: 0, mtime: new Date(0) };
      const file = files[path];
      if (!file) throw new Error(`ENOENT ${path}`);
      return { mode: 0o100000 | file.mode, size: file.data.length, mtime: new Date(file.mtime) };
    },
    isDir(mode) { return (mode & 0o170000) === 0o40000; },
    readFile(path) { return files[path].data; },
  };
}

test("user image keeps file modes and modification times", async () => {
  const context = await loadWorkerContext(productWorker);
  const fs = createStatFs({
    "/home/user/repo/run.sh": { data: new TextEncoder().encode("#!/bin/sh\n"), mode: 0o755, mtime: 1_700_000_123_456 },
    "/home/user/repo/notes.org": { data: new TextEncoder().encode("* n\n"), mode: 0o644, mtime: 1_700_000_999_000 },
  });
  const parsed = context.parseUserTar(context.exportUserImage(fs));
  assert.equal(parsed.get("/home/user/repo/run.sh").mode, 0o755);
  assert.equal(parsed.get("/home/user/repo/run.sh").mtime, 1_700_000_123);
  assert.equal(parsed.get("/home/user/repo/notes.org").mode, 0o644);

  const target = createFakeMemfs();
  const applied = [];
  target.chmod = (path, mode) => applied.push(["chmod", path, mode]);
  target.utime = (path, atime, mtime) => applied.push(["utime", path, mtime]);
  context.mountUserImage(target, parsed);
  assert.deepEqual(applied.filter(([, path]) => path.endsWith("run.sh")), [
    ["chmod", "/home/user/repo/run.sh", 0o755],
    ["utime", "/home/user/repo/run.sh", 1_700_000_123_000],
  ]);
});

test("user image stores paths longer than 100 bytes and never truncates one", async () => {
  const context = await loadWorkerContext(productWorker);
  const deep = `/home/user/project/${"deeply-nested-directory/".repeat(5)}a-file-with-a-rather-long-name.txt`;
  const tooLong = `/home/user/${"x".repeat(120)}/${"y".repeat(140)}.txt`;
  assert.ok(deep.length > 100 && deep.length < 255);
  const stderr = [];
  context.self.postMessage = (message) => { if (message.type === "stderr") stderr.push(message.text); };
  const data = new TextEncoder().encode("content\n");
  const parsed = context.parseUserTar(context.createUserTar(new Map([
    ["/home/user", { isDir: true, data: null }],
    [deep, { isDir: false, data }],
    [tooLong, { isDir: false, data }],
    ["/home/user/short.txt", { isDir: false, data }],
  ])));
  assert.equal(new TextDecoder().decode(parsed.get(deep).data), "content\n");
  assert.ok(parsed.has("/home/user/short.txt"));
  // Left out (and reported) rather than stored under a cut-off name.
  assert.deepEqual([...parsed.keys()].filter((path) => path.includes("xxx")), []);
  assert.equal(stderr.length, 1);
  assert.match(stderr[0], /too long to be saved/);
});

test("user image is saved again only when the tree changed", async () => {
  const context = await loadWorkerContext(productWorker);
  const files = {
    "/home/user/a.txt": { data: new TextEncoder().encode("one\n"), mode: 0o644, mtime: 1_700_000_000_000 },
  };
  const fs = createStatFs(files);
  const snapshots = [];
  context.self.postMessage = (message) => { if (message.type === "wasifs-snapshot") snapshots.push(message); };

  context.postUserImageSnapshot(fs, "before-wait");
  context.postUserImageSnapshot(fs, "before-wait");
  context.postUserImageSnapshot(fs, "before-wait");
  assert.equal(snapshots.length, 1, "an idle Emacs does not rewrite the image");

  files["/home/user/a.txt"] = { data: new TextEncoder().encode("two\n"), mode: 0o644, mtime: 1_700_000_005_000 };
  context.postUserImageSnapshot(fs, "before-wait");
  assert.equal(snapshots.length, 2, "a rewritten file (same size, new time)");

  files["/home/user/a.txt"].mode = 0o755;
  context.postUserImageSnapshot(fs, "before-wait");
  assert.equal(snapshots.length, 3, "chmod");

  files["/home/user/b.txt"] = { data: new Uint8Array(0), mode: 0o644, mtime: 1_700_000_006_000 };
  context.postUserImageSnapshot(fs, "before-wait");
  delete files["/home/user/b.txt"];
  context.postUserImageSnapshot(fs, "before-wait");
  assert.equal(snapshots.length, 5, "a new file, a deleted file");
});
