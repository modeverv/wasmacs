export function normalizeUserPath(path) {
  const raw = String(path || "").trim();
  const absolute = raw.startsWith("/") ? raw : `/home/user/projects/${raw}`;
  const parts = [];
  for (const part of absolute.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const normalized = `/${parts.join("/")}`;
  if (!normalized.startsWith("/home/user/")) {
    throw new Error("path must stay under /home/user");
  }
  return normalized;
}
