// Process service probe: real Emacs (Atomics + pdump build) starting real
// subprocesses (busybox sh and tools, git) through the wasmacs kernel, under
// Node.  Needs the product build and the userland:
//
//   make build-artifacts            (or src/build/build-emacs-browser-atomics-pdump-profile.sh)
//   src/userland/build.sh
//   node tools/scripts/probe-process-service.mjs [filter]
//
// WASMACS_PROCESS_PROBE_BUNDLE=docs runs the same checks against the checked-in
// Pages bundle (docs/artifacts) instead of build/artifacts.
//
// The magit checks need magit and its dependencies as installed by package.el
// on this machine (WASMACS_ELPA_DIR, default ~/.emacs.d/elpa); they are
// skipped when the packages are not there.  Nothing is downloaded.
import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import v8 from "node:v8";
import vm from "node:vm";
import {
  batchEval,
  buildArtifactDir,
  buildUserlandDir,
  copyHostDirectory,
  docsArtifactDir,
  docsUserlandDir,
  interactiveSession,
  repoRoot,
} from "./lib/pdump-node-harness.mjs";

const useDocs = process.env.WASMACS_PROCESS_PROBE_BUNDLE === "docs";
const artifactDir = useDocs ? docsArtifactDir : buildArtifactDir;
const userlandDir = useDocs ? docsUserlandDir : buildUserlandDir;
const filter = process.argv[2] || "";
const logPath = `${repoRoot}logs/process-service-probe.txt`;
const boot = { artifactDir, userland: userlandDir };

for (const required of [`${artifactDir}/temacs.wasm`, `${userlandDir}/manifest.json`]) {
  if (!existsSync(required)) {
    console.error(`missing ${required}; build the product and the userland first (see the header of this file)`);
    process.exit(2);
  }
}

const lines = [`artifacts: ${artifactDir}`, `userland: ${userlandDir}`];
let failures = 0;
let ran = 0;
let skipped = 0;

function skip(name, why) {
  if (filter && !name.includes(filter)) return;
  skipped += 1;
  const line = `SKIP ${name}: ${why}`;
  lines.push(line);
  console.log(line);
}

async function check(name, fn) {
  if (filter && !name.includes(filter)) return;
  ran += 1;
  const t0 = performance.now();
  try {
    await fn();
    const line = `PASS ${name} (${Math.round(performance.now() - t0)}ms)`;
    lines.push(line);
    console.log(line);
  } catch (error) {
    failures += 1;
    const line = `FAIL ${name}: ${error && error.message ? error.message : error}`;
    lines.push(line);
    console.log(line);
  }
}

// Evaluate FORM in a fresh batch Emacs and compare its printed value.
async function expectValue(form, expected, options = {}) {
  const result = await batchEval(form, { ...boot, ...options });
  const actual = result.ok ? result.value : `ERROR ${result.value}`;
  const matches = expected instanceof RegExp ? expected.test(actual) : actual === expected;
  if (!matches) throw new Error(`\n   form:     ${form}\n   expected: ${expected}\n   actual:   ${actual}`);
}

// ---- synchronous processes -------------------------------------------------------

await check("call-process: exit status of true and false", () =>
  expectValue('(list (call-process "true") (call-process "false") (call-process "sh" nil nil nil "-c" "exit 42"))', "(0 1 42)"));

await check("call-process: output is inserted exactly", () =>
  expectValue('(with-temp-buffer (list (call-process "echo" nil t nil "hi" "there") (buffer-string)))', '(0 "hi there\n")'));

await check("call-process: 2 MB of output arrives complete (EOF)", () =>
  expectValue('(with-temp-buffer (list (call-process "sh" nil t nil "-c" "yes abcdefghi | head -c 2000000") (buffer-size)))', "(0 2000000)"));

await check("call-process-region: stdin from a buffer", () =>
  expectValue('(with-temp-buffer (insert "pear\\napple\\nfig\\n") (call-process-region (point-min) (point-max) "sort" t t) (buffer-string))', '"apple\nfig\npear\n"'));

await check("shell-command-to-string: pipeline through /bin/sh", () =>
  expectValue('(shell-command-to-string "echo abc | tr a-c A-C; echo rc=$?")', '"ABC\nrc=0\n"'));

await check("process-file honours default-directory", () =>
  expectValue('(let ((default-directory "/tmp/")) (with-temp-buffer (process-file "pwd" nil t) (buffer-string)))', '"/tmp\n"'));

await check("executable-find and exec-path see the userland", () =>
  expectValue('(list (executable-find "sh") (executable-find "git") (executable-find "grep") shell-file-name)', '("/bin/sh" "/bin/git" "/bin/grep" "/bin/sh")'));

await check("a missing program is a clear file-missing error", () =>
  expectValue('(condition-case err (call-process "no-such-program") (file-missing (list (car err) (cadr err))))', '(file-missing "Searching for program")'));

await check("signals are reported as the process status", () =>
  expectValue('(call-process "sh" nil nil nil "-c" "kill -TERM $$")', '"Terminated"'));

// ---- asynchronous processes ------------------------------------------------------

await check("make-process: filter, sentinel, send-string, send-eof", () =>
  expectValue('(let* ((out "") (events nil) (p (make-process :name "cat" :command (list "cat") :connection-type (quote pipe) :filter (lambda (_p s) (setq out (concat out s))) :sentinel (lambda (_p e) (push e events))))) (process-send-string p "one\\ntwo\\n") (accept-process-output p 1) (process-send-eof p) (while (process-live-p p) (accept-process-output p 0.1)) (list out events (process-status p) (process-exit-status p)))',
    '("one\ntwo\n" ("finished\n") exit 0)'));

await check("start-process asks for a pty and gets pipes", () =>
  expectValue('(let* ((process-connection-type t) (out "") (p (start-process "e" nil "echo" "piped"))) (set-process-filter p (lambda (_p s) (setq out (concat out s)))) (while (process-live-p p) (accept-process-output p 0.1)) (list (process-tty-name p) out (process-exit-status p)))',
    '(nil "piped\n" 0)'));

await check("kill-process and interrupt-process", () =>
  expectValue('(let* ((events nil) (p (make-process :name "s" :command (list "sleep" "60") :connection-type (quote pipe) :sentinel (lambda (_p e) (push e events)))) (q (make-process :name "t" :command (list "sleep" "60") :connection-type (quote pipe) :sentinel (lambda (_p e) (push e events))))) (accept-process-output nil 0.2) (kill-process p) (interrupt-process q) (while (or (process-live-p p) (process-live-p q)) (accept-process-output nil 0.1)) (list (sort events (function string<)) (process-status p) (process-status q)))',
    '(("interrupt\n" "killed\n") signal signal)'));

await check("accept-process-output and sleep-for really wait (no busy loop)", async () => {
  const t0 = process.cpuUsage();
  const w0 = performance.now();
  await expectValue('(let ((t0 (float-time))) (accept-process-output nil 0.4) (sleep-for 0.3) (< 0.65 (- (float-time) t0) 1.2))', "t");
  const cpuMs = (process.cpuUsage(t0).user + process.cpuUsage(t0).system) / 1000;
  const wallMs = performance.now() - w0;
  if (cpuMs > wallMs * 0.8) throw new Error(`busy loop: ${Math.round(cpuMs)}ms CPU in ${Math.round(wallMs)}ms`);
});

await check("a sleeping subprocess is woken by the kernel timer", () =>
  expectValue('(let* ((t0 (float-time)) (p (make-process :name "s" :command (list "sleep" "0.3") :connection-type (quote pipe)))) (while (process-live-p p) (accept-process-output p 1)) (list (process-exit-status p) (< 0.29 (- (float-time) t0) 1.0)))', "(0 t)"));

// ---- git --------------------------------------------------------------------------

const gitRepo = '(let ((default-directory "/home/user/repo/")) (make-directory default-directory t) (with-temp-buffer (list (process-file "git" nil t nil "init" "-q") (progn (write-region "hello\\n" nil "a.txt") (process-file "git" nil t nil "add" "a.txt")) (process-file "git" nil t nil "commit" "-q" "-m" "first") (progn (process-file "git" nil t nil "log" "--format=%s") (buffer-string)))))';
await check("git: init, add, commit, log from Emacs", () => expectValue(gitRepo, '(0 0 0 "first\n")'));

await check("vc-git: backend, state and working revision", () =>
  expectValue(`(progn ${gitRepo} (require (quote vc-git)) (let* ((file "/home/user/repo/a.txt") (default-directory (file-name-directory file))) (write-region "changed\\n" nil file) (list (vc-backend file) (vc-state file) (= 40 (length (vc-working-revision file))) (expand-file-name (vc-git-root file)))))`,
    '(Git edited t "/home/user/repo/")'));

await check("vc-git: diff of a modified file", () =>
  expectValue(`(progn ${gitRepo} (let ((default-directory "/home/user/repo/")) (write-region "changed\\n" nil "a.txt") (with-temp-buffer (process-file "git" nil t nil "diff" "--no-color" "--" "a.txt") (list (and (string-match-p "^-hello$" (buffer-string)) t) (and (string-match-p "^\\\\+changed$" (buffer-string)) t)))))`,
    "(t t)"));

// ---- eshell -----------------------------------------------------------------------

await check("eshell: external commands, pipelines between them and with Lisp commands", () =>
  expectValue('(progn (require (quote eshell)) (list (eshell-command-result "git --version") (eshell-command-result "*echo external") (eshell-command-result "echo abc | tr a-c A-C") (eshell-command-result "*cat /etc/shells | *wc -l") (string-to-number (eshell-command-result "ls /bin | wc -l"))))',
    /^\("git version 2\.[0-9.]+\n" "external\n" "ABC" "2\n" 1[0-9][0-9]\)$/));

await check("eshell: redirection, cd, a git repository", () =>
  expectValue('(progn (require (quote eshell)) (list (eshell-command-result "echo redirected > /tmp/e.txt") (eshell-command-result "*cat /tmp/e.txt") (eshell-command-result "cd /tmp; pwd") (eshell-command-result "git init -q /tmp/r; cd /tmp/r; git status --short --branch")))',
    '(nil "redirected\n" "/tmp" "## No commits yet on main\n")'));

// ---- grep -------------------------------------------------------------------------

// A small project to search.
const grepProject = {
  prepare(emacs) {
    emacs.FS.mkdirTree("/home/user/proj/sub");
    emacs.FS.writeFile("/home/user/proj/a.txt", "alpha\nbeta gamma\nBETA\n");
    emacs.FS.writeFile("/home/user/proj/sub/b.el", "(defun beta-fn () 1)\n;; alpha\n");
    emacs.FS.writeFile("/home/user/proj/sub/c.o", "beta\0binary\n");
  },
};
// Wait for the *grep* buffer's process and return its text with the header
// and footer lines (dates, durations) removed.
const grepOutput = String.raw`(with-current-buffer "*grep*" (while (get-buffer-process (current-buffer)) (accept-process-output nil 0.05)) (let ((lines (split-string (buffer-substring-no-properties (point-min) (point-max)) "\n" t))) (seq-remove (lambda (l) (string-match-p "^\\(-\\*- \\|Grep \\|find \\|grep \\)" l)) lines)))`;

await check("grep: Emacs finds GNU grep and computes its usual defaults", () =>
  expectValue('(progn (require (quote grep)) (grep-compute-defaults) (list grep-command grep-template grep-find-template grep-use-null-device grep-use-null-filename-separator grep-find-use-xargs))',
    String.raw`("grep --color=always -nH --null -e " "grep <X> <C> -nH --null -e <R> <F>" "find -H <D> <X> -type f <F> -exec grep <C> -nH --null -e <R> \\{\\} +" nil t exec-plus)`));

await check("M-x grep: hits, highlighted matches, next-error", () =>
  expectValue(`(progn (require (quote grep)) (grep-compute-defaults) (let ((default-directory "/home/user/proj/")) (grep (concat grep-command "beta a.txt")) (list ${grepOutput} (with-current-buffer "*grep*" (and (text-property-any (point-min) (point-max) (quote font-lock-face) grep-match-face) t)) (progn (next-error) (with-current-buffer (window-buffer) (list (buffer-name) (line-number-at-pos) (current-column)))))))`,
    '(("a.txt\x002:beta gamma") t ("a.txt" 2 0))', grepProject));

await check("M-x rgrep: find + grep over a tree, ignoring object files", () =>
  expectValue(`(progn (require (quote grep)) (grep-compute-defaults) (let ((default-directory "/home/user/proj/")) (rgrep "beta" "*" "/home/user/proj/") (sort ${grepOutput} (function string<))))`,
    '("./a.txt\x002:beta gamma" "./a.txt\x003:BETA" "./sub/b.el\x001:(defun beta-fn () 1)")', grepProject));

await check("M-x lgrep: --exclude and --directories=skip", () =>
  expectValue(`(progn (require (quote grep)) (grep-compute-defaults) (let ((default-directory "/home/user/proj/")) (lgrep "alpha" "*" "/home/user/proj/") ${grepOutput}))`,
    '("a.txt\x001:alpha")', grepProject));

await check("xref / project search: xargs -0 grep --null", () =>
  expectValue('(progn (require (quote xref)) (let ((default-directory "/home/user/proj/") (hit (lambda (x) (list (file-relative-name (xref-location-group (xref-item-location x))) (xref-location-line (xref-item-location x)) (substring-no-properties (xref-item-summary x)))))) (list (mapcar hit (xref-matches-in-files "beta" (list "/home/user/proj/a.txt" "/home/user/proj/sub/b.el"))) (sort (mapcar hit (xref-matches-in-directory "alpha" "*" "/home/user/proj/" nil)) (lambda (a b) (string< (car a) (car b)))))))',
    '((("a.txt" 2 "beta gamma") ("a.txt" 3 "BETA") ("sub/b.el" 1 "(defun beta-fn () 1)")) (("a.txt" 1 "alpha") ("sub/b.el" 2 ";; alpha")))', grepProject));

// ---- magit ------------------------------------------------------------------------

const elpaDir = process.env.WASMACS_ELPA_DIR || `${homedir()}/.emacs.d/elpa`;
const magitPackages = ["compat", "cond-let", "llama", "transient", "with-editor", "magit-section", "magit"];
function findMagitPackages() {
  if (!existsSync(elpaDir)) return null;
  const names = readdirSync(elpaDir);
  const found = [];
  for (const pkg of magitPackages) {
    const dir = names.filter((name) => new RegExp(`^${pkg}-[0-9][0-9.]*$`).test(name)).sort().pop();
    if (!dir) return null;
    found.push(dir);
  }
  return found;
}
const magitDirs = findMagitPackages();
// Install the packages the way package.el leaves them (sources only: the
// byte code on the host may be from another Emacs version).
const magit = {
  prepare(emacs) {
    for (const dir of magitDirs) {
      copyHostDirectory(emacs.FS, `${elpaDir}/${dir}`, `/home/user/.emacs.d/elpa/${dir}`, (name) => name.endsWith(".el"));
    }
  },
};
const magitInit = '(progn (setq package-user-dir "/home/user/.emacs.d/elpa") (package-initialize))';
const magitRepo = '(let ((default-directory "/home/user/repo/")) (make-directory default-directory t) (process-file "git" nil nil nil "init" "-q") (write-region "hello\n" nil "a.txt") (write-region "keep\n" nil "b.txt") (process-file "git" nil nil nil "add" ".") (process-file "git" nil nil nil "commit" "-q" "-m" "first") (write-region "changed\n" nil "a.txt") (write-region "new\n" nil "c.txt"))';
const magitWait = '(let ((n 0)) (while (and (< n 400) magit-this-process (process-live-p magit-this-process)) (accept-process-output nil 0.05) (setq n (1+ n))))';

if (!magitDirs) {
  for (const name of ["magit: status buffer", "magit: stage and commit", "magit: commit message edited in Emacs (with-editor)", "magit: status, stage, commit by keys"]) {
    skip(name, `magit and its dependencies were not found in ${elpaDir}`);
  }
} else {
  // Regexps (Emacs syntax) the status buffer has to match.
  const statusLines = String.raw`(list "^Head: +main first$" "^Untracked files (1)$" "^Unstaged changes (1)$" "^modified +a\\.txt$" "^-hello$" "^\\+changed$" "^Recent commits$")`;
  await check("magit: status buffer", () =>
    expectValue(`(progn ${magitInit} ${magitRepo} (let ((default-directory "/home/user/repo/")) (magit-status-setup-buffer default-directory) (with-current-buffer (magit-get-mode-buffer (quote magit-status-mode)) (let ((text (buffer-substring-no-properties (point-min) (point-max)))) (mapcar (lambda (re) (and (string-match-p re text) t)) ${statusLines})))))`,
      "(t t t t t t t)", magit));

  await check("magit: stage and commit", () =>
    expectValue(`(progn ${magitInit} ${magitRepo} (let ((default-directory "/home/user/repo/")) (magit-stage-files (list "a.txt" "c.txt")) (list (magit-git-lines "diff" "--cached" "--name-only") (progn (magit-run-git-async "commit" "-m" "second from magit") ${magitWait} (magit-git-lines "log" "--format=%s")) (magit-git-lines "status" "--porcelain"))))`,
      '(("a.txt" "c.txt") ("second from magit" "first") nil)', magit));

  // git runs $GIT_EDITOR: with-editor's shell one-liner announces the file on
  // its stdout and sleeps until Emacs signals it (USR1 = done).
  await check("magit: commit message edited in Emacs (with-editor)", () =>
    expectValue(`(progn ${magitInit} ${magitRepo} (let ((default-directory "/home/user/repo/")) (magit-stage-files (list "a.txt")) (magit-commit-create nil) (let ((n 0)) (while (and (< n 200) (not (get-buffer "COMMIT_EDITMSG"))) (accept-process-output nil 0.05) (setq n (1+ n)))) (with-current-buffer "COMMIT_EDITMSG" (goto-char (point-min)) (insert "written in the commit buffer\n") (with-editor-finish nil)) ${magitWait} (list (magit-git-lines "log" "--format=%s") (magit-git-lines "diff" "--cached" "--name-only") (length (process-list)))))`,
      '(("written in the commit buffer" "first") nil 0)', magit));
}

// ---- interactive: the real command loop -----------------------------------------------

// What the filter and sentinel of a test process recorded (they append to a
// file, which is more reliable to check than incremental redisplay output).
const recorded = (emacs, path = "/tmp/probe.log") => {
  try { return emacs.FS.readFile(path, { encoding: "utf8" }); } catch { return ""; }
};

await check("idle Emacs runs filters and sentinels (no accept-process-output)", async () => {
  const session = await interactiveSession({
    ...boot,
    evals: ['(make-process :name "idle" :command (list "sh" "-c" "sleep 0.2; echo idle-output") :connection-type (quote pipe) :filter (lambda (_p s) (write-region (concat "FILTER " s) nil "/tmp/probe.log" t (quote silent))) :sentinel (lambda (_p e) (write-region (concat "SENTINEL " e) nil "/tmp/probe.log" t (quote silent))))'],
    steps: [
      { name: "filter and sentinel ran while idle", expect: (_f, _a, emacs) => recorded(emacs) === "FILTER idle-output\nSENTINEL finished\n", send: "\x18\x03" },
    ],
  });
  if (!session.completed) throw new Error(`stuck at "${session.failure?.step}": ${JSON.stringify(recorded(session.emacs))}`);
});

await check("M-x shell: prompt, commands, git, C-c C-c, exit", async () => {
  const session = await interactiveSession({
    ...boot,
    steps: [
      { name: "emacs is up", expect: /\*scratch\*/, send: "\x1bxshell\r" },
      { name: "shell prompt", expect: /[#$] /, send: "echo answer-$((6 * 7))\r" },
      { name: "command output", expect: /answer-42/, send: "cd /tmp && pwd\r" },
      { name: "cd in the shell", expect: /\/tmp\r?\n?/, send: "git --version\r" },
      { name: "git runs from the shell", expect: /git version 2\./, send: "ls /bin | wc -l\r" },
      { name: "pipeline", expect: /1[0-9][0-9]/, send: "sleep 100\r" },
      { name: "sleep is running", expect: /sleep 100/, send: "\x03\x03" },
      { name: "C-c C-c interrupts the job", expect: /[#$] /, send: "echo back-at-prompt\r" },
      { name: "shell survived", expect: /back-at-prompt/, send: "exit\r" },
      { name: "shell exited", expect: /Process shell finished/, send: "\x18\x03" },
    ],
  });
  if (!session.completed) throw new Error(`stuck at "${session.failure?.step}": ${JSON.stringify(session.failure?.tail)}`);
});

await check("C-g interrupts a blocking call-process", async () => {
  const blocked = (_f, _a, emacs) => (emacs.kernel()?.liveCount() ?? 0) > 0;
  const session = await interactiveSession({
    ...boot,
    steps: [
      // M-: runs the form as a command, where quitting is allowed.
      { name: "emacs is up", expect: /\*scratch\*/, send: '\x1b:(progn (call-process "sleep" nil nil nil "30") (write-region "RETURNED" nil "/tmp/probe.log"))\r' },
      // Emacs is now blocked inside call-process; its only way out is C-g.
      { name: "blocked in call-process", expect: blocked, send: "\x07" },
      { name: "quit, child killed, prompt back", expect: (fresh, _a, emacs) => /Quit/.test(fresh) && !blocked(null, null, emacs), send: "\x18\x03" },
    ],
  });
  if (!session.completed) throw new Error(`stuck at "${session.failure?.step}": ${JSON.stringify(session.failure?.tail?.slice(-200))}`);
  if (recorded(session.emacs) !== "") throw new Error("call-process returned normally instead of quitting");
});

await check("M-x eshell: external command, pipeline, C-c C-c", async () => {
  const running = (_f, _a, emacs) => (emacs.kernel()?.liveCount() ?? 0) > 0;
  const session = await interactiveSession({
    ...boot,
    steps: [
      { name: "emacs is up", expect: /\*scratch\*/, send: "\x1bxeshell\r" },
      { name: "eshell prompt", expect: /[#$] /, send: "git --version\r" },
      { name: "external command", expect: /git version 2\./, send: "ls /bin | wc -l\r" },
      { name: "pipeline", expect: /1[0-9][0-9]/, send: "sleep 100\r" },
      { name: "sleep is running", expect: running, send: "\x03\x03" },
      { name: "C-c C-c interrupts it", expect: (_f, _a, emacs) => !running(null, null, emacs), send: "echo back-at-prompt > /tmp/probe.log\r" },
      { name: "eshell survived", expect: (_f, _a, emacs) => recorded(emacs).trim() === "back-at-prompt", send: "\x18\x03" },
    ],
  });
  if (!session.completed) throw new Error(`stuck at "${session.failure?.step}": ${JSON.stringify(session.failure?.tail)} (recorded ${JSON.stringify(recorded(session.emacs))})`);
});

// In the browser Emacs never returns to the worker's event loop: no microtask,
// promise reaction or timer callback ever runs.  Anything a process leaves in
// such a queue, or registered in the shared filesystem, is never freed, and
// every process brings a 16 MB wasm memory.  Measured from inside Emacs's
// idle wait, i.e. in exactly that state.
await check("hundreds of processes while Emacs never yields: nothing is retained", async () => {
  v8.setFlagsFromString("--expose-gc");
  const collectGarbage = vm.runInNewContext("gc");
  const heapNow = () => { collectGarbage(); collectGarbage(); return process.memoryUsage().heapUsed; };
  const exits = (emacs) => emacs.kernel()?.stats.exits ?? 0;
  const batch = (count) => `\x1b:(progn (dotimes (_ ${count}) (call-process "git" nil nil nil "--version")) (call-process "sh" nil nil nil "-c" "i=0; while [ $i -lt ${count} ]; do git --version > /dev/null; i=$((i + 1)); done"))\r`;
  let before = 0, after = 0;
  const session = await interactiveSession({
    ...boot,
    timeoutMs: 60000,
    steps: [
      { name: "emacs is up", expect: /\*scratch\*/, send: batch(20) },
      { name: "warm-up done", expect: (_f, _a, emacs) => exits(emacs) >= 41 && ((before = heapNow()), true), send: batch(300) },
      { name: "600 more processes done", expect: (_f, _a, emacs) => exits(emacs) >= 642 && ((after = heapNow()), true), send: "\x18\x03" },
    ],
  });
  if (!session.completed) throw new Error(`stuck at "${session.failure?.step}": ${JSON.stringify(session.failure?.tail?.slice(-200))}`);
  const growth = after - before;
  if (growth > 8 * 1024 * 1024) throw new Error(`heap grew by ${(growth / 1e6).toFixed(1)} MB over 900 process images`);
});

if (magitDirs) {
  await check("magit: status, stage, commit by keys", async () => {
    const session = await interactiveSession({
      ...boot,
      ...magit,
      timeoutMs: 30000,
      evals: [magitInit, magitRepo, '(find-file "/home/user/repo/a.txt")'],
      steps: [
        { name: "emacs is up", expect: /a\.txt/, send: "\x1bxmagit-status\r" },
        // S stages all changes to tracked files.
        { name: "status buffer", expect: /Unstaged changes/, send: "S" },
        // c c starts the commit; git then waits for the editor.
        { name: "staged", expect: /Staged changes/, send: "cc" },
        { name: "commit message buffer", expect: /COMMIT_EDITMSG/, send: "typed in the browser\x03\x03" },
        { name: "committed", expect: (_f, all) => /typed in the browser/.test(all.slice(-4000)) && !/COMMIT_EDITMSG.*$/.test(all.slice(-300)),
          send: '\x1b:(write-region (mapconcat (function identity) (magit-git-lines "log" "--format=%s") ",") nil "/tmp/probe.log")\r' },
        { name: "log written", expect: (_f, _a, emacs) => recorded(emacs) !== "", send: "\x18\x03" },
      ],
    });
    if (!session.completed) throw new Error(`stuck at "${session.failure?.step}": ${JSON.stringify(session.failure?.tail?.slice(-300))}`);
    const log = recorded(session.emacs);
    if (log !== "typed in the browser,first") throw new Error(`unexpected git log: ${JSON.stringify(log)}`);
  });
}

lines.push(`${ran - failures}/${ran} process service checks passed${skipped ? `, ${skipped} skipped` : ""}`);
await mkdir(`${repoRoot}logs`, { recursive: true });
await writeFile(logPath, `${lines.join("\n")}\n`);
console.log(`\n${ran - failures}/${ran} process service checks passed${skipped ? `, ${skipped} skipped` : ""} — see ${logPath}`);
process.exitCode = failures ? 1 : 0;
