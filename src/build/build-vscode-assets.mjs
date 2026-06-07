import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const wasmSource = join(repoRoot, "src", "wasm");
const vscodeRoot = join(repoRoot, "vscode");
const vscodeApp = join(vscodeRoot, "app");

await mkdir(vscodeRoot, { recursive: true });
await rm(vscodeApp, { recursive: true, force: true });
await cp(wasmSource, vscodeApp, { recursive: true });

console.log("Built VS Code webview app bundle.");
