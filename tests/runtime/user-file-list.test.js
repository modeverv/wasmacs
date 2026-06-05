import test from "node:test";
import assert from "node:assert/strict";
import { userFileLabel, visibleUserFilePaths } from "../../src/wasm/src/user-file-list.js";

test("visible user file paths hide tar metadata and internal runtime state", () => {
  const paths = visibleUserFilePaths([
    { kind: "directory", path: "/home/user/projects" },
    { kind: "file", path: "/home/user/projects/demo.txt" },
    { kind: "file", path: "/home/user/projects/switch-a.txt" },
    { kind: "file", path: "/home/user/.local/share/wasmacs/journal.jsonl" },
    { kind: "file", path: "/home/user/PaxHeader/projects" },
    { kind: "file", path: "/home/user/._projects" },
    { kind: "file", path: "/system/lisp/subr.el" },
  ]);

  assert.deepEqual(paths, [
    "/home/user/projects/demo.txt",
    "/home/user/projects/switch-a.txt",
  ]);
});

test("user file labels render paths relative to the user home", () => {
  assert.equal(userFileLabel("/home/user/projects/demo.txt"), "~/projects/demo.txt");
});
