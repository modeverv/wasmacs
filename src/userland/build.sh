#!/usr/bin/env bash
# Build the wasmacs userland: the program images that run as processes under
# the kernel (src/runtime/process).
#
#   src/userland/build.sh            build BusyBox, git, grep, diffutils and Python
#   src/userland/build.sh busybox    build only the named programs
#
# Output: build/artifacts/userland/<program>.{js,wasm} and manifest.json.
# src/build/build-site.mjs publishes that directory with the Pages bundle.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${here}/../.." && pwd)"
out="${repo_root}/build/artifacts/userland"

programs=("$@")
if [ "${#programs[@]}" -eq 0 ]; then
  programs=(busybox git grep diffutils python)
fi
for program in "${programs[@]}"; do
  [ -x "${here}/${program}/build.sh" ] || { echo "unknown userland program: ${program}" >&2; exit 2; }
  "${here}/${program}/build.sh"
done

# The browser worker loads the filesystem layout from the same directory.
mkdir -p "${out}"
cp "${repo_root}/src/runtime/process/wasmacs-userland.js" "${out}/wasmacs-userland.js"
cp "${repo_root}/src/runtime/process/wasmacs-http.js" "${out}/wasmacs-http.js"

# manifest.json: which images exist and which commands each provides.
node -e '
const fs = require("fs");
const out = process.argv[1];
const programs = {};
if (fs.existsSync(`${out}/busybox.wasm`)) {
  programs.busybox = {
    applets: fs.readFileSync(`${out}/busybox.applets.txt`, "utf8").split("\n").filter(Boolean),
    wasmBytes: fs.statSync(`${out}/busybox.wasm`).size,
  };
}
if (fs.existsSync(`${out}/git.wasm`)) {
  // The dashed names are what git runs on the "remote" side of a local
  // clone, fetch or push.
  programs.git = {
    applets: ["git", "git-upload-pack", "git-receive-pack", "git-upload-archive"],
    wasmBytes: fs.statSync(`${out}/git.wasm`).size,
  };
}
if (fs.existsSync(`${out}/grep.wasm`)) {
  programs.grep = { applets: ["grep"], wasmBytes: fs.statSync(`${out}/grep.wasm`).size };
}
if (fs.existsSync(`${out}/git-http.wasm`)) {
  programs["git-http"] = {
    applets: ["git-remote-http", "git-remote-https"],
    wasmBytes: fs.statSync(`${out}/git-http.wasm`).size,
  };
}
for (const name of ["diff", "diff3"]) {
  if (fs.existsSync(`${out}/${name}.wasm`)) {
    programs[name] = { applets: [name], wasmBytes: fs.statSync(`${out}/${name}.wasm`).size };
  }
}
if (fs.existsSync(`${out}/python.wasm`)) {
  programs.python = {
    applets: ["python3", "python"],
    wasmBytes: fs.statSync(`${out}/python.wasm`).size,
    directories: ["/usr/lib/python3.14/lib-dynload"],
    files: [{ source: "python314.zip", path: "/usr/lib/python314.zip",
              bytes: fs.statSync(`${out}/python314.zip`).size },
            { source: "python314-os.py", path: "/usr/lib/python3.14/os.py",
              bytes: fs.statSync(`${out}/python314-os.py`).size }],
  };
}
fs.writeFileSync(`${out}/manifest.json`, JSON.stringify({ version: 1, programs }, null, 2) + "\n");
console.log(`userland manifest: ${Object.keys(programs).join(", ")} (${Object.values(programs).reduce((n, p) => n + p.applets.length, 0)} commands)`);
' "${out}"
