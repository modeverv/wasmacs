import { readFile } from "node:fs/promises";
import { createTar, parseTar } from "./tar.js";

function normalizePath(path) {
  if (!path.startsWith("/")) throw new Error(`path must be absolute: ${path}`);
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function parentPath(path) {
  const normalized = normalizePath(path);
  if (normalized === "/") return "/";
  const index = normalized.lastIndexOf("/");
  return index === 0 ? "/" : normalized.slice(0, index);
}

// macOS `tar` embeds extended-attribute metadata as `PaxHeader/<name>` (PAX
// extended header) and `._<name>` (AppleDouble resource fork) entries. These
// are not real user files/directories and must not be mounted, or a bogus
// "PaxHeader" directory shows up in /home/user.
function isMacTarMetadata(cleanEntry) {
  const base = cleanEntry.slice(cleanEntry.lastIndexOf("/") + 1);
  return cleanEntry === "PaxHeader" || cleanEntry.startsWith("PaxHeader/")
    || cleanEntry.includes("/PaxHeader/") || base.startsWith("._");
}

function entryToMountPath(entryPath) {
  const clean = entryPath.replace(/\/$/, "");
  if (isMacTarMetadata(clean)) return null;
  if (clean === "system") return "/system";
  if (clean.startsWith("system/")) return `/${clean}`;
  if (clean === "home/user") return "/home/user";
  if (clean.startsWith("home/user/")) return `/${clean}`;
  return null;
}

export class WasifsHostFileSystem {
  constructor() {
    this.nodes = new Map();
    this.nodes.set("/", { kind: "directory", readonly: false });
    this.mounts = [
      { path: "/system", readonly: true },
      { path: "/home/user", readonly: false },
      { path: "/tmp", readonly: false },
    ];
    this.mkdir("/tmp");
  }

  static async fromImages({ systemImagePath, userImagePath }) {
    const fs = new WasifsHostFileSystem();
    if (systemImagePath) {
      fs.importTar(await readFile(systemImagePath), true);
    }
    if (userImagePath) {
      fs.importTar(await readFile(userImagePath), false);
    }
    return fs;
  }

  importTar(buffer, readonly) {
    for (const entry of parseTar(buffer)) {
      const path = entryToMountPath(entry.path);
      if (!path) continue;
      if (entry.type === "directory") this.setDirectory(path, readonly);
      else this.setFile(path, entry.bytes, readonly);
    }
  }

  exportUserImage() {
    const entries = [];
    for (const [path, node] of [...this.nodes.entries()].sort()) {
      if (path !== "/home/user" && !path.startsWith("/home/user/")) continue;
      const tarPath = path.slice(1);
      entries.push({
        path: tarPath,
        type: node.kind,
        bytes: node.bytes,
      });
    }
    return createTar(entries);
  }

  mountFor(path) {
    const normalized = normalizePath(path);
    return this.mounts
      .filter((mount) => normalized === mount.path || normalized.startsWith(`${mount.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0];
  }

  assertWritable(path) {
    const mount = this.mountFor(path);
    if (mount?.readonly) throw new Error(`read-only filesystem: ${mount.path}`);
  }

  ensureParent(path) {
    const parent = parentPath(path);
    if (!this.nodes.has(parent)) this.ensureParent(parent);
    if (!this.nodes.has(parent)) this.setDirectory(parent, false);
    const node = this.nodes.get(parent);
    if (node.kind !== "directory") throw new Error(`parent is not a directory: ${parent}`);
  }

  setDirectory(path, readonly) {
    const normalized = normalizePath(path);
    if (normalized !== "/") this.ensureParent(normalized);
    this.nodes.set(normalized, { kind: "directory", readonly });
  }

  setFile(path, bytes, readonly) {
    const normalized = normalizePath(path);
    this.ensureParent(normalized);
    this.nodes.set(normalized, { kind: "file", bytes: Buffer.from(bytes), readonly });
  }

  mkdir(path) {
    const normalized = normalizePath(path);
    this.assertWritable(normalized);
    this.setDirectory(normalized, false);
  }

  stat(path) {
    const normalized = normalizePath(path);
    const node = this.nodes.get(normalized);
    if (!node) throw new Error(`not found: ${normalized}`);
    return {
      kind: node.kind,
      size: node.kind === "file" ? node.bytes.length : 0,
      readonly: node.readonly,
    };
  }

  readdir(path) {
    const normalized = normalizePath(path);
    const node = this.nodes.get(normalized);
    if (!node) throw new Error(`not found: ${normalized}`);
    if (node.kind !== "directory") throw new Error(`not a directory: ${normalized}`);

    const prefix = normalized === "/" ? "/" : `${normalized}/`;
    const entries = [];
    for (const [candidate, child] of this.nodes.entries()) {
      if (candidate === normalized || !candidate.startsWith(prefix)) continue;
      const rest = candidate.slice(prefix.length);
      if (rest.length === 0 || rest.includes("/")) continue;
      entries.push({ name: rest, kind: child.kind });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  readFile(path) {
    const normalized = normalizePath(path);
    const node = this.nodes.get(normalized);
    if (!node) throw new Error(`not found: ${normalized}`);
    if (node.kind !== "file") throw new Error(`not a file: ${normalized}`);
    return Buffer.from(node.bytes);
  }

  writeFile(path, bytes) {
    const normalized = normalizePath(path);
    this.assertWritable(normalized);
    this.setFile(normalized, bytes, false);
    return Buffer.byteLength(bytes);
  }

  rename(oldPath, newPath) {
    const oldNormalized = normalizePath(oldPath);
    const newNormalized = normalizePath(newPath);
    this.assertWritable(oldNormalized);
    this.assertWritable(newNormalized);
    if (!this.nodes.has(oldNormalized)) throw new Error(`not found: ${oldNormalized}`);
    this.ensureParent(newNormalized);

    const moves = [...this.nodes.entries()]
      .filter(([path]) => path === oldNormalized || path.startsWith(`${oldNormalized}/`))
      .sort((a, b) => a[0].length - b[0].length);

    for (const [path] of moves) this.nodes.delete(path);
    for (const [path, node] of moves) {
      const suffix = path.slice(oldNormalized.length);
      this.nodes.set(`${newNormalized}${suffix}`, node);
    }
  }

  unlink(path) {
    const normalized = normalizePath(path);
    this.assertWritable(normalized);
    const node = this.nodes.get(normalized);
    if (!node) throw new Error(`not found: ${normalized}`);
    if (node.kind === "directory" && this.readdir(normalized).length > 0) {
      throw new Error(`directory not empty: ${normalized}`);
    }
    this.nodes.delete(normalized);
  }

  sync() {
    return true;
  }
}
