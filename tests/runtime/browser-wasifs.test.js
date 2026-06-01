import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { BrowserUserImage } from "../../app/src/browser-wasifs.js";
import { parseTar } from "../../runtime/fs/tar.js";

const repoRoot = new URL("../..", import.meta.url).pathname;

test("browser user image imports and exports tar-compatible wasifs", async () => {
  const imageBytes = new Uint8Array(await readFile(join(repoRoot, "artifacts/user-filesystem-empty.wasifs")));
  const image = BrowserUserImage.fromBytes(imageBytes);

  assert.match(image.readText("/home/user/init.el"), /wasmacs empty user image/);
  image.writeText("/home/user/notes.txt", "browser persisted text");

  const exported = image.toBytes();
  const entries = parseTar(Buffer.from(exported));
  const notes = entries.find((entry) => entry.path === "home/user/notes.txt");

  assert.equal(notes.bytes.toString("utf8"), "browser persisted text");
});

test("browser user image roundtrips through base64 storage payload", async () => {
  const imageBytes = new Uint8Array(await readFile(join(repoRoot, "artifacts/user-filesystem-empty.wasifs")));
  const image = BrowserUserImage.fromBytes(imageBytes);
  image.writeText("/home/user/projects/demo.txt", "roundtrip");

  const restored = BrowserUserImage.fromBase64(image.toBase64());

  assert.equal(restored.readText("/home/user/projects/demo.txt"), "roundtrip");
});

test("browser user image exposes entries for worker filesystem materialization", async () => {
  const imageBytes = new Uint8Array(await readFile(join(repoRoot, "artifacts/user-filesystem-empty.wasifs")));
  const image = BrowserUserImage.fromBytes(imageBytes);
  image.writeText("/home/user/projects/demo.txt", "worker mount");

  const entries = image.entries();

  assert.ok(entries.some((entry) => entry.path === "/home/user" && entry.kind === "directory"));
  assert.ok(entries.some((entry) => entry.path === "/home/user/projects" && entry.kind === "directory"));
  assert.equal(
    new TextDecoder().decode(entries.find((entry) => entry.path === "/home/user/projects/demo.txt").bytes),
    "worker mount",
  );
});
