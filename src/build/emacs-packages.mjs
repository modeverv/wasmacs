// The files of Emacs (its lisp/ and etc/) as the eval service reads them.
//
// The link step packs them into temacs.data and lists them in temacs.js.
// The editor loads that package whole.  The eval service reads a file when
// Emacs asks for it (src/wasm/src/emacs-eval-core.js, WasmacsEvalFiles), and
// for that it needs to know where each file is.  This writes, next to the
// package:
//
//   temacs.files.json        index of the whole package (temacs.data.parts/)
//   temacs.core.data         the core files only, one after the other
//   temacs.core.files.json   index of temacs.core.data
//
// An index: { version, root, container: { size, chunkSize, parts },
//             files: [[name, start, end, crc32]...] }.
//
// The core package is for a site that carries its own copy of Emacs and
// wants a small one (elisp-studio's fetch-emacs.sh): Emacs Lisp as a
// language with its standard library, without the editor.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32 } from "node:zlib";

export const PACKAGE_CHUNK_SIZE = 32 * 1024 * 1024;

// Source files that only the build of Emacs itself reads.
const BOOTSTRAP_ONLY = new Set(["lisp/ldefs-boot.el", "lisp/loadup.el"]);
const CORE_LISP = /^lisp\/(emacs-lisp\/|international\/|url\/|calendar\/)?[^/]+\.elc?$/;

/**
 * Is NAME (relative: "lisp/subr.elc") in the core package?  NAMES is the set
 * of all names.  The core is the compiled Lisp of lisp/ itself and of
 * emacs-lisp/, international/, url/ and calendar/ (source where there is no
 * compiled file: subdirs.el, the Unicode tables), and the charset maps.
 */
export function coreFile(name, names) {
  if (name.startsWith("etc/charsets/")) return true;
  if (!CORE_LISP.test(name) || BOOTSTRAP_ONLY.has(name)) return false;
  return name.endsWith(".elc") || !names.has(`${name}c`);
}

/** The files the glue GLUE (text of temacs.js) lists: { root, size, files: [{ name, start, end }] }. */
export function packageFiles(glue) {
  // Minified for -O2/-O3 builds (the minifier writes 51317000 as 51317e3),
  // pretty-printed with quoted keys for -O0.
  const number = "(\\d+(?:e\\d+)?)";
  const entry = new RegExp(`\\{\\s*"?filename"?:\\s*"([^"\\\\]+)",\\s*"?start"?:\\s*${number},\\s*"?end"?:\\s*${number}\\s*\\}`, "g");
  const files = [...glue.matchAll(entry)].map(([, name, start, end]) => ({ name, start: Number(start), end: Number(end) }));
  const size = Number(new RegExp(`"?remote_package_size"?:\\s*${number}`).exec(glue)?.[1]);
  if (!files.length || !Number.isSafeInteger(size)) throw new Error("temacs.js lists no data package");
  let at = 0;
  for (const file of files) {
    if (file.start !== at || file.end < file.start) throw new Error(`temacs.js: ${file.name} is not where the package expects it`);
    at = file.end;
  }
  if (at !== size) throw new Error(`temacs.js: the files end at ${at}, the package at ${size}`);
  // Every file is under Emacs's own directory.
  let root = files[0].name.slice(0, files[0].name.lastIndexOf("/") + 1);
  while (!files.every((file) => file.name.startsWith(root))) root = root.slice(0, root.lastIndexOf("/", root.length - 2) + 1);
  if (root.length < 2) throw new Error("temacs.js: the files of the package have no common directory");
  return { root, size, files: files.map((file) => ({ ...file, name: file.name.slice(root.length) })) };
}

// One file a line: a change of the package is a readable diff.
function indexText(root, container, files) {
  return `{"version":1,"root":${JSON.stringify(root)},"container":${JSON.stringify(container)},"files":[\n${
    files.map((file) => JSON.stringify(file)).join(",\n")}\n]}\n`;
}

/**
 * Write the indexes and the core package into DIR, which holds temacs.js
 * and the whole temacs.data (before it is split into parts).
 */
export async function writeEmacsPackages(dir, chunkSize = PACKAGE_CHUNK_SIZE) {
  if (!existsSync(join(dir, "temacs.js")) || !existsSync(join(dir, "temacs.data"))) return;
  const { root, size, files } = packageFiles(await readFile(join(dir, "temacs.js"), "utf8"));
  const data = await readFile(join(dir, "temacs.data"));
  if (data.length !== size) throw new Error(`temacs.data has ${data.length} bytes, temacs.js expects ${size}`);

  const parts = [];
  for (let offset = 0; offset < size; offset += chunkSize) parts.push(`temacs.data.parts/part-${String(parts.length).padStart(3, "0")}`);
  await writeFile(join(dir, "temacs.files.json"), indexText(root, { size, chunkSize, parts },
    files.map((file) => [file.name, file.start, file.end, crc32(data.subarray(file.start, file.end))])));

  const names = new Set(files.map((file) => file.name));
  const core = [];
  const chunks = [];
  let at = 0;
  for (const file of files) {
    if (!coreFile(file.name, names)) continue;
    const bytes = data.subarray(file.start, file.end);
    core.push([file.name, at, at + bytes.length, crc32(bytes)]);
    chunks.push(bytes);
    at += bytes.length;
  }
  await writeFile(join(dir, "temacs.core.data"), Buffer.concat(chunks));
  await writeFile(join(dir, "temacs.core.files.json"), indexText(root, { size: at, chunkSize: at, parts: ["temacs.core.data"] }, core));
}
