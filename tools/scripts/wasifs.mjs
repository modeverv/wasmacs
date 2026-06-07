#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { createTar, parseTar } from "../../src/runtime/fs/tar.js";

function usage() {
  return `Usage:
  npm run wasifs:list -- <image.wasifs>
  npm run wasifs:pack -- <source-dir> <image.wasifs> [--root home/user]
  npm run wasifs:unpack -- <image.wasifs> <destination-dir>

Commands:
  list      Print tar-compatible paths in a .wasifs image.
  pack      Pack a directory tree into a tar-compatible .wasifs image.
  unpack    Unpack a .wasifs image into a directory.
`;
}

function fail(message) {
  console.error(message);
  console.error("");
  console.error(usage().trimEnd());
  process.exitCode = 1;
}

function normalizeTarPath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+/g, "/");
  const parts = [];
  for (const part of normalized.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      throw new Error("path must stay inside the image root");
    }
    parts.push(part);
  }
  return parts.join("/");
}

function validateRoot(root) {
  if (!root || root.startsWith("/") || root.split(/[\\/]+/).includes("..")) {
    throw new Error("root must be a relative tar path without .. segments");
  }
  const normalized = normalizeTarPath(root);
  if (!normalized) throw new Error("root must be a relative tar path without .. segments");
  return normalized;
}

function assertWritableTarPath(path) {
  const normalized = normalizeTarPath(path);
  if (!normalized) throw new Error("empty tar entry path is not supported");
  return normalized;
}

function isTarMetadataPath(path) {
  return normalizeTarPath(path)
    .split("/")
    .some((part) => part === "PaxHeader" || part.startsWith("._") || part === ".DS_Store");
}

function destinationPath(baseDir, tarPath) {
  const normalized = normalizeTarPath(tarPath);
  const base = resolve(baseDir);
  const target = resolve(base, ...normalized.split("/"));
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new Error(`unsafe tar path: ${tarPath}`);
  }
  return target;
}

async function collectEntries(sourceDir, root) {
  const source = resolve(sourceDir);
  const sourceStat = await stat(source);
  if (!sourceStat.isDirectory()) throw new Error(`source must be a directory: ${sourceDir}`);

  const entries = [{ path: assertWritableTarPath(root), type: "directory" }];

  async function walk(absDir, relDir) {
    const dirents = await readdir(absDir, { withFileTypes: true });
    dirents.sort((a, b) => a.name.localeCompare(b.name));

    for (const dirent of dirents) {
      if (isTarMetadataPath(dirent.name)) continue;
      const absPath = join(absDir, dirent.name);
      const relPath = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      const tarPath = assertWritableTarPath(`${root}/${relPath}`);

      if (dirent.isDirectory()) {
        entries.push({ path: tarPath, type: "directory" });
        await walk(absPath, relPath);
      } else if (dirent.isFile()) {
        entries.push({ path: tarPath, type: "file", bytes: await readFile(absPath) });
      } else {
        throw new Error(`unsupported filesystem entry in pack source: ${absPath}`);
      }
    }
  }

  await walk(source, "");
  return entries;
}

async function listImage(imagePath) {
  const entries = parseTar(await readFile(imagePath));
  for (const entry of entries) {
    if (isTarMetadataPath(entry.path)) continue;
    console.log(entry.path);
  }
}

async function packImage(args) {
  const [sourceDir, imagePath, ...rest] = args;
  if (!sourceDir || !imagePath) throw new Error("pack requires <source-dir> and <image.wasifs>");

  let root = "home/user";
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--root" && rest[i + 1]) {
      root = rest[i + 1];
      i += 1;
    } else {
      throw new Error(`unknown pack option: ${rest[i]}`);
    }
  }

  const entries = await collectEntries(sourceDir, validateRoot(root));
  await mkdir(dirname(resolve(imagePath)), { recursive: true });
  await writeFile(imagePath, createTar(entries));
  console.log(`packed ${entries.length} entries into ${imagePath}`);
}

async function unpackImage(imagePath, destinationDir) {
  if (!imagePath || !destinationDir) {
    throw new Error("unpack requires <image.wasifs> and <destination-dir>");
  }

  const destination = resolve(destinationDir);
  await mkdir(destination, { recursive: true });
  let count = 0;

  for (const entry of parseTar(await readFile(imagePath))) {
    if (isTarMetadataPath(entry.path)) continue;
    const target = destinationPath(destination, entry.path);
    if (entry.type === "directory") {
      await mkdir(target, { recursive: true });
    } else if (entry.type === "file") {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.bytes);
    }
    count += 1;
  }

  console.log(`unpacked ${count} entries from ${imagePath} into ${destinationDir}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "-h" || command === "--help") {
    console.log(usage().trimEnd());
    return;
  }

  if (command === "list") {
    const [imagePath] = args;
    if (!imagePath) throw new Error("list requires <image.wasifs>");
    if (!existsSync(imagePath)) throw new Error(`image not found: ${imagePath}`);
    await listImage(imagePath);
  } else if (command === "pack") {
    await packImage(args);
  } else if (command === "unpack") {
    await unpackImage(args[0], args[1]);
  } else {
    throw new Error(`unknown wasifs command: ${command}`);
  }
}

main().catch((error) => {
  fail(error.message);
});
