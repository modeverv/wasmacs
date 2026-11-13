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
