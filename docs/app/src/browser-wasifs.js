const blockSize = 512;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function bytesFromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function trimNulls(bytes) {
  const zero = bytes.indexOf(0);
  const slice = bytes.subarray(0, zero === -1 ? bytes.length : zero);
  return textDecoder.decode(slice).trim();
}

function parseOctal(bytes) {
  const text = trimNulls(bytes).trim();
  return text.length === 0 ? 0 : Number.parseInt(text, 8);
}

function padLength(length) {
  return Math.ceil(length / blockSize) * blockSize;
}

function writeAscii(target, offset, length, value) {
  target.fill(0, offset, offset + length);
  const bytes = textEncoder.encode(value.slice(0, length));
  target.set(bytes.subarray(0, length), offset);
}

function writeOctal(target, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, "0").slice(-(length - 1));
  writeAscii(target, offset, length, text);
}

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

function entryToMountPath(entryPath) {
  const clean = entryPath.replace(/\/$/, "");
  if (clean === "home/user") return "/home/user";
  if (clean.startsWith("home/user/")) return `/${clean}`;
  return null;
}

function tarPath(path) {
  return path.replace(/^\/+/, "").replace(/\/+/g, "/");
}

export function parseUserWasifs(bytes) {
  const nodes = new Map();
  nodes.set("/home/user", { kind: "directory" });
  let offset = 0;

  while (offset + blockSize <= bytes.length) {
    const header = bytes.subarray(offset, offset + blockSize);
    if (header.every((byte) => byte === 0)) break;

    const name = trimNulls(header.subarray(0, 100));
    const prefix = trimNulls(header.subarray(345, 500));
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const path = entryToMountPath(entryPath);
    const size = parseOctal(header.subarray(124, 136));
    const typeflag = String.fromCharCode(header[156] || 48);
    const dataStart = offset + blockSize;
    const dataEnd = dataStart + size;

    if (path) {
      const isDirectory = typeflag === "5" || entryPath.endsWith("/");
      nodes.set(path, {
        kind: isDirectory ? "directory" : "file",
        bytes: isDirectory ? undefined : bytes.slice(dataStart, dataEnd),
      });
    }

    offset = dataStart + padLength(size);
  }

  return nodes;
}

export function createUserWasifs(nodes) {
  const chunks = [];
  const paths = [...nodes.keys()]
    .filter((path) => path === "/home/user" || path.startsWith("/home/user/"))
    .sort();

  for (const path of paths) {
    const node = nodes.get(path);
    const isDirectory = node.kind === "directory";
    const name = isDirectory ? `${tarPath(path)}/` : tarPath(path);
    const content = isDirectory ? new Uint8Array() : node.bytes ?? new Uint8Array();
    const header = new Uint8Array(blockSize);

    writeAscii(header, 0, 100, name);
    writeOctal(header, 100, 8, isDirectory ? 0o755 : 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, content.length);
    writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
    header.fill(32, 148, 156);
    header[156] = isDirectory ? "5".charCodeAt(0) : "0".charCodeAt(0);
    writeAscii(header, 257, 6, "ustar");
    writeAscii(header, 263, 2, "00");

    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeOctal(header, 148, 7, checksum);
    header[155] = 0;
    chunks.push(header);

    if (!isDirectory) {
      chunks.push(content);
      const padding = padLength(content.length) - content.length;
      if (padding > 0) chunks.push(new Uint8Array(padding));
    }
  }

  chunks.push(new Uint8Array(blockSize * 2));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export class BrowserUserImage {
  constructor(nodes) {
    this.nodes = nodes;
    if (!this.nodes.has("/home/user")) {
      this.nodes.set("/home/user", { kind: "directory" });
    }
  }

  static fromBytes(bytes) {
    return new BrowserUserImage(parseUserWasifs(bytes));
  }

  static fromBase64(text) {
    return BrowserUserImage.fromBytes(bytesFromBase64(text));
  }

  readText(path, fallback = "") {
    const node = this.nodes.get(normalizePath(path));
    if (!node || node.kind !== "file") return fallback;
    return textDecoder.decode(node.bytes);
  }

  entries() {
    return [...this.nodes.entries()]
      .filter(([path]) => path === "/home/user" || path.startsWith("/home/user/"))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, node]) => ({
        path,
        kind: node.kind,
        bytes: node.kind === "file" ? new Uint8Array(node.bytes) : undefined,
      }));
  }

  writeText(path, text) {
    const normalized = normalizePath(path);
    this.ensureParents(normalized);
    this.nodes.set(normalized, { kind: "file", bytes: textEncoder.encode(text) });
  }

  ensureParents(path) {
    let current = parentPath(path);
    const pending = [];
    while (current !== "/" && !this.nodes.has(current)) {
      pending.push(current);
      current = parentPath(current);
    }
    for (const directory of pending.reverse()) {
      this.nodes.set(directory, { kind: "directory" });
    }
  }

  toBytes() {
    return createUserWasifs(this.nodes);
  }

  toBase64() {
    return bytesToBase64(this.toBytes());
  }
}
