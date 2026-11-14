// The licences travel with the programs (NOTICE.md): what the repository
// says is what the site publishes, and every published program is named.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(`${repoRoot}${path}`, "utf8");

test("the site publishes the licences of the repository (npm run build)", () => {
  const published = read("docs/licenses/files.txt").trim().split("\n");
  const sources = { "NOTICE.txt": "NOTICE.md", "LICENSE.txt": "LICENSE" };
  for (const name of readdirSync(`${repoRoot}LICENSES`)) sources[name] = `LICENSES/${name}`;
  assert.deepEqual([...published].sort(), Object.keys(sources).sort());
  assert.deepEqual(readdirSync(`${repoRoot}docs/licenses`).sort(), [...published, "files.txt"].sort());
  for (const name of published) assert.equal(read(`docs/licenses/${name}`), read(sources[name]), name);
});

test("NOTICE.md names every program the site publishes and every licence text", () => {
  const notice = read("NOTICE.md");
  // busybox.wasm -> "busybox", git-http.wasm -> "git-http", ...
  const programs = readdirSync(`${repoRoot}docs/artifacts/userland`).filter((name) => name.endsWith(".wasm"));
  for (const program of programs) {
    const name = program.replace(/\.wasm$/, "");
    assert.ok(notice.includes(`${name}.wasm`) || notice.includes(`\`${name}.*\``) || notice.includes(`${name}-*`),
      `${program} is published but NOTICE.md does not name it`);
  }
  for (const text of ["GPL-3.0-or-later", "GPL-2.0-only", "PSF-2.0"]) {
    assert.ok(notice.includes(text) && existsSync(`${repoRoot}LICENSES/${text}.txt`), text);
  }
  // The release that holds the source archives is named by its tag.
  assert.match(notice, /releases\/tag\/sources-\d{4}-\d{2}-\d{2}/);
});

test("the pages point to the licences", () => {
  for (const page of ["src/wasm/xterm-atomics-pdump.html", "src/wasm/eval-service.html"]) {
    assert.ok(read(page).includes('href="../licenses/NOTICE.txt"'), page);
  }
});
