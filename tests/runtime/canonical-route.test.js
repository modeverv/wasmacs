// Guards the canonical product route (Atomics + pdump) and the boundary
// between live files and archive/retired.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, normalize, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

const canonicalPage = "src/wasm/xterm-atomics-pdump.html";

// The files that make up the product route.  Moving or deleting one of them
// must be a deliberate change to this list.
const canonicalFiles = [
  canonicalPage,
  "src/wasm/coi-serviceworker.js",
  "src/wasm/src/emacs-atomics-pdump-worker.js",
  "src/wasm/src/pdump-diagnostic-worker.js",
  "src/wasm/src/xterm-emacs-terminal.js",
  // Eval service: Emacs as a Lisp engine (doc/eval-service.md).
  "src/wasm/eval-service.html",
  "src/wasm/src/emacs-eval-client.js",
  "src/wasm/src/emacs-eval-worker.js",
  "src/wasm/src/emacs-eval-core.js",
  "src/wasm/src/wasmacs-eval-service.el",
  "src/build/apply-emacs-patches.sh",
  "src/build/build-native-baseline.sh",
  "src/build/build-system-lisp-image.sh",
  "src/build/create-user-filesystem-image.sh",
  "src/build/probe-emacs-pdump-configure.sh",
  "src/build/build-emacs-browser-atomics-pdump-profile.sh",
  "src/build/build-sqlite.sh",
  "src/build/build-site.mjs",
  "src/build/generate-host-abi-wit.mjs",
  "src/emacs-lisp/wasmacs-url-fetch.el",
  // Process service: kernel, per-process runtime, userland builds.
  "src/runtime/process/wasmacs-kernel.js",
  "src/runtime/process/wasmacs-boot.js",
  "src/runtime/process/base/wasmacs-base.c",
  "src/runtime/process/wasmacs-userland.js",
  "src/runtime/process/child/wasmacs-child-library.js",
  "src/runtime/process/child/wasmacs-child-pre.js",
  "src/runtime/process/child/wasmacs-child-rt.c",
  "src/runtime/process/child/wasmacs-child-flags.sh",
  "src/userland/build.sh",
  "src/userland/busybox/build.sh",
  "src/userland/git/build.sh",
  "src/userland/grep/build.sh",
  "tools/scripts/lib/pdump-node-harness.mjs",
  "tools/scripts/probe-process-service.mjs",
  "tests/process/run-kernel-tests.mjs",
  "tests/process/build-test-programs.sh",
  "tools/scripts/wasmacs-atomics-host-library.js",
  "tools/scripts/serve-app.mjs",
  "tools/scripts/run-browser-smoke.mjs",
  "tools/scripts/validate-git-artifact-policy.sh",
];

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\n")
    .filter(Boolean)
    // A file moved or deleted in the working tree is still listed until staged.
    .filter((file) => existsSync(join(repoRoot, file)));
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

// Original repo-relative paths of everything under archive/retired/<mechanism>/.
function retiredOriginalPaths() {
  const root = "archive/retired";
  const paths = [];
  for (const mechanism of readdirSync(join(repoRoot, root), { withFileTypes: true })) {
    if (!mechanism.isDirectory()) continue;
    for (const file of walk(join(root, mechanism.name))) {
      paths.push({ mechanism: mechanism.name, original: relative(join(root, mechanism.name), file) });
    }
  }
  return paths;
}

// Files whose content is executed or resolved (not narrative documentation).
function operativeFiles() {
  return trackedFiles().filter((file) => {
    if (file.startsWith("archive/") || file.startsWith("docs/") || file.startsWith("vendor/")) return false;
    if (file === "tests/runtime/canonical-route.test.js") return false;
    return /\.(m?js|cjs|html|sh|json|yml|yaml|css|el)$/.test(file) || basename(file) === "Makefile";
  });
}

test("Pages entrypoint, dev server and smoke runner agree on the canonical page", () => {
  const appPath = `/app/${basename(canonicalPage)}`;
  assert.match(read("src/build/build-site.mjs"), /const pagesEntrypoint = "\.\/app\/xterm-atomics-pdump\.html";/);
  assert.match(read("tools/scripts/serve-app.mjs"), new RegExp(`const appEntrypoint = "${appPath}";`));
  assert.match(read("tools/scripts/run-browser-smoke.mjs"), new RegExp(`const defaultAppPath = "${appPath}\\?clear-storage=1";`));
  if (existsSync(join(repoRoot, "docs/index.html"))) {
    assert.match(read("docs/index.html"), /url=\.\/app\/xterm-atomics-pdump\.html/);
  }
});

test("canonical route files exist", () => {
  for (const file of canonicalFiles) {
    assert.equal(existsSync(join(repoRoot, file)), true, `missing canonical file: ${file}`);
  }
});

// docs/ is deployed without a rebuild: what is checked in must be what the
// sources say.
test("the Pages bundle holds the current app sources", { skip: !existsSync(join(repoRoot, "docs/app")) && "no docs/app" }, () => {
  const visible = (dir) => walk(dir).map((file) => relative(dir, file)).filter((file) => !basename(file).startsWith(".")).sort();
  const sources = visible("src/wasm");
  // The build adds one file that has no source: the eval service's build id
  // (checked against the published files in eval-service-bundle.test.js).
  const generated = ["eval-build-id.json"];
  assert.deepEqual(visible("docs/app").filter((file) => !generated.includes(file)), sources,
    "docs/app and src/wasm hold different files; run `npm run build`");
  for (const file of sources) {
    assert.equal(
      readFileSync(join(repoRoot, "docs/app", file)).equals(readFileSync(join(repoRoot, "src/wasm", file))),
      true,
      `docs/app/${file} differs from src/wasm/${file}; run \`npm run build\``,
    );
  }
});

test("canonical page only loads modules and workers that exist", () => {
  const page = read(canonicalPage);
  const refs = new Set();
  for (const m of page.matchAll(/new Worker\("(\.\/[^"?]+)/g)) refs.add(m[1]);
  for (const m of page.matchAll(/import\s+[^"']+from\s+"(\.\/[^"]+)"/g)) refs.add(m[1]);
  assert.equal(refs.size >= 3, true, "expected the page to reference its terminal module and workers");
  for (const ref of refs) {
    const file = normalize(join(dirname(canonicalPage), ref));
    assert.equal(existsSync(join(repoRoot, file)), true, `${canonicalPage} references missing ${file}`);
  }
  assert.equal(refs.has("./src/emacs-atomics-pdump-worker.js"), true);
});

test("package.json scripts and the Makefile only run files that exist", () => {
  const sources = { Makefile: read("Makefile") };
  for (const [name, command] of Object.entries(JSON.parse(read("package.json")).scripts)) {
    sources[`package.json script ${name}`] = command;
  }
  for (const [where, text] of Object.entries(sources)) {
    for (const m of text.matchAll(/(?:^|[\s"'=])((?:tools|src|tests)\/[A-Za-z0-9_.\/*-]+)/g)) {
      const path = m[1];
      if (path.includes("*")) {
        const dir = dirname(path);
        const pattern = new RegExp(`^${basename(path).replace(/[.]/g, "\\.").replace(/\*/g, ".*")}$`);
        const matches = readdirSync(join(repoRoot, dir)).filter((name) => pattern.test(name));
        assert.equal(matches.length > 0, true, `${where}: ${path} matches nothing`);
      } else {
        assert.equal(existsSync(join(repoRoot, path)), true, `${where}: ${path} does not exist`);
      }
    }
  }
});

test("live operative files do not reference retired files", () => {
  const retired = retiredOriginalPaths();
  assert.equal(retired.length > 100, true, "expected archive/retired to hold the retired mechanisms");
  const live = new Set(trackedFiles());
  const offenders = [];
  for (const file of operativeFiles()) {
    if (statSync(join(repoRoot, file)).size > 2_000_000) continue;
    // Pointers into the archive (comments, error messages) are fine.
    const text = read(file).replace(/archive\/retired\/[A-Za-z0-9_.\/-]+/g, "");
    for (const { original } of retired) {
      if (live.has(original)) continue; // a live file with the same path replaced it
      if (text.includes(original)) offenders.push(`${file} -> ${original}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("live app modules do not import retired app modules", () => {
  const retiredAppModules = retiredOriginalPaths()
    .map(({ original }) => original)
    .filter((path) => path.startsWith("src/wasm/src/") && path.endsWith(".js"))
    .map((path) => basename(path));
  const live = new Set(trackedFiles());
  const offenders = [];
  for (const file of trackedFiles().filter((f) => f.startsWith("src/wasm/") && /\.(js|html)$/.test(f))) {
    const text = read(file);
    for (const name of retiredAppModules) {
      if (live.has(`src/wasm/src/${name}`)) continue;
      const pattern = new RegExp(`(?:from\\s+|import\\(|importScripts\\(|new Worker\\()\\s*["'\`][^"'\`]*/${name.replace(".", "\\.")}`);
      if (pattern.test(text)) offenders.push(`${file} loads retired ${name}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("archive index describes every retired mechanism", () => {
  const index = read("archive/README.md");
  for (const entry of readdirSync(join(repoRoot, "archive/retired"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    assert.match(index, new RegExp(`retired/${entry.name}\\b`), `archive/README.md does not describe retired/${entry.name}`);
  }
});

test("npm test runs the node tests and the artifact policy only", () => {
  const scripts = JSON.parse(read("package.json")).scripts;
  assert.equal(scripts.test, "node --test tests/runtime/*.test.js && tools/scripts/validate-git-artifact-policy.sh");
});
