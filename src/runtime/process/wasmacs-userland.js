/*
 * wasmacs-userland.js -- how the userland programs appear in the filesystem.
 *
 * The userland is a set of program images built by src/userland/build.sh into
 * build/artifacts/userland: <program>.js + <program>.wasm, described by
 * manifest.json.  A program image is not stored in the Emacs filesystem.  What
 * Emacs and the shell see is a small executable marker file per command,
 *
 *     /bin/ls:   <DEL>wasmacs-exec busybox
 *
 * and the process kernel (wasmacs-kernel.js) loads the named image from the
 * host when such a file is executed.  BusyBox is one multicall image: every
 * applet gets its own marker and is selected by argv[0].  The marker starts
 * with a DEL byte (like an ELF header) rather than "#!", so that nothing
 * mistakes it for a script: eshell, for one, reads "#!" lines itself and
 * would try to run "wasmacs-exec" as the interpreter.
 *
 * This file is plain JS shared by the browser worker (importScripts) and the
 * Node test harnesses (vm); it has no dependencies.
 */
(function (root) {
  'use strict';

  const BIN_DIR = '/bin';
  // Must match EXEC_MAGIC in wasmacs-kernel.js.
  const marker = (program) => `\x7fwasmacs-exec ${program}\n`;

  // System configuration of the little OS.  /etc is rebuilt at every boot;
  // only /home/user is persistent.
  const ETC_FILES = {
    '/etc/passwd': 'root:x:0:0:wasmacs user:/home/user:/bin/sh\n',
    '/etc/group': 'root:x:0:\n',
    '/etc/shells': '/bin/sh\n/bin/ash\n',
    // Defaults that fit a browser tab; `git config --global` (stored in
    // /home/user/.gitconfig, which is persistent) overrides them.
    '/etc/gitconfig': [
      '[user]',
      '\tname = wasmacs user',
      '\temail = user@wasmacs.invalid',
      '[init]',
      '\tdefaultBranch = main',
      '[core]',
      '\tpager = cat',
      '\teditor = true',
      '[color]',
      '\tui = false',
      '[advice]',
      '\tdetachedHead = false',
      '[maintenance]',
      '\tauto = false',
      '[gc]',
      '\tauto = 0',
      '',
    ].join('\n'),
  };

  // Commands that are shell scripts.  A script is installed only if no
  // program image provides the command and everything it runs exists.
  const SCRIPTS = {
    egrep: { needs: ['sh', 'grep'], text: '#!/bin/sh\nexec grep -E "$@"\n' },
    fgrep: { needs: ['sh', 'grep'], text: '#!/bin/sh\nexec grep -F "$@"\n' },
  };

  // Environment variables the processes (and Emacs's exec-path) rely on.
  const ENVIRONMENT = {
    PATH: '/bin:/usr/bin',
    SHELL: '/bin/sh',
  };

  // Emacs settings that follow from how processes work here.  The worker
  // (and the test harness) evaluates them at startup when the userland is
  // installed.
  const EMACS_SETTINGS = [
    // Pipes unless a command asks for a terminal: M-x shell, compile,
    // run-python and magit keep the pipes they are tested with, while M-x
    // term and ansi-term bind this to t and get a pseudoterminal.
    '(setq process-connection-type nil)',
    // "grep --color=auto" colours terminal output only, and a pipe is not a
    // terminal: M-x grep would never highlight its matches.
    "(setq grep-highlight-matches 'always)",
    // No emacsclient can exist (no sockets).  with-editor, which magit uses
    // for commit messages, then falls back to its "sleeping editor" (a shell
    // one-liner that Emacs wakes up with a signal); telling it up front
    // skips the search for an emacsclient and the warning about it.
    '(setq with-editor-emacsclient-executable nil)',
  ];

  // [{ path, program }] for every command of the manifest.
  function commands(manifest) {
    const out = [];
    const programs = (manifest && manifest.programs) || {};
    for (const program of Object.keys(programs)) {
      for (const applet of programs[program].applets || [program]) {
        out.push({ path: `${BIN_DIR}/${applet}`, program });
      }
    }
    return out;
  }

  function mkdirp(FS, dir) {
    let path = '';
    for (const part of dir.split('/').filter(Boolean)) {
      path += '/' + part;
      try { FS.mkdir(path); } catch (e) { /* exists */ }
    }
  }

  // Create the marker files and /etc in an Emscripten FS.  Returns the number
  // of commands installed.
  function install(FS, manifest) {
    mkdirp(FS, BIN_DIR);
    mkdirp(FS, '/usr/bin');
    mkdirp(FS, '/etc');
    mkdirp(FS, '/tmp');
    // git looks for repository templates here; an empty directory keeps
    // `git init` quiet.
    mkdirp(FS, '/usr/share/git-core/templates');
    const list = commands(manifest);
    for (const { path, program } of list) {
      FS.writeFile(path, marker(program));
      FS.chmod(path, 0o755);
    }
    const provided = new Set(list.map((c) => c.path.slice(BIN_DIR.length + 1)));
    for (const name of Object.keys(SCRIPTS)) {
      if (provided.has(name) || !SCRIPTS[name].needs.every((need) => provided.has(need))) continue;
      FS.writeFile(`${BIN_DIR}/${name}`, SCRIPTS[name].text);
      FS.chmod(`${BIN_DIR}/${name}`, 0o755);
    }
    // Scripts commonly start with "#!/usr/bin/env <interpreter>".
    if (list.some((c) => c.path === `${BIN_DIR}/env`)) {
      FS.writeFile('/usr/bin/env', marker(list.find((c) => c.path === `${BIN_DIR}/env`).program));
      FS.chmod('/usr/bin/env', 0o755);
    }
    for (const path of Object.keys(ETC_FILES)) FS.writeFile(path, ETC_FILES[path]);
    // Emscripten provides /dev/null, /dev/random and /dev/urandom but no
    // /dev/zero, which shell one-liners expect.
    try {
      FS.lookupPath('/dev/zero');
    } catch (e) {
      try { FS.createDevice('/dev', 'zero', () => 0, () => {}); } catch (e2) { /* not fatal */ }
    }
    return list.length;
  }

  // Program data belongs to the shared filesystem, not to a child instance.
  // The host calls this synchronously once, before caching a program image.
  // readFile returns bytes, never a Promise; no process closures are retained.
  function installProgramFiles(FS, manifest, name, readFile) {
    const program = manifest.programs[name];
    if (!program) return; // development harnesses may supply extra test images
    const files = (program.files || []).map(({ source, path, bytes: expectedBytes }) => {
      if (!/^[A-Za-z0-9_.-]+$/.test(source) || source === '.' || source === '..'
          || !path.startsWith('/') || path.split('/').includes('..')) {
        throw new Error(`invalid program data path: ${name}`);
      }
      const bytes = readFile(source);
      if (!ArrayBuffer.isView(bytes)) throw new Error(`program data must be synchronous bytes: ${source}`);
      if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes) {
        throw new Error(`program data size mismatch: ${source}`);
      }
      return { path, bytes };
    });
    for (const dir of program.directories || []) mkdirp(FS, dir);
    for (const { path, bytes } of files) {
      mkdirp(FS, path.slice(0, path.lastIndexOf('/')));
      FS.writeFile(path, bytes);
      FS.chmod(path, 0o444);
    }
  }

  root.WasmacsUserland = { install, installProgramFiles, commands, marker, ENVIRONMENT, EMACS_SETTINGS, ETC_FILES, SCRIPTS, BIN_DIR };
})(typeof globalThis !== 'undefined' ? globalThis : self);
