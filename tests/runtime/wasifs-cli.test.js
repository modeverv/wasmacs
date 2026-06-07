import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import { createTar } from "../../src/runtime/fs/tar.js";

const execFileAsync = promisify(execFile);
const repoRoot = new URL("../..", import.meta.url).pathname;
const wasifsCli = join(repoRoot, "tools/scripts/wasifs.mjs");

async function runWasifs(args) {
  return execFileAsync(process.execPath, [wasifsCli, ...args], {
    cwd: repoRoot,
  });
}

test("wasifs CLI packs, lists, and unpacks a user image tree", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wasmacs-wasifs-cli-"));
  const source = join(dir, "source");
  const image = join(dir, "user-filesystem.wasifs");
  const unpacked = join(dir, "unpacked");

  await mkdir(join(source, ".emacs.d", "lisp"), { recursive: true });
  await mkdir(join(source, "projects", "demo"), { recursive: true });
  await writeFile(join(source, "init.el"), "(message \"hello\")\n");
  await writeFile(join(source, "projects", "demo", "notes.txt"), "kept\n");

  const pack = await runWasifs(["pack", source, image, "--root", "home/user"]);
  assert.match(pack.stdout, /packed .*user-filesystem\.wasifs/);
  assert.ok(existsSync(image));

  const list = await runWasifs(["list", image]);
  assert.match(list.stdout, /^home\/user\/init\.el$/m);
  assert.match(list.stdout, /^home\/user\/projects\/demo\/notes\.txt$/m);

  const unpack = await runWasifs(["unpack", image, unpacked]);
  assert.match(unpack.stdout, /unpacked .*user-filesystem\.wasifs/);
  assert.equal(
    await readFile(join(unpacked, "home/user/projects/demo/notes.txt"), "utf8"),
    "kept\n",
  );

  await rm(dir, { recursive: true, force: true });
});

test("wasifs CLI refuses unsafe pack roots", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wasmacs-wasifs-cli-"));
  const source = join(dir, "source");
  await mkdir(source, { recursive: true });

  await assert.rejects(
    runWasifs(["pack", source, join(dir, "bad.wasifs"), "--root", "../escape"]),
    /root must be a relative tar path/,
  );

  await rm(dir, { recursive: true, force: true });
});

test("wasifs CLI hides tar metadata when listing and unpacking", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wasmacs-wasifs-cli-"));
  const image = join(dir, "with-metadata.wasifs");
  const unpacked = join(dir, "unpacked");

  await writeFile(image, createTar([
    { path: "home/user", type: "directory" },
    { path: "home/user/PaxHeader/projects", type: "file", bytes: "metadata" },
    { path: "home/user/._init.el", type: "file", bytes: "metadata" },
    { path: "home/user/init.el", type: "file", bytes: "(message \"ok\")\n" },
  ]));

  const list = await runWasifs(["list", image]);
  assert.doesNotMatch(list.stdout, /PaxHeader/);
  assert.doesNotMatch(list.stdout, /._init/);
  assert.match(list.stdout, /^home\/user\/init\.el$/m);

  await runWasifs(["unpack", image, unpacked]);
  assert.equal(existsSync(join(unpacked, "home/user/PaxHeader/projects")), false);
  assert.equal(existsSync(join(unpacked, "home/user/._init.el")), false);
  assert.equal(await readFile(join(unpacked, "home/user/init.el"), "utf8"), "(message \"ok\")\n");

  await rm(dir, { recursive: true, force: true });
});
