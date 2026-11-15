// The build id of the eval service: one hash over every file its worker
// loads into Emacs.  The worker keeps those files in the browser's Cache
// Storage under this id and downloads them again only when it changes
// (src/wasm/src/emacs-eval-worker.js).
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const evalBuildFiles = [
  "artifacts/emacs-browser-atomics-pdump/temacs.js",
  "artifacts/emacs-browser-atomics-pdump/temacs.wasm",
  "artifacts/emacs-browser-atomics-pdump/bootstrap-emacs.pdmp",
  // Names the sha256 of every part of temacs.data.
  "artifacts/emacs-browser-atomics-pdump/temacs.data.parts/manifest.json",
  // Name the checksum of every file of Emacs, in the whole package and in
  // the core package.
  "artifacts/emacs-browser-atomics-pdump/temacs.files.json",
  "artifacts/emacs-browser-atomics-pdump/temacs.core.files.json",
  "app/src/emacs-eval-core.js",
  "app/src/wasmacs-eval-service.el",
];

/** The id for the site in SITEROOT (docs/). */
export async function evalBuildId(siteRoot) {
  const hash = createHash("sha256");
  for (const file of evalBuildFiles) {
    hash.update(`${file}\n`);
    hash.update(createHash("sha256").update(await readFile(join(siteRoot, file))).digest());
  }
  return hash.digest("hex").slice(0, 32);
}
