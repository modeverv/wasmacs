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
