export function visibleUserFilePaths(entries) {
  return entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.path)
    .filter((path) => path.startsWith("/home/user/"))
    .filter((path) => !path.split("/").some((part) => part === "PaxHeader" || part.startsWith("._")))
    .filter((path) => !path.startsWith("/home/user/.local/"))
    .sort((left, right) => left.localeCompare(right));
}

export function userFileLabel(path) {
  return path.replace(/^\/home\/user\//, "~/");
}
