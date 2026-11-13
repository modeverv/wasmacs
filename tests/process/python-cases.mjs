// Real CPython programs, shared by the Node and browser product probes.
const lispString = JSON.stringify;
const capture = (code) => `(with-temp-buffer (list (call-process "python3" nil t nil "-c" ${lispString(code)}) (buffer-string)))`;

export const pythonCommands = {
  calculation: "print('python-calc-' + str(6 * 7))",
  multilineResult: "print('python-multi-' + str(triple(7)))",
  json: "import json; print('python-json-' + str(json.loads('{\"answer\": 42}')['answer']))",
  file: "from pathlib import Path; p = Path('/home/user/python-repl.txt'); p.write_text('shared-file\\n', encoding='utf-8'); print('python-file-' + p.read_text().strip())",
  recovery: "loop_iterations = 0; print('python-recovered-' + str(20 + 22))",
  afterInterrupt: "print('python-interrupt-recovered-' + str(40 + 2) + '-loop-' + str(loop_iterations > 0))",
};

export const pythonBatchCases = [
  {
    name: "python3 and python resolve to CPython through the shell",
    form: `(list (executable-find "python3") (executable-find "python")
      (shell-command-to-string "python3 --version") (shell-command-to-string "python --version"))`,
    expected: /^\("\/bin\/python3" "\/bin\/python" "Python 3\.14\.[0-9]+\n" "Python 3\.14\.[0-9]+\n"\)$/,
  },
  {
    name: "calculation and json/math standard-library imports",
    form: capture("import json, math; print(json.dumps({'answer': 6 * 7, 'root': math.isqrt(81)}, sort_keys=True))"),
    expected: '(0 "{\\"answer\\": 42, \\"root\\": 9}\n")',
  },
  {
    name: "a Python script shares UTF-8 files with Emacs",
    form: `(progn
      (write-region ${lispString("from pathlib import Path\np = Path('/home/user/python-file.txt')\np.write_text('hello \\u65e5\\u672c\\u8a9e\\n', encoding='utf-8')\nprint(p.read_text(encoding='utf-8'), end='')\n")} nil "/tmp/python-file.py" nil 'silent)
      (list (with-temp-buffer (list (call-process "python3" nil t nil "/tmp/python-file.py") (buffer-string)))
        (with-temp-buffer (insert-file-contents "/home/user/python-file.txt") (buffer-string))))`,
    expected: '((0 "hello 日本語\n") "hello 日本語\n")',
  },
  {
    name: "stdin, arguments and working directory use the Process Service",
    form: `(let ((default-directory "/tmp/")) (with-temp-buffer (insert "input-line\\n")
      (list (call-process-region (point-min) (point-max) "python3" t t nil "-c"
        ${lispString("import os, sys; print(os.getcwd(), '|'.join(sys.argv[1:]), sys.stdin.read().strip(), sep=';')")} "two words" "last") (buffer-string))))`,
    expected: '(0 "/tmp;two words|last;input-line\n")',
  },
  {
    name: "exceptions and explicit exit codes do not poison the next process",
    form: `(list
      (with-temp-buffer (let ((status (call-process "python3" nil t nil "-c" "raise ValueError('probe-error')")))
        (list status (and (string-match-p "ValueError: probe-error" (buffer-string)) t))))
      (call-process "python3" nil nil nil "-c" "import sys; sys.exit(7)")
      ${capture("print(6 * 7)")})`,
    expected: '((1 t) 7 (0 "42\n"))',
  },
  {
    name: "subprocess.run: output, exit status, stdin, check, cwd, env and shell",
    form: capture(String.raw`import subprocess as sp
r = sp.run(["git", "--version"], capture_output=True, text=True)
print(r.returncode, r.stdout.strip(), len(r.stderr))
r = sp.run(["sh", "-c", "echo err >&2; exit 3"], capture_output=True, text=True)
print(r.returncode, repr(r.stdout), r.stderr.strip())
print(sp.run(["tr", "a-z", "A-Z"], input="hello\n", capture_output=True, text=True).stdout, end="")
try:
    sp.run(["false"], check=True)
except sp.CalledProcessError as e:
    print("check", e.returncode)
print(sp.run(["pwd"], cwd="/tmp", capture_output=True, text=True).stdout, end="")
print(sp.run(["sh", "-c", "echo $FOO"], env={"FOO": "bar", "PATH": "/bin"}, capture_output=True, text=True).stdout, end="")
print(sp.run("echo a b | wc -w", shell=True, capture_output=True, text=True).stdout.strip())
try:
    sp.run(["no-such-program"])
except FileNotFoundError:
    print("FileNotFoundError")
`),
    expected: /^\(0 "0 git version 2\.[0-9.]+ 0\n3 '' err\nHELLO\ncheck 1\n\/tmp\nbar\n2\nFileNotFoundError\n"\)$/,
  },
  {
    name: "subprocess.Popen: streaming, pipelines, timeout, terminate; no child left behind",
    form: capture(String.raw`import os, subprocess as sp
p = sp.Popen(["sh", "-c", "for i in 1 2 3; do echo line$i; sleep 0.05; done"], stdout=sp.PIPE, text=True)
print([line.strip() for line in p.stdout], p.wait())
p1 = sp.Popen(["printf", "%s\n%s\n%s\n", "b", "a", "c"], stdout=sp.PIPE)
p2 = sp.Popen(["sort"], stdin=p1.stdout, stdout=sp.PIPE, text=True)
p1.stdout.close()
print(p2.communicate()[0].split(), p1.wait())
try:
    sp.run(["sleep", "5"], timeout=0.3)
except sp.TimeoutExpired:
    print("timeout")
p = sp.Popen(["sleep", "30"])
p.terminate()
print("terminate", p.wait())
with os.popen("echo via-popen") as f:
    print("system", os.system("exit 5") >> 8, f.read().strip())
try:
    os.waitpid(-1, os.WNOHANG)
except ChildProcessError:
    print("no children left")
`),
    expected: `(0 "['line1', 'line2', 'line3'] 0\n['a', 'b', 'c'] 0\ntimeout\nterminate -15\nsystem 5 via-popen\nno children left\n")`,
  },
  {
    // What M-x term runs it on: a pseudoterminal is stdin, stdout and stderr.
    name: "a script on a pseudoterminal: os.listdir, subprocess.run, isatty",
    form: `(progn
      (write-region ${lispString('import os\nprint(os.listdir("/"))\n\nimport subprocess\nprint(subprocess.run(["git", "--version"], capture_output=True, text=True))\n\nimport sys\nprint(sys.stdin.isatty())\n')} nil "/tmp/python-pty.py" nil 'silent)
      (let* ((process-connection-type t) (out "")
             (p (start-process "python-pty" nil "python3" "/tmp/python-pty.py")))
        (set-process-filter p (lambda (_p s) (setq out (concat out s))))
        (while (process-live-p p) (accept-process-output p 0.1))
        (accept-process-output nil 0.2)
        (list (process-tty-name p) out (process-exit-status p))))`,
    expected: /^\("\/dev\/pts\/[0-9]+" "\[[^\]]*'bin'[^\]]*\]\nCompletedProcess\(args=\['git', '--version'\], returncode=0, stdout='git version 2\.[0-9.]+\\\\n', stderr=''\)\nTrue\n" 0\)$/,
  },
];

// Each expect sees only output since the preceding step, so a previous prompt
// cannot make a missing new prompt pass. Keys use real inferior-python bindings.
export function pythonReplSteps({ onCpuLoop }) {
  let loopStarted = false;
  return [
    { name: "start M-x run-python", expect: /\*scratch\*/, send: "\x1bxrun-python\r" },
    { name: "CPython REPL prompt", expect: />>>/, send: `${pythonCommands.calculation}\r` },
    { name: "calculation result", expect: /python-calc-42/, send: "def triple(n):\r" },
    { name: "multiline continuation prompt", expect: /\.\.\./, send: "    return n * 3\r" },
    { name: "multiline body accepted", expect: /\.\.\./, send: "\r" },
    { name: "definition returns to primary prompt", expect: />>>/, send: `${pythonCommands.multilineResult}\r` },
    { name: "multiline function result", expect: /python-multi-21/, send: `${pythonCommands.json}\r` },
    { name: "json import result", expect: /python-json-42/, send: `${pythonCommands.file}\r` },
    { name: "shared file readback", expect: /python-file-shared-file/, send: "1 / 0\r" },
    { name: "exception traceback", expect: /ZeroDivisionError/, send: `${pythonCommands.recovery}\r` },
    { name: "REPL continues after exception", expect: /python-recovered-42/, send: "while True: loop_iterations += 1\r" },
    { name: "infinite loop continuation", expect(text) {
      if (!/\.\.\./.test(text)) return false;
      if (!loopStarted) { loopStarted = true; onCpuLoop(); }
      return true;
    }, send: "\r" },
    { name: "KeyboardInterrupt traceback", expect: /KeyboardInterrupt/, send: `${pythonCommands.afterInterrupt}\r` },
    { name: "same REPL continues after interrupting a running loop", expect: /python-interrupt-recovered-42-loop-True/, send: "exit()\r" },
    // CPython preserves the unhandled KeyboardInterrupt flag until shutdown:
    // even after subsequent successful commands, native exit() exits via SIGINT.
    { name: "Python exits with its native post-KeyboardInterrupt status", expect: /Process .* interrupt/, send: '\x1b:(message "python-cleanup-%d" (length (process-list)))\r' },
    { name: "no live Emacs processes", expect: /python-cleanup-0/, send: "\x18\x03" },
  ];
}
