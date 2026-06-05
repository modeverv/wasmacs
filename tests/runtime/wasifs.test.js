import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { WasifsHostFileSystem } from "../../src/runtime/fs/wasifs.js";
import { CoreHost } from "../../src/runtime/host/core-host.js";

const repoRoot = new URL("../..", import.meta.url).pathname;

test("mounts system image read-only and exposes lisp files", async () => {
  const fs = await WasifsHostFileSystem.fromImages({
    systemImagePath: join(repoRoot, "build/artifacts/system-lisp-emacs-30.2.wasifs"),
    userImagePath: join(repoRoot, "build/artifacts/user-filesystem-empty.wasifs"),
  });

  assert.equal(fs.stat("/system").kind, "directory");
  assert.equal(fs.stat("/system/lisp/loaddefs.el").kind, "file");
  assert.ok(fs.readFile("/system/lisp/loaddefs.el").length > 0);
  assert.throws(() => fs.writeFile("/system/lisp/new.el", "nope"), /read-only filesystem/);
});

test("supports writable user files and directory operations", async () => {
  const fs = await WasifsHostFileSystem.fromImages({
    userImagePath: join(repoRoot, "build/artifacts/user-filesystem-empty.wasifs"),
  });

  fs.mkdir("/home/user/projects/demo");
  fs.writeFile("/home/user/projects/demo/notes.txt", "hello wasmacs");

  assert.equal(fs.stat("/home/user/projects/demo/notes.txt").size, 13);
  assert.equal(fs.readFile("/home/user/projects/demo/notes.txt").toString("utf8"), "hello wasmacs");
  assert.deepEqual(fs.readdir("/home/user/projects/demo"), [
    { name: "notes.txt", kind: "file" },
  ]);

  fs.rename("/home/user/projects/demo/notes.txt", "/home/user/projects/demo/renamed.txt");
  assert.equal(fs.readFile("/home/user/projects/demo/renamed.txt").toString("utf8"), "hello wasmacs");

  fs.unlink("/home/user/projects/demo/renamed.txt");
  assert.deepEqual(fs.readdir("/home/user/projects/demo"), []);
  assert.equal(fs.sync(), true);
});

test("exports and imports user image roundtrip", async () => {
  const fs = await WasifsHostFileSystem.fromImages({
    userImagePath: join(repoRoot, "build/artifacts/user-filesystem-empty.wasifs"),
  });
  fs.writeFile("/home/user/projects/roundtrip.txt", "kept");

  const exported = fs.exportUserImage();
  const dir = await mkdtemp(join(tmpdir(), "wasmacs-"));
  const imagePath = join(dir, "user.wasifs");
  await writeFile(imagePath, exported);

  const imported = await WasifsHostFileSystem.fromImages({ userImagePath: imagePath });
  assert.equal(imported.readFile("/home/user/projects/roundtrip.txt").toString("utf8"), "kept");
  assert.ok((await readFile(imagePath)).length > 1024);
  await rm(dir, { recursive: true, force: true });
});

test("provides non-GUI host shims", async () => {
  const fs = await WasifsHostFileSystem.fromImages({
    userImagePath: join(repoRoot, "build/artifacts/user-filesystem-empty.wasifs"),
  });
  const host = new CoreHost({ fs, env: { HOME: "/home/user" } });

  assert.equal(host.getenv("HOME"), "/home/user");
  assert.equal(host.cwd(), "/home/user");
  assert.equal(host.randomBytes(8).length, 8);
  assert.match(host.processUnavailable(), /unavailable/);

  host.stdout("out");
  host.stderr("err");
  host.debugLog("info", "ready");

  assert.equal(Buffer.concat(host.stdoutChunks).toString("utf8"), "out");
  assert.equal(Buffer.concat(host.stderrChunks).toString("utf8"), "err");
  assert.deepEqual(host.debugLogs, [{ level: "info", message: "ready" }]);
});
