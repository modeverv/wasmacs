import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const wasmSource = join(repoRoot, "src", "wasm");
const buildArtifacts = join(repoRoot, "build", "artifacts");
const docsRoot = join(repoRoot, "docs");
const docsApp = join(docsRoot, "app");
const docsArtifacts = join(docsRoot, "artifacts");
const pagesIndexTarget = join(docsRoot, "index.html");
const pagesEntrypoint = "./app/xterm-atomics-pdump.html";

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

const pagesIndex = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="0; url=${pagesEntrypoint}" />
    <title>wasmacs</title>
    <script>
      location.replace(${JSON.stringify(pagesEntrypoint)} + location.search + location.hash);
    </script>
  </head>
  <body>
    <p><a href="${pagesEntrypoint}">Open wasmacs</a></p>
  </body>
</html>
`;
await writeFile(pagesIndexTarget, pagesIndex);
await copyIfExists(buildArtifacts, docsArtifacts);

const docsAtomicsPdump = join(docsArtifacts, "emacs-browser-atomics-pdump");
const docsTemacs = join(docsAtomicsPdump, "temacs");
const docsTemacsJs = join(docsAtomicsPdump, "temacs.js");
if (existsSync(docsTemacs) && !existsSync(docsTemacsJs)) {
  await cp(docsTemacs, docsTemacsJs);
}

console.log("Built docs GitHub Pages bundle.");
