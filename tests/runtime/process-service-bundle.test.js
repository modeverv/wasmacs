// The checked-in Pages bundle (docs/artifacts) is deployed as it is, without
// a rebuild.  Boot it under Node and let Emacs start real subprocesses, so
// that a bundle whose Emacs, process kernel and userland do not fit together
// cannot be published.  (The full suites are `npm run test:process`.)
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  batchEval,
  initSession,
  docsArtifactDir,
  docsUserlandDir,
  repoRoot,
} from "../../tools/scripts/lib/pdump-node-harness.mjs";

const haveEmacs = existsSync(`${docsArtifactDir}/temacs.wasm`);
const haveUserland = existsSync(`${docsUserlandDir}/manifest.json`);
const skip = !(haveEmacs && haveUserland) && "docs/artifacts has no Emacs build with a process userland";

test("Pages bundle: every program of the userland manifest is published", { skip }, () => {
  const manifest = JSON.parse(readFileSync(`${docsUserlandDir}/manifest.json`, "utf8"));
  assert.deepEqual(Object.keys(manifest.programs).sort(), ["busybox", "diff", "diff3", "git", "git-http", "grep", "python"]);
  assert.deepEqual(manifest.programs["git-http"].applets, ["git-remote-http", "git-remote-https"]);
  for (const [name, program] of Object.entries(manifest.programs)) {
    assert.equal(existsSync(`${docsUserlandDir}/${name}.js`), true, `${name}.js`);
    assert.equal(existsSync(`${docsUserlandDir}/${name}.wasm`), true, `${name}.wasm`);
    assert.equal(program.applets.length > 0, true, `${name} provides no command`);
    for (const file of program.files || []) {
      assert.equal(readFileSync(`${docsUserlandDir}/${file.source}`).length, file.bytes, `${file.source} size`);
    }
  }
  // The standalone shell must find the GNU programs through PATH.
  assert.equal(manifest.programs.busybox.applets.includes("grep"), false);
  assert.equal(manifest.programs.busybox.applets.includes("diff"), false);
  assert.deepEqual(manifest.programs.diff.applets, ["diff"]);
  assert.deepEqual(manifest.programs.diff3.applets, ["diff3"]);
  assert.deepEqual(manifest.programs.python.applets, ["python3", "python"]);
  assert.equal(manifest.programs.busybox.applets.includes("sh"), true);
  assert.equal(
    readFileSync(`${docsUserlandDir}/wasmacs-userland.js`, "utf8"),
    readFileSync(`${repoRoot}src/runtime/process/wasmacs-userland.js`, "utf8"),
    "docs/artifacts/userland/wasmacs-userland.js is stale; run src/userland/build.sh and npm run build",
  );
});

test("Pages bundle: Emacs runs sh, git and grep as subprocesses", { skip }, async () => {
  const form = `(let ((default-directory "/home/user/repo/"))
    (make-directory default-directory t)
    (list
     (shell-command-to-string "echo abc | tr a-c A-C; echo rc=$?")
     (with-temp-buffer
       (list (process-file "git" nil t nil "init" "-q")
             (progn (write-region "needle\\n" nil "a.txt") (process-file "git" nil t nil "add" "a.txt"))
             (process-file "git" nil t nil "commit" "-q" "-m" "first")
             (progn (process-file "git" nil t nil "log" "--format=%s") (buffer-string))))
     (with-temp-buffer
       (list (process-file "grep" nil t nil "-nH" "--null" "-e" "needle" "a.txt") (buffer-string)))
     (call-process "false")
     (let* ((out "") (p (make-process :name "cat" :command (list "cat") :connection-type (quote pipe)
                                      :filter (lambda (_p s) (setq out (concat out s))))))
       (process-send-string p "through a pipe\\n")
       (process-send-eof p)
       (while (process-live-p p) (accept-process-output p 0.1))
       (list out (process-exit-status p)))))`;
  const result = await batchEval(form, { artifactDir: docsArtifactDir, userland: docsUserlandDir });
  assert.equal(result.ok, true, `Emacs signalled ${result.value}; stderr: ${result.stderr.slice(-5).join(" | ")}`);
  assert.equal(
    result.value,
    '("ABC\nrc=0\n" (0 0 0 "first\n") (0 "a.txt\x001:needle\n") 1 ("through a pipe\n" 0))',
  );
});

test("Pages bundle: the kernel boots without Emacs and runs sh as pid 1", { skip }, async () => {
  for (const name of ["wasmacs-kernel.js", "wasmacs-boot.js", "wasmacs-base.js", "wasmacs-base.wasm"]) {
    assert.equal(existsSync(`${docsUserlandDir}/${name}`), true, `docs/artifacts/userland/${name} is not published`);
  }
  const session = await initSession({
    userland: docsUserlandDir,
    argv: ["/bin/sh"],
    chunks: ["echo pid=$$ ppid=$PPID; tty; git --version; echo abc | tr a-c A-C; exit 3\n"],
  });
  assert.match(session.text, /^pid=1 ppid=0$/m);
  assert.match(session.text, /^\/dev\/pts\/0$/m);
  assert.match(session.text, /^git version 2\./m);
  assert.match(session.text, /^ABC$/m);
  assert.equal(session.code, 3);
  assert.equal(session.kernel.liveCount(), 0);
});
