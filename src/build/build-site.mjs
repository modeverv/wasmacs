import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
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

async function splitLargeDataFile(filePath, chunkSize = 32 * 1024 * 1024) {
  if (!existsSync(filePath)) return;
  const bytes = await readFile(filePath);
  const partsDir = `${filePath}.parts`;
  await rm(partsDir, { recursive: true, force: true });
  await mkdir(partsDir, { recursive: true });

  const parts = [];
  for (let offset = 0, index = 0; offset < bytes.length; offset += chunkSize, index += 1) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    const name = `part-${String(index).padStart(3, "0")}`;
    await writeFile(join(partsDir, name), chunk);
    parts.push({
      name,
      size: chunk.length,
      sha256: createHash("sha256").update(chunk).digest("hex"),
    });
  }

  await writeFile(
    join(partsDir, "manifest.json"),
    JSON.stringify({
      file: "temacs.data",
      size: bytes.length,
      chunkSize,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      parts,
    }, null, 2),
  );
  await rm(filePath, { force: true });
}

async function patchTemacsJsForAsyncPreload(filePath) {
  if (!existsSync(filePath)) return;
  const source = await readFile(filePath, "utf8");
  const patched = source.replace(
    "      if (!fetched) {\n        fetched = await fetchPromise;\n      }\n      processPackageData(fetched);",
    "      if (!fetched) {\n        fetched = await fetchPromise;\n      } else {\n        fetched = await fetched;\n      }\n      processPackageData(fetched);",
  );
  const awaited = patched.replace(
    "      processPackageData(fetched);",
    "      await processPackageData(fetched);",
  );
  if (awaited !== source) await writeFile(filePath, awaited);
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
await patchTemacsJsForAsyncPreload(docsTemacsJs);
await splitLargeDataFile(join(docsAtomicsPdump, "temacs.data"));

console.log("Built docs GitHub Pages bundle.");
