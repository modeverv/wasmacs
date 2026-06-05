const BLOCK_SIZE = 512;

function trimNulls(buffer) {
  const zero = buffer.indexOf(0);
  return buffer.subarray(0, zero === -1 ? buffer.length : zero).toString("utf8").trim();
}

function parseOctal(buffer) {
  const text = trimNulls(buffer).trim();
  return text.length === 0 ? 0 : Number.parseInt(text, 8);
}

function writeString(target, offset, length, value) {
  target.fill(0, offset, offset + length);
  target.write(value.slice(0, length), offset, length, "utf8");
}

function writeOctal(target, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, "0").slice(-(length - 1));
  writeString(target, offset, length, text);
}

function tarPath(path) {
  return path.replace(/^\/+/, "").replace(/\/+/g, "/");
}

function padLength(length) {
  return Math.ceil(length / BLOCK_SIZE) * BLOCK_SIZE;
}

export function parseTar(buffer) {
  const entries = [];
  let offset = 0;

  while (offset + BLOCK_SIZE <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) break;

    const name = trimNulls(header.subarray(0, 100));
    const prefix = trimNulls(header.subarray(345, 500));
    const path = prefix ? `${prefix}/${name}` : name;
    const size = parseOctal(header.subarray(124, 136));
    const typeflag = String.fromCharCode(header[156] || 48);
    const dataStart = offset + BLOCK_SIZE;
    const dataEnd = dataStart + size;

    entries.push({
      path,
      type: typeflag === "5" || path.endsWith("/") ? "directory" : "file",
      bytes: Buffer.from(buffer.subarray(dataStart, dataEnd)),
    });

    offset = dataStart + padLength(size);
  }

  return entries;
}

export function createTar(entries) {
  const chunks = [];

  for (const entry of entries) {
    const path = tarPath(entry.path);
    const isDirectory = entry.type === "directory";
    const name = isDirectory && !path.endsWith("/") ? `${path}/` : path;
    const bytes = isDirectory ? Buffer.alloc(0) : Buffer.from(entry.bytes ?? []);
    const header = Buffer.alloc(BLOCK_SIZE);

    writeString(header, 0, 100, name);
    writeOctal(header, 100, 8, isDirectory ? 0o755 : 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, bytes.length);
    writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
    header.fill(32, 148, 156);
    header[156] = isDirectory ? "5".charCodeAt(0) : "0".charCodeAt(0);
    writeString(header, 257, 6, "ustar");
    writeString(header, 263, 2, "00");

    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeOctal(header, 148, 7, checksum);
    header[155] = 0;

    chunks.push(header);
    if (!isDirectory) {
      chunks.push(bytes);
      const padding = padLength(bytes.length) - bytes.length;
      if (padding > 0) chunks.push(Buffer.alloc(padding));
    }
  }

  chunks.push(Buffer.alloc(BLOCK_SIZE * 2));
  return Buffer.concat(chunks);
}
