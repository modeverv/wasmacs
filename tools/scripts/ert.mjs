// Run ERT tests in the Emacs that pages run: WebAssembly Emacs 30.2 under
// Node, from this checkout's published build (docs/), as the eval service
// runs it in a page.
//
//   node tools/scripts/ert.mjs [--root DIR] [-L DIR]... [-c FILE]... [-l FILE]... [--selector REGEXP]
//
// --root DIR    the project (default: the current directory), copied into
//               Emacs's in-memory filesystem as /project (its .el and
//               data files; not .git or node_modules)
// -L DIR        a directory of the project to put on load-path
// -c FILE       a file or feature to byte-compile (warnings are errors)
//               and load, as a page loads it
// -l FILE       a file or feature to load as it is (tests, say)
//               -c and -l are done in the order given, after -L
// --selector RE run only the tests whose names match
//
// Exits 0 when every test passed.  For example, elisp-react's tests:
//   node ../wasmacs/tools/scripts/ert.mjs -L lisp -L test -c react -c react-testing -l react-test -l react-testing-test
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { copyHostDirectory, docsArtifactDir, evalService, repoRoot } from "./lib/pdump-node-harness.mjs";

const args = process.argv.slice(2);
let root = process.cwd(), selector = null;
const paths = [], loads = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--root") root = resolve(args[++i]);
  else if (args[i] === "-L") paths.push(args[++i]);
  else if (args[i] === "-l") loads.push({ file: args[++i], compile: false });
  else if (args[i] === "-c") loads.push({ file: args[++i], compile: true });
  else if (args[i] === "--selector") selector = args[++i];
  else { console.error(`unknown argument ${args[i]}`); process.exit(2); }
}

const { service, info, emacs } = await evalService({ artifactDir: docsArtifactDir, appDir: `${repoRoot}docs/app/src` });
const skip = new Set([".git", "node_modules", ".DS_Store"]);
const copied = copyHostDirectory(emacs.Module.FS, root, "/project",
  (name, path) => !path.split("/").some((part) => skip.has(part)) && !name.endsWith(".elc") && readFileSync(path).length < 5e6);
const lisp = (text) => `"${String(text).replace(/[\\"]/g, "\\$&")}"`;
const run = (form) => {
  const reply = service.eval(form, { format: "lisp" });
  if (reply.output) process.stdout.write(reply.output);
  if (!reply.ok) { console.error(`${reply.error.symbol}: ${reply.error.message}`); process.exit(1); }
  return reply.value;
};
console.log(`Emacs ${info.version} (WebAssembly), ${copied} files of ${root} in /project`);
run(`(progn (setq default-directory "/project/")
  ${paths.map((dir) => `(push (expand-file-name ${lisp(dir)} "/project/") load-path)`).join("\n  ")}
  (require 'ert) nil)`);
for (const { file, compile } of loads) {
  run(`(let* ((name ${lisp(file)})
         (path (or (locate-file name load-path '(".el" ""))
                   (expand-file-name name "/project/"))))
    ${compile ? `(let ((byte-compile-error-on-warn t))
       (unless (byte-compile-file path) (error "%s does not compile" path)))
     (load (concat (file-name-sans-extension path) ".elc") nil t)` : "(load path nil t)"}
    nil)`);
}
const result = run(`(let ((stats (ert-run-tests-batch ${selector ? lisp(selector) : "t"})))
  (format "%d %d" (ert-stats-total stats) (ert-stats-completed-unexpected stats)))`);
const [total, failed] = JSON.parse(result).split(" ").map(Number);
console.log(`${total - failed} of ${total} tests passed in Emacs ${info.version} (WebAssembly)`);
process.exit(failed === 0 && total > 0 ? 0 : 1);
