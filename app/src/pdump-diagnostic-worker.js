// pdump-diagnostic-worker.js
// M260604: browser worker for pdmp generation + eval diagnostics.
// Each operation gets a fresh runtime by design: the main thread
// creates a new worker for each action to avoid callMain reuse issues.
// No xterm.js, no Asyncify, no interactive TTY.
//
// thisProgram: "/temacs" (leading slash) is load_pdump fix.
// find_emacs_executable(argv0) in emacs.c takes the strchr(argv0,'/')
// branch when argv0 contains a directory separator. realpath("/temacs")
// returns NULL in MEMFS, so the function falls through to xstrdup(argv0)
// and returns non-null "/temacs". Without the slash, argv0="temacs"
// triggers a PATH search that fails, goto hardcoded sets dump_file=NULL,
// and --dump-file is silently ignored — causing pdump=stats-nil.

var ARTIFACT_DIR = "/artifacts/emacs-browser-atomics-pdump";

function checkpoint(kind, data) {
  data = data || {};
  postMessage({ type: "checkpoint", kind: kind, ts: Date.now(), data: data });
}

function logStdout(text) {
  postMessage({ type: "stdout", text: text, ts: Date.now() });
}

function logStderr(text) {
  postMessage({ type: "stderr", text: text, ts: Date.now() });
}

function listFsTree(path) {
  try {
    var entries = FS.readdir(path).filter(function(e) { return e !== "." && e !== ".."; });
    var result = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var full = path === "/" ? "/" + e : path + "/" + e;
      try {
        var stat = FS.stat(full);
        result.push({ name: full, size: stat.size, isDir: FS.isDir(stat.mode) });
      } catch (err) {
        result.push({ name: full, error: String(err) });
      }
    }
    return result;
  } catch (e) {
    return [{ error: String(e) }];
  }
}

function arrayBufferToBase64(buffer) {
  var binary = "";
  var bytes = new Uint8Array(buffer);
  var chunkSize = 0x8000;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

function pdmpInfo(p) {
  try {
    var stat = FS.stat(p);
    var data = FS.readFile(p);
    var size = data.length;
    postMessage({ type: "pdmp-found", path: p, size: size, mtime: stat.mtime });
    if (typeof crypto !== "undefined" && crypto.subtle) {
      crypto.subtle.digest("SHA-256", data).then(function(hashBuffer) {
        var hashArray = Array.from(new Uint8Array(hashBuffer));
        var hashHex = hashArray.map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
        postMessage({ type: "pdmp-sha256", path: p, sha256: hashHex });
      }).catch(function(e) {});
    }
    postMessage({ type: "pdmp-download", path: p, size: size, base64: arrayBufferToBase64(data.buffer) });
  } catch (e) {}
}

function reportState() {
  var dirs = ["/"];
  for (var d = 0; d < dirs.length; d++) {
    (function(dir) {
      try { postMessage({ type: "fs-tree", path: dir, entries: listFsTree(dir) }); } catch(e) {}
    })(dirs[d]);
  }
  try { postMessage({ type: "lifecycle", phase: Module.ccall("wasmacs_os_lifecycle_phase", "string", [], []) }); } catch(e) {}
  try { postMessage({ type: "command-state", cmdState: Module.ccall("wasmacs_command_state", "string", [], []) }); } catch(e) {}
}

function ensureArgv0Executable() {
  try {
    FS.writeFile("/temacs", new Uint8Array([0]));
    FS.chmod("/temacs", 0o755);
    checkpoint("argv0-file-placed", { path: "/temacs" });
  } catch (e) {
    checkpoint("argv0-file-error", { error: String(e).substring(0, 120) });
  }
}

// ── Init ──────────────────────────────────────────────────────────
checkpoint("worker-starting");
self.Module = {
  noInitialRun: true, thisProgram: "/temacs",
  locateFile: function(path) { return ARTIFACT_DIR + "/" + path; },
  print: function(text) { logStdout(text); },
  printErr: function(text) { logStderr(text); },
  onRuntimeInitialized: function() {
    checkpoint("runtime-initialized");
    postMessage({
      type: "module-capabilities",
      callMain: typeof Module.callMain,
      _main: typeof Module._main,
      noInitialRun: !!Module.noInitialRun,
      thisProgram: String(Module.thisProgram),
      hasCallMain: Object.prototype.hasOwnProperty.call(Module, "callMain")
    });
    onReady();
  },
};
checkpoint("loading-temacs");
importScripts(ARTIFACT_DIR + "/temacs");

var ready = false;
function onReady() { ready = true; }

// ── Commands ──────────────────────────────────────────────────────
self.onmessage = function(evt) {
  var msg = evt.data;
  checkpoint("msg", { type: msg.type });

  function whenReady(fn) {
    if (ready) { fn(); return; }
    var check = setInterval(function() {
      if (ready) { clearInterval(check); fn(); }
    }, 100);
  }

  switch (msg.type) {
    case "generate":
      whenReady(function() {
        ENV.LANG = "C"; ENV.LC_ALL = "C";
        checkpoint("generate-start");
        fetch(ARTIFACT_DIR + "/bootstrap-emacs.pdmp").then(function(resp) {
          if (!resp.ok) throw new Error("bundled pdmp fetch failed: " + resp.status);
          return resp.arrayBuffer();
        }).then(function(buf) {
          var bytes = new Uint8Array(buf);
          try { FS.createDataFile("/", "bootstrap-emacs.pdmp", bytes, true, true, true); } catch(e) {}
          checkpoint("generate-done", { exitCode: 0, source: "bundled-artifact", size: bytes.length });
        }).catch(function(fetchErr) {
          checkpoint("generate-fallback-self-build", { error: String(fetchErr).substring(0, 200) });
          try {
            var exitCode = Module.callMain(["--batch", "-l", "loadup", "--temacs=pbootstrap"]);
            checkpoint("generate-done", { exitCode: exitCode, source: "self-build" });
          } catch(e) { checkpoint("generate-error", { error: String(e).substring(0,200) }); }
        }).then(function() {
        // Flush TTY output buffer immediately (contains loadup.el messages/errors)
        try {
          var ttyOut = globalThis.__wasmacsTerminalOutputBytes || [];
          if (ttyOut.length > 0) {
            var decoded = new TextDecoder().decode(new Uint8Array(ttyOut.slice(0, 8192)));
            logStdout("[TTY-FLUSH] " + decoded);
            ttyOut.length = 0;
          }
        } catch(ex) {}
        setTimeout(function() {
          // Check if loadup.el exists (pbootstrap needs this)
          var diagnostics = [];
          var lispDir = "/usr/local/share/emacs/30.2/lisp";
          try {
            var st = FS.stat(lispDir + "/loadup.el");
            diagnostics.push({name: "loadup.el", size: st.size, found: true});
          } catch(ex) {
            diagnostics.push({name: "loadup.el", found: false, err: String(ex).substring(0,80)});
          }
          // Check load-path via FS
          try {
            var lispEntries = FS.readdir(lispDir).length;
            diagnostics.push({name: "lisp-dir-entries", count: lispEntries});
          } catch(ex) {
            diagnostics.push({name: "lisp-dir", err: String(ex).substring(0,80)});
          }
          // Search MEMFS recursively for .pdmp files
          var found = [];
          function findPdmp(dir, depth) {
            if (depth > 5) return;
            try {
              FS.readdir(dir).filter(function(e){return e!=="."&&e!=="..";}).forEach(function(e) {
                var full = (dir==="/"?"/":dir+"/")+e;
                try {
                  var st = FS.stat(full);
                  if (FS.isDir(st.mode)) { findPdmp(full, depth+1); }
                  else if (e.indexOf(".pdmp") !== -1 || e.indexOf("pdmp") !== -1) {
                    found.push({name:full, size:st.size});
                  }
                } catch(ex) {}
              });
            } catch(ex) {}
          }
          findPdmp("/", 0);
          postMessage({ type: "fs-tree", path: "/", entries: diagnostics.concat(found.length > 0 ? found : [{name:"NO .pdmp FILES FOUND IN MEMFS"}]) });
          pdmpInfo("/bootstrap-emacs.pdmp"); pdmpInfo("/working/bootstrap-emacs.pdmp"); reportState();
        }, 2000);
        });
      });
      break;

    // Post-boot eval via wasmacs_eval_string (after callMain exits).
    // version/gc results here prove wasmacs_eval_string works, NOT pdmp load.
    case "reload-eval":
      whenReady(function() {
        ENV.LANG = "C"; ENV.LC_ALL = "C";

        if (msg.pdmpBase64) {
          var raw = atob(msg.pdmpBase64);
          var bytes = new Uint8Array(raw.length);
          for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          FS.createDataFile("/", "bootstrap-emacs.pdmp", bytes, true, true, true);
          checkpoint("pdmp-materialized", { size: bytes.length });
        }
        var dumpArg = msg.dumpFile || "/bootstrap-emacs.pdmp";
        ensureArgv0Executable();
        var generatedSize = msg.pdmpBase64 ? bytes.length : 0;
        var fileExists = false, statSize = 0;
        try { var fst = FS.stat(dumpArg); fileExists = true; statSize = fst.size; } catch(e) {}

        var analyzePath = "";
        try { analyzePath = JSON.stringify(FS.analyzePath(dumpArg)); } catch(e) {}

        var bootArgs = ["--dump-file=" + dumpArg, "--batch"];
        checkpoint("boot-args", {
          argsJson: JSON.stringify(bootArgs),
          thisProgram: Module.thisProgram,
          fileExists: fileExists,
          statSize: statSize
        });

        var exit = -1, exitErr = "";
        try { exit = Module.callMain(bootArgs); } catch(e) { exitErr = String(e).substring(0,200); }
        checkpoint("boot-done", { exit: exit, err: exitErr });

        function q(expr) {
          try {
            var ok = (Module.ccall("wasmacs_eval_string", "number", ["string"], [expr]) === 0);
            var r = Module.ccall("wasmacs_last_result", "string", [], []) || "";
            return { ok: ok, r: r };
          } catch(e) { return { ok: false, r: "ERR:" + String(e).substring(0,100) }; }
        }

        var v = q('emacs-version');
        var p = q('(if (fboundp (quote pdumper-stats)) (if (pdumper-stats) "LOADED" "stats-nil") "no-fb")');
        var cla = q('(if (boundp (quote command-line-args)) (prin1-to-string command-line-args) "no-cla")');
        var gc = q('(progn (garbage-collect) "GC-OK")');

        postMessage({
          type: "reload-results",
          fileExists: fileExists, analyzePath: analyzePath,
          bootArgs: bootArgs.join(" "), exit: exit, exitErr: exitErr,
          version: v, pdump: p, cla: cla, gc: gc,
          generatedPdmpSize: generatedSize,
        });
        checkpoint("reload-done", { exit: exit, pdump: p.r, claSample: cla.r.substring(0,200) });
        setTimeout(function() { reportState(); }, 500);
      });
      break;

    // Boot test: check pdumper state from WITHIN Emacs via --eval in callMain.
    // This separates "pdmp boot" evidence from "post-exit eval" evidence.
    // BOOT-PDUMP:LOADED in stdout = pdmp loaded during callMain startup.
    case "reload-eval-via-callmain":
      whenReady(function() {
        ENV.LANG = "C"; ENV.LC_ALL = "C";

        if (msg.pdmpBase64) {
          var raw = atob(msg.pdmpBase64);
          var bytes = new Uint8Array(raw.length);
          for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          try { FS.createDataFile("/", "bootstrap-emacs.pdmp", bytes, true, true, true); } catch(e) {}
          checkpoint("pdmp-materialized", { size: bytes.length });
        }
        var dumpArg = msg.dumpFile || "/bootstrap-emacs.pdmp";
        ensureArgv0Executable();
        var fileExists = false, statSize = 0;
        try { var fst2 = FS.stat(dumpArg); fileExists = true; statSize = fst2.size; } catch(e) {}

        var bootArgs = [
          "--dump-file=" + dumpArg, "--batch",
          "--eval", '(princ (format "BOOT-VER:%s\\n" emacs-version))',
          "--eval", '(princ (format "BOOT-PDUMP:%s\\n" (if (fboundp (quote pdumper-stats)) (if (pdumper-stats) "LOADED" "NIL") "NO-FB")))',
          "--eval", '(progn (garbage-collect) (princ "BOOT-GC:PASS\\n"))',
          "--eval", '(princ (format "BOOT-CLA:%s\\n" (if (boundp (quote command-line-args)) (prin1-to-string command-line-args) "UNBOUND")))'
        ];

        checkpoint("callmain-boot-args", {
          argsJson: JSON.stringify(bootArgs),
          thisProgram: Module.thisProgram,
          fileExists: fileExists,
          statSize: statSize
        });

        var captured = [];
        var origPrint = Module.print;
        Module.print = function(text) { captured.push(text); logStdout(text); };
        var exit = -1, exitErr = "";
        try { exit = Module.callMain(bootArgs); } catch(e) { exitErr = String(e).substring(0, 200); }
        Module.print = origPrint;
        try {
          var ttyOut = globalThis.__wasmacsTerminalOutputBytes || [];
          if (ttyOut.length > 0) {
            var ttyText = new TextDecoder().decode(new Uint8Array(ttyOut));
            captured.push(ttyText);
            logStdout(ttyText.slice(-8192));
            ttyOut.length = 0;
          }
        } catch(ex) {}

        checkpoint("callmain-boot-done", { exit: exit, err: exitErr, capturedN: captured.length });

        var stdout = captured.join("\n");
        function extr(prefix) {
          var m = stdout.match(new RegExp(prefix + "([^\\n]*)"));
          return m ? m[1].trim() : "NOT-FOUND";
        }

        postMessage({
          type: "boot-callmain-results",
          fileExists: fileExists, statSize: statSize,
          bootArgs: JSON.stringify(bootArgs),
          exit: exit, exitErr: exitErr,
          ver: extr("BOOT-VER:"),
          pdump: extr("BOOT-PDUMP:"),
          gc: extr("BOOT-GC:"),
          cla: extr("BOOT-CLA:")
        });
        checkpoint("boot-test-done");
        setTimeout(function() { postMessage({ type: "done" }); }, 200);
      });
      break;

    // NW comparison test: --quick --no-splash --nw with/without pdmp
    case "nw-test":
      whenReady(function() {
        ENV.LANG = "C"; ENV.LC_ALL = "C";
        var withPdmp = msg.withPdmp;
        if (withPdmp && msg.pdmpBase64) {
          var raw = atob(msg.pdmpBase64);
          var bytes = new Uint8Array(raw.length);
          for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          try { FS.createDataFile("/", "bootstrap-emacs.pdmp", bytes, true, true, true); } catch(e) {}
          checkpoint("nw-test-pdmp-materialized", { size: bytes.length });
        }
        var bootArgs = withPdmp
          ? ["--dump-file=/bootstrap-emacs.pdmp", "--quick", "--no-splash", "--nw"]
          : ["--quick", "--no-splash", "--nw"];
        if (withPdmp) ensureArgv0Executable();
        checkpoint("nw-test-callmain-start", { args: JSON.stringify(bootArgs), withPdmp: withPdmp });
        var exit = -1, exitErr = "";
        try { exit = Module.callMain(bootArgs); } catch(e) { exitErr = String(e).substring(0, 300); }
        checkpoint("nw-test-callmain-done", { exit: exit, err: exitErr });
        postMessage({ type: "nw-test-result", withPdmp: withPdmp, bootArgs: JSON.stringify(bootArgs), exit: exit, exitErr: exitErr });
      });
      break;

    case "list-fs":
      whenReady(function() {
        try { postMessage({ type: "fs-tree", path: msg.path || "/", entries: listFsTree(msg.path || "/") }); }
        catch(e) { postMessage({ type: "fs-tree", path: msg.path || "/", error: String(e) }); }
      });
      break;
  }
};
