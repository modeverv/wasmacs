import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const wasmSource = join(repoRoot, "src", "wasm");
const buildArtifacts = join(repoRoot, "build", "artifacts");
const docsRoot = join(repoRoot, "docs");
const docsApp = join(docsRoot, "app");
const docsArtifacts = join(docsRoot, "artifacts");
const pagesIndexSource = join(wasmSource, "xterm-atomics-pdump.html");
const pagesIndexTarget = join(docsRoot, "index.html");

await import("./generate-host-abi-wit.mjs");

async function copyIfExists(from, to) {
  if (!existsSync(from)) return;
  await cp(from, to, { recursive: true });
}

await mkdir(docsRoot, { recursive: true });
await rm(docsApp, { recursive: true, force: true });
await rm(docsArtifacts, { recursive: true, force: true });
await rm(pagesIndexTarget, { force: true });
await rm(join(docsRoot, "coi-serviceworker.js"), { force: true });
await cp(wasmSource, docsApp, { recursive: true });
await cp(join(wasmSource, "coi-serviceworker.js"), join(docsRoot, "coi-serviceworker.js"));

const pagesIndex = (await readFile(pagesIndexSource, "utf8"))
  .replaceAll("../coi-serviceworker.js", "./coi-serviceworker.js")
  .replaceAll("./src/", "./app/src/")
  .replaceAll("../artifacts/", "./artifacts/");
await writeFile(pagesIndexTarget, pagesIndex);
await copyIfExists(buildArtifacts, docsArtifacts);

const docsAtomicsPdump = join(docsArtifacts, "emacs-browser-atomics-pdump");
const docsTemacs = join(docsAtomicsPdump, "temacs");
const docsTemacsJs = join(docsAtomicsPdump, "temacs.js");
if (existsSync(docsTemacs) && !existsSync(docsTemacsJs)) {
  await cp(docsTemacs, docsTemacsJs);
}

console.log("Built docs GitHub Pages bundle.");
