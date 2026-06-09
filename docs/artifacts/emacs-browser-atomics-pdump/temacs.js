// include: shell.js
// include: minimum_runtime_check.js
(function() {
  // "30.0.0" -> 300000
  function humanReadableVersionToPacked(str) {
    str = str.split('-')[0]; // Remove any trailing part from e.g. "12.53.3-alpha"
    var vers = str.split('.').slice(0, 3);
    while(vers.length < 3) vers.push('00');
    vers = vers.map((n, i, arr) => n.padStart(2, '0'));
    return vers.join('');
  }
  // 300000 -> "30.0.0"
  var packedVersionToHumanReadable = n => [n / 10000 | 0, (n / 100 | 0) % 100, n % 100].join('.');

  var TARGET_NOT_SUPPORTED = 2147483647;

  // Note: We use a typeof check here instead of optional chaining using
  // globalThis because older browsers might not have globalThis defined.
  var currentNodeVersion = typeof process !== 'undefined' && process.versions?.node ? humanReadableVersionToPacked(process.versions.node) : TARGET_NOT_SUPPORTED;
  if (currentNodeVersion < 180300) {
    throw new Error(`This emscripten-generated code requires node v${ packedVersionToHumanReadable(180300) } (detected v${packedVersionToHumanReadable(currentNodeVersion)})`);
  }

  var userAgent = typeof navigator !== 'undefined' && navigator.userAgent;
  if (!userAgent) {
    return;
  }

  var currentSafariVersion = userAgent.includes("Safari/") && !userAgent.includes("Chrome/") && userAgent.match(/Version\/(\d+\.?\d*\.?\d*)/) ? humanReadableVersionToPacked(userAgent.match(/Version\/(\d+\.?\d*\.?\d*)/)[1]) : TARGET_NOT_SUPPORTED;
  if (currentSafariVersion < 150000) {
    throw new Error(`This emscripten-generated code requires Safari v${ packedVersionToHumanReadable(150000) } (detected v${currentSafariVersion})`);
  }

  var currentFirefoxVersion = userAgent.match(/Firefox\/(\d+(?:\.\d+)?)/) ? parseFloat(userAgent.match(/Firefox\/(\d+(?:\.\d+)?)/)[1]) : TARGET_NOT_SUPPORTED;
  if (currentFirefoxVersion < 79) {
    throw new Error(`This emscripten-generated code requires Firefox v79 (detected v${currentFirefoxVersion})`);
  }

  var currentChromeVersion = userAgent.match(/Chrome\/(\d+(?:\.\d+)?)/) ? parseFloat(userAgent.match(/Chrome\/(\d+(?:\.\d+)?)/)[1]) : TARGET_NOT_SUPPORTED;
  if (currentChromeVersion < 85) {
    throw new Error(`This emscripten-generated code requires Chrome v85 (detected v${currentChromeVersion})`);
  }
})();

// end include: minimum_runtime_check.js
// The Module object: Our interface to the outside world. We import
// and export values on it. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(moduleArg) => Promise<Module>
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to check if Module already exists (e.g. case 3 above).
// Substitution will be replaced with actual code on later stage of the build,
// this way Closure Compiler will not mangle it (e.g. case 4. above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module = typeof Module != 'undefined' ? Module : {};

// Determine the runtime environment we are in. You can customize this by
// setting the ENVIRONMENT setting at compile time (see settings.js).

// Attempt to auto-detect the environment
var ENVIRONMENT_IS_WEB = !!globalThis.window;
var ENVIRONMENT_IS_WORKER = !!globalThis.WorkerGlobalScope;
// N.b. Electron.js environment is simultaneously a NODE-environment, but
// also a web environment.
var ENVIRONMENT_IS_NODE = globalThis.process?.versions?.node && globalThis.process?.type != 'renderer';
var ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)
// include: /var/folders/l2/fl54zpqn0h52frtq4vglk4c80000gn/T/tmpw7mehhru.js

  if (!Module['expectedDataFileDownloads']) Module['expectedDataFileDownloads'] = 0;
  Module['expectedDataFileDownloads']++;
  (() => {
    // Do not attempt to redownload the virtual filesystem data when in a pthread or a Wasm Worker context.
    var isPthread = typeof ENVIRONMENT_IS_PTHREAD != 'undefined' && ENVIRONMENT_IS_PTHREAD;
    var isWasmWorker = typeof ENVIRONMENT_IS_WASM_WORKER != 'undefined' && ENVIRONMENT_IS_WASM_WORKER;
    if (isPthread || isWasmWorker) return;
    var isNode = globalThis.process && globalThis.process.versions && globalThis.process.versions.node && globalThis.process.type != 'renderer';
    async function loadPackage(metadata) {

      var PACKAGE_PATH = '';
      if (typeof window === 'object') {
        PACKAGE_PATH = window['encodeURIComponent'](window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) + '/');
      } else if (typeof process === 'undefined' && typeof location !== 'undefined') {
        // web worker
        PACKAGE_PATH = encodeURIComponent(location.pathname.substring(0, location.pathname.lastIndexOf('/')) + '/');
      }
      var PACKAGE_NAME = 'temacs.data';
      var REMOTE_PACKAGE_BASE = 'temacs.data';
      var REMOTE_PACKAGE_NAME = Module['locateFile'] ? Module['locateFile'](REMOTE_PACKAGE_BASE, '') : REMOTE_PACKAGE_BASE;
      var REMOTE_PACKAGE_SIZE = metadata['remote_package_size'];

      async function fetchRemotePackage(packageName, packageSize) {
        if (isNode) {
          var contents = require('fs').readFileSync(packageName);
          return new Uint8Array(contents).buffer;
        }
        if (!Module['dataFileDownloads']) Module['dataFileDownloads'] = {};
        try {
          var response = await fetch(packageName);
        } catch (e) {
          throw new Error(`Network Error: ${packageName}`, {e});
        }
        if (!response.ok) {
          throw new Error(`${response.status}: ${response.url}`);
        }

        const chunks = [];
        const headers = response.headers;
        const total = Number(headers.get('Content-Length') || packageSize);
        let loaded = 0;

        Module['setStatus'] && Module['setStatus']('Downloading data...');
        const reader = response.body.getReader();

        while (1) {
          var {done, value} = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.length;
          Module['dataFileDownloads'][packageName] = {loaded, total};

          let totalLoaded = 0;
          let totalSize = 0;

          for (const download of Object.values(Module['dataFileDownloads'])) {
            totalLoaded += download.loaded;
            totalSize += download.total;
          }

          Module['setStatus'] && Module['setStatus'](`Downloading data... (${totalLoaded}/${totalSize})`);
        }

        const packageData = new Uint8Array(chunks.map((c) => c.length).reduce((a, b) => a + b, 0));
        let offset = 0;
        for (const chunk of chunks) {
          packageData.set(chunk, offset);
          offset += chunk.length;
        }
        return packageData.buffer;
      }

      var fetchPromise;
      var fetched = Module['getPreloadedPackage'] && Module['getPreloadedPackage'](REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE);

      if (!fetched) {
        // Note that we don't use await here because we want to execute the
        // the rest of this function immediately.
        fetchPromise = fetchRemotePackage(REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE);
      }

    async function runWithFS(Module) {

      function assert(check, msg) {
        if (!check) throw new Error(msg);
      }
Module['FS_createPath']("/", "usr", true, true);
Module['FS_createPath']("/usr", "local", true, true);
Module['FS_createPath']("/usr/local", "share", true, true);
Module['FS_createPath']("/usr/local/share", "emacs", true, true);
Module['FS_createPath']("/usr/local/share/emacs", "30.2", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2", "etc", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc", "charsets", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc", "e", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc", "forms", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc", "gnus", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc", "images", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images", "custom", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images", "ezimage", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images", "gnus", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images", "gud", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images", "icons", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons", "allout-widgets", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets", "dark-bg", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets", "light-bg", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons", "hicolor", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons/hicolor", "128x128", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons/hicolor/128x128", "apps", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons/hicolor", "16x16", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons/hicolor/16x16", "apps", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons/hicolor", "24x24", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons/hicolor/24x24", "apps", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons/hicolor", "32x32", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons/hicolor/32x32", "apps", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons/hicolor", "48x48", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons/hicolor/48x48", "apps", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons/hicolor", "scalable", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons/hicolor/scalable", "apps", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/icons/hicolor/scalable", "mimetypes", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images", "low-color", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images", "mail", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images", "mpc", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images", "newsticker", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images", "smilies", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/smilies", "grayscale", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/smilies", "medium", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images", "symbols", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images", "tabs", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images", "tree-widget", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/tree-widget", "default", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/images/tree-widget", "folder", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc", "nxml", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc", "org", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc/org", "csl", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc", "refcards", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc", "schema", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc", "srecode", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc", "themes", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/etc", "tutorials", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2", "lisp", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "calc", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "calendar", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "cedet", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp/cedet", "ede", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp/cedet", "semantic", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp/cedet/semantic", "analyze", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp/cedet/semantic", "bovine", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp/cedet/semantic", "decorate", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp/cedet/semantic", "symref", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp/cedet/semantic", "wisent", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp/cedet", "srecode", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "emacs-lisp", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "emulation", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "erc", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "eshell", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "gnus", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "image", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "international", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "language", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "leim", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp/leim", "quail", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "mail", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "mh-e", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "net", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "nxml", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "obsolete", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "org", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "play", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "progmodes", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "term", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "textmodes", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "url", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "use-package", true, true);
Module['FS_createPath']("/usr/local/share/emacs/30.2/lisp", "vc", true, true);

    for (var file of metadata['files']) {
      var name = file['filename']
      Module['addRunDependency'](`fp ${name}`);
    }

      async function processPackageData(arrayBuffer) {
        assert(arrayBuffer, 'Loading data file failed.');
        assert(arrayBuffer.constructor.name === ArrayBuffer.name, 'bad input to processPackageData ' + arrayBuffer.constructor.name);
        var byteArray = new Uint8Array(arrayBuffer);
        var curr;
        // Reuse the bytearray from the XHR as the source for file reads.
          for (var file of metadata['files']) {
            var name = file['filename'];
            var data = byteArray.subarray(file['start'], file['end']);
            // canOwn this data in the filesystem, it is a slice into the heap that will never change
        Module['FS_createDataFile'](name, null, data, true, true, true);
        Module['removeRunDependency'](`fp ${name}`);
          }
          Module['removeRunDependency']('datafile_temacs.data');
      }
      Module['addRunDependency']('datafile_temacs.data');

      if (!Module['preloadResults']) Module['preloadResults'] = {};

      Module['preloadResults'][PACKAGE_NAME] = {fromCache: false};
      if (!fetched) {
        fetched = await fetchPromise;
      } else {
        fetched = await fetched;
      }
      await processPackageData(fetched);

    }
    if (Module['calledRun']) {
      runWithFS(Module);
    } else {
      if (!Module['preRun']) Module['preRun'] = [];
      Module['preRun'].push(runWithFS); // FS is not initialized yet, wait for it
    }

    }
    loadPackage({"files": [{"filename": "/usr/local/share/emacs/30.2/etc/AUTHORS", "start": 0, "end": 222634}, {"filename": "/usr/local/share/emacs/30.2/etc/CALC-NEWS", "start": 222634, "end": 258899}, {"filename": "/usr/local/share/emacs/30.2/etc/COPYING", "start": 258899, "end": 294048}, {"filename": "/usr/local/share/emacs/30.2/etc/ChangeLog.1", "start": 294048, "end": 496186}, {"filename": "/usr/local/share/emacs/30.2/etc/DEBUG", "start": 496186, "end": 559125}, {"filename": "/usr/local/share/emacs/30.2/etc/DEVEL.HUMOR", "start": 559125, "end": 568145}, {"filename": "/usr/local/share/emacs/30.2/etc/DISTRIB", "start": 568145, "end": 572712}, {"filename": "/usr/local/share/emacs/30.2/etc/EGLOT-NEWS", "start": 572712, "end": 596517}, {"filename": "/usr/local/share/emacs/30.2/etc/ERC-NEWS", "start": 596517, "end": 700474}, {"filename": "/usr/local/share/emacs/30.2/etc/ETAGS.EBNF", "start": 700474, "end": 704613}, {"filename": "/usr/local/share/emacs/30.2/etc/ETAGS.README", "start": 704613, "end": 706897}, {"filename": "/usr/local/share/emacs/30.2/etc/HELLO", "start": 706897, "end": 716135}, {"filename": "/usr/local/share/emacs/30.2/etc/HISTORY", "start": 716135, "end": 722278}, {"filename": "/usr/local/share/emacs/30.2/etc/JOKES", "start": 722278, "end": 734541}, {"filename": "/usr/local/share/emacs/30.2/etc/MACHINES", "start": 734541, "end": 741520}, {"filename": "/usr/local/share/emacs/30.2/etc/MH-E-NEWS", "start": 741520, "end": 856308}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS", "start": 856308, "end": 982216}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.1-17", "start": 982216, "end": 1081363}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.18", "start": 1081363, "end": 1145144}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.19", "start": 1145144, "end": 1418917}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.20", "start": 1418917, "end": 1607955}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.21", "start": 1607955, "end": 1800145}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.22", "start": 1800145, "end": 2038761}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.23", "start": 2038761, "end": 2141683}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.24", "start": 2141683, "end": 2296193}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.25", "start": 2296193, "end": 2373670}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.26", "start": 2373670, "end": 2454948}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.27", "start": 2454948, "end": 2596211}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.28", "start": 2596211, "end": 2770458}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.29", "start": 2770458, "end": 2959381}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.unknown", "start": 2959381, "end": 2960151}, {"filename": "/usr/local/share/emacs/30.2/etc/NEXTSTEP", "start": 2960151, "end": 2972282}, {"filename": "/usr/local/share/emacs/30.2/etc/NXML-NEWS", "start": 2972282, "end": 2979658}, {"filename": "/usr/local/share/emacs/30.2/etc/ORG-NEWS", "start": 2979658, "end": 3308794}, {"filename": "/usr/local/share/emacs/30.2/etc/PROBLEMS", "start": 3308794, "end": 3507884}, {"filename": "/usr/local/share/emacs/30.2/etc/README", "start": 3507884, "end": 3508363}, {"filename": "/usr/local/share/emacs/30.2/etc/TERMS", "start": 3508363, "end": 3518418}, {"filename": "/usr/local/share/emacs/30.2/etc/TODO", "start": 3518418, "end": 3593763}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-10.map", "start": 3593763, "end": 3594649}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-11.map", "start": 3594649, "end": 3594761}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-13.map", "start": 3594761, "end": 3595789}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-14.map", "start": 3595789, "end": 3596376}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-15.map", "start": 3596376, "end": 3596635}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-16.map", "start": 3596635, "end": 3597462}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-2.map", "start": 3597462, "end": 3598602}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-3.map", "start": 3598602, "end": 3599313}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-4.map", "start": 3599313, "end": 3600268}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-5.map", "start": 3600268, "end": 3600449}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-6.map", "start": 3600449, "end": 3600620}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-7.map", "start": 3600620, "end": 3600941}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-8.map", "start": 3600941, "end": 3601139}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-9.map", "start": 3601139, "end": 3601351}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/ALTERNATIVNYJ.map", "start": 3601351, "end": 3602312}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/BIG5-1.map", "start": 3602312, "end": 3689362}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/BIG5-2.map", "start": 3689362, "end": 3796978}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/BIG5-HKSCS.map", "start": 3796978, "end": 4046474}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/BIG5.map", "start": 4046474, "end": 4241142}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CNS-1.map", "start": 4241142, "end": 4318212}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CNS-2.map", "start": 4318212, "end": 4423048}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CNS-3.map", "start": 4423048, "end": 4507914}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CNS-4.map", "start": 4507914, "end": 4611686}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CNS-5.map", "start": 4611686, "end": 4737244}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CNS-6.map", "start": 4737244, "end": 4829892}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CNS-7.map", "start": 4829892, "end": 4924900}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CNS-F.map", "start": 4924900, "end": 4985023}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP10007.map", "start": 4985023, "end": 4985876}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1125.map", "start": 4985876, "end": 4986690}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1250.map", "start": 4986690, "end": 4988029}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1251.map", "start": 4988029, "end": 4988776}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1252.map", "start": 4988776, "end": 4989162}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1253.map", "start": 4989162, "end": 4989631}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1254.map", "start": 4989631, "end": 4990128}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1255.map", "start": 4990128, "end": 4990602}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1256.map", "start": 4990602, "end": 4991454}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1257.map", "start": 4991454, "end": 4992672}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1258.map", "start": 4992672, "end": 4993367}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP720.map", "start": 4993367, "end": 4994563}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP737.map", "start": 4994563, "end": 4995574}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP775.map", "start": 4995574, "end": 4997121}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP858.map", "start": 4997121, "end": 4998839}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP932-2BYTE.map", "start": 4998839, "end": 5208536}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP949-2BYTE.map", "start": 5208536, "end": 5341206}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/EBCDICUK.map", "start": 5341206, "end": 5342205}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/EBCDICUS.map", "start": 5342205, "end": 5343204}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/GB180302.map", "start": 5343204, "end": 5508135}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/GB180304.map", "start": 5508135, "end": 5513701}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/GB2312.map", "start": 5513701, "end": 5607256}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/GBK.map", "start": 5607256, "end": 5770423}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/HP-ROMAN8.map", "start": 5770423, "end": 5771592}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM037.map", "start": 5771592, "end": 5773575}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM038.map", "start": 5773575, "end": 5774571}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM1004.map", "start": 5774571, "end": 5774910}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM1026.map", "start": 5774910, "end": 5776915}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM1047.map", "start": 5776915, "end": 5778906}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM256.map", "start": 5778906, "end": 5780882}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM273.map", "start": 5780882, "end": 5782872}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM274.map", "start": 5782872, "end": 5783868}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM275.map", "start": 5783868, "end": 5784864}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM277.map", "start": 5784864, "end": 5786847}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM278.map", "start": 5786847, "end": 5788842}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM280.map", "start": 5788842, "end": 5790858}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM281.map", "start": 5790858, "end": 5791854}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM284.map", "start": 5791854, "end": 5793830}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM285.map", "start": 5793830, "end": 5795813}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM290.map", "start": 5795813, "end": 5797345}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM297.map", "start": 5797345, "end": 5799354}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM420.map", "start": 5799354, "end": 5801183}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM423.map", "start": 5801183, "end": 5802719}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM424.map", "start": 5802719, "end": 5804119}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM437.map", "start": 5804119, "end": 5805646}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM500.map", "start": 5805646, "end": 5807622}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM850.map", "start": 5807622, "end": 5809158}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM851.map", "start": 5809158, "end": 5810362}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM852.map", "start": 5810362, "end": 5811847}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM855.map", "start": 5811847, "end": 5813437}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM856.map", "start": 5813437, "end": 5814293}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM857.map", "start": 5814293, "end": 5815779}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM860.map", "start": 5815779, "end": 5817306}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM861.map", "start": 5817306, "end": 5818840}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM862.map", "start": 5818840, "end": 5820074}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM863.map", "start": 5820074, "end": 5821608}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM864.map", "start": 5821608, "end": 5823022}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM865.map", "start": 5823022, "end": 5824556}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM866.map", "start": 5824556, "end": 5825377}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM868.map", "start": 5825377, "end": 5826517}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM869.map", "start": 5826517, "end": 5827594}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM870.map", "start": 5827594, "end": 5829728}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM871.map", "start": 5829728, "end": 5831718}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM874.map", "start": 5831718, "end": 5831924}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM875.map", "start": 5831924, "end": 5833477}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM880.map", "start": 5833477, "end": 5835177}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM891.map", "start": 5835177, "end": 5835250}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM903.map", "start": 5835250, "end": 5835323}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM904.map", "start": 5835323, "end": 5835432}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM905.map", "start": 5835432, "end": 5837354}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM918.map", "start": 5837354, "end": 5839016}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/JISC6226.map", "start": 5839016, "end": 5934383}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/JISX0201.map", "start": 5934383, "end": 5934554}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/JISX0208.map", "start": 5934554, "end": 6030916}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/JISX0212.map", "start": 6030916, "end": 6098942}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/JISX2131.map", "start": 6098942, "end": 6221772}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/JISX2132.map", "start": 6221772, "end": 6257046}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/JISX213A.map", "start": 6257046, "end": 6257285}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/JOHAB.map", "start": 6257285, "end": 6346492}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/KA-ACADEMY.map", "start": 6346492, "end": 6346920}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/KA-PS.map", "start": 6346920, "end": 6347471}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/KOI-8.map", "start": 6347471, "end": 6348051}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/KOI8-R.map", "start": 6348051, "end": 6349070}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/KOI8-T.map", "start": 6349070, "end": 6350111}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/KOI8-U.map", "start": 6350111, "end": 6351265}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/KSC5601.map", "start": 6351265, "end": 6449531}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/KSC5636.map", "start": 6449531, "end": 6449634}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MACINTOSH.map", "start": 6449634, "end": 6451110}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MIK.map", "start": 6451110, "end": 6452010}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MULE-ethiopic.map", "start": 6452010, "end": 6456910}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MULE-ipa.map", "start": 6456910, "end": 6457712}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MULE-is13194.map", "start": 6457712, "end": 6458778}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MULE-lviscii.map", "start": 6458778, "end": 6459652}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MULE-sisheng.map", "start": 6459652, "end": 6460574}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MULE-tibetan.map", "start": 6460574, "end": 6463346}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MULE-uviscii.map", "start": 6463346, "end": 6464220}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/NEXTSTEP.map", "start": 6464220, "end": 6465239}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/PTCP154.map", "start": 6465239, "end": 6466122}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/README", "start": 6466122, "end": 6467812}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/TIS-620.map", "start": 6467812, "end": 6467920}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/VISCII.map", "start": 6467920, "end": 6469508}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/VSCII-2.map", "start": 6469508, "end": 6470737}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/VSCII.map", "start": 6470737, "end": 6472535}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/stdenc.map", "start": 6472535, "end": 6474521}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/symbol.map", "start": 6474521, "end": 6476987}, {"filename": "/usr/local/share/emacs/30.2/etc/compilation.txt", "start": 6476987, "end": 6499550}, {"filename": "/usr/local/share/emacs/30.2/etc/copyright-assign.txt", "start": 6499550, "end": 6500520}, {"filename": "/usr/local/share/emacs/30.2/etc/e/README", "start": 6500520, "end": 6501111}, {"filename": "/usr/local/share/emacs/30.2/etc/e/eterm-color", "start": 6501111, "end": 6502429}, {"filename": "/usr/local/share/emacs/30.2/etc/e/eterm-color.ti", "start": 6502429, "end": 6504363}, {"filename": "/usr/local/share/emacs/30.2/etc/e/eterm-direct", "start": 6504363, "end": 6505760}, {"filename": "/usr/local/share/emacs/30.2/etc/edt-user.el", "start": 6505760, "end": 6512747}, {"filename": "/usr/local/share/emacs/30.2/etc/emacs-buffer.gdb", "start": 6512747, "end": 6521517}, {"filename": "/usr/local/share/emacs/30.2/etc/emacs-mail.desktop", "start": 6521517, "end": 6521773}, {"filename": "/usr/local/share/emacs/30.2/etc/emacs.desktop", "start": 6521773, "end": 6522181}, {"filename": "/usr/local/share/emacs/30.2/etc/emacs.icon", "start": 6522181, "end": 6524114}, {"filename": "/usr/local/share/emacs/30.2/etc/emacs.metainfo.xml", "start": 6524114, "end": 6526385}, {"filename": "/usr/local/share/emacs/30.2/etc/emacs.service", "start": 6526385, "end": 6527184}, {"filename": "/usr/local/share/emacs/30.2/etc/emacs_lldb.py", "start": 6527184, "end": 6540408}, {"filename": "/usr/local/share/emacs/30.2/etc/emacsclient-mail.desktop", "start": 6540408, "end": 6541024}, {"filename": "/usr/local/share/emacs/30.2/etc/emacsclient.desktop", "start": 6541024, "end": 6541858}, {"filename": "/usr/local/share/emacs/30.2/etc/enriched.txt", "start": 6541858, "end": 6553128}, {"filename": "/usr/local/share/emacs/30.2/etc/forms/README", "start": 6553128, "end": 6553197}, {"filename": "/usr/local/share/emacs/30.2/etc/forms/forms-d2.dat", "start": 6553197, "end": 6553762}, {"filename": "/usr/local/share/emacs/30.2/etc/forms/forms-d2.el", "start": 6553762, "end": 6556861}, {"filename": "/usr/local/share/emacs/30.2/etc/forms/forms-pass.el", "start": 6556861, "end": 6557553}, {"filename": "/usr/local/share/emacs/30.2/etc/future-bug", "start": 6557553, "end": 6559126}, {"filename": "/usr/local/share/emacs/30.2/etc/gnus-tut.txt", "start": 6559126, "end": 6569722}, {"filename": "/usr/local/share/emacs/30.2/etc/gnus/gnus-setup.ast", "start": 6569722, "end": 6571197}, {"filename": "/usr/local/share/emacs/30.2/etc/gnus/news-server.ast", "start": 6571197, "end": 6572926}, {"filename": "/usr/local/share/emacs/30.2/etc/grep.txt", "start": 6572926, "end": 6578015}, {"filename": "/usr/local/share/emacs/30.2/etc/images/README", "start": 6578015, "end": 6584195}, {"filename": "/usr/local/share/emacs/30.2/etc/images/alt.pbm", "start": 6584195, "end": 6584280}, {"filename": "/usr/local/share/emacs/30.2/etc/images/attach.pbm", "start": 6584280, "end": 6584361}, {"filename": "/usr/local/share/emacs/30.2/etc/images/attach.xpm", "start": 6584361, "end": 6587252}, {"filename": "/usr/local/share/emacs/30.2/etc/images/back-arrow.pbm", "start": 6587252, "end": 6587437}, {"filename": "/usr/local/share/emacs/30.2/etc/images/back-arrow.xpm", "start": 6587437, "end": 6588615}, {"filename": "/usr/local/share/emacs/30.2/etc/images/bookmark_add.pbm", "start": 6588615, "end": 6588696}, {"filename": "/usr/local/share/emacs/30.2/etc/images/bookmark_add.xpm", "start": 6588696, "end": 6592900}, {"filename": "/usr/local/share/emacs/30.2/etc/images/cancel.pbm", "start": 6592900, "end": 6592981}, {"filename": "/usr/local/share/emacs/30.2/etc/images/cancel.xpm", "start": 6592981, "end": 6593848}, {"filename": "/usr/local/share/emacs/30.2/etc/images/checkbox-mixed.svg", "start": 6593848, "end": 6594268}, {"filename": "/usr/local/share/emacs/30.2/etc/images/checked.svg", "start": 6594268, "end": 6594695}, {"filename": "/usr/local/share/emacs/30.2/etc/images/checked.xpm", "start": 6594695, "end": 6595009}, {"filename": "/usr/local/share/emacs/30.2/etc/images/close.pbm", "start": 6595009, "end": 6595208}, {"filename": "/usr/local/share/emacs/30.2/etc/images/close.xpm", "start": 6595208, "end": 6595961}, {"filename": "/usr/local/share/emacs/30.2/etc/images/commit.pbm", "start": 6595961, "end": 6596042}, {"filename": "/usr/local/share/emacs/30.2/etc/images/commit.xpm", "start": 6596042, "end": 6597862}, {"filename": "/usr/local/share/emacs/30.2/etc/images/conceal.pbm", "start": 6597862, "end": 6597903}, {"filename": "/usr/local/share/emacs/30.2/etc/images/conceal.svg", "start": 6597903, "end": 6599035}, {"filename": "/usr/local/share/emacs/30.2/etc/images/connect-to-url.pbm", "start": 6599035, "end": 6599116}, {"filename": "/usr/local/share/emacs/30.2/etc/images/connect-to-url.xpm", "start": 6599116, "end": 6604492}, {"filename": "/usr/local/share/emacs/30.2/etc/images/connect.pbm", "start": 6604492, "end": 6604573}, {"filename": "/usr/local/share/emacs/30.2/etc/images/connect.xpm", "start": 6604573, "end": 6606175}, {"filename": "/usr/local/share/emacs/30.2/etc/images/contact.pbm", "start": 6606175, "end": 6606256}, {"filename": "/usr/local/share/emacs/30.2/etc/images/contact.xpm", "start": 6606256, "end": 6609197}, {"filename": "/usr/local/share/emacs/30.2/etc/images/copy.pbm", "start": 6609197, "end": 6609324}, {"filename": "/usr/local/share/emacs/30.2/etc/images/copy.xpm", "start": 6609324, "end": 6610437}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ctrl.pbm", "start": 6610437, "end": 6610541}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/README", "start": 6610541, "end": 6610951}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/down-pushed.pbm", "start": 6610951, "end": 6610971}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/down-pushed.xpm", "start": 6610971, "end": 6611228}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/down.pbm", "start": 6611228, "end": 6611253}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/down.xpm", "start": 6611253, "end": 6611473}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/right-pushed.pbm", "start": 6611473, "end": 6611493}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/right-pushed.xpm", "start": 6611493, "end": 6611751}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/right.pbm", "start": 6611751, "end": 6611776}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/right.xpm", "start": 6611776, "end": 6611997}, {"filename": "/usr/local/share/emacs/30.2/etc/images/cut.pbm", "start": 6611997, "end": 6612182}, {"filename": "/usr/local/share/emacs/30.2/etc/images/cut.xpm", "start": 6612182, "end": 6613504}, {"filename": "/usr/local/share/emacs/30.2/etc/images/data-save.pbm", "start": 6613504, "end": 6613585}, {"filename": "/usr/local/share/emacs/30.2/etc/images/data-save.xpm", "start": 6613585, "end": 6618266}, {"filename": "/usr/local/share/emacs/30.2/etc/images/delete.pbm", "start": 6618266, "end": 6618347}, {"filename": "/usr/local/share/emacs/30.2/etc/images/delete.xpm", "start": 6618347, "end": 6623543}, {"filename": "/usr/local/share/emacs/30.2/etc/images/describe.pbm", "start": 6623543, "end": 6623624}, {"filename": "/usr/local/share/emacs/30.2/etc/images/describe.xpm", "start": 6623624, "end": 6625379}, {"filename": "/usr/local/share/emacs/30.2/etc/images/diropen.pbm", "start": 6625379, "end": 6625460}, {"filename": "/usr/local/share/emacs/30.2/etc/images/diropen.xpm", "start": 6625460, "end": 6626321}, {"filename": "/usr/local/share/emacs/30.2/etc/images/disconnect.pbm", "start": 6626321, "end": 6626402}, {"filename": "/usr/local/share/emacs/30.2/etc/images/disconnect.xpm", "start": 6626402, "end": 6627767}, {"filename": "/usr/local/share/emacs/30.2/etc/images/down.svg", "start": 6627767, "end": 6632569}, {"filename": "/usr/local/share/emacs/30.2/etc/images/exit.pbm", "start": 6632569, "end": 6632650}, {"filename": "/usr/local/share/emacs/30.2/etc/images/exit.xpm", "start": 6632650, "end": 6636196}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/README", "start": 6636196, "end": 6636740}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/bits.pbm", "start": 6636740, "end": 6636779}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/bits.xpm", "start": 6636779, "end": 6637146}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/bitsbang.pbm", "start": 6637146, "end": 6637185}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/bitsbang.xpm", "start": 6637185, "end": 6637569}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/box-minus.pbm", "start": 6637569, "end": 6637623}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/box-minus.xpm", "start": 6637623, "end": 6638101}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/box-plus.pbm", "start": 6638101, "end": 6638155}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/box-plus.xpm", "start": 6638155, "end": 6638632}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/box.pbm", "start": 6638632, "end": 6638686}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/box.xpm", "start": 6638686, "end": 6639158}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/checkmark.pbm", "start": 6639158, "end": 6639197}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/checkmark.xpm", "start": 6639197, "end": 6639564}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/dir-minus.pbm", "start": 6639564, "end": 6639618}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/dir-minus.xpm", "start": 6639618, "end": 6640111}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/dir-plus.pbm", "start": 6640111, "end": 6640165}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/dir-plus.xpm", "start": 6640165, "end": 6640657}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/dir.pbm", "start": 6640657, "end": 6640711}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/dir.xpm", "start": 6640711, "end": 6641198}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/doc-minus.pbm", "start": 6641198, "end": 6641237}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/doc-minus.xpm", "start": 6641237, "end": 6641655}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/doc-plus.pbm", "start": 6641655, "end": 6641694}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/doc-plus.xpm", "start": 6641694, "end": 6642111}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/doc.pbm", "start": 6642111, "end": 6642150}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/doc.xpm", "start": 6642150, "end": 6642562}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/info.pbm", "start": 6642562, "end": 6642601}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/info.xpm", "start": 6642601, "end": 6642924}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/key.pbm", "start": 6642924, "end": 6642965}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/key.xpm", "start": 6642965, "end": 6643394}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/label.pbm", "start": 6643394, "end": 6643435}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/label.xpm", "start": 6643435, "end": 6643752}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/lock.pbm", "start": 6643752, "end": 6643793}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/lock.xpm", "start": 6643793, "end": 6644223}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/mail.pbm", "start": 6644223, "end": 6644277}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/mail.xpm", "start": 6644277, "end": 6644750}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/page-minus.pbm", "start": 6644750, "end": 6644804}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/page-minus.xpm", "start": 6644804, "end": 6645296}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/page-plus.pbm", "start": 6645296, "end": 6645350}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/page-plus.xpm", "start": 6645350, "end": 6645841}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/page.pbm", "start": 6645841, "end": 6645895}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/page.xpm", "start": 6645895, "end": 6646381}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-gt.pbm", "start": 6646381, "end": 6646435}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-gt.xpm", "start": 6646435, "end": 6646910}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-minus.pbm", "start": 6646910, "end": 6646964}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-minus.xpm", "start": 6646964, "end": 6647437}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-plus.pbm", "start": 6647437, "end": 6647491}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-plus.xpm", "start": 6647491, "end": 6647964}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-type.pbm", "start": 6647964, "end": 6648018}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-type.xpm", "start": 6648018, "end": 6648495}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-v.pbm", "start": 6648495, "end": 6648549}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-v.xpm", "start": 6648549, "end": 6649023}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag.pbm", "start": 6649023, "end": 6649077}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag.xpm", "start": 6649077, "end": 6649549}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/unlock.pbm", "start": 6649549, "end": 6649590}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/unlock.xpm", "start": 6649590, "end": 6650022}, {"filename": "/usr/local/share/emacs/30.2/etc/images/fwd-arrow.pbm", "start": 6650022, "end": 6650207}, {"filename": "/usr/local/share/emacs/30.2/etc/images/fwd-arrow.xpm", "start": 6650207, "end": 6651579}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gen-changelog.pbm", "start": 6651579, "end": 6651660}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gen-changelog.xpm", "start": 6651660, "end": 6654941}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus.pbm", "start": 6654941, "end": 6664234}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/README", "start": 6664234, "end": 6666025}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/followup.pbm", "start": 6666025, "end": 6666106}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/followup.xpm", "start": 6666106, "end": 6666910}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/fuwo.pbm", "start": 6666910, "end": 6666991}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/fuwo.xpm", "start": 6666991, "end": 6667791}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/gnus-pointer.svg", "start": 6667791, "end": 6673218}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/gnus-pointer.xbm", "start": 6673218, "end": 6673499}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/gnus-pointer.xpm", "start": 6673499, "end": 6673952}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/gnus.png", "start": 6673952, "end": 6694003}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/gnus.svg", "start": 6694003, "end": 6709551}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/gnus.xbm", "start": 6709551, "end": 6757281}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/gnus.xpm", "start": 6757281, "end": 6832550}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/kill-group.pbm", "start": 6832550, "end": 6832631}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/kill-group.xpm", "start": 6832631, "end": 6833416}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/mail-reply.pbm", "start": 6833416, "end": 6833497}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/mail-reply.xpm", "start": 6833497, "end": 6834324}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/mail-send.pbm", "start": 6834324, "end": 6834405}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/mail-send.xpm", "start": 6834405, "end": 6835355}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/preview.xbm", "start": 6835355, "end": 6835933}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/preview.xpm", "start": 6835933, "end": 6836739}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/toggle-subscription.pbm", "start": 6836739, "end": 6836820}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/toggle-subscription.xpm", "start": 6836820, "end": 6838024}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/README", "start": 6838024, "end": 6840187}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/all.pbm", "start": 6840187, "end": 6840268}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/all.xpm", "start": 6840268, "end": 6841049}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/break.pbm", "start": 6841049, "end": 6841130}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/break.xpm", "start": 6841130, "end": 6841883}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/cont.pbm", "start": 6841883, "end": 6841964}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/cont.xpm", "start": 6841964, "end": 6842780}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/down.pbm", "start": 6842780, "end": 6842861}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/down.xpm", "start": 6842861, "end": 6843872}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/finish.pbm", "start": 6843872, "end": 6843953}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/finish.xpm", "start": 6843953, "end": 6844782}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/go.pbm", "start": 6844782, "end": 6844863}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/go.xpm", "start": 6844863, "end": 6845640}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/next.pbm", "start": 6845640, "end": 6845721}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/next.xpm", "start": 6845721, "end": 6846548}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/nexti.pbm", "start": 6846548, "end": 6846629}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/nexti.xpm", "start": 6846629, "end": 6847476}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/pp.pbm", "start": 6847476, "end": 6847557}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/pp.xpm", "start": 6847557, "end": 6848313}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/print.pbm", "start": 6848313, "end": 6848394}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/print.xpm", "start": 6848394, "end": 6849153}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/pstar.pbm", "start": 6849153, "end": 6849234}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/pstar.xpm", "start": 6849234, "end": 6849993}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rcont.pbm", "start": 6849993, "end": 6850074}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rcont.xpm", "start": 6850074, "end": 6850898}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/recstart.pbm", "start": 6850898, "end": 6850979}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/recstart.xpm", "start": 6850979, "end": 6851732}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/recstop.pbm", "start": 6851732, "end": 6851813}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/recstop.xpm", "start": 6851813, "end": 6852566}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/remove.pbm", "start": 6852566, "end": 6852696}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/remove.xpm", "start": 6852696, "end": 6853464}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rfinish.pbm", "start": 6853464, "end": 6853545}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rfinish.xpm", "start": 6853545, "end": 6854365}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rnext.pbm", "start": 6854365, "end": 6854446}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rnext.xpm", "start": 6854446, "end": 6855281}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rnexti.pbm", "start": 6855281, "end": 6855362}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rnexti.xpm", "start": 6855362, "end": 6856183}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rstep.pbm", "start": 6856183, "end": 6856264}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rstep.xpm", "start": 6856264, "end": 6857101}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rstepi.pbm", "start": 6857101, "end": 6857182}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rstepi.xpm", "start": 6857182, "end": 6857988}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/run.pbm", "start": 6857988, "end": 6858069}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/run.xpm", "start": 6858069, "end": 6858925}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/step.pbm", "start": 6858925, "end": 6859006}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/step.xpm", "start": 6859006, "end": 6859818}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/stepi.pbm", "start": 6859818, "end": 6859899}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/stepi.xpm", "start": 6859899, "end": 6860725}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/stop.pbm", "start": 6860725, "end": 6860806}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/stop.xpm", "start": 6860806, "end": 6861579}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/thread.pbm", "start": 6861579, "end": 6861660}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/thread.xpm", "start": 6861660, "end": 6862459}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/until.pbm", "start": 6862459, "end": 6862540}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/until.xpm", "start": 6862540, "end": 6863353}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/up.pbm", "start": 6863353, "end": 6863434}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/up.xpm", "start": 6863434, "end": 6864443}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/watch.pbm", "start": 6864443, "end": 6864524}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/watch.xpm", "start": 6864524, "end": 6865473}, {"filename": "/usr/local/share/emacs/30.2/etc/images/help.pbm", "start": 6865473, "end": 6865658}, {"filename": "/usr/local/share/emacs/30.2/etc/images/help.xpm", "start": 6865658, "end": 6870862}, {"filename": "/usr/local/share/emacs/30.2/etc/images/home.pbm", "start": 6870862, "end": 6871047}, {"filename": "/usr/local/share/emacs/30.2/etc/images/home.xpm", "start": 6871047, "end": 6873963}, {"filename": "/usr/local/share/emacs/30.2/etc/images/hyper.pbm", "start": 6873963, "end": 6874086}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/README", "start": 6874086, "end": 6877511}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/closed.png", "start": 6877511, "end": 6877743}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/closed.xpm", "start": 6877743, "end": 6878158}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/empty.png", "start": 6878158, "end": 6878389}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/empty.xpm", "start": 6878389, "end": 6878806}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/end-connector.png", "start": 6878806, "end": 6878913}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/end-connector.xpm", "start": 6878913, "end": 6879242}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/extender-connector.png", "start": 6879242, "end": 6879334}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/extender-connector.xpm", "start": 6879334, "end": 6879663}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/leaf.png", "start": 6879663, "end": 6879874}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/leaf.xpm", "start": 6879874, "end": 6880473}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/locked-encrypted.png", "start": 6880473, "end": 6880683}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/locked-encrypted.xpm", "start": 6880683, "end": 6881055}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/mid-connector.png", "start": 6881055, "end": 6881180}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/mid-connector.xpm", "start": 6881180, "end": 6881509}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/opened.png", "start": 6881509, "end": 6881715}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/opened.xpm", "start": 6881715, "end": 6882072}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/skip-descender.png", "start": 6882072, "end": 6882156}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/skip-descender.xpm", "start": 6882156, "end": 6882470}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/through-descender.png", "start": 6882470, "end": 6882562}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/through-descender.xpm", "start": 6882562, "end": 6882891}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/unlocked-encrypted.png", "start": 6882891, "end": 6883093}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/unlocked-encrypted.xpm", "start": 6883093, "end": 6883465}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/closed.png", "start": 6883465, "end": 6883677}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/closed.xpm", "start": 6883677, "end": 6884001}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/empty.png", "start": 6884001, "end": 6884215}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/empty.xpm", "start": 6884215, "end": 6884557}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/end-connector.png", "start": 6884557, "end": 6884668}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/end-connector.xpm", "start": 6884668, "end": 6884997}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/extender-connector.png", "start": 6884997, "end": 6885102}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/extender-connector.xpm", "start": 6885102, "end": 6885431}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/leaf.png", "start": 6885431, "end": 6885642}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/leaf.xpm", "start": 6885642, "end": 6886241}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/locked-encrypted.png", "start": 6886241, "end": 6886451}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/locked-encrypted.xpm", "start": 6886451, "end": 6886823}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/mid-connector.png", "start": 6886823, "end": 6886938}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/mid-connector.xpm", "start": 6886938, "end": 6887267}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/opened.png", "start": 6887267, "end": 6887479}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/opened.xpm", "start": 6887479, "end": 6887821}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/skip-descender.png", "start": 6887821, "end": 6887905}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/skip-descender.xpm", "start": 6887905, "end": 6888219}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/through-descender.png", "start": 6888219, "end": 6888324}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/through-descender.xpm", "start": 6888324, "end": 6888653}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/unlocked-encrypted.png", "start": 6888653, "end": 6888855}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/unlocked-encrypted.xpm", "start": 6888855, "end": 6889227}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/128x128/apps/emacs.png", "start": 6889227, "end": 6902689}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/128x128/apps/emacs23.png", "start": 6902689, "end": 6924440}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/16x16/apps/emacs.png", "start": 6924440, "end": 6925394}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/16x16/apps/emacs22.png", "start": 6925394, "end": 6926099}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/16x16/apps/emacs23.png", "start": 6926099, "end": 6927102}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/24x24/apps/emacs.png", "start": 6927102, "end": 6928670}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/24x24/apps/emacs22.png", "start": 6928670, "end": 6929658}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/24x24/apps/emacs23.png", "start": 6929658, "end": 6931375}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/32x32/apps/emacs.png", "start": 6931375, "end": 6933611}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/32x32/apps/emacs22.png", "start": 6933611, "end": 6936015}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/32x32/apps/emacs23.png", "start": 6936015, "end": 6938557}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/48x48/apps/emacs.png", "start": 6938557, "end": 6942193}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/48x48/apps/emacs22.png", "start": 6942193, "end": 6945624}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/48x48/apps/emacs23.png", "start": 6945624, "end": 6951017}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/scalable/apps/emacs.ico", "start": 6951017, "end": 7036199}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/scalable/apps/emacs.svg", "start": 7036199, "end": 7049558}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/scalable/apps/emacs23.svg", "start": 7049558, "end": 7064062}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/scalable/mimetypes/emacs-document.svg", "start": 7064062, "end": 7077745}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/scalable/mimetypes/emacs-document23.svg", "start": 7077745, "end": 7089396}, {"filename": "/usr/local/share/emacs/30.2/etc/images/index.pbm", "start": 7089396, "end": 7089581}, {"filename": "/usr/local/share/emacs/30.2/etc/images/index.xpm", "start": 7089581, "end": 7093666}, {"filename": "/usr/local/share/emacs/30.2/etc/images/info.pbm", "start": 7093666, "end": 7093747}, {"filename": "/usr/local/share/emacs/30.2/etc/images/info.xpm", "start": 7093747, "end": 7094905}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ins-changelog.pbm", "start": 7094905, "end": 7094986}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ins-changelog.xpm", "start": 7094986, "end": 7096310}, {"filename": "/usr/local/share/emacs/30.2/etc/images/jump-to.pbm", "start": 7096310, "end": 7096495}, {"filename": "/usr/local/share/emacs/30.2/etc/images/jump-to.xpm", "start": 7096495, "end": 7100102}, {"filename": "/usr/local/share/emacs/30.2/etc/images/last-page.pbm", "start": 7100102, "end": 7100183}, {"filename": "/usr/local/share/emacs/30.2/etc/images/last-page.xpm", "start": 7100183, "end": 7102333}, {"filename": "/usr/local/share/emacs/30.2/etc/images/left-arrow.pbm", "start": 7102333, "end": 7102518}, {"filename": "/usr/local/share/emacs/30.2/etc/images/left-arrow.xpm", "start": 7102518, "end": 7103892}, {"filename": "/usr/local/share/emacs/30.2/etc/images/left.svg", "start": 7103892, "end": 7108772}, {"filename": "/usr/local/share/emacs/30.2/etc/images/letter.pbm", "start": 7108772, "end": 7108801}, {"filename": "/usr/local/share/emacs/30.2/etc/images/letter.xpm", "start": 7108801, "end": 7109062}, {"filename": "/usr/local/share/emacs/30.2/etc/images/load-changelog.pbm", "start": 7109062, "end": 7109143}, {"filename": "/usr/local/share/emacs/30.2/etc/images/load-changelog.xpm", "start": 7109143, "end": 7110684}, {"filename": "/usr/local/share/emacs/30.2/etc/images/lock-broken.pbm", "start": 7110684, "end": 7110765}, {"filename": "/usr/local/share/emacs/30.2/etc/images/lock-broken.xpm", "start": 7110765, "end": 7115342}, {"filename": "/usr/local/share/emacs/30.2/etc/images/lock-ok.pbm", "start": 7115342, "end": 7115423}, {"filename": "/usr/local/share/emacs/30.2/etc/images/lock-ok.xpm", "start": 7115423, "end": 7119740}, {"filename": "/usr/local/share/emacs/30.2/etc/images/lock.pbm", "start": 7119740, "end": 7119821}, {"filename": "/usr/local/share/emacs/30.2/etc/images/lock.xpm", "start": 7119821, "end": 7124327}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/README", "start": 7124327, "end": 7124815}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/back-arrow.xpm", "start": 7124815, "end": 7125632}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/copy.xpm", "start": 7125632, "end": 7126444}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/cut.xpm", "start": 7126444, "end": 7127271}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/fwd-arrow.xpm", "start": 7127271, "end": 7128072}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/help.xpm", "start": 7128072, "end": 7128976}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/home.xpm", "start": 7128976, "end": 7129865}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/index.xpm", "start": 7129865, "end": 7130694}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/jump-to.xpm", "start": 7130694, "end": 7131540}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/left-arrow.xpm", "start": 7131540, "end": 7132374}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/new.xpm", "start": 7132374, "end": 7133186}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/next-node.xpm", "start": 7133186, "end": 7134033}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/open.xpm", "start": 7134033, "end": 7134876}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/paste.xpm", "start": 7134876, "end": 7135720}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/preferences.xpm", "start": 7135720, "end": 7136601}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/prev-node.xpm", "start": 7136601, "end": 7137433}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/print.xpm", "start": 7137433, "end": 7138247}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/right-arrow.xpm", "start": 7138247, "end": 7139067}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/save.xpm", "start": 7139067, "end": 7139970}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/saveas.xpm", "start": 7139970, "end": 7140891}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/search.xpm", "start": 7140891, "end": 7141706}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/spell.xpm", "start": 7141706, "end": 7142550}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/undo.xpm", "start": 7142550, "end": 7143348}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/up-arrow.xpm", "start": 7143348, "end": 7144195}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/up-node.xpm", "start": 7144195, "end": 7145040}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/README", "start": 7145040, "end": 7146677}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/compose.pbm", "start": 7146677, "end": 7146758}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/compose.xpm", "start": 7146758, "end": 7151240}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/copy.pbm", "start": 7151240, "end": 7151321}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/copy.xpm", "start": 7151321, "end": 7153210}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/flag-for-followup.pbm", "start": 7153210, "end": 7153291}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/flag-for-followup.xpm", "start": 7153291, "end": 7157164}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/forward.pbm", "start": 7157164, "end": 7157245}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/forward.xpm", "start": 7157245, "end": 7158957}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/inbox.pbm", "start": 7158957, "end": 7159038}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/inbox.xpm", "start": 7159038, "end": 7160908}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/move.pbm", "start": 7160908, "end": 7160989}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/move.xpm", "start": 7160989, "end": 7162863}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/not-spam.pbm", "start": 7162863, "end": 7162944}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/not-spam.xpm", "start": 7162944, "end": 7166206}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/outbox.pbm", "start": 7166206, "end": 7166287}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/outbox.xpm", "start": 7166287, "end": 7168053}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/preview.pbm", "start": 7168053, "end": 7168134}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/preview.xpm", "start": 7168134, "end": 7171858}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/repack.pbm", "start": 7171858, "end": 7171939}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/repack.xpm", "start": 7171939, "end": 7173909}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/reply-all.pbm", "start": 7173909, "end": 7173990}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/reply-all.xpm", "start": 7173990, "end": 7177693}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/reply-from.pbm", "start": 7177693, "end": 7177774}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/reply-from.xpm", "start": 7177774, "end": 7179643}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/reply-to.pbm", "start": 7179643, "end": 7179724}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/reply-to.xpm", "start": 7179724, "end": 7183892}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/reply.pbm", "start": 7183892, "end": 7183973}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/reply.xpm", "start": 7183973, "end": 7185713}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/save-draft.pbm", "start": 7185713, "end": 7185794}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/save-draft.xpm", "start": 7185794, "end": 7187612}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/save.xpm", "start": 7187612, "end": 7193141}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/send.pbm", "start": 7193141, "end": 7193222}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/send.xpm", "start": 7193222, "end": 7194826}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/spam.xpm", "start": 7194826, "end": 7199172}, {"filename": "/usr/local/share/emacs/30.2/etc/images/meta.pbm", "start": 7199172, "end": 7199276}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mh-logo.pbm", "start": 7199276, "end": 7199324}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mh-logo.xpm", "start": 7199324, "end": 7199700}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/README", "start": 7199700, "end": 7200006}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/add.pbm", "start": 7200006, "end": 7200087}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/add.xpm", "start": 7200087, "end": 7200891}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/ffwd.pbm", "start": 7200891, "end": 7200972}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/ffwd.xpm", "start": 7200972, "end": 7201800}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/next.pbm", "start": 7201800, "end": 7201881}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/next.xpm", "start": 7201881, "end": 7202709}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/pause.pbm", "start": 7202709, "end": 7202790}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/pause.xpm", "start": 7202790, "end": 7203596}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/play.pbm", "start": 7203596, "end": 7203677}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/play.xpm", "start": 7203677, "end": 7204505}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/prev.pbm", "start": 7204505, "end": 7204586}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/prev.xpm", "start": 7204586, "end": 7205391}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/rewind.pbm", "start": 7205391, "end": 7205472}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/rewind.xpm", "start": 7205472, "end": 7206279}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/stop.pbm", "start": 7206279, "end": 7206360}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/stop.xpm", "start": 7206360, "end": 7207165}, {"filename": "/usr/local/share/emacs/30.2/etc/images/new.pbm", "start": 7207165, "end": 7207350}, {"filename": "/usr/local/share/emacs/30.2/etc/images/new.xpm", "start": 7207350, "end": 7210681}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/README", "start": 7210681, "end": 7211059}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/browse-url.xpm", "start": 7211059, "end": 7212368}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/get-all.xpm", "start": 7212368, "end": 7214144}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/mark-immortal.xpm", "start": 7214144, "end": 7216940}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/mark-read.xpm", "start": 7216940, "end": 7218328}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/narrow.xpm", "start": 7218328, "end": 7219773}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/next-feed.xpm", "start": 7219773, "end": 7221356}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/next-item.xpm", "start": 7221356, "end": 7222709}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/prev-feed.xpm", "start": 7222709, "end": 7224217}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/prev-item.xpm", "start": 7224217, "end": 7225529}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/rss-feed.png", "start": 7225529, "end": 7226168}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/rss-feed.svg", "start": 7226168, "end": 7230274}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/update.xpm", "start": 7230274, "end": 7231554}, {"filename": "/usr/local/share/emacs/30.2/etc/images/next-node.pbm", "start": 7231554, "end": 7231681}, {"filename": "/usr/local/share/emacs/30.2/etc/images/next-node.xpm", "start": 7231681, "end": 7232680}, {"filename": "/usr/local/share/emacs/30.2/etc/images/next-page.pbm", "start": 7232680, "end": 7232761}, {"filename": "/usr/local/share/emacs/30.2/etc/images/next-page.xpm", "start": 7232761, "end": 7235543}, {"filename": "/usr/local/share/emacs/30.2/etc/images/open.pbm", "start": 7235543, "end": 7235728}, {"filename": "/usr/local/share/emacs/30.2/etc/images/open.xpm", "start": 7235728, "end": 7239796}, {"filename": "/usr/local/share/emacs/30.2/etc/images/outline-close.pbm", "start": 7239796, "end": 7239835}, {"filename": "/usr/local/share/emacs/30.2/etc/images/outline-close.svg", "start": 7239835, "end": 7240051}, {"filename": "/usr/local/share/emacs/30.2/etc/images/outline-open.pbm", "start": 7240051, "end": 7240090}, {"filename": "/usr/local/share/emacs/30.2/etc/images/outline-open.svg", "start": 7240090, "end": 7240264}, {"filename": "/usr/local/share/emacs/30.2/etc/images/paste.pbm", "start": 7240264, "end": 7240449}, {"filename": "/usr/local/share/emacs/30.2/etc/images/paste.xpm", "start": 7240449, "end": 7242508}, {"filename": "/usr/local/share/emacs/30.2/etc/images/preferences.pbm", "start": 7242508, "end": 7242693}, {"filename": "/usr/local/share/emacs/30.2/etc/images/preferences.xpm", "start": 7242693, "end": 7244728}, {"filename": "/usr/local/share/emacs/30.2/etc/images/prev-node.pbm", "start": 7244728, "end": 7244855}, {"filename": "/usr/local/share/emacs/30.2/etc/images/prev-node.xpm", "start": 7244855, "end": 7245839}, {"filename": "/usr/local/share/emacs/30.2/etc/images/print.pbm", "start": 7245839, "end": 7246024}, {"filename": "/usr/local/share/emacs/30.2/etc/images/print.xpm", "start": 7246024, "end": 7250125}, {"filename": "/usr/local/share/emacs/30.2/etc/images/radio-checked.svg", "start": 7250125, "end": 7250575}, {"filename": "/usr/local/share/emacs/30.2/etc/images/radio-mixed.svg", "start": 7250575, "end": 7250902}, {"filename": "/usr/local/share/emacs/30.2/etc/images/radio.svg", "start": 7250902, "end": 7251141}, {"filename": "/usr/local/share/emacs/30.2/etc/images/redo.pbm", "start": 7251141, "end": 7251222}, {"filename": "/usr/local/share/emacs/30.2/etc/images/redo.xpm", "start": 7251222, "end": 7252581}, {"filename": "/usr/local/share/emacs/30.2/etc/images/refresh.pbm", "start": 7252581, "end": 7252662}, {"filename": "/usr/local/share/emacs/30.2/etc/images/refresh.xpm", "start": 7252662, "end": 7255981}, {"filename": "/usr/local/share/emacs/30.2/etc/images/reveal.pbm", "start": 7255981, "end": 7256022}, {"filename": "/usr/local/share/emacs/30.2/etc/images/reveal.svg", "start": 7256022, "end": 7256613}, {"filename": "/usr/local/share/emacs/30.2/etc/images/right-arrow.pbm", "start": 7256613, "end": 7256798}, {"filename": "/usr/local/share/emacs/30.2/etc/images/right-arrow.xpm", "start": 7256798, "end": 7258143}, {"filename": "/usr/local/share/emacs/30.2/etc/images/right.svg", "start": 7258143, "end": 7263021}, {"filename": "/usr/local/share/emacs/30.2/etc/images/save.pbm", "start": 7263021, "end": 7263148}, {"filename": "/usr/local/share/emacs/30.2/etc/images/save.xpm", "start": 7263148, "end": 7267968}, {"filename": "/usr/local/share/emacs/30.2/etc/images/saveas.pbm", "start": 7267968, "end": 7268153}, {"filename": "/usr/local/share/emacs/30.2/etc/images/saveas.xpm", "start": 7268153, "end": 7273647}, {"filename": "/usr/local/share/emacs/30.2/etc/images/search-replace.pbm", "start": 7273647, "end": 7273728}, {"filename": "/usr/local/share/emacs/30.2/etc/images/search-replace.xpm", "start": 7273728, "end": 7278926}, {"filename": "/usr/local/share/emacs/30.2/etc/images/search.pbm", "start": 7278926, "end": 7279111}, {"filename": "/usr/local/share/emacs/30.2/etc/images/search.xpm", "start": 7279111, "end": 7283725}, {"filename": "/usr/local/share/emacs/30.2/etc/images/separator.pbm", "start": 7283725, "end": 7283757}, {"filename": "/usr/local/share/emacs/30.2/etc/images/separator.xpm", "start": 7283757, "end": 7284001}, {"filename": "/usr/local/share/emacs/30.2/etc/images/shift.pbm", "start": 7284001, "end": 7284170}, {"filename": "/usr/local/share/emacs/30.2/etc/images/show.pbm", "start": 7284170, "end": 7284251}, {"filename": "/usr/local/share/emacs/30.2/etc/images/show.xpm", "start": 7284251, "end": 7287999}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/README", "start": 7287999, "end": 7288442}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/blink.pbm", "start": 7288442, "end": 7288479}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/blink.xpm", "start": 7288479, "end": 7288813}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/braindamaged.pbm", "start": 7288813, "end": 7288850}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/braindamaged.xpm", "start": 7288850, "end": 7289182}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/cry.pbm", "start": 7289182, "end": 7289219}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/cry.xpm", "start": 7289219, "end": 7289551}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/dead.pbm", "start": 7289551, "end": 7289588}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/dead.xpm", "start": 7289588, "end": 7289921}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/evil.pbm", "start": 7289921, "end": 7289958}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/evil.xpm", "start": 7289958, "end": 7290295}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/forced.pbm", "start": 7290295, "end": 7290332}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/forced.xpm", "start": 7290332, "end": 7290667}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/frown.pbm", "start": 7290667, "end": 7290704}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/frown.xpm", "start": 7290704, "end": 7291038}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/README", "start": 7291038, "end": 7291370}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/blink.xpm", "start": 7291370, "end": 7291778}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/braindamaged.xpm", "start": 7291778, "end": 7292178}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/cry.xpm", "start": 7292178, "end": 7292569}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/dead.xpm", "start": 7292569, "end": 7292931}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/evil.xpm", "start": 7292931, "end": 7293323}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/forced.xpm", "start": 7293323, "end": 7293717}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/frown.xpm", "start": 7293717, "end": 7294095}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/grin.xpm", "start": 7294095, "end": 7294517}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/indifferent.xpm", "start": 7294517, "end": 7294916}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/reverse-smile.xpm", "start": 7294916, "end": 7295302}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/sad.xpm", "start": 7295302, "end": 7295678}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/smile.xpm", "start": 7295678, "end": 7296056}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/wry.xpm", "start": 7296056, "end": 7296447}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grin.pbm", "start": 7296447, "end": 7296484}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grin.xpm", "start": 7296484, "end": 7296832}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/indifferent.pbm", "start": 7296832, "end": 7296869}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/indifferent.xpm", "start": 7296869, "end": 7297209}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/README", "start": 7297209, "end": 7297541}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/blink.xpm", "start": 7297541, "end": 7298063}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/braindamaged.xpm", "start": 7298063, "end": 7298576}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/cry.xpm", "start": 7298576, "end": 7299080}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/dead.xpm", "start": 7299080, "end": 7299585}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/evil.xpm", "start": 7299585, "end": 7300106}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/forced.xpm", "start": 7300106, "end": 7300613}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/frown.xpm", "start": 7300613, "end": 7301119}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/grin.xpm", "start": 7301119, "end": 7301655}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/indifferent.xpm", "start": 7301655, "end": 7302167}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/reverse-smile.xpm", "start": 7302167, "end": 7302697}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/sad.xpm", "start": 7302697, "end": 7303201}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/smile.xpm", "start": 7303201, "end": 7303723}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/wry.xpm", "start": 7303723, "end": 7304227}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/sad.pbm", "start": 7304227, "end": 7304264}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/sad.xpm", "start": 7304264, "end": 7304596}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/smile.pbm", "start": 7304596, "end": 7304633}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/smile.xpm", "start": 7304633, "end": 7304967}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/wry.pbm", "start": 7304967, "end": 7305004}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/wry.xpm", "start": 7305004, "end": 7305336}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-ascending.pbm", "start": 7305336, "end": 7305417}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-ascending.xpm", "start": 7305417, "end": 7306660}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-column-ascending.pbm", "start": 7306660, "end": 7306741}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-column-ascending.xpm", "start": 7306741, "end": 7307516}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-criteria.pbm", "start": 7307516, "end": 7307597}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-criteria.xpm", "start": 7307597, "end": 7308755}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-descending.pbm", "start": 7308755, "end": 7308836}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-descending.xpm", "start": 7308836, "end": 7310095}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-row-ascending.pbm", "start": 7310095, "end": 7310155}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-row-ascending.xpm", "start": 7310155, "end": 7310680}, {"filename": "/usr/local/share/emacs/30.2/etc/images/spell.pbm", "start": 7310680, "end": 7310865}, {"filename": "/usr/local/share/emacs/30.2/etc/images/spell.xpm", "start": 7310865, "end": 7312144}, {"filename": "/usr/local/share/emacs/30.2/etc/images/splash.bmp", "start": 7312144, "end": 7466686}, {"filename": "/usr/local/share/emacs/30.2/etc/images/splash.pbm", "start": 7466686, "end": 7476483}, {"filename": "/usr/local/share/emacs/30.2/etc/images/splash.png", "start": 7476483, "end": 7501643}, {"filename": "/usr/local/share/emacs/30.2/etc/images/splash.svg", "start": 7501643, "end": 7513820}, {"filename": "/usr/local/share/emacs/30.2/etc/images/splash.xpm", "start": 7513820, "end": 7672137}, {"filename": "/usr/local/share/emacs/30.2/etc/images/super.pbm", "start": 7672137, "end": 7672260}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/README", "start": 7672260, "end": 7673730}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/check-mark_16.pbm", "start": 7673730, "end": 7673771}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/check-mark_16.svg", "start": 7673771, "end": 7673989}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/chevron_down_16.pbm", "start": 7673989, "end": 7674030}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/chevron_down_16.svg", "start": 7674030, "end": 7674177}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/chevron_left_16.pbm", "start": 7674177, "end": 7674218}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/chevron_left_16.svg", "start": 7674218, "end": 7674377}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/chevron_right_16.pbm", "start": 7674377, "end": 7674418}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/chevron_right_16.svg", "start": 7674418, "end": 7674583}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/chevron_up_16.pbm", "start": 7674583, "end": 7674624}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/chevron_up_16.svg", "start": 7674624, "end": 7674772}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/cross_16.pbm", "start": 7674772, "end": 7674813}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/cross_16.svg", "start": 7674813, "end": 7675104}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/cross_circle_16.pbm", "start": 7675104, "end": 7675145}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/cross_circle_16.svg", "start": 7675145, "end": 7675684}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/cross_circle_fill_16.pbm", "start": 7675684, "end": 7675725}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/cross_circle_fill_16.svg", "start": 7675725, "end": 7676160}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/dot_large_16.pbm", "start": 7676160, "end": 7676201}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/dot_large_16.svg", "start": 7676201, "end": 7676324}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/dot_medium_16.pbm", "start": 7676324, "end": 7676365}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/dot_medium_16.svg", "start": 7676365, "end": 7676488}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/dot_small_16.pbm", "start": 7676488, "end": 7676529}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/dot_small_16.svg", "start": 7676529, "end": 7676652}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/heart_16.pbm", "start": 7676652, "end": 7676693}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/heart_16.svg", "start": 7676693, "end": 7677202}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/heart_fill_16.pbm", "start": 7677202, "end": 7677243}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/heart_fill_16.svg", "start": 7677243, "end": 7677493}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/heart_half_16.pbm", "start": 7677493, "end": 7677534}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/heart_half_16.svg", "start": 7677534, "end": 7677942}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/menu_16.pbm", "start": 7677942, "end": 7677983}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/menu_16.svg", "start": 7677983, "end": 7678176}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/minus_16.pbm", "start": 7678176, "end": 7678217}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/minus_16.svg", "start": 7678217, "end": 7678344}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/minus_circle_16.pbm", "start": 7678344, "end": 7678385}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/minus_circle_16.svg", "start": 7678385, "end": 7678764}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/minus_circle_fill_16.pbm", "start": 7678764, "end": 7678805}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/minus_circle_fill_16.svg", "start": 7678805, "end": 7679070}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/plus_16.pbm", "start": 7679070, "end": 7679111}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/plus_16.svg", "start": 7679111, "end": 7679258}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/plus_circle_16.pbm", "start": 7679258, "end": 7679299}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/plus_circle_16.svg", "start": 7679299, "end": 7679696}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/plus_circle_fill_16.pbm", "start": 7679696, "end": 7679737}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/plus_circle_fill_16.svg", "start": 7679737, "end": 7680018}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/star_16.pbm", "start": 7680018, "end": 7680059}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/star_16.svg", "start": 7680059, "end": 7680511}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/star_fill_16.pbm", "start": 7680511, "end": 7680552}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/star_fill_16.svg", "start": 7680552, "end": 7680797}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/star_half_16.pbm", "start": 7680797, "end": 7680869}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/star_half_16.svg", "start": 7680869, "end": 7681266}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tabs/README", "start": 7681266, "end": 7681595}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tabs/close.xpm", "start": 7681595, "end": 7681821}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tabs/left-arrow.xpm", "start": 7681821, "end": 7682052}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tabs/new.xpm", "start": 7682052, "end": 7682276}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tabs/right-arrow.xpm", "start": 7682276, "end": 7682508}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/README", "start": 7682508, "end": 7682956}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/close.png", "start": 7682956, "end": 7683256}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/close.xpm", "start": 7683256, "end": 7683862}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/empty.png", "start": 7683862, "end": 7684160}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/empty.xpm", "start": 7684160, "end": 7684766}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/end-guide.png", "start": 7684766, "end": 7684947}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/end-guide.xpm", "start": 7684947, "end": 7685241}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/guide.png", "start": 7685241, "end": 7685421}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/guide.xpm", "start": 7685421, "end": 7685711}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/handle.png", "start": 7685711, "end": 7685891}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/handle.xpm", "start": 7685891, "end": 7686267}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/leaf.png", "start": 7686267, "end": 7686544}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/leaf.xpm", "start": 7686544, "end": 7687149}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/no-guide.png", "start": 7687149, "end": 7687319}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/no-guide.xpm", "start": 7687319, "end": 7687597}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/no-handle.png", "start": 7687597, "end": 7687770}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/no-handle.xpm", "start": 7687770, "end": 7688134}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/nohandle-guide.png", "start": 7688134, "end": 7688314}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/nohandle-guide.xpm", "start": 7688314, "end": 7688604}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/open.png", "start": 7688604, "end": 7688917}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/open.xpm", "start": 7688917, "end": 7689553}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/README", "start": 7689553, "end": 7690005}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/close.png", "start": 7690005, "end": 7690303}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/close.xpm", "start": 7690303, "end": 7691020}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/empty.png", "start": 7691020, "end": 7691325}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/empty.xpm", "start": 7691325, "end": 7691967}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/end-guide.png", "start": 7691967, "end": 7692144}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/end-guide.xpm", "start": 7692144, "end": 7692448}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/guide.png", "start": 7692448, "end": 7692626}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/guide.xpm", "start": 7692626, "end": 7692926}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/handle.png", "start": 7692926, "end": 7693106}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/handle.xpm", "start": 7693106, "end": 7693496}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/leaf.png", "start": 7693496, "end": 7693832}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/leaf.xpm", "start": 7693832, "end": 7694457}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/no-guide.png", "start": 7694457, "end": 7694628}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/no-guide.xpm", "start": 7694628, "end": 7694916}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/no-handle.png", "start": 7694916, "end": 7695089}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/no-handle.xpm", "start": 7695089, "end": 7695467}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/nohandle-guide.png", "start": 7695467, "end": 7695645}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/nohandle-guide.xpm", "start": 7695645, "end": 7695945}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/open.png", "start": 7695945, "end": 7696289}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/open.xpm", "start": 7696289, "end": 7696990}, {"filename": "/usr/local/share/emacs/30.2/etc/images/unchecked.pbm", "start": 7696990, "end": 7697023}, {"filename": "/usr/local/share/emacs/30.2/etc/images/unchecked.svg", "start": 7697023, "end": 7697355}, {"filename": "/usr/local/share/emacs/30.2/etc/images/unchecked.xpm", "start": 7697355, "end": 7697671}, {"filename": "/usr/local/share/emacs/30.2/etc/images/undo.pbm", "start": 7697671, "end": 7697856}, {"filename": "/usr/local/share/emacs/30.2/etc/images/undo.xpm", "start": 7697856, "end": 7699044}, {"filename": "/usr/local/share/emacs/30.2/etc/images/up-arrow.pbm", "start": 7699044, "end": 7699229}, {"filename": "/usr/local/share/emacs/30.2/etc/images/up-arrow.xpm", "start": 7699229, "end": 7700961}, {"filename": "/usr/local/share/emacs/30.2/etc/images/up-node.pbm", "start": 7700961, "end": 7701088}, {"filename": "/usr/local/share/emacs/30.2/etc/images/up-node.xpm", "start": 7701088, "end": 7702085}, {"filename": "/usr/local/share/emacs/30.2/etc/images/up.svg", "start": 7702085, "end": 7706886}, {"filename": "/usr/local/share/emacs/30.2/etc/images/view-diff.pbm", "start": 7706886, "end": 7706967}, {"filename": "/usr/local/share/emacs/30.2/etc/images/view-diff.xpm", "start": 7706967, "end": 7708667}, {"filename": "/usr/local/share/emacs/30.2/etc/images/zoom-in.pbm", "start": 7708667, "end": 7708748}, {"filename": "/usr/local/share/emacs/30.2/etc/images/zoom-in.xpm", "start": 7708748, "end": 7712163}, {"filename": "/usr/local/share/emacs/30.2/etc/images/zoom-out.pbm", "start": 7712163, "end": 7712244}, {"filename": "/usr/local/share/emacs/30.2/etc/images/zoom-out.xpm", "start": 7712244, "end": 7715644}, {"filename": "/usr/local/share/emacs/30.2/etc/nxml/README", "start": 7715644, "end": 7715691}, {"filename": "/usr/local/share/emacs/30.2/etc/nxml/test-invalid.xml", "start": 7715691, "end": 7715889}, {"filename": "/usr/local/share/emacs/30.2/etc/nxml/test-valid.xml", "start": 7715889, "end": 7716074}, {"filename": "/usr/local/share/emacs/30.2/etc/org.gnu.emacs.defaults.gschema.xml", "start": 7716074, "end": 7719468}, {"filename": "/usr/local/share/emacs/30.2/etc/org/OrgOdtContentTemplate.xml", "start": 7719468, "end": 7740434}, {"filename": "/usr/local/share/emacs/30.2/etc/org/OrgOdtStyles.xml", "start": 7740434, "end": 7811132}, {"filename": "/usr/local/share/emacs/30.2/etc/org/README", "start": 7811132, "end": 7812481}, {"filename": "/usr/local/share/emacs/30.2/etc/org/csl/README", "start": 7812481, "end": 7812801}, {"filename": "/usr/local/share/emacs/30.2/etc/org/csl/chicago-author-date.csl", "start": 7812801, "end": 7834996}, {"filename": "/usr/local/share/emacs/30.2/etc/org/csl/locales-en-US.xml", "start": 7834996, "end": 7846364}, {"filename": "/usr/local/share/emacs/30.2/etc/package-keyring.gpg", "start": 7846364, "end": 7848707}, {"filename": "/usr/local/share/emacs/30.2/etc/ps-prin0.ps", "start": 7848707, "end": 7854033}, {"filename": "/usr/local/share/emacs/30.2/etc/ps-prin1.ps", "start": 7854033, "end": 7877268}, {"filename": "/usr/local/share/emacs/30.2/etc/publicsuffix.txt", "start": 7877268, "end": 8193920}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/Makefile", "start": 8193920, "end": 8203910}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/README", "start": 8203910, "end": 8207236}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/calccard.tex", "start": 8207236, "end": 8227604}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/cs-dired-ref.tex", "start": 8227604, "end": 8241842}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/cs-refcard.tex", "start": 8241842, "end": 8263571}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/cs-survival.tex", "start": 8263571, "end": 8276774}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/de-refcard.tex", "start": 8276774, "end": 8299257}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/dired-ref.tex", "start": 8299257, "end": 8313288}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/emacsver.tex", "start": 8313288, "end": 8313553}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/emacsver.tex.in", "start": 8313553, "end": 8313830}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/fr-dired-ref.tex", "start": 8313830, "end": 8329476}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/fr-refcard.tex", "start": 8329476, "end": 8352321}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/fr-survival.tex", "start": 8352321, "end": 8366383}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/gnus-logo.eps", "start": 8366383, "end": 8431407}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/gnus-logo.pdf", "start": 8431407, "end": 8435065}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/gnus-refcard.tex", "start": 8435065, "end": 8496423}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/orgcard.tex", "start": 8496423, "end": 8520781}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/pdflayout.sty", "start": 8520781, "end": 8522085}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/pl-refcard.tex", "start": 8522085, "end": 8557543}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/pt-br-refcard.tex", "start": 8557543, "end": 8579600}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/refcard.tex", "start": 8579600, "end": 8601274}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/ru-refcard.tex", "start": 8601274, "end": 8627176}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/sk-dired-ref.tex", "start": 8627176, "end": 8641507}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/sk-refcard.tex", "start": 8641507, "end": 8663396}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/sk-survival.tex", "start": 8663396, "end": 8676841}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/survival.tex", "start": 8676841, "end": 8688994}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/vipcard.tex", "start": 8688994, "end": 8710751}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/viperCard.tex", "start": 8710751, "end": 8734715}, {"filename": "/usr/local/share/emacs/30.2/etc/rgb.txt", "start": 8734715, "end": 8753759}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/OpenDocument-schema-v1.3+libreoffice.rnc", "start": 8753759, "end": 8787128}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/OpenDocument-schema-v1.3.rnc", "start": 8787128, "end": 9005139}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/README", "start": 9005139, "end": 9011292}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/calstbl.rnc", "start": 9011292, "end": 9018695}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dbcalstbl.rnc", "start": 9018695, "end": 9019457}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dbhier.rnc", "start": 9019457, "end": 9058838}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dbnotn.rnc", "start": 9058838, "end": 9061449}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dbpool.rnc", "start": 9061449, "end": 9203789}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dbstart.rnc", "start": 9203789, "end": 9204142}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/docbook.rnc", "start": 9204142, "end": 9205940}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dotnet-appconfig.rnc", "start": 9205940, "end": 9220053}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dotnet-packages-config.rnc", "start": 9220053, "end": 9220312}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dotnet-packages-props.rnc", "start": 9220312, "end": 9220977}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dotnet-resx.rnc", "start": 9220977, "end": 9222529}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/locate.rnc", "start": 9222529, "end": 9229317}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/msbuild.rnc", "start": 9229317, "end": 9268838}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/nuget.rnc", "start": 9268838, "end": 9269415}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/nuspec.rnc", "start": 9269415, "end": 9272905}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/od-manifest-schema-v1.2-os.rnc", "start": 9272905, "end": 9276720}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/rdfxml.rnc", "start": 9276720, "end": 9282994}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/relaxng.rnc", "start": 9282994, "end": 9285839}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/schemas.xml", "start": 9285839, "end": 9290248}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-applet.rnc", "start": 9290248, "end": 9290689}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-attribs.rnc", "start": 9290689, "end": 9291146}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-base.rnc", "start": 9291146, "end": 9291267}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-bdo.rnc", "start": 9291267, "end": 9291483}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-bform.rnc", "start": 9291483, "end": 9293138}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-btable.rnc", "start": 9293138, "end": 9294113}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-csismap.rnc", "start": 9294113, "end": 9294930}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-datatypes.rnc", "start": 9294930, "end": 9296404}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-edit.rnc", "start": 9296404, "end": 9296737}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-events.rnc", "start": 9296737, "end": 9298393}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-form.rnc", "start": 9298393, "end": 9300047}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-frames.rnc", "start": 9300047, "end": 9300821}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-hypertext.rnc", "start": 9300821, "end": 9301300}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-iframe.rnc", "start": 9301300, "end": 9301765}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-image.rnc", "start": 9301765, "end": 9302055}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-inlstyle.rnc", "start": 9302055, "end": 9302119}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-legacy.rnc", "start": 9302119, "end": 9305661}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-link.rnc", "start": 9305661, "end": 9306063}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-lst.rnc", "start": 9306063, "end": 9306538}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-meta.rnc", "start": 9306538, "end": 9306788}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-nameident.rnc", "start": 9306788, "end": 9307060}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-object.rnc", "start": 9307060, "end": 9307735}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-param.rnc", "start": 9307735, "end": 9307973}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-pres.rnc", "start": 9307973, "end": 9308622}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-ruby.rnc", "start": 9308622, "end": 9309161}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-script.rnc", "start": 9309161, "end": 9309644}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-ssismap.rnc", "start": 9309644, "end": 9309748}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-struct.rnc", "start": 9309748, "end": 9310261}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-table.rnc", "start": 9310261, "end": 9312191}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-text.rnc", "start": 9312191, "end": 9314557}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-tgt.rnc", "start": 9314557, "end": 9314763}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-xstyle.rnc", "start": 9314763, "end": 9315019}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml.rnc", "start": 9315019, "end": 9315973}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xslt.rnc", "start": 9315973, "end": 9326602}, {"filename": "/usr/local/share/emacs/30.2/etc/ses-example.ses", "start": 9326602, "end": 9335231}, {"filename": "/usr/local/share/emacs/30.2/etc/spook.lines", "start": 9335231, "end": 9348020}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/c.srt", "start": 9348020, "end": 9351161}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/cpp.srt", "start": 9351161, "end": 9354327}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/default.srt", "start": 9354327, "end": 9356290}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/doc-cpp.srt", "start": 9356290, "end": 9358907}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/doc-default.srt", "start": 9358907, "end": 9361089}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/doc-java.srt", "start": 9361089, "end": 9363713}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/ede-autoconf.srt", "start": 9363713, "end": 9365506}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/ede-make.srt", "start": 9365506, "end": 9367597}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/el.srt", "start": 9367597, "end": 9374433}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/getset-cpp.srt", "start": 9374433, "end": 9375785}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/java.srt", "start": 9375785, "end": 9379577}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/make.srt", "start": 9379577, "end": 9381160}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/proj-test.srt", "start": 9381160, "end": 9382250}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/template.srt", "start": 9382250, "end": 9386529}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/test.srt", "start": 9386529, "end": 9390750}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/texi.srt", "start": 9390750, "end": 9393443}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/wisent.srt", "start": 9393443, "end": 9395482}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/adwaita-theme.el", "start": 9395482, "end": 9400748}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/deeper-blue-theme.el", "start": 9400748, "end": 9407332}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/dichromacy-theme.el", "start": 9407332, "end": 9414857}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/leuven-dark-theme.el", "start": 9414857, "end": 9482919}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/leuven-theme.el", "start": 9482919, "end": 9553943}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/light-blue-theme.el", "start": 9553943, "end": 9557074}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/manoj-dark-theme.el", "start": 9557074, "end": 9598608}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/misterioso-theme.el", "start": 9598608, "end": 9605691}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-operandi-deuteranopia-theme.el", "start": 9605691, "end": 9620924}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-operandi-theme.el", "start": 9620924, "end": 9635895}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-operandi-tinted-theme.el", "start": 9635895, "end": 9650954}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-operandi-tritanopia-theme.el", "start": 9650954, "end": 9666040}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-themes.el", "start": 9666040, "end": 9877182}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-vivendi-deuteranopia-theme.el", "start": 9877182, "end": 9892438}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-vivendi-theme.el", "start": 9892438, "end": 9907424}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-vivendi-tinted-theme.el", "start": 9907424, "end": 9922509}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-vivendi-tritanopia-theme.el", "start": 9922509, "end": 9937603}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/tango-dark-theme.el", "start": 9937603, "end": 9947408}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/tango-theme.el", "start": 9947408, "end": 9956536}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/tsdh-dark-theme.el", "start": 9956536, "end": 9965142}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/tsdh-light-theme.el", "start": 9965142, "end": 9971326}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/wheatgrass-theme.el", "start": 9971326, "end": 9975867}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/whiteboard-theme.el", "start": 9975867, "end": 9981801}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/wombat-theme.el", "start": 9981801, "end": 9988446}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL", "start": 9988446, "end": 10036349}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.bg", "start": 10036349, "end": 10122029}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.cn", "start": 10122029, "end": 10178107}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.cs", "start": 10178107, "end": 10232513}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.de", "start": 10232513, "end": 10299578}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.el_GR", "start": 10299578, "end": 10395219}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.eo", "start": 10395219, "end": 10442045}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.es", "start": 10442045, "end": 10494905}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.fa", "start": 10494905, "end": 10574469}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.fr", "start": 10574469, "end": 10629078}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.he", "start": 10629078, "end": 10696016}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.it", "start": 10696016, "end": 10750631}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.ja", "start": 10750631, "end": 10803433}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.ko", "start": 10803433, "end": 10857333}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.nl", "start": 10857333, "end": 10911451}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.pl", "start": 10911451, "end": 10967083}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.pt_BR", "start": 10967083, "end": 11014276}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.ro", "start": 11014276, "end": 11063778}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.ru", "start": 11063778, "end": 11151205}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.sk", "start": 11151205, "end": 11201464}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.sl", "start": 11201464, "end": 11250745}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.sv", "start": 11250745, "end": 11302093}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.th", "start": 11302093, "end": 11424136}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.translators", "start": 11424136, "end": 11427194}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.uk", "start": 11427194, "end": 11510729}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.zh", "start": 11510729, "end": 11569136}, {"filename": "/usr/local/share/emacs/30.2/etc/w32-feature.el", "start": 11569136, "end": 11572502}, {"filename": "/usr/local/share/emacs/30.2/etc/yow.lines", "start": 11572502, "end": 11572902}, {"filename": "/usr/local/share/emacs/30.2/lisp/COPYING", "start": 11572902, "end": 11608051}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.1", "start": 11608051, "end": 11706452}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.10", "start": 11706452, "end": 12585480}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.11", "start": 12585480, "end": 13122670}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.12", "start": 13122670, "end": 14373341}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.13", "start": 14373341, "end": 14998698}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.14", "start": 14998698, "end": 15771928}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.15", "start": 15771928, "end": 16641486}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.16", "start": 16641486, "end": 17580756}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.17", "start": 17580756, "end": 18576461}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.2", "start": 18576461, "end": 18701206}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.3", "start": 18701206, "end": 19145296}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.4", "start": 19145296, "end": 19464395}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.5", "start": 19464395, "end": 19805023}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.6", "start": 19805023, "end": 20097318}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.7", "start": 20097318, "end": 20943503}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.8", "start": 20943503, "end": 21292285}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.9", "start": 21292285, "end": 22043188}, {"filename": "/usr/local/share/emacs/30.2/lisp/Makefile.in", "start": 22043188, "end": 22066020}, {"filename": "/usr/local/share/emacs/30.2/lisp/README", "start": 22066020, "end": 22066557}, {"filename": "/usr/local/share/emacs/30.2/lisp/abbrev.el", "start": 22066557, "end": 22119164}, {"filename": "/usr/local/share/emacs/30.2/lisp/abbrev.elc", "start": 22119164, "end": 22164265}, {"filename": "/usr/local/share/emacs/30.2/lisp/align.el", "start": 22164265, "end": 22224786}, {"filename": "/usr/local/share/emacs/30.2/lisp/align.elc", "start": 22224786, "end": 22266408}, {"filename": "/usr/local/share/emacs/30.2/lisp/allout-widgets.el", "start": 22266408, "end": 22367076}, {"filename": "/usr/local/share/emacs/30.2/lisp/allout-widgets.elc", "start": 22367076, "end": 22427013}, {"filename": "/usr/local/share/emacs/30.2/lisp/allout.el", "start": 22427013, "end": 22692706}, {"filename": "/usr/local/share/emacs/30.2/lisp/allout.elc", "start": 22692706, "end": 22884545}, {"filename": "/usr/local/share/emacs/30.2/lisp/ansi-color.el", "start": 22884545, "end": 22924439}, {"filename": "/usr/local/share/emacs/30.2/lisp/ansi-color.elc", "start": 22924439, "end": 22954270}, {"filename": "/usr/local/share/emacs/30.2/lisp/ansi-osc.el", "start": 22954270, "end": 22962375}, {"filename": "/usr/local/share/emacs/30.2/lisp/ansi-osc.elc", "start": 22962375, "end": 22968190}, {"filename": "/usr/local/share/emacs/30.2/lisp/apropos.el", "start": 22968190, "end": 23021223}, {"filename": "/usr/local/share/emacs/30.2/lisp/apropos.elc", "start": 23021223, "end": 23063038}, {"filename": "/usr/local/share/emacs/30.2/lisp/arc-mode.el", "start": 23063038, "end": 23162991}, {"filename": "/usr/local/share/emacs/30.2/lisp/arc-mode.elc", "start": 23162991, "end": 23246204}, {"filename": "/usr/local/share/emacs/30.2/lisp/array.el", "start": 23246204, "end": 23280822}, {"filename": "/usr/local/share/emacs/30.2/lisp/array.elc", "start": 23280822, "end": 23307738}, {"filename": "/usr/local/share/emacs/30.2/lisp/auth-source-pass.el", "start": 23307738, "end": 23326892}, {"filename": "/usr/local/share/emacs/30.2/lisp/auth-source-pass.elc", "start": 23326892, "end": 23342812}, {"filename": "/usr/local/share/emacs/30.2/lisp/auth-source.el", "start": 23342812, "end": 23455981}, {"filename": "/usr/local/share/emacs/30.2/lisp/auth-source.elc", "start": 23455981, "end": 23526482}, {"filename": "/usr/local/share/emacs/30.2/lisp/autoinsert.el", "start": 23526482, "end": 23541786}, {"filename": "/usr/local/share/emacs/30.2/lisp/autoinsert.elc", "start": 23541786, "end": 23555857}, {"filename": "/usr/local/share/emacs/30.2/lisp/autorevert.el", "start": 23555857, "end": 23595709}, {"filename": "/usr/local/share/emacs/30.2/lisp/autorevert.elc", "start": 23595709, "end": 23629148}, {"filename": "/usr/local/share/emacs/30.2/lisp/avoid.el", "start": 23629148, "end": 23647384}, {"filename": "/usr/local/share/emacs/30.2/lisp/avoid.elc", "start": 23647384, "end": 23659241}, {"filename": "/usr/local/share/emacs/30.2/lisp/battery.el", "start": 23659241, "end": 23710356}, {"filename": "/usr/local/share/emacs/30.2/lisp/battery.elc", "start": 23710356, "end": 23750192}, {"filename": "/usr/local/share/emacs/30.2/lisp/bind-key.el", "start": 23750192, "end": 23773647}, {"filename": "/usr/local/share/emacs/30.2/lisp/bind-key.elc", "start": 23773647, "end": 23789384}, {"filename": "/usr/local/share/emacs/30.2/lisp/bindings.el", "start": 23789384, "end": 23856163}, {"filename": "/usr/local/share/emacs/30.2/lisp/bindings.elc", "start": 23856163, "end": 23908761}, {"filename": "/usr/local/share/emacs/30.2/lisp/bookmark.el", "start": 23908761, "end": 24018256}, {"filename": "/usr/local/share/emacs/30.2/lisp/bookmark.elc", "start": 24018256, "end": 24106649}, {"filename": "/usr/local/share/emacs/30.2/lisp/bs.el", "start": 24106649, "end": 24163352}, {"filename": "/usr/local/share/emacs/30.2/lisp/bs.elc", "start": 24163352, "end": 24212853}, {"filename": "/usr/local/share/emacs/30.2/lisp/buff-menu.el", "start": 24212853, "end": 24249119}, {"filename": "/usr/local/share/emacs/30.2/lisp/buff-menu.elc", "start": 24249119, "end": 24283630}, {"filename": "/usr/local/share/emacs/30.2/lisp/button.el", "start": 24283630, "end": 24309868}, {"filename": "/usr/local/share/emacs/30.2/lisp/button.elc", "start": 24309868, "end": 24330775}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-aent.el", "start": 24330775, "end": 24374569}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-aent.elc", "start": 24374569, "end": 24401337}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-alg.el", "start": 24401337, "end": 24468711}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-alg.elc", "start": 24468711, "end": 24518809}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-arith.el", "start": 24518809, "end": 24615596}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-arith.elc", "start": 24615596, "end": 24699267}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-bin.el", "start": 24699267, "end": 24720960}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-bin.elc", "start": 24720960, "end": 24739034}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-comb.el", "start": 24739034, "end": 24774369}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-comb.elc", "start": 24774369, "end": 24803881}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-cplx.el", "start": 24803881, "end": 24813945}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-cplx.elc", "start": 24813945, "end": 24822172}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-embed.el", "start": 24822172, "end": 24873209}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-embed.elc", "start": 24873209, "end": 24902836}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-ext.el", "start": 24902836, "end": 25032602}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-ext.elc", "start": 25032602, "end": 25141698}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-fin.el", "start": 25141698, "end": 25155069}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-fin.elc", "start": 25155069, "end": 25166943}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-forms.el", "start": 25166943, "end": 25252002}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-forms.elc", "start": 25252002, "end": 25309665}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-frac.el", "start": 25309665, "end": 25316473}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-frac.elc", "start": 25316473, "end": 25322672}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-funcs.el", "start": 25322672, "end": 25355777}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-funcs.elc", "start": 25355777, "end": 25382356}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-graph.el", "start": 25382356, "end": 25438783}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-graph.elc", "start": 25438783, "end": 25475051}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-help.el", "start": 25475051, "end": 25501811}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-help.elc", "start": 25501811, "end": 25523789}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-incom.el", "start": 25523789, "end": 25531062}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-incom.elc", "start": 25531062, "end": 25536049}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-keypd.el", "start": 25536049, "end": 25557210}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-keypd.elc", "start": 25557210, "end": 25572441}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-lang.el", "start": 25572441, "end": 25660614}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-lang.elc", "start": 25660614, "end": 25721180}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-loaddefs.el", "start": 25721180, "end": 25730261}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-loaddefs.elc", "start": 25730261, "end": 25739386}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-macs.el", "start": 25739386, "end": 25744063}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-macs.elc", "start": 25744063, "end": 25750958}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-map.el", "start": 25750958, "end": 25791970}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-map.elc", "start": 25791970, "end": 25821221}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-math.el", "start": 25821221, "end": 25890309}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-math.elc", "start": 25890309, "end": 25950719}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-menu.el", "start": 25950719, "end": 26013227}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-menu.elc", "start": 26013227, "end": 26052537}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-misc.el", "start": 26052537, "end": 26082538}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-misc.elc", "start": 26082538, "end": 26105026}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-mode.el", "start": 26105026, "end": 26127138}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-mode.elc", "start": 26127138, "end": 26149045}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-mtx.el", "start": 26149045, "end": 26159857}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-mtx.elc", "start": 26159857, "end": 26166795}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-nlfit.el", "start": 26166795, "end": 26196993}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-nlfit.elc", "start": 26196993, "end": 26210354}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-poly.el", "start": 26210354, "end": 26250239}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-poly.elc", "start": 26250239, "end": 26275617}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-prog.el", "start": 26275617, "end": 26349950}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-prog.elc", "start": 26349950, "end": 26403004}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-rewr.el", "start": 26403004, "end": 26477597}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-rewr.elc", "start": 26477597, "end": 26518166}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-rules.el", "start": 26518166, "end": 26535911}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-rules.elc", "start": 26535911, "end": 26553387}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-sel.el", "start": 26553387, "end": 26581313}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-sel.elc", "start": 26581313, "end": 26601621}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-stat.el", "start": 26601621, "end": 26619828}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-stat.elc", "start": 26619828, "end": 26634039}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-store.el", "start": 26634039, "end": 26657307}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-store.elc", "start": 26657307, "end": 26676033}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-stuff.el", "start": 26676033, "end": 26685656}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-stuff.elc", "start": 26685656, "end": 26693273}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-trail.el", "start": 26693273, "end": 26697991}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-trail.elc", "start": 26697991, "end": 26702414}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-undo.el", "start": 26702414, "end": 26707043}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-undo.elc", "start": 26707043, "end": 26710092}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-units.el", "start": 26710092, "end": 26788994}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-units.elc", "start": 26788994, "end": 26845174}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-vec.el", "start": 26845174, "end": 26896045}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-vec.elc", "start": 26896045, "end": 26936892}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-yank.el", "start": 26936892, "end": 26965507}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-yank.elc", "start": 26965507, "end": 26987153}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc.el", "start": 26987153, "end": 27115519}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc.elc", "start": 27115519, "end": 27220934}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calcalg2.el", "start": 27220934, "end": 27349948}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calcalg2.elc", "start": 27349948, "end": 27432727}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calcalg3.el", "start": 27432727, "end": 27498765}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calcalg3.elc", "start": 27498765, "end": 27541072}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calccomp.el", "start": 27541072, "end": 27604799}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calccomp.elc", "start": 27604799, "end": 27640636}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calcsel2.el", "start": 27640636, "end": 27650041}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calcsel2.elc", "start": 27650041, "end": 27655734}, {"filename": "/usr/local/share/emacs/30.2/lisp/calculator.el", "start": 27655734, "end": 27723340}, {"filename": "/usr/local/share/emacs/30.2/lisp/calculator.elc", "start": 27723340, "end": 27777531}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/appt.el", "start": 27777531, "end": 27810231}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/appt.elc", "start": 27810231, "end": 27828851}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-bahai.el", "start": 27828851, "end": 27843459}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-bahai.elc", "start": 27843459, "end": 27855654}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-china.el", "start": 27855654, "end": 27891655}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-china.elc", "start": 27891655, "end": 27923249}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-coptic.el", "start": 27923249, "end": 27933892}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-coptic.elc", "start": 27933892, "end": 27942655}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-dst.el", "start": 27942655, "end": 27963294}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-dst.elc", "start": 27963294, "end": 27981202}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-french.el", "start": 27981202, "end": 28000813}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-french.elc", "start": 28000813, "end": 28016149}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-hebrew.el", "start": 28016149, "end": 28069791}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-hebrew.elc", "start": 28069791, "end": 28117443}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-html.el", "start": 28117443, "end": 28134917}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-html.elc", "start": 28134917, "end": 28151458}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-islam.el", "start": 28151458, "end": 28165864}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-islam.elc", "start": 28165864, "end": 28178439}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-iso.el", "start": 28178439, "end": 28184388}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-iso.elc", "start": 28184388, "end": 28190702}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-julian.el", "start": 28190702, "end": 28199294}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-julian.elc", "start": 28199294, "end": 28207104}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-loaddefs.el", "start": 28207104, "end": 28236478}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-loaddefs.elc", "start": 28236478, "end": 28266794}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-mayan.el", "start": 28266794, "end": 28282013}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-mayan.elc", "start": 28282013, "end": 28299742}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-menu.el", "start": 28299742, "end": 28312021}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-menu.elc", "start": 28312021, "end": 28321667}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-move.el", "start": 28321667, "end": 28337780}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-move.elc", "start": 28337780, "end": 28351873}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-persia.el", "start": 28351873, "end": 28360375}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-persia.elc", "start": 28360375, "end": 28366552}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-tex.el", "start": 28366552, "end": 28438264}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-tex.elc", "start": 28438264, "end": 28512394}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-x.el", "start": 28512394, "end": 28518202}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-x.elc", "start": 28518202, "end": 28522654}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/calendar.el", "start": 28522654, "end": 28643403}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/calendar.elc", "start": 28643403, "end": 28745959}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/diary-lib.el", "start": 28745959, "end": 28865185}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/diary-lib.elc", "start": 28865185, "end": 28969964}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/diary-loaddefs.el", "start": 28969964, "end": 28979554}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/diary-loaddefs.elc", "start": 28979554, "end": 28988870}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/holiday-loaddefs.el", "start": 28988870, "end": 28993289}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/holiday-loaddefs.elc", "start": 28993289, "end": 28997493}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/holidays.el", "start": 28997493, "end": 29032103}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/holidays.elc", "start": 29032103, "end": 29065012}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/icalendar.el", "start": 29065012, "end": 29177680}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/icalendar.elc", "start": 29177680, "end": 29236596}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/iso8601.el", "start": 29236596, "end": 29253073}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/iso8601.elc", "start": 29253073, "end": 29262679}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/lunar.el", "start": 29262679, "end": 29282531}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/lunar.elc", "start": 29282531, "end": 29294891}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/parse-time.el", "start": 29294891, "end": 29303333}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/parse-time.elc", "start": 29303333, "end": 29309191}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/solar.el", "start": 29309191, "end": 29353604}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/solar.elc", "start": 29353604, "end": 29391855}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/time-date.el", "start": 29391855, "end": 29415503}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/time-date.elc", "start": 29415503, "end": 29431271}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/timeclock.el", "start": 29431271, "end": 29481463}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/timeclock.elc", "start": 29481463, "end": 29530387}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/todo-mode.el", "start": 29530387, "end": 29804779}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/todo-mode.elc", "start": 29804779, "end": 30005942}, {"filename": "/usr/local/share/emacs/30.2/lisp/case-table.el", "start": 30005942, "end": 30013204}, {"filename": "/usr/local/share/emacs/30.2/lisp/case-table.elc", "start": 30013204, "end": 30017902}, {"filename": "/usr/local/share/emacs/30.2/lisp/cdl.el", "start": 30017902, "end": 30019554}, {"filename": "/usr/local/share/emacs/30.2/lisp/cdl.elc", "start": 30019554, "end": 30020309}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ChangeLog.1", "start": 30020309, "end": 30155471}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet-cscope.el", "start": 30155471, "end": 30161071}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet-cscope.elc", "start": 30161071, "end": 30165221}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet-files.el", "start": 30165221, "end": 30169398}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet-files.elc", "start": 30169398, "end": 30171435}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet-global.el", "start": 30171435, "end": 30178162}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet-global.elc", "start": 30178162, "end": 30183241}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet-idutils.el", "start": 30183241, "end": 30189809}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet-idutils.elc", "start": 30189809, "end": 30194818}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet.el", "start": 30194818, "end": 30199745}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet.elc", "start": 30199745, "end": 30203231}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/data-debug.el", "start": 30203231, "end": 30238631}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/data-debug.elc", "start": 30238631, "end": 30265979}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede.el", "start": 30265979, "end": 30321528}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede.elc", "start": 30321528, "end": 30368762}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/auto.el", "start": 30368762, "end": 30381312}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/auto.elc", "start": 30381312, "end": 30392145}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/autoconf-edit.el", "start": 30392145, "end": 30407012}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/autoconf-edit.elc", "start": 30407012, "end": 30418433}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/base.el", "start": 30418433, "end": 30441032}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/base.elc", "start": 30441032, "end": 30464197}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/config.el", "start": 30464197, "end": 30479176}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/config.elc", "start": 30479176, "end": 30505145}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/cpp-root.el", "start": 30505145, "end": 30523565}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/cpp-root.elc", "start": 30523565, "end": 30535193}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/custom.el", "start": 30535193, "end": 30543195}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/custom.elc", "start": 30543195, "end": 30548299}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/detect.el", "start": 30548299, "end": 30555088}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/detect.elc", "start": 30555088, "end": 30558617}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/dired.el", "start": 30558617, "end": 30561742}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/dired.elc", "start": 30561742, "end": 30565428}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/emacs.el", "start": 30565428, "end": 30573416}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/emacs.elc", "start": 30573416, "end": 30583966}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/files.el", "start": 30583966, "end": 30604370}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/files.elc", "start": 30604370, "end": 30617440}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/generic.el", "start": 30617440, "end": 30630882}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/generic.elc", "start": 30630882, "end": 30652334}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/linux.el", "start": 30652334, "end": 30665638}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/linux.elc", "start": 30665638, "end": 30680076}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/loaddefs.el", "start": 30680076, "end": 30684924}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/loaddefs.elc", "start": 30684924, "end": 30689397}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/locate.el", "start": 30689397, "end": 30701777}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/locate.elc", "start": 30701777, "end": 30716826}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/make.el", "start": 30716826, "end": 30720037}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/make.elc", "start": 30720037, "end": 30722008}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/makefile-edit.el", "start": 30722008, "end": 30726087}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/makefile-edit.elc", "start": 30726087, "end": 30728462}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/pconf.el", "start": 30728462, "end": 30735740}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/pconf.elc", "start": 30735740, "end": 30740497}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/pmake.el", "start": 30740497, "end": 30764622}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/pmake.elc", "start": 30764622, "end": 30783014}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-archive.el", "start": 30783014, "end": 30785349}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-archive.elc", "start": 30785349, "end": 30788521}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-aux.el", "start": 30788521, "end": 30790105}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-aux.elc", "start": 30790105, "end": 30791941}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-comp.el", "start": 30791941, "end": 30804647}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-comp.elc", "start": 30804647, "end": 30820379}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-elisp.el", "start": 30820379, "end": 30835642}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-elisp.elc", "start": 30835642, "end": 30852580}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-info.el", "start": 30852580, "end": 30859088}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-info.elc", "start": 30859088, "end": 30866176}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-misc.el", "start": 30866176, "end": 30869249}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-misc.elc", "start": 30869249, "end": 30872492}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-obj.el", "start": 30872492, "end": 30881809}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-obj.elc", "start": 30881809, "end": 30892427}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-prog.el", "start": 30892427, "end": 30897258}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-prog.elc", "start": 30897258, "end": 30903525}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-scheme.el", "start": 30903525, "end": 30905176}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-scheme.elc", "start": 30905176, "end": 30906969}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-shared.el", "start": 30906969, "end": 30914023}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-shared.elc", "start": 30914023, "end": 30920606}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj.el", "start": 30920606, "end": 30948208}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj.elc", "start": 30948208, "end": 30974668}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/project-am.el", "start": 30974668, "end": 31010084}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/project-am.elc", "start": 31010084, "end": 31054003}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/shell.el", "start": 31054003, "end": 31056907}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/shell.elc", "start": 31056907, "end": 31058220}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/simple.el", "start": 31058220, "end": 31062351}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/simple.elc", "start": 31062351, "end": 31066969}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/source.el", "start": 31066969, "end": 31073018}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/source.elc", "start": 31073018, "end": 31078124}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/speedbar.el", "start": 31078124, "end": 31090755}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/speedbar.elc", "start": 31090755, "end": 31100680}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/srecode.el", "start": 31100680, "end": 31103979}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/srecode.elc", "start": 31103979, "end": 31105774}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/system.el", "start": 31105774, "end": 31110551}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/system.elc", "start": 31110551, "end": 31113148}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/util.el", "start": 31113148, "end": 31116741}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/util.elc", "start": 31116741, "end": 31118966}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/mode-local.el", "start": 31118966, "end": 31154219}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/mode-local.elc", "start": 31154219, "end": 31186273}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/pulse.el", "start": 31186273, "end": 31194639}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/pulse.elc", "start": 31194639, "end": 31200098}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic.el", "start": 31200098, "end": 31246880}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic.elc", "start": 31246880, "end": 31290301}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze.el", "start": 31290301, "end": 31322546}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze.elc", "start": 31322546, "end": 31352076}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze/complete.el", "start": 31352076, "end": 31361889}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze/complete.elc", "start": 31361889, "end": 31369356}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze/debug.el", "start": 31369356, "end": 31388589}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze/debug.elc", "start": 31388589, "end": 31405633}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze/fcn.el", "start": 31405633, "end": 31417425}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze/fcn.elc", "start": 31417425, "end": 31427280}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze/refs.el", "start": 31427280, "end": 31439963}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze/refs.elc", "start": 31439963, "end": 31450080}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine.el", "start": 31450080, "end": 31462907}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine.elc", "start": 31462907, "end": 31467438}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/c.el", "start": 31467438, "end": 31550668}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/c.elc", "start": 31550668, "end": 31646927}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/debug.el", "start": 31646927, "end": 31651700}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/debug.elc", "start": 31651700, "end": 31658564}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/el.el", "start": 31658564, "end": 31688639}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/el.elc", "start": 31688639, "end": 31724201}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/gcc.el", "start": 31724201, "end": 31734483}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/gcc.elc", "start": 31734483, "end": 31739143}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/grammar.el", "start": 31739143, "end": 31761107}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/grammar.elc", "start": 31761107, "end": 31779836}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/make.el", "start": 31779836, "end": 31788365}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/make.elc", "start": 31788365, "end": 31803017}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/scm.el", "start": 31803017, "end": 31807123}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/scm.elc", "start": 31807123, "end": 31815526}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/chart.el", "start": 31815526, "end": 31821056}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/chart.elc", "start": 31821056, "end": 31825133}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/complete.el", "start": 31825133, "end": 31911844}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/complete.elc", "start": 31911844, "end": 31989738}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/ctxt.el", "start": 31989738, "end": 32014838}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/ctxt.elc", "start": 32014838, "end": 32049670}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-debug.el", "start": 32049670, "end": 32053158}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-debug.elc", "start": 32053158, "end": 32055486}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-ebrowse.el", "start": 32055486, "end": 32079105}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-ebrowse.elc", "start": 32079105, "end": 32100593}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-el.el", "start": 32100593, "end": 32113539}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-el.elc", "start": 32113539, "end": 32128761}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-file.el", "start": 32128761, "end": 32145482}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-file.elc", "start": 32145482, "end": 32160108}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-find.el", "start": 32160108, "end": 32214660}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-find.elc", "start": 32214660, "end": 32256975}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-global.el", "start": 32256975, "end": 32265766}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-global.elc", "start": 32265766, "end": 32276225}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-javascript.el", "start": 32276225, "end": 32287482}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-javascript.elc", "start": 32287482, "end": 32300162}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-mode.el", "start": 32300162, "end": 32307660}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-mode.elc", "start": 32307660, "end": 32314556}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-ref.el", "start": 32314556, "end": 32320415}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-ref.elc", "start": 32320415, "end": 32325168}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-typecache.el", "start": 32325168, "end": 32346607}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-typecache.elc", "start": 32346607, "end": 32364711}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db.el", "start": 32364711, "end": 32404897}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db.elc", "start": 32404897, "end": 32445085}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/debug.el", "start": 32445085, "end": 32463904}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/debug.elc", "start": 32463904, "end": 32481682}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/decorate.el", "start": 32481682, "end": 32492671}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/decorate.elc", "start": 32492671, "end": 32500800}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/decorate/include.el", "start": 32500800, "end": 32531329}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/decorate/include.elc", "start": 32531329, "end": 32562512}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/decorate/mode.el", "start": 32562512, "end": 32583797}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/decorate/mode.elc", "start": 32583797, "end": 32616809}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/dep.el", "start": 32616809, "end": 32624830}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/dep.elc", "start": 32624830, "end": 32631788}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/doc.el", "start": 32631788, "end": 32637208}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/doc.elc", "start": 32637208, "end": 32640988}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/ede-grammar.el", "start": 32640988, "end": 32648738}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/ede-grammar.elc", "start": 32648738, "end": 32658640}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/edit.el", "start": 32658640, "end": 32697536}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/edit.elc", "start": 32697536, "end": 32717427}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/find.el", "start": 32717427, "end": 32744862}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/find.elc", "start": 32744862, "end": 32768373}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/format.el", "start": 32768373, "end": 32795582}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/format.elc", "start": 32795582, "end": 32828125}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/fw.el", "start": 32828125, "end": 32845532}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/fw.elc", "start": 32845532, "end": 32857791}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/grammar.el", "start": 32857791, "end": 32931916}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/grammar.elc", "start": 32931916, "end": 33010810}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/grm-wy-boot.el", "start": 33010810, "end": 33022835}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/grm-wy-boot.elc", "start": 33022835, "end": 33073706}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/html.el", "start": 33073706, "end": 33082459}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/html.elc", "start": 33082459, "end": 33089634}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/ia-sb.el", "start": 33089634, "end": 33101507}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/ia-sb.elc", "start": 33101507, "end": 33111058}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/ia.el", "start": 33111058, "end": 33128380}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/ia.elc", "start": 33128380, "end": 33139496}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/idle.el", "start": 33139496, "end": 33187256}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/idle.elc", "start": 33187256, "end": 33251888}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/imenu.el", "start": 33251888, "end": 33271206}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/imenu.elc", "start": 33271206, "end": 33283176}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/java.el", "start": 33283176, "end": 33299970}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/java.elc", "start": 33299970, "end": 33316822}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/lex-spp.el", "start": 33316822, "end": 33365052}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/lex-spp.elc", "start": 33365052, "end": 33397893}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/lex.el", "start": 33397893, "end": 33468488}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/lex.elc", "start": 33468488, "end": 33541257}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/loaddefs.el", "start": 33541257, "end": 33599804}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/loaddefs.elc", "start": 33599804, "end": 33657455}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/mru-bookmark.el", "start": 33657455, "end": 33671153}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/mru-bookmark.elc", "start": 33671153, "end": 33687764}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/sb.el", "start": 33687764, "end": 33702828}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/sb.elc", "start": 33702828, "end": 33714054}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/scope.el", "start": 33714054, "end": 33745506}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/scope.elc", "start": 33745506, "end": 33769454}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/senator.el", "start": 33769454, "end": 33801991}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/senator.elc", "start": 33801991, "end": 33831876}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/sort.el", "start": 33831876, "end": 33852386}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/sort.elc", "start": 33852386, "end": 33870217}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref.el", "start": 33870217, "end": 33892013}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref.elc", "start": 33892013, "end": 33908630}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/cscope.el", "start": 33908630, "end": 33912192}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/cscope.elc", "start": 33912192, "end": 33915289}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/filter.el", "start": 33915289, "end": 33921083}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/filter.elc", "start": 33921083, "end": 33925168}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/global.el", "start": 33925168, "end": 33927989}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/global.elc", "start": 33927989, "end": 33930776}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/grep.el", "start": 33930776, "end": 33939340}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/grep.elc", "start": 33939340, "end": 33945594}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/idutils.el", "start": 33945594, "end": 33948564}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/idutils.elc", "start": 33948564, "end": 33951464}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/list.el", "start": 33951464, "end": 33969298}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/list.elc", "start": 33969298, "end": 33984656}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/tag-file.el", "start": 33984656, "end": 33992336}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/tag-file.elc", "start": 33992336, "end": 33997624}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/tag-ls.el", "start": 33997624, "end": 34015039}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/tag-ls.elc", "start": 34015039, "end": 34037849}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/tag-write.el", "start": 34037849, "end": 34043342}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/tag-write.elc", "start": 34043342, "end": 34046877}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/tag.el", "start": 34046877, "end": 34097443}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/tag.elc", "start": 34097443, "end": 34154845}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/texi.el", "start": 34154845, "end": 34179347}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/texi.elc", "start": 34179347, "end": 34196783}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/util-modes.el", "start": 34196783, "end": 34233538}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/util-modes.elc", "start": 34233538, "end": 34284621}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/util.el", "start": 34284621, "end": 34300710}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/util.elc", "start": 34300710, "end": 34313310}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent.el", "start": 34313310, "end": 34326485}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent.elc", "start": 34326485, "end": 34334178}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/comp.el", "start": 34334178, "end": 34461576}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/comp.elc", "start": 34461576, "end": 34564967}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/grammar.el", "start": 34564967, "end": 34588087}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/grammar.elc", "start": 34588087, "end": 34613137}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/java-tags.el", "start": 34613137, "end": 34617846}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/java-tags.elc", "start": 34617846, "end": 34621377}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/javascript.el", "start": 34621377, "end": 34627219}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/javascript.elc", "start": 34627219, "end": 34632647}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/python.el", "start": 34632647, "end": 34655619}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/python.elc", "start": 34655619, "end": 34681345}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/wisent.el", "start": 34681345, "end": 34699774}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/wisent.elc", "start": 34699774, "end": 34713897}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode.el", "start": 34713897, "end": 34715820}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode.elc", "start": 34715820, "end": 34716351}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/args.el", "start": 34716351, "end": 34724861}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/args.elc", "start": 34724861, "end": 34729243}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/compile.el", "start": 34729243, "end": 34750332}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/compile.elc", "start": 34750332, "end": 34766497}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/cpp.el", "start": 34766497, "end": 34774473}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/cpp.elc", "start": 34774473, "end": 34779365}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/ctxt.el", "start": 34779365, "end": 34787932}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/ctxt.elc", "start": 34787932, "end": 34793601}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/dictionary.el", "start": 34793601, "end": 34815947}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/dictionary.elc", "start": 34815947, "end": 34836706}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/document.el", "start": 34836706, "end": 34863578}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/document.elc", "start": 34863578, "end": 34881974}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/el.el", "start": 34881974, "end": 34885547}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/el.elc", "start": 34885547, "end": 34887816}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/expandproto.el", "start": 34887816, "end": 34891729}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/expandproto.elc", "start": 34891729, "end": 34893688}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/extract.el", "start": 34893688, "end": 34902081}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/extract.elc", "start": 34902081, "end": 34908702}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/fields.el", "start": 34908702, "end": 34923248}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/fields.elc", "start": 34923248, "end": 34939137}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/filters.el", "start": 34939137, "end": 34941047}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/filters.elc", "start": 34941047, "end": 34941630}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/find.el", "start": 34941630, "end": 34951581}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/find.elc", "start": 34951581, "end": 34958740}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/getset.el", "start": 34958740, "end": 34969957}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/getset.elc", "start": 34969957, "end": 34977326}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/insert.el", "start": 34977326, "end": 35016830}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/insert.elc", "start": 35016830, "end": 35059725}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/java.el", "start": 35059725, "end": 35062701}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/java.elc", "start": 35062701, "end": 35064033}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/loaddefs.el", "start": 35064033, "end": 35071415}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/loaddefs.elc", "start": 35071415, "end": 35078473}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/map.el", "start": 35078473, "end": 35092027}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/map.elc", "start": 35092027, "end": 35102681}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/mode.el", "start": 35102681, "end": 35114940}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/mode.elc", "start": 35114940, "end": 35127683}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/semantic.el", "start": 35127683, "end": 35142160}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/semantic.elc", "start": 35142160, "end": 35153636}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/srt-mode.el", "start": 35153636, "end": 35177725}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/srt-mode.elc", "start": 35177725, "end": 35200979}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/srt.el", "start": 35200979, "end": 35204723}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/srt.elc", "start": 35204723, "end": 35207196}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/table.el", "start": 35207196, "end": 35217112}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/table.elc", "start": 35217112, "end": 35226809}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/template.el", "start": 35226809, "end": 35229097}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/template.elc", "start": 35229097, "end": 35230521}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/texi.el", "start": 35230521, "end": 35240447}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/texi.elc", "start": 35240447, "end": 35248918}, {"filename": "/usr/local/share/emacs/30.2/lisp/char-fold.el", "start": 35248918, "end": 35272155}, {"filename": "/usr/local/share/emacs/30.2/lisp/char-fold.elc", "start": 35272155, "end": 35597567}, {"filename": "/usr/local/share/emacs/30.2/lisp/chistory.el", "start": 35597567, "end": 35604352}, {"filename": "/usr/local/share/emacs/30.2/lisp/chistory.elc", "start": 35604352, "end": 35612318}, {"filename": "/usr/local/share/emacs/30.2/lisp/cmuscheme.el", "start": 35612318, "end": 35633677}, {"filename": "/usr/local/share/emacs/30.2/lisp/cmuscheme.elc", "start": 35633677, "end": 35652398}, {"filename": "/usr/local/share/emacs/30.2/lisp/color.el", "start": 35652398, "end": 35671075}, {"filename": "/usr/local/share/emacs/30.2/lisp/color.elc", "start": 35671075, "end": 35685119}, {"filename": "/usr/local/share/emacs/30.2/lisp/comint.el", "start": 35685119, "end": 35871937}, {"filename": "/usr/local/share/emacs/30.2/lisp/comint.elc", "start": 35871937, "end": 36007395}, {"filename": "/usr/local/share/emacs/30.2/lisp/completion-preview.el", "start": 36007395, "end": 36038069}, {"filename": "/usr/local/share/emacs/30.2/lisp/completion-preview.elc", "start": 36038069, "end": 36067423}, {"filename": "/usr/local/share/emacs/30.2/lisp/completion.el", "start": 36067423, "end": 36153058}, {"filename": "/usr/local/share/emacs/30.2/lisp/completion.elc", "start": 36153058, "end": 36195488}, {"filename": "/usr/local/share/emacs/30.2/lisp/composite.el", "start": 36195488, "end": 36231313}, {"filename": "/usr/local/share/emacs/30.2/lisp/composite.elc", "start": 36231313, "end": 36263731}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-dep.el", "start": 36263731, "end": 36274233}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-dep.elc", "start": 36274233, "end": 36280978}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-edit.el", "start": 36280978, "end": 36507261}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-edit.elc", "start": 36507261, "end": 36685764}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-face.el", "start": 36685764, "end": 36701304}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-face.elc", "start": 36701304, "end": 36712602}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-start.el", "start": 36712602, "end": 36753994}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-start.elc", "start": 36753994, "end": 36778496}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-theme.el", "start": 36778496, "end": 36805675}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-theme.elc", "start": 36805675, "end": 36831338}, {"filename": "/usr/local/share/emacs/30.2/lisp/custom.el", "start": 36831338, "end": 36904831}, {"filename": "/usr/local/share/emacs/30.2/lisp/custom.elc", "start": 36904831, "end": 36959172}, {"filename": "/usr/local/share/emacs/30.2/lisp/dabbrev.el", "start": 36959172, "end": 37002464}, {"filename": "/usr/local/share/emacs/30.2/lisp/dabbrev.elc", "start": 37002464, "end": 37026517}, {"filename": "/usr/local/share/emacs/30.2/lisp/delim-col.el", "start": 37026517, "end": 37042481}, {"filename": "/usr/local/share/emacs/30.2/lisp/delim-col.elc", "start": 37042481, "end": 37051403}, {"filename": "/usr/local/share/emacs/30.2/lisp/delsel.el", "start": 37051403, "end": 37066341}, {"filename": "/usr/local/share/emacs/30.2/lisp/delsel.elc", "start": 37066341, "end": 37077009}, {"filename": "/usr/local/share/emacs/30.2/lisp/descr-text.el", "start": 37077009, "end": 37120906}, {"filename": "/usr/local/share/emacs/30.2/lisp/descr-text.elc", "start": 37120906, "end": 37146810}, {"filename": "/usr/local/share/emacs/30.2/lisp/desktop.el", "start": 37146810, "end": 37217587}, {"filename": "/usr/local/share/emacs/30.2/lisp/desktop.elc", "start": 37217587, "end": 37269806}, {"filename": "/usr/local/share/emacs/30.2/lisp/dframe.el", "start": 37269806, "end": 37301782}, {"filename": "/usr/local/share/emacs/30.2/lisp/dframe.elc", "start": 37301782, "end": 37321701}, {"filename": "/usr/local/share/emacs/30.2/lisp/dired-aux.el", "start": 37321701, "end": 37487577}, {"filename": "/usr/local/share/emacs/30.2/lisp/dired-aux.elc", "start": 37487577, "end": 37603887}, {"filename": "/usr/local/share/emacs/30.2/lisp/dired-loaddefs.el", "start": 37603887, "end": 37632657}, {"filename": "/usr/local/share/emacs/30.2/lisp/dired-loaddefs.elc", "start": 37632657, "end": 37662255}, {"filename": "/usr/local/share/emacs/30.2/lisp/dired-x.el", "start": 37662255, "end": 37707753}, {"filename": "/usr/local/share/emacs/30.2/lisp/dired-x.elc", "start": 37707753, "end": 37741424}, {"filename": "/usr/local/share/emacs/30.2/lisp/dired.el", "start": 37741424, "end": 37961317}, {"filename": "/usr/local/share/emacs/30.2/lisp/dired.elc", "start": 37961317, "end": 38126933}, {"filename": "/usr/local/share/emacs/30.2/lisp/dirtrack.el", "start": 38126933, "end": 38137379}, {"filename": "/usr/local/share/emacs/30.2/lisp/dirtrack.elc", "start": 38137379, "end": 38145878}, {"filename": "/usr/local/share/emacs/30.2/lisp/disp-table.el", "start": 38145878, "end": 38159552}, {"filename": "/usr/local/share/emacs/30.2/lisp/disp-table.elc", "start": 38159552, "end": 38170428}, {"filename": "/usr/local/share/emacs/30.2/lisp/display-fill-column-indicator.el", "start": 38170428, "end": 38173763}, {"filename": "/usr/local/share/emacs/30.2/lisp/display-fill-column-indicator.elc", "start": 38173763, "end": 38183578}, {"filename": "/usr/local/share/emacs/30.2/lisp/display-line-numbers.el", "start": 38183578, "end": 38192027}, {"filename": "/usr/local/share/emacs/30.2/lisp/display-line-numbers.elc", "start": 38192027, "end": 38206652}, {"filename": "/usr/local/share/emacs/30.2/lisp/dnd.el", "start": 38206652, "end": 38235446}, {"filename": "/usr/local/share/emacs/30.2/lisp/dnd.elc", "start": 38235446, "end": 38256409}, {"filename": "/usr/local/share/emacs/30.2/lisp/doc-view.el", "start": 38256409, "end": 38359767}, {"filename": "/usr/local/share/emacs/30.2/lisp/doc-view.elc", "start": 38359767, "end": 38438405}, {"filename": "/usr/local/share/emacs/30.2/lisp/dom.el", "start": 38438405, "end": 38448115}, {"filename": "/usr/local/share/emacs/30.2/lisp/dom.elc", "start": 38448115, "end": 38456077}, {"filename": "/usr/local/share/emacs/30.2/lisp/dos-fns.el", "start": 38456077, "end": 38467306}, {"filename": "/usr/local/share/emacs/30.2/lisp/dos-fns.elc", "start": 38467306, "end": 38472129}, {"filename": "/usr/local/share/emacs/30.2/lisp/dos-vars.el", "start": 38472129, "end": 38473658}, {"filename": "/usr/local/share/emacs/30.2/lisp/dos-vars.elc", "start": 38473658, "end": 38474562}, {"filename": "/usr/local/share/emacs/30.2/lisp/dos-w32.el", "start": 38474562, "end": 38493773}, {"filename": "/usr/local/share/emacs/30.2/lisp/dos-w32.elc", "start": 38493773, "end": 38505135}, {"filename": "/usr/local/share/emacs/30.2/lisp/double.el", "start": 38505135, "end": 38510694}, {"filename": "/usr/local/share/emacs/30.2/lisp/double.elc", "start": 38510694, "end": 38515268}, {"filename": "/usr/local/share/emacs/30.2/lisp/dynamic-setting.el", "start": 38515268, "end": 38518640}, {"filename": "/usr/local/share/emacs/30.2/lisp/dynamic-setting.elc", "start": 38518640, "end": 38520209}, {"filename": "/usr/local/share/emacs/30.2/lisp/ebuff-menu.el", "start": 38520209, "end": 38530815}, {"filename": "/usr/local/share/emacs/30.2/lisp/ebuff-menu.elc", "start": 38530815, "end": 38541040}, {"filename": "/usr/local/share/emacs/30.2/lisp/echistory.el", "start": 38541040, "end": 38547158}, {"filename": "/usr/local/share/emacs/30.2/lisp/echistory.elc", "start": 38547158, "end": 38551716}, {"filename": "/usr/local/share/emacs/30.2/lisp/ecomplete.el", "start": 38551716, "end": 38564602}, {"filename": "/usr/local/share/emacs/30.2/lisp/ecomplete.elc", "start": 38564602, "end": 38573928}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-conf-mode.el", "start": 38573928, "end": 38577149}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-conf-mode.elc", "start": 38577149, "end": 38580956}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-core-handle.el", "start": 38580956, "end": 38589034}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-core-handle.elc", "start": 38589034, "end": 38605826}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-core.el", "start": 38605826, "end": 38612290}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-core.elc", "start": 38612290, "end": 38614968}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-fnmatch.el", "start": 38614968, "end": 38625771}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-fnmatch.elc", "start": 38625771, "end": 38630351}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-tools.el", "start": 38630351, "end": 38634954}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-tools.elc", "start": 38634954, "end": 38637736}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig.el", "start": 38637736, "end": 38673382}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig.elc", "start": 38673382, "end": 38700219}, {"filename": "/usr/local/share/emacs/30.2/lisp/edmacro.el", "start": 38700219, "end": 38731425}, {"filename": "/usr/local/share/emacs/30.2/lisp/edmacro.elc", "start": 38731425, "end": 38752355}, {"filename": "/usr/local/share/emacs/30.2/lisp/ehelp.el", "start": 38752355, "end": 38769460}, {"filename": "/usr/local/share/emacs/30.2/lisp/ehelp.elc", "start": 38769460, "end": 38780638}, {"filename": "/usr/local/share/emacs/30.2/lisp/elec-pair.el", "start": 38780638, "end": 38812490}, {"filename": "/usr/local/share/emacs/30.2/lisp/elec-pair.elc", "start": 38812490, "end": 38836903}, {"filename": "/usr/local/share/emacs/30.2/lisp/electric.el", "start": 38836903, "end": 38869021}, {"filename": "/usr/local/share/emacs/30.2/lisp/electric.elc", "start": 38869021, "end": 38899828}, {"filename": "/usr/local/share/emacs/30.2/lisp/elide-head.el", "start": 38899828, "end": 38906409}, {"filename": "/usr/local/share/emacs/30.2/lisp/elide-head.elc", "start": 38906409, "end": 38912306}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/advice.el", "start": 38912306, "end": 39051302}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/advice.elc", "start": 39051302, "end": 39105783}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/avl-tree.el", "start": 39105783, "end": 39129613}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/avl-tree.elc", "start": 39129613, "end": 39157919}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/backquote.el", "start": 39157919, "end": 39167554}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/backquote.elc", "start": 39167554, "end": 39171830}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/backtrace.el", "start": 39171830, "end": 39209581}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/backtrace.elc", "start": 39209581, "end": 39251107}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/benchmark.el", "start": 39251107, "end": 39258309}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/benchmark.elc", "start": 39258309, "end": 39263207}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/bindat.el", "start": 39263207, "end": 39299175}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/bindat.elc", "start": 39299175, "end": 39330666}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/byte-opt.el", "start": 39330666, "end": 39466753}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/byte-opt.elc", "start": 39466753, "end": 39528166}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/byte-run.el", "start": 39528166, "end": 39560082}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/byte-run.elc", "start": 39560082, "end": 39582512}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/bytecomp.el", "start": 39582512, "end": 39838661}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/bytecomp.elc", "start": 39838661, "end": 40026577}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cconv.el", "start": 40026577, "end": 40069986}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cconv.elc", "start": 40069986, "end": 40094690}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/chart.el", "start": 40094690, "end": 40121703}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/chart.elc", "start": 40121703, "end": 40149702}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/check-declare.el", "start": 40149702, "end": 40165091}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/check-declare.elc", "start": 40165091, "end": 40174163}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/checkdoc.el", "start": 40174163, "end": 40290856}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/checkdoc.elc", "start": 40290856, "end": 40372885}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-extra.el", "start": 40372885, "end": 40406210}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-extra.elc", "start": 40406210, "end": 40436346}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-generic.el", "start": 40436346, "end": 40502731}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-generic.elc", "start": 40502731, "end": 40569819}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-indent.el", "start": 40569819, "end": 40604836}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-indent.elc", "start": 40604836, "end": 40622787}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-lib.el", "start": 40622787, "end": 40644776}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-lib.elc", "start": 40644776, "end": 40665825}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-loaddefs.el", "start": 40665825, "end": 40715178}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-loaddefs.elc", "start": 40715178, "end": 40765253}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-macs.el", "start": 40765253, "end": 40925433}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-macs.elc", "start": 40925433, "end": 41025730}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-preloaded.el", "start": 41025730, "end": 41048475}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-preloaded.elc", "start": 41048475, "end": 41094156}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-print.el", "start": 41094156, "end": 41121281}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-print.elc", "start": 41121281, "end": 41139574}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-seq.el", "start": 41139574, "end": 41182716}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-seq.elc", "start": 41182716, "end": 41221344}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/comp-common.el", "start": 41221344, "end": 41244897}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/comp-common.elc", "start": 41244897, "end": 41266238}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/comp-cstr.el", "start": 41266238, "end": 41315080}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/comp-cstr.elc", "start": 41315080, "end": 41396208}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/comp-run.el", "start": 41396208, "end": 41418193}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/comp-run.elc", "start": 41418193, "end": 41432881}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/comp.el", "start": 41432881, "end": 41587551}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/comp.elc", "start": 41587551, "end": 41970400}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/compat.el", "start": 41970400, "end": 41974381}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/compat.elc", "start": 41974381, "end": 41975121}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/copyright.el", "start": 41975121, "end": 41989775}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/copyright.elc", "start": 41989775, "end": 42000404}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/crm.el", "start": 42000404, "end": 42013396}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/crm.elc", "start": 42013396, "end": 42020855}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cursor-sensor.el", "start": 42020855, "end": 42031098}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cursor-sensor.elc", "start": 42031098, "end": 42038636}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/debug-early.el", "start": 42038636, "end": 42043663}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/debug-early.elc", "start": 42043663, "end": 42046262}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/debug.el", "start": 42046262, "end": 42080294}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/debug.elc", "start": 42080294, "end": 42118624}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/derived.el", "start": 42118624, "end": 42133878}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/derived.elc", "start": 42133878, "end": 42142740}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/disass.el", "start": 42142740, "end": 42154609}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/disass.elc", "start": 42154609, "end": 42161838}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/easy-mmode.el", "start": 42161838, "end": 42197583}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/easy-mmode.elc", "start": 42197583, "end": 42221242}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/easymenu.el", "start": 42221242, "end": 42249405}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/easymenu.elc", "start": 42249405, "end": 42268562}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/edebug.el", "start": 42268562, "end": 42443058}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/edebug.elc", "start": 42443058, "end": 42573028}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-base.el", "start": 42573028, "end": 42591958}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-base.elc", "start": 42591958, "end": 42609729}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-core.el", "start": 42609729, "end": 42654786}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-core.elc", "start": 42654786, "end": 42695510}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-custom.el", "start": 42695510, "end": 42712764}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-custom.elc", "start": 42712764, "end": 42728233}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-datadebug.el", "start": 42728233, "end": 42732939}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-datadebug.elc", "start": 42732939, "end": 42735799}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-opt.el", "start": 42735799, "end": 42747388}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-opt.elc", "start": 42747388, "end": 42756097}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-speedbar.el", "start": 42756097, "end": 42771838}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-speedbar.elc", "start": 42771838, "end": 42784916}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio.el", "start": 42784916, "end": 42825225}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio.elc", "start": 42825225, "end": 42859682}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eldoc.el", "start": 42859682, "end": 42903996}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eldoc.elc", "start": 42903996, "end": 42942172}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/elint.el", "start": 42942172, "end": 42982127}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/elint.elc", "start": 42982127, "end": 43014013}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/elp.el", "start": 43014013, "end": 43036494}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/elp.elc", "start": 43036494, "end": 43052146}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ert-font-lock.el", "start": 43052146, "end": 43067070}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ert-font-lock.elc", "start": 43067070, "end": 43077059}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ert-x.el", "start": 43077059, "end": 43100015}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ert-x.elc", "start": 43100015, "end": 43120704}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ert.el", "start": 43120704, "end": 43251450}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ert.elc", "start": 43251450, "end": 43450137}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ewoc.el", "start": 43450137, "end": 43472685}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ewoc.elc", "start": 43472685, "end": 43498896}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/faceup.el", "start": 43498896, "end": 43543259}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/faceup.elc", "start": 43543259, "end": 43559864}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/find-func.el", "start": 43559864, "end": 43592838}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/find-func.elc", "start": 43592838, "end": 43617005}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/float-sup.el", "start": 43617005, "end": 43618958}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/float-sup.elc", "start": 43618958, "end": 43619968}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/generate-lisp-file.el", "start": 43619968, "end": 43624386}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/generate-lisp-file.elc", "start": 43624386, "end": 43628122}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/generator.el", "start": 43628122, "end": 43659968}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/generator.elc", "start": 43659968, "end": 43682659}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/generic.el", "start": 43682659, "end": 43694996}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/generic.elc", "start": 43694996, "end": 43701871}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/gv.el", "start": 43701871, "end": 43737740}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/gv.elc", "start": 43737740, "end": 43774501}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/helper.el", "start": 43774501, "end": 43779502}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/helper.elc", "start": 43779502, "end": 43783270}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/hierarchy.el", "start": 43783270, "end": 43808582}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/hierarchy.elc", "start": 43808582, "end": 43839652}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/icons.el", "start": 43839652, "end": 43850526}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/icons.elc", "start": 43850526, "end": 43858433}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/inline.el", "start": 43858433, "end": 43869383}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/inline.elc", "start": 43869383, "end": 43876805}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/let-alist.el", "start": 43876805, "end": 43882705}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/let-alist.elc", "start": 43882705, "end": 43885949}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/lisp-mnt.el", "start": 43885949, "end": 43910602}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/lisp-mnt.elc", "start": 43910602, "end": 43935115}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/lisp-mode.el", "start": 43935115, "end": 44004968}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/lisp-mode.elc", "start": 44004968, "end": 44049475}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/lisp.el", "start": 44049475, "end": 44089626}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/lisp.elc", "start": 44089626, "end": 44116183}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/loaddefs-gen.el", "start": 44116183, "end": 44152917}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/loaddefs-gen.elc", "start": 44152917, "end": 44173283}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/macroexp.el", "start": 44173283, "end": 44210917}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/macroexp.elc", "start": 44210917, "end": 44234543}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/map-ynp.el", "start": 44234543, "end": 44253254}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/map-ynp.elc", "start": 44253254, "end": 44264400}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/map.el", "start": 44264400, "end": 44288215}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/map.elc", "start": 44288215, "end": 44315943}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/memory-report.el", "start": 44315943, "end": 44329145}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/memory-report.elc", "start": 44329145, "end": 44338724}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/multisession.el", "start": 44338724, "end": 44357238}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/multisession.elc", "start": 44357238, "end": 44383896}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/nadvice.el", "start": 44383896, "end": 44413667}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/nadvice.elc", "start": 44413667, "end": 44434373}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/oclosure.el", "start": 44434373, "end": 44460096}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/oclosure.elc", "start": 44460096, "end": 44481996}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/package-vc.el", "start": 44481996, "end": 44528542}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/package-vc.elc", "start": 44528542, "end": 44566301}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/package-x.el", "start": 44566301, "end": 44579086}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/package-x.elc", "start": 44579086, "end": 44587854}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/package.el", "start": 44587854, "end": 44792970}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/package.elc", "start": 44792970, "end": 44976094}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/pcase.el", "start": 44976094, "end": 45028450}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/pcase.elc", "start": 45028450, "end": 45057052}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/pp.el", "start": 45057052, "end": 45083215}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/pp.elc", "start": 45083215, "end": 45099291}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/radix-tree.el", "start": 45099291, "end": 45108767}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/radix-tree.elc", "start": 45108767, "end": 45113884}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/range.el", "start": 45113884, "end": 45129377}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/range.elc", "start": 45129377, "end": 45136721}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/re-builder.el", "start": 45136721, "end": 45167497}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/re-builder.elc", "start": 45167497, "end": 45194028}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/regexp-opt.el", "start": 45194028, "end": 45206881}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/regexp-opt.elc", "start": 45206881, "end": 45212979}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/regi.el", "start": 45212979, "end": 45221871}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/regi.elc", "start": 45221871, "end": 45227488}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ring.el", "start": 45227488, "end": 45236331}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ring.elc", "start": 45236331, "end": 45242492}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/rmc.el", "start": 45242492, "end": 45255802}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/rmc.elc", "start": 45255802, "end": 45262890}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/rx.el", "start": 45262890, "end": 45333866}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/rx.elc", "start": 45333866, "end": 45378261}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/seq.el", "start": 45378261, "end": 45403569}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/seq.elc", "start": 45403569, "end": 45437346}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/shadow.el", "start": 45437346, "end": 45448993}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/shadow.elc", "start": 45448993, "end": 45458067}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/shortdoc.el", "start": 45458067, "end": 45511690}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/shortdoc.elc", "start": 45511690, "end": 45558798}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/shorthands.el", "start": 45558798, "end": 45562054}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/shorthands.elc", "start": 45562054, "end": 45563412}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/smie.el", "start": 45563412, "end": 45669075}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/smie.elc", "start": 45669075, "end": 45718136}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/subr-x.el", "start": 45718136, "end": 45738915}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/subr-x.elc", "start": 45738915, "end": 45754743}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/syntax.el", "start": 45754743, "end": 45791619}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/syntax.elc", "start": 45791619, "end": 45821752}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/tabulated-list.el", "start": 45821752, "end": 45861828}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/tabulated-list.elc", "start": 45861828, "end": 45893901}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/tcover-ses.el", "start": 45893901, "end": 45912953}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/tcover-ses.elc", "start": 45912953, "end": 45924459}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/testcover.el", "start": 45924459, "end": 45952836}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/testcover.elc", "start": 45952836, "end": 45972761}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/text-property-search.el", "start": 45972761, "end": 45982077}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/text-property-search.elc", "start": 45982077, "end": 45991070}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/thunk.el", "start": 45991070, "end": 45995292}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/thunk.elc", "start": 45995292, "end": 45998117}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/timer-list.el", "start": 45998117, "end": 46003089}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/timer-list.elc", "start": 46003089, "end": 46008063}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/timer.el", "start": 46008063, "end": 46031415}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/timer.elc", "start": 46031415, "end": 46054798}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/tq.el", "start": 46054798, "end": 46061336}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/tq.elc", "start": 46061336, "end": 46064887}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/trace.el", "start": 46064887, "end": 46076459}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/trace.elc", "start": 46076459, "end": 46083409}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/track-changes.el", "start": 46083409, "end": 46114906}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/track-changes.elc", "start": 46114906, "end": 46144718}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/unsafep.el", "start": 46144718, "end": 46155532}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/unsafep.elc", "start": 46155532, "end": 46159655}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/vtable.el", "start": 46159655, "end": 46201519}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/vtable.elc", "start": 46201519, "end": 46248030}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/warnings.el", "start": 46248030, "end": 46265437}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/warnings.elc", "start": 46265437, "end": 46278205}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lock.el", "start": 46278205, "end": 46288241}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lock.elc", "start": 46288241, "end": 46297080}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/cua-base.el", "start": 46297080, "end": 46350993}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/cua-base.elc", "start": 46350993, "end": 46386582}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/cua-gmrk.el", "start": 46386582, "end": 46401370}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/cua-gmrk.elc", "start": 46401370, "end": 46411393}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/cua-rect.el", "start": 46411393, "end": 46466554}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/cua-rect.elc", "start": 46466554, "end": 46510379}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt-lk201.el", "start": 46510379, "end": 46512769}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt-lk201.elc", "start": 46512769, "end": 46513707}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt-mapper.el", "start": 46513707, "end": 46532646}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt-mapper.elc", "start": 46532646, "end": 46544570}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt-pc.el", "start": 46544570, "end": 46548235}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt-pc.elc", "start": 46548235, "end": 46549150}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt-vt100.el", "start": 46549150, "end": 46550708}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt-vt100.elc", "start": 46550708, "end": 46551068}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt.el", "start": 46551068, "end": 46638014}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt.elc", "start": 46638014, "end": 46701134}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/keypad.el", "start": 46701134, "end": 46711253}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/keypad.elc", "start": 46711253, "end": 46717428}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-cmd.el", "start": 46717428, "end": 46887428}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-cmd.elc", "start": 46887428, "end": 47013240}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-ex.el", "start": 47013240, "end": 47089208}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-ex.elc", "start": 47089208, "end": 47137861}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-init.el", "start": 47137861, "end": 47171937}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-init.elc", "start": 47171937, "end": 47204566}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-keym.el", "start": 47204566, "end": 47232425}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-keym.elc", "start": 47232425, "end": 47253970}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-macs.el", "start": 47253970, "end": 47286060}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-macs.elc", "start": 47286060, "end": 47305333}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-mous.el", "start": 47305333, "end": 47327534}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-mous.elc", "start": 47327534, "end": 47342051}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-util.el", "start": 47342051, "end": 47387885}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-util.elc", "start": 47387885, "end": 47419939}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper.el", "start": 47419939, "end": 47468410}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper.elc", "start": 47468410, "end": 47493343}, {"filename": "/usr/local/share/emacs/30.2/lisp/env.el", "start": 47493343, "end": 47503214}, {"filename": "/usr/local/share/emacs/30.2/lisp/env.elc", "start": 47503214, "end": 47510300}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-dired.el", "start": 47510300, "end": 47512407}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-dired.elc", "start": 47512407, "end": 47513731}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-file.el", "start": 47513731, "end": 47528227}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-file.elc", "start": 47528227, "end": 47537076}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-hook.el", "start": 47537076, "end": 47541436}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-hook.elc", "start": 47541436, "end": 47547021}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-ks.el", "start": 47547021, "end": 47559360}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-ks.elc", "start": 47559360, "end": 47584450}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-mail.el", "start": 47584450, "end": 47593445}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-mail.elc", "start": 47593445, "end": 47604120}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa.el", "start": 47604120, "end": 47647814}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa.elc", "start": 47647814, "end": 47693112}, {"filename": "/usr/local/share/emacs/30.2/lisp/epg-config.el", "start": 47693112, "end": 47704355}, {"filename": "/usr/local/share/emacs/30.2/lisp/epg-config.elc", "start": 47704355, "end": 47713344}, {"filename": "/usr/local/share/emacs/30.2/lisp/epg.el", "start": 47713344, "end": 47794014}, {"filename": "/usr/local/share/emacs/30.2/lisp/epg.elc", "start": 47794014, "end": 47967698}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/ChangeLog.1", "start": 47967698, "end": 48391199}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/ChangeLog.2", "start": 48391199, "end": 48417047}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-autoaway.el", "start": 48417047, "end": 48427940}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-autoaway.elc", "start": 48427940, "end": 48441546}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-backend.el", "start": 48441546, "end": 48563581}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-backend.elc", "start": 48563581, "end": 48748586}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-button.el", "start": 48748586, "end": 48787152}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-button.elc", "start": 48787152, "end": 48846978}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-capab.el", "start": 48846978, "end": 48855631}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-capab.elc", "start": 48855631, "end": 48865082}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-common.el", "start": 48865082, "end": 48893646}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-common.elc", "start": 48893646, "end": 49000123}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-compat.el", "start": 49000123, "end": 49019441}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-compat.elc", "start": 49019441, "end": 49031757}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-dcc.el", "start": 49031757, "end": 49085076}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-dcc.elc", "start": 49085076, "end": 49134713}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-desktop-notifications.el", "start": 49134713, "end": 49139515}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-desktop-notifications.elc", "start": 49139515, "end": 49146872}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-ezbounce.el", "start": 49146872, "end": 49152789}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-ezbounce.elc", "start": 49152789, "end": 49157518}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-fill.el", "start": 49157518, "end": 49198236}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-fill.elc", "start": 49198236, "end": 49237671}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-goodies.el", "start": 49237671, "end": 49294599}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-goodies.elc", "start": 49294599, "end": 49382680}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-ibuffer.el", "start": 49382680, "end": 49388856}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-ibuffer.elc", "start": 49388856, "end": 49395056}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-identd.el", "start": 49395056, "end": 49399212}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-identd.elc", "start": 49399212, "end": 49405737}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-imenu.el", "start": 49405737, "end": 49411285}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-imenu.elc", "start": 49411285, "end": 49418129}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-join.el", "start": 49418129, "end": 49429389}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-join.elc", "start": 49429389, "end": 49442616}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-lang.el", "start": 49442616, "end": 49448615}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-lang.elc", "start": 49448615, "end": 49453172}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-list.el", "start": 49453172, "end": 49461031}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-list.elc", "start": 49461031, "end": 49472726}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-loaddefs.el", "start": 49472726, "end": 49486276}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-loaddefs.elc", "start": 49486276, "end": 49498968}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-log.el", "start": 49498968, "end": 49517559}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-log.elc", "start": 49517559, "end": 49534939}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-match.el", "start": 49534939, "end": 49559768}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-match.elc", "start": 49559768, "end": 49583970}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-menu.el", "start": 49583970, "end": 49589065}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-menu.elc", "start": 49589065, "end": 49597010}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-netsplit.el", "start": 49597010, "end": 49604609}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-netsplit.elc", "start": 49604609, "end": 49615023}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-networks.el", "start": 49615023, "end": 49696193}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-networks.elc", "start": 49696193, "end": 49787300}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-nicks.el", "start": 49787300, "end": 49822887}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-nicks.elc", "start": 49822887, "end": 49856928}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-notify.el", "start": 49856928, "end": 49866970}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-notify.elc", "start": 49866970, "end": 49880077}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-page.el", "start": 49880077, "end": 49884053}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-page.elc", "start": 49884053, "end": 49890796}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-pcomplete.el", "start": 49890796, "end": 49900808}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-pcomplete.elc", "start": 49900808, "end": 49914362}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-replace.el", "start": 49914362, "end": 49917326}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-replace.elc", "start": 49917326, "end": 49922947}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-ring.el", "start": 49922947, "end": 49928564}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-ring.elc", "start": 49928564, "end": 49935818}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-sasl.el", "start": 49935818, "end": 49954912}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-sasl.elc", "start": 49954912, "end": 49986197}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-services.el", "start": 49986197, "end": 50012155}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-services.elc", "start": 50012155, "end": 50043374}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-sound.el", "start": 50043374, "end": 50048302}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-sound.elc", "start": 50048302, "end": 50055751}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-speedbar.el", "start": 50055751, "end": 50083613}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-speedbar.elc", "start": 50083613, "end": 50109591}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-spelling.el", "start": 50109591, "end": 50113891}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-spelling.elc", "start": 50113891, "end": 50120406}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-stamp.el", "start": 50120406, "end": 50172883}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-stamp.elc", "start": 50172883, "end": 50230994}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-status-sidebar.el", "start": 50230994, "end": 50257559}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-status-sidebar.elc", "start": 50257559, "end": 50284663}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-track.el", "start": 50284663, "end": 50334089}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-track.elc", "start": 50334089, "end": 50380033}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-truncate.el", "start": 50380033, "end": 50385817}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-truncate.elc", "start": 50385817, "end": 50392661}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-xdcc.el", "start": 50392661, "end": 50397317}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-xdcc.elc", "start": 50397317, "end": 50404890}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc.el", "start": 50404890, "end": 50819069}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc.elc", "start": 50819069, "end": 51204403}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-alias.el", "start": 51204403, "end": 51215434}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-alias.elc", "start": 51215434, "end": 51222002}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-banner.el", "start": 51222002, "end": 51225065}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-banner.elc", "start": 51225065, "end": 51226408}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-basic.el", "start": 51226408, "end": 51234501}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-basic.elc", "start": 51234501, "end": 51239818}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-cmpl.el", "start": 51239818, "end": 51261232}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-cmpl.elc", "start": 51261232, "end": 51277477}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-dirs.el", "start": 51277477, "end": 51299508}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-dirs.elc", "start": 51299508, "end": 51316835}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-elecslash.el", "start": 51316835, "end": 51321226}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-elecslash.elc", "start": 51321226, "end": 51323739}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-extpipe.el", "start": 51323739, "end": 51332910}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-extpipe.elc", "start": 51332910, "end": 51338615}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-glob.el", "start": 51338615, "end": 51354534}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-glob.elc", "start": 51354534, "end": 51365747}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-hist.el", "start": 51365747, "end": 51405365}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-hist.elc", "start": 51405365, "end": 51437979}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-ls.el", "start": 51437979, "end": 51471807}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-ls.elc", "start": 51471807, "end": 51500007}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-pred.el", "start": 51500007, "end": 51521564}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-pred.elc", "start": 51521564, "end": 51540723}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-prompt.el", "start": 51540723, "end": 51550269}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-prompt.elc", "start": 51550269, "end": 51560002}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-rebind.el", "start": 51560002, "end": 51568138}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-rebind.elc", "start": 51568138, "end": 51577576}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-script.el", "start": 51577576, "end": 51584650}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-script.elc", "start": 51584650, "end": 51593188}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-smart.el", "start": 51593188, "end": 51604667}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-smart.elc", "start": 51604667, "end": 51612685}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-term.el", "start": 51612685, "end": 51626093}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-term.elc", "start": 51626093, "end": 51631864}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-tramp.el", "start": 51631864, "end": 51637854}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-tramp.elc", "start": 51637854, "end": 51642238}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-unix.el", "start": 51642238, "end": 51681062}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-unix.elc", "start": 51681062, "end": 51717997}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-xtra.el", "start": 51717997, "end": 51720989}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-xtra.elc", "start": 51720989, "end": 51723373}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-arg.el", "start": 51723373, "end": 51752616}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-arg.elc", "start": 51752616, "end": 51777938}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-cmd.el", "start": 51777938, "end": 51841356}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-cmd.elc", "start": 51841356, "end": 51897279}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-ext.el", "start": 51897279, "end": 51912098}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-ext.elc", "start": 51912098, "end": 51924597}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-io.el", "start": 51924597, "end": 51956404}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-io.elc", "start": 51956404, "end": 51987517}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-mode.el", "start": 51987517, "end": 52025898}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-mode.elc", "start": 52025898, "end": 52058328}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-module-loaddefs.el", "start": 52058328, "end": 52066444}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-module-loaddefs.elc", "start": 52066444, "end": 52073521}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-module.el", "start": 52073521, "end": 52080078}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-module.elc", "start": 52080078, "end": 52085664}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-opt.el", "start": 52085664, "end": 52098105}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-opt.elc", "start": 52098105, "end": 52106826}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-proc.el", "start": 52106826, "end": 52136805}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-proc.elc", "start": 52136805, "end": 52160049}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-util.el", "start": 52160049, "end": 52192554}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-util.elc", "start": 52192554, "end": 52221194}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-var.el", "start": 52221194, "end": 52255847}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-var.elc", "start": 52255847, "end": 52283996}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/eshell.el", "start": 52283996, "end": 52299535}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/eshell.elc", "start": 52299535, "end": 52308338}, {"filename": "/usr/local/share/emacs/30.2/lisp/expand.el", "start": 52308338, "end": 52322176}, {"filename": "/usr/local/share/emacs/30.2/lisp/expand.elc", "start": 52322176, "end": 52331527}, {"filename": "/usr/local/share/emacs/30.2/lisp/external-completion.el", "start": 52331527, "end": 52339891}, {"filename": "/usr/local/share/emacs/30.2/lisp/external-completion.elc", "start": 52339891, "end": 52344619}, {"filename": "/usr/local/share/emacs/30.2/lisp/ezimage.el", "start": 52344619, "end": 52353852}, {"filename": "/usr/local/share/emacs/30.2/lisp/ezimage.elc", "start": 52353852, "end": 52363334}, {"filename": "/usr/local/share/emacs/30.2/lisp/face-remap.el", "start": 52363334, "end": 52390014}, {"filename": "/usr/local/share/emacs/30.2/lisp/face-remap.elc", "start": 52390014, "end": 52413812}, {"filename": "/usr/local/share/emacs/30.2/lisp/facemenu.el", "start": 52413812, "end": 52451085}, {"filename": "/usr/local/share/emacs/30.2/lisp/facemenu.elc", "start": 52451085, "end": 52479365}, {"filename": "/usr/local/share/emacs/30.2/lisp/faces.el", "start": 52479365, "end": 52607843}, {"filename": "/usr/local/share/emacs/30.2/lisp/faces.elc", "start": 52607843, "end": 52709448}, {"filename": "/usr/local/share/emacs/30.2/lisp/ffap.el", "start": 52709448, "end": 52791761}, {"filename": "/usr/local/share/emacs/30.2/lisp/ffap.elc", "start": 52791761, "end": 52849777}, {"filename": "/usr/local/share/emacs/30.2/lisp/filecache.el", "start": 52849777, "end": 52875394}, {"filename": "/usr/local/share/emacs/30.2/lisp/filecache.elc", "start": 52875394, "end": 52891956}, {"filename": "/usr/local/share/emacs/30.2/lisp/fileloop.el", "start": 52891956, "end": 52901199}, {"filename": "/usr/local/share/emacs/30.2/lisp/fileloop.elc", "start": 52901199, "end": 52907568}, {"filename": "/usr/local/share/emacs/30.2/lisp/filenotify.el", "start": 52907568, "end": 52930085}, {"filename": "/usr/local/share/emacs/30.2/lisp/filenotify.elc", "start": 52930085, "end": 52959926}, {"filename": "/usr/local/share/emacs/30.2/lisp/files-x.el", "start": 52959926, "end": 53000992}, {"filename": "/usr/local/share/emacs/30.2/lisp/files-x.elc", "start": 53000992, "end": 53033667}, {"filename": "/usr/local/share/emacs/30.2/lisp/files.el", "start": 53033667, "end": 53435452}, {"filename": "/usr/local/share/emacs/30.2/lisp/files.elc", "start": 53435452, "end": 53728790}, {"filename": "/usr/local/share/emacs/30.2/lisp/filesets.el", "start": 53728790, "end": 53815211}, {"filename": "/usr/local/share/emacs/30.2/lisp/filesets.elc", "start": 53815211, "end": 53887674}, {"filename": "/usr/local/share/emacs/30.2/lisp/find-cmd.el", "start": 53887674, "end": 53895706}, {"filename": "/usr/local/share/emacs/30.2/lisp/find-cmd.elc", "start": 53895706, "end": 53900417}, {"filename": "/usr/local/share/emacs/30.2/lisp/find-dired.el", "start": 53900417, "end": 53917160}, {"filename": "/usr/local/share/emacs/30.2/lisp/find-dired.elc", "start": 53917160, "end": 53929378}, {"filename": "/usr/local/share/emacs/30.2/lisp/find-file.el", "start": 53929378, "end": 53962180}, {"filename": "/usr/local/share/emacs/30.2/lisp/find-file.elc", "start": 53962180, "end": 53980794}, {"filename": "/usr/local/share/emacs/30.2/lisp/find-lisp.el", "start": 53980794, "end": 53994511}, {"filename": "/usr/local/share/emacs/30.2/lisp/find-lisp.elc", "start": 53994511, "end": 54003114}, {"filename": "/usr/local/share/emacs/30.2/lisp/finder.el", "start": 54003114, "end": 54020656}, {"filename": "/usr/local/share/emacs/30.2/lisp/finder.elc", "start": 54020656, "end": 54035408}, {"filename": "/usr/local/share/emacs/30.2/lisp/flow-ctrl.el", "start": 54035408, "end": 54040493}, {"filename": "/usr/local/share/emacs/30.2/lisp/flow-ctrl.elc", "start": 54040493, "end": 54042412}, {"filename": "/usr/local/share/emacs/30.2/lisp/foldout.el", "start": 54042412, "end": 54062926}, {"filename": "/usr/local/share/emacs/30.2/lisp/foldout.elc", "start": 54062926, "end": 54069810}, {"filename": "/usr/local/share/emacs/30.2/lisp/follow.el", "start": 54069810, "end": 54138305}, {"filename": "/usr/local/share/emacs/30.2/lisp/follow.elc", "start": 54138305, "end": 54179974}, {"filename": "/usr/local/share/emacs/30.2/lisp/font-core.el", "start": 54179974, "end": 54192291}, {"filename": "/usr/local/share/emacs/30.2/lisp/font-core.elc", "start": 54192291, "end": 54204704}, {"filename": "/usr/local/share/emacs/30.2/lisp/font-lock.el", "start": 54204704, "end": 54311796}, {"filename": "/usr/local/share/emacs/30.2/lisp/font-lock.elc", "start": 54311796, "end": 54378503}, {"filename": "/usr/local/share/emacs/30.2/lisp/format-spec.el", "start": 54378503, "end": 54386643}, {"filename": "/usr/local/share/emacs/30.2/lisp/format-spec.elc", "start": 54386643, "end": 54391820}, {"filename": "/usr/local/share/emacs/30.2/lisp/format.el", "start": 54391820, "end": 54435664}, {"filename": "/usr/local/share/emacs/30.2/lisp/format.elc", "start": 54435664, "end": 54462770}, {"filename": "/usr/local/share/emacs/30.2/lisp/forms.el", "start": 54462770, "end": 54531543}, {"filename": "/usr/local/share/emacs/30.2/lisp/forms.elc", "start": 54531543, "end": 54567178}, {"filename": "/usr/local/share/emacs/30.2/lisp/frame.el", "start": 54567178, "end": 54699816}, {"filename": "/usr/local/share/emacs/30.2/lisp/frame.elc", "start": 54699816, "end": 54804715}, {"filename": "/usr/local/share/emacs/30.2/lisp/frameset.el", "start": 54804715, "end": 54871352}, {"filename": "/usr/local/share/emacs/30.2/lisp/frameset.elc", "start": 54871352, "end": 54921191}, {"filename": "/usr/local/share/emacs/30.2/lisp/fringe.el", "start": 54921191, "end": 54934091}, {"filename": "/usr/local/share/emacs/30.2/lisp/fringe.elc", "start": 54934091, "end": 54944608}, {"filename": "/usr/local/share/emacs/30.2/lisp/generic-x.el", "start": 54944608, "end": 54993565}, {"filename": "/usr/local/share/emacs/30.2/lisp/generic-x.elc", "start": 54993565, "end": 55035423}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/ChangeLog.1", "start": 55035423, "end": 55142268}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/ChangeLog.2", "start": 55142268, "end": 55757024}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/ChangeLog.3", "start": 55757024, "end": 56675408}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/canlock.el", "start": 56675408, "end": 56683757}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/canlock.elc", "start": 56683757, "end": 56689366}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/deuglify.el", "start": 56689366, "end": 56706923}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/deuglify.elc", "start": 56706923, "end": 56715356}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gmm-utils.el", "start": 56715356, "end": 56723023}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gmm-utils.elc", "start": 56723023, "end": 56728039}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-agent.el", "start": 56728039, "end": 56885699}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-agent.elc", "start": 56885699, "end": 57005640}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-art.el", "start": 57005640, "end": 57339230}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-art.elc", "start": 57339230, "end": 57636069}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-async.el", "start": 57636069, "end": 57649332}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-async.elc", "start": 57649332, "end": 57660847}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-bcklg.el", "start": 57660847, "end": 57665687}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-bcklg.elc", "start": 57665687, "end": 57668147}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-bookmark.el", "start": 57668147, "end": 57698342}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-bookmark.elc", "start": 57698342, "end": 57724224}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-cache.el", "start": 57724224, "end": 57756458}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-cache.elc", "start": 57756458, "end": 57780529}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-cite.el", "start": 57780529, "end": 57819521}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-cite.elc", "start": 57819521, "end": 57846941}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-cloud.el", "start": 57846941, "end": 57866934}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-cloud.elc", "start": 57866934, "end": 57883837}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-cus.el", "start": 57883837, "end": 57925684}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-cus.elc", "start": 57925684, "end": 57965355}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-dbus.el", "start": 57965355, "end": 57967624}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-dbus.elc", "start": 57967624, "end": 57968986}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-delay.el", "start": 57968986, "end": 57975578}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-delay.elc", "start": 57975578, "end": 57980371}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-demon.el", "start": 57980371, "end": 57989727}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-demon.elc", "start": 57989727, "end": 57997035}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-diary.el", "start": 57997035, "end": 58010652}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-diary.elc", "start": 58010652, "end": 58019233}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-dired.el", "start": 58019233, "end": 58028401}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-dired.elc", "start": 58028401, "end": 58036760}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-draft.el", "start": 58036760, "end": 58048746}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-draft.elc", "start": 58048746, "end": 58061175}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-dup.el", "start": 58061175, "end": 58066606}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-dup.elc", "start": 58066606, "end": 58070959}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-eform.el", "start": 58070959, "end": 58074858}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-eform.elc", "start": 58074858, "end": 58079926}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-fun.el", "start": 58079926, "end": 58090901}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-fun.elc", "start": 58090901, "end": 58101150}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-gravatar.el", "start": 58101150, "end": 58106845}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-gravatar.elc", "start": 58106845, "end": 58110743}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-group.el", "start": 58110743, "end": 58292743}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-group.elc", "start": 58292743, "end": 58459079}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-html.el", "start": 58459079, "end": 58476714}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-html.elc", "start": 58476714, "end": 58489829}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-icalendar.el", "start": 58489829, "end": 58533034}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-icalendar.elc", "start": 58533034, "end": 58575986}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-int.el", "start": 58575986, "end": 58612224}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-int.elc", "start": 58612224, "end": 58673900}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-kill.el", "start": 58673900, "end": 58697240}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-kill.elc", "start": 58697240, "end": 58716505}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-logic.el", "start": 58716505, "end": 58724825}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-logic.elc", "start": 58724825, "end": 58729502}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-mh.el", "start": 58729502, "end": 58733596}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-mh.elc", "start": 58733596, "end": 58736393}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-ml.el", "start": 58736393, "end": 58742127}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-ml.elc", "start": 58742127, "end": 58748324}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-mlspl.el", "start": 58748324, "end": 58757739}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-mlspl.elc", "start": 58757739, "end": 58763964}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-msg.el", "start": 58763964, "end": 58834021}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-msg.elc", "start": 58834021, "end": 58916388}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-notifications.el", "start": 58916388, "end": 58925398}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-notifications.elc", "start": 58925398, "end": 58931020}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-picon.el", "start": 58931020, "end": 58941634}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-picon.elc", "start": 58941634, "end": 58949748}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-range.el", "start": 58949748, "end": 58958567}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-range.elc", "start": 58958567, "end": 58964320}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-registry.el", "start": 58964320, "end": 59016407}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-registry.elc", "start": 59016407, "end": 59051877}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-rfc1843.el", "start": 59051877, "end": 59054350}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-rfc1843.elc", "start": 59054350, "end": 59055632}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-rmail.el", "start": 59055632, "end": 59061081}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-rmail.elc", "start": 59061081, "end": 59063782}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-salt.el", "start": 59063782, "end": 59093245}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-salt.elc", "start": 59093245, "end": 59122573}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-score.el", "start": 59122573, "end": 59236035}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-score.elc", "start": 59236035, "end": 59314934}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-search.el", "start": 59314934, "end": 59398933}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-search.elc", "start": 59398933, "end": 59485730}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-sieve.el", "start": 59485730, "end": 59493398}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-sieve.elc", "start": 59493398, "end": 59501519}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-spec.el", "start": 59501519, "end": 59522667}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-spec.elc", "start": 59522667, "end": 59535954}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-srvr.el", "start": 59535954, "end": 59574749}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-srvr.elc", "start": 59574749, "end": 59626607}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-start.el", "start": 59626607, "end": 59745732}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-start.elc", "start": 59745732, "end": 59882874}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-sum.el", "start": 59882874, "end": 60379351}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-sum.elc", "start": 60379351, "end": 60824460}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-topic.el", "start": 60824460, "end": 60887486}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-topic.elc", "start": 60887486, "end": 60936336}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-undo.el", "start": 60936336, "end": 60941941}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-undo.elc", "start": 60941941, "end": 60946761}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-util.el", "start": 60946761, "end": 61000626}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-util.elc", "start": 61000626, "end": 61046893}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-uu.el", "start": 61046893, "end": 61121854}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-uu.elc", "start": 61121854, "end": 61180386}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-vm.el", "start": 61180386, "end": 61183620}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-vm.elc", "start": 61183620, "end": 61185802}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-win.el", "start": 61185802, "end": 61203075}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-win.elc", "start": 61203075, "end": 61214300}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus.el", "start": 61214300, "end": 61360794}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus.elc", "start": 61360794, "end": 61527445}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gssapi.el", "start": 61527445, "end": 61530930}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gssapi.elc", "start": 61530930, "end": 61532901}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mail-source.el", "start": 61532901, "end": 61572807}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mail-source.elc", "start": 61572807, "end": 61601100}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/message.el", "start": 61601100, "end": 61927836}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/message.elc", "start": 61927836, "end": 62186292}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-archive.el", "start": 62186292, "end": 62189982}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-archive.elc", "start": 62189982, "end": 62192828}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-bodies.el", "start": 62192828, "end": 62202867}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-bodies.elc", "start": 62202867, "end": 62208586}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-decode.el", "start": 62208586, "end": 62277216}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-decode.elc", "start": 62277216, "end": 62333796}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-encode.el", "start": 62333796, "end": 62341972}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-encode.elc", "start": 62341972, "end": 62348064}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-extern.el", "start": 62348064, "end": 62353373}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-extern.elc", "start": 62353373, "end": 62357192}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-partial.el", "start": 62357192, "end": 62362068}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-partial.elc", "start": 62362068, "end": 62364833}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-url.el", "start": 62364833, "end": 62378309}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-url.elc", "start": 62378309, "end": 62388014}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-util.el", "start": 62388014, "end": 62418355}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-util.elc", "start": 62418355, "end": 62440825}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-uu.el", "start": 62440825, "end": 62465450}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-uu.elc", "start": 62465450, "end": 62488060}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-view.el", "start": 62488060, "end": 62511388}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-view.elc", "start": 62511388, "end": 62529836}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml-sec.el", "start": 62529836, "end": 62571059}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml-sec.elc", "start": 62571059, "end": 62608441}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml-smime.el", "start": 62608441, "end": 62623327}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml-smime.elc", "start": 62623327, "end": 62633787}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml.el", "start": 62633787, "end": 62697457}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml.elc", "start": 62697457, "end": 62744680}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml1991.el", "start": 62744680, "end": 62755240}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml1991.elc", "start": 62755240, "end": 62762583}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml2015.el", "start": 62762583, "end": 62796027}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml2015.elc", "start": 62796027, "end": 62822097}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnagent.el", "start": 62822097, "end": 62830699}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnagent.elc", "start": 62830699, "end": 62841623}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnatom.el", "start": 62841623, "end": 62854200}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnatom.elc", "start": 62854200, "end": 62865060}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnbabyl.el", "start": 62865060, "end": 62886926}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnbabyl.elc", "start": 62886926, "end": 62904413}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nndiary.el", "start": 62904413, "end": 62960190}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nndiary.elc", "start": 62960190, "end": 62999446}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nndir.el", "start": 62999446, "end": 63002448}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nndir.elc", "start": 63002448, "end": 63006256}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nndoc.el", "start": 63006256, "end": 63044219}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nndoc.elc", "start": 63044219, "end": 63074900}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nndraft.el", "start": 63074900, "end": 63086872}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nndraft.elc", "start": 63086872, "end": 63097987}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nneething.el", "start": 63097987, "end": 63111860}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nneething.elc", "start": 63111860, "end": 63123746}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnfeed.el", "start": 63123746, "end": 63154015}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnfeed.elc", "start": 63154015, "end": 63181321}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnfolder.el", "start": 63181321, "end": 63224173}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnfolder.elc", "start": 63224173, "end": 63257282}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nngateway.el", "start": 63257282, "end": 63260143}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nngateway.elc", "start": 63260143, "end": 63263297}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnheader.el", "start": 63263297, "end": 63299548}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnheader.elc", "start": 63299548, "end": 63338691}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnimap.el", "start": 63338691, "end": 63418891}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnimap.elc", "start": 63418891, "end": 63492670}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmail.el", "start": 63492670, "end": 63565918}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmail.elc", "start": 63565918, "end": 63620441}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmaildir.el", "start": 63620441, "end": 63689163}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmaildir.elc", "start": 63689163, "end": 63783623}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmairix.el", "start": 63783623, "end": 63858845}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmairix.elc", "start": 63858845, "end": 63932915}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmbox.el", "start": 63932915, "end": 63957491}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmbox.elc", "start": 63957491, "end": 63976763}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmh.el", "start": 63976763, "end": 63996427}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmh.elc", "start": 63996427, "end": 64012054}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnml.el", "start": 64012054, "end": 64055763}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnml.elc", "start": 64055763, "end": 64090135}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnnil.el", "start": 64090135, "end": 64092369}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnnil.elc", "start": 64092369, "end": 64093880}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnoo.el", "start": 64093880, "end": 64105121}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnoo.elc", "start": 64105121, "end": 64113887}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnregistry.el", "start": 64113887, "end": 64115939}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnregistry.elc", "start": 64115939, "end": 64117436}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnrss.el", "start": 64117436, "end": 64151027}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnrss.elc", "start": 64151027, "end": 64179813}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnselect.el", "start": 64179813, "end": 64223607}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnselect.elc", "start": 64223607, "end": 64267841}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnspool.el", "start": 64267841, "end": 64283987}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnspool.elc", "start": 64283987, "end": 64300411}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nntp.el", "start": 64300411, "end": 64375622}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nntp.elc", "start": 64375622, "end": 64440775}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnvirtual.el", "start": 64440775, "end": 64468791}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnvirtual.elc", "start": 64468791, "end": 64488380}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnweb.el", "start": 64488380, "end": 64506887}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnweb.elc", "start": 64506887, "end": 64523992}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/score-mode.el", "start": 64523992, "end": 64527643}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/score-mode.elc", "start": 64527643, "end": 64532468}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/smiley.el", "start": 64532468, "end": 64541259}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/smiley.elc", "start": 64541259, "end": 64547435}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/smime.el", "start": 64547435, "end": 64571614}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/smime.elc", "start": 64571614, "end": 64590818}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/spam-report.el", "start": 64590818, "end": 64605080}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/spam-report.elc", "start": 64605080, "end": 64616572}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/spam-stat.el", "start": 64616572, "end": 64639787}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/spam-stat.elc", "start": 64639787, "end": 64660038}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/spam-wash.el", "start": 64660038, "end": 64662377}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/spam-wash.elc", "start": 64662377, "end": 64663312}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/spam.el", "start": 64663312, "end": 64771320}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/spam.elc", "start": 64771320, "end": 64855405}, {"filename": "/usr/local/share/emacs/30.2/lisp/help-at-pt.el", "start": 64855405, "end": 64870645}, {"filename": "/usr/local/share/emacs/30.2/lisp/help-at-pt.elc", "start": 64870645, "end": 64882510}, {"filename": "/usr/local/share/emacs/30.2/lisp/help-fns.el", "start": 64882510, "end": 64988624}, {"filename": "/usr/local/share/emacs/30.2/lisp/help-fns.elc", "start": 64988624, "end": 65058432}, {"filename": "/usr/local/share/emacs/30.2/lisp/help-macro.el", "start": 65058432, "end": 65069895}, {"filename": "/usr/local/share/emacs/30.2/lisp/help-macro.elc", "start": 65069895, "end": 65074291}, {"filename": "/usr/local/share/emacs/30.2/lisp/help-mode.el", "start": 65074291, "end": 65113976}, {"filename": "/usr/local/share/emacs/30.2/lisp/help-mode.elc", "start": 65113976, "end": 65145080}, {"filename": "/usr/local/share/emacs/30.2/lisp/help.el", "start": 65145080, "end": 65250793}, {"filename": "/usr/local/share/emacs/30.2/lisp/help.elc", "start": 65250793, "end": 65319495}, {"filename": "/usr/local/share/emacs/30.2/lisp/hex-util.el", "start": 65319495, "end": 65321991}, {"filename": "/usr/local/share/emacs/30.2/lisp/hex-util.elc", "start": 65321991, "end": 65323074}, {"filename": "/usr/local/share/emacs/30.2/lisp/hexl.el", "start": 65323074, "end": 65369977}, {"filename": "/usr/local/share/emacs/30.2/lisp/hexl.elc", "start": 65369977, "end": 65411209}, {"filename": "/usr/local/share/emacs/30.2/lisp/hfy-cmap.el", "start": 65411209, "end": 65452247}, {"filename": "/usr/local/share/emacs/30.2/lisp/hfy-cmap.elc", "start": 65452247, "end": 65478075}, {"filename": "/usr/local/share/emacs/30.2/lisp/hi-lock.el", "start": 65478075, "end": 65517363}, {"filename": "/usr/local/share/emacs/30.2/lisp/hi-lock.elc", "start": 65517363, "end": 65551237}, {"filename": "/usr/local/share/emacs/30.2/lisp/hilit-chg.el", "start": 65551237, "end": 65588392}, {"filename": "/usr/local/share/emacs/30.2/lisp/hilit-chg.elc", "start": 65588392, "end": 65617151}, {"filename": "/usr/local/share/emacs/30.2/lisp/hippie-exp.el", "start": 65617151, "end": 65657327}, {"filename": "/usr/local/share/emacs/30.2/lisp/hippie-exp.elc", "start": 65657327, "end": 65679147}, {"filename": "/usr/local/share/emacs/30.2/lisp/hl-line.el", "start": 65679147, "end": 65691204}, {"filename": "/usr/local/share/emacs/30.2/lisp/hl-line.elc", "start": 65691204, "end": 65704042}, {"filename": "/usr/local/share/emacs/30.2/lisp/htmlfontify.el", "start": 65704042, "end": 65804865}, {"filename": "/usr/local/share/emacs/30.2/lisp/htmlfontify.elc", "start": 65804865, "end": 65870812}, {"filename": "/usr/local/share/emacs/30.2/lisp/ibuf-ext.el", "start": 65870812, "end": 65945047}, {"filename": "/usr/local/share/emacs/30.2/lisp/ibuf-ext.elc", "start": 65945047, "end": 66026005}, {"filename": "/usr/local/share/emacs/30.2/lisp/ibuf-macs.el", "start": 66026005, "end": 66040047}, {"filename": "/usr/local/share/emacs/30.2/lisp/ibuf-macs.elc", "start": 66040047, "end": 66052923}, {"filename": "/usr/local/share/emacs/30.2/lisp/ibuffer-loaddefs.el", "start": 66052923, "end": 66066102}, {"filename": "/usr/local/share/emacs/30.2/lisp/ibuffer-loaddefs.elc", "start": 66066102, "end": 66079815}, {"filename": "/usr/local/share/emacs/30.2/lisp/ibuffer.el", "start": 66079815, "end": 66179161}, {"filename": "/usr/local/share/emacs/30.2/lisp/ibuffer.elc", "start": 66179161, "end": 66274436}, {"filename": "/usr/local/share/emacs/30.2/lisp/icomplete.el", "start": 66274436, "end": 66324713}, {"filename": "/usr/local/share/emacs/30.2/lisp/icomplete.elc", "start": 66324713, "end": 66362770}, {"filename": "/usr/local/share/emacs/30.2/lisp/ido.el", "start": 66362770, "end": 66543217}, {"filename": "/usr/local/share/emacs/30.2/lisp/ido.elc", "start": 66543217, "end": 66673740}, {"filename": "/usr/local/share/emacs/30.2/lisp/ielm.el", "start": 66673740, "end": 66701899}, {"filename": "/usr/local/share/emacs/30.2/lisp/ielm.elc", "start": 66701899, "end": 66723904}, {"filename": "/usr/local/share/emacs/30.2/lisp/iimage.el", "start": 66723904, "end": 66729203}, {"filename": "/usr/local/share/emacs/30.2/lisp/iimage.elc", "start": 66729203, "end": 66734620}, {"filename": "/usr/local/share/emacs/30.2/lisp/image-file.el", "start": 66734620, "end": 66742250}, {"filename": "/usr/local/share/emacs/30.2/lisp/image-file.elc", "start": 66742250, "end": 66749380}, {"filename": "/usr/local/share/emacs/30.2/lisp/image-mode.el", "start": 66749380, "end": 66815719}, {"filename": "/usr/local/share/emacs/30.2/lisp/image-mode.elc", "start": 66815719, "end": 66867461}, {"filename": "/usr/local/share/emacs/30.2/lisp/image.el", "start": 66867461, "end": 66933096}, {"filename": "/usr/local/share/emacs/30.2/lisp/image.elc", "start": 66933096, "end": 66981165}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/compface.el", "start": 66981165, "end": 66983113}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/compface.elc", "start": 66983113, "end": 66984016}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/exif.el", "start": 66984016, "end": 66996717}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/exif.elc", "start": 66996717, "end": 67004354}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/gravatar.el", "start": 67004354, "end": 67017489}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/gravatar.elc", "start": 67017489, "end": 67027183}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-converter.el", "start": 67027183, "end": 67041452}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-converter.elc", "start": 67041452, "end": 67051725}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-crop.el", "start": 67051725, "end": 67069579}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-crop.elc", "start": 67069579, "end": 67083050}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired-dired.el", "start": 67083050, "end": 67100175}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired-dired.elc", "start": 67100175, "end": 67118584}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired-external.el", "start": 67118584, "end": 67148093}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired-external.elc", "start": 67148093, "end": 67169723}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired-tags.el", "start": 67169723, "end": 67183007}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired-tags.elc", "start": 67183007, "end": 67193049}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired-util.el", "start": 67193049, "end": 67201973}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired-util.elc", "start": 67201973, "end": 67209165}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired.el", "start": 67209165, "end": 67293543}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired.elc", "start": 67293543, "end": 67377017}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/wallpaper.el", "start": 67377017, "end": 67400188}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/wallpaper.elc", "start": 67400188, "end": 67424201}, {"filename": "/usr/local/share/emacs/30.2/lisp/imenu.el", "start": 67424201, "end": 67462440}, {"filename": "/usr/local/share/emacs/30.2/lisp/imenu.elc", "start": 67462440, "end": 67491043}, {"filename": "/usr/local/share/emacs/30.2/lisp/indent-aux.el", "start": 67491043, "end": 67493784}, {"filename": "/usr/local/share/emacs/30.2/lisp/indent-aux.elc", "start": 67493784, "end": 67497779}, {"filename": "/usr/local/share/emacs/30.2/lisp/indent.el", "start": 67497779, "end": 67530110}, {"filename": "/usr/local/share/emacs/30.2/lisp/indent.elc", "start": 67530110, "end": 67555552}, {"filename": "/usr/local/share/emacs/30.2/lisp/info-look.el", "start": 67555552, "end": 67604448}, {"filename": "/usr/local/share/emacs/30.2/lisp/info-look.elc", "start": 67604448, "end": 67638102}, {"filename": "/usr/local/share/emacs/30.2/lisp/info-xref.el", "start": 67638102, "end": 67660795}, {"filename": "/usr/local/share/emacs/30.2/lisp/info-xref.elc", "start": 67660795, "end": 67677354}, {"filename": "/usr/local/share/emacs/30.2/lisp/info.el", "start": 67677354, "end": 67906839}, {"filename": "/usr/local/share/emacs/30.2/lisp/info.elc", "start": 67906839, "end": 68062804}, {"filename": "/usr/local/share/emacs/30.2/lisp/informat.el", "start": 68062804, "end": 68080104}, {"filename": "/usr/local/share/emacs/30.2/lisp/informat.elc", "start": 68080104, "end": 68089673}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ccl.el", "start": 68089673, "end": 68141683}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ccl.elc", "start": 68141683, "end": 68181449}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/characters.el", "start": 68181449, "end": 68246035}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/characters.elc", "start": 68246035, "end": 68284843}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/charprop.el", "start": 68284843, "end": 68290470}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/charscript.el", "start": 68290470, "end": 68316589}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/charscript.elc", "start": 68316589, "end": 68329184}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/cp51932.el", "start": 68329184, "end": 68338815}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/cp51932.elc", "start": 68338815, "end": 68346478}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/emoji-zwj.el", "start": 68346478, "end": 68464078}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/emoji-zwj.elc", "start": 68464078, "end": 68483283}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/emoji.el", "start": 68483283, "end": 68512366}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/emoji.elc", "start": 68512366, "end": 68535691}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/eucjp-ms.el", "start": 68535691, "end": 68575628}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/eucjp-ms.elc", "start": 68575628, "end": 68607055}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/fontset.el", "start": 68607055, "end": 68663304}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/fontset.elc", "start": 68663304, "end": 68699362}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/isearch-x.el", "start": 68699362, "end": 68705088}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/isearch-x.elc", "start": 68705088, "end": 68707976}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/iso-ascii.el", "start": 68707976, "end": 68715759}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/iso-ascii.elc", "start": 68715759, "end": 68721557}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/iso-cvt.el", "start": 68721557, "end": 68745224}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/iso-cvt.elc", "start": 68745224, "end": 68763631}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/iso-transl.el", "start": 68763631, "end": 68774678}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/iso-transl.elc", "start": 68774678, "end": 68781322}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ja-dic-cnv.el", "start": 68781322, "end": 68800548}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ja-dic-cnv.elc", "start": 68800548, "end": 68811850}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ja-dic-utl.el", "start": 68811850, "end": 68819758}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ja-dic-utl.elc", "start": 68819758, "end": 68824406}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/kinsoku.el", "start": 68824406, "end": 68831007}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/kinsoku.elc", "start": 68831007, "end": 68833862}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/kkc.el", "start": 68833862, "end": 68858003}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/kkc.elc", "start": 68858003, "end": 68871901}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/latexenc.el", "start": 68871901, "end": 68880119}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/latexenc.elc", "start": 68880119, "end": 68884061}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/latin1-disp.el", "start": 68884061, "end": 68944550}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/latin1-disp.elc", "start": 68944550, "end": 68989562}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule-cmds.el", "start": 68989562, "end": 69132045}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule-cmds.elc", "start": 69132045, "end": 69230951}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule-conf.el", "start": 69230951, "end": 69281220}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule-conf.elc", "start": 69281220, "end": 69320268}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule-diag.el", "start": 69320268, "end": 69365381}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule-diag.elc", "start": 69365381, "end": 69402070}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule-util.el", "start": 69402070, "end": 69423117}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule-util.elc", "start": 69423117, "end": 69436732}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule.el", "start": 69436732, "end": 69540762}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule.elc", "start": 69540762, "end": 69616310}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ogonek.el", "start": 69616310, "end": 69636929}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ogonek.elc", "start": 69636929, "end": 69653448}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/quail.el", "start": 69653448, "end": 69773937}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/quail.elc", "start": 69773937, "end": 69856407}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/rfc1843.el", "start": 69856407, "end": 69860607}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/rfc1843.elc", "start": 69860607, "end": 69864207}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/robin.el", "start": 69864207, "end": 69881328}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/robin.elc", "start": 69881328, "end": 69889051}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/textsec-check.el", "start": 69889051, "end": 69891705}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/textsec-check.elc", "start": 69891705, "end": 69893720}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/textsec.el", "start": 69893720, "end": 69914212}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/textsec.elc", "start": 69914212, "end": 69929611}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/titdic-cnv.el", "start": 69929611, "end": 69978216}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/titdic-cnv.elc", "start": 69978216, "end": 70015740}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ucs-normalize.el", "start": 70015740, "end": 70044685}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ucs-normalize.elc", "start": 70044685, "end": 70271454}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-bidi.el", "start": 70271454, "end": 70283165}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-brackets.el", "start": 70283165, "end": 70288652}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-category.el", "start": 70288652, "end": 70306394}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-combining.el", "start": 70306394, "end": 70315934}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-comment.el", "start": 70315934, "end": 70318787}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-confusable.el", "start": 70318787, "end": 70394530}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-decimal.el", "start": 70394530, "end": 70398180}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-decomposition.el", "start": 70398180, "end": 70429297}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-digit.el", "start": 70429297, "end": 70433187}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-lowercase.el", "start": 70433187, "end": 70441812}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-mirrored.el", "start": 70441812, "end": 70453939}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-name.el", "start": 70453939, "end": 70688769}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-numeric.el", "start": 70688769, "end": 70695016}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-old-name.el", "start": 70695016, "end": 70715244}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-scripts.el", "start": 70715244, "end": 70750132}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-special-lowercase.el", "start": 70750132, "end": 70752344}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-special-titlecase.el", "start": 70752344, "end": 70759139}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-special-uppercase.el", "start": 70759139, "end": 70766144}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-titlecase.el", "start": 70766144, "end": 70774875}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-uppercase.el", "start": 70774875, "end": 70783602}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/utf-7.el", "start": 70783602, "end": 70787947}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/utf-7.elc", "start": 70787947, "end": 70789770}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/utf7.el", "start": 70789770, "end": 70798455}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/utf7.elc", "start": 70798455, "end": 70803916}, {"filename": "/usr/local/share/emacs/30.2/lisp/isearch.el", "start": 70803916, "end": 71005074}, {"filename": "/usr/local/share/emacs/30.2/lisp/isearch.elc", "start": 71005074, "end": 71183132}, {"filename": "/usr/local/share/emacs/30.2/lisp/isearchb.el", "start": 71183132, "end": 71191197}, {"filename": "/usr/local/share/emacs/30.2/lisp/isearchb.elc", "start": 71191197, "end": 71195637}, {"filename": "/usr/local/share/emacs/30.2/lisp/jit-lock.el", "start": 71195637, "end": 71230069}, {"filename": "/usr/local/share/emacs/30.2/lisp/jit-lock.elc", "start": 71230069, "end": 71255019}, {"filename": "/usr/local/share/emacs/30.2/lisp/jka-cmpr-hook.el", "start": 71255019, "end": 71270639}, {"filename": "/usr/local/share/emacs/30.2/lisp/jka-cmpr-hook.elc", "start": 71270639, "end": 71284969}, {"filename": "/usr/local/share/emacs/30.2/lisp/jka-compr.el", "start": 71284969, "end": 71311449}, {"filename": "/usr/local/share/emacs/30.2/lisp/jka-compr.elc", "start": 71311449, "end": 71323613}, {"filename": "/usr/local/share/emacs/30.2/lisp/json.el", "start": 71323613, "end": 71354976}, {"filename": "/usr/local/share/emacs/30.2/lisp/json.elc", "start": 71354976, "end": 71383224}, {"filename": "/usr/local/share/emacs/30.2/lisp/jsonrpc.el", "start": 71383224, "end": 71434294}, {"filename": "/usr/local/share/emacs/30.2/lisp/jsonrpc.elc", "start": 71434294, "end": 71481997}, {"filename": "/usr/local/share/emacs/30.2/lisp/kermit.el", "start": 71481997, "end": 71488630}, {"filename": "/usr/local/share/emacs/30.2/lisp/kermit.elc", "start": 71488630, "end": 71491350}, {"filename": "/usr/local/share/emacs/30.2/lisp/keymap.el", "start": 71491350, "end": 71522293}, {"filename": "/usr/local/share/emacs/30.2/lisp/keymap.elc", "start": 71522293, "end": 71548033}, {"filename": "/usr/local/share/emacs/30.2/lisp/kmacro.el", "start": 71548033, "end": 71623628}, {"filename": "/usr/local/share/emacs/30.2/lisp/kmacro.elc", "start": 71623628, "end": 71683952}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/burmese.el", "start": 71683952, "end": 71686381}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/burmese.elc", "start": 71686381, "end": 71687358}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/cham.el", "start": 71687358, "end": 71688978}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/cham.elc", "start": 71688978, "end": 71689587}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/china-util.el", "start": 71689587, "end": 71696317}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/china-util.elc", "start": 71696317, "end": 71699939}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/chinese.el", "start": 71699939, "end": 71710340}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/chinese.elc", "start": 71710340, "end": 71717358}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/cyril-util.el", "start": 71717358, "end": 71725059}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/cyril-util.elc", "start": 71725059, "end": 71729983}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/cyrillic.el", "start": 71729983, "end": 71738878}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/cyrillic.elc", "start": 71738878, "end": 71744113}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/czech.el", "start": 71744113, "end": 71745660}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/czech.elc", "start": 71745660, "end": 71746263}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/english.el", "start": 71746263, "end": 71748813}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/english.elc", "start": 71748813, "end": 71749716}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/ethio-util.el", "start": 71749716, "end": 71804839}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/ethio-util.elc", "start": 71804839, "end": 71864529}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/ethiopic.el", "start": 71864529, "end": 71867719}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/ethiopic.elc", "start": 71867719, "end": 71869119}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/european.el", "start": 71869119, "end": 71893348}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/european.elc", "start": 71893348, "end": 71911804}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/georgian.el", "start": 71911804, "end": 71913350}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/georgian.elc", "start": 71913350, "end": 71913997}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/greek.el", "start": 71913997, "end": 71916759}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/greek.elc", "start": 71916759, "end": 71918025}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/hanja-util.el", "start": 71918025, "end": 72437695}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/hanja-util.elc", "start": 72437695, "end": 72850468}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/hebrew.el", "start": 72850468, "end": 72860418}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/hebrew.elc", "start": 72860418, "end": 72864715}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/ind-util.el", "start": 72864715, "end": 72907817}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/ind-util.elc", "start": 72907817, "end": 72952778}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/indian.el", "start": 72952778, "end": 72987250}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/indian.elc", "start": 72987250, "end": 73003028}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/indonesian.el", "start": 73003028, "end": 73012205}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/indonesian.elc", "start": 73012205, "end": 73015639}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/japan-util.el", "start": 73015639, "end": 73029554}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/japan-util.elc", "start": 73029554, "end": 73040021}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/japanese.el", "start": 73040021, "end": 73050045}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/japanese.elc", "start": 73050045, "end": 73056698}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/khmer.el", "start": 73056698, "end": 73058161}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/khmer.elc", "start": 73058161, "end": 73058656}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/korea-util.el", "start": 73058656, "end": 73063912}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/korea-util.elc", "start": 73063912, "end": 73067387}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/korean.el", "start": 73067387, "end": 73071302}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/korean.elc", "start": 73071302, "end": 73073415}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/lao-util.el", "start": 73073415, "end": 73088211}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/lao-util.elc", "start": 73088211, "end": 73098462}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/lao.el", "start": 73098462, "end": 73101474}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/lao.elc", "start": 73101474, "end": 73102660}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/misc-lang.el", "start": 73102660, "end": 73116616}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/misc-lang.elc", "start": 73116616, "end": 73123698}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/philippine.el", "start": 73123698, "end": 73127628}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/philippine.elc", "start": 73127628, "end": 73129241}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/romanian.el", "start": 73129241, "end": 73131095}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/romanian.elc", "start": 73131095, "end": 73131982}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/sinhala.el", "start": 73131982, "end": 73133685}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/sinhala.elc", "start": 73133685, "end": 73134228}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/slovak.el", "start": 73134228, "end": 73135858}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/slovak.elc", "start": 73135858, "end": 73136470}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/tai-viet.el", "start": 73136470, "end": 73138839}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/tai-viet.elc", "start": 73138839, "end": 73140153}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/thai-util.el", "start": 73140153, "end": 73149639}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/thai-util.elc", "start": 73149639, "end": 73157683}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/thai-word.el", "start": 73157683, "end": 73381223}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/thai-word.elc", "start": 73381223, "end": 73584151}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/thai.el", "start": 73584151, "end": 73589008}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/thai.elc", "start": 73589008, "end": 73591555}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/tibet-util.el", "start": 73591555, "end": 73606683}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/tibet-util.elc", "start": 73606683, "end": 73614396}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/tibetan.el", "start": 73614396, "end": 73632560}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/tibetan.elc", "start": 73632560, "end": 73643481}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/tv-util.el", "start": 73643481, "end": 73648344}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/tv-util.elc", "start": 73648344, "end": 73650871}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/utf-8-lang.el", "start": 73650871, "end": 73652868}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/utf-8-lang.elc", "start": 73652868, "end": 73653272}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/viet-util.el", "start": 73653272, "end": 73662598}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/viet-util.elc", "start": 73662598, "end": 73666780}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/vietnamese.el", "start": 73666780, "end": 73670558}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/vietnamese.elc", "start": 73670558, "end": 73672459}, {"filename": "/usr/local/share/emacs/30.2/lisp/ldefs-boot.el", "start": 73672459, "end": 75200822}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/arabic.el", "start": 75200822, "end": 75202964}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/arabic.elc", "start": 75202964, "end": 75205347}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/cham.el", "start": 75205347, "end": 75207451}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/cham.elc", "start": 75207451, "end": 75210257}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/compose.el", "start": 75210257, "end": 75254199}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/compose.elc", "start": 75254199, "end": 75374526}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/croatian.el", "start": 75374526, "end": 75377875}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/croatian.elc", "start": 75377875, "end": 75383134}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/cyril-jis.el", "start": 75383134, "end": 75385955}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/cyril-jis.elc", "start": 75385955, "end": 75389561}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/cyrillic.el", "start": 75389561, "end": 75424214}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/cyrillic.elc", "start": 75424214, "end": 75484538}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/czech.el", "start": 75484538, "end": 75492456}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/czech.elc", "start": 75492456, "end": 75509054}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/emoji.el", "start": 75509054, "end": 75590712}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/emoji.elc", "start": 75590712, "end": 75990849}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/ethiopic.el", "start": 75990849, "end": 76009707}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/ethiopic.elc", "start": 76009707, "end": 76048742}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/georgian.el", "start": 76048742, "end": 76051888}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/georgian.elc", "start": 76051888, "end": 76056918}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/greek.el", "start": 76056918, "end": 76080754}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/greek.elc", "start": 76080754, "end": 76134397}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hangul.el", "start": 76134397, "end": 76156511}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hangul.elc", "start": 76156511, "end": 76173819}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hanja-jis.el", "start": 76173819, "end": 76203018}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hanja-jis.elc", "start": 76203018, "end": 76427437}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hanja.el", "start": 76427437, "end": 76449213}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hanja.elc", "start": 76449213, "end": 76611115}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hanja3.el", "start": 76611115, "end": 76637514}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hanja3.elc", "start": 76637514, "end": 76845787}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hebrew.el", "start": 76845787, "end": 76866701}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hebrew.elc", "start": 76866701, "end": 76895204}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/indian.el", "start": 76895204, "end": 76949081}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/indian.elc", "start": 76949081, "end": 77019971}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/indonesian.el", "start": 77019971, "end": 77028487}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/indonesian.elc", "start": 77028487, "end": 77046711}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/ipa-praat.el", "start": 77046711, "end": 77057859}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/ipa-praat.elc", "start": 77057859, "end": 77069372}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/ipa.el", "start": 77069372, "end": 77089255}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/ipa.elc", "start": 77089255, "end": 77105210}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/japanese.el", "start": 77105210, "end": 77127038}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/japanese.elc", "start": 77127038, "end": 77143700}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/lao.el", "start": 77143700, "end": 77149785}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/lao.elc", "start": 77149785, "end": 77153560}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/latin-alt.el", "start": 77153560, "end": 77185895}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/latin-alt.elc", "start": 77185895, "end": 77243016}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/latin-ltx.el", "start": 77243016, "end": 77264100}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/latin-ltx.elc", "start": 77264100, "end": 77365415}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/latin-post.el", "start": 77365415, "end": 77412975}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/latin-post.elc", "start": 77412975, "end": 77503718}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/latin-pre.el", "start": 77503718, "end": 77530464}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/latin-pre.elc", "start": 77530464, "end": 77580000}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/lrt.el", "start": 77580000, "end": 77583018}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/lrt.elc", "start": 77583018, "end": 77584436}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/misc-lang.el", "start": 77584436, "end": 77620569}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/misc-lang.elc", "start": 77620569, "end": 77685284}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/pakistan.el", "start": 77685284, "end": 77701701}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/pakistan.elc", "start": 77701701, "end": 77722276}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/persian.el", "start": 77722276, "end": 77740836}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/persian.elc", "start": 77740836, "end": 77750998}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/philippine.el", "start": 77750998, "end": 77754019}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/philippine.elc", "start": 77754019, "end": 77758112}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/programmer-dvorak.el", "start": 77758112, "end": 77760692}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/programmer-dvorak.elc", "start": 77760692, "end": 77764064}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/py-punct.el", "start": 77764064, "end": 77766594}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/py-punct.elc", "start": 77766594, "end": 77767954}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/pypunct-b5.el", "start": 77767954, "end": 77769783}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/pypunct-b5.elc", "start": 77769783, "end": 77770609}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/rfc1345.el", "start": 77770609, "end": 77798416}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/rfc1345.elc", "start": 77798416, "end": 77868404}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/sami.el", "start": 77868404, "end": 77879227}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/sami.elc", "start": 77879227, "end": 77902855}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/sgml-input.el", "start": 77902855, "end": 77952576}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/sgml-input.elc", "start": 77952576, "end": 78019677}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/sisheng.el", "start": 78019677, "end": 78027447}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/sisheng.elc", "start": 78027447, "end": 78032199}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/slovak.el", "start": 78032199, "end": 78040301}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/slovak.elc", "start": 78040301, "end": 78056782}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/symbol-ksc.el", "start": 78056782, "end": 78063870}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/symbol-ksc.elc", "start": 78063870, "end": 78095225}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/tamil-dvorak.el", "start": 78095225, "end": 78098235}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/tamil-dvorak.elc", "start": 78098235, "end": 78101880}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/thai.el", "start": 78101880, "end": 78106426}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/thai.elc", "start": 78106426, "end": 78113418}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/tibetan.el", "start": 78113418, "end": 78129367}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/tibetan.elc", "start": 78129367, "end": 78139017}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/uni-input.el", "start": 78139017, "end": 78143287}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/uni-input.elc", "start": 78143287, "end": 78146096}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/viqr.el", "start": 78146096, "end": 78148429}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/viqr.elc", "start": 78148429, "end": 78154471}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/vntelex.el", "start": 78154471, "end": 78167791}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/vntelex.elc", "start": 78167791, "end": 78180210}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/vnvni.el", "start": 78180210, "end": 78191682}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/vnvni.elc", "start": 78191682, "end": 78200002}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/welsh.el", "start": 78200002, "end": 78203380}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/welsh.elc", "start": 78203380, "end": 78206251}, {"filename": "/usr/local/share/emacs/30.2/lisp/loaddefs.el", "start": 78206251, "end": 79734592}, {"filename": "/usr/local/share/emacs/30.2/lisp/loaddefs.elc", "start": 79734592, "end": 81230712}, {"filename": "/usr/local/share/emacs/30.2/lisp/loadhist.el", "start": 81230712, "end": 81244764}, {"filename": "/usr/local/share/emacs/30.2/lisp/loadhist.elc", "start": 81244764, "end": 81254550}, {"filename": "/usr/local/share/emacs/30.2/lisp/loadup.el", "start": 81254550, "end": 81284523}, {"filename": "/usr/local/share/emacs/30.2/lisp/locate.el", "start": 81284523, "end": 81310638}, {"filename": "/usr/local/share/emacs/30.2/lisp/locate.elc", "start": 81310638, "end": 81330391}, {"filename": "/usr/local/share/emacs/30.2/lisp/lpr.el", "start": 81330391, "end": 81343356}, {"filename": "/usr/local/share/emacs/30.2/lisp/lpr.elc", "start": 81343356, "end": 81353102}, {"filename": "/usr/local/share/emacs/30.2/lisp/ls-lisp.el", "start": 81353102, "end": 81391785}, {"filename": "/usr/local/share/emacs/30.2/lisp/ls-lisp.elc", "start": 81391785, "end": 81415850}, {"filename": "/usr/local/share/emacs/30.2/lisp/macros.el", "start": 81415850, "end": 81424663}, {"filename": "/usr/local/share/emacs/30.2/lisp/macros.elc", "start": 81424663, "end": 81430744}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/binhex.el", "start": 81430744, "end": 81442620}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/binhex.elc", "start": 81442620, "end": 81450887}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/blessmail.el", "start": 81450887, "end": 81453466}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/emacsbug.el", "start": 81453466, "end": 81477404}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/emacsbug.elc", "start": 81477404, "end": 81494498}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/feedmail.el", "start": 81494498, "end": 81631650}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/feedmail.elc", "start": 81631650, "end": 81730640}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/flow-fill.el", "start": 81730640, "end": 81737398}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/flow-fill.elc", "start": 81737398, "end": 81740520}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/footnote.el", "start": 81740520, "end": 81775478}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/footnote.elc", "start": 81775478, "end": 81803366}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/hashcash.el", "start": 81803366, "end": 81817013}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/hashcash.elc", "start": 81817013, "end": 81827799}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/ietf-drums-date.el", "start": 81827799, "end": 81839825}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/ietf-drums-date.elc", "start": 81839825, "end": 81845973}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/ietf-drums.el", "start": 81845973, "end": 81857181}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/ietf-drums.elc", "start": 81857181, "end": 81866519}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-extr.el", "start": 81866519, "end": 81944881}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-extr.elc", "start": 81944881, "end": 81979823}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-hist.el", "start": 81979823, "end": 81990736}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-hist.elc", "start": 81990736, "end": 82005027}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-parse.el", "start": 82005027, "end": 82010027}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-parse.elc", "start": 82010027, "end": 82013321}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-prsvr.el", "start": 82013321, "end": 82014918}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-prsvr.elc", "start": 82014918, "end": 82015701}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-utils.el", "start": 82015701, "end": 82030768}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-utils.elc", "start": 82030768, "end": 82040168}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mailabbrev.el", "start": 82040168, "end": 82065192}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mailabbrev.elc", "start": 82065192, "end": 82080516}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mailalias.el", "start": 82080516, "end": 82101967}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mailalias.elc", "start": 82101967, "end": 82115445}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mailclient.el", "start": 82115445, "end": 82123246}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mailclient.elc", "start": 82123246, "end": 82127209}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mailheader.el", "start": 82127209, "end": 82135353}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mailheader.elc", "start": 82135353, "end": 82140414}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mspools.el", "start": 82140414, "end": 82154018}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mspools.elc", "start": 82154018, "end": 82162762}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/qp.el", "start": 82162762, "end": 82169382}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/qp.elc", "start": 82169382, "end": 82173266}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/reporter.el", "start": 82173266, "end": 82187965}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/reporter.elc", "start": 82187965, "end": 82196703}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc2045.el", "start": 82196703, "end": 82198203}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc2045.elc", "start": 82198203, "end": 82198697}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc2047.el", "start": 82198697, "end": 82240513}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc2047.elc", "start": 82240513, "end": 82265367}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc2231.el", "start": 82265367, "end": 82275440}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc2231.elc", "start": 82275440, "end": 82281640}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc6068.el", "start": 82281640, "end": 82284686}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc6068.elc", "start": 82284686, "end": 82286563}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc822.el", "start": 82286563, "end": 82297462}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc822.elc", "start": 82297462, "end": 82302778}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmail-spam-filter.el", "start": 82302778, "end": 82326554}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmail-spam-filter.elc", "start": 82326554, "end": 82339232}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmail.el", "start": 82339232, "end": 82528310}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmail.elc", "start": 82528310, "end": 82659903}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailedit.el", "start": 82659903, "end": 82679869}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailedit.elc", "start": 82679869, "end": 82689257}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailkwd.el", "start": 82689257, "end": 82696358}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailkwd.elc", "start": 82696358, "end": 82701071}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailmm.el", "start": 82701071, "end": 82763970}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailmm.elc", "start": 82763970, "end": 82825247}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailmsc.el", "start": 82825247, "end": 82827257}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailmsc.elc", "start": 82827257, "end": 82828316}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailout.el", "start": 82828316, "end": 82855101}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailout.elc", "start": 82855101, "end": 82872733}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailsort.el", "start": 82872733, "end": 82881775}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailsort.elc", "start": 82881775, "end": 82887755}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailsum.el", "start": 82887755, "end": 82967747}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailsum.elc", "start": 82967747, "end": 83030198}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/sendmail.el", "start": 83030198, "end": 83108609}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/sendmail.elc", "start": 83108609, "end": 83164312}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/smtpmail.el", "start": 83164312, "end": 83206687}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/smtpmail.elc", "start": 83206687, "end": 83233961}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/supercite.el", "start": 83233961, "end": 83301967}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/supercite.elc", "start": 83301967, "end": 83361337}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/undigest.el", "start": 83361337, "end": 83375295}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/undigest.elc", "start": 83375295, "end": 83384019}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/unrmail.el", "start": 83384019, "end": 83393520}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/unrmail.elc", "start": 83393520, "end": 83398521}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/uudecode.el", "start": 83398521, "end": 83405047}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/uudecode.elc", "start": 83405047, "end": 83409855}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/yenc.el", "start": 83409855, "end": 83414999}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/yenc.elc", "start": 83414999, "end": 83418249}, {"filename": "/usr/local/share/emacs/30.2/lisp/man.el", "start": 83418249, "end": 83500677}, {"filename": "/usr/local/share/emacs/30.2/lisp/man.elc", "start": 83500677, "end": 83562998}, {"filename": "/usr/local/share/emacs/30.2/lisp/master.el", "start": 83562998, "end": 83567823}, {"filename": "/usr/local/share/emacs/30.2/lisp/master.elc", "start": 83567823, "end": 83572683}, {"filename": "/usr/local/share/emacs/30.2/lisp/mb-depth.el", "start": 83572683, "end": 83576150}, {"filename": "/usr/local/share/emacs/30.2/lisp/mb-depth.elc", "start": 83576150, "end": 83580652}, {"filename": "/usr/local/share/emacs/30.2/lisp/md4.el", "start": 83580652, "end": 83589557}, {"filename": "/usr/local/share/emacs/30.2/lisp/md4.elc", "start": 83589557, "end": 83597939}, {"filename": "/usr/local/share/emacs/30.2/lisp/menu-bar.el", "start": 83597939, "end": 83728626}, {"filename": "/usr/local/share/emacs/30.2/lisp/menu-bar.elc", "start": 83728626, "end": 83831082}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/ChangeLog.1", "start": 83831082, "end": 84275176}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/ChangeLog.2", "start": 84275176, "end": 84420950}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-acros.el", "start": 84420950, "end": 84429832}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-acros.elc", "start": 84429832, "end": 84436077}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-alias.el", "start": 84436077, "end": 84463388}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-alias.elc", "start": 84463388, "end": 84480942}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-buffers.el", "start": 84480942, "end": 84484057}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-buffers.elc", "start": 84484057, "end": 84485359}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-comp.el", "start": 84485359, "end": 84537689}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-comp.elc", "start": 84537689, "end": 84574732}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-e.el", "start": 84574732, "end": 84718226}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-e.elc", "start": 84718226, "end": 84839819}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-folder.el", "start": 84839819, "end": 84921056}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-folder.elc", "start": 84921056, "end": 84984814}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-funcs.el", "start": 84984814, "end": 84999994}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-funcs.elc", "start": 84999994, "end": 85012144}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-gnus.el", "start": 85012144, "end": 85015975}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-gnus.elc", "start": 85015975, "end": 85018451}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-identity.el", "start": 85018451, "end": 85030208}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-identity.elc", "start": 85030208, "end": 85038380}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-inc.el", "start": 85038380, "end": 85041281}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-inc.elc", "start": 85041281, "end": 85042827}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-junk.el", "start": 85042827, "end": 85063600}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-junk.elc", "start": 85063600, "end": 85082348}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-letter.el", "start": 85082348, "end": 85120160}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-letter.elc", "start": 85120160, "end": 85148140}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-limit.el", "start": 85148140, "end": 85160603}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-limit.elc", "start": 85160603, "end": 85170485}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-loaddefs.el", "start": 85170485, "end": 85264801}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-loaddefs.elc", "start": 85264801, "end": 85362253}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-mime.el", "start": 85362253, "end": 85435847}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-mime.elc", "start": 85435847, "end": 85493954}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-print.el", "start": 85493954, "end": 85503173}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-print.elc", "start": 85503173, "end": 85511132}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-scan.el", "start": 85511132, "end": 85531083}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-scan.elc", "start": 85531083, "end": 85549403}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-search.el", "start": 85549403, "end": 85627196}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-search.elc", "start": 85627196, "end": 85684994}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-seq.el", "start": 85684994, "end": 85725535}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-seq.elc", "start": 85725535, "end": 85761015}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-show.el", "start": 85761015, "end": 85797354}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-show.elc", "start": 85797354, "end": 85902373}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-speed.el", "start": 85902373, "end": 85926096}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-speed.elc", "start": 85926096, "end": 85941243}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-thread.el", "start": 85941243, "end": 85978396}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-thread.elc", "start": 85978396, "end": 86039909}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-tool-bar.el", "start": 86039909, "end": 86057358}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-tool-bar.elc", "start": 86057358, "end": 86079939}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-utils.el", "start": 86079939, "end": 86120166}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-utils.elc", "start": 86120166, "end": 86147603}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-xface.el", "start": 86147603, "end": 86164637}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-xface.elc", "start": 86164637, "end": 86177005}, {"filename": "/usr/local/share/emacs/30.2/lisp/midnight.el", "start": 86177005, "end": 86187034}, {"filename": "/usr/local/share/emacs/30.2/lisp/midnight.elc", "start": 86187034, "end": 86197898}, {"filename": "/usr/local/share/emacs/30.2/lisp/minibuf-eldef.el", "start": 86197898, "end": 86206378}, {"filename": "/usr/local/share/emacs/30.2/lisp/minibuf-eldef.elc", "start": 86206378, "end": 86213445}, {"filename": "/usr/local/share/emacs/30.2/lisp/minibuffer.el", "start": 86213445, "end": 86460719}, {"filename": "/usr/local/share/emacs/30.2/lisp/minibuffer.elc", "start": 86460719, "end": 86619256}, {"filename": "/usr/local/share/emacs/30.2/lisp/misc.el", "start": 86619256, "end": 86631696}, {"filename": "/usr/local/share/emacs/30.2/lisp/misc.elc", "start": 86631696, "end": 86640477}, {"filename": "/usr/local/share/emacs/30.2/lisp/misearch.el", "start": 86640477, "end": 86663720}, {"filename": "/usr/local/share/emacs/30.2/lisp/misearch.elc", "start": 86663720, "end": 86681102}, {"filename": "/usr/local/share/emacs/30.2/lisp/mouse-copy.el", "start": 86681102, "end": 86689719}, {"filename": "/usr/local/share/emacs/30.2/lisp/mouse-copy.elc", "start": 86689719, "end": 86692813}, {"filename": "/usr/local/share/emacs/30.2/lisp/mouse-drag.el", "start": 86692813, "end": 86705820}, {"filename": "/usr/local/share/emacs/30.2/lisp/mouse-drag.elc", "start": 86705820, "end": 86712108}, {"filename": "/usr/local/share/emacs/30.2/lisp/mouse.el", "start": 86712108, "end": 86876661}, {"filename": "/usr/local/share/emacs/30.2/lisp/mouse.elc", "start": 86876661, "end": 86972926}, {"filename": "/usr/local/share/emacs/30.2/lisp/mpc.el", "start": 86972926, "end": 87092664}, {"filename": "/usr/local/share/emacs/30.2/lisp/mpc.elc", "start": 87092664, "end": 87172486}, {"filename": "/usr/local/share/emacs/30.2/lisp/msb.el", "start": 87172486, "end": 87211285}, {"filename": "/usr/local/share/emacs/30.2/lisp/msb.elc", "start": 87211285, "end": 87239067}, {"filename": "/usr/local/share/emacs/30.2/lisp/mwheel.el", "start": 87239067, "end": 87260446}, {"filename": "/usr/local/share/emacs/30.2/lisp/mwheel.elc", "start": 87260446, "end": 87277963}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/ange-ftp.el", "start": 87277963, "end": 87523784}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/ange-ftp.elc", "start": 87523784, "end": 87650203}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/browse-url.el", "start": 87650203, "end": 87722297}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/browse-url.elc", "start": 87722297, "end": 87782896}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dbus.el", "start": 87782896, "end": 87871511}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dbus.elc", "start": 87871511, "end": 87944473}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dictionary-connection.el", "start": 87944473, "end": 87950826}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dictionary-connection.elc", "start": 87950826, "end": 87956786}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dictionary.el", "start": 87956786, "end": 88019771}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dictionary.elc", "start": 88019771, "end": 88074595}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dig.el", "start": 88074595, "end": 88081082}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dig.elc", "start": 88081082, "end": 88088008}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dns.el", "start": 88088008, "end": 88106130}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dns.elc", "start": 88106130, "end": 88118365}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-bob.el", "start": 88118365, "end": 88127595}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-bob.elc", "start": 88127595, "end": 88135227}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-capf.el", "start": 88135227, "end": 88140989}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-capf.elc", "start": 88140989, "end": 88142883}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-export.el", "start": 88142883, "end": 88151601}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-export.elc", "start": 88151601, "end": 88156863}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-hotlist.el", "start": 88156863, "end": 88163067}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-hotlist.elc", "start": 88163067, "end": 88169562}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-vars.el", "start": 88169562, "end": 88188480}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-vars.elc", "start": 88188480, "end": 88207256}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc.el", "start": 88207256, "end": 88257406}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc.elc", "start": 88257406, "end": 88295766}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-bbdb.el", "start": 88295766, "end": 88306382}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-bbdb.elc", "start": 88306382, "end": 88312290}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-ecomplete.el", "start": 88312290, "end": 88316194}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-ecomplete.elc", "start": 88316194, "end": 88317974}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-ldap.el", "start": 88317974, "end": 88325777}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-ldap.elc", "start": 88325777, "end": 88330991}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-mab.el", "start": 88330991, "end": 88335058}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-mab.elc", "start": 88335058, "end": 88337218}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-macos-contacts.el", "start": 88337218, "end": 88347032}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-macos-contacts.elc", "start": 88347032, "end": 88353522}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-mailabbrev.el", "start": 88353522, "end": 88358607}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-mailabbrev.elc", "start": 88358607, "end": 88360501}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eww.el", "start": 88360501, "end": 88467585}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eww.elc", "start": 88467585, "end": 88560037}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/gnutls.el", "start": 88560037, "end": 88576788}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/gnutls.elc", "start": 88576788, "end": 88589529}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/goto-addr.el", "start": 88589529, "end": 88601498}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/goto-addr.elc", "start": 88601498, "end": 88617309}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/hmac-def.el", "start": 88617309, "end": 88620284}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/hmac-def.elc", "start": 88620284, "end": 88621979}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/hmac-md5.el", "start": 88621979, "end": 88623715}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/hmac-md5.elc", "start": 88623715, "end": 88625641}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/imap.el", "start": 88625641, "end": 88730657}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/imap.elc", "start": 88730657, "end": 88833215}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/ldap.el", "start": 88833215, "end": 88861984}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/ldap.elc", "start": 88861984, "end": 88880088}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/mailcap.el", "start": 88880088, "end": 88924382}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/mailcap.elc", "start": 88924382, "end": 88955478}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/mairix.el", "start": 88955478, "end": 88987333}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/mairix.elc", "start": 88987333, "end": 89013141}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/net-utils.el", "start": 89013141, "end": 89046968}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/net-utils.elc", "start": 89046968, "end": 89084108}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/network-stream.el", "start": 89084108, "end": 89105611}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/network-stream.elc", "start": 89105611, "end": 89118539}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-backend.el", "start": 89118539, "end": 89223285}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-backend.elc", "start": 89223285, "end": 89290054}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-plainview.el", "start": 89290054, "end": 89360038}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-plainview.elc", "start": 89360038, "end": 89408335}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-reader.el", "start": 89408335, "end": 89422750}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-reader.elc", "start": 89422750, "end": 89432479}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-ticker.el", "start": 89432479, "end": 89446498}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-ticker.elc", "start": 89446498, "end": 89455587}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-treeview.el", "start": 89455587, "end": 89548602}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-treeview.elc", "start": 89548602, "end": 89626021}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newsticker.el", "start": 89626021, "end": 89643379}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newsticker.elc", "start": 89643379, "end": 89643822}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/nsm.el", "start": 89643822, "end": 89687471}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/nsm.elc", "start": 89687471, "end": 89722360}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/ntlm.el", "start": 89722360, "end": 89749672}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/ntlm.elc", "start": 89749672, "end": 89766161}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/pop3.el", "start": 89766161, "end": 89795432}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/pop3.elc", "start": 89795432, "end": 89815630}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/puny.el", "start": 89815630, "end": 89825222}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/puny.elc", "start": 89825222, "end": 89830050}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/rcirc.el", "start": 89830050, "end": 89998953}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/rcirc.elc", "start": 89998953, "end": 90152218}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/rfc2104.el", "start": 90152218, "end": 90156030}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/rfc2104.elc", "start": 90156030, "end": 90156908}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-cram.el", "start": 90156908, "end": 90158489}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-cram.elc", "start": 90158489, "end": 90159178}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-digest.el", "start": 90159178, "end": 90163956}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-digest.elc", "start": 90163956, "end": 90166995}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-ntlm.el", "start": 90166995, "end": 90169372}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-ntlm.elc", "start": 90169372, "end": 90170654}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-scram-rfc.el", "start": 90170654, "end": 90177576}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-scram-rfc.elc", "start": 90177576, "end": 90181223}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-scram-sha256.el", "start": 90181223, "end": 90183132}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-scram-sha256.elc", "start": 90183132, "end": 90184138}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl.el", "start": 90184138, "end": 90192398}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl.elc", "start": 90192398, "end": 90198719}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/secrets.el", "start": 90198719, "end": 90234231}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/secrets.elc", "start": 90234231, "end": 90257996}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/shr-color.el", "start": 90257996, "end": 90271190}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/shr-color.elc", "start": 90271190, "end": 90279882}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/shr.el", "start": 90279882, "end": 90380194}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/shr.elc", "start": 90380194, "end": 90453979}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sieve-manage.el", "start": 90453979, "end": 90476971}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sieve-manage.elc", "start": 90476971, "end": 90493957}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sieve-mode.el", "start": 90493957, "end": 90500141}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sieve-mode.elc", "start": 90500141, "end": 90506014}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sieve.el", "start": 90506014, "end": 90518869}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sieve.elc", "start": 90518869, "end": 90530319}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/snmp-mode.el", "start": 90530319, "end": 90552294}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/snmp-mode.elc", "start": 90552294, "end": 90566801}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/soap-client.el", "start": 90566801, "end": 90709111}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/soap-client.elc", "start": 90709111, "end": 90942962}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/soap-inspect.el", "start": 90942962, "end": 90963821}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/soap-inspect.elc", "start": 90963821, "end": 90983894}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/socks.el", "start": 90983894, "end": 91007168}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/socks.elc", "start": 91007168, "end": 91019786}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/telnet.el", "start": 91019786, "end": 91030712}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/telnet.elc", "start": 91030712, "end": 91040083}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-adb.el", "start": 91040083, "end": 91090804}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-adb.elc", "start": 91090804, "end": 91174613}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-androidsu.el", "start": 91174613, "end": 91199097}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-androidsu.elc", "start": 91199097, "end": 91223221}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-archive.el", "start": 91223221, "end": 91255337}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-archive.elc", "start": 91255337, "end": 91282051}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-cache.el", "start": 91282051, "end": 91309685}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-cache.elc", "start": 91309685, "end": 91332237}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-cmds.el", "start": 91332237, "end": 91364633}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-cmds.elc", "start": 91364633, "end": 91392116}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-compat.el", "start": 91392116, "end": 91407149}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-compat.elc", "start": 91407149, "end": 91418446}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-container.el", "start": 91418446, "end": 91444194}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-container.elc", "start": 91444194, "end": 91467850}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-crypt.el", "start": 91467850, "end": 91505054}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-crypt.elc", "start": 91505054, "end": 91554700}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-ftp.el", "start": 91554700, "end": 91562903}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-ftp.elc", "start": 91562903, "end": 91567257}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-fuse.el", "start": 91567257, "end": 91577288}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-fuse.elc", "start": 91577288, "end": 91594321}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-gvfs.el", "start": 91594321, "end": 91699089}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-gvfs.elc", "start": 91699089, "end": 91813253}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-integration.el", "start": 91813253, "end": 91832384}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-integration.elc", "start": 91832384, "end": 91845633}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-loaddefs.el", "start": 91845633, "end": 91954788}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-loaddefs.elc", "start": 91954788, "end": 92075180}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-message.el", "start": 92075180, "end": 92097757}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-message.elc", "start": 92097757, "end": 92115906}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-rclone.el", "start": 92115906, "end": 92134639}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-rclone.elc", "start": 92134639, "end": 92156639}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-sh.el", "start": 92156639, "end": 92404805}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-sh.elc", "start": 92404805, "end": 92645308}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-smb.el", "start": 92645308, "end": 92722367}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-smb.elc", "start": 92722367, "end": 92822758}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-sshfs.el", "start": 92822758, "end": 92839522}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-sshfs.elc", "start": 92839522, "end": 92866200}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-sudoedit.el", "start": 92866200, "end": 92902300}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-sudoedit.elc", "start": 92902300, "end": 92963258}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-uu.el", "start": 92963258, "end": 92966377}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-uu.elc", "start": 92966377, "end": 92967970}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp.el", "start": 92967970, "end": 93255148}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp.elc", "start": 93255148, "end": 93540164}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/trampver.el", "start": 93540164, "end": 93544533}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/trampver.elc", "start": 93544533, "end": 93546993}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/webjump.el", "start": 93546993, "end": 93563136}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/webjump.elc", "start": 93563136, "end": 93573523}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/zeroconf.el", "start": 93573523, "end": 93598845}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/zeroconf.elc", "start": 93598845, "end": 93616984}, {"filename": "/usr/local/share/emacs/30.2/lisp/newcomment.el", "start": 93616984, "end": 93682701}, {"filename": "/usr/local/share/emacs/30.2/lisp/newcomment.elc", "start": 93682701, "end": 93722895}, {"filename": "/usr/local/share/emacs/30.2/lisp/notifications.el", "start": 93722895, "end": 93740388}, {"filename": "/usr/local/share/emacs/30.2/lisp/notifications.elc", "start": 93740388, "end": 93753502}, {"filename": "/usr/local/share/emacs/30.2/lisp/novice.el", "start": 93753502, "end": 93760421}, {"filename": "/usr/local/share/emacs/30.2/lisp/novice.elc", "start": 93760421, "end": 93764024}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-enc.el", "start": 93764024, "end": 93769703}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-enc.elc", "start": 93769703, "end": 93772698}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-maint.el", "start": 93772698, "end": 93774863}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-maint.elc", "start": 93774863, "end": 93775713}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-mode.el", "start": 93775713, "end": 93858985}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-mode.elc", "start": 93858985, "end": 93924584}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-ns.el", "start": 93924584, "end": 93929341}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-ns.elc", "start": 93929341, "end": 93933310}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-outln.el", "start": 93933310, "end": 93969567}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-outln.elc", "start": 93969567, "end": 93996375}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-parse.el", "start": 93996375, "end": 94008133}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-parse.elc", "start": 94008133, "end": 94016581}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-rap.el", "start": 94016581, "end": 94027770}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-rap.elc", "start": 94027770, "end": 94034220}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-util.el", "start": 94034220, "end": 94037170}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-util.elc", "start": 94037170, "end": 94039432}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-cmpct.el", "start": 94039432, "end": 94068332}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-cmpct.elc", "start": 94068332, "end": 94093575}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-dt.el", "start": 94093575, "end": 94095751}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-dt.elc", "start": 94095751, "end": 94097287}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-loc.el", "start": 94097287, "end": 94115533}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-loc.elc", "start": 94115533, "end": 94129203}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-maint.el", "start": 94129203, "end": 94137934}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-maint.elc", "start": 94137934, "end": 94143142}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-match.el", "start": 94143142, "end": 94196769}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-match.elc", "start": 94196769, "end": 94247566}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-nxml.el", "start": 94247566, "end": 94267236}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-nxml.elc", "start": 94267236, "end": 94280841}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-parse.el", "start": 94280841, "end": 94284459}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-parse.elc", "start": 94284459, "end": 94286792}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-pttrn.el", "start": 94286792, "end": 94291713}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-pttrn.elc", "start": 94291713, "end": 94295082}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-uri.el", "start": 94295082, "end": 94306023}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-uri.elc", "start": 94306023, "end": 94313479}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-util.el", "start": 94313479, "end": 94315666}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-util.elc", "start": 94315666, "end": 94317048}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-valid.el", "start": 94317048, "end": 94365786}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-valid.elc", "start": 94365786, "end": 94401556}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-xsd.el", "start": 94401556, "end": 94430537}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-xsd.elc", "start": 94430537, "end": 94452419}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/xmltok.el", "start": 94452419, "end": 94512297}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/xmltok.elc", "start": 94512297, "end": 94548605}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/xsd-regexp.el", "start": 94548605, "end": 94603478}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/xsd-regexp.elc", "start": 94603478, "end": 94643538}, {"filename": "/usr/local/share/emacs/30.2/lisp/obarray.el", "start": 94643538, "end": 94645429}, {"filename": "/usr/local/share/emacs/30.2/lisp/obarray.elc", "start": 94645429, "end": 94646503}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/autoarg.el", "start": 94646503, "end": 94651971}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/autoarg.elc", "start": 94651971, "end": 94659684}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/autoload.el", "start": 94659684, "end": 94701643}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/autoload.elc", "start": 94701643, "end": 94722185}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/bruce.el", "start": 94722185, "end": 94728274}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/bruce.elc", "start": 94728274, "end": 94729573}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/cc-compat.el", "start": 94729573, "end": 94735317}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/cc-compat.elc", "start": 94735317, "end": 94737704}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/cl-compat.el", "start": 94737704, "end": 94743411}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/cl-compat.elc", "start": 94743411, "end": 94747423}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/cl.el", "start": 94747423, "end": 94774623}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/cl.elc", "start": 94774623, "end": 94789749}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/crisp.el", "start": 94789749, "end": 94803915}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/crisp.elc", "start": 94803915, "end": 94815197}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/eieio-compat.el", "start": 94815197, "end": 94826514}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/eieio-compat.elc", "start": 94826514, "end": 94834244}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/eudcb-ph.el", "start": 94834244, "end": 94842414}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/eudcb-ph.elc", "start": 94842414, "end": 94848088}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/gs.el", "start": 94848088, "end": 94856640}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/gs.elc", "start": 94856640, "end": 94859987}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/gulp.el", "start": 94859987, "end": 94866195}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/gulp.elc", "start": 94866195, "end": 94870825}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/html2text.el", "start": 94870825, "end": 94884857}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/html2text.elc", "start": 94884857, "end": 94894068}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/info-edit.el", "start": 94894068, "end": 94897123}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/info-edit.elc", "start": 94897123, "end": 94901165}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/inversion.el", "start": 94901165, "end": 94920160}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/inversion.elc", "start": 94920160, "end": 94932586}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/iswitchb.el", "start": 94932586, "end": 94980416}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/iswitchb.elc", "start": 94980416, "end": 95012262}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/landmark.el", "start": 95012262, "end": 95072255}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/landmark.elc", "start": 95072255, "end": 95113468}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/linum.el", "start": 95113468, "end": 95123758}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/linum.elc", "start": 95123758, "end": 95134944}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/longlines.el", "start": 95134944, "end": 95154701}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/longlines.elc", "start": 95154701, "end": 95170909}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/makesum.el", "start": 95170909, "end": 95174560}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/makesum.elc", "start": 95174560, "end": 95176548}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/mantemp.el", "start": 95176548, "end": 95184511}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/mantemp.elc", "start": 95184511, "end": 95187832}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/meese.el", "start": 95187832, "end": 95189094}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/meese.elc", "start": 95189094, "end": 95189595}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/messcompat.el", "start": 95189595, "end": 95191395}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/metamail.el", "start": 95191395, "end": 95199034}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/metamail.elc", "start": 95199034, "end": 95203093}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/mh-compat.el", "start": 95203093, "end": 95207812}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/mh-compat.elc", "start": 95207812, "end": 95211115}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/netrc.el", "start": 95211115, "end": 95218866}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/netrc.elc", "start": 95218866, "end": 95223702}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/nnir.el", "start": 95223702, "end": 95273227}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/nnir.elc", "start": 95273227, "end": 95311484}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/otodo-mode.el", "start": 95311484, "end": 95347666}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/otodo-mode.elc", "start": 95347666, "end": 95372102}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-def.el", "start": 95372102, "end": 95374760}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-def.elc", "start": 95374760, "end": 95377139}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-gpg.el", "start": 95377139, "end": 95392595}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-gpg.elc", "start": 95392595, "end": 95404980}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-parse.el", "start": 95404980, "end": 95421168}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-parse.elc", "start": 95421168, "end": 95434022}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-pgp.el", "start": 95434022, "end": 95443199}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-pgp.elc", "start": 95443199, "end": 95450481}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-pgp5.el", "start": 95450481, "end": 95459130}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-pgp5.elc", "start": 95459130, "end": 95466451}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg.el", "start": 95466451, "end": 95484144}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg.elc", "start": 95484144, "end": 95502680}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/ps-def.el", "start": 95502680, "end": 95504433}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/ps-def.elc", "start": 95504433, "end": 95505279}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/quickurl.el", "start": 95505279, "end": 95523885}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/quickurl.elc", "start": 95523885, "end": 95541913}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/rcompile.el", "start": 95541913, "end": 95549085}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/rcompile.elc", "start": 95549085, "end": 95551929}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/rfc2368.el", "start": 95551929, "end": 95556353}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/rfc2368.elc", "start": 95556353, "end": 95558344}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/rlogin.el", "start": 95558344, "end": 95569817}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/rlogin.elc", "start": 95569817, "end": 95580755}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/sb-image.el", "start": 95580755, "end": 95582316}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/sb-image.elc", "start": 95582316, "end": 95582529}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/starttls.el", "start": 95582529, "end": 95593649}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/starttls.elc", "start": 95593649, "end": 95599719}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/sup-mouse.el", "start": 95599719, "end": 95605589}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/sup-mouse.elc", "start": 95605589, "end": 95609340}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/terminal.el", "start": 95609340, "end": 95655544}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/terminal.elc", "start": 95655544, "end": 95686196}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/thumbs.el", "start": 95686196, "end": 95711593}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/thumbs.elc", "start": 95711593, "end": 95737413}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/tls.el", "start": 95737413, "end": 95748042}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/tls.elc", "start": 95748042, "end": 95755246}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/tpu-edt.el", "start": 95755246, "end": 95842175}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/tpu-edt.elc", "start": 95842175, "end": 95902736}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/tpu-extras.el", "start": 95902736, "end": 95918098}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/tpu-extras.elc", "start": 95918098, "end": 95929502}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/tpu-mapper.el", "start": 95929502, "end": 95942405}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/tpu-mapper.elc", "start": 95942405, "end": 95952635}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/uce.el", "start": 95952635, "end": 95968495}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/uce.elc", "start": 95968495, "end": 95976933}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/url-about.el", "start": 95976933, "end": 95980387}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/url-about.elc", "start": 95980387, "end": 95982896}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/url-dired.el", "start": 95982896, "end": 95984721}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/url-dired.elc", "start": 95984721, "end": 95987651}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/url-ns.el", "start": 95987651, "end": 95991120}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/url-ns.elc", "start": 95991120, "end": 95993084}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vc-arch.el", "start": 95993084, "end": 96017721}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vc-arch.elc", "start": 96017721, "end": 96034774}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vc-mtn.el", "start": 96034774, "end": 96048597}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vc-mtn.elc", "start": 96048597, "end": 96062061}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vi.el", "start": 96062061, "end": 96120737}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vi.elc", "start": 96120737, "end": 96168980}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vip.el", "start": 96168980, "end": 96264939}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vip.elc", "start": 96264939, "end": 96341790}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vt-control.el", "start": 96341790, "end": 96345080}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vt-control.elc", "start": 96345080, "end": 96346661}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vt100-led.el", "start": 96346661, "end": 96348668}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vt100-led.elc", "start": 96348668, "end": 96349721}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/ws-mode.el", "start": 96349721, "end": 96368136}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/ws-mode.elc", "start": 96368136, "end": 96392334}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/yow.el", "start": 96392334, "end": 96395227}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/yow.elc", "start": 96395227, "end": 96397288}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ChangeLog.1", "start": 96397288, "end": 97551802}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-C.el", "start": 97551802, "end": 97569486}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-C.elc", "start": 97569486, "end": 97585480}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-R.el", "start": 97585480, "end": 97605649}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-R.elc", "start": 97605649, "end": 97626128}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-awk.el", "start": 97626128, "end": 97630472}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-awk.elc", "start": 97630472, "end": 97635261}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-calc.el", "start": 97635261, "end": 97640055}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-calc.elc", "start": 97640055, "end": 97644108}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-clojure.el", "start": 97644108, "end": 97658044}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-clojure.elc", "start": 97658044, "end": 97670378}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-comint.el", "start": 97670378, "end": 97686407}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-comint.elc", "start": 97686407, "end": 97700671}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-core.el", "start": 97700671, "end": 97846372}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-core.elc", "start": 97846372, "end": 97969471}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-css.el", "start": 97969471, "end": 97970990}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-css.elc", "start": 97970990, "end": 97973268}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-ditaa.el", "start": 97973268, "end": 97977450}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-ditaa.elc", "start": 97977450, "end": 97982029}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-dot.el", "start": 97982029, "end": 97985341}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-dot.elc", "start": 97985341, "end": 97988868}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-emacs-lisp.el", "start": 97988868, "end": 97993650}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-emacs-lisp.elc", "start": 97993650, "end": 97998692}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-eshell.el", "start": 97998692, "end": 98002732}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-eshell.elc", "start": 98002732, "end": 98007157}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-eval.el", "start": 98007157, "end": 98014068}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-eval.elc", "start": 98014068, "end": 98019865}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-exp.el", "start": 98019865, "end": 98038713}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-exp.elc", "start": 98038713, "end": 98052769}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-forth.el", "start": 98052769, "end": 98055972}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-forth.elc", "start": 98055972, "end": 98059462}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-fortran.el", "start": 98059462, "end": 98066366}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-fortran.elc", "start": 98066366, "end": 98073463}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-gnuplot.el", "start": 98073463, "end": 98086194}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-gnuplot.elc", "start": 98086194, "end": 98097131}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-groovy.el", "start": 98097131, "end": 98101448}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-groovy.elc", "start": 98101448, "end": 98106496}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-haskell.el", "start": 98106496, "end": 98122732}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-haskell.elc", "start": 98122732, "end": 98137999}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-java.el", "start": 98137999, "end": 98158775}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-java.elc", "start": 98158775, "end": 98175801}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-js.el", "start": 98175801, "end": 98183635}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-js.elc", "start": 98183635, "end": 98192211}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-julia.el", "start": 98192211, "end": 98204876}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-julia.elc", "start": 98204876, "end": 98218171}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-latex.el", "start": 98218171, "end": 98230018}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-latex.elc", "start": 98230018, "end": 98240397}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-lilypond.el", "start": 98240397, "end": 98257292}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-lilypond.elc", "start": 98257292, "end": 98273101}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-lisp.el", "start": 98273101, "end": 98278426}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-lisp.elc", "start": 98278426, "end": 98283814}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-lob.el", "start": 98283814, "end": 98290326}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-lob.elc", "start": 98290326, "end": 98298292}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-lua.el", "start": 98298292, "end": 98313455}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-lua.elc", "start": 98313455, "end": 98329221}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-makefile.el", "start": 98329221, "end": 98330759}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-makefile.elc", "start": 98330759, "end": 98333054}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-matlab.el", "start": 98333054, "end": 98334463}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-matlab.elc", "start": 98334463, "end": 98336327}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-maxima.el", "start": 98336327, "end": 98344516}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-maxima.elc", "start": 98344516, "end": 98352084}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-ocaml.el", "start": 98352084, "end": 98358443}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-ocaml.elc", "start": 98358443, "end": 98365692}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-octave.el", "start": 98365692, "end": 98375844}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-octave.elc", "start": 98375844, "end": 98387454}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-org.el", "start": 98387454, "end": 98390410}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-org.elc", "start": 98390410, "end": 98393777}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-perl.el", "start": 98393777, "end": 98399134}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-perl.elc", "start": 98399134, "end": 98405065}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-plantuml.el", "start": 98405065, "end": 98411521}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-plantuml.elc", "start": 98411521, "end": 98418632}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-processing.el", "start": 98418632, "end": 98425705}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-processing.elc", "start": 98425705, "end": 98431776}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-python.el", "start": 98431776, "end": 98455037}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-python.elc", "start": 98455037, "end": 98477468}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-ref.el", "start": 98477468, "end": 98487105}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-ref.elc", "start": 98487105, "end": 98494533}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-ruby.el", "start": 98494533, "end": 98505132}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-ruby.elc", "start": 98505132, "end": 98517365}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-sass.el", "start": 98517365, "end": 98519913}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-sass.elc", "start": 98519913, "end": 98522837}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-scheme.el", "start": 98522837, "end": 98534327}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-scheme.elc", "start": 98534327, "end": 98543184}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-screen.el", "start": 98543184, "end": 98548852}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-screen.elc", "start": 98548852, "end": 98554507}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-sed.el", "start": 98554507, "end": 98558234}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-sed.elc", "start": 98558234, "end": 98562426}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-shell.el", "start": 98562426, "end": 98578763}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-shell.elc", "start": 98578763, "end": 98595042}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-sql.el", "start": 98595042, "end": 98610900}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-sql.elc", "start": 98610900, "end": 98623729}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-sqlite.el", "start": 98623729, "end": 98629029}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-sqlite.elc", "start": 98629029, "end": 98634726}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-table.el", "start": 98634726, "end": 98640124}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-table.elc", "start": 98640124, "end": 98644790}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-tangle.el", "start": 98644790, "end": 98675260}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-tangle.elc", "start": 98675260, "end": 98701372}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob.el", "start": 98701372, "end": 98702692}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob.elc", "start": 98702692, "end": 98704739}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-basic.el", "start": 98704739, "end": 98743863}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-basic.elc", "start": 98743863, "end": 98770039}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-biblatex.el", "start": 98770039, "end": 98788406}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-biblatex.elc", "start": 98788406, "end": 98801672}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-bibtex.el", "start": 98801672, "end": 98804574}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-bibtex.elc", "start": 98804574, "end": 98807786}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-csl.el", "start": 98807786, "end": 98844443}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-csl.elc", "start": 98844443, "end": 98870970}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-natbib.el", "start": 98870970, "end": 98879330}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-natbib.elc", "start": 98879330, "end": 98887047}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc.el", "start": 98887047, "end": 98961821}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc.elc", "start": 98961821, "end": 99045348}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-bbdb.el", "start": 99045348, "end": 99065980}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-bbdb.elc", "start": 99065980, "end": 99080319}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-bibtex.el", "start": 99080319, "end": 99114846}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-bibtex.elc", "start": 99114846, "end": 99143601}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-docview.el", "start": 99143601, "end": 99147409}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-docview.elc", "start": 99147409, "end": 99150963}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-doi.el", "start": 99150963, "end": 99153433}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-doi.elc", "start": 99153433, "end": 99156698}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-eshell.el", "start": 99156698, "end": 99159250}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-eshell.elc", "start": 99159250, "end": 99162295}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-eww.el", "start": 99162295, "end": 99168462}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-eww.elc", "start": 99168462, "end": 99173129}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-gnus.el", "start": 99173129, "end": 99183755}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-gnus.elc", "start": 99183755, "end": 99193051}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-info.el", "start": 99193051, "end": 99200755}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-info.elc", "start": 99200755, "end": 99208339}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-irc.el", "start": 99208339, "end": 99218165}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-irc.elc", "start": 99218165, "end": 99225457}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-man.el", "start": 99225457, "end": 99230445}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-man.elc", "start": 99230445, "end": 99234988}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-mhe.el", "start": 99234988, "end": 99242975}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-mhe.elc", "start": 99242975, "end": 99249725}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-rmail.el", "start": 99249725, "end": 99254024}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-rmail.elc", "start": 99254024, "end": 99258003}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-w3m.el", "start": 99258003, "end": 99267368}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-w3m.elc", "start": 99267368, "end": 99273075}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol.el", "start": 99273075, "end": 99361969}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol.elc", "start": 99361969, "end": 99433849}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-agenda.el", "start": 99433849, "end": 99884792}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-agenda.elc", "start": 99884792, "end": 100296205}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-archive.el", "start": 100296205, "end": 100320882}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-archive.elc", "start": 100320882, "end": 100341114}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-attach-git.el", "start": 100341114, "end": 100346819}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-attach-git.elc", "start": 100346819, "end": 100352908}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-attach.el", "start": 100352908, "end": 100387066}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-attach.elc", "start": 100387066, "end": 100419091}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-capture.el", "start": 100419091, "end": 100501394}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-capture.elc", "start": 100501394, "end": 100578114}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-clock.el", "start": 100578114, "end": 100706608}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-clock.elc", "start": 100706608, "end": 100815159}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-colview.el", "start": 100815159, "end": 100887548}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-colview.elc", "start": 100887548, "end": 100964823}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-compat.el", "start": 100964823, "end": 101034494}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-compat.elc", "start": 101034494, "end": 101099417}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-crypt.el", "start": 101099417, "end": 101112364}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-crypt.elc", "start": 101112364, "end": 101123264}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-ctags.el", "start": 101123264, "end": 101144170}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-ctags.elc", "start": 101144170, "end": 101158472}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-cycle.el", "start": 101158472, "end": 101193318}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-cycle.elc", "start": 101193318, "end": 101219424}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-datetree.el", "start": 101219424, "end": 101230451}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-datetree.elc", "start": 101230451, "end": 101240662}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-duration.el", "start": 101240662, "end": 101256420}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-duration.elc", "start": 101256420, "end": 101269755}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-element-ast.el", "start": 101269755, "end": 101316958}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-element-ast.elc", "start": 101316958, "end": 101373727}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-element.el", "start": 101373727, "end": 101741180}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-element.elc", "start": 101741180, "end": 102136318}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-entities.el", "start": 102136318, "end": 102166509}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-entities.elc", "start": 102166509, "end": 102195616}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-faces.el", "start": 102195616, "end": 102224301}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-faces.elc", "start": 102224301, "end": 102255572}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-feed.el", "start": 102255572, "end": 102282230}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-feed.elc", "start": 102282230, "end": 102303029}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-fold-core.el", "start": 102303029, "end": 102386355}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-fold-core.elc", "start": 102386355, "end": 102453568}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-fold.el", "start": 102453568, "end": 102491964}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-fold.elc", "start": 102491964, "end": 102523362}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-footnote.el", "start": 102523362, "end": 102561908}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-footnote.elc", "start": 102561908, "end": 102602696}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-goto.el", "start": 102602696, "end": 102613189}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-goto.elc", "start": 102613189, "end": 102623845}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-habit.el", "start": 102623845, "end": 102641371}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-habit.elc", "start": 102641371, "end": 102657439}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-id.el", "start": 102657439, "end": 102691033}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-id.elc", "start": 102691033, "end": 102721080}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-indent.el", "start": 102721080, "end": 102738774}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-indent.elc", "start": 102738774, "end": 102756354}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-inlinetask.el", "start": 102756354, "end": 102769467}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-inlinetask.elc", "start": 102769467, "end": 102779836}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-keys.el", "start": 102779836, "end": 102822380}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-keys.elc", "start": 102822380, "end": 102849149}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-lint.el", "start": 102849149, "end": 102918388}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-lint.elc", "start": 102918388, "end": 103026705}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-list.el", "start": 103026705, "end": 103166941}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-list.elc", "start": 103166941, "end": 103271927}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-loaddefs.el", "start": 103271927, "end": 103390336}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-loaddefs.elc", "start": 103390336, "end": 103511754}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-macro.el", "start": 103511754, "end": 103529837}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-macro.elc", "start": 103529837, "end": 103545242}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-macs.el", "start": 103545242, "end": 103614522}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-macs.elc", "start": 103614522, "end": 103676274}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-mobile.el", "start": 103676274, "end": 103719321}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-mobile.elc", "start": 103719321, "end": 103762740}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-mouse.el", "start": 103762740, "end": 103802338}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-mouse.elc", "start": 103802338, "end": 103836007}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-num.el", "start": 103836007, "end": 103855355}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-num.elc", "start": 103855355, "end": 103873436}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-pcomplete.el", "start": 103873436, "end": 103890216}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-pcomplete.elc", "start": 103890216, "end": 103904493}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-persist.el", "start": 103904493, "end": 103966275}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-persist.elc", "start": 103966275, "end": 104009074}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-plot.el", "start": 104009074, "end": 104036908}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-plot.elc", "start": 104036908, "end": 104060445}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-protocol.el", "start": 104060445, "end": 104091582}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-protocol.elc", "start": 104091582, "end": 104115050}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-refile.el", "start": 104115050, "end": 104146054}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-refile.elc", "start": 104146054, "end": 104171769}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-src.el", "start": 104171769, "end": 104230731}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-src.elc", "start": 104230731, "end": 104282187}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-table.el", "start": 104282187, "end": 104527543}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-table.elc", "start": 104527543, "end": 104746577}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-tempo.el", "start": 104746577, "end": 104753202}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-tempo.elc", "start": 104753202, "end": 104759660}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-timer.el", "start": 104759660, "end": 104778245}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-timer.elc", "start": 104778245, "end": 104794112}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-version.el", "start": 104794112, "end": 104794733}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org.el", "start": 104794733, "end": 105685913}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org.elc", "start": 105685913, "end": 106452736}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-ascii.el", "start": 106452736, "end": 106533856}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-ascii.elc", "start": 106533856, "end": 106600936}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-beamer.el", "start": 106600936, "end": 106647588}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-beamer.elc", "start": 106647588, "end": 106684696}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-html.el", "start": 106684696, "end": 106841457}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-html.elc", "start": 106841457, "end": 106977854}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-icalendar.el", "start": 106977854, "end": 107026660}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-icalendar.elc", "start": 107026660, "end": 107067414}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-koma-letter.el", "start": 107067414, "end": 107108029}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-koma-letter.elc", "start": 107108029, "end": 107139376}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-latex.el", "start": 107139376, "end": 107319450}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-latex.elc", "start": 107319450, "end": 107472788}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-man.el", "start": 107472788, "end": 107511746}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-man.elc", "start": 107511746, "end": 107543762}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-md.el", "start": 107543762, "end": 107572853}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-md.elc", "start": 107572853, "end": 107600133}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-odt.el", "start": 107600133, "end": 107764492}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-odt.elc", "start": 107764492, "end": 107892040}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-org.el", "start": 107892040, "end": 107905713}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-org.elc", "start": 107905713, "end": 107920117}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-publish.el", "start": 107920117, "end": 107972727}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-publish.elc", "start": 107972727, "end": 108018742}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-texinfo.el", "start": 108018742, "end": 108096881}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-texinfo.elc", "start": 108096881, "end": 108169129}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox.el", "start": 108169129, "end": 108469102}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox.elc", "start": 108469102, "end": 108725128}, {"filename": "/usr/local/share/emacs/30.2/lisp/outline.el", "start": 108725128, "end": 108807398}, {"filename": "/usr/local/share/emacs/30.2/lisp/outline.elc", "start": 108807398, "end": 108876733}, {"filename": "/usr/local/share/emacs/30.2/lisp/paren.el", "start": 108876733, "end": 108898468}, {"filename": "/usr/local/share/emacs/30.2/lisp/paren.elc", "start": 108898468, "end": 108915893}, {"filename": "/usr/local/share/emacs/30.2/lisp/password-cache.el", "start": 108915893, "end": 108920068}, {"filename": "/usr/local/share/emacs/30.2/lisp/password-cache.elc", "start": 108920068, "end": 108922689}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-cvs.el", "start": 108922689, "end": 108929689}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-cvs.elc", "start": 108929689, "end": 108935715}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-git.el", "start": 108935715, "end": 108940487}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-git.elc", "start": 108940487, "end": 108943904}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-gnu.el", "start": 108943904, "end": 108958687}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-gnu.elc", "start": 108958687, "end": 108971741}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-linux.el", "start": 108971741, "end": 108978630}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-linux.elc", "start": 108978630, "end": 108984188}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-rpm.el", "start": 108984188, "end": 108997738}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-rpm.elc", "start": 108997738, "end": 109010960}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-unix.el", "start": 109010960, "end": 109033183}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-unix.elc", "start": 109033183, "end": 109057230}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-x.el", "start": 109057230, "end": 109070067}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-x.elc", "start": 109070067, "end": 109081528}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcomplete.el", "start": 109081528, "end": 109144120}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcomplete.elc", "start": 109144120, "end": 109189873}, {"filename": "/usr/local/share/emacs/30.2/lisp/pgtk-dnd.el", "start": 109189873, "end": 109207800}, {"filename": "/usr/local/share/emacs/30.2/lisp/pgtk-dnd.elc", "start": 109207800, "end": 109219958}, {"filename": "/usr/local/share/emacs/30.2/lisp/pixel-scroll.el", "start": 109219958, "end": 109257470}, {"filename": "/usr/local/share/emacs/30.2/lisp/pixel-scroll.elc", "start": 109257470, "end": 109285786}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/5x5.el", "start": 109285786, "end": 109315603}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/5x5.elc", "start": 109315603, "end": 109337117}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/animate.el", "start": 109337117, "end": 109344810}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/animate.elc", "start": 109344810, "end": 109349242}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/blackbox.el", "start": 109349242, "end": 109364210}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/blackbox.elc", "start": 109364210, "end": 109376919}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/bubbles.el", "start": 109376919, "end": 109420982}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/bubbles.elc", "start": 109420982, "end": 109465131}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/cookie1.el", "start": 109465131, "end": 109474620}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/cookie1.elc", "start": 109474620, "end": 109481014}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/decipher.el", "start": 109481014, "end": 109522135}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/decipher.elc", "start": 109522135, "end": 109546787}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/dissociate.el", "start": 109546787, "end": 109550044}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/dissociate.elc", "start": 109550044, "end": 109551495}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/doctor.el", "start": 109551495, "end": 109614335}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/doctor.elc", "start": 109614335, "end": 109663759}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/dunnet.el", "start": 109663759, "end": 109777247}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/dunnet.elc", "start": 109777247, "end": 109866508}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/fortune.el", "start": 109866508, "end": 109878414}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/fortune.elc", "start": 109878414, "end": 109887238}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/gamegrid.el", "start": 109887238, "end": 109910817}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/gamegrid.elc", "start": 109910817, "end": 109926590}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/gametree.el", "start": 109926590, "end": 109950728}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/gametree.elc", "start": 109950728, "end": 109969840}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/gomoku.el", "start": 109969840, "end": 110015221}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/gomoku.elc", "start": 110015221, "end": 110044639}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/handwrite.el", "start": 110044639, "end": 110106771}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/handwrite.elc", "start": 110106771, "end": 110166653}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/hanoi.el", "start": 110166653, "end": 110184835}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/hanoi.elc", "start": 110184835, "end": 110193196}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/life.el", "start": 110193196, "end": 110205250}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/life.elc", "start": 110205250, "end": 110214932}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/morse.el", "start": 110214932, "end": 110221543}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/morse.elc", "start": 110221543, "end": 110225554}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/mpuz.el", "start": 110225554, "end": 110240990}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/mpuz.elc", "start": 110240990, "end": 110255015}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/pong.el", "start": 110255015, "end": 110267874}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/pong.elc", "start": 110267874, "end": 110278126}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/snake.el", "start": 110278126, "end": 110290263}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/snake.elc", "start": 110290263, "end": 110302150}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/solitaire.el", "start": 110302150, "end": 110316050}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/solitaire.elc", "start": 110316050, "end": 110329209}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/spook.el", "start": 110329209, "end": 110331453}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/spook.elc", "start": 110331453, "end": 110332641}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/studly.el", "start": 110332641, "end": 110334568}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/studly.elc", "start": 110334568, "end": 110335579}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/tetris.el", "start": 110335579, "end": 110355923}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/tetris.elc", "start": 110355923, "end": 110374455}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/zone.el", "start": 110374455, "end": 110397222}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/zone.elc", "start": 110397222, "end": 110411913}, {"filename": "/usr/local/share/emacs/30.2/lisp/plstore.el", "start": 110411913, "end": 110439034}, {"filename": "/usr/local/share/emacs/30.2/lisp/plstore.elc", "start": 110439034, "end": 110455114}, {"filename": "/usr/local/share/emacs/30.2/lisp/printing.el", "start": 110455114, "end": 110669378}, {"filename": "/usr/local/share/emacs/30.2/lisp/printing.elc", "start": 110669378, "end": 110827145}, {"filename": "/usr/local/share/emacs/30.2/lisp/proced.el", "start": 110827145, "end": 110926783}, {"filename": "/usr/local/share/emacs/30.2/lisp/proced.elc", "start": 110926783, "end": 111003574}, {"filename": "/usr/local/share/emacs/30.2/lisp/profiler.el", "start": 111003574, "end": 111036729}, {"filename": "/usr/local/share/emacs/30.2/lisp/profiler.elc", "start": 111036729, "end": 111079501}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/antlr-mode.el", "start": 111079501, "end": 111181227}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/antlr-mode.elc", "start": 111181227, "end": 111259021}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/asm-mode.el", "start": 111259021, "end": 111267558}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/asm-mode.elc", "start": 111267558, "end": 111274781}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/autoconf.el", "start": 111274781, "end": 111278468}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/autoconf.elc", "start": 111278468, "end": 111282827}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/bat-mode.el", "start": 111282827, "end": 111289930}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/bat-mode.elc", "start": 111289930, "end": 111296312}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/bug-reference.el", "start": 111296312, "end": 111327388}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/bug-reference.elc", "start": 111327388, "end": 111354297}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/c-ts-common.el", "start": 111354297, "end": 111373305}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/c-ts-common.elc", "start": 111373305, "end": 111382225}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/c-ts-mode.el", "start": 111382225, "end": 111443832}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/c-ts-mode.elc", "start": 111443832, "end": 111493416}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-align.el", "start": 111493416, "end": 111549235}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-align.elc", "start": 111549235, "end": 111591042}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-awk.el", "start": 111591042, "end": 111647155}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-awk.elc", "start": 111647155, "end": 111667632}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-bytecomp.el", "start": 111667632, "end": 111684975}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-bytecomp.elc", "start": 111684975, "end": 111696264}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-cmds.el", "start": 111696264, "end": 111884206}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-cmds.elc", "start": 111884206, "end": 111991431}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-defs.el", "start": 111991431, "end": 112101972}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-defs.elc", "start": 112101972, "end": 112172871}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-engine.el", "start": 112172871, "end": 112776527}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-engine.elc", "start": 112776527, "end": 113052955}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-fonts.el", "start": 113052955, "end": 113188384}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-fonts.elc", "start": 113188384, "end": 113356119}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-guess.el", "start": 113356119, "end": 113376175}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-guess.elc", "start": 113376175, "end": 113389704}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-langs.el", "start": 113389704, "end": 113572410}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-langs.elc", "start": 113572410, "end": 113699458}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-menus.el", "start": 113699458, "end": 113717055}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-menus.elc", "start": 113717055, "end": 113724390}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-mode.el", "start": 113724390, "end": 113856878}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-mode.elc", "start": 113856878, "end": 114127200}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-styles.el", "start": 114127200, "end": 114152241}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-styles.elc", "start": 114152241, "end": 114169009}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-vars.el", "start": 114169009, "end": 114250067}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-vars.elc", "start": 114250067, "end": 114332239}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cfengine.el", "start": 114332239, "end": 114394568}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cfengine.elc", "start": 114394568, "end": 114442789}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cl-font-lock.el", "start": 114442789, "end": 114459722}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cl-font-lock.elc", "start": 114459722, "end": 114476441}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cmacexp.el", "start": 114476441, "end": 114490888}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cmacexp.elc", "start": 114490888, "end": 114496795}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cmake-ts-mode.el", "start": 114496795, "end": 114505777}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cmake-ts-mode.elc", "start": 114505777, "end": 114514007}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/compile.el", "start": 114514007, "end": 114659636}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/compile.elc", "start": 114659636, "end": 114764807}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cperl-mode.el", "start": 114764807, "end": 115142362}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cperl-mode.elc", "start": 115142362, "end": 115394707}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cpp.el", "start": 115394707, "end": 115423612}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cpp.elc", "start": 115423612, "end": 115447673}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/csharp-mode.el", "start": 115447673, "end": 115486644}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/csharp-mode.elc", "start": 115486644, "end": 115610808}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cwarn.el", "start": 115610808, "end": 115621709}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cwarn.elc", "start": 115621709, "end": 115633618}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/dcl-mode.el", "start": 115633618, "end": 115707856}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/dcl-mode.elc", "start": 115707856, "end": 115758185}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/dockerfile-ts-mode.el", "start": 115758185, "end": 115764031}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/dockerfile-ts-mode.elc", "start": 115764031, "end": 115769979}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-abn.el", "start": 115769979, "end": 115788219}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-abn.elc", "start": 115788219, "end": 115794654}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-bnf.el", "start": 115794654, "end": 115812678}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-bnf.elc", "start": 115812678, "end": 115819987}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-dtd.el", "start": 115819987, "end": 115861830}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-dtd.elc", "start": 115861830, "end": 115874735}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-ebx.el", "start": 115874735, "end": 115893280}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-ebx.elc", "start": 115893280, "end": 115900835}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-iso.el", "start": 115900835, "end": 115918102}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-iso.elc", "start": 115918102, "end": 115925387}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-otz.el", "start": 115925387, "end": 115944598}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-otz.elc", "start": 115944598, "end": 115952625}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-yac.el", "start": 115952625, "end": 115966175}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-yac.elc", "start": 115966175, "end": 115973169}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf2ps.el", "start": 115973169, "end": 116158381}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf2ps.elc", "start": 116158381, "end": 116281619}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebrowse.el", "start": 116281619, "end": 116433405}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebrowse.elc", "start": 116433405, "end": 116641418}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/eglot.el", "start": 116641418, "end": 116836513}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/eglot.elc", "start": 116836513, "end": 117007447}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/elisp-mode.el", "start": 117007447, "end": 117109130}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/elisp-mode.elc", "start": 117109130, "end": 117184730}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/elixir-ts-mode.el", "start": 117184730, "end": 117214600}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/elixir-ts-mode.elc", "start": 117214600, "end": 117237630}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/erts-mode.el", "start": 117237630, "end": 117245204}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/erts-mode.elc", "start": 117245204, "end": 117252294}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/etags-regen.el", "start": 117252294, "end": 117269385}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/etags-regen.elc", "start": 117269385, "end": 117283147}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/etags.el", "start": 117283147, "end": 117375011}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/etags.elc", "start": 117375011, "end": 117451294}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/executable.el", "start": 117451294, "end": 117462884}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/executable.elc", "start": 117462884, "end": 117470968}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/f90.el", "start": 117470968, "end": 117576545}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/f90.elc", "start": 117576545, "end": 117675825}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/flymake-cc.el", "start": 117675825, "end": 117682101}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/flymake-cc.elc", "start": 117682101, "end": 117685651}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/flymake-proc.el", "start": 117685651, "end": 117739839}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/flymake-proc.elc", "start": 117739839, "end": 117778088}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/flymake.el", "start": 117778088, "end": 117868074}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/flymake.elc", "start": 117868074, "end": 117965708}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/fortran.el", "start": 117965708, "end": 118060176}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/fortran.elc", "start": 118060176, "end": 118122275}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/gdb-mi.el", "start": 118122275, "end": 118332961}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/gdb-mi.elc", "start": 118332961, "end": 118548908}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/glasses.el", "start": 118548908, "end": 118561734}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/glasses.elc", "start": 118561734, "end": 118573307}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/go-ts-mode.el", "start": 118573307, "end": 118590890}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/go-ts-mode.elc", "start": 118590890, "end": 118608771}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/grep.el", "start": 118608771, "end": 118669062}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/grep.elc", "start": 118669062, "end": 118716389}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/gud.el", "start": 118716389, "end": 118877758}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/gud.elc", "start": 118877758, "end": 118990534}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/heex-ts-mode.el", "start": 118990534, "end": 118997593}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/heex-ts-mode.elc", "start": 118997593, "end": 119004112}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/hideif.el", "start": 119004112, "end": 119117130}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/hideif.elc", "start": 119117130, "end": 119182103}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/hideshow.el", "start": 119182103, "end": 119224422}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/hideshow.elc", "start": 119224422, "end": 119253454}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/icon.el", "start": 119253454, "end": 119276958}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/icon.elc", "start": 119276958, "end": 119293645}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlw-complete-structtag.el", "start": 119293645, "end": 119303869}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlw-complete-structtag.elc", "start": 119303869, "end": 119308001}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlw-help.el", "start": 119308001, "end": 119358320}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlw-help.elc", "start": 119358320, "end": 119394561}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlw-shell.el", "start": 119394561, "end": 119565754}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlw-shell.elc", "start": 119565754, "end": 119697541}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlw-toolbar.el", "start": 119697541, "end": 119726643}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlw-toolbar.elc", "start": 119726643, "end": 119754669}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlwave.el", "start": 119754669, "end": 120096493}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlwave.elc", "start": 120096493, "end": 120346254}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/inf-lisp.el", "start": 120346254, "end": 120374374}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/inf-lisp.elc", "start": 120374374, "end": 120395946}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/java-ts-mode.el", "start": 120395946, "end": 120412791}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/java-ts-mode.elc", "start": 120412791, "end": 120427255}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/js.el", "start": 120427255, "end": 120583950}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/js.elc", "start": 120583950, "end": 120755995}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/json-ts-mode.el", "start": 120755995, "end": 120761466}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/json-ts-mode.elc", "start": 120761466, "end": 120766878}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ld-script.el", "start": 120766878, "end": 120772587}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ld-script.elc", "start": 120772587, "end": 120777838}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/lua-ts-mode.el", "start": 120777838, "end": 120810982}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/lua-ts-mode.elc", "start": 120810982, "end": 120838509}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/m4-mode.el", "start": 120838509, "end": 120844826}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/m4-mode.elc", "start": 120844826, "end": 120852551}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/make-mode.el", "start": 120852551, "end": 120921159}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/make-mode.elc", "start": 120921159, "end": 120984506}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/meta-mode.el", "start": 120984506, "end": 121022077}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/meta-mode.elc", "start": 121022077, "end": 121053834}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/mixal-mode.el", "start": 121053834, "end": 121097111}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/mixal-mode.elc", "start": 121097111, "end": 121134565}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/modula2.el", "start": 121134565, "end": 121155929}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/modula2.elc", "start": 121155929, "end": 121186336}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/octave.el", "start": 121186336, "end": 121260581}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/octave.elc", "start": 121260581, "end": 121323860}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/opascal.el", "start": 121323860, "end": 121395260}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/opascal.elc", "start": 121395260, "end": 121446128}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/pascal.el", "start": 121446128, "end": 121500097}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/pascal.elc", "start": 121500097, "end": 121539700}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/peg.el", "start": 121539700, "end": 121574767}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/peg.elc", "start": 121574767, "end": 121600817}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/perl-mode.el", "start": 121600817, "end": 121655377}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/perl-mode.elc", "start": 121655377, "end": 121687141}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/php-ts-mode.el", "start": 121687141, "end": 121761011}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/php-ts-mode.elc", "start": 121761011, "end": 121821484}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/prog-mode.el", "start": 121821484, "end": 121835999}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/prog-mode.elc", "start": 121835999, "end": 121854489}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/project.el", "start": 121854489, "end": 121947598}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/project.elc", "start": 121947598, "end": 122016585}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/prolog.el", "start": 122016585, "end": 122148328}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/prolog.elc", "start": 122148328, "end": 122231792}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ps-mode.el", "start": 122231792, "end": 122267804}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ps-mode.elc", "start": 122267804, "end": 122301353}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/python.el", "start": 122301353, "end": 122608586}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/python.elc", "start": 122608586, "end": 122848473}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ruby-mode.el", "start": 122848473, "end": 122952223}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ruby-mode.elc", "start": 122952223, "end": 123023857}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ruby-ts-mode.el", "start": 123023857, "end": 123076131}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ruby-ts-mode.elc", "start": 123076131, "end": 123106500}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/rust-ts-mode.el", "start": 123106500, "end": 123130090}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/rust-ts-mode.elc", "start": 123130090, "end": 123150082}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/scheme.el", "start": 123150082, "end": 123180076}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/scheme.elc", "start": 123180076, "end": 123200882}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/sh-script.el", "start": 123200882, "end": 123323847}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/sh-script.elc", "start": 123323847, "end": 123431577}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/simula.el", "start": 123431577, "end": 123488777}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/simula.elc", "start": 123488777, "end": 123531415}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/sql.el", "start": 123531415, "end": 123761358}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/sql.elc", "start": 123761358, "end": 123949066}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/subword.el", "start": 123949066, "end": 123961549}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/subword.elc", "start": 123961549, "end": 123980414}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/tcl.el", "start": 123980414, "end": 124038182}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/tcl.elc", "start": 124038182, "end": 124079680}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/typescript-ts-mode.el", "start": 124079680, "end": 124105107}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/typescript-ts-mode.elc", "start": 124105107, "end": 124130527}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/vera-mode.el", "start": 124130527, "end": 124183775}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/vera-mode.elc", "start": 124183775, "end": 124227533}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/verilog-mode.el", "start": 124227533, "end": 124856968}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/verilog-mode.elc", "start": 124856968, "end": 125358377}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/vhdl-mode.el", "start": 125358377, "end": 126063860}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/vhdl-mode.elc", "start": 126063860, "end": 126596711}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/which-func.el", "start": 126596711, "end": 126612922}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/which-func.elc", "start": 126612922, "end": 126626225}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/xref.el", "start": 126626225, "end": 126714229}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/xref.elc", "start": 126714229, "end": 126811450}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/xscheme.el", "start": 126811450, "end": 126854501}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/xscheme.elc", "start": 126854501, "end": 126892784}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-bdf.el", "start": 126892784, "end": 126908858}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-bdf.elc", "start": 126908858, "end": 126921848}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-mule.el", "start": 126921848, "end": 126966079}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-mule.elc", "start": 126966079, "end": 127002119}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-print-loaddefs.el", "start": 127002119, "end": 127004829}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-print-loaddefs.elc", "start": 127004829, "end": 127007376}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-print.el", "start": 127007376, "end": 127235689}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-print.elc", "start": 127235689, "end": 127381632}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-samp.el", "start": 127381632, "end": 127391769}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-samp.elc", "start": 127391769, "end": 127396645}, {"filename": "/usr/local/share/emacs/30.2/lisp/recentf.el", "start": 127396645, "end": 127450007}, {"filename": "/usr/local/share/emacs/30.2/lisp/recentf.elc", "start": 127450007, "end": 127500234}, {"filename": "/usr/local/share/emacs/30.2/lisp/rect.el", "start": 127500234, "end": 127539548}, {"filename": "/usr/local/share/emacs/30.2/lisp/rect.elc", "start": 127539548, "end": 127568387}, {"filename": "/usr/local/share/emacs/30.2/lisp/register.el", "start": 127568387, "end": 127612821}, {"filename": "/usr/local/share/emacs/30.2/lisp/register.elc", "start": 127612821, "end": 127669365}, {"filename": "/usr/local/share/emacs/30.2/lisp/registry.el", "start": 127669365, "end": 127683583}, {"filename": "/usr/local/share/emacs/30.2/lisp/registry.elc", "start": 127683583, "end": 127693701}, {"filename": "/usr/local/share/emacs/30.2/lisp/repeat.el", "start": 127693701, "end": 127725088}, {"filename": "/usr/local/share/emacs/30.2/lisp/repeat.elc", "start": 127725088, "end": 127743779}, {"filename": "/usr/local/share/emacs/30.2/lisp/replace.el", "start": 127743779, "end": 127882906}, {"filename": "/usr/local/share/emacs/30.2/lisp/replace.elc", "start": 127882906, "end": 127981977}, {"filename": "/usr/local/share/emacs/30.2/lisp/reposition.el", "start": 127981977, "end": 127989744}, {"filename": "/usr/local/share/emacs/30.2/lisp/reposition.elc", "start": 127989744, "end": 127992217}, {"filename": "/usr/local/share/emacs/30.2/lisp/reveal.el", "start": 127992217, "end": 128002667}, {"filename": "/usr/local/share/emacs/30.2/lisp/reveal.elc", "start": 128002667, "end": 128011238}, {"filename": "/usr/local/share/emacs/30.2/lisp/rfn-eshadow.el", "start": 128011238, "end": 128020561}, {"filename": "/usr/local/share/emacs/30.2/lisp/rfn-eshadow.elc", "start": 128020561, "end": 128028505}, {"filename": "/usr/local/share/emacs/30.2/lisp/rot13.el", "start": 128028505, "end": 128033033}, {"filename": "/usr/local/share/emacs/30.2/lisp/rot13.elc", "start": 128033033, "end": 128035565}, {"filename": "/usr/local/share/emacs/30.2/lisp/rtree.el", "start": 128035565, "end": 128044029}, {"filename": "/usr/local/share/emacs/30.2/lisp/rtree.elc", "start": 128044029, "end": 128047757}, {"filename": "/usr/local/share/emacs/30.2/lisp/ruler-mode.el", "start": 128047757, "end": 128077079}, {"filename": "/usr/local/share/emacs/30.2/lisp/ruler-mode.elc", "start": 128077079, "end": 128100309}, {"filename": "/usr/local/share/emacs/30.2/lisp/savehist.el", "start": 128100309, "end": 128114442}, {"filename": "/usr/local/share/emacs/30.2/lisp/savehist.elc", "start": 128114442, "end": 128126412}, {"filename": "/usr/local/share/emacs/30.2/lisp/saveplace.el", "start": 128126412, "end": 128145196}, {"filename": "/usr/local/share/emacs/30.2/lisp/saveplace.elc", "start": 128145196, "end": 128161308}, {"filename": "/usr/local/share/emacs/30.2/lisp/scroll-all.el", "start": 128161308, "end": 128165544}, {"filename": "/usr/local/share/emacs/30.2/lisp/scroll-all.elc", "start": 128165544, "end": 128170462}, {"filename": "/usr/local/share/emacs/30.2/lisp/scroll-bar.el", "start": 128170462, "end": 128188686}, {"filename": "/usr/local/share/emacs/30.2/lisp/scroll-bar.elc", "start": 128188686, "end": 128206242}, {"filename": "/usr/local/share/emacs/30.2/lisp/scroll-lock.el", "start": 128206242, "end": 128211356}, {"filename": "/usr/local/share/emacs/30.2/lisp/scroll-lock.elc", "start": 128211356, "end": 128216869}, {"filename": "/usr/local/share/emacs/30.2/lisp/select.el", "start": 128216869, "end": 128256960}, {"filename": "/usr/local/share/emacs/30.2/lisp/select.elc", "start": 128256960, "end": 128288558}, {"filename": "/usr/local/share/emacs/30.2/lisp/server.el", "start": 128288558, "end": 128375453}, {"filename": "/usr/local/share/emacs/30.2/lisp/server.elc", "start": 128375453, "end": 128433624}, {"filename": "/usr/local/share/emacs/30.2/lisp/ses.el", "start": 128433624, "end": 128596570}, {"filename": "/usr/local/share/emacs/30.2/lisp/ses.elc", "start": 128596570, "end": 128729913}, {"filename": "/usr/local/share/emacs/30.2/lisp/shadowfile.el", "start": 128729913, "end": 128761949}, {"filename": "/usr/local/share/emacs/30.2/lisp/shadowfile.elc", "start": 128761949, "end": 128794742}, {"filename": "/usr/local/share/emacs/30.2/lisp/shell.el", "start": 128794742, "end": 128870981}, {"filename": "/usr/local/share/emacs/30.2/lisp/shell.elc", "start": 128870981, "end": 128933816}, {"filename": "/usr/local/share/emacs/30.2/lisp/simple.el", "start": 128933816, "end": 129414916}, {"filename": "/usr/local/share/emacs/30.2/lisp/simple.elc", "start": 129414916, "end": 129805268}, {"filename": "/usr/local/share/emacs/30.2/lisp/skeleton.el", "start": 129805268, "end": 129829319}, {"filename": "/usr/local/share/emacs/30.2/lisp/skeleton.elc", "start": 129829319, "end": 129845398}, {"filename": "/usr/local/share/emacs/30.2/lisp/so-long.el", "start": 129845398, "end": 129941924}, {"filename": "/usr/local/share/emacs/30.2/lisp/so-long.elc", "start": 129941924, "end": 129995916}, {"filename": "/usr/local/share/emacs/30.2/lisp/sort.el", "start": 129995916, "end": 130020894}, {"filename": "/usr/local/share/emacs/30.2/lisp/sort.elc", "start": 130020894, "end": 130036575}, {"filename": "/usr/local/share/emacs/30.2/lisp/soundex.el", "start": 130036575, "end": 130039031}, {"filename": "/usr/local/share/emacs/30.2/lisp/soundex.elc", "start": 130039031, "end": 130039852}, {"filename": "/usr/local/share/emacs/30.2/lisp/speedbar.el", "start": 130039852, "end": 130191326}, {"filename": "/usr/local/share/emacs/30.2/lisp/speedbar.elc", "start": 130191326, "end": 130310561}, {"filename": "/usr/local/share/emacs/30.2/lisp/sqlite-mode.el", "start": 130310561, "end": 130318711}, {"filename": "/usr/local/share/emacs/30.2/lisp/sqlite-mode.elc", "start": 130318711, "end": 130326007}, {"filename": "/usr/local/share/emacs/30.2/lisp/sqlite.el", "start": 130326007, "end": 130327972}, {"filename": "/usr/local/share/emacs/30.2/lisp/sqlite.elc", "start": 130327972, "end": 130328850}, {"filename": "/usr/local/share/emacs/30.2/lisp/startup.el", "start": 130328850, "end": 130455769}, {"filename": "/usr/local/share/emacs/30.2/lisp/startup.elc", "start": 130455769, "end": 130531403}, {"filename": "/usr/local/share/emacs/30.2/lisp/strokes.el", "start": 130531403, "end": 130599192}, {"filename": "/usr/local/share/emacs/30.2/lisp/strokes.elc", "start": 130599192, "end": 130645335}, {"filename": "/usr/local/share/emacs/30.2/lisp/subdirs.el", "start": 130645335, "end": 130645827}, {"filename": "/usr/local/share/emacs/30.2/lisp/subr.el", "start": 130645827, "end": 130959616}, {"filename": "/usr/local/share/emacs/30.2/lisp/subr.elc", "start": 130959616, "end": 131212413}, {"filename": "/usr/local/share/emacs/30.2/lisp/svg.el", "start": 131212413, "end": 131228431}, {"filename": "/usr/local/share/emacs/30.2/lisp/svg.elc", "start": 131228431, "end": 131240937}, {"filename": "/usr/local/share/emacs/30.2/lisp/t-mouse.el", "start": 131240937, "end": 131244429}, {"filename": "/usr/local/share/emacs/30.2/lisp/t-mouse.elc", "start": 131244429, "end": 131248605}, {"filename": "/usr/local/share/emacs/30.2/lisp/tab-bar.el", "start": 131248605, "end": 131372988}, {"filename": "/usr/local/share/emacs/30.2/lisp/tab-bar.elc", "start": 131372988, "end": 131475912}, {"filename": "/usr/local/share/emacs/30.2/lisp/tab-line.el", "start": 131475912, "end": 131528365}, {"filename": "/usr/local/share/emacs/30.2/lisp/tab-line.elc", "start": 131528365, "end": 131577082}, {"filename": "/usr/local/share/emacs/30.2/lisp/tabify.el", "start": 131577082, "end": 131581326}, {"filename": "/usr/local/share/emacs/30.2/lisp/tabify.elc", "start": 131581326, "end": 131583206}, {"filename": "/usr/local/share/emacs/30.2/lisp/talk.el", "start": 131583206, "end": 131587539}, {"filename": "/usr/local/share/emacs/30.2/lisp/talk.elc", "start": 131587539, "end": 131590192}, {"filename": "/usr/local/share/emacs/30.2/lisp/tar-mode.el", "start": 131590192, "end": 131654946}, {"filename": "/usr/local/share/emacs/30.2/lisp/tar-mode.elc", "start": 131654946, "end": 131719301}, {"filename": "/usr/local/share/emacs/30.2/lisp/tempo.el", "start": 131719301, "end": 131746258}, {"filename": "/usr/local/share/emacs/30.2/lisp/tempo.elc", "start": 131746258, "end": 131766277}, {"filename": "/usr/local/share/emacs/30.2/lisp/term.el", "start": 131766277, "end": 131958322}, {"filename": "/usr/local/share/emacs/30.2/lisp/term.elc", "start": 131958322, "end": 132076759}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/AT386.el", "start": 132076759, "end": 132079012}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/AT386.elc", "start": 132079012, "end": 132079692}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/README", "start": 132079692, "end": 132090900}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/android-win.el", "start": 132090900, "end": 132116139}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/android-win.elc", "start": 132116139, "end": 132130712}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/bobcat.el", "start": 132130712, "end": 132131013}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/bobcat.elc", "start": 132131013, "end": 132131282}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/common-win.el", "start": 132131282, "end": 132151463}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/common-win.elc", "start": 132151463, "end": 132166156}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/cygwin.el", "start": 132166156, "end": 132166443}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/cygwin.elc", "start": 132166443, "end": 132166676}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/fbterm.el", "start": 132166676, "end": 132167565}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/fbterm.elc", "start": 132167565, "end": 132167882}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/haiku-win.el", "start": 132167882, "end": 132197562}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/haiku-win.elc", "start": 132197562, "end": 132217313}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/internal.el", "start": 132217313, "end": 132242447}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/internal.elc", "start": 132242447, "end": 132260745}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/iris-ansi.el", "start": 132260745, "end": 132269715}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/iris-ansi.elc", "start": 132269715, "end": 132277019}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/konsole.el", "start": 132277019, "end": 132277378}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/konsole.elc", "start": 132277378, "end": 132277684}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/linux.el", "start": 132277684, "end": 132278609}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/linux.elc", "start": 132278609, "end": 132279126}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/lk201.el", "start": 132279126, "end": 132282131}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/lk201.elc", "start": 132282131, "end": 132284164}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/news.el", "start": 132284164, "end": 132286892}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/news.elc", "start": 132286892, "end": 132287800}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/ns-win.el", "start": 132287800, "end": 132322873}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/ns-win.elc", "start": 132322873, "end": 132345691}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/pc-win.el", "start": 132345691, "end": 132362497}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/pc-win.elc", "start": 132362497, "end": 132370946}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/pgtk-win.el", "start": 132370946, "end": 132384776}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/pgtk-win.elc", "start": 132384776, "end": 132395441}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/rxvt.el", "start": 132395441, "end": 132403538}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/rxvt.elc", "start": 132403538, "end": 132408666}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/screen.el", "start": 132408666, "end": 132409704}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/screen.elc", "start": 132409704, "end": 132410545}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/st.el", "start": 132410545, "end": 132411274}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/st.elc", "start": 132411274, "end": 132411954}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/sun.el", "start": 132411954, "end": 132416662}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/sun.elc", "start": 132416662, "end": 132419668}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/tmux.el", "start": 132419668, "end": 132420667}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/tmux.elc", "start": 132420667, "end": 132421492}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/tty-colors.el", "start": 132421492, "end": 132459933}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/tty-colors.elc", "start": 132459933, "end": 132488970}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/tvi970.el", "start": 132488970, "end": 132493472}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/tvi970.elc", "start": 132493472, "end": 132497111}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/vt100.el", "start": 132497111, "end": 132499000}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/vt100.elc", "start": 132499000, "end": 132501911}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/vt200.el", "start": 132501911, "end": 132502407}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/vt200.elc", "start": 132502407, "end": 132502797}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/w32-win.el", "start": 132502797, "end": 132528443}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/w32-win.elc", "start": 132528443, "end": 132541342}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/w32console.el", "start": 132541342, "end": 132545236}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/w32console.elc", "start": 132545236, "end": 132546838}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/wyse50.el", "start": 132546838, "end": 132552883}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/wyse50.elc", "start": 132552883, "end": 132554709}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/x-win.el", "start": 132554709, "end": 132598797}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/x-win.elc", "start": 132598797, "end": 132630281}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/xterm.el", "start": 132630281, "end": 132676335}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/xterm.elc", "start": 132676335, "end": 132708649}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/artist.el", "start": 132708649, "end": 132903806}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/artist.elc", "start": 132903806, "end": 133065417}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/bib-mode.el", "start": 133065417, "end": 133072740}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/bib-mode.elc", "start": 133072740, "end": 133080762}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/bibtex-style.el", "start": 133080762, "end": 133086098}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/bibtex-style.elc", "start": 133086098, "end": 133091135}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/bibtex.el", "start": 133091135, "end": 133353596}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/bibtex.elc", "start": 133353596, "end": 133547688}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/conf-mode.el", "start": 133547688, "end": 133573795}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/conf-mode.elc", "start": 133573795, "end": 133614489}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/css-mode.el", "start": 133614489, "end": 133695290}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/css-mode.elc", "start": 133695290, "end": 133767471}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/dns-mode.el", "start": 133767471, "end": 133780429}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/dns-mode.elc", "start": 133780429, "end": 133791917}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/emacs-authors-mode.el", "start": 133791917, "end": 133798058}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/emacs-authors-mode.elc", "start": 133798058, "end": 133805263}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/emacs-news-mode.el", "start": 133805263, "end": 133817212}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/emacs-news-mode.elc", "start": 133817212, "end": 133830634}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/enriched.el", "start": 133830634, "end": 133852023}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/enriched.elc", "start": 133852023, "end": 133868807}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/fill.el", "start": 133868807, "end": 133932520}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/fill.elc", "start": 133932520, "end": 133969816}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/flyspell.el", "start": 133969816, "end": 134073214}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/flyspell.elc", "start": 134073214, "end": 134130319}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/glyphless-mode.el", "start": 134130319, "end": 134132936}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/glyphless-mode.elc", "start": 134132936, "end": 134136475}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/html-ts-mode.el", "start": 134136475, "end": 134141170}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/html-ts-mode.elc", "start": 134141170, "end": 134146460}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/ispell.el", "start": 134146460, "end": 134331287}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/ispell.elc", "start": 134331287, "end": 134451510}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/less-css-mode.el", "start": 134451510, "end": 134460142}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/less-css-mode.elc", "start": 134460142, "end": 134467712}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/makeinfo.el", "start": 134467712, "end": 134478282}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/makeinfo.elc", "start": 134478282, "end": 134484038}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/mhtml-mode.el", "start": 134484038, "end": 134498086}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/mhtml-mode.elc", "start": 134498086, "end": 134521429}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/nroff-mode.el", "start": 134521429, "end": 134532509}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/nroff-mode.elc", "start": 134532509, "end": 134543889}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/page-ext.el", "start": 134543889, "end": 134573238}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/page-ext.elc", "start": 134573238, "end": 134592461}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/page.el", "start": 134592461, "end": 134599086}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/page.elc", "start": 134599086, "end": 134602568}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/paragraphs.el", "start": 134602568, "end": 134626047}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/paragraphs.elc", "start": 134626047, "end": 134645861}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/picture.el", "start": 134645861, "end": 134678235}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/picture.elc", "start": 134678235, "end": 134705808}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/pixel-fill.el", "start": 134705808, "end": 134715087}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/pixel-fill.elc", "start": 134715087, "end": 134721873}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/po.el", "start": 134721873, "end": 134726954}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/po.elc", "start": 134726954, "end": 134729308}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/refbib.el", "start": 134729308, "end": 134754232}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/refbib.elc", "start": 134754232, "end": 134772389}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/refer.el", "start": 134772389, "end": 134789123}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/refer.elc", "start": 134789123, "end": 134798022}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/refill.el", "start": 134798022, "end": 134808360}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/refill.elc", "start": 134808360, "end": 134814825}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-auc.el", "start": 134814825, "end": 134824433}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-auc.elc", "start": 134824433, "end": 134830428}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-cite.el", "start": 134830428, "end": 134885655}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-cite.elc", "start": 134885655, "end": 134918275}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-dcr.el", "start": 134918275, "end": 134937775}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-dcr.elc", "start": 134937775, "end": 134949157}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-global.el", "start": 134949157, "end": 134970486}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-global.elc", "start": 134970486, "end": 134983002}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-index.el", "start": 134983002, "end": 135072441}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-index.elc", "start": 135072441, "end": 135137156}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-loaddefs.el", "start": 135137156, "end": 135160726}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-loaddefs.elc", "start": 135160726, "end": 135184582}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-parse.el", "start": 135184582, "end": 135231482}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-parse.elc", "start": 135231482, "end": 135257247}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-ref.el", "start": 135257247, "end": 135293637}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-ref.elc", "start": 135293637, "end": 135312563}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-sel.el", "start": 135312563, "end": 135339913}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-sel.elc", "start": 135339913, "end": 135361139}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-toc.el", "start": 135361139, "end": 135405532}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-toc.elc", "start": 135405532, "end": 135438592}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-vars.el", "start": 135438592, "end": 135531000}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-vars.elc", "start": 135531000, "end": 135619767}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex.el", "start": 135619767, "end": 135712677}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex.elc", "start": 135712677, "end": 135767843}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/remember.el", "start": 135767843, "end": 135793790}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/remember.elc", "start": 135793790, "end": 135814701}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/rst.el", "start": 135814701, "end": 135978865}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/rst.elc", "start": 135978865, "end": 136116474}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/sgml-mode.el", "start": 136116474, "end": 136217641}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/sgml-mode.elc", "start": 136217641, "end": 136330988}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/string-edit.el", "start": 136330988, "end": 136335909}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/string-edit.elc", "start": 136335909, "end": 136341679}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/table.el", "start": 136341679, "end": 136572592}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/table.elc", "start": 136572592, "end": 136734816}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/tex-mode.el", "start": 136734816, "end": 136873599}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/tex-mode.elc", "start": 136873599, "end": 136991852}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/texinfmt.el", "start": 136991852, "end": 137152629}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/texinfmt.elc", "start": 137152629, "end": 137235960}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/texinfo-loaddefs.el", "start": 137235960, "end": 137246598}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/texinfo-loaddefs.elc", "start": 137246598, "end": 137257136}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/texinfo.el", "start": 137257136, "end": 137297830}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/texinfo.elc", "start": 137297830, "end": 137349934}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/texnfo-upd.el", "start": 137349934, "end": 137428567}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/texnfo-upd.elc", "start": 137428567, "end": 137475875}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/text-mode.el", "start": 137475875, "end": 137486906}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/text-mode.elc", "start": 137486906, "end": 137500054}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/tildify.el", "start": 137500054, "end": 137520900}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/tildify.elc", "start": 137520900, "end": 137538808}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/toml-ts-mode.el", "start": 137538808, "end": 137543993}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/toml-ts-mode.elc", "start": 137543993, "end": 137549238}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/two-column.el", "start": 137549238, "end": 137571599}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/two-column.elc", "start": 137571599, "end": 137584235}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/underline.el", "start": 137584235, "end": 137586383}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/underline.elc", "start": 137586383, "end": 137587254}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/word-wrap-mode.el", "start": 137587254, "end": 137589964}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/word-wrap-mode.elc", "start": 137589964, "end": 137597248}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/yaml-ts-mode.el", "start": 137597248, "end": 137602776}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/yaml-ts-mode.elc", "start": 137602776, "end": 137608103}, {"filename": "/usr/local/share/emacs/30.2/lisp/theme-loaddefs.el", "start": 137608103, "end": 137613699}, {"filename": "/usr/local/share/emacs/30.2/lisp/thingatpt.el", "start": 137613699, "end": 137647321}, {"filename": "/usr/local/share/emacs/30.2/lisp/thingatpt.elc", "start": 137647321, "end": 137671523}, {"filename": "/usr/local/share/emacs/30.2/lisp/thread.el", "start": 137671523, "end": 137679023}, {"filename": "/usr/local/share/emacs/30.2/lisp/thread.elc", "start": 137679023, "end": 137686750}, {"filename": "/usr/local/share/emacs/30.2/lisp/time-stamp.el", "start": 137686750, "end": 137725753}, {"filename": "/usr/local/share/emacs/30.2/lisp/time-stamp.elc", "start": 137725753, "end": 137748427}, {"filename": "/usr/local/share/emacs/30.2/lisp/time.el", "start": 137748427, "end": 137772575}, {"filename": "/usr/local/share/emacs/30.2/lisp/time.elc", "start": 137772575, "end": 137798170}, {"filename": "/usr/local/share/emacs/30.2/lisp/timezone.el", "start": 137798170, "end": 137814156}, {"filename": "/usr/local/share/emacs/30.2/lisp/timezone.elc", "start": 137814156, "end": 137824678}, {"filename": "/usr/local/share/emacs/30.2/lisp/tmm.el", "start": 137824678, "end": 137845311}, {"filename": "/usr/local/share/emacs/30.2/lisp/tmm.elc", "start": 137845311, "end": 137857502}, {"filename": "/usr/local/share/emacs/30.2/lisp/tool-bar.el", "start": 137857502, "end": 137884014}, {"filename": "/usr/local/share/emacs/30.2/lisp/tool-bar.elc", "start": 137884014, "end": 137905681}, {"filename": "/usr/local/share/emacs/30.2/lisp/tooltip.el", "start": 137905681, "end": 137920795}, {"filename": "/usr/local/share/emacs/30.2/lisp/tooltip.elc", "start": 137920795, "end": 137935233}, {"filename": "/usr/local/share/emacs/30.2/lisp/touch-screen.el", "start": 137935233, "end": 138036350}, {"filename": "/usr/local/share/emacs/30.2/lisp/touch-screen.elc", "start": 138036350, "end": 138075726}, {"filename": "/usr/local/share/emacs/30.2/lisp/transient.el", "start": 138075726, "end": 138258777}, {"filename": "/usr/local/share/emacs/30.2/lisp/transient.elc", "start": 138258777, "end": 138444108}, {"filename": "/usr/local/share/emacs/30.2/lisp/tree-widget.el", "start": 138444108, "end": 138474113}, {"filename": "/usr/local/share/emacs/30.2/lisp/tree-widget.elc", "start": 138474113, "end": 138494770}, {"filename": "/usr/local/share/emacs/30.2/lisp/treesit.el", "start": 138494770, "end": 138668444}, {"filename": "/usr/local/share/emacs/30.2/lisp/treesit.elc", "start": 138668444, "end": 138791379}, {"filename": "/usr/local/share/emacs/30.2/lisp/tutorial.el", "start": 138791379, "end": 138830116}, {"filename": "/usr/local/share/emacs/30.2/lisp/tutorial.elc", "start": 138830116, "end": 138852593}, {"filename": "/usr/local/share/emacs/30.2/lisp/type-break.el", "start": 138852593, "end": 138899365}, {"filename": "/usr/local/share/emacs/30.2/lisp/type-break.elc", "start": 138899365, "end": 138939100}, {"filename": "/usr/local/share/emacs/30.2/lisp/uniquify.el", "start": 138939100, "end": 138961852}, {"filename": "/usr/local/share/emacs/30.2/lisp/uniquify.elc", "start": 138961852, "end": 138981117}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/ChangeLog.1", "start": 138981117, "end": 139088098}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-auth.el", "start": 139088098, "end": 139111442}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-auth.elc", "start": 139111442, "end": 139132526}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-cache.el", "start": 139132526, "end": 139140865}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-cache.elc", "start": 139140865, "end": 139147559}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-cid.el", "start": 139147559, "end": 139149431}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-cid.elc", "start": 139149431, "end": 139150308}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-cookie.el", "start": 139150308, "end": 139169145}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-cookie.elc", "start": 139169145, "end": 139193683}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-dav.el", "start": 139193683, "end": 139223726}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-dav.elc", "start": 139223726, "end": 139243260}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-domsuf.el", "start": 139243260, "end": 139246711}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-domsuf.elc", "start": 139246711, "end": 139248608}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-expand.el", "start": 139248608, "end": 139254945}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-expand.elc", "start": 139254945, "end": 139258763}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-file.el", "start": 139258763, "end": 139266934}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-file.elc", "start": 139266934, "end": 139274175}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-ftp.el", "start": 139274175, "end": 139275607}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-ftp.elc", "start": 139275607, "end": 139276058}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-future.el", "start": 139276058, "end": 139279811}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-future.elc", "start": 139279811, "end": 139289154}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-gw.el", "start": 139289154, "end": 139299260}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-gw.elc", "start": 139299260, "end": 139306988}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-handlers.el", "start": 139306988, "end": 139324993}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-handlers.elc", "start": 139324993, "end": 139346873}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-history.el", "start": 139346873, "end": 139353777}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-history.elc", "start": 139353777, "end": 139358954}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-http.el", "start": 139358954, "end": 139430144}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-http.elc", "start": 139430144, "end": 139468294}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-imap.el", "start": 139468294, "end": 139471112}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-imap.elc", "start": 139471112, "end": 139472779}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-irc.el", "start": 139472779, "end": 139476577}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-irc.elc", "start": 139476577, "end": 139479371}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-ldap.el", "start": 139479371, "end": 139487341}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-ldap.elc", "start": 139487341, "end": 139493482}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-mailto.el", "start": 139493482, "end": 139497918}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-mailto.elc", "start": 139497918, "end": 139500426}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-methods.el", "start": 139500426, "end": 139505989}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-methods.elc", "start": 139505989, "end": 139509646}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-misc.el", "start": 139509646, "end": 139513569}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-misc.elc", "start": 139513569, "end": 139516810}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-news.el", "start": 139516810, "end": 139520900}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-news.elc", "start": 139520900, "end": 139523793}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-nfs.el", "start": 139523793, "end": 139526855}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-nfs.elc", "start": 139526855, "end": 139530911}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-parse.el", "start": 139530911, "end": 139539640}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-parse.elc", "start": 139539640, "end": 139557288}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-privacy.el", "start": 139557288, "end": 139559570}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-privacy.elc", "start": 139559570, "end": 139560807}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-proxy.el", "start": 139560807, "end": 139563407}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-proxy.elc", "start": 139563407, "end": 139564899}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-queue.el", "start": 139564899, "end": 139572317}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-queue.elc", "start": 139572317, "end": 139587984}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-tramp.el", "start": 139587984, "end": 139591427}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-tramp.elc", "start": 139591427, "end": 139594327}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-util.el", "start": 139594327, "end": 139615496}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-util.elc", "start": 139615496, "end": 139632046}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-vars.el", "start": 139632046, "end": 139647780}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-vars.elc", "start": 139647780, "end": 139664456}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url.el", "start": 139664456, "end": 139677654}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url.elc", "start": 139677654, "end": 139686650}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-bind-key.el", "start": 139686650, "end": 139693165}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-bind-key.elc", "start": 139693165, "end": 139697529}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-core.el", "start": 139697529, "end": 139770006}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-core.elc", "start": 139770006, "end": 139833551}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-delight.el", "start": 139833551, "end": 139836730}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-delight.elc", "start": 139836730, "end": 139838249}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-diminish.el", "start": 139838249, "end": 139840950}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-diminish.elc", "start": 139840950, "end": 139842367}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-ensure-system-package.el", "start": 139842367, "end": 139846267}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-ensure-system-package.elc", "start": 139846267, "end": 139848620}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-ensure.el", "start": 139848620, "end": 139856862}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-ensure.elc", "start": 139856862, "end": 139862069}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-jump.el", "start": 139862069, "end": 139865024}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-jump.elc", "start": 139865024, "end": 139866454}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-lint.el", "start": 139866454, "end": 139869327}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-lint.elc", "start": 139869327, "end": 139870516}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package.el", "start": 139870516, "end": 139872611}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package.elc", "start": 139872611, "end": 139873005}, {"filename": "/usr/local/share/emacs/30.2/lisp/userlock.el", "start": 139873005, "end": 139881941}, {"filename": "/usr/local/share/emacs/30.2/lisp/userlock.elc", "start": 139881941, "end": 139888413}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/add-log.el", "start": 139888413, "end": 139943045}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/add-log.elc", "start": 139943045, "end": 139982533}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/compare-w.el", "start": 139982533, "end": 140000010}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/compare-w.elc", "start": 140000010, "end": 140011624}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/cvs-status.el", "start": 140011624, "end": 140029169}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/cvs-status.elc", "start": 140029169, "end": 140049945}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/diff-mode.el", "start": 140049945, "end": 140185788}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/diff-mode.elc", "start": 140185788, "end": 140275386}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/diff.el", "start": 140275386, "end": 140286724}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/diff.elc", "start": 140286724, "end": 140295538}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-diff.el", "start": 140295538, "end": 140348954}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-diff.elc", "start": 140348954, "end": 140384775}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-help.el", "start": 140384775, "end": 140398035}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-help.elc", "start": 140398035, "end": 140409803}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-hook.el", "start": 140409803, "end": 140419113}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-hook.elc", "start": 140419113, "end": 140425362}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-init.el", "start": 140425362, "end": 140486080}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-init.elc", "start": 140486080, "end": 140552081}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-merg.el", "start": 140552081, "end": 140566292}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-merg.elc", "start": 140566292, "end": 140575878}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-mult.el", "start": 140575878, "end": 140667979}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-mult.elc", "start": 140667979, "end": 140732215}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-ptch.el", "start": 140732215, "end": 140764675}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-ptch.elc", "start": 140764675, "end": 140785231}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-util.el", "start": 140785231, "end": 140937024}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-util.elc", "start": 140937024, "end": 141055446}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-vers.el", "start": 141055446, "end": 141062945}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-vers.elc", "start": 141062945, "end": 141067739}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-wind.el", "start": 141067739, "end": 141114766}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-wind.elc", "start": 141114766, "end": 141144297}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff.el", "start": 141144297, "end": 141205416}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff.elc", "start": 141205416, "end": 141246388}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/emerge.el", "start": 141246388, "end": 141364999}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/emerge.elc", "start": 141364999, "end": 141445308}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/log-edit.el", "start": 141445308, "end": 141503953}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/log-edit.elc", "start": 141503953, "end": 141545930}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/log-view.el", "start": 141545930, "end": 141569298}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/log-view.elc", "start": 141569298, "end": 141587980}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs-defs.el", "start": 141587980, "end": 141600554}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs-defs.elc", "start": 141600554, "end": 141612134}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs-info.el", "start": 141612134, "end": 141629067}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs-info.elc", "start": 141629067, "end": 141651477}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs-parse.el", "start": 141651477, "end": 141672690}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs-parse.elc", "start": 141672690, "end": 141687005}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs-util.el", "start": 141687005, "end": 141699083}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs-util.elc", "start": 141699083, "end": 141720916}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs.el", "start": 141720916, "end": 141820418}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs.elc", "start": 141820418, "end": 141910668}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/smerge-mode.el", "start": 141910668, "end": 141969727}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/smerge-mode.elc", "start": 141969727, "end": 142010816}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-annotate.el", "start": 142010816, "end": 142042992}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-annotate.elc", "start": 142042992, "end": 142069547}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-bzr.el", "start": 142069547, "end": 142126461}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-bzr.elc", "start": 142126461, "end": 142169410}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-cvs.el", "start": 142169410, "end": 142223408}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-cvs.elc", "start": 142223408, "end": 142265120}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-dav.el", "start": 142265120, "end": 142270431}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-dav.elc", "start": 142270431, "end": 142273495}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-dir.el", "start": 142273495, "end": 142335197}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-dir.elc", "start": 142335197, "end": 142385059}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-dispatcher.el", "start": 142385059, "end": 142422297}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-dispatcher.elc", "start": 142422297, "end": 142442225}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-filewise.el", "start": 142442225, "end": 142445507}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-filewise.elc", "start": 142445507, "end": 142447042}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-git.el", "start": 142447042, "end": 142543552}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-git.elc", "start": 142543552, "end": 142636252}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-hg.el", "start": 142636252, "end": 142699578}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-hg.elc", "start": 142699578, "end": 142762281}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-hooks.el", "start": 142762281, "end": 142804748}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-hooks.elc", "start": 142804748, "end": 142836650}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-rcs.el", "start": 142836650, "end": 142898486}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-rcs.elc", "start": 142898486, "end": 142936706}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-sccs.el", "start": 142936706, "end": 142955909}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-sccs.elc", "start": 142955909, "end": 142973161}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-src.el", "start": 142973161, "end": 142985205}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-src.elc", "start": 142985205, "end": 142992983}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-svn.el", "start": 142992983, "end": 143024664}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-svn.elc", "start": 143024664, "end": 143048778}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc.el", "start": 143048778, "end": 143212193}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc.elc", "start": 143212193, "end": 143309911}, {"filename": "/usr/local/share/emacs/30.2/lisp/vcursor.el", "start": 143309911, "end": 143353829}, {"filename": "/usr/local/share/emacs/30.2/lisp/vcursor.elc", "start": 143353829, "end": 143378285}, {"filename": "/usr/local/share/emacs/30.2/lisp/version.el", "start": 143378285, "end": 143387848}, {"filename": "/usr/local/share/emacs/30.2/lisp/version.elc", "start": 143387848, "end": 143396540}, {"filename": "/usr/local/share/emacs/30.2/lisp/view.el", "start": 143396540, "end": 143434437}, {"filename": "/usr/local/share/emacs/30.2/lisp/view.elc", "start": 143434437, "end": 143468377}, {"filename": "/usr/local/share/emacs/30.2/lisp/visual-wrap.el", "start": 143468377, "end": 143476547}, {"filename": "/usr/local/share/emacs/30.2/lisp/visual-wrap.elc", "start": 143476547, "end": 143486229}, {"filename": "/usr/local/share/emacs/30.2/lisp/w32-fns.el", "start": 143486229, "end": 143502064}, {"filename": "/usr/local/share/emacs/30.2/lisp/w32-fns.elc", "start": 143502064, "end": 143512509}, {"filename": "/usr/local/share/emacs/30.2/lisp/w32-vars.el", "start": 143512509, "end": 143518926}, {"filename": "/usr/local/share/emacs/30.2/lisp/w32-vars.elc", "start": 143518926, "end": 143524073}, {"filename": "/usr/local/share/emacs/30.2/lisp/wasmacs-url-fetch.el", "start": 143524073, "end": 143531945}, {"filename": "/usr/local/share/emacs/30.2/lisp/wasmacs-url-fetch.elc", "start": 143531945, "end": 143537967}, {"filename": "/usr/local/share/emacs/30.2/lisp/wdired.el", "start": 143537967, "end": 143582172}, {"filename": "/usr/local/share/emacs/30.2/lisp/wdired.elc", "start": 143582172, "end": 143611036}, {"filename": "/usr/local/share/emacs/30.2/lisp/which-key.el", "start": 143611036, "end": 143731146}, {"filename": "/usr/local/share/emacs/30.2/lisp/which-key.elc", "start": 143731146, "end": 143847375}, {"filename": "/usr/local/share/emacs/30.2/lisp/whitespace.el", "start": 143847375, "end": 143947243}, {"filename": "/usr/local/share/emacs/30.2/lisp/whitespace.elc", "start": 143947243, "end": 144030303}, {"filename": "/usr/local/share/emacs/30.2/lisp/wid-browse.el", "start": 144030303, "end": 144037751}, {"filename": "/usr/local/share/emacs/30.2/lisp/wid-browse.elc", "start": 144037751, "end": 144047520}, {"filename": "/usr/local/share/emacs/30.2/lisp/wid-edit.el", "start": 144047520, "end": 144201664}, {"filename": "/usr/local/share/emacs/30.2/lisp/wid-edit.elc", "start": 144201664, "end": 144317541}, {"filename": "/usr/local/share/emacs/30.2/lisp/widget.el", "start": 144317541, "end": 144321477}, {"filename": "/usr/local/share/emacs/30.2/lisp/widget.elc", "start": 144321477, "end": 144322738}, {"filename": "/usr/local/share/emacs/30.2/lisp/windmove.el", "start": 144322738, "end": 144359650}, {"filename": "/usr/local/share/emacs/30.2/lisp/windmove.elc", "start": 144359650, "end": 144387603}, {"filename": "/usr/local/share/emacs/30.2/lisp/window-tool-bar.el", "start": 144387603, "end": 144409005}, {"filename": "/usr/local/share/emacs/30.2/lisp/window-tool-bar.elc", "start": 144409005, "end": 144427066}, {"filename": "/usr/local/share/emacs/30.2/lisp/window.el", "start": 144427066, "end": 144894868}, {"filename": "/usr/local/share/emacs/30.2/lisp/window.elc", "start": 144894868, "end": 145230373}, {"filename": "/usr/local/share/emacs/30.2/lisp/winner.el", "start": 145230373, "end": 145244964}, {"filename": "/usr/local/share/emacs/30.2/lisp/winner.elc", "start": 145244964, "end": 145257772}, {"filename": "/usr/local/share/emacs/30.2/lisp/woman.el", "start": 145257772, "end": 145433562}, {"filename": "/usr/local/share/emacs/30.2/lisp/woman.elc", "start": 145433562, "end": 145546558}, {"filename": "/usr/local/share/emacs/30.2/lisp/x-dnd.el", "start": 145546558, "end": 145621665}, {"filename": "/usr/local/share/emacs/30.2/lisp/x-dnd.elc", "start": 145621665, "end": 145668009}, {"filename": "/usr/local/share/emacs/30.2/lisp/xdg.el", "start": 145668009, "end": 145683740}, {"filename": "/usr/local/share/emacs/30.2/lisp/xdg.elc", "start": 145683740, "end": 145696596}, {"filename": "/usr/local/share/emacs/30.2/lisp/xml.el", "start": 145696596, "end": 145737220}, {"filename": "/usr/local/share/emacs/30.2/lisp/xml.elc", "start": 145737220, "end": 145762846}, {"filename": "/usr/local/share/emacs/30.2/lisp/xt-mouse.el", "start": 145762846, "end": 145785320}, {"filename": "/usr/local/share/emacs/30.2/lisp/xt-mouse.elc", "start": 145785320, "end": 145800579}, {"filename": "/usr/local/share/emacs/30.2/lisp/xwidget.el", "start": 145800579, "end": 145855437}, {"filename": "/usr/local/share/emacs/30.2/lisp/xwidget.elc", "start": 145855437, "end": 145904961}, {"filename": "/usr/local/share/emacs/30.2/lisp/yank-media.el", "start": 145904961, "end": 145912562}, {"filename": "/usr/local/share/emacs/30.2/lisp/yank-media.elc", "start": 145912562, "end": 145917153}], "remote_package_size": 145917153});

  })();

// end include: /var/folders/l2/fl54zpqn0h52frtq4vglk4c80000gn/T/tmpw7mehhru.js
// include: /var/folders/l2/fl54zpqn0h52frtq4vglk4c80000gn/T/tmpblww7bgm.js

    // All the pre-js content up to here must remain later on, we need to run
    // it.
    if ((typeof ENVIRONMENT_IS_WASM_WORKER != 'undefined' && ENVIRONMENT_IS_WASM_WORKER) || (typeof ENVIRONMENT_IS_PTHREAD != 'undefined' && ENVIRONMENT_IS_PTHREAD) || (typeof ENVIRONMENT_IS_AUDIO_WORKLET != 'undefined' && ENVIRONMENT_IS_AUDIO_WORKLET)) Module['preRun'] = [];
    var necessaryPreJSTasks = Module['preRun'].slice();
  // end include: /var/folders/l2/fl54zpqn0h52frtq4vglk4c80000gn/T/tmpblww7bgm.js
// include: /var/folders/l2/fl54zpqn0h52frtq4vglk4c80000gn/T/tmp8mam17i9.js

    if (!Module['preRun']) throw 'Module.preRun should exist because file support used it; did a pre-js delete it?';
    necessaryPreJSTasks.forEach((task) => {
      if (Module['preRun'].indexOf(task) < 0) throw 'All preRun tasks that exist before user pre-js code should remain after; did you replace Module or modify Module.preRun?';
    });
  // end include: /var/folders/l2/fl54zpqn0h52frtq4vglk4c80000gn/T/tmp8mam17i9.js


var arguments_ = [];
var thisProgram = './this.program';
var quit_ = (status, toThrow) => {
  throw toThrow;
};

// In MODULARIZE mode _scriptName needs to be captured already at the very top of the page immediately when the page is parsed, so it is generated there
// before the page load. In non-MODULARIZE modes generate it here.
var _scriptName = globalThis.document?.currentScript?.src;

if (typeof __filename != 'undefined') { // Node
  _scriptName = __filename;
} else
if (ENVIRONMENT_IS_WORKER) {
  _scriptName = self.location.href;
}

// `/` should be present at the end if `scriptDirectory` is not empty
var scriptDirectory = '';
function locateFile(path) {
  if (Module['locateFile']) {
    return Module['locateFile'](path, scriptDirectory);
  }
  return scriptDirectory + path;
}

// Hooks that are implemented differently in different runtime environments.
var readAsync, readBinary;

if (ENVIRONMENT_IS_NODE) {
  const isNode = globalThis.process?.versions?.node && globalThis.process?.type != 'renderer';
  if (!isNode) throw new Error('not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)');

  // These modules will usually be used on Node.js. Load them eagerly to avoid
  // the complexity of lazy-loading.
  var fs = require('node:fs');

  scriptDirectory = __dirname + '/';

// include: node_shell_read.js
readBinary = (filename) => {
  // We need to re-wrap `file://` strings to URLs.
  filename = isFileURI(filename) ? new URL(filename) : filename;
  var ret = fs.readFileSync(filename);
  assert(Buffer.isBuffer(ret));
  return ret;
};

readAsync = async (filename, binary = true) => {
  // See the comment in the `readBinary` function.
  filename = isFileURI(filename) ? new URL(filename) : filename;
  var ret = fs.readFileSync(filename, binary ? undefined : 'utf8');
  assert(binary ? Buffer.isBuffer(ret) : typeof ret == 'string');
  return ret;
};
// end include: node_shell_read.js
  if (process.argv.length > 1) {
    thisProgram = process.argv[1].replace(/\\/g, '/');
  }

  arguments_ = process.argv.slice(2);

  // MODULARIZE will export the module in the proper place outside, we don't need to export here
  if (typeof module != 'undefined') {
    module['exports'] = Module;
  }

  quit_ = (status, toThrow) => {
    process.exitCode = status;
    throw toThrow;
  };

} else
if (ENVIRONMENT_IS_SHELL) {

} else

// Note that this includes Node.js workers when relevant (pthreads is enabled).
// Node.js workers are detected as a combination of ENVIRONMENT_IS_WORKER and
// ENVIRONMENT_IS_NODE.
if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  try {
    scriptDirectory = new URL('.', _scriptName).href; // includes trailing slash
  } catch {
    // Must be a `blob:` or `data:` URL (e.g. `blob:http://site.com/etc/etc`), we cannot
    // infer anything from them.
  }

  if (!(globalThis.window || globalThis.WorkerGlobalScope)) throw new Error('not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)');

  {
// include: web_or_worker_shell_read.js
if (ENVIRONMENT_IS_WORKER) {
    readBinary = (url) => {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.responseType = 'arraybuffer';
      xhr.send(null);
      return new Uint8Array(/** @type{!ArrayBuffer} */(xhr.response));
    };
  }

  readAsync = async (url) => {
    // Fetch has some additional restrictions over XHR, like it can't be used on a file:// url.
    // See https://github.com/github/fetch/pull/92#issuecomment-140665932
    // Cordova or Electron apps are typically loaded from a file:// url.
    // So use XHR on webview if URL is a file URL.
    if (isFileURI(url)) {
      return new Promise((resolve, reject) => {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => {
          if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
            resolve(xhr.response);
            return;
          }
          reject(xhr.status);
        };
        xhr.onerror = reject;
        xhr.send(null);
      });
    }
    var response = await fetch(url, { credentials: 'same-origin' });
    if (response.ok) {
      return response.arrayBuffer();
    }
    throw new Error(response.status + ' : ' + response.url);
  };
// end include: web_or_worker_shell_read.js
  }
} else
{
  throw new Error('environment detection error');
}

var out = console.log.bind(console);
var err = console.error.bind(console);

var IDBFS = 'IDBFS is no longer included by default; build with -lidbfs.js';
var PROXYFS = 'PROXYFS is no longer included by default; build with -lproxyfs.js';
var WORKERFS = 'WORKERFS is no longer included by default; build with -lworkerfs.js';
var FETCHFS = 'FETCHFS is no longer included by default; build with -lfetchfs.js';
var ICASEFS = 'ICASEFS is no longer included by default; build with -licasefs.js';
var JSFILEFS = 'JSFILEFS is no longer included by default; build with -ljsfilefs.js';
var OPFS = 'OPFS is no longer included by default; build with -lopfs.js';

var NODEFS = 'NODEFS is no longer included by default; build with -lnodefs.js';

// perform assertions in shell.js after we set up out() and err(), as otherwise
// if an assertion fails it cannot print the message

assert(!ENVIRONMENT_IS_SHELL, 'shell environment detected but not enabled at build time (add `shell` to `-sENVIRONMENT` to enable)');

// end include: shell.js

// include: preamble.js
// === Preamble library stuff ===

// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html

var wasmBinary;

if (!globalThis.WebAssembly) {
  err('no native wasm support detected');
}

// Wasm globals

//========================================
// Runtime essentials
//========================================

// whether we are quitting the application. no code should run after this.
// set in exit() and abort()
var ABORT = false;

// set by exit() and abort().  Passed to 'onExit' handler.
// NOTE: This is also used as the process return code in shell environments
// but only when noExitRuntime is false.
var EXITSTATUS;

// In STRICT mode, we only define assert() when ASSERTIONS is set.  i.e. we
// don't define it at all in release modes.  This matches the behaviour of
// MINIMAL_RUNTIME.
// TODO(sbc): Make this the default even without STRICT enabled.
/** @type {function(*, string=)} */
function assert(condition, text) {
  if (!condition) {
    abort('Assertion failed' + (text ? ': ' + text : ''));
  }
}

// We used to include malloc/free by default in the past. Show a helpful error in
// builds with assertions.

/**
 * Indicates whether filename is delivered via file protocol (as opposed to http/https)
 * @noinline
 */
var isFileURI = (filename) => filename.startsWith('file://');

// include: runtime_common.js
// include: runtime_stack_check.js
// Initializes the stack cookie. Called at the startup of main and at the startup of each thread in pthreads mode.
function writeStackCookie() {
  var max = _emscripten_stack_get_end();
  assert((max & 3) == 0);
  // If the stack ends at address zero we write our cookies 4 bytes into the
  // stack.  This prevents interference with SAFE_HEAP and ASAN which also
  // monitor writes to address zero.
  if (max == 0) {
    max += 4;
  }
  // The stack grow downwards towards _emscripten_stack_get_end.
  // We write cookies to the final two words in the stack and detect if they are
  // ever overwritten.
  HEAPU32[((max)>>2)] = 0x02135467;
  HEAPU32[(((max)+(4))>>2)] = 0x89BACDFE;
  // Also test the global address 0 for integrity.
  HEAPU32[((0)>>2)] = 1668509029;
}

function checkStackCookie() {
  if (ABORT) return;
  var max = _emscripten_stack_get_end();
  // See writeStackCookie().
  if (max == 0) {
    max += 4;
  }
  var cookie1 = HEAPU32[((max)>>2)];
  var cookie2 = HEAPU32[(((max)+(4))>>2)];
  if (cookie1 != 0x02135467 || cookie2 != 0x89BACDFE) {
    abort(`Stack overflow! Stack cookie has been overwritten at ${ptrToString(max)}, expected hex dwords 0x89BACDFE and 0x2135467, but received ${ptrToString(cookie2)} ${ptrToString(cookie1)}`);
  }
  // Also test the global address 0 for integrity.
  if (HEAPU32[((0)>>2)] != 0x63736d65 /* 'emsc' */) {
    abort('Runtime error: The application has corrupted its heap memory area (address zero)!');
  }
}
// end include: runtime_stack_check.js
// include: runtime_exceptions.js
// Base Emscripten EH error class
class EmscriptenEH {}

class EmscriptenSjLj extends EmscriptenEH {}

// end include: runtime_exceptions.js
// include: runtime_debug.js
var runtimeDebug = true; // Switch to false at runtime to disable logging at the right times

// Used by XXXXX_DEBUG settings to output debug messages.
function dbg(...args) {
  if (!runtimeDebug && typeof runtimeDebug != 'undefined') return;
  // TODO(sbc): Make this configurable somehow.  Its not always convenient for
  // logging to show up as warnings.
  console.warn(...args);
}

// Endianness check
(() => {
  var h16 = new Int16Array(1);
  var h8 = new Int8Array(h16.buffer);
  h16[0] = 0x6373;
  if (h8[0] !== 0x73 || h8[1] !== 0x63) abort('Runtime error: expected the system to be little-endian! (Run with -sSUPPORT_BIG_ENDIAN to bypass)');
})();

function consumedModuleProp(prop) {
  if (!Object.getOwnPropertyDescriptor(Module, prop)) {
    Object.defineProperty(Module, prop, {
      configurable: true,
      set() {
        abort(`Attempt to set \`Module.${prop}\` after it has already been processed.  This can happen, for example, when code is injected via '--post-js' rather than '--pre-js'`);

      }
    });
  }
}

function makeInvalidEarlyAccess(name) {
  return () => assert(false, `call to '${name}' via reference taken before Wasm module initialization`);

}

function ignoredModuleProp(prop) {
  if (Object.getOwnPropertyDescriptor(Module, prop)) {
    abort(`\`Module.${prop}\` was supplied but \`${prop}\` not included in INCOMING_MODULE_JS_API`);
  }
}

// forcing the filesystem exports a few things by default
function isExportedByForceFilesystem(name) {
  return name === 'FS_createPath' ||
         name === 'FS_createDataFile' ||
         name === 'FS_createPreloadedFile' ||
         name === 'FS_preloadFile' ||
         name === 'FS_unlink' ||
         name === 'addRunDependency' ||
         // The old FS has some functionality that WasmFS lacks.
         name === 'FS_createLazyFile' ||
         name === 'FS_createDevice' ||
         name === 'removeRunDependency';
}

/**
 * Intercept access to a symbols in the global symbol.  This enables us to give
 * informative warnings/errors when folks attempt to use symbols they did not
 * include in their build, or no symbols that no longer exist.
 *
 * We don't define this in MODULARIZE mode since in that mode emscripten symbols
 * are never placed in the global scope.
 */
function hookGlobalSymbolAccess(sym, func) {
  if (!Object.getOwnPropertyDescriptor(globalThis, sym)) {
    Object.defineProperty(globalThis, sym, {
      configurable: true,
      get() {
        func();
        return undefined;
      }
    });
  }
}

function missingGlobal(sym, msg) {
  hookGlobalSymbolAccess(sym, () => {
    warnOnce(`\`${sym}\` is no longer defined by emscripten. ${msg}`);
  });
}

missingGlobal('buffer', 'Please use HEAP8.buffer or wasmMemory.buffer');
missingGlobal('asm', 'Please use wasmExports instead');

function missingLibrarySymbol(sym) {
  hookGlobalSymbolAccess(sym, () => {
    // Can't `abort()` here because it would break code that does runtime
    // checks.  e.g. `if (typeof SDL === 'undefined')`.
    var msg = `\`${sym}\` is a library symbol and not included by default; add it to your library.js __deps or to DEFAULT_LIBRARY_FUNCS_TO_INCLUDE on the command line`;
    // DEFAULT_LIBRARY_FUNCS_TO_INCLUDE requires the name as it appears in
    // library.js, which means $name for a JS name with no prefix, or name
    // for a JS name like _name.
    var librarySymbol = sym;
    if (!librarySymbol.startsWith('_')) {
      librarySymbol = '$' + sym;
    }
    msg += ` (e.g. -sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE='${librarySymbol}')`;
    if (isExportedByForceFilesystem(sym)) {
      msg += '. Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you';
    }
    warnOnce(msg);
  });

  // Any symbol that is not included from the JS library is also (by definition)
  // not exported on the Module object.
  unexportedRuntimeSymbol(sym);
}

function unexportedRuntimeSymbol(sym) {
  if (!Object.getOwnPropertyDescriptor(Module, sym)) {
    Object.defineProperty(Module, sym, {
      configurable: true,
      get() {
        var msg = `'${sym}' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the Emscripten FAQ)`;
        if (isExportedByForceFilesystem(sym)) {
          msg += '. Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you';
        }
        abort(msg);
      },
    });
  }
}

// end include: runtime_debug.js
// Memory management

var runtimeInitialized = false;



function updateMemoryViews() {
  var b = wasmMemory.buffer;
  HEAP8 = new Int8Array(b);
  HEAP16 = new Int16Array(b);
  HEAPU8 = new Uint8Array(b);
  HEAPU16 = new Uint16Array(b);
  HEAP32 = new Int32Array(b);
  HEAPU32 = new Uint32Array(b);
  HEAPF32 = new Float32Array(b);
  HEAPF64 = new Float64Array(b);
  HEAP64 = new BigInt64Array(b);
  HEAPU64 = new BigUint64Array(b);
}

// include: memoryprofiler.js
// end include: memoryprofiler.js
// end include: runtime_common.js
assert(globalThis.Int32Array && globalThis.Float64Array && Int32Array.prototype.subarray && Int32Array.prototype.set,
       'JS engine does not provide full typed array support');

function preRun() {
  if (Module['preRun']) {
    if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
    while (Module['preRun'].length) {
      addOnPreRun(Module['preRun'].shift());
    }
  }
  consumedModuleProp('preRun');
  // Begin ATPRERUNS hooks
  callRuntimeCallbacks(onPreRuns);
  // End ATPRERUNS hooks
}

function initRuntime() {
  assert(!runtimeInitialized);
  runtimeInitialized = true;

  setStackLimits();

  checkStackCookie();

  // Begin ATINITS hooks
  SOCKFS.root = FS.mount(SOCKFS, {}, null);
if (!Module['noFSInit'] && !FS.initialized) FS.init();
TTY.init();
PIPEFS.root = FS.mount(PIPEFS, {}, null);
  // End ATINITS hooks

  wasmExports['__wasm_call_ctors']();

  // Begin ATPOSTCTORS hooks
  FS.ignorePermissions = false;
  // End ATPOSTCTORS hooks
}

function preMain() {
  checkStackCookie();
  // No ATMAINS hooks
}

function postRun() {
  checkStackCookie();
   // PThreads reuse the runtime from the main thread.

  if (Module['postRun']) {
    if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
    while (Module['postRun'].length) {
      addOnPostRun(Module['postRun'].shift());
    }
  }
  consumedModuleProp('postRun');

  // Begin ATPOSTRUNS hooks
  callRuntimeCallbacks(onPostRuns);
  // End ATPOSTRUNS hooks
}

/**
 * @param {string|number=} what
 */
function abort(what) {
  Module['onAbort']?.(what);

  what = `Aborted(${what})`;
  // TODO(sbc): Should we remove printing and leave it up to whoever
  // catches the exception?
  err(what);

  ABORT = true;

  // Use a wasm runtime error, because a JS error might be seen as a foreign
  // exception, which means we'd run destructors on it. We need the error to
  // simply make the program stop.
  // FIXME This approach does not work in Wasm EH because it currently does not assume
  // all RuntimeErrors are from traps; it decides whether a RuntimeError is from
  // a trap or not based on a hidden field within the object. So at the moment
  // we don't have a way of throwing a wasm trap from JS. TODO Make a JS API that
  // allows this in the wasm spec.

  // Suppress closure compiler warning here. Closure compiler's builtin extern
  // definition for WebAssembly.RuntimeError claims it takes no arguments even
  // though it can.
  // TODO(https://github.com/google/closure-compiler/pull/3913): Remove if/when upstream closure gets fixed.
  /** @suppress {checkTypes} */
  var e = new WebAssembly.RuntimeError(what);

  // Throw the error whether or not MODULARIZE is set because abort is used
  // in code paths apart from instantiation where an exception is expected
  // to be thrown when abort is called.
  throw e;
}

function createExportWrapper(name, nargs) {
  return (...args) => {
    assert(runtimeInitialized, `native function \`${name}\` called before runtime initialization`);
    var f = wasmExports[name];
    assert(f, `exported native function \`${name}\` not found`);
    // Only assert for too many arguments. Too few can be valid since the missing arguments will be zero filled.
    assert(args.length <= nargs, `native function \`${name}\` called with ${args.length} args but expects ${nargs}`);
    return f(...args);
  };
}

var wasmBinaryFile;

function findWasmBinary() {
  return locateFile('temacs.wasm');
}

function getBinarySync(file) {
  if (file == wasmBinaryFile && wasmBinary) {
    return new Uint8Array(wasmBinary);
  }
  if (readBinary) {
    return readBinary(file);
  }
  // Throwing a plain string here, even though it not normally advisable since
  // this gets turning into an `abort` in instantiateArrayBuffer.
  throw 'both async and sync fetching of the wasm failed';
}

async function getWasmBinary(binaryFile) {
  // If we don't have the binary yet, load it asynchronously using readAsync.
  if (!wasmBinary) {
    // Fetch the binary using readAsync
    try {
      var response = await readAsync(binaryFile);
      return new Uint8Array(response);
    } catch {
      // Fall back to getBinarySync below;
    }
  }

  // Otherwise, getBinarySync should be able to get it synchronously
  return getBinarySync(binaryFile);
}

async function instantiateArrayBuffer(binaryFile, imports) {
  try {
    var binary = await getWasmBinary(binaryFile);
    var instance = await WebAssembly.instantiate(binary, imports);
    return instance;
  } catch (reason) {
    err(`failed to asynchronously prepare wasm: ${reason}`);

    // Warn on some common problems.
    if (isFileURI(binaryFile)) {
      err(`warning: Loading from a file URI (${binaryFile}) is not supported in most browsers. See https://emscripten.org/docs/getting_started/FAQ.html#how-do-i-run-a-local-webserver-for-testing-why-does-my-program-stall-in-downloading-or-preparing`);
    }
    abort(reason);
  }
}

async function instantiateAsync(binary, binaryFile, imports) {
  if (!binary
      // Don't use streaming for file:// delivered objects in a webview, fetch them synchronously.
      && !isFileURI(binaryFile)
      // Avoid instantiateStreaming() on Node.js environment for now, as while
      // Node.js v18.1.0 implements it, it does not have a full fetch()
      // implementation yet.
      //
      // Reference:
      //   https://github.com/emscripten-core/emscripten/pull/16917
      && !ENVIRONMENT_IS_NODE
     ) {
    try {
      var response = fetch(binaryFile, { credentials: 'same-origin' });
      var instantiationResult = await WebAssembly.instantiateStreaming(response, imports);
      return instantiationResult;
    } catch (reason) {
      // We expect the most common failure cause to be a bad MIME type for the binary,
      // in which case falling back to ArrayBuffer instantiation should work.
      err(`wasm streaming compile failed: ${reason}`);
      err('falling back to ArrayBuffer instantiation');
      // fall back of instantiateArrayBuffer below
    };
  }
  return instantiateArrayBuffer(binaryFile, imports);
}

function getWasmImports() {
  // prepare imports
  var imports = {
    'env': wasmImports,
    'wasi_snapshot_preview1': wasmImports,
  };
  return imports;
}

// Create the wasm instance.
// Receives the wasm imports, returns the exports.
async function createWasm() {
  // Load the wasm module and create an instance of using native support in the JS engine.
  // handle a generated wasm instance, receiving its exports and
  // performing other necessary setup
  /** @param {WebAssembly.Module=} module*/
  function receiveInstance(instance, module) {
    wasmExports = instance.exports;

    assignWasmExports(wasmExports);

    updateMemoryViews();

    removeRunDependency('wasm-instantiate');
    return wasmExports;
  }
  addRunDependency('wasm-instantiate');

  // Prefer streaming instantiation if available.
  // Async compilation can be confusing when an error on the page overwrites Module
  // (for example, if the order of elements is wrong, and the one defining Module is
  // later), so we save Module and check it later.
  var trueModule = Module;
  function receiveInstantiationResult(result) {
    // 'result' is a ResultObject object which has both the module and instance.
    // receiveInstance() will swap in the exports (to Module.asm) so they can be called
    assert(Module === trueModule, 'the Module object should not be replaced during async compilation - perhaps the order of HTML elements is wrong?');
    trueModule = null;
    // TODO: Due to Closure regression https://github.com/google/closure-compiler/issues/3193, the above line no longer optimizes out down to the following line.
    // When the regression is fixed, can restore the above PTHREADS-enabled path.
    return receiveInstance(result['instance']);
  }

  var info = getWasmImports();

  // User shell pages can write their own Module.instantiateWasm = function(imports, successCallback) callback
  // to manually instantiate the Wasm module themselves. This allows pages to
  // run the instantiation parallel to any other async startup actions they are
  // performing.
  // Also pthreads and wasm workers initialize the wasm instance through this
  // path.
  if (Module['instantiateWasm']) {
    return new Promise((resolve, reject) => {
      try {
        Module['instantiateWasm'](info, (inst, mod) => {
          resolve(receiveInstance(inst, mod));
        });
      } catch(e) {
        err(`Module.instantiateWasm callback failed with error: ${e}`);
        reject(e);
      }
    });
  }

  wasmBinaryFile ??= findWasmBinary();
  var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info);
  var exports = receiveInstantiationResult(result);
  return exports;
}

// end include: preamble.js

// Begin JS library code


  class ExitStatus {
      name = 'ExitStatus';
      constructor(status) {
        this.message = `Program terminated with exit(${status})`;
        this.status = status;
      }
    }

  /** @type {!Int16Array} */
  var HEAP16;

  /** @type {!Int32Array} */
  var HEAP32;

  /** not-@type {!BigInt64Array} */
  var HEAP64;

  /** @type {!Int8Array} */
  var HEAP8;

  /** @type {!Float32Array} */
  var HEAPF32;

  /** @type {!Float64Array} */
  var HEAPF64;

  /** @type {!Uint16Array} */
  var HEAPU16;

  /** @type {!Uint32Array} */
  var HEAPU32;

  /** not-@type {!BigUint64Array} */
  var HEAPU64;

  /** @type {!Uint8Array} */
  var HEAPU8;

  var callRuntimeCallbacks = (callbacks) => {
      while (callbacks.length > 0) {
        // Pass the module as the first argument.
        callbacks.shift()(Module);
      }
    };
  var onPostRuns = [];
  var addOnPostRun = (cb) => onPostRuns.push(cb);

  var onPreRuns = [];
  var addOnPreRun = (cb) => onPreRuns.push(cb);

  var runDependencies = 0;
  
  
  var dependenciesFulfilled = null;
  
  var runDependencyTracking = {
  };
  
  var runDependencyWatcher = null;
  var removeRunDependency = (id) => {
      runDependencies--;
  
      Module['monitorRunDependencies']?.(runDependencies);
  
      assert(id, 'removeRunDependency requires an ID');
      assert(runDependencyTracking[id]);
      delete runDependencyTracking[id];
      if (runDependencies == 0) {
        if (runDependencyWatcher !== null) {
          clearInterval(runDependencyWatcher);
          runDependencyWatcher = null;
        }
        if (dependenciesFulfilled) {
          var callback = dependenciesFulfilled;
          dependenciesFulfilled = null;
          callback(); // can add another dependenciesFulfilled
        }
      }
    };
  
  
  var addRunDependency = (id) => {
      runDependencies++;
  
      Module['monitorRunDependencies']?.(runDependencies);
  
      assert(id, 'addRunDependency requires an ID')
      assert(!runDependencyTracking[id]);
      runDependencyTracking[id] = 1;
      if (runDependencyWatcher === null && globalThis.setInterval) {
        // Check for missing dependencies every few seconds
        runDependencyWatcher = setInterval(() => {
          if (ABORT) {
            clearInterval(runDependencyWatcher);
            runDependencyWatcher = null;
            return;
          }
          var shown = false;
          for (var dep in runDependencyTracking) {
            if (!shown) {
              shown = true;
              err('still waiting on run dependencies:');
            }
            err(`dependency: ${dep}`);
          }
          if (shown) {
            err('(end of list)');
          }
        }, 10000);
        // Prevent this timer from keeping the runtime alive if nothing
        // else is.
        runDependencyWatcher.unref?.()
      }
    };


  
    /**
   * @param {number} ptr
   * @param {string} type
   */
  function getValue(ptr, type = 'i8') {
    if (type.endsWith('*')) type = '*';
    switch (type) {
      case 'i1': return HEAP8[ptr];
      case 'i8': return HEAP8[ptr];
      case 'i16': return HEAP16[((ptr)>>1)];
      case 'i32': return HEAP32[((ptr)>>2)];
      case 'i64': return HEAP64[((ptr)>>3)];
      case 'float': return HEAPF32[((ptr)>>2)];
      case 'double': return HEAPF64[((ptr)>>3)];
      case '*': return HEAPU32[((ptr)>>2)];
      default: abort(`invalid type for getValue: ${type}`);
    }
  }

  var noExitRuntime = true;

  function ptrToString(ptr) {
      assert(typeof ptr === 'number', `ptrToString expects a number, got ${typeof ptr}`);
      // Convert to 32-bit unsigned value
      ptr >>>= 0;
      return '0x' + ptr.toString(16).padStart(8, '0');
    }


  var setStackLimits = () => {
      var stackLow = _emscripten_stack_get_base();
      var stackHigh = _emscripten_stack_get_end();
      ___set_stack_limits(stackLow, stackHigh);
    };

  
    /**
   * @param {number} ptr
   * @param {number} value
   * @param {string} type
   */
  function setValue(ptr, value, type = 'i8') {
    if (type.endsWith('*')) type = '*';
    switch (type) {
      case 'i1': HEAP8[ptr] = value; break;
      case 'i8': HEAP8[ptr] = value; break;
      case 'i16': HEAP16[((ptr)>>1)] = value; break;
      case 'i32': HEAP32[((ptr)>>2)] = value; break;
      case 'i64': HEAP64[((ptr)>>3)] = BigInt(value); break;
      case 'float': HEAPF32[((ptr)>>2)] = value; break;
      case 'double': HEAPF64[((ptr)>>3)] = value; break;
      case '*': HEAPU32[((ptr)>>2)] = value; break;
      default: abort(`invalid type for setValue: ${type}`);
    }
  }

  var stackRestore = (val) => __emscripten_stack_restore(val);

  var stackSave = () => _emscripten_stack_get_current();

  var warnOnce = (text) => {
      warnOnce.shown ||= {};
      if (!warnOnce.shown[text]) {
        warnOnce.shown[text] = 1;
        if (ENVIRONMENT_IS_NODE) text = 'warning: ' + text;
        err(text);
      }
    };

  

  var wasmTableMirror = [];
  
  
  var getWasmTableEntry = (funcPtr) => {
      var func = wasmTableMirror[funcPtr];
      if (!func) {
        /** @suppress {checkTypes} */
        wasmTableMirror[funcPtr] = func = wasmTable.get(funcPtr);
      }
      /** @suppress {checkTypes} */
      assert(wasmTable.get(funcPtr) == func, 'table mirror is out of date');
      return func;
    };
  var ___call_sighandler = (fp, sig) => getWasmTableEntry(fp)(sig);

  
  
  var ___handle_stack_overflow = (requested) => {
      var base = _emscripten_stack_get_base();
      var end = _emscripten_stack_get_end();
      abort(`stack overflow (Attempt to set SP to ${ptrToString(requested)}` +
            `, with stack limits [${ptrToString(end)} - ${ptrToString(base)}` +
            ']). If you require more stack space build with -sSTACK_SIZE=<bytes>');
    };

  var initRandomFill = () => {
      // This block is not needed on v19+ since crypto.getRandomValues is builtin
      if (ENVIRONMENT_IS_NODE) {
        var nodeCrypto = require('node:crypto');
        return (view) => nodeCrypto.randomFillSync(view);
      }
  
      return (view) => (crypto.getRandomValues(view), 0);
    };
  var randomFill = (view) => (randomFill = initRandomFill())(view);
  
  var PATH = {
  isAbs:(path) => path.charAt(0) === '/',
  splitPath:(filename) => {
        var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
        return splitPathRe.exec(filename).slice(1);
      },
  normalizeArray:(parts, allowAboveRoot) => {
        // if the path tries to go above the root, `up` ends up > 0
        var up = 0;
        for (var i = parts.length - 1; i >= 0; i--) {
          var last = parts[i];
          if (last === '.') {
            parts.splice(i, 1);
          } else if (last === '..') {
            parts.splice(i, 1);
            up++;
          } else if (up) {
            parts.splice(i, 1);
            up--;
          }
        }
        // if the path is allowed to go above the root, restore leading ..s
        if (allowAboveRoot) {
          for (; up; up--) {
            parts.unshift('..');
          }
        }
        return parts;
      },
  normalize:(path) => {
        var isAbsolute = PATH.isAbs(path),
            trailingSlash = path.slice(-1) === '/';
        // Normalize the path
        path = PATH.normalizeArray(path.split('/').filter((p) => !!p), !isAbsolute).join('/');
        if (!path && !isAbsolute) {
          path = '.';
        }
        if (path && trailingSlash) {
          path += '/';
        }
        return (isAbsolute ? '/' : '') + path;
      },
  dirname:(path) => {
        var result = PATH.splitPath(path),
            root = result[0],
            dir = result[1];
        if (!root && !dir) {
          // No dirname whatsoever
          return '.';
        }
        if (dir) {
          // It has a dirname, strip trailing slash
          dir = dir.slice(0, -1);
        }
        return root + dir;
      },
  basename:(path) => path && path.match(/([^\/]+|\/)\/*$/)[1],
join:(...paths) => PATH.normalize(paths.join('/')),
join2:(l, r) => PATH.normalize(l + '/' + r),
};


var PATH_FS = {
resolve:(...args) => {
      var resolvedPath = '',
        resolvedAbsolute = false;
      for (var i = args.length - 1; i >= -1 && !resolvedAbsolute; i--) {
        var path = (i >= 0) ? args[i] : FS.cwd();
        // Skip empty and invalid entries
        if (typeof path != 'string') {
          throw new TypeError('Arguments to path.resolve must be strings');
        } else if (!path) {
          return ''; // an invalid portion invalidates the whole thing
        }
        resolvedPath = path + '/' + resolvedPath;
        resolvedAbsolute = PATH.isAbs(path);
      }
      // At this point the path should be resolved to a full absolute path, but
      // handle relative paths to be safe (might happen when process.cwd() fails)
      resolvedPath = PATH.normalizeArray(resolvedPath.split('/').filter((p) => !!p), !resolvedAbsolute).join('/');
      return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
    },
relative:(from, to) => {
      from = PATH_FS.resolve(from).slice(1);
      to = PATH_FS.resolve(to).slice(1);
      function trim(arr) {
        var start = 0;
        for (; start < arr.length; start++) {
          if (arr[start] !== '') break;
        }
        var end = arr.length - 1;
        for (; end >= 0; end--) {
          if (arr[end] !== '') break;
        }
        if (start > end) return [];
        return arr.slice(start, end - start + 1);
      }
      var fromParts = trim(from.split('/'));
      var toParts = trim(to.split('/'));
      var length = Math.min(fromParts.length, toParts.length);
      var samePartsLength = length;
      for (var i = 0; i < length; i++) {
        if (fromParts[i] !== toParts[i]) {
          samePartsLength = i;
          break;
        }
      }
      var outputParts = [];
      for (var i = samePartsLength; i < fromParts.length; i++) {
        outputParts.push('..');
      }
      outputParts = outputParts.concat(toParts.slice(samePartsLength));
      return outputParts.join('/');
    },
};


var UTF8Decoder = globalThis.TextDecoder && new TextDecoder();

var findStringEnd = (heapOrArray, idx, maxBytesToRead, ignoreNul) => {
    var maxIdx = idx + maxBytesToRead;
    if (ignoreNul) return maxIdx;
    // TextDecoder needs to know the byte length in advance, it doesn't stop on
    // null terminator by itself.
    // As a tiny code save trick, compare idx against maxIdx using a negation,
    // so that maxBytesToRead=undefined/NaN means Infinity.
    while (heapOrArray[idx] && !(idx >= maxIdx)) ++idx;
    return idx;
  };


  /**
   * Given a pointer 'idx' to a null-terminated UTF8-encoded string in the given
   * array that contains uint8 values, returns a copy of that string as a
   * Javascript String object.
   * heapOrArray is either a regular array, or a JavaScript typed array view.
   * @param {number=} idx
   * @param {number=} maxBytesToRead
   * @param {boolean=} ignoreNul - If true, the function will not stop on a NUL character.
   * @return {string}
   */
  var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {
  
      var endPtr = findStringEnd(heapOrArray, idx, maxBytesToRead, ignoreNul);
  
      // When using conditional TextDecoder, skip it for short strings as the overhead of the native call is not worth it.
      if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
        return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
      }
      var str = '';
      while (idx < endPtr) {
        // For UTF8 byte structure, see:
        // http://en.wikipedia.org/wiki/UTF-8#Description
        // https://www.ietf.org/rfc/rfc2279.txt
        // https://tools.ietf.org/html/rfc3629
        var u0 = heapOrArray[idx++];
        if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
        var u1 = heapOrArray[idx++] & 63;
        if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
        var u2 = heapOrArray[idx++] & 63;
        if ((u0 & 0xF0) == 0xE0) {
          u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
        } else {
          if ((u0 & 0xF8) != 0xF0) warnOnce(`Invalid UTF-8 leading byte ${ptrToString(u0)} encountered when deserializing a UTF-8 string in wasm memory to a JS string!`);
          u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (heapOrArray[idx++] & 63);
        }
  
        if (u0 < 0x10000) {
          str += String.fromCharCode(u0);
        } else {
          var ch = u0 - 0x10000;
          str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
        }
      }
      return str;
    };
  
  var FS_stdin_getChar_buffer = [];
  
  var lengthBytesUTF8 = (str) => {
      var len = 0;
      for (var i = 0; i < str.length; ++i) {
        // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code
        // unit, not a Unicode code point of the character! So decode
        // UTF16->UTF32->UTF8.
        // See http://unicode.org/faq/utf_bom.html#utf16-3
        var c = str.charCodeAt(i); // possibly a lead surrogate
        if (c <= 0x7F) {
          len++;
        } else if (c <= 0x7FF) {
          len += 2;
        } else if (c >= 0xD800 && c <= 0xDFFF) {
          len += 4; ++i;
        } else {
          len += 3;
        }
      }
      return len;
    };
  
  var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
      assert(typeof str === 'string', `stringToUTF8Array expects a string (got ${typeof str})`);
      // Parameter maxBytesToWrite is not optional. Negative values, 0, null,
      // undefined and false each don't write out any bytes.
      if (!(maxBytesToWrite > 0))
        return 0;
  
      var startIdx = outIdx;
      var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
      for (var i = 0; i < str.length; ++i) {
        // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description
        // and https://www.ietf.org/rfc/rfc2279.txt
        // and https://tools.ietf.org/html/rfc3629
        var u = str.codePointAt(i);
        if (u <= 0x7F) {
          if (outIdx >= endIdx) break;
          heap[outIdx++] = u;
        } else if (u <= 0x7FF) {
          if (outIdx + 1 >= endIdx) break;
          heap[outIdx++] = 0xC0 | (u >> 6);
          heap[outIdx++] = 0x80 | (u & 63);
        } else if (u <= 0xFFFF) {
          if (outIdx + 2 >= endIdx) break;
          heap[outIdx++] = 0xE0 | (u >> 12);
          heap[outIdx++] = 0x80 | ((u >> 6) & 63);
          heap[outIdx++] = 0x80 | (u & 63);
        } else {
          if (outIdx + 3 >= endIdx) break;
          if (u > 0x10FFFF) warnOnce(`Invalid Unicode code point ${ptrToString(u)} encountered when serializing a JS string to a UTF-8 string in wasm memory! (Valid unicode code points should be in range 0-0x10FFFF).`);
          heap[outIdx++] = 0xF0 | (u >> 18);
          heap[outIdx++] = 0x80 | ((u >> 12) & 63);
          heap[outIdx++] = 0x80 | ((u >> 6) & 63);
          heap[outIdx++] = 0x80 | (u & 63);
          // Gotcha: if codePoint is over 0xFFFF, it is represented as a surrogate pair in UTF-16.
          // We need to manually skip over the second code unit for correct iteration.
          i++;
        }
      }
      // Null-terminate the pointer to the buffer.
      heap[outIdx] = 0;
      return outIdx - startIdx;
    };
  /** @type {function(string, boolean=, number=)} */
  var intArrayFromString = (stringy, dontAddNull, length) => {
      var len = length > 0 ? length : lengthBytesUTF8(stringy)+1;
      var u8array = new Array(len);
      var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
      if (dontAddNull) u8array.length = numBytesWritten;
      return u8array;
    };
  var FS_stdin_getChar = () => {
      if (!FS_stdin_getChar_buffer.length) {
        var result = null;
        if (ENVIRONMENT_IS_NODE) {
          // we will read data by chunks of BUFSIZE
          var BUFSIZE = 256;
          var buf = Buffer.alloc(BUFSIZE);
          var bytesRead = 0;
  
          // For some reason we must suppress a closure warning here, even though
          // fd definitely exists on process.stdin, and is even the proper way to
          // get the fd of stdin,
          // https://github.com/nodejs/help/issues/2136#issuecomment-523649904
          // This started to happen after moving this logic out of library_tty.js,
          // so it is related to the surrounding code in some unclear manner.
          /** @suppress {missingProperties} */
          var fd = process.stdin.fd;
  
          try {
            bytesRead = fs.readSync(fd, buf, 0, BUFSIZE);
          } catch(e) {
            // Cross-platform differences: on Windows, reading EOF throws an
            // exception, but on other OSes, reading EOF returns 0. Uniformize
            // behavior by treating the EOF exception to return 0.
            if (e.toString().includes('EOF')) bytesRead = 0;
            else throw e;
          }
  
          if (bytesRead > 0) {
            result = buf.slice(0, bytesRead).toString('utf-8');
          }
        } else
        if (globalThis.window?.prompt) {
          // Browser.
          result = window.prompt('Input: ');  // returns null on cancel
          if (result !== null) {
            result += '\n';
          }
        } else
        {}
        if (!result) {
          return null;
        }
        FS_stdin_getChar_buffer = intArrayFromString(result, true);
      }
      return FS_stdin_getChar_buffer.shift();
    };
  var TTY = {
  ttys:[],
  init() {
        // https://github.com/emscripten-core/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // currently, FS.init does not distinguish if process.stdin is a file or TTY
        //   // device, it always assumes it's a TTY device. because of this, we're forcing
        //   // process.stdin to UTF8 encoding to at least make stdin reading compatible
        //   // with text files until FS.init can be refactored.
        //   process.stdin.setEncoding('utf8');
        // }
      },
  shutdown() {
        // https://github.com/emscripten-core/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // inolen: any idea as to why node -e 'process.stdin.read()' wouldn't exit immediately (with process.stdin being a tty)?
        //   // isaacs: because now it's reading from the stream, you've expressed interest in it, so that read() kicks off a _read() which creates a ReadReq operation
        //   // inolen: I thought read() in that case was a synchronous operation that just grabbed some amount of buffered data if it exists?
        //   // isaacs: it is. but it also triggers a _read() call, which calls readStart() on the handle
        //   // isaacs: do process.stdin.pause() and i'd think it'd probably close the pending call
        //   process.stdin.pause();
        // }
      },
  register(dev, ops) {
        TTY.ttys[dev] = { input: [], output: [], ops: ops };
        FS.registerDevice(dev, TTY.stream_ops);
      },
  stream_ops:{
  open(stream) {
          var tty = TTY.ttys[stream.node.rdev];
          if (!tty) {
            throw new FS.ErrnoError(43);
          }
          stream.tty = tty;
          stream.seekable = false;
        },
  close(stream) {
          // flush any pending line data
          stream.tty.ops.fsync(stream.tty);
        },
  fsync(stream) {
          stream.tty.ops.fsync(stream.tty);
        },
  read(stream, buffer, offset, length, pos /* ignored */) {
          if (!stream.tty || !stream.tty.ops.get_char) {
            throw new FS.ErrnoError(60);
          }
          var bytesRead = 0;
          for (var i = 0; i < length; i++) {
            var result;
            try {
              result = stream.tty.ops.get_char(stream.tty);
            } catch (e) {
              throw new FS.ErrnoError(29);
            }
            if (result === undefined && bytesRead === 0) {
              throw new FS.ErrnoError(6);
            }
            if (result === null || result === undefined) break;
            bytesRead++;
            buffer[offset+i] = result;
          }
          if (bytesRead) {
            stream.node.atime = Date.now();
          }
          return bytesRead;
        },
  write(stream, buffer, offset, length, pos) {
          if (!stream.tty || !stream.tty.ops.put_char) {
            throw new FS.ErrnoError(60);
          }
          try {
            for (var i = 0; i < length; i++) {
              stream.tty.ops.put_char(stream.tty, buffer[offset+i]);
            }
          } catch (e) {
            throw new FS.ErrnoError(29);
          }
          if (length) {
            stream.node.mtime = stream.node.ctime = Date.now();
          }
          return i;
        },
  },
  default_tty_ops:{
  get_char(tty) {
          return FS_stdin_getChar();
        },
  put_char(tty, val) {
          if (val === null || val === 10) {
            out(UTF8ArrayToString(tty.output));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val); // val == 0 would cut text output off in the middle.
          }
        },
  fsync(tty) {
          if (tty.output?.length > 0) {
            out(UTF8ArrayToString(tty.output));
            tty.output = [];
          }
        },
  ioctl_tcgets(tty) {
          // typical setting
          return {
            c_iflag: 25856,
            c_oflag: 5,
            c_cflag: 191,
            c_lflag: 35387,
            c_cc: [
              0x03, 0x1c, 0x7f, 0x15, 0x04, 0x00, 0x01, 0x00, 0x11, 0x13, 0x1a, 0x00,
              0x12, 0x0f, 0x17, 0x16, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
              0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            ]
          };
        },
  ioctl_tcsets(tty, optional_actions, data) {
          // currently just ignore
          return 0;
        },
  ioctl_tiocgwinsz(tty) {
          return [24, 80];
        },
  },
  default_tty1_ops:{
  put_char(tty, val) {
          if (val === null || val === 10) {
            err(UTF8ArrayToString(tty.output));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val);
          }
        },
  fsync(tty) {
          if (tty.output?.length > 0) {
            err(UTF8ArrayToString(tty.output));
            tty.output = [];
          }
        },
  },
  };
  
  
  var mmapAlloc = (size) => {
      abort('internal error: mmapAlloc called but `emscripten_builtin_memalign` native symbol not exported');
    };
  var MEMFS = {
  ops_table:null,
  mount(mount) {
        return MEMFS.createNode(null, '/', 16895, 0);
      },
  createNode(parent, name, mode, dev) {
        if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
          // not supported
          throw new FS.ErrnoError(63);
        }
        MEMFS.ops_table ||= {
          dir: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr,
              lookup: MEMFS.node_ops.lookup,
              mknod: MEMFS.node_ops.mknod,
              rename: MEMFS.node_ops.rename,
              unlink: MEMFS.node_ops.unlink,
              rmdir: MEMFS.node_ops.rmdir,
              readdir: MEMFS.node_ops.readdir,
              symlink: MEMFS.node_ops.symlink
            },
            stream: {
              llseek: MEMFS.stream_ops.llseek
            }
          },
          file: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr
            },
            stream: {
              llseek: MEMFS.stream_ops.llseek,
              read: MEMFS.stream_ops.read,
              write: MEMFS.stream_ops.write,
              mmap: MEMFS.stream_ops.mmap,
              msync: MEMFS.stream_ops.msync
            }
          },
          link: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr,
              readlink: MEMFS.node_ops.readlink
            },
            stream: {}
          },
          chrdev: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr
            },
            stream: FS.chrdev_stream_ops
          }
        };
        var node = FS.createNode(parent, name, mode, dev);
        if (FS.isDir(node.mode)) {
          node.node_ops = MEMFS.ops_table.dir.node;
          node.stream_ops = MEMFS.ops_table.dir.stream;
          node.contents = {};
        } else if (FS.isFile(node.mode)) {
          node.node_ops = MEMFS.ops_table.file.node;
          node.stream_ops = MEMFS.ops_table.file.stream;
          // The actual number of bytes used in the typed array, as opposed to
          // contents.length which gives the whole capacity.
          node.usedBytes = 0;
          // The byte data of the file is stored in a typed array.
          // Note: typed arrays are not resizable like normal JS arrays are, so
          // there is a small penalty involved for appending file writes that
          // continuously grow a file similar to std::vector capacity vs used.
          node.contents = MEMFS.emptyFileContents ??= new Uint8Array(0);
        } else if (FS.isLink(node.mode)) {
          node.node_ops = MEMFS.ops_table.link.node;
          node.stream_ops = MEMFS.ops_table.link.stream;
        } else if (FS.isChrdev(node.mode)) {
          node.node_ops = MEMFS.ops_table.chrdev.node;
          node.stream_ops = MEMFS.ops_table.chrdev.stream;
        }
        node.atime = node.mtime = node.ctime = Date.now();
        // add the new node to the parent
        if (parent) {
          parent.contents[name] = node;
          parent.atime = parent.mtime = parent.ctime = node.atime;
        }
        return node;
      },
  getFileDataAsTypedArray(node) {
        assert(FS.isFile(node.mode), 'getFileDataAsTypedArray called on non-file');
        return node.contents.subarray(0, node.usedBytes); // Make sure to not return excess unused bytes.
      },
  expandFileStorage(node, newCapacity) {
        var prevCapacity = node.contents.length;
        if (prevCapacity >= newCapacity) return; // No need to expand, the storage was already large enough.
        // Don't expand strictly to the given requested limit if it's only a very
        // small increase, but instead geometrically grow capacity.
        // For small filesizes (<1MB), perform size*2 geometric increase, but for
        // large sizes, do a much more conservative size*1.125 increase to avoid
        // overshooting the allocation cap by a very large margin.
        var CAPACITY_DOUBLING_MAX = 1024 * 1024;
        newCapacity = Math.max(newCapacity, (prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2.0 : 1.125)) >>> 0);
        if (prevCapacity) newCapacity = Math.max(newCapacity, 256); // At minimum allocate 256b for each file when expanding.
        var oldContents = MEMFS.getFileDataAsTypedArray(node);
        node.contents = new Uint8Array(newCapacity); // Allocate new storage.
        node.contents.set(oldContents);
      },
  resizeFileStorage(node, newSize) {
        if (node.usedBytes == newSize) return;
        var oldContents = node.contents;
        node.contents = new Uint8Array(newSize); // Allocate new storage.
        node.contents.set(oldContents.subarray(0, Math.min(newSize, node.usedBytes))); // Copy old data over to the new storage.
        node.usedBytes = newSize;
      },
  node_ops:{
  getattr(node) {
          var attr = {};
          // device numbers reuse inode numbers.
          attr.dev = FS.isChrdev(node.mode) ? node.id : 1;
          attr.ino = node.id;
          attr.mode = node.mode;
          attr.nlink = 1;
          attr.uid = 0;
          attr.gid = 0;
          attr.rdev = node.rdev;
          if (FS.isDir(node.mode)) {
            attr.size = 4096;
          } else if (FS.isFile(node.mode)) {
            attr.size = node.usedBytes;
          } else if (FS.isLink(node.mode)) {
            attr.size = node.link.length;
          } else {
            attr.size = 0;
          }
          attr.atime = new Date(node.atime);
          attr.mtime = new Date(node.mtime);
          attr.ctime = new Date(node.ctime);
          // NOTE: In our implementation, st_blocks = Math.ceil(st_size/st_blksize),
          //       but this is not required by the standard.
          attr.blksize = 4096;
          attr.blocks = Math.ceil(attr.size / attr.blksize);
          return attr;
        },
  setattr(node, attr) {
          for (const key of ["mode", "atime", "mtime", "ctime"]) {
            if (attr[key] != null) {
              node[key] = attr[key];
            }
          }
          if (attr.size !== undefined) {
            MEMFS.resizeFileStorage(node, attr.size);
          }
        },
  lookup(parent, name) {
          throw new FS.ErrnoError(44);
        },
  mknod(parent, name, mode, dev) {
          return MEMFS.createNode(parent, name, mode, dev);
        },
  rename(old_node, new_dir, new_name) {
          var new_node;
          try {
            new_node = FS.lookupNode(new_dir, new_name);
          } catch (e) {}
          if (new_node) {
            if (FS.isDir(old_node.mode)) {
              // if we're overwriting a directory at new_name, make sure it's empty.
              for (var i in new_node.contents) {
                throw new FS.ErrnoError(55);
              }
            }
            FS.hashRemoveNode(new_node);
          }
          // do the internal rewiring
          delete old_node.parent.contents[old_node.name];
          new_dir.contents[new_name] = old_node;
          old_node.name = new_name;
          new_dir.ctime = new_dir.mtime = old_node.parent.ctime = old_node.parent.mtime = Date.now();
        },
  unlink(parent, name) {
          delete parent.contents[name];
          parent.ctime = parent.mtime = Date.now();
        },
  rmdir(parent, name) {
          var node = FS.lookupNode(parent, name);
          for (var i in node.contents) {
            throw new FS.ErrnoError(55);
          }
          delete parent.contents[name];
          parent.ctime = parent.mtime = Date.now();
        },
  readdir(node) {
          return ['.', '..', ...Object.keys(node.contents)];
        },
  symlink(parent, newname, oldpath) {
          var node = MEMFS.createNode(parent, newname, 0o777 | 40960, 0);
          node.link = oldpath;
          return node;
        },
  readlink(node) {
          if (!FS.isLink(node.mode)) {
            throw new FS.ErrnoError(28);
          }
          return node.link;
        },
  },
  stream_ops:{
  read(stream, buffer, offset, length, position) {
          var contents = stream.node.contents;
          if (position >= stream.node.usedBytes) return 0;
          var size = Math.min(stream.node.usedBytes - position, length);
          assert(size >= 0);
          buffer.set(contents.subarray(position, position + size), offset);
          return size;
        },
  write(stream, buffer, offset, length, position, canOwn) {
          assert(buffer.subarray, 'FS.write expects a TypedArray');
          // If the buffer is located in main memory (HEAP), and if
          // memory can grow, we can't hold on to references of the
          // memory buffer, as they may get invalidated. That means we
          // need to copy its contents.
          if (buffer.buffer === HEAP8.buffer) {
            canOwn = false;
          }
  
          if (!length) return 0;
          var node = stream.node;
          node.mtime = node.ctime = Date.now();
  
          if (canOwn) {
            assert(position === 0, 'canOwn must imply no weird position inside the file');
            node.contents = buffer.subarray(offset, offset + length);
            node.usedBytes = length;
          } else if (node.usedBytes === 0 && position === 0) { // If this is a simple first write to an empty file, do a fast set since we don't need to care about old data.
            node.contents = buffer.slice(offset, offset + length);
            node.usedBytes = length;
          } else {
            MEMFS.expandFileStorage(node, position+length);
            // Use typed array write which is available.
            node.contents.set(buffer.subarray(offset, offset + length), position);
            node.usedBytes = Math.max(node.usedBytes, position + length);
          }
          return length;
        },
  llseek(stream, offset, whence) {
          var position = offset;
          if (whence === 1) {
            position += stream.position;
          } else if (whence === 2) {
            if (FS.isFile(stream.node.mode)) {
              position += stream.node.usedBytes;
            }
          }
          if (position < 0) {
            throw new FS.ErrnoError(28);
          }
          return position;
        },
  mmap(stream, length, position, prot, flags) {
          if (!FS.isFile(stream.node.mode)) {
            throw new FS.ErrnoError(43);
          }
          var ptr;
          var allocated;
          var contents = stream.node.contents;
          // Only make a new copy when MAP_PRIVATE is specified.
          if (!(flags & 2) && contents.buffer === HEAP8.buffer) {
            // We can't emulate MAP_SHARED when the file is not backed by the
            // buffer we're mapping to (e.g. the HEAP buffer).
            allocated = false;
            ptr = contents.byteOffset;
          } else {
            allocated = true;
            ptr = mmapAlloc(length);
            if (!ptr) {
              throw new FS.ErrnoError(48);
            }
            if (contents) {
              // Try to avoid unnecessary slices.
              if (position > 0 || position + length < contents.length) {
                if (contents.subarray) {
                  contents = contents.subarray(position, position + length);
                } else {
                  contents = Array.prototype.slice.call(contents, position, position + length);
                }
              }
              HEAP8.set(contents, ptr);
            }
          }
          return { ptr, allocated };
        },
  msync(stream, buffer, offset, length, mmapFlags) {
          MEMFS.stream_ops.write(stream, buffer, 0, length, offset, false);
          // should we check if bytesWritten and length are the same?
          return 0;
        },
  },
  };
  
  var FS_modeStringToFlags = (str) => {
      if (typeof str != 'string') return str;
      var flagModes = {
        'r': 0,
        'r+': 2,
        'w': 512 | 64 | 1,
        'w+': 512 | 64 | 2,
        'a': 1024 | 64 | 1,
        'a+': 1024 | 64 | 2,
      };
      var flags = flagModes[str];
      if (typeof flags == 'undefined') {
        throw new Error(`Unknown file open mode: ${str}`);
      }
      return flags;
    };
  
  var FS_fileDataToTypedArray = (data) => {
      if (typeof data == 'string') {
        data = intArrayFromString(data, true);
      }
      if (!data.subarray) {
        data = new Uint8Array(data);
      }
      return data;
    };
  
  var FS_getMode = (canRead, canWrite) => {
      var mode = 0;
      if (canRead) mode |= 292 | 73;
      if (canWrite) mode |= 146;
      return mode;
    };
  
  
  
  
    /**
   * Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the
   * emscripten HEAP, returns a copy of that string as a Javascript String object.
   *
   * @param {number} ptr
   * @param {number=} maxBytesToRead - An optional length that specifies the
   *   maximum number of bytes to read. You can omit this parameter to scan the
   *   string until the first 0 byte. If maxBytesToRead is passed, and the string
   *   at [ptr, ptr+maxBytesToReadr[ contains a null byte in the middle, then the
   *   string will cut short at that byte index.
   * @param {boolean=} ignoreNul - If true, the function will not stop on a NUL character.
   * @return {string}
   */
  var UTF8ToString = (ptr, maxBytesToRead, ignoreNul) => {
      assert(typeof ptr == 'number', `UTF8ToString expects a number (got ${typeof ptr})`);
      return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead, ignoreNul) : '';
    };
  
  var strError = (errno) => UTF8ToString(_strerror(errno));
  
  var ERRNO_CODES = {
      'EPERM': 63,
      'ENOENT': 44,
      'ESRCH': 71,
      'EINTR': 27,
      'EIO': 29,
      'ENXIO': 60,
      'E2BIG': 1,
      'ENOEXEC': 45,
      'EBADF': 8,
      'ECHILD': 12,
      'EAGAIN': 6,
      'EWOULDBLOCK': 6,
      'ENOMEM': 48,
      'EACCES': 2,
      'EFAULT': 21,
      'ENOTBLK': 105,
      'EBUSY': 10,
      'EEXIST': 20,
      'EXDEV': 75,
      'ENODEV': 43,
      'ENOTDIR': 54,
      'EISDIR': 31,
      'EINVAL': 28,
      'ENFILE': 41,
      'EMFILE': 33,
      'ENOTTY': 59,
      'ETXTBSY': 74,
      'EFBIG': 22,
      'ENOSPC': 51,
      'ESPIPE': 70,
      'EROFS': 69,
      'EMLINK': 34,
      'EPIPE': 64,
      'EDOM': 18,
      'ERANGE': 68,
      'ENOMSG': 49,
      'EIDRM': 24,
      'ECHRNG': 106,
      'EL2NSYNC': 156,
      'EL3HLT': 107,
      'EL3RST': 108,
      'ELNRNG': 109,
      'EUNATCH': 110,
      'ENOCSI': 111,
      'EL2HLT': 112,
      'EDEADLK': 16,
      'ENOLCK': 46,
      'EBADE': 113,
      'EBADR': 114,
      'EXFULL': 115,
      'ENOANO': 104,
      'EBADRQC': 103,
      'EBADSLT': 102,
      'EDEADLOCK': 16,
      'EBFONT': 101,
      'ENOSTR': 100,
      'ENODATA': 116,
      'ETIME': 117,
      'ENOSR': 118,
      'ENONET': 119,
      'ENOPKG': 120,
      'EREMOTE': 121,
      'ENOLINK': 47,
      'EADV': 122,
      'ESRMNT': 123,
      'ECOMM': 124,
      'EPROTO': 65,
      'EMULTIHOP': 36,
      'EDOTDOT': 125,
      'EBADMSG': 9,
      'ENOTUNIQ': 126,
      'EBADFD': 127,
      'EREMCHG': 128,
      'ELIBACC': 129,
      'ELIBBAD': 130,
      'ELIBSCN': 131,
      'ELIBMAX': 132,
      'ELIBEXEC': 133,
      'ENOSYS': 52,
      'ENOTEMPTY': 55,
      'ENAMETOOLONG': 37,
      'ELOOP': 32,
      'EOPNOTSUPP': 138,
      'EPFNOSUPPORT': 139,
      'ECONNRESET': 15,
      'ENOBUFS': 42,
      'EAFNOSUPPORT': 5,
      'EPROTOTYPE': 67,
      'ENOTSOCK': 57,
      'ENOPROTOOPT': 50,
      'ESHUTDOWN': 140,
      'ECONNREFUSED': 14,
      'EADDRINUSE': 3,
      'ECONNABORTED': 13,
      'ENETUNREACH': 40,
      'ENETDOWN': 38,
      'ETIMEDOUT': 73,
      'EHOSTDOWN': 142,
      'EHOSTUNREACH': 23,
      'EINPROGRESS': 26,
      'EALREADY': 7,
      'EDESTADDRREQ': 17,
      'EMSGSIZE': 35,
      'EPROTONOSUPPORT': 66,
      'ESOCKTNOSUPPORT': 137,
      'EADDRNOTAVAIL': 4,
      'ENETRESET': 39,
      'EISCONN': 30,
      'ENOTCONN': 53,
      'ETOOMANYREFS': 141,
      'EUSERS': 136,
      'EDQUOT': 19,
      'ESTALE': 72,
      'ENOTSUP': 138,
      'ENOMEDIUM': 148,
      'EILSEQ': 25,
      'EOVERFLOW': 61,
      'ECANCELED': 11,
      'ENOTRECOVERABLE': 56,
      'EOWNERDEAD': 62,
      'ESTRPIPE': 135,
    };
  
  var asyncLoad = async (url) => {
      var arrayBuffer = await readAsync(url);
      assert(arrayBuffer, `Loading data file "${url}" failed (no arrayBuffer).`);
      return new Uint8Array(arrayBuffer);
    };
  
  
  var FS_createDataFile = (...args) => FS.createDataFile(...args);
  
  var getUniqueRunDependency = (id) => {
      var orig = id;
      while (1) {
        if (!runDependencyTracking[id]) return id;
        id = orig + Math.random();
      }
    };
  
  
  
  var preloadPlugins = [];
  var FS_handledByPreloadPlugin = async (byteArray, fullname) => {
      // Ensure plugins are ready.
      if (typeof Browser != 'undefined') Browser.init();
  
      for (var plugin of preloadPlugins) {
        if (plugin['canHandle'](fullname)) {
          assert(plugin['handle'].constructor.name === 'AsyncFunction', 'Filesystem plugin handlers must be async functions (See #24914)')
          return plugin['handle'](byteArray, fullname);
        }
      }
      // If no plugin handled this file then return the original/unmodified
      // byteArray.
      return byteArray;
    };
  var FS_preloadFile = async (parent, name, url, canRead, canWrite, dontCreateFile, canOwn, preFinish) => {
      // TODO we should allow people to just pass in a complete filename instead
      // of parent and name being that we just join them anyways
      var fullname = name ? PATH_FS.resolve(PATH.join2(parent, name)) : parent;
      var dep = getUniqueRunDependency(`cp ${fullname}`); // might have several active requests for the same fullname
      addRunDependency(dep);
  
      try {
        var byteArray = url;
        if (typeof url == 'string') {
          byteArray = await asyncLoad(url);
        }
  
        byteArray = await FS_handledByPreloadPlugin(byteArray, fullname);
        preFinish?.();
        if (!dontCreateFile) {
          FS_createDataFile(parent, name, byteArray, canRead, canWrite, canOwn);
        }
      } finally {
        removeRunDependency(dep);
      }
    };
  var FS_createPreloadedFile = (parent, name, url, canRead, canWrite, onload, onerror, dontCreateFile, canOwn, preFinish) => {
      FS_preloadFile(parent, name, url, canRead, canWrite, dontCreateFile, canOwn, preFinish).then(onload).catch(onerror);
    };
  var FS = {
  root:null,
  mounts:[],
  devices:{
  },
  streams:[],
  nextInode:1,
  nameTable:null,
  currentPath:"/",
  initialized:false,
  ignorePermissions:true,
  filesystems:null,
  syncFSRequests:0,
  ErrnoError:class extends Error {
        name = 'ErrnoError';
        // We set the `name` property to be able to identify `FS.ErrnoError`
        // - the `name` is a standard ECMA-262 property of error objects. Kind of good to have it anyway.
        // - when using PROXYFS, an error can come from an underlying FS
        // as different FS objects have their own FS.ErrnoError each,
        // the test `err instanceof FS.ErrnoError` won't detect an error coming from another filesystem, causing bugs.
        // we'll use the reliable test `err.name == "ErrnoError"` instead
        constructor(errno) {
          super(runtimeInitialized ? strError(errno) : '');
          this.errno = errno;
          for (var key in ERRNO_CODES) {
            if (ERRNO_CODES[key] === errno) {
              this.code = key;
              break;
            }
          }
        }
      },
  FSStream:class {
        shared = {};
        get object() {
          return this.node;
        }
        set object(val) {
          this.node = val;
        }
        get isRead() {
          return (this.flags & 2097155) !== 1;
        }
        get isWrite() {
          return (this.flags & 2097155) !== 0;
        }
        get isAppend() {
          return (this.flags & 1024);
        }
        get flags() {
          return this.shared.flags;
        }
        set flags(val) {
          this.shared.flags = val;
        }
        get position() {
          return this.shared.position;
        }
        set position(val) {
          this.shared.position = val;
        }
      },
  FSNode:class {
        node_ops = {};
        stream_ops = {};
        readMode = 292 | 73;
        writeMode = 146;
        mounted = null;
        constructor(parent, name, mode, rdev) {
          if (!parent) {
            parent = this;  // root node sets parent to itself
          }
          this.parent = parent;
          this.mount = parent.mount;
          this.id = FS.nextInode++;
          this.name = name;
          this.mode = mode;
          this.rdev = rdev;
          this.atime = this.mtime = this.ctime = Date.now();
        }
        get read() {
          return (this.mode & this.readMode) === this.readMode;
        }
        set read(val) {
          val ? this.mode |= this.readMode : this.mode &= ~this.readMode;
        }
        get write() {
          return (this.mode & this.writeMode) === this.writeMode;
        }
        set write(val) {
          val ? this.mode |= this.writeMode : this.mode &= ~this.writeMode;
        }
        get isFolder() {
          return FS.isDir(this.mode);
        }
        get isDevice() {
          return FS.isChrdev(this.mode);
        }
      },
  lookupPath(path, opts = {}) {
        if (!path) {
          throw new FS.ErrnoError(44);
        }
        opts.follow_mount ??= true
  
        if (!PATH.isAbs(path)) {
          path = FS.cwd() + '/' + path;
        }
  
        // limit max consecutive symlinks to SYMLOOP_MAX.
        linkloop: for (var nlinks = 0; nlinks < 40; nlinks++) {
          // split the absolute path
          var parts = path.split('/').filter((p) => !!p);
  
          // start at the root
          var current = FS.root;
          var current_path = '/';
  
          for (var i = 0; i < parts.length; i++) {
            var islast = (i === parts.length-1);
            if (islast && opts.parent) {
              // stop resolving
              break;
            }
  
            if (parts[i] === '.') {
              continue;
            }
  
            if (parts[i] === '..') {
              current_path = PATH.dirname(current_path);
              if (FS.isRoot(current)) {
                path = current_path + '/' + parts.slice(i + 1).join('/');
                // We're making progress here, don't let many consecutive ..'s
                // lead to ELOOP
                nlinks--;
                continue linkloop;
              } else {
                current = current.parent;
              }
              continue;
            }
  
            current_path = PATH.join2(current_path, parts[i]);
            try {
              current = FS.lookupNode(current, parts[i]);
            } catch (e) {
              // if noent_okay is true, suppress a ENOENT in the last component
              // and return an object with an undefined node. This is needed for
              // resolving symlinks in the path when creating a file.
              if ((e?.errno === 44) && islast && opts.noent_okay) {
                return { path: current_path };
              }
              throw e;
            }
  
            // jump to the mount's root node if this is a mountpoint
            if (FS.isMountpoint(current) && (!islast || opts.follow_mount)) {
              current = current.mounted.root;
            }
  
            // by default, lookupPath will not follow a symlink if it is the final path component.
            // setting opts.follow = true will override this behavior.
            if (FS.isLink(current.mode) && (!islast || opts.follow)) {
              if (!current.node_ops.readlink) {
                throw new FS.ErrnoError(52);
              }
              var link = current.node_ops.readlink(current);
              if (!PATH.isAbs(link)) {
                link = PATH.dirname(current_path) + '/' + link;
              }
              path = link + '/' + parts.slice(i + 1).join('/');
              continue linkloop;
            }
          }
          return { path: current_path, node: current };
        }
        throw new FS.ErrnoError(32);
      },
  getPath(node) {
        var path;
        while (true) {
          if (FS.isRoot(node)) {
            var mount = node.mount.mountpoint;
            if (!path) return mount;
            return mount[mount.length-1] !== '/' ? `${mount}/${path}` : mount + path;
          }
          path = path ? `${node.name}/${path}` : node.name;
          node = node.parent;
        }
      },
  hashName(parentid, name) {
        var hash = 0;
  
        for (var i = 0; i < name.length; i++) {
          hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
        }
        return ((parentid + hash) >>> 0) % FS.nameTable.length;
      },
  hashAddNode(node) {
        var hash = FS.hashName(node.parent.id, node.name);
        node.name_next = FS.nameTable[hash];
        FS.nameTable[hash] = node;
      },
  hashRemoveNode(node) {
        var hash = FS.hashName(node.parent.id, node.name);
        if (FS.nameTable[hash] === node) {
          FS.nameTable[hash] = node.name_next;
        } else {
          var current = FS.nameTable[hash];
          while (current) {
            if (current.name_next === node) {
              current.name_next = node.name_next;
              break;
            }
            current = current.name_next;
          }
        }
      },
  lookupNode(parent, name) {
        var errCode = FS.mayLookup(parent);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        var hash = FS.hashName(parent.id, name);
        for (var node = FS.nameTable[hash]; node; node = node.name_next) {
          var nodeName = node.name;
          if (node.parent.id === parent.id && nodeName === name) {
            return node;
          }
        }
        // if we failed to find it in the cache, call into the VFS
        return FS.lookup(parent, name);
      },
  createNode(parent, name, mode, rdev) {
        assert(typeof parent == 'object')
        var node = new FS.FSNode(parent, name, mode, rdev);
  
        FS.hashAddNode(node);
  
        return node;
      },
  destroyNode(node) {
        FS.hashRemoveNode(node);
      },
  isRoot(node) {
        return node === node.parent;
      },
  isMountpoint(node) {
        return !!node.mounted;
      },
  isFile(mode) {
        return (mode & 61440) === 32768;
      },
  isDir(mode) {
        return (mode & 61440) === 16384;
      },
  isLink(mode) {
        return (mode & 61440) === 40960;
      },
  isChrdev(mode) {
        return (mode & 61440) === 8192;
      },
  isBlkdev(mode) {
        return (mode & 61440) === 24576;
      },
  isFIFO(mode) {
        return (mode & 61440) === 4096;
      },
  isSocket(mode) {
        return (mode & 49152) === 49152;
      },
  flagsToPermissionString(flag) {
        var perms = ['r', 'w', 'rw'][flag & 3];
        if ((flag & 512)) {
          perms += 'w';
        }
        return perms;
      },
  nodePermissions(node, perms) {
        if (FS.ignorePermissions) {
          return 0;
        }
        // return 0 if any user, group or owner bits are set.
        if (perms.includes('r') && !(node.mode & 292)) {
          return 2;
        }
        if (perms.includes('w') && !(node.mode & 146)) {
          return 2;
        }
        if (perms.includes('x') && !(node.mode & 73)) {
          return 2;
        }
        return 0;
      },
  mayLookup(dir) {
        if (!FS.isDir(dir.mode)) return 54;
        var errCode = FS.nodePermissions(dir, 'x');
        if (errCode) return errCode;
        if (!dir.node_ops.lookup) return 2;
        return 0;
      },
  mayCreate(dir, name) {
        if (!FS.isDir(dir.mode)) {
          return 54;
        }
        try {
          var node = FS.lookupNode(dir, name);
          return 20;
        } catch (e) {
        }
        return FS.nodePermissions(dir, 'wx');
      },
  mayDelete(dir, name, isdir) {
        var node;
        try {
          node = FS.lookupNode(dir, name);
        } catch (e) {
          return e.errno;
        }
        var errCode = FS.nodePermissions(dir, 'wx');
        if (errCode) {
          return errCode;
        }
        if (isdir) {
          if (!FS.isDir(node.mode)) {
            return 54;
          }
          if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
            return 10;
          }
        } else if (FS.isDir(node.mode)) {
          return 31;
        }
        return 0;
      },
  mayOpen(node, flags) {
        if (!node) {
          return 44;
        }
        if (FS.isLink(node.mode)) {
          return 32;
        }
        var mode = FS.flagsToPermissionString(flags);
        if (FS.isDir(node.mode)) {
          // opening for write
          // TODO: check for O_SEARCH? (== search for dir only)
          if (mode !== 'r' || (flags & (512 | 64))) {
            return 31;
          }
        }
        return FS.nodePermissions(node, mode);
      },
  checkOpExists(op, err) {
        if (!op) {
          throw new FS.ErrnoError(err);
        }
        return op;
      },
  MAX_OPEN_FDS:4096,
  nextfd() {
        for (var fd = 0; fd <= FS.MAX_OPEN_FDS; fd++) {
          if (!FS.streams[fd]) {
            return fd;
          }
        }
        throw new FS.ErrnoError(33);
      },
  getStreamChecked(fd) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(8);
        }
        return stream;
      },
  getStream:(fd) => FS.streams[fd],
  createStream(stream, fd = -1) {
        assert(fd >= -1);
  
        // clone it, so we can return an instance of FSStream
        stream = Object.assign(new FS.FSStream(), stream);
        if (fd == -1) {
          fd = FS.nextfd();
        }
        stream.fd = fd;
        FS.streams[fd] = stream;
        return stream;
      },
  closeStream(fd) {
        FS.streams[fd] = null;
      },
  dupStream(origStream, fd = -1) {
        var stream = FS.createStream(origStream, fd);
        stream.stream_ops?.dup?.(stream);
        return stream;
      },
  doSetAttr(stream, node, attr) {
        var setattr = stream?.stream_ops.setattr;
        var arg = setattr ? stream : node;
        setattr ??= node.node_ops.setattr;
        FS.checkOpExists(setattr, 63)
        try {
          setattr(arg, attr);
        } catch (e) {
          if (e instanceof RangeError) {
            throw new FS.ErrnoError(22);
          }
          throw e;
        }
      },
  chrdev_stream_ops:{
  open(stream) {
          var device = FS.getDevice(stream.node.rdev);
          // override node's stream ops with the device's
          stream.stream_ops = device.stream_ops;
          // forward the open call
          stream.stream_ops.open?.(stream);
        },
  llseek() {
          throw new FS.ErrnoError(70);
        },
  },
  major:(dev) => ((dev) >> 8),
  minor:(dev) => ((dev) & 0xff),
  makedev:(ma, mi) => ((ma) << 8 | (mi)),
  registerDevice(dev, ops) {
        FS.devices[dev] = { stream_ops: ops };
      },
  getDevice:(dev) => FS.devices[dev],
  getMounts(mount) {
        var mounts = [];
        var check = [mount];
  
        while (check.length) {
          var m = check.pop();
  
          mounts.push(m);
  
          check.push(...m.mounts);
        }
  
        return mounts;
      },
  syncfs(populate, callback) {
        if (typeof populate == 'function') {
          callback = populate;
          populate = false;
        }
  
        FS.syncFSRequests++;
  
        if (FS.syncFSRequests > 1) {
          err(`warning: ${FS.syncFSRequests} FS.syncfs operations in flight at once, probably just doing extra work`);
        }
  
        var mounts = FS.getMounts(FS.root.mount);
        var completed = 0;
  
        function doCallback(errCode) {
          assert(FS.syncFSRequests > 0);
          FS.syncFSRequests--;
          return callback(errCode);
        }
  
        function done(errCode) {
          if (errCode) {
            if (!done.errored) {
              done.errored = true;
              return doCallback(errCode);
            }
            return;
          }
          if (++completed >= mounts.length) {
            doCallback(null);
          }
        };
  
        // sync all mounts
        for (var mount of mounts) {
          if (mount.type.syncfs) {
            mount.type.syncfs(mount, populate, done);
          } else {
            done(null);
          }
        }
      },
  mount(type, opts, mountpoint) {
        if (typeof type == 'string') {
          // The filesystem was not included, and instead we have an error
          // message stored in the variable.
          throw type;
        }
        var root = mountpoint === '/';
        var pseudo = !mountpoint;
        var node;
  
        if (root && FS.root) {
          throw new FS.ErrnoError(10);
        } else if (!root && !pseudo) {
          var lookup = FS.lookupPath(mountpoint, { follow_mount: false });
  
          mountpoint = lookup.path;  // use the absolute path
          node = lookup.node;
  
          if (FS.isMountpoint(node)) {
            throw new FS.ErrnoError(10);
          }
  
          if (!FS.isDir(node.mode)) {
            throw new FS.ErrnoError(54);
          }
        }
  
        var mount = {
          type,
          opts,
          mountpoint,
          mounts: []
        };
  
        // create a root node for the fs
        var mountRoot = type.mount(mount);
        mountRoot.mount = mount;
        mount.root = mountRoot;
  
        if (root) {
          FS.root = mountRoot;
        } else if (node) {
          // set as a mountpoint
          node.mounted = mount;
  
          // add the new mount to the current mount's children
          if (node.mount) {
            node.mount.mounts.push(mount);
          }
        }
  
        return mountRoot;
      },
  unmount(mountpoint) {
        var lookup = FS.lookupPath(mountpoint, { follow_mount: false });
  
        if (!FS.isMountpoint(lookup.node)) {
          throw new FS.ErrnoError(28);
        }
  
        // destroy the nodes for this mount, and all its child mounts
        var node = lookup.node;
        var mount = node.mounted;
        var mounts = FS.getMounts(mount);
  
        for (var [hash, current] of Object.entries(FS.nameTable)) {
          while (current) {
            var next = current.name_next;
  
            if (mounts.includes(current.mount)) {
              FS.destroyNode(current);
            }
  
            current = next;
          }
        }
  
        // no longer a mountpoint
        node.mounted = null;
  
        // remove this mount from the child mounts
        var idx = node.mount.mounts.indexOf(mount);
        assert(idx !== -1);
        node.mount.mounts.splice(idx, 1);
      },
  lookup(parent, name) {
        return parent.node_ops.lookup(parent, name);
      },
  mknod(path, mode, dev) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        if (!name) {
          throw new FS.ErrnoError(28);
        }
        if (name === '.' || name === '..') {
          throw new FS.ErrnoError(20);
        }
        var errCode = FS.mayCreate(parent, name);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        if (!parent.node_ops.mknod) {
          throw new FS.ErrnoError(63);
        }
        return parent.node_ops.mknod(parent, name, mode, dev);
      },
  statfs(path) {
        return FS.statfsNode(FS.lookupPath(path, {follow: true}).node);
      },
  statfsStream(stream) {
        // We keep a separate statfsStream function because noderawfs overrides
        // it. In noderawfs, stream.node is sometimes null. Instead, we need to
        // look at stream.path.
        return FS.statfsNode(stream.node);
      },
  statfsNode(node) {
        // NOTE: None of the defaults here are true. We're just returning safe and
        //       sane values. Currently nodefs and rawfs replace these defaults,
        //       other file systems leave them alone.
        var rtn = {
          bsize: 4096,
          frsize: 4096,
          blocks: 1e6,
          bfree: 5e5,
          bavail: 5e5,
          files: FS.nextInode,
          ffree: FS.nextInode - 1,
          fsid: 42,
          flags: 2,
          namelen: 255,
        };
  
        if (node.node_ops.statfs) {
          Object.assign(rtn, node.node_ops.statfs(node.mount.opts.root));
        }
        return rtn;
      },
  create(path, mode = 0o666) {
        mode &= 4095;
        mode |= 32768;
        return FS.mknod(path, mode, 0);
      },
  mkdir(path, mode = 0o777) {
        mode &= 511 | 512;
        mode |= 16384;
        return FS.mknod(path, mode, 0);
      },
  mkdirTree(path, mode) {
        var dirs = path.split('/');
        var d = '';
        for (var dir of dirs) {
          if (!dir) continue;
          if (d || PATH.isAbs(path)) d += '/';
          d += dir;
          try {
            FS.mkdir(d, mode);
          } catch(e) {
            if (e.errno != 20) throw e;
          }
        }
      },
  mkdev(path, mode, dev) {
        if (typeof dev == 'undefined') {
          dev = mode;
          mode = 0o666;
        }
        mode |= 8192;
        return FS.mknod(path, mode, dev);
      },
  symlink(oldpath, newpath) {
        if (!PATH_FS.resolve(oldpath)) {
          throw new FS.ErrnoError(44);
        }
        var lookup = FS.lookupPath(newpath, { parent: true });
        var parent = lookup.node;
        if (!parent) {
          throw new FS.ErrnoError(44);
        }
        var newname = PATH.basename(newpath);
        var errCode = FS.mayCreate(parent, newname);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        if (!parent.node_ops.symlink) {
          throw new FS.ErrnoError(63);
        }
        return parent.node_ops.symlink(parent, newname, oldpath);
      },
  rename(old_path, new_path) {
        var old_dirname = PATH.dirname(old_path);
        var new_dirname = PATH.dirname(new_path);
        var old_name = PATH.basename(old_path);
        var new_name = PATH.basename(new_path);
        // parents must exist
        var lookup, old_dir, new_dir;
  
        // let the errors from non existent directories percolate up
        lookup = FS.lookupPath(old_path, { parent: true });
        old_dir = lookup.node;
        lookup = FS.lookupPath(new_path, { parent: true });
        new_dir = lookup.node;
  
        if (!old_dir || !new_dir) throw new FS.ErrnoError(44);
        // need to be part of the same mount
        if (old_dir.mount !== new_dir.mount) {
          throw new FS.ErrnoError(75);
        }
        // source must exist
        var old_node = FS.lookupNode(old_dir, old_name);
        // old path should not be an ancestor of the new path
        var relative = PATH_FS.relative(old_path, new_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(28);
        }
        // new path should not be an ancestor of the old path
        relative = PATH_FS.relative(new_path, old_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(55);
        }
        // see if the new path already exists
        var new_node;
        try {
          new_node = FS.lookupNode(new_dir, new_name);
        } catch (e) {
          // not fatal
        }
        // early out if nothing needs to change
        if (old_node === new_node) {
          return;
        }
        // we'll need to delete the old entry
        var isdir = FS.isDir(old_node.mode);
        var errCode = FS.mayDelete(old_dir, old_name, isdir);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        // need delete permissions if we'll be overwriting.
        // need create permissions if new doesn't already exist.
        errCode = new_node ?
          FS.mayDelete(new_dir, new_name, isdir) :
          FS.mayCreate(new_dir, new_name);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        if (!old_dir.node_ops.rename) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isMountpoint(old_node) || (new_node && FS.isMountpoint(new_node))) {
          throw new FS.ErrnoError(10);
        }
        // if we are going to change the parent, check write permissions
        if (new_dir !== old_dir) {
          errCode = FS.nodePermissions(old_dir, 'w');
          if (errCode) {
            throw new FS.ErrnoError(errCode);
          }
        }
        // remove the node from the lookup hash
        FS.hashRemoveNode(old_node);
        // do the underlying fs rename
        try {
          old_dir.node_ops.rename(old_node, new_dir, new_name);
          // update old node (we do this here to avoid each backend
          // needing to)
          old_node.parent = new_dir;
        } catch (e) {
          throw e;
        } finally {
          // add the node back to the hash (in case node_ops.rename
          // changed its name)
          FS.hashAddNode(old_node);
        }
      },
  rmdir(path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var errCode = FS.mayDelete(parent, name, true);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        if (!parent.node_ops.rmdir) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(10);
        }
        parent.node_ops.rmdir(parent, name);
        FS.destroyNode(node);
      },
  readdir(path) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        var readdir = FS.checkOpExists(node.node_ops.readdir, 54);
        return readdir(node);
      },
  unlink(path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        if (!parent) {
          throw new FS.ErrnoError(44);
        }
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var errCode = FS.mayDelete(parent, name, false);
        if (errCode) {
          // According to POSIX, we should map EISDIR to EPERM, but
          // we instead do what Linux does (and we must, as we use
          // the musl linux libc).
          throw new FS.ErrnoError(errCode);
        }
        if (!parent.node_ops.unlink) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(10);
        }
        parent.node_ops.unlink(parent, name);
        FS.destroyNode(node);
      },
  readlink(path) {
        var lookup = FS.lookupPath(path);
        var link = lookup.node;
        if (!link) {
          throw new FS.ErrnoError(44);
        }
        if (!link.node_ops.readlink) {
          throw new FS.ErrnoError(28);
        }
        return link.node_ops.readlink(link);
      },
  stat(path, dontFollow) {
        var lookup = FS.lookupPath(path, { follow: !dontFollow });
        var node = lookup.node;
        var getattr = FS.checkOpExists(node.node_ops.getattr, 63);
        return getattr(node);
      },
  fstat(fd) {
        var stream = FS.getStreamChecked(fd);
        var node = stream.node;
        var getattr = stream.stream_ops.getattr;
        var arg = getattr ? stream : node;
        getattr ??= node.node_ops.getattr;
        FS.checkOpExists(getattr, 63)
        return getattr(arg);
      },
  lstat(path) {
        return FS.stat(path, true);
      },
  doChmod(stream, node, mode, dontFollow) {
        FS.doSetAttr(stream, node, {
          mode: (mode & 4095) | (node.mode & ~4095),
          ctime: Date.now(),
          dontFollow
        });
      },
  chmod(path, mode, dontFollow) {
        var node;
        if (typeof path == 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        FS.doChmod(null, node, mode, dontFollow);
      },
  lchmod(path, mode) {
        FS.chmod(path, mode, true);
      },
  fchmod(fd, mode) {
        var stream = FS.getStreamChecked(fd);
        FS.doChmod(stream, stream.node, mode, false);
      },
  doChown(stream, node, dontFollow) {
        FS.doSetAttr(stream, node, {
          timestamp: Date.now(),
          dontFollow
          // we ignore the uid / gid for now
        });
      },
  chown(path, uid, gid, dontFollow) {
        var node;
        if (typeof path == 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        FS.doChown(null, node, dontFollow);
      },
  lchown(path, uid, gid) {
        FS.chown(path, uid, gid, true);
      },
  fchown(fd, uid, gid) {
        var stream = FS.getStreamChecked(fd);
        FS.doChown(stream, stream.node, false);
      },
  doTruncate(stream, node, len) {
        if (FS.isDir(node.mode)) {
          throw new FS.ErrnoError(31);
        }
        if (!FS.isFile(node.mode)) {
          throw new FS.ErrnoError(28);
        }
        var errCode = FS.nodePermissions(node, 'w');
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        FS.doSetAttr(stream, node, {
          size: len,
          timestamp: Date.now()
        });
      },
  truncate(path, len) {
        if (len < 0) {
          throw new FS.ErrnoError(28);
        }
        var node;
        if (typeof path == 'string') {
          var lookup = FS.lookupPath(path, { follow: true });
          node = lookup.node;
        } else {
          node = path;
        }
        FS.doTruncate(null, node, len);
      },
  ftruncate(fd, len) {
        var stream = FS.getStreamChecked(fd);
        if (len < 0 || (stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(28);
        }
        FS.doTruncate(stream, stream.node, len);
      },
  utime(path, atime, mtime) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        var setattr = FS.checkOpExists(node.node_ops.setattr, 63);
        setattr(node, {
          atime: atime,
          mtime: mtime
        });
      },
  open(path, flags, mode = 0o666) {
        if (path === "") {
          throw new FS.ErrnoError(44);
        }
        flags = FS_modeStringToFlags(flags);
        if ((flags & 64)) {
          mode = (mode & 4095) | 32768;
        } else {
          mode = 0;
        }
        var node;
        var isDirPath;
        if (typeof path == 'object') {
          node = path;
        } else {
          isDirPath = path.endsWith("/");
          // noent_okay makes it so that if the final component of the path
          // doesn't exist, lookupPath returns `node: undefined`. `path` will be
          // updated to point to the target of all symlinks.
          var lookup = FS.lookupPath(path, {
            follow: !(flags & 131072),
            noent_okay: true
          });
          node = lookup.node;
          path = lookup.path;
        }
        // perhaps we need to create the node
        var created = false;
        if ((flags & 64)) {
          if (node) {
            // if O_CREAT and O_EXCL are set, error out if the node already exists
            if ((flags & 128)) {
              throw new FS.ErrnoError(20);
            }
          } else if (isDirPath) {
            throw new FS.ErrnoError(31);
          } else {
            // node doesn't exist, try to create it
            // Ignore the permission bits here to ensure we can `open` this new
            // file below. We use chmod below to apply the permissions once the
            // file is open.
            node = FS.mknod(path, mode | 0o777, 0);
            created = true;
          }
        }
        if (!node) {
          throw new FS.ErrnoError(44);
        }
        // can't truncate a device
        if (FS.isChrdev(node.mode)) {
          flags &= ~512;
        }
        // if asked only for a directory, then this must be one
        if ((flags & 65536) && !FS.isDir(node.mode)) {
          throw new FS.ErrnoError(54);
        }
        // check permissions, if this is not a file we just created now (it is ok to
        // create and write to a file with read-only permissions; it is read-only
        // for later use)
        if (!created) {
          var errCode = FS.mayOpen(node, flags);
          if (errCode) {
            throw new FS.ErrnoError(errCode);
          }
        }
        // do truncation if necessary
        if ((flags & 512) && !created) {
          FS.truncate(node, 0);
        }
        // we've already handled these, don't pass down to the underlying vfs
        flags &= ~(128 | 512 | 131072);
  
        // register the stream with the filesystem
        var stream = FS.createStream({
          node,
          path: FS.getPath(node),  // we want the absolute path to the node
          flags,
          seekable: true,
          position: 0,
          stream_ops: node.stream_ops,
          // used by the file family libc calls (fopen, fwrite, ferror, etc.)
          ungotten: [],
          error: false
        });
        // call the new stream's open function
        if (stream.stream_ops.open) {
          stream.stream_ops.open(stream);
        }
        if (created) {
          FS.chmod(node, mode & 0o777);
        }
        return stream;
      },
  close(stream) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if (stream.getdents) stream.getdents = null; // free readdir state
        try {
          if (stream.stream_ops.close) {
            stream.stream_ops.close(stream);
          }
        } catch (e) {
          throw e;
        } finally {
          FS.closeStream(stream.fd);
        }
        stream.fd = null;
      },
  isClosed(stream) {
        return stream.fd === null;
      },
  llseek(stream, offset, whence) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if (!stream.seekable || !stream.stream_ops.llseek) {
          throw new FS.ErrnoError(70);
        }
        if (whence != 0 && whence != 1 && whence != 2) {
          throw new FS.ErrnoError(28);
        }
        stream.position = stream.stream_ops.llseek(stream, offset, whence);
        stream.ungotten = [];
        return stream.position;
      },
  read(stream, buffer, offset, length, position) {
        assert(offset >= 0);
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(28);
        }
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(8);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(31);
        }
        if (!stream.stream_ops.read) {
          throw new FS.ErrnoError(28);
        }
        var seeking = typeof position != 'undefined';
        if (!seeking) {
          position = stream.position;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(70);
        }
        var bytesRead = stream.stream_ops.read(stream, buffer, offset, length, position);
        if (!seeking) stream.position += bytesRead;
        return bytesRead;
      },
  write(stream, buffer, offset, length, position, canOwn) {
        assert(offset >= 0);
        assert(buffer.subarray, 'FS.write expects a TypedArray');
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(28);
        }
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(8);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(31);
        }
        if (!stream.stream_ops.write) {
          throw new FS.ErrnoError(28);
        }
        if (stream.seekable && stream.flags & 1024) {
          // seek to the end before writing in append mode
          FS.llseek(stream, 0, 2);
        }
        var seeking = typeof position != 'undefined';
        if (!seeking) {
          position = stream.position;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(70);
        }
        var bytesWritten = stream.stream_ops.write(stream, buffer, offset, length, position, canOwn);
        if (!seeking) stream.position += bytesWritten;
        return bytesWritten;
      },
  mmap(stream, length, position, prot, flags) {
        // User requests writing to file (prot & PROT_WRITE != 0).
        // Checking if we have permissions to write to the file unless
        // MAP_PRIVATE flag is set. According to POSIX spec it is possible
        // to write to file opened in read-only mode with MAP_PRIVATE flag,
        // as all modifications will be visible only in the memory of
        // the current process.
        if ((prot & 2) !== 0
            && (flags & 2) === 0
            && (stream.flags & 2097155) !== 2) {
          throw new FS.ErrnoError(2);
        }
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(2);
        }
        if (!stream.stream_ops.mmap) {
          throw new FS.ErrnoError(43);
        }
        if (!length) {
          throw new FS.ErrnoError(28);
        }
        return stream.stream_ops.mmap(stream, length, position, prot, flags);
      },
  msync(stream, buffer, offset, length, mmapFlags) {
        assert(offset >= 0);
        if (!stream.stream_ops.msync) {
          return 0;
        }
        return stream.stream_ops.msync(stream, buffer, offset, length, mmapFlags);
      },
  ioctl(stream, cmd, arg) {
        if (!stream.stream_ops.ioctl) {
          throw new FS.ErrnoError(59);
        }
        return stream.stream_ops.ioctl(stream, cmd, arg);
      },
  readFile(path, opts = {}) {
        opts.flags = opts.flags || 0;
        opts.encoding = opts.encoding || 'binary';
        if (opts.encoding !== 'utf8' && opts.encoding !== 'binary') {
          abort(`Invalid encoding type "${opts.encoding}"`);
        }
        var stream = FS.open(path, opts.flags);
        var stat = FS.stat(path);
        var length = stat.size;
        var buf = new Uint8Array(length);
        FS.read(stream, buf, 0, length, 0);
        if (opts.encoding === 'utf8') {
          buf = UTF8ArrayToString(buf);
        }
        FS.close(stream);
        return buf;
      },
  writeFile(path, data, opts = {}) {
        opts.flags = opts.flags || 577;
        var stream = FS.open(path, opts.flags, opts.mode);
        data = FS_fileDataToTypedArray(data);
        FS.write(stream, data, 0, data.byteLength, undefined, opts.canOwn);
        FS.close(stream);
      },
  cwd:() => FS.currentPath,
  chdir(path) {
        var lookup = FS.lookupPath(path, { follow: true });
        if (lookup.node === null) {
          throw new FS.ErrnoError(44);
        }
        if (!FS.isDir(lookup.node.mode)) {
          throw new FS.ErrnoError(54);
        }
        var errCode = FS.nodePermissions(lookup.node, 'x');
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        FS.currentPath = lookup.path;
      },
  createDefaultDirectories() {
        FS.mkdir('/tmp');
        FS.mkdir('/home');
        FS.mkdir('/home/web_user');
      },
  createDefaultDevices() {
        // create /dev
        FS.mkdir('/dev');
        // setup /dev/null
        FS.registerDevice(FS.makedev(1, 3), {
          read: () => 0,
          write: (stream, buffer, offset, length, pos) => length,
          llseek: () => 0,
        });
        FS.mkdev('/dev/null', FS.makedev(1, 3));
        // setup /dev/tty and /dev/tty1
        // stderr needs to print output using err() rather than out()
        // so we register a second tty just for it.
        TTY.register(FS.makedev(5, 0), TTY.default_tty_ops);
        TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops);
        FS.mkdev('/dev/tty', FS.makedev(5, 0));
        FS.mkdev('/dev/tty1', FS.makedev(6, 0));
        // setup /dev/[u]random
        // use a buffer to avoid overhead of individual crypto calls per byte
        var randomBuffer = new Uint8Array(1024), randomLeft = 0;
        var randomByte = () => {
          if (randomLeft === 0) {
            randomFill(randomBuffer);
            randomLeft = randomBuffer.byteLength;
          }
          return randomBuffer[--randomLeft];
        };
        FS.createDevice('/dev', 'random', randomByte);
        FS.createDevice('/dev', 'urandom', randomByte);
        // we're not going to emulate the actual shm device,
        // just create the tmp dirs that reside in it commonly
        FS.mkdir('/dev/shm');
        FS.mkdir('/dev/shm/tmp');
      },
  createSpecialDirectories() {
        // create /proc/self/fd which allows /proc/self/fd/6 => readlink gives the
        // name of the stream for fd 6 (see test_unistd_ttyname)
        FS.mkdir('/proc');
        var proc_self = FS.mkdir('/proc/self');
        FS.mkdir('/proc/self/fd');
        FS.mount({
          mount() {
            var node = FS.createNode(proc_self, 'fd', 16895, 73);
            node.stream_ops = {
              llseek: MEMFS.stream_ops.llseek,
            };
            node.node_ops = {
              lookup(parent, name) {
                var fd = +name;
                var stream = FS.getStreamChecked(fd);
                var ret = {
                  parent: null,
                  mount: { mountpoint: 'fake' },
                  node_ops: { readlink: () => stream.path },
                  id: fd + 1,
                };
                ret.parent = ret; // make it look like a simple root node
                return ret;
              },
              readdir() {
                return Array.from(FS.streams.entries())
                  .filter(([k, v]) => v)
                  .map(([k, v]) => k.toString());
              }
            };
            return node;
          }
        }, {}, '/proc/self/fd');
      },
  createStandardStreams(input, output, error) {
        // TODO deprecate the old functionality of a single
        // input / output callback and that utilizes FS.createDevice
        // and instead require a unique set of stream ops
  
        // by default, we symlink the standard streams to the
        // default tty devices. however, if the standard streams
        // have been overwritten we create a unique device for
        // them instead.
        if (input) {
          FS.createDevice('/dev', 'stdin', input);
        } else {
          FS.symlink('/dev/tty', '/dev/stdin');
        }
        if (output) {
          FS.createDevice('/dev', 'stdout', null, output);
        } else {
          FS.symlink('/dev/tty', '/dev/stdout');
        }
        if (error) {
          FS.createDevice('/dev', 'stderr', null, error);
        } else {
          FS.symlink('/dev/tty1', '/dev/stderr');
        }
  
        // open default streams for the stdin, stdout and stderr devices
        var stdin = FS.open('/dev/stdin', 0);
        var stdout = FS.open('/dev/stdout', 1);
        var stderr = FS.open('/dev/stderr', 1);
        assert(stdin.fd === 0, `invalid handle for stdin (${stdin.fd})`);
        assert(stdout.fd === 1, `invalid handle for stdout (${stdout.fd})`);
        assert(stderr.fd === 2, `invalid handle for stderr (${stderr.fd})`);
      },
  staticInit() {
        FS.nameTable = new Array(4096);
  
        FS.mount(MEMFS, {}, '/');
  
        FS.createDefaultDirectories();
        FS.createDefaultDevices();
        FS.createSpecialDirectories();
  
        FS.filesystems = {
          'MEMFS': MEMFS,
        };
      },
  init(input, output, error) {
        assert(!FS.initialized, 'FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)');
        FS.initialized = true;
  
        // Allow Module.stdin etc. to provide defaults, if none explicitly passed to us here
        input ??= Module['stdin'];
        output ??= Module['stdout'];
        error ??= Module['stderr'];
  
        FS.createStandardStreams(input, output, error);
      },
  quit() {
        FS.initialized = false;
        // force-flush all streams, so we get musl std streams printed out
        _fflush(0);
        // close all of our streams
        for (var stream of FS.streams) {
          if (stream) {
            FS.close(stream);
          }
        }
      },
  findObject(path, dontResolveLastLink) {
        var ret = FS.analyzePath(path, dontResolveLastLink);
        if (!ret.exists) {
          return null;
        }
        return ret.object;
      },
  analyzePath(path, dontResolveLastLink) {
        // operate from within the context of the symlink's target
        try {
          var lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          path = lookup.path;
        } catch (e) {
        }
        var ret = {
          isRoot: false, exists: false, error: 0, name: null, path: null, object: null,
          parentExists: false, parentPath: null, parentObject: null
        };
        try {
          var lookup = FS.lookupPath(path, { parent: true });
          ret.parentExists = true;
          ret.parentPath = lookup.path;
          ret.parentObject = lookup.node;
          ret.name = PATH.basename(path);
          lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          ret.exists = true;
          ret.path = lookup.path;
          ret.object = lookup.node;
          ret.name = lookup.node.name;
          ret.isRoot = lookup.path === '/';
        } catch (e) {
          ret.error = e.errno;
        };
        return ret;
      },
  createPath(parent, path, canRead, canWrite) {
        parent = typeof parent == 'string' ? parent : FS.getPath(parent);
        var parts = path.split('/').reverse();
        while (parts.length) {
          var part = parts.pop();
          if (!part) continue;
          var current = PATH.join2(parent, part);
          try {
            FS.mkdir(current);
          } catch (e) {
            if (e.errno != 20) throw e;
          }
          parent = current;
        }
        return current;
      },
  createFile(parent, name, properties, canRead, canWrite) {
        var path = PATH.join2(typeof parent == 'string' ? parent : FS.getPath(parent), name);
        var mode = FS_getMode(canRead, canWrite);
        return FS.create(path, mode);
      },
  createDataFile(parent, name, data, canRead, canWrite, canOwn) {
        var path = name;
        if (parent) {
          parent = typeof parent == 'string' ? parent : FS.getPath(parent);
          path = name ? PATH.join2(parent, name) : parent;
        }
        var mode = FS_getMode(canRead, canWrite);
        var node = FS.create(path, mode);
        if (data) {
          data = FS_fileDataToTypedArray(data);
          // make sure we can write to the file
          FS.chmod(node, mode | 146);
          var stream = FS.open(node, 577);
          FS.write(stream, data, 0, data.length, 0, canOwn);
          FS.close(stream);
          FS.chmod(node, mode);
        }
      },
  createDevice(parent, name, input, output) {
        var path = PATH.join2(typeof parent == 'string' ? parent : FS.getPath(parent), name);
        var mode = FS_getMode(!!input, !!output);
        FS.createDevice.major ??= 64;
        var dev = FS.makedev(FS.createDevice.major++, 0);
        // Create a fake device that a set of stream ops to emulate
        // the old behavior.
        FS.registerDevice(dev, {
          open(stream) {
            stream.seekable = false;
          },
          close(stream) {
            // flush any pending line data
            if (output?.buffer?.length) {
              output(10);
            }
          },
          read(stream, buffer, offset, length, pos /* ignored */) {
            var bytesRead = 0;
            for (var i = 0; i < length; i++) {
              var result;
              try {
                result = input();
              } catch (e) {
                throw new FS.ErrnoError(29);
              }
              if (result === undefined && bytesRead === 0) {
                throw new FS.ErrnoError(6);
              }
              if (result === null || result === undefined) break;
              bytesRead++;
              buffer[offset+i] = result;
            }
            if (bytesRead) {
              stream.node.atime = Date.now();
            }
            return bytesRead;
          },
          write(stream, buffer, offset, length, pos) {
            for (var i = 0; i < length; i++) {
              try {
                output(buffer[offset+i]);
              } catch (e) {
                throw new FS.ErrnoError(29);
              }
            }
            if (length) {
              stream.node.mtime = stream.node.ctime = Date.now();
            }
            return i;
          }
        });
        return FS.mkdev(path, mode, dev);
      },
  forceLoadFile(obj) {
        if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
        if (globalThis.XMLHttpRequest) {
          abort("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
        } else { // Command-line.
          try {
            obj.contents = readBinary(obj.url);
          } catch (e) {
            throw new FS.ErrnoError(29);
          }
        }
      },
  createLazyFile(parent, name, url, canRead, canWrite) {
        // Lazy chunked Uint8Array (implements get and length from Uint8Array).
        // Actual getting is abstracted away for eventual reuse.
        class LazyUint8Array {
          lengthKnown = false;
          chunks = []; // Loaded chunks. Index is the chunk number
          get(idx) {
            if (idx > this.length-1 || idx < 0) {
              return undefined;
            }
            var chunkOffset = idx % this.chunkSize;
            var chunkNum = (idx / this.chunkSize)|0;
            return this.getter(chunkNum)[chunkOffset];
          }
          setDataGetter(getter) {
            this.getter = getter;
          }
          cacheLength() {
            // Find length
            var xhr = new XMLHttpRequest();
            xhr.open('HEAD', url, false);
            xhr.send(null);
            if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) abort("Couldn't load " + url + ". Status: " + xhr.status);
            var datalength = Number(xhr.getResponseHeader("Content-length"));
            var header;
            var hasByteServing = (header = xhr.getResponseHeader("Accept-Ranges")) && header === "bytes";
            var usesGzip = (header = xhr.getResponseHeader("Content-Encoding")) && header === "gzip";
  
            var chunkSize = 1024*1024; // Chunk size in bytes
  
            if (!hasByteServing) chunkSize = datalength;
  
            // Function to get a range from the remote URL.
            var doXHR = (from, to) => {
              if (from > to) abort("invalid range (" + from + ", " + to + ") or no bytes requested!");
              if (to > datalength-1) abort("only " + datalength + " bytes available! programmer error!");
  
              // TODO: Use mozResponseArrayBuffer, responseStream, etc. if available.
              var xhr = new XMLHttpRequest();
              xhr.open('GET', url, false);
              if (datalength !== chunkSize) xhr.setRequestHeader("Range", "bytes=" + from + "-" + to);
  
              // Some hints to the browser that we want binary data.
              xhr.responseType = 'arraybuffer';
              if (xhr.overrideMimeType) {
                xhr.overrideMimeType('text/plain; charset=x-user-defined');
              }
  
              xhr.send(null);
              if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) abort("Couldn't load " + url + ". Status: " + xhr.status);
              if (xhr.response !== undefined) {
                return new Uint8Array(/** @type{Array<number>} */(xhr.response || []));
              }
              return intArrayFromString(xhr.responseText || '', true);
            };
            var lazyArray = this;
            lazyArray.setDataGetter((chunkNum) => {
              var start = chunkNum * chunkSize;
              var end = (chunkNum+1) * chunkSize - 1; // including this byte
              end = Math.min(end, datalength-1); // if datalength-1 is selected, this is the last block
              if (typeof lazyArray.chunks[chunkNum] == 'undefined') {
                lazyArray.chunks[chunkNum] = doXHR(start, end);
              }
              if (typeof lazyArray.chunks[chunkNum] == 'undefined') abort('doXHR failed!');
              return lazyArray.chunks[chunkNum];
            });
  
            if (usesGzip || !datalength) {
              // if the server uses gzip or doesn't supply the length, we have to download the whole file to get the (uncompressed) length
              chunkSize = datalength = 1; // this will force getter(0)/doXHR do download the whole file
              datalength = this.getter(0).length;
              chunkSize = datalength;
              out("LazyFiles on gzip forces download of the whole file when length is accessed");
            }
  
            this._length = datalength;
            this._chunkSize = chunkSize;
            this.lengthKnown = true;
          }
          get length() {
            if (!this.lengthKnown) {
              this.cacheLength();
            }
            return this._length;
          }
          get chunkSize() {
            if (!this.lengthKnown) {
              this.cacheLength();
            }
            return this._chunkSize;
          }
        }
  
        if (globalThis.XMLHttpRequest) {
          if (!ENVIRONMENT_IS_WORKER) abort('Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc');
          var lazyArray = new LazyUint8Array();
          var properties = { isDevice: false, contents: lazyArray };
        } else {
          var properties = { isDevice: false, url: url };
        }
  
        var node = FS.createFile(parent, name, properties, canRead, canWrite);
        // This is a total hack, but I want to get this lazy file code out of the
        // core of MEMFS. If we want to keep this lazy file concept I feel it should
        // be its own thin LAZYFS proxying calls to MEMFS.
        if (properties.contents) {
          node.contents = properties.contents;
        } else if (properties.url) {
          node.contents = null;
          node.url = properties.url;
        }
        // Add a function that defers querying the file size until it is asked the first time.
        Object.defineProperties(node, {
          usedBytes: {
            get: function() { return this.contents.length; }
          }
        });
        // override each stream op with one that tries to force load the lazy file first
        var stream_ops = {};
        for (const [key, fn] of Object.entries(node.stream_ops)) {
          stream_ops[key] = (...args) => {
            FS.forceLoadFile(node);
            return fn(...args);
          };
        }
        function writeChunks(stream, buffer, offset, length, position) {
          var contents = stream.node.contents;
          if (position >= contents.length)
            return 0;
          var size = Math.min(contents.length - position, length);
          assert(size >= 0);
          if (contents.slice) { // normal array
            for (var i = 0; i < size; i++) {
              buffer[offset + i] = contents[position + i];
            }
          } else {
            for (var i = 0; i < size; i++) { // LazyUint8Array from sync binary XHR
              buffer[offset + i] = contents.get(position + i);
            }
          }
          return size;
        }
        // use a custom read function
        stream_ops.read = (stream, buffer, offset, length, position) => {
          FS.forceLoadFile(node);
          return writeChunks(stream, buffer, offset, length, position)
        };
        // use a custom mmap function
        stream_ops.mmap = (stream, length, position, prot, flags) => {
          FS.forceLoadFile(node);
          var ptr = mmapAlloc(length);
          if (!ptr) {
            throw new FS.ErrnoError(48);
          }
          writeChunks(stream, HEAP8, ptr, length, position);
          return { ptr, allocated: true };
        };
        node.stream_ops = stream_ops;
        return node;
      },
  };
  var SOCKFS = {
  websocketArgs:{
  },
  callbacks:{
  },
  on(event, callback) {
        SOCKFS.callbacks[event] = callback;
      },
  emit(event, param) {
        SOCKFS.callbacks[event]?.(param);
      },
  mount(mount) {
        // The incoming Module['websocket'] can be used for configuring 
        // subprotocol/url, etc
        SOCKFS.websocketArgs = Module['websocket'] || {};
        // Add the Event registration mechanism to the exported websocket configuration
        // object so we can register network callbacks from native JavaScript too.
        // For more documentation see system/include/emscripten/emscripten.h
        (Module['websocket'] ??= {})['on'] = SOCKFS.on;
  
        return FS.createNode(null, '/', 16895, 0);
      },
  createSocket(family, type, protocol) {
        // Emscripten only supports AF_INET
        if (family != 2) {
          throw new FS.ErrnoError(5);
        }
        type &= ~526336; // Some applications may pass it; it makes no sense for a single process.
        // Emscripten only supports SOCK_STREAM and SOCK_DGRAM
        if (type != 1 && type != 2) {
          throw new FS.ErrnoError(28);
        }
        var streaming = type == 1;
        if (streaming && protocol && protocol != 6) {
          throw new FS.ErrnoError(66); // if SOCK_STREAM, must be tcp or 0.
        }
  
        // create our internal socket structure
        var sock = {
          family,
          type,
          protocol,
          server: null,
          error: null, // Used in getsockopt for SOL_SOCKET/SO_ERROR test
          peers: {},
          pending: [],
          recv_queue: [],
          sock_ops: SOCKFS.websocket_sock_ops
        };
  
        // create the filesystem node to store the socket structure
        var name = SOCKFS.nextname();
        var node = FS.createNode(SOCKFS.root, name, 49152, 0);
        node.sock = sock;
  
        // and the wrapping stream that enables library functions such
        // as read and write to indirectly interact with the socket
        var stream = FS.createStream({
          path: name,
          node,
          flags: 2,
          seekable: false,
          stream_ops: SOCKFS.stream_ops
        });
  
        // map the new stream to the socket structure (sockets have a 1:1
        // relationship with a stream)
        sock.stream = stream;
  
        return sock;
      },
  getSocket(fd) {
        var stream = FS.getStream(fd);
        if (!stream || !FS.isSocket(stream.node.mode)) {
          return null;
        }
        return stream.node.sock;
      },
  stream_ops:{
  poll(stream) {
          var sock = stream.node.sock;
          return sock.sock_ops.poll(sock);
        },
  ioctl(stream, request, varargs) {
          var sock = stream.node.sock;
          return sock.sock_ops.ioctl(sock, request, varargs);
        },
  read(stream, buffer, offset, length, position /* ignored */) {
          var sock = stream.node.sock;
          var msg = sock.sock_ops.recvmsg(sock, length);
          if (!msg) {
            // socket is closed
            return 0;
          }
          buffer.set(msg.buffer, offset);
          return msg.buffer.length;
        },
  write(stream, buffer, offset, length, position /* ignored */) {
          var sock = stream.node.sock;
          return sock.sock_ops.sendmsg(sock, buffer, offset, length);
        },
  close(stream) {
          var sock = stream.node.sock;
          sock.sock_ops.close(sock);
        },
  },
  nextname() {
        if (!SOCKFS.nextname.current) {
          SOCKFS.nextname.current = 0;
        }
        return `socket[${SOCKFS.nextname.current++}]`;
      },
  websocket_sock_ops:{
  createPeer(sock, addr, port) {
          var ws;
  
          if (typeof addr == 'object') {
            ws = addr;
            addr = null;
            port = null;
          }
  
          if (ws) {
            // for sockets that've already connected (e.g. we're the server)
            // we can inspect the _socket property for the address
            if (ws._socket) {
              addr = ws._socket.remoteAddress;
              port = ws._socket.remotePort;
            }
            // if we're just now initializing a connection to the remote,
            // inspect the url property
            else {
              var result = /ws[s]?:\/\/([^:]+):(\d+)/.exec(ws.url);
              if (!result) {
                throw new Error('WebSocket URL must be in the format ws(s)://address:port');
              }
              addr = result[1];
              port = parseInt(result[2], 10);
            }
          } else {
            // create the actual websocket object and connect
            try {
              // The default value is 'ws://' the replace is needed because the compiler replaces '//' comments with '#'
              // comments without checking context, so we'd end up with ws:#, the replace swaps the '#' for '//' again.
              var url = 'ws://'.replace('#', '//');
              // Make the WebSocket subprotocol (Sec-WebSocket-Protocol) default to binary if no configuration is set.
              var subProtocols = 'binary'; // The default value is 'binary'
              // The default WebSocket options
              var opts = undefined;
  
              // Fetch runtime WebSocket URL config.
              if (SOCKFS.websocketArgs['url']) {
                url = SOCKFS.websocketArgs['url'];
              }
              // Fetch runtime WebSocket subprotocol config.
              if (SOCKFS.websocketArgs['subprotocol']) {
                subProtocols = SOCKFS.websocketArgs['subprotocol'];
              } else if (SOCKFS.websocketArgs['subprotocol'] === null) {
                subProtocols = 'null'
              }
  
              if (url === 'ws://' || url === 'wss://') { // Is the supplied URL config just a prefix, if so complete it.
                var parts = addr.split('/');
                url = url + parts[0] + ":" + port + "/" + parts.slice(1).join('/');
              }
  
              if (subProtocols !== 'null') {
                // The regex trims the string (removes spaces at the beginning and end), then splits the string by
                // <any space>,<any space> into an Array. Whitespace removal is important for Websockify and ws.
                subProtocols = subProtocols.replace(/^ +| +$/g,"").split(/ *, */);
  
                opts = subProtocols;
              }
  
              // If node we use the ws library.
              var WebSocketConstructor;
              if (ENVIRONMENT_IS_NODE) {
                WebSocketConstructor = /** @type{(typeof WebSocket)} */(require('ws'));
              } else
              {
                WebSocketConstructor = WebSocket;
              }
              ws = new WebSocketConstructor(url, opts);
              ws.binaryType = 'arraybuffer';
            } catch (e) {
              throw new FS.ErrnoError(23);
            }
          }
  
          var peer = {
            addr,
            port,
            socket: ws,
            msg_send_queue: []
          };
  
          SOCKFS.websocket_sock_ops.addPeer(sock, peer);
          SOCKFS.websocket_sock_ops.handlePeerEvents(sock, peer);
  
          // if this is a bound dgram socket, send the port number first to allow
          // us to override the ephemeral port reported to us by remotePort on the
          // remote end.
          if (sock.type === 2 && typeof sock.sport != 'undefined') {
            peer.msg_send_queue.push(new Uint8Array([
                255, 255, 255, 255,
                'p'.charCodeAt(0), 'o'.charCodeAt(0), 'r'.charCodeAt(0), 't'.charCodeAt(0),
                ((sock.sport & 0xff00) >> 8) , (sock.sport & 0xff)
            ]));
          }
  
          return peer;
        },
  getPeer(sock, addr, port) {
          return sock.peers[addr + ':' + port];
        },
  addPeer(sock, peer) {
          sock.peers[peer.addr + ':' + peer.port] = peer;
        },
  removePeer(sock, peer) {
          delete sock.peers[peer.addr + ':' + peer.port];
        },
  handlePeerEvents(sock, peer) {
          var first = true;
  
          function handleOpen() {
  
            sock.connecting = false;
            SOCKFS.emit('open', sock.stream.fd);
  
            try {
              var queued = peer.msg_send_queue.shift();
              while (queued) {
                peer.socket.send(queued);
                queued = peer.msg_send_queue.shift();
              }
            } catch (e) {
              // not much we can do here in the way of proper error handling as we've already
              // lied and said this data was sent. shut it down.
              peer.socket.close();
            }
          }
  
          function handleMessage(data) {
            if (typeof data == 'string') {
              var encoder = new TextEncoder(); // should be utf-8
              data = encoder.encode(data); // make a typed array from the string
            } else {
              assert(data.byteLength !== undefined); // must receive an ArrayBuffer
              if (data.byteLength == 0) {
                // An empty ArrayBuffer will emit a pseudo disconnect event
                // as recv/recvmsg will return zero which indicates that a socket
                // has performed a shutdown although the connection has not been disconnected yet.
                return;
              }
              data = new Uint8Array(data); // make a typed array view on the array buffer
            }
  
            // if this is the port message, override the peer's port with it
            var wasfirst = first;
            first = false;
            if (wasfirst &&
                data.length === 10 &&
                data[0] === 255 && data[1] === 255 && data[2] === 255 && data[3] === 255 &&
                data[4] === 'p'.charCodeAt(0) && data[5] === 'o'.charCodeAt(0) && data[6] === 'r'.charCodeAt(0) && data[7] === 't'.charCodeAt(0)) {
              // update the peer's port and its key in the peer map
              var newport = ((data[8] << 8) | data[9]);
              SOCKFS.websocket_sock_ops.removePeer(sock, peer);
              peer.port = newport;
              SOCKFS.websocket_sock_ops.addPeer(sock, peer);
              return;
            }
  
            sock.recv_queue.push({ addr: peer.addr, port: peer.port, data: data });
            SOCKFS.emit('message', sock.stream.fd);
          }
  
          if (ENVIRONMENT_IS_NODE) {
             // EventEmitter-style events use by ws library objects in Node.js).
            peer.socket.on('open', handleOpen);
            peer.socket.on('message', (data, isBinary) => {
              if (!isBinary) {
                return;
              }
              handleMessage((new Uint8Array(data)).buffer); // copy from node Buffer -> ArrayBuffer
            });
            peer.socket.on('close', () => SOCKFS.emit('close', sock.stream.fd));
            peer.socket.on('error', (error) =>{
              // Although the ws library may pass errors that may be more descriptive than
              // ECONNREFUSED they are not necessarily the expected error code e.g.
              // ENOTFOUND on getaddrinfo seems to be node.js specific, so using ECONNREFUSED
              // is still probably the most useful thing to do.
              sock.error = 14; // Used in getsockopt for SOL_SOCKET/SO_ERROR test.
              SOCKFS.emit('error', [sock.stream.fd, sock.error, 'ECONNREFUSED: Connection refused']);
            });
            return;
          }
          peer.socket.onopen = handleOpen;
          peer.socket.onclose = () => SOCKFS.emit('close', sock.stream.fd);
          peer.socket.onmessage = (event) => handleMessage(event.data);
          peer.socket.onerror = (error) => {
            // The WebSocket spec only allows a 'simple event' to be thrown on error,
            // so we only really know as much as ECONNREFUSED.
            sock.error = 14; // Used in getsockopt for SOL_SOCKET/SO_ERROR test.
            SOCKFS.emit('error', [sock.stream.fd, sock.error, 'ECONNREFUSED: Connection refused']);
          };
        },
  poll(sock) {
          if (sock.type === 1 && sock.server) {
            // listen sockets should only say they're available for reading
            // if there are pending clients.
            return sock.pending.length ? (64 | 1) : 0;
          }
  
          var mask = 0;
          var dest = sock.type === 1 ?  // we only care about the socket state for connection-based sockets
            SOCKFS.websocket_sock_ops.getPeer(sock, sock.daddr, sock.dport) :
            null;
  
          if (sock.recv_queue.length ||
              !dest ||  // connection-less sockets are always ready to read
              (dest && dest.socket.readyState === dest.socket.CLOSING) ||
              (dest && dest.socket.readyState === dest.socket.CLOSED)) {  // let recv return 0 once closed
            mask |= (64 | 1);
          }
  
          if (!dest ||  // connection-less sockets are always ready to write
              (dest && dest.socket.readyState === dest.socket.OPEN)) {
            mask |= 4;
          }
  
          if ((dest && dest.socket.readyState === dest.socket.CLOSING) ||
              (dest && dest.socket.readyState === dest.socket.CLOSED)) {
            // When an non-blocking connect fails mark the socket as writable.
            // Its up to the calling code to then use getsockopt with SO_ERROR to
            // retrieve the error.
            // See https://man7.org/linux/man-pages/man2/connect.2.html
            if (sock.connecting) {
              mask |= 4;
            } else  {
              mask |= 16;
            }
          }
  
          return mask;
        },
  ioctl(sock, request, arg) {
          switch (request) {
            case 21531:
              var bytes = 0;
              if (sock.recv_queue.length) {
                bytes = sock.recv_queue[0].data.length;
              }
              HEAP32[((arg)>>2)] = bytes;
              return 0;
            case 21537:
              var on = HEAP32[((arg)>>2)];
              if (on) {
                sock.stream.flags |= 2048;
              } else {
                sock.stream.flags &= ~2048;
              }
              return 0;
            default:
              return 28;
          }
        },
  close(sock) {
          // if we've spawned a listen server, close it
          if (sock.server) {
            try {
              sock.server.close();
            } catch (e) {
            }
            sock.server = null;
          }
          // close any peer connections
          for (var peer of Object.values(sock.peers)) {
            try {
              peer.socket.close();
            } catch (e) {
            }
            SOCKFS.websocket_sock_ops.removePeer(sock, peer);
          }
          return 0;
        },
  bind(sock, addr, port) {
          if (typeof sock.saddr != 'undefined' || typeof sock.sport != 'undefined') {
            throw new FS.ErrnoError(28);  // already bound
          }
          sock.saddr = addr;
          sock.sport = port;
          // in order to emulate dgram sockets, we need to launch a listen server when
          // binding on a connection-less socket
          // note: this is only required on the server side
          if (sock.type === 2) {
            // close the existing server if it exists
            if (sock.server) {
              sock.server.close();
              sock.server = null;
            }
            // swallow error operation not supported error that occurs when binding in the
            // browser where this isn't supported
            try {
              sock.sock_ops.listen(sock, 0);
            } catch (e) {
              if (!(e.name === 'ErrnoError')) throw e;
              if (e.errno !== 138) throw e;
            }
          }
        },
  connect(sock, addr, port) {
          if (sock.server) {
            throw new FS.ErrnoError(138);
          }
  
          // TODO autobind
          // if (!sock.addr && sock.type == 2) {
          // }
  
          // early out if we're already connected / in the middle of connecting
          if (typeof sock.daddr != 'undefined' && typeof sock.dport != 'undefined') {
            var dest = SOCKFS.websocket_sock_ops.getPeer(sock, sock.daddr, sock.dport);
            if (dest) {
              if (dest.socket.readyState === dest.socket.CONNECTING) {
                throw new FS.ErrnoError(7);
              } else {
                throw new FS.ErrnoError(30);
              }
            }
          }
  
          // add the socket to our peer list and set our
          // destination address / port to match
          var peer = SOCKFS.websocket_sock_ops.createPeer(sock, addr, port);
          sock.daddr = peer.addr;
          sock.dport = peer.port;
  
          // because we cannot synchronously block to wait for the WebSocket
          // connection to complete, we return here pretending that the connection
          // was a success.
          sock.connecting = true;
        },
  listen(sock, backlog) {
          if (!ENVIRONMENT_IS_NODE) {
            throw new FS.ErrnoError(138);
          }
          if (sock.server) {
             throw new FS.ErrnoError(28);  // already listening
          }
          var WebSocketServer = require('ws').Server;
          var host = sock.saddr;
          sock.server = new WebSocketServer({
            host,
            port: sock.sport
            // TODO support backlog
          });
          SOCKFS.emit('listen', sock.stream.fd); // Send Event with listen fd.
  
          sock.server.on('connection', (ws) => {
            if (sock.type === 1) {
              var newsock = SOCKFS.createSocket(sock.family, sock.type, sock.protocol);
  
              // create a peer on the new socket
              var peer = SOCKFS.websocket_sock_ops.createPeer(newsock, ws);
              newsock.daddr = peer.addr;
              newsock.dport = peer.port;
  
              // push to queue for accept to pick up
              sock.pending.push(newsock);
              SOCKFS.emit('connection', newsock.stream.fd);
            } else {
              // create a peer on the listen socket so calling sendto
              // with the listen socket and an address will resolve
              // to the correct client
              SOCKFS.websocket_sock_ops.createPeer(sock, ws);
              SOCKFS.emit('connection', sock.stream.fd);
            }
          });
          sock.server.on('close', () => {
            SOCKFS.emit('close', sock.stream.fd);
            sock.server = null;
          });
          sock.server.on('error', (error) => {
            // Although the ws library may pass errors that may be more descriptive than
            // ECONNREFUSED they are not necessarily the expected error code e.g.
            // ENOTFOUND on getaddrinfo seems to be node.js specific, so using EHOSTUNREACH
            // is still probably the most useful thing to do. This error shouldn't
            // occur in a well written app as errors should get trapped in the compiled
            // app's own getaddrinfo call.
            sock.error = 23; // Used in getsockopt for SOL_SOCKET/SO_ERROR test.
            SOCKFS.emit('error', [sock.stream.fd, sock.error, 'EHOSTUNREACH: Host is unreachable']);
            // don't throw
          });
        },
  accept(listensock) {
          if (!listensock.server || !listensock.pending.length) {
            throw new FS.ErrnoError(28);
          }
          var newsock = listensock.pending.shift();
          newsock.stream.flags = listensock.stream.flags;
          return newsock;
        },
  getname(sock, peer) {
          var addr, port;
          if (peer) {
            if (sock.daddr === undefined || sock.dport === undefined) {
              throw new FS.ErrnoError(53);
            }
            addr = sock.daddr;
            port = sock.dport;
          } else {
            // TODO saddr and sport will be set for bind()'d UDP sockets, but what
            // should we be returning for TCP sockets that've been connect()'d?
            addr = sock.saddr || 0;
            port = sock.sport || 0;
          }
          return { addr, port };
        },
  sendmsg(sock, buffer, offset, length, addr, port) {
          if (sock.type === 2) {
            // connection-less sockets will honor the message address,
            // and otherwise fall back to the bound destination address
            if (addr === undefined || port === undefined) {
              addr = sock.daddr;
              port = sock.dport;
            }
            // if there was no address to fall back to, error out
            if (addr === undefined || port === undefined) {
              throw new FS.ErrnoError(17);
            }
          } else {
            // connection-based sockets will only use the bound
            addr = sock.daddr;
            port = sock.dport;
          }
  
          // find the peer for the destination address
          var dest = SOCKFS.websocket_sock_ops.getPeer(sock, addr, port);
  
          // early out if not connected with a connection-based socket
          if (sock.type === 1) {
            if (!dest || dest.socket.readyState === dest.socket.CLOSING || dest.socket.readyState === dest.socket.CLOSED) {
              throw new FS.ErrnoError(53);
            }
          }
  
          // create a copy of the incoming data to send, as the WebSocket API
          // doesn't work entirely with an ArrayBufferView, it'll just send
          // the entire underlying buffer
          if (ArrayBuffer.isView(buffer)) {
            offset += buffer.byteOffset;
            buffer = buffer.buffer;
          }
  
          var data = buffer.slice(offset, offset + length);
  
          // if we don't have a cached connectionless UDP datagram connection, or
          // the TCP socket is still connecting, queue the message to be sent upon
          // connect, and lie, saying the data was sent now.
          if (!dest || dest.socket.readyState !== dest.socket.OPEN) {
            // if we're not connected, open a new connection
            if (sock.type === 2) {
              if (!dest || dest.socket.readyState === dest.socket.CLOSING || dest.socket.readyState === dest.socket.CLOSED) {
                dest = SOCKFS.websocket_sock_ops.createPeer(sock, addr, port);
              }
            }
            dest.msg_send_queue.push(data);
            return length;
          }
  
          try {
            // send the actual data
            dest.socket.send(data);
            return length;
          } catch (e) {
            throw new FS.ErrnoError(28);
          }
        },
  recvmsg(sock, length) {
          // http://pubs.opengroup.org/onlinepubs/7908799/xns/recvmsg.html
          if (sock.type === 1 && sock.server) {
            // tcp servers should not be recv()'ing on the listen socket
            throw new FS.ErrnoError(53);
          }
  
          var queued = sock.recv_queue.shift();
          if (!queued) {
            if (sock.type === 1) {
              var dest = SOCKFS.websocket_sock_ops.getPeer(sock, sock.daddr, sock.dport);
  
              if (!dest) {
                // if we have a destination address but are not connected, error out
                throw new FS.ErrnoError(53);
              }
              if (dest.socket.readyState === dest.socket.CLOSING || dest.socket.readyState === dest.socket.CLOSED) {
                // return null if the socket has closed
                return null;
              }
              // else, our socket is in a valid state but truly has nothing available
              throw new FS.ErrnoError(6);
            }
            throw new FS.ErrnoError(6);
          }
  
          // queued.data will be an ArrayBuffer if it's unadulterated, but if it's
          // requeued TCP data it'll be an ArrayBufferView
          var queuedLength = queued.data.byteLength || queued.data.length;
          var queuedOffset = queued.data.byteOffset || 0;
          var queuedBuffer = queued.data.buffer || queued.data;
          var bytesRead = Math.min(length, queuedLength);
          var res = {
            buffer: new Uint8Array(queuedBuffer, queuedOffset, bytesRead),
            addr: queued.addr,
            port: queued.port
          };
  
          // push back any unread data for TCP connections
          if (sock.type === 1 && bytesRead < queuedLength) {
            var bytesRemaining = queuedLength - bytesRead;
            queued.data = new Uint8Array(queuedBuffer, queuedOffset + bytesRead, bytesRemaining);
            sock.recv_queue.unshift(queued);
          }
  
          return res;
        },
  },
  };
  
  var getSocketFromFD = (fd) => {
      var socket = SOCKFS.getSocket(fd);
      if (!socket) throw new FS.ErrnoError(8);
      return socket;
    };
  
  var inetPton4 = (str) => {
      var b = str.split('.');
      for (var i = 0; i < 4; i++) {
        var tmp = Number(b[i]);
        if (isNaN(tmp)) return null;
        b[i] = tmp;
      }
      return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
    };
  
  var inetPton6 = (str) => {
      var words;
      var w, offset, z, i;
      /* http://home.deds.nl/~aeron/regex/ */
      var valid6regx = /^((?=.*::)(?!.*::.+::)(::)?([\dA-F]{1,4}:(:|\b)|){5}|([\dA-F]{1,4}:){6})((([\dA-F]{1,4}((?!\3)::|:\b|$))|(?!\2\3)){2}|(((2[0-4]|1\d|[1-9])?\d|25[0-5])\.?\b){4})$/i
      var parts = [];
      if (!valid6regx.test(str)) {
        return null;
      }
      if (str === "::") {
        return [0, 0, 0, 0, 0, 0, 0, 0];
      }
      // Z placeholder to keep track of zeros when splitting the string on ":"
      if (str.startsWith("::")) {
        str = str.replace("::", "Z:"); // leading zeros case
      } else {
        str = str.replace("::", ":Z:");
      }
  
      if (str.indexOf(".") > 0) {
        // parse IPv4 embedded address
        str = str.replace(new RegExp('[.]', 'g'), ":");
        words = str.split(":");
        words[words.length-4] = Number(words[words.length-4]) + Number(words[words.length-3])*256;
        words[words.length-3] = Number(words[words.length-2]) + Number(words[words.length-1])*256;
        words = words.slice(0, words.length-2);
      } else {
        words = str.split(":");
      }
  
      offset = 0; z = 0;
      for (w=0; w < words.length; w++) {
        if (typeof words[w] == 'string') {
          if (words[w] === 'Z') {
            // compressed zeros - write appropriate number of zero words
            for (z = 0; z < (8 - words.length+1); z++) {
              parts[w+z] = 0;
            }
            offset = z-1;
          } else {
            // parse hex field to 16-bit value and write it in network byte-order
            parts[w+offset] = _htons(parseInt(words[w],16));
          }
        } else {
          // parsed IPv4 words
          parts[w+offset] = words[w];
        }
      }
      return [
        (parts[1] << 16) | parts[0],
        (parts[3] << 16) | parts[2],
        (parts[5] << 16) | parts[4],
        (parts[7] << 16) | parts[6]
      ];
    };
  
  var zeroMemory = (ptr, size) => HEAPU8.fill(0, ptr, ptr + size);
  
  /** @param {number=} addrlen */
  var writeSockaddr = (sa, family, addr, port, addrlen) => {
      switch (family) {
        case 2:
          addr = inetPton4(addr);
          zeroMemory(sa, 16);
          if (addrlen) {
            HEAP32[((addrlen)>>2)] = 16;
          }
          HEAP16[((sa)>>1)] = family;
          HEAP32[(((sa)+(4))>>2)] = addr;
          HEAP16[(((sa)+(2))>>1)] = _htons(port);
          break;
        case 10:
          addr = inetPton6(addr);
          zeroMemory(sa, 28);
          if (addrlen) {
            HEAP32[((addrlen)>>2)] = 28;
          }
          HEAP32[((sa)>>2)] = family;
          HEAP32[(((sa)+(8))>>2)] = addr[0];
          HEAP32[(((sa)+(12))>>2)] = addr[1];
          HEAP32[(((sa)+(16))>>2)] = addr[2];
          HEAP32[(((sa)+(20))>>2)] = addr[3];
          HEAP16[(((sa)+(2))>>1)] = _htons(port);
          break;
        default:
          return 5;
      }
      return 0;
    };
  
  
  var DNS = {
  address_map:{
  id:1,
  addrs:{
  },
  names:{
  },
  },
  lookup_name(name) {
        // If the name is already a valid ipv4 / ipv6 address, don't generate a fake one.
        var res = inetPton4(name);
        if (res !== null) {
          return name;
        }
        res = inetPton6(name);
        if (res !== null) {
          return name;
        }
  
        // See if this name is already mapped.
        var addr;
  
        if (DNS.address_map.addrs[name]) {
          addr = DNS.address_map.addrs[name];
        } else {
          var id = DNS.address_map.id++;
          assert(id < 65535, 'exceeded max address mappings of 65535');
  
          addr = '172.29.' + (id & 0xff) + '.' + (id & 0xff00);
  
          DNS.address_map.names[addr] = name;
          DNS.address_map.addrs[name] = addr;
        }
  
        return addr;
      },
  lookup_addr(addr) {
        if (DNS.address_map.names[addr]) {
          return DNS.address_map.names[addr];
        }
  
        return null;
      },
  };
  function ___syscall_accept4(fd, addr, addrlen, flags, d1, d2) {
  try {
  
      var sock = getSocketFromFD(fd);
      var newsock = sock.sock_ops.accept(sock);
      if (addr) {
        var errno = writeSockaddr(addr, newsock.family, DNS.lookup_name(newsock.daddr), newsock.dport, addrlen);
        assert(!errno);
      }
      return newsock.stream.fd;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  
  var inetNtop4 = (addr) =>
      (addr & 0xff) + '.' + ((addr >> 8) & 0xff) + '.' + ((addr >> 16) & 0xff) + '.' + ((addr >> 24) & 0xff);
  
  
  var inetNtop6 = (ints) => {
      //  ref:  http://www.ietf.org/rfc/rfc2373.txt - section 2.5.4
      //  Format for IPv4 compatible and mapped  128-bit IPv6 Addresses
      //  128-bits are split into eight 16-bit words
      //  stored in network byte order (big-endian)
      //  |                80 bits               | 16 |      32 bits        |
      //  +-----------------------------------------------------------------+
      //  |               10 bytes               |  2 |      4 bytes        |
      //  +--------------------------------------+--------------------------+
      //  +               5 words                |  1 |      2 words        |
      //  +--------------------------------------+--------------------------+
      //  |0000..............................0000|0000|    IPv4 ADDRESS     | (compatible)
      //  +--------------------------------------+----+---------------------+
      //  |0000..............................0000|FFFF|    IPv4 ADDRESS     | (mapped)
      //  +--------------------------------------+----+---------------------+
      var str = "";
      var word = 0;
      var longest = 0;
      var lastzero = 0;
      var zstart = 0;
      var len = 0;
      var i = 0;
      var parts = [
        ints[0] & 0xffff,
        (ints[0] >> 16),
        ints[1] & 0xffff,
        (ints[1] >> 16),
        ints[2] & 0xffff,
        (ints[2] >> 16),
        ints[3] & 0xffff,
        (ints[3] >> 16)
      ];
  
      // Handle IPv4-compatible, IPv4-mapped, loopback and any/unspecified addresses
  
      var hasipv4 = true;
      var v4part = "";
      // check if the 10 high-order bytes are all zeros (first 5 words)
      for (i = 0; i < 5; i++) {
        if (parts[i] !== 0) { hasipv4 = false; break; }
      }
  
      if (hasipv4) {
        // low-order 32-bits store an IPv4 address (bytes 13 to 16) (last 2 words)
        v4part = inetNtop4(parts[6] | (parts[7] << 16));
        // IPv4-mapped IPv6 address if 16-bit value (bytes 11 and 12) == 0xFFFF (6th word)
        if (parts[5] === -1) {
          str = "::ffff:";
          str += v4part;
          return str;
        }
        // IPv4-compatible IPv6 address if 16-bit value (bytes 11 and 12) == 0x0000 (6th word)
        if (parts[5] === 0) {
          str = "::";
          // special case IPv6 addresses
          if (v4part === "0.0.0.0") v4part = ""; // any/unspecified address
          if (v4part === "0.0.0.1") v4part = "1";// loopback address
          str += v4part;
          return str;
        }
      }
  
      // Handle all other IPv6 addresses
  
      // first run to find the longest contiguous zero words
      for (word = 0; word < 8; word++) {
        if (parts[word] === 0) {
          if (word - lastzero > 1) {
            len = 0;
          }
          lastzero = word;
          len++;
        }
        if (len > longest) {
          longest = len;
          zstart = word - longest + 1;
        }
      }
  
      for (word = 0; word < 8; word++) {
        if (longest > 1) {
          // compress contiguous zeros - to produce "::"
          if (parts[word] === 0 && word >= zstart && word < (zstart + longest) ) {
            if (word === zstart) {
              str += ":";
              if (zstart === 0) str += ":"; //leading zeros case
            }
            continue;
          }
        }
        // converts 16-bit words from big-endian to little-endian before converting to hex string
        str += Number(_ntohs(parts[word] & 0xffff)).toString(16);
        str += word < 7 ? ":" : "";
      }
      return str;
    };
  
  var readSockaddr = (sa, salen) => {
      // family / port offsets are common to both sockaddr_in and sockaddr_in6
      var family = HEAP16[((sa)>>1)];
      var port = _ntohs(HEAPU16[(((sa)+(2))>>1)]);
      var addr;
  
      switch (family) {
        case 2:
          if (salen !== 16) {
            return { errno: 28 };
          }
          addr = HEAP32[(((sa)+(4))>>2)];
          addr = inetNtop4(addr);
          break;
        case 10:
          if (salen !== 28) {
            return { errno: 28 };
          }
          addr = [
            HEAP32[(((sa)+(8))>>2)],
            HEAP32[(((sa)+(12))>>2)],
            HEAP32[(((sa)+(16))>>2)],
            HEAP32[(((sa)+(20))>>2)]
          ];
          addr = inetNtop6(addr);
          break;
        default:
          return { errno: 5 };
      }
  
      return { family: family, addr: addr, port: port };
    };
  
  
  var getSocketAddress = (addrp, addrlen) => {
      var info = readSockaddr(addrp, addrlen);
      if (info.errno) throw new FS.ErrnoError(info.errno);
      info.addr = DNS.lookup_addr(info.addr) || info.addr;
      return info;
    };
  function ___syscall_bind(fd, addr, addrlen, d1, d2, d3) {
  try {
  
      var sock = getSocketFromFD(fd);
      var info = getSocketAddress(addr, addrlen);
      sock.sock_ops.bind(sock, info.addr, info.port);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  
  
  var SYSCALLS = {
  currentUmask:18,
  calculateAt(dirfd, path, allowEmpty) {
        if (PATH.isAbs(path)) {
          return path;
        }
        // relative path
        var dir;
        if (dirfd === -100) {
          dir = FS.cwd();
        } else {
          var dirstream = SYSCALLS.getStreamFromFD(dirfd);
          dir = dirstream.path;
        }
        if (path.length == 0) {
          if (!allowEmpty) {
            throw new FS.ErrnoError(44);;
          }
          return dir;
        }
        return dir + '/' + path;
      },
  writeStat(buf, stat) {
        HEAPU32[((buf)>>2)] = stat.dev;
        HEAPU32[(((buf)+(4))>>2)] = stat.mode;
        HEAPU32[(((buf)+(8))>>2)] = stat.nlink;
        HEAPU32[(((buf)+(12))>>2)] = stat.uid;
        HEAPU32[(((buf)+(16))>>2)] = stat.gid;
        HEAPU32[(((buf)+(20))>>2)] = stat.rdev;
        HEAP64[(((buf)+(24))>>3)] = BigInt(stat.size);
        HEAP32[(((buf)+(32))>>2)] = 4096;
        HEAP32[(((buf)+(36))>>2)] = stat.blocks;
        var atime = stat.atime.getTime();
        var mtime = stat.mtime.getTime();
        var ctime = stat.ctime.getTime();
        HEAP64[(((buf)+(40))>>3)] = BigInt(Math.floor(atime / 1000));
        HEAPU32[(((buf)+(48))>>2)] = (atime % 1000) * 1000 * 1000;
        HEAP64[(((buf)+(56))>>3)] = BigInt(Math.floor(mtime / 1000));
        HEAPU32[(((buf)+(64))>>2)] = (mtime % 1000) * 1000 * 1000;
        HEAP64[(((buf)+(72))>>3)] = BigInt(Math.floor(ctime / 1000));
        HEAPU32[(((buf)+(80))>>2)] = (ctime % 1000) * 1000 * 1000;
        HEAP64[(((buf)+(88))>>3)] = BigInt(stat.ino);
        return 0;
      },
  writeStatFs(buf, stats) {
        HEAPU32[(((buf)+(4))>>2)] = stats.bsize;
        HEAPU32[(((buf)+(60))>>2)] = stats.bsize;
        HEAP64[(((buf)+(8))>>3)] = BigInt(stats.blocks);
        HEAP64[(((buf)+(16))>>3)] = BigInt(stats.bfree);
        HEAP64[(((buf)+(24))>>3)] = BigInt(stats.bavail);
        HEAP64[(((buf)+(32))>>3)] = BigInt(stats.files);
        HEAP64[(((buf)+(40))>>3)] = BigInt(stats.ffree);
        HEAPU32[(((buf)+(48))>>2)] = stats.fsid;
        HEAPU32[(((buf)+(64))>>2)] = stats.flags;  // ST_NOSUID
        HEAPU32[(((buf)+(56))>>2)] = stats.namelen;
      },
  doMsync(addr, stream, len, flags, offset) {
        if (!FS.isFile(stream.node.mode)) {
          throw new FS.ErrnoError(43);
        }
        if (flags & 2) {
          // MAP_PRIVATE calls need not to be synced back to underlying fs
          return 0;
        }
        var buffer = HEAPU8.slice(addr, addr + len);
        FS.msync(stream, buffer, offset, len, flags);
      },
  getStreamFromFD(fd) {
        var stream = FS.getStreamChecked(fd);
        return stream;
      },
  varargs:undefined,
  getStr(ptr) {
        var ret = UTF8ToString(ptr);
        return ret;
      },
  };
  function ___syscall_chdir(path) {
  try {
  
      path = SYSCALLS.getStr(path);
      FS.chdir(path);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_chmod(path, mode) {
  try {
  
      path = SYSCALLS.getStr(path);
      FS.chmod(path, mode);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  
  function ___syscall_connect(fd, addr, addrlen, d1, d2, d3) {
  try {
  
      var sock = getSocketFromFD(fd);
      var info = getSocketAddress(addr, addrlen);
      sock.sock_ops.connect(sock, info.addr, info.port);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_dup3(fd, newfd, flags) {
  try {
  
      if (fd === newfd) return -28;
      if (flags & ~524288) return -28;
      var old = SYSCALLS.getStreamFromFD(fd);
      // Check newfd is within range of valid open file descriptors.
      if (newfd < 0 || newfd >= FS.MAX_OPEN_FDS) return -8;
      var existing = FS.getStream(newfd);
      if (existing) FS.close(existing);
      var stream = FS.dupStream(old, newfd);
      if (flags & 524288) {
        stream.flags |= 524288;
      }
      return stream.fd;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_faccessat(dirfd, path, amode, flags) {
  try {
  
      path = SYSCALLS.getStr(path);
      assert(!flags || flags == 512);
      path = SYSCALLS.calculateAt(dirfd, path);
      if (amode & ~7) {
        // need a valid mode
        return -28;
      }
      var lookup = FS.lookupPath(path, { follow: true });
      var node = lookup.node;
      if (!node) {
        return -44;
      }
      var perms = '';
      if (amode & 4) perms += 'r';
      if (amode & 2) perms += 'w';
      if (amode & 1) perms += 'x';
      if (perms /* otherwise, they've just passed F_OK */ && FS.nodePermissions(node, perms)) {
        return -2;
      }
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_fchmod(fd, mode) {
  try {
  
      FS.fchmod(fd, mode);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_fchmodat2(dirfd, path, mode, flags) {
  try {
  
      var nofollow = flags & 256;
      path = SYSCALLS.getStr(path);
      path = SYSCALLS.calculateAt(dirfd, path);
      FS.chmod(path, mode, nofollow);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_fchown32(fd, owner, group) {
  try {
  
      FS.fchown(fd, owner, group);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  var syscallGetVarargI = () => {
      assert(SYSCALLS.varargs != undefined);
      // the `+` prepended here is necessary to convince the JSCompiler that varargs is indeed a number.
      var ret = HEAP32[((+SYSCALLS.varargs)>>2)];
      SYSCALLS.varargs += 4;
      return ret;
    };
  var syscallGetVarargP = syscallGetVarargI;
  
  
  function ___syscall_fcntl64(fd, cmd, varargs) {
  SYSCALLS.varargs = varargs;
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      switch (cmd) {
        case 0: {
          var arg = syscallGetVarargI();
          if (arg < 0) {
            return -28;
          }
          while (FS.streams[arg]) {
            arg++;
          }
          var newStream;
          newStream = FS.dupStream(stream, arg);
          return newStream.fd;
        }
        case 1:
        case 2:
          return 0;  // FD_CLOEXEC makes no sense for a single process.
        case 3:
          return stream.flags;
        case 4: {
          var arg = syscallGetVarargI();
          var mask = 289792;
          stream.flags = (stream.flags & ~mask) | (arg & mask);
          return 0;
        }
        case 12: {
          var arg = syscallGetVarargP();
          var offset = 0;
          // We're always unlocked.
          HEAP16[(((arg)+(offset))>>1)] = 2;
          return 0;
        }
        case 13:
        case 14:
          // Pretend that the locking is successful. These are process-level locks,
          // and Emscripten programs are a single process. If we supported linking a
          // filesystem between programs, we'd need to do more here.
          // See https://github.com/emscripten-core/emscripten/issues/23697
          return 0;
      }
      return -28;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_fstat64(fd, buf) {
  try {
  
      return SYSCALLS.writeStat(buf, FS.fstat(fd));
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  var INT53_MAX = 9007199254740992;
  
  var INT53_MIN = -9007199254740992;
  var bigintToI53Checked = (num) => (num < INT53_MIN || num > INT53_MAX) ? NaN : Number(num);
  function ___syscall_ftruncate64(fd, length) {
    length = bigintToI53Checked(length);
  
  
  try {
  
      if (isNaN(length)) return -22;
      FS.ftruncate(fd, length);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  ;
  }

  
  var stringToUTF8 = (str, outPtr, maxBytesToWrite) => {
      assert(typeof maxBytesToWrite == 'number', 'stringToUTF8 requires a third parameter that specifies the length of the output buffer');
      return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
    };
  function ___syscall_getcwd(buf, size) {
  try {
  
      if (size === 0) return -28;
      var cwd = FS.cwd();
      var cwdLengthInBytes = lengthBytesUTF8(cwd) + 1;
      if (size < cwdLengthInBytes) return -68;
      stringToUTF8(cwd, buf, size);
      return cwdLengthInBytes;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  
  function ___syscall_getdents64(fd, dirp, count) {
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd)
      stream.getdents ||= FS.readdir(stream.path);
  
      var struct_size = 280;
      var pos = 0;
      var off = FS.llseek(stream, 0, 1);
  
      var startIdx = Math.floor(off / struct_size);
      var endIdx = Math.min(stream.getdents.length, startIdx + Math.floor(count/struct_size))
      for (var idx = startIdx; idx < endIdx; idx++) {
        var id;
        var type;
        var name = stream.getdents[idx];
        if (name === '.') {
          id = stream.node.id;
          type = 4;
        }
        else if (name === '..') {
          var lookup = FS.lookupPath(stream.path, { parent: true });
          id = lookup.node.id;
          type = 4;
        }
        else {
          var child;
          try {
            child = FS.lookupNode(stream.node, name);
          } catch (e) {
            // If the entry is not a directory, file, or symlink, nodefs
            // lookupNode will raise EINVAL. Skip these and continue.
            if (e?.errno === 28) {
              continue;
            }
            throw e;
          }
          id = child.id;
          type = FS.isChrdev(child.mode) ? 2 : // character device.
                 FS.isDir(child.mode) ? 4 :    // directory
                 FS.isLink(child.mode) ? 10 :   // symbolic link.
                 8;                            // regular file.
        }
        assert(id);
        HEAP64[((dirp + pos)>>3)] = BigInt(id);
        HEAP64[(((dirp + pos)+(8))>>3)] = BigInt((idx + 1) * struct_size);
        HEAP16[(((dirp + pos)+(16))>>1)] = 280;
        HEAP8[(dirp + pos)+(18)] = type;
        stringToUTF8(name, dirp + pos + 19, 256);
        pos += struct_size;
      }
      FS.llseek(stream, idx * struct_size, 0);
      return pos;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  
  
  function ___syscall_getsockname(fd, addr, addrlen, d1, d2, d3) {
  try {
  
      var sock = getSocketFromFD(fd);
      // TODO: sock.saddr should never be undefined, see TODO in websocket_sock_ops.getname
      var errno = writeSockaddr(addr, sock.family, DNS.lookup_name(sock.saddr || '0.0.0.0'), sock.sport, addrlen);
      assert(!errno);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_getsockopt(fd, level, optname, optval, optlen, d1) {
  try {
  
      var sock = getSocketFromFD(fd);
      // Minimal getsockopt aimed at resolving https://github.com/emscripten-core/emscripten/issues/2211
      // so only supports SOL_SOCKET with SO_ERROR.
      if (level === 1) {
        if (optname === 4) {
          HEAP32[((optval)>>2)] = sock.error;
          HEAP32[((optlen)>>2)] = 4;
          sock.error = null; // Clear the error (The SO_ERROR option obtains and then clears this field).
          return 0;
        }
      }
      return -50; // The option is unknown at the level indicated.
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  
  function ___syscall_ioctl(fd, op, varargs) {
  SYSCALLS.varargs = varargs;
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      switch (op) {
        case 21509: {
          if (!stream.tty) return -59;
          return 0;
        }
        case 21505: {
          if (!stream.tty) return -59;
          if (stream.tty.ops.ioctl_tcgets) {
            var termios = stream.tty.ops.ioctl_tcgets(stream);
            var argp = syscallGetVarargP();
            HEAP32[((argp)>>2)] = termios.c_iflag || 0;
            HEAP32[(((argp)+(4))>>2)] = termios.c_oflag || 0;
            HEAP32[(((argp)+(8))>>2)] = termios.c_cflag || 0;
            HEAP32[(((argp)+(12))>>2)] = termios.c_lflag || 0;
            for (var i = 0; i < 32; i++) {
              HEAP8[(argp + i)+(17)] = termios.c_cc[i] || 0;
            }
            return 0;
          }
          return 0;
        }
        case 21510:
        case 21511:
        case 21512: {
          if (!stream.tty) return -59;
          return 0; // no-op, not actually adjusting terminal settings
        }
        case 21506:
        case 21507:
        case 21508: {
          if (!stream.tty) return -59;
          if (stream.tty.ops.ioctl_tcsets) {
            var argp = syscallGetVarargP();
            var c_iflag = HEAP32[((argp)>>2)];
            var c_oflag = HEAP32[(((argp)+(4))>>2)];
            var c_cflag = HEAP32[(((argp)+(8))>>2)];
            var c_lflag = HEAP32[(((argp)+(12))>>2)];
            var c_cc = []
            for (var i = 0; i < 32; i++) {
              c_cc.push(HEAP8[(argp + i)+(17)]);
            }
            return stream.tty.ops.ioctl_tcsets(stream.tty, op, { c_iflag, c_oflag, c_cflag, c_lflag, c_cc });
          }
          return 0; // no-op, not actually adjusting terminal settings
        }
        case 21519: {
          if (!stream.tty) return -59;
          var argp = syscallGetVarargP();
          HEAP32[((argp)>>2)] = 0;
          return 0;
        }
        case 21520: {
          if (!stream.tty) return -59;
          return -28; // not supported
        }
        case 21537:
        case 21531: {
          var argp = syscallGetVarargP();
          return FS.ioctl(stream, op, argp);
        }
        case 21523: {
          // TODO: in theory we should write to the winsize struct that gets
          // passed in, but for now musl doesn't read anything on it
          if (!stream.tty) return -59;
          if (stream.tty.ops.ioctl_tiocgwinsz) {
            var winsize = stream.tty.ops.ioctl_tiocgwinsz(stream.tty);
            var argp = syscallGetVarargP();
            HEAP16[((argp)>>1)] = winsize[0];
            HEAP16[(((argp)+(2))>>1)] = winsize[1];
          }
          return 0;
        }
        case 21524: {
          // TODO: technically, this ioctl call should change the window size.
          // but, since emscripten doesn't have any concept of a terminal window
          // yet, we'll just silently throw it away as we do TIOCGWINSZ
          if (!stream.tty) return -59;
          return 0;
        }
        case 21515: {
          if (!stream.tty) return -59;
          return 0;
        }
        default: return -28; // not supported
      }
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_listen(fd, backlog) {
  try {
  
      var sock = getSocketFromFD(fd);
      sock.sock_ops.listen(sock, backlog);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_lstat64(path, buf) {
  try {
  
      path = SYSCALLS.getStr(path);
      return SYSCALLS.writeStat(buf, FS.lstat(path));
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_mkdirat(dirfd, path, mode) {
  try {
  
      path = SYSCALLS.getStr(path);
      path = SYSCALLS.calculateAt(dirfd, path);
      mode &= ~SYSCALLS.currentUmask;
      FS.mkdir(path, mode, 0);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_newfstatat(dirfd, path, buf, flags) {
  try {
  
      path = SYSCALLS.getStr(path);
      var nofollow = flags & 256;
      var allowEmpty = flags & 4096;
      flags = flags & (~6400);
      assert(!flags, `unknown flags in __syscall_newfstatat: ${flags}`);
      path = SYSCALLS.calculateAt(dirfd, path, allowEmpty);
      return SYSCALLS.writeStat(buf, nofollow ? FS.lstat(path) : FS.stat(path));
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  
  function ___syscall_openat(dirfd, path, flags, varargs) {
  SYSCALLS.varargs = varargs;
  try {
  
      path = SYSCALLS.getStr(path);
      path = SYSCALLS.calculateAt(dirfd, path);
      var mode = varargs ? syscallGetVarargI() : 0;
      if (flags & 64) {
        mode &= ~SYSCALLS.currentUmask;
      }
      return FS.open(path, flags, mode).fd;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  var PIPEFS = {
  BUCKET_BUFFER_SIZE:8192,
  mount(mount) {
        // Do not pollute the real root directory or its child nodes with pipes
        // Looks like it is OK to create another pseudo-root node not linked to the FS.root hierarchy this way
        return FS.createNode(null, '/', 16384 | 0o777, 0);
      },
  createPipe() {
        var pipe = {
          buckets: [],
          // refcnt 2 because pipe has a read end and a write end. We need to be
          // able to read from the read end after write end is closed.
          refcnt : 2,
          timestamp: new Date(),
        };
  
        pipe.buckets.push({
          buffer: new Uint8Array(PIPEFS.BUCKET_BUFFER_SIZE),
          offset: 0,
          roffset: 0
        });
  
        var rName = PIPEFS.nextname();
        var wName = PIPEFS.nextname();
        var rNode = FS.createNode(PIPEFS.root, rName, 4096, 0);
        var wNode = FS.createNode(PIPEFS.root, wName, 4096, 0);
  
        rNode.pipe = pipe;
        wNode.pipe = pipe;
  
        var readableStream = FS.createStream({
          path: rName,
          node: rNode,
          flags: 0,
          seekable: false,
          stream_ops: PIPEFS.stream_ops
        });
        rNode.stream = readableStream;
  
        var writableStream = FS.createStream({
          path: wName,
          node: wNode,
          flags: 1,
          seekable: false,
          stream_ops: PIPEFS.stream_ops
        });
        wNode.stream = writableStream;
  
        return {
          readable_fd: readableStream.fd,
          writable_fd: writableStream.fd
        };
      },
  stream_ops:{
  getattr(stream) {
          var node = stream.node;
          var timestamp = node.pipe.timestamp;
          return {
            dev: 14,
            ino: node.id,
            mode: 0o10600,
            nlink: 1,
            uid: 0,
            gid: 0,
            rdev: 0,
            size: 0,
            atime: timestamp,
            mtime: timestamp,
            ctime: timestamp,
            blksize: 4096,
            blocks: 0,
          };
        },
  poll(stream, timeout, notifyCallback) {
          var pipe = stream.node.pipe;
  
          if ((stream.flags & 2097155) === 1) {
            return (256 | 4);
          }
          for (var bucket of pipe.buckets) {
            if (bucket.offset - bucket.roffset > 0) {
              return (64 | 1);
            }
          }
  
          return 0;
        },
  dup(stream) {
          stream.node.pipe.refcnt++;
        },
  ioctl(stream, request, argp) {
          if (request == 21531) {
            var pipe = stream.node.pipe;
            var currentLength = 0;
            for (var bucket of pipe.buckets) {
              currentLength += bucket.offset - bucket.roffset;
            }
            HEAP32[((argp)>>2)] = currentLength;
            return 0;
          }
          return 28;
        },
  fsync(stream) {
          return 28;
        },
  read(stream, buffer, offset, length, position /* ignored */) {
          var pipe = stream.node.pipe;
          var currentLength = 0;
  
          for (var bucket of pipe.buckets) {
            currentLength += bucket.offset - bucket.roffset;
          }
  
          assert(buffer instanceof ArrayBuffer || ArrayBuffer.isView(buffer));
          var data = buffer.subarray(offset, offset + length);
  
          if (length <= 0) {
            return 0;
          }
          if (currentLength == 0) {
            // Behave as if the read end is always non-blocking
            throw new FS.ErrnoError(6);
          }
          var toRead = Math.min(currentLength, length);
  
          var totalRead = toRead;
          var toRemove = 0;
  
          for (var bucket of pipe.buckets) {
            var bucketSize = bucket.offset - bucket.roffset;
  
            if (toRead <= bucketSize) {
              var tmpSlice = bucket.buffer.subarray(bucket.roffset, bucket.offset);
              if (toRead < bucketSize) {
                tmpSlice = tmpSlice.subarray(0, toRead);
                bucket.roffset += toRead;
              } else {
                toRemove++;
              }
              data.set(tmpSlice);
              break;
            } else {
              var tmpSlice = bucket.buffer.subarray(bucket.roffset, bucket.offset);
              data.set(tmpSlice);
              data = data.subarray(tmpSlice.byteLength);
              toRead -= tmpSlice.byteLength;
              toRemove++;
            }
          }
  
          if (toRemove && toRemove == pipe.buckets.length) {
            // Do not generate excessive garbage in use cases such as
            // write several bytes, read everything, write several bytes, read everything...
            toRemove--;
            pipe.buckets[toRemove].offset = 0;
            pipe.buckets[toRemove].roffset = 0;
          }
  
          pipe.buckets.splice(0, toRemove);
  
          return totalRead;
        },
  write(stream, buffer, offset, length, position /* ignored */) {
          var pipe = stream.node.pipe;
  
          assert(buffer instanceof ArrayBuffer || ArrayBuffer.isView(buffer));
          var data = buffer.subarray(offset, offset + length);
  
          var dataLen = data.byteLength;
          if (dataLen <= 0) {
            return 0;
          }
  
          var currBucket = null;
  
          if (pipe.buckets.length == 0) {
            currBucket = {
              buffer: new Uint8Array(PIPEFS.BUCKET_BUFFER_SIZE),
              offset: 0,
              roffset: 0
            };
            pipe.buckets.push(currBucket);
          } else {
            currBucket = pipe.buckets[pipe.buckets.length - 1];
          }
  
          assert(currBucket.offset <= PIPEFS.BUCKET_BUFFER_SIZE);
  
          var freeBytesInCurrBuffer = PIPEFS.BUCKET_BUFFER_SIZE - currBucket.offset;
          if (freeBytesInCurrBuffer >= dataLen) {
            currBucket.buffer.set(data, currBucket.offset);
            currBucket.offset += dataLen;
            return dataLen;
          } else if (freeBytesInCurrBuffer > 0) {
            currBucket.buffer.set(data.subarray(0, freeBytesInCurrBuffer), currBucket.offset);
            currBucket.offset += freeBytesInCurrBuffer;
            data = data.subarray(freeBytesInCurrBuffer, data.byteLength);
          }
  
          var numBuckets = (data.byteLength / PIPEFS.BUCKET_BUFFER_SIZE) | 0;
          var remElements = data.byteLength % PIPEFS.BUCKET_BUFFER_SIZE;
  
          for (var i = 0; i < numBuckets; i++) {
            var newBucket = {
              buffer: new Uint8Array(PIPEFS.BUCKET_BUFFER_SIZE),
              offset: PIPEFS.BUCKET_BUFFER_SIZE,
              roffset: 0
            };
            pipe.buckets.push(newBucket);
            newBucket.buffer.set(data.subarray(0, PIPEFS.BUCKET_BUFFER_SIZE));
            data = data.subarray(PIPEFS.BUCKET_BUFFER_SIZE, data.byteLength);
          }
  
          if (remElements > 0) {
            var newBucket = {
              buffer: new Uint8Array(PIPEFS.BUCKET_BUFFER_SIZE),
              offset: data.byteLength,
              roffset: 0
            };
            pipe.buckets.push(newBucket);
            newBucket.buffer.set(data);
          }
  
          return dataLen;
        },
  close(stream) {
          var pipe = stream.node.pipe;
          pipe.refcnt--;
          if (pipe.refcnt === 0) {
            pipe.buckets = null;
          }
        },
  },
  nextname() {
        if (!PIPEFS.nextname.current) {
          PIPEFS.nextname.current = 0;
        }
        return 'pipe[' + (PIPEFS.nextname.current++) + ']';
      },
  };
  function ___syscall_pipe2(fdPtr, flags) {
  try {
  
      if (fdPtr == 0) {
        throw new FS.ErrnoError(21);
      }
      var validFlags = 524288 | 2048;
      if (flags & ~validFlags) {
        throw new FS.ErrnoError(138);
      }
  
      var res = PIPEFS.createPipe();
  
      if (flags & 2048) {
        FS.getStream(res.readable_fd).flags |= 2048;
        FS.getStream(res.writable_fd).flags |= 2048;
      }
  
      HEAP32[((fdPtr)>>2)] = res.readable_fd;
      HEAP32[(((fdPtr)+(4))>>2)] = res.writable_fd;
  
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_poll(fds, nfds, timeout) {
  try {
  
  
      var count = 0;
      for (var i = 0; i < nfds; i++) {
        var pollfd = fds + 8 * i;
        var fd = HEAP32[((pollfd)>>2)];
        var events = HEAP16[(((pollfd)+(4))>>1)];
        var flags = 32;
        var stream = FS.getStream(fd);
        if (stream) {
          if (stream.stream_ops.poll) {
            flags = stream.stream_ops.poll(stream, -1);
          } else {
            flags = 5;
          }
        }
        flags &= events | 8 | 16;
        if (flags) count++;
        HEAP16[(((pollfd)+(6))>>1)] = flags;
      }
  
      if (!count && timeout != 0) warnOnce('non-zero poll() timeout not supported: ' + timeout)
      return count;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  
  
  function ___syscall_readlinkat(dirfd, path, buf, bufsize) {
  try {
  
      path = SYSCALLS.getStr(path);
      path = SYSCALLS.calculateAt(dirfd, path);
      if (bufsize <= 0) return -28;
      var ret = FS.readlink(path);
  
      var len = Math.min(bufsize, lengthBytesUTF8(ret));
      var endChar = HEAP8[buf+len];
      stringToUTF8(ret, buf, bufsize+1);
      // readlink is one of the rare functions that write out a C string, but does never append a null to the output buffer(!)
      // stringToUTF8() always appends a null byte, so restore the character under the null byte after the write.
      HEAP8[buf+len] = endChar;
      return len;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  
  
  function ___syscall_recvfrom(fd, buf, len, flags, addr, addrlen) {
  try {
  
      var sock = getSocketFromFD(fd);
      var msg = sock.sock_ops.recvmsg(sock, len);
      if (!msg) return 0; // socket is closed
      if (addr) {
        var errno = writeSockaddr(addr, sock.family, DNS.lookup_name(msg.addr), msg.port, addrlen);
        assert(!errno);
      }
      HEAPU8.set(msg.buffer, buf);
      return msg.buffer.byteLength;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_renameat(olddirfd, oldpath, newdirfd, newpath) {
  try {
  
      oldpath = SYSCALLS.getStr(oldpath);
      newpath = SYSCALLS.getStr(newpath);
      oldpath = SYSCALLS.calculateAt(olddirfd, oldpath);
      newpath = SYSCALLS.calculateAt(newdirfd, newpath);
      FS.rename(oldpath, newpath);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_rmdir(path) {
  try {
  
      path = SYSCALLS.getStr(path);
      FS.rmdir(path);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  
  function ___syscall_sendto(fd, message, length, flags, addr, addr_len) {
  try {
  
      var sock = getSocketFromFD(fd);
      if (!addr) {
        // send, no address provided
        return FS.write(sock.stream, HEAP8, message, length);
      }
      var dest = getSocketAddress(addr, addr_len);
      // sendto an address
      return sock.sock_ops.sendmsg(sock, HEAP8, message, length, dest.addr, dest.port);
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_socket(domain, type, protocol) {
  try {
  
      var sock = SOCKFS.createSocket(domain, type, protocol);
      assert(sock.stream.fd < 64); // XXX ? select() assumes socket fd values are in 0..63
      return sock.stream.fd;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_stat64(path, buf) {
  try {
  
      path = SYSCALLS.getStr(path);
      return SYSCALLS.writeStat(buf, FS.stat(path));
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_statfs64(path, size, buf) {
  try {
  
      assert(size === 88);
      SYSCALLS.writeStatFs(buf, FS.statfs(SYSCALLS.getStr(path)));
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_symlinkat(target, dirfd, linkpath) {
  try {
  
      target = SYSCALLS.getStr(target);
      linkpath = SYSCALLS.getStr(linkpath);
      linkpath = SYSCALLS.calculateAt(dirfd, linkpath);
      FS.symlink(target, linkpath);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_umask(mask) {
  try {
  
      var old = SYSCALLS.currentUmask;
      SYSCALLS.currentUmask = mask;
      return old;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  function ___syscall_unlinkat(dirfd, path, flags) {
  try {
  
      path = SYSCALLS.getStr(path);
      path = SYSCALLS.calculateAt(dirfd, path);
      if (!flags) {
        FS.unlink(path);
      } else if (flags === 512) {
        FS.rmdir(path);
      } else {
        return -28;
      }
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  var readI53FromI64 = (ptr) => {
      return HEAPU32[((ptr)>>2)] + HEAP32[(((ptr)+(4))>>2)] * 4294967296;
    };
  
  function ___syscall_utimensat(dirfd, path, times, flags) {
  try {
  
      path = SYSCALLS.getStr(path);
      assert(!flags);
      path = SYSCALLS.calculateAt(dirfd, path, true);
      var now = Date.now(), atime, mtime;
      if (!times) {
        atime = now;
        mtime = now;
      } else {
        var seconds = readI53FromI64(times);
        var nanoseconds = HEAP32[(((times)+(8))>>2)];
        if (nanoseconds == 1073741823) {
          atime = now;
        } else if (nanoseconds == 1073741822) {
          atime = null;
        } else {
          atime = (seconds*1000) + (nanoseconds/(1000*1000));
        }
        times += 16;
        seconds = readI53FromI64(times);
        nanoseconds = HEAP32[(((times)+(8))>>2)];
        if (nanoseconds == 1073741823) {
          mtime = now;
        } else if (nanoseconds == 1073741822) {
          mtime = null;
        } else {
          mtime = (seconds*1000) + (nanoseconds/(1000*1000));
        }
      }
      // null here means UTIME_OMIT was passed. If both were set to UTIME_OMIT then
      // we can skip the call completely.
      if ((mtime ?? atime) !== null) {
        FS.utime(path, atime, mtime);
      }
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }
  

  var __abort_js = () =>
      abort('native code called abort()');

  var runtimeKeepaliveCounter = 0;
  var __emscripten_runtime_keepalive_clear = () => {
      noExitRuntime = false;
      runtimeKeepaliveCounter = 0;
    };

  var __emscripten_throw_longjmp = () => {
      throw new EmscriptenSjLj;
    };

  function __gmtime_js(time, tmPtr) {
    time = bigintToI53Checked(time);
  
  
      var date = new Date(time * 1000);
      HEAP32[((tmPtr)>>2)] = date.getUTCSeconds();
      HEAP32[(((tmPtr)+(4))>>2)] = date.getUTCMinutes();
      HEAP32[(((tmPtr)+(8))>>2)] = date.getUTCHours();
      HEAP32[(((tmPtr)+(12))>>2)] = date.getUTCDate();
      HEAP32[(((tmPtr)+(16))>>2)] = date.getUTCMonth();
      HEAP32[(((tmPtr)+(20))>>2)] = date.getUTCFullYear()-1900;
      HEAP32[(((tmPtr)+(24))>>2)] = date.getUTCDay();
      var start = Date.UTC(date.getUTCFullYear(), 0, 1, 0, 0, 0, 0);
      var yday = ((date.getTime() - start) / (1000 * 60 * 60 * 24))|0;
      HEAP32[(((tmPtr)+(28))>>2)] = yday;
    ;
  }

  var isLeapYear = (year) => year%4 === 0 && (year%100 !== 0 || year%400 === 0);
  
  var MONTH_DAYS_LEAP_CUMULATIVE = [0,31,60,91,121,152,182,213,244,274,305,335];
  
  var MONTH_DAYS_REGULAR_CUMULATIVE = [0,31,59,90,120,151,181,212,243,273,304,334];
  var ydayFromDate = (date) => {
      var leap = isLeapYear(date.getFullYear());
      var monthDaysCumulative = (leap ? MONTH_DAYS_LEAP_CUMULATIVE : MONTH_DAYS_REGULAR_CUMULATIVE);
      var yday = monthDaysCumulative[date.getMonth()] + date.getDate() - 1; // -1 since it's days since Jan 1
  
      return yday;
    };
  
  function __localtime_js(time, tmPtr) {
    time = bigintToI53Checked(time);
  
  
      var date = new Date(time*1000);
      HEAP32[((tmPtr)>>2)] = date.getSeconds();
      HEAP32[(((tmPtr)+(4))>>2)] = date.getMinutes();
      HEAP32[(((tmPtr)+(8))>>2)] = date.getHours();
      HEAP32[(((tmPtr)+(12))>>2)] = date.getDate();
      HEAP32[(((tmPtr)+(16))>>2)] = date.getMonth();
      HEAP32[(((tmPtr)+(20))>>2)] = date.getFullYear()-1900;
      HEAP32[(((tmPtr)+(24))>>2)] = date.getDay();
  
      var yday = ydayFromDate(date)|0;
      HEAP32[(((tmPtr)+(28))>>2)] = yday;
      HEAP32[(((tmPtr)+(36))>>2)] = -(date.getTimezoneOffset() * 60);
  
      // Attention: DST is in December in South, and some regions don't have DST at all.
      var start = new Date(date.getFullYear(), 0, 1);
      var summerOffset = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
      var winterOffset = start.getTimezoneOffset();
      var dst = (summerOffset != winterOffset && date.getTimezoneOffset() == Math.min(winterOffset, summerOffset))|0;
      HEAP32[(((tmPtr)+(32))>>2)] = dst;
    ;
  }

  var timers = {
  };
  
  var clearTimers = () => {
      for (var t of Object.values(timers)) {
        clearTimeout(t.id);
      }
    };
  
  var handleException = (e) => {
      // Certain exception types we do not treat as errors since they are used for
      // internal control flow.
      // 1. ExitStatus, which is thrown by exit()
      // 2. "unwind", which is thrown by emscripten_unwind_to_js_event_loop() and others
      //    that wish to return to JS event loop.
      if (e instanceof ExitStatus || e == 'unwind') {
        return EXITSTATUS;
      }
      checkStackCookie();
      if (e instanceof WebAssembly.RuntimeError) {
        if (_emscripten_stack_get_current() <= 0) {
          err('Stack overflow detected.  You can try increasing -sSTACK_SIZE (currently set to 67108864)');
        }
      }
      quit_(1, e);
    };
  
  
  var keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0;
  var _proc_exit = (code) => {
      EXITSTATUS = code;
      if (!keepRuntimeAlive()) {
        Module['onExit']?.(code);
        ABORT = true;
      }
      quit_(code, new ExitStatus(code));
    };
  
  
  /** @param {boolean|number=} implicit */
  var exitJS = (status, implicit) => {
      EXITSTATUS = status;
  
      checkUnflushedContent();
  
      // if exit() was called explicitly, warn the user if the runtime isn't actually being shut down
      if (keepRuntimeAlive() && !implicit) {
        var msg = `program exited (with status: ${status}), but keepRuntimeAlive() is set (counter=${runtimeKeepaliveCounter}) due to an async operation, so halting execution but not exiting the runtime or preventing further async execution (you can use emscripten_force_exit, if you want to force a true shutdown)`;
        err(msg);
      }
  
      _proc_exit(status);
    };
  var _exit = exitJS;
  
  
  var maybeExit = () => {
      if (!keepRuntimeAlive()) {
        try {
          _exit(EXITSTATUS);
        } catch (e) {
          handleException(e);
        }
      }
    };
  var callUserCallback = (func) => {
      if (ABORT) {
        err('user callback triggered after runtime exited or application aborted.  Ignoring.');
        return;
      }
      try {
        return func();
      } catch (e) {
        handleException(e);
      } finally {
        maybeExit();
      }
    };
  
  
  var _emscripten_get_now = () => performance.now();
  var __setitimer_js = (which, timeout_ms) => {
      // First, clear any existing timer.
      if (timers[which]) {
        clearTimeout(timers[which].id);
        delete timers[which];
      }
  
      // A timeout of zero simply cancels the current timeout so we have nothing
      // more to do.
      if (!timeout_ms) return 0;
  
      var id = setTimeout(() => {
        assert(which in timers);
        delete timers[which];
        callUserCallback(() => __emscripten_timeout(which, _emscripten_get_now()));
      }, timeout_ms);
      timers[which] = { id, timeout_ms };
      return 0;
    };

  
  var __tzset_js = (timezone, daylight, std_name, dst_name) => {
      // TODO: Use (malleable) environment variables instead of system settings.
      var currentYear = new Date().getFullYear();
      var winter = new Date(currentYear, 0, 1);
      var summer = new Date(currentYear, 6, 1);
      var winterOffset = winter.getTimezoneOffset();
      var summerOffset = summer.getTimezoneOffset();
  
      // Local standard timezone offset. Local standard time is not adjusted for
      // daylight savings.  This code uses the fact that getTimezoneOffset returns
      // a greater value during Standard Time versus Daylight Saving Time (DST).
      // Thus it determines the expected output during Standard Time, and it
      // compares whether the output of the given date the same (Standard) or less
      // (DST).
      var stdTimezoneOffset = Math.max(winterOffset, summerOffset);
  
      // timezone is specified as seconds west of UTC ("The external variable
      // `timezone` shall be set to the difference, in seconds, between
      // Coordinated Universal Time (UTC) and local standard time."), the same
      // as returned by stdTimezoneOffset.
      // See http://pubs.opengroup.org/onlinepubs/009695399/functions/tzset.html
      HEAPU32[((timezone)>>2)] = stdTimezoneOffset * 60;
  
      HEAP32[((daylight)>>2)] = Number(winterOffset != summerOffset);
  
      var extractZone = (timezoneOffset) => {
        // Why inverse sign?
        // Read here https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/getTimezoneOffset
        var sign = timezoneOffset >= 0 ? "-" : "+";
  
        var absOffset = Math.abs(timezoneOffset)
        var hours = String(Math.floor(absOffset / 60)).padStart(2, "0");
        var minutes = String(absOffset % 60).padStart(2, "0");
  
        return `UTC${sign}${hours}${minutes}`;
      }
  
      var winterName = extractZone(winterOffset);
      var summerName = extractZone(summerOffset);
      assert(winterName);
      assert(summerName);
      assert(lengthBytesUTF8(winterName) <= 16, `timezone name truncated to fit in TZNAME_MAX (${winterName})`);
      assert(lengthBytesUTF8(summerName) <= 16, `timezone name truncated to fit in TZNAME_MAX (${summerName})`);
      if (summerOffset < winterOffset) {
        // Northern hemisphere
        stringToUTF8(winterName, std_name, 17);
        stringToUTF8(summerName, dst_name, 17);
      } else {
        stringToUTF8(winterName, dst_name, 17);
        stringToUTF8(summerName, std_name, 17);
      }
    };

  
  var _emscripten_date_now = () => Date.now();
  
  var nowIsMonotonic = 1;
  
  var checkWasiClock = (clock_id) => clock_id >= 0 && clock_id <= 3;
  
  function _clock_time_get(clk_id, ignored_precision, ptime) {
    ignored_precision = bigintToI53Checked(ignored_precision);
  
  
      if (!checkWasiClock(clk_id)) {
        return 28;
      }
      var now;
      // all wasi clocks but realtime are monotonic
      if (clk_id === 0) {
        now = _emscripten_date_now();
      } else if (nowIsMonotonic) {
        now = _emscripten_get_now();
      } else {
        return 52;
      }
      // "now" is in ms, and wasi times are in ns.
      var nsec = Math.round(now * 1000 * 1000);
      HEAP64[((ptime)>>3)] = BigInt(nsec);
      return 0;
    ;
  }

  var _emscripten_err = (str) => err(UTF8ToString(str));

  var getHeapMax = () =>
      // Stay one Wasm page short of 4GB: while e.g. Chrome is able to allocate
      // full 4GB Wasm memories, the size will wrap back to 0 bytes in Wasm side
      // for any code that deals with heap sizes, which would require special
      // casing all heap size related code to treat 0 specially.
      2147483648;
  var _emscripten_get_heap_max = () => getHeapMax();


  
  var alignMemory = (size, alignment) => {
      assert(alignment, "alignment argument is required");
      return Math.ceil(size / alignment) * alignment;
    };
  
  var growMemory = (size) => {
      var oldHeapSize = wasmMemory.buffer.byteLength;
      var pages = ((size - oldHeapSize + 65535) / 65536) | 0;
      try {
        // round size grow request up to wasm page size (fixed 64KB per spec)
        wasmMemory.grow(pages); // .grow() takes a delta compared to the previous size
        updateMemoryViews();
        return 1 /*success*/;
      } catch(e) {
        err(`growMemory: Attempted to grow heap from ${oldHeapSize} bytes to ${size} bytes, but got error: ${e}`);
      }
      // implicit 0 return to save code size (caller will cast "undefined" into 0
      // anyhow)
    };
  var _emscripten_resize_heap = (requestedSize) => {
      var oldSize = HEAPU8.length;
      // With CAN_ADDRESS_2GB or MEMORY64, pointers are already unsigned.
      requestedSize >>>= 0;
      // With multithreaded builds, races can happen (another thread might increase the size
      // in between), so return a failure, and let the caller retry.
      assert(requestedSize > oldSize);
  
      // Memory resize rules:
      // 1.  Always increase heap size to at least the requested size, rounded up
      //     to next page multiple.
      // 2a. If MEMORY_GROWTH_LINEAR_STEP == -1, excessively resize the heap
      //     geometrically: increase the heap size according to
      //     MEMORY_GROWTH_GEOMETRIC_STEP factor (default +20%), At most
      //     overreserve by MEMORY_GROWTH_GEOMETRIC_CAP bytes (default 96MB).
      // 2b. If MEMORY_GROWTH_LINEAR_STEP != -1, excessively resize the heap
      //     linearly: increase the heap size by at least
      //     MEMORY_GROWTH_LINEAR_STEP bytes.
      // 3.  Max size for the heap is capped at 2048MB-WASM_PAGE_SIZE, or by
      //     MAXIMUM_MEMORY, or by ASAN limit, depending on which is smallest
      // 4.  If we were unable to allocate as much memory, it may be due to
      //     over-eager decision to excessively reserve due to (3) above.
      //     Hence if an allocation fails, cut down on the amount of excess
      //     growth, in an attempt to succeed to perform a smaller allocation.
  
      // A limit is set for how much we can grow. We should not exceed that
      // (the wasm binary specifies it, so if we tried, we'd fail anyhow).
      var maxHeapSize = getHeapMax();
      if (requestedSize > maxHeapSize) {
        err(`Cannot enlarge memory, requested ${requestedSize} bytes, but the limit is ${maxHeapSize} bytes!`);
        return false;
      }
  
      // Loop through potential heap size increases. If we attempt a too eager
      // reservation that fails, cut down on the attempted size and reserve a
      // smaller bump instead. (max 3 times, chosen somewhat arbitrarily)
      for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
        var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown); // ensure geometric growth
        // but limit overreserving (default to capping at +96MB overgrowth at most)
        overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296 );
  
        var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
  
        var replacement = growMemory(newSize);
        if (replacement) {
  
          return true;
        }
      }
      err(`Failed to grow the heap from ${oldSize} bytes to ${newSize} bytes, not enough memory!`);
      return false;
    };

  var ENV = {
  };
  
  var getExecutableName = () => thisProgram || './this.program';
  var getEnvStrings = () => {
      if (!getEnvStrings.strings) {
        // Default values.
        var lang = (globalThis.navigator?.language ?? 'C').replace('-', '_') + '.UTF-8';
        var env = {
          'USER': 'web_user',
          'LOGNAME': 'web_user',
          'PATH': '/',
          'PWD': '/',
          'HOME': '/home/web_user',
          'LANG': lang,
          '_': getExecutableName()
        };
        // Apply the user-provided values, if any.
        for (var x in ENV) {
          // x is a key in ENV; if ENV[x] is undefined, that means it was
          // explicitly set to be so. We allow user code to do that to
          // force variables with default values to remain unset.
          if (ENV[x] === undefined) delete env[x];
          else env[x] = ENV[x];
        }
        var strings = [];
        for (var x in env) {
          strings.push(`${x}=${env[x]}`);
        }
        getEnvStrings.strings = strings;
      }
      return getEnvStrings.strings;
    };
  
  var _environ_get = (__environ, environ_buf) => {
      var bufSize = 0;
      var envp = 0;
      for (var string of getEnvStrings()) {
        var ptr = environ_buf + bufSize;
        HEAPU32[(((__environ)+(envp))>>2)] = ptr;
        bufSize += stringToUTF8(string, ptr, Infinity) + 1;
        envp += 4;
      }
      return 0;
    };

  
  var _environ_sizes_get = (penviron_count, penviron_buf_size) => {
      var strings = getEnvStrings();
      HEAPU32[((penviron_count)>>2)] = strings.length;
      var bufSize = 0;
      for (var string of strings) {
        bufSize += lengthBytesUTF8(string) + 1;
      }
      HEAPU32[((penviron_buf_size)>>2)] = bufSize;
      return 0;
    };


  function _fd_close(fd) {
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      FS.close(stream);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  }
  

  function _fd_fdstat_get(fd, pbuf) {
  try {
  
      var rightsBase = 0;
      var rightsInheriting = 0;
      var flags = 0;
      {
        var stream = SYSCALLS.getStreamFromFD(fd);
        // All character devices are terminals (other things a Linux system would
        // assume is a character device, like the mouse, we have special APIs for).
        var type = stream.tty ? 2 :
                   FS.isDir(stream.mode) ? 3 :
                   FS.isLink(stream.mode) ? 7 :
                   4;
      }
      HEAP8[pbuf] = type;
      HEAP16[(((pbuf)+(2))>>1)] = flags;
      HEAP64[(((pbuf)+(8))>>3)] = BigInt(rightsBase);
      HEAP64[(((pbuf)+(16))>>3)] = BigInt(rightsInheriting);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  }
  

  /** @param {number=} offset */
  var doReadv = (stream, iov, iovcnt, offset) => {
      var ret = 0;
      for (var i = 0; i < iovcnt; i++) {
        var ptr = HEAPU32[((iov)>>2)];
        var len = HEAPU32[(((iov)+(4))>>2)];
        iov += 8;
        var curr = FS.read(stream, HEAP8, ptr, len, offset);
        if (curr < 0) return -1;
        ret += curr;
        if (curr < len) break; // nothing more to read
        if (typeof offset != 'undefined') {
          offset += curr;
        }
      }
      return ret;
    };
  
  function _fd_read(fd, iov, iovcnt, pnum) {
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      var num = doReadv(stream, iov, iovcnt);
      HEAPU32[((pnum)>>2)] = num;
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  }
  

  
  function _fd_seek(fd, offset, whence, newOffset) {
    offset = bigintToI53Checked(offset);
  
  
  try {
  
      if (isNaN(offset)) return 22;
      var stream = SYSCALLS.getStreamFromFD(fd);
      FS.llseek(stream, offset, whence);
      HEAP64[((newOffset)>>3)] = BigInt(stream.position);
      if (stream.getdents && offset === 0 && whence === 0) stream.getdents = null; // reset readdir state
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  ;
  }

  function _fd_sync(fd) {
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      var rtn = stream.stream_ops?.fsync?.(stream);
      return rtn;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  }
  

  /** @param {number=} offset */
  var doWritev = (stream, iov, iovcnt, offset) => {
      var ret = 0;
      for (var i = 0; i < iovcnt; i++) {
        var ptr = HEAPU32[((iov)>>2)];
        var len = HEAPU32[(((iov)+(4))>>2)];
        iov += 8;
        var curr = FS.write(stream, HEAP8, ptr, len, offset);
        if (curr < 0) return -1;
        ret += curr;
        if (curr < len) {
          // No more space to write.
          break;
        }
        if (typeof offset != 'undefined') {
          offset += curr;
        }
      }
      return ret;
    };
  
  function _fd_write(fd, iov, iovcnt, pnum) {
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      var num = doWritev(stream, iov, iovcnt);
      HEAPU32[((pnum)>>2)] = num;
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  }
  

  
  
  
  
  
  
  
  
  var _getaddrinfo = (node, service, hint, out) => {
      // Note getaddrinfo currently only returns a single addrinfo with ai_next defaulting to NULL. When NULL
      // hints are specified or ai_family set to AF_UNSPEC or ai_socktype or ai_protocol set to 0 then we
      // really should provide a linked list of suitable addrinfo values.
      var addrs = [];
      var canon = null;
      var addr = 0;
      var port = 0;
      var flags = 0;
      var family = 0;
      var type = 0;
      var proto = 0;
      var ai, last;
  
      function allocaddrinfo(family, type, proto, canon, addr, port) {
        var sa, salen, ai;
        var errno;
  
        salen = family === 10 ?
          28 :
          16;
        addr = family === 10 ?
          inetNtop6(addr) :
          inetNtop4(addr);
        sa = _malloc(salen);
        errno = writeSockaddr(sa, family, addr, port);
        assert(!errno);
  
        ai = _malloc(32);
        HEAP32[(((ai)+(4))>>2)] = family;
        HEAP32[(((ai)+(8))>>2)] = type;
        HEAP32[(((ai)+(12))>>2)] = proto;
        HEAPU32[(((ai)+(24))>>2)] = canon;
        HEAPU32[(((ai)+(20))>>2)] = sa;
        if (family === 10) {
          HEAP32[(((ai)+(16))>>2)] = 28;
        } else {
          HEAP32[(((ai)+(16))>>2)] = 16;
        }
        HEAP32[(((ai)+(28))>>2)] = 0;
  
        return ai;
      }
  
      if (hint) {
        flags = HEAP32[((hint)>>2)];
        family = HEAP32[(((hint)+(4))>>2)];
        type = HEAP32[(((hint)+(8))>>2)];
        proto = HEAP32[(((hint)+(12))>>2)];
      }
      if (type && !proto) {
        proto = type === 2 ? 17 : 6;
      }
      if (!type && proto) {
        type = proto === 17 ? 2 : 1;
      }
  
      // If type or proto are set to zero in hints we should really be returning multiple addrinfo values, but for
      // now default to a TCP STREAM socket so we can at least return a sensible addrinfo given NULL hints.
      if (proto === 0) {
        proto = 6;
      }
      if (type === 0) {
        type = 1;
      }
  
      if (!node && !service) {
        return -2;
      }
      if (flags & ~(1|2|4|
          1024|8|16|32)) {
        return -1;
      }
      if (hint !== 0 && (HEAP32[((hint)>>2)] & 2) && !node) {
        return -1;
      }
      if (flags & 32) {
        // TODO
        return -2;
      }
      if (type !== 0 && type !== 1 && type !== 2) {
        return -7;
      }
      if (family !== 0 && family !== 2 && family !== 10) {
        return -6;
      }
  
      if (service) {
        service = UTF8ToString(service);
        port = parseInt(service, 10);
  
        if (isNaN(port)) {
          if (flags & 1024) {
            return -2;
          }
          // TODO support resolving well-known service names from:
          // http://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.txt
          return -8;
        }
      }
  
      if (!node) {
        if (family === 0) {
          family = 2;
        }
        if ((flags & 1) === 0) {
          if (family === 2) {
            addr = _htonl(2130706433);
          } else {
            addr = [0, 0, 0, _htonl(1)];
          }
        }
        ai = allocaddrinfo(family, type, proto, null, addr, port);
        HEAPU32[((out)>>2)] = ai;
        return 0;
      }
  
      //
      // try as a numeric address
      //
      node = UTF8ToString(node);
      addr = inetPton4(node);
      if (addr !== null) {
        // incoming node is a valid ipv4 address
        if (family === 0 || family === 2) {
          family = 2;
        }
        else if (family === 10 && (flags & 8)) {
          addr = [0, 0, _htonl(0xffff), addr];
          family = 10;
        } else {
          return -2;
        }
      } else {
        addr = inetPton6(node);
        if (addr !== null) {
          // incoming node is a valid ipv6 address
          if (family === 0 || family === 10) {
            family = 10;
          } else {
            return -2;
          }
        }
      }
      if (addr != null) {
        ai = allocaddrinfo(family, type, proto, node, addr, port);
        HEAPU32[((out)>>2)] = ai;
        return 0;
      }
      if (flags & 4) {
        return -2;
      }
  
      //
      // try as a hostname
      //
      // resolve the hostname to a temporary fake address
      node = DNS.lookup_name(node);
      addr = inetPton4(node);
      if (family === 0) {
        family = 2;
      } else if (family === 10) {
        addr = [0, 0, _htonl(0xffff), addr];
      }
      ai = allocaddrinfo(family, type, proto, null, addr, port);
      HEAPU32[((out)>>2)] = ai;
      return 0;
    };


  function _wasmacs_host_flush_terminal_output() {
      var outBytes = globalThis.__wasmacsTerminalOutputBytes || [];
      var sentCount = globalThis.__wasmacsSentOutputCount || 0;
      if (outBytes.length > sentCount) {
        var newBytes = Array.prototype.slice.call(outBytes, sentCount);
        globalThis.__wasmacsSentOutputCount = outBytes.length;
        if (typeof self !== "undefined" && typeof self.postMessage === "function") {
          self.postMessage({ type: "terminal-output-bytes", bytes: newBytes });
        }
      }
    }

  
  var wasmacs_atomics_env = {
  };
  function _wasmacs_host_terminal_resize_ack() {
      var sab = globalThis.__wasmacsTerminalSizeSAB;
      if (!sab) return 0;
      var signal = new Int32Array(sab);
      globalThis.__wasmacsTerminalResizeSeen = Atomics.load(signal, 0);
      globalThis.__wasmacsTerminalCols = Atomics.load(signal, 1) || globalThis.__wasmacsTerminalCols || 80;
      globalThis.__wasmacsTerminalRows = Atomics.load(signal, 2) || globalThis.__wasmacsTerminalRows || 24;
      if (globalThis.__wasmacsDiagnosticLog && typeof self !== "undefined" && typeof self.postMessage === "function") {
        try {
          self.postMessage({
            type: "terminal-resized",
            cols: globalThis.__wasmacsTerminalCols,
            rows: globalThis.__wasmacsTerminalRows,
            version: globalThis.__wasmacsTerminalResizeSeen,
          });
        } catch(e) {}
      }
      return 0;
    }

  function _wasmacs_host_terminal_resize_cols() {
      var sab = globalThis.__wasmacsTerminalSizeSAB;
      if (!sab) return globalThis.__wasmacsTerminalCols || 80;
      var signal = new Int32Array(sab);
      return Atomics.load(signal, 1) || globalThis.__wasmacsTerminalCols || 80;
    }

  function _wasmacs_host_terminal_resize_pending() {
      var sab = globalThis.__wasmacsTerminalSizeSAB;
      if (!sab) return 0;
      var signal = new Int32Array(sab);
      return Atomics.load(signal, 0) !== (globalThis.__wasmacsTerminalResizeSeen || 0) ? 1 : 0;
    }

  function _wasmacs_host_terminal_resize_rows() {
      var sab = globalThis.__wasmacsTerminalSizeSAB;
      if (!sab) return globalThis.__wasmacsTerminalRows || 24;
      var signal = new Int32Array(sab);
      return Atomics.load(signal, 2) || globalThis.__wasmacsTerminalRows || 24;
    }

  
  
  function _wasmacs_host_wait_for_input(timeout_ms) {
      var tEnter = Date.now();
      globalThis.__wasmacsHostWaitForInputCount =
        (globalThis.__wasmacsHostWaitForInputCount || 0) + 1;
      var waitNum = globalThis.__wasmacsHostWaitForInputCount;
  
      // ── 1. Flush pending terminal output ────────────────────────
      _wasmacs_host_flush_terminal_output();
  
      // ── 2. Block via Atomics.wait ────────────────────────────────
      // Return codes: 0=timeout (scheduler wake), 1=input, 2=resize, -1=no SAB
      var sab = globalThis.__wasmacsInputSAB;
      if (!sab) return -1;
      var signal = new Int32Array(sab, 0, 2);
  
      // timeout_ms is derived from Emacs timer_check() in keyboard.c.
      // Fall back to 50ms if not provided (e.g. diagnostic callers).
      var timeoutMs = (timeout_ms > 0) ? timeout_ms : 50;
  
      for (;;) {
        var lastSeen = Atomics.load(signal, 0);
        if (Atomics.load(signal, 1) > 0) break;
        if (typeof self !== "undefined" && typeof self.postMessage === "function") {
          try {
            self.postMessage({
              type: "timing-wait-enter",
              waitNum: waitNum,
              ts: Date.now(),
              queueLen: (globalThis.__wasmacsTerminalInputBytes || []).length,
              outLen: (globalThis.__wasmacsTerminalOutputBytes || []).length,
              fioCalls: globalThis.__wasmacsFionreadCallCount || 0,
            });
          } catch(e) {}
        }
        var result = Atomics.wait(signal, 0, lastSeen, timeoutMs);
        if (result === "timed-out") {
          return 0; // WASMACS_WAIT_TIMEOUT — let C run timer_check()
        }
        if (globalThis.__wasmacsTerminalSizeSAB) {
          try {
            var sizeSignal = new Int32Array(globalThis.__wasmacsTerminalSizeSAB);
            if (Atomics.load(sizeSignal, 0) !== (globalThis.__wasmacsTerminalResizeSeen || 0))
              return 2; // WASMACS_WAIT_RESIZE
          } catch(e) {}
        }
        if (result === "ok" || Atomics.load(signal, 1) > 0) break;
      }
  
      // ── 3. Populate terminal input queue ─────────────────────────
      var byteCount = Atomics.load(signal, 1);
      if (byteCount > 0) {
        var data = new Uint8Array(sab, 8, byteCount);
        var queue = globalThis.__wasmacsTerminalInputBytes;
        for (var i = 0; i < byteCount; i++) queue.push(data[i]);
        Atomics.store(signal, 1, 0);
      }
  
      // ── 4. Timing diagnostic ─────────────────────────────────────
      if (globalThis.__wasmacsDiagnosticLog && typeof self !== "undefined" && typeof self.postMessage === "function") {
        try {
          var s0 = FS.getStream(0);
          self.postMessage({
            type: "timing",
            waitNum: waitNum,
            ts: Date.now(),
            totalMs: Date.now() - tEnter,
            byteCount: byteCount,
            queueLen: (globalThis.__wasmacsTerminalInputBytes||[]).length,
            fioCalls: globalThis.__wasmacsFionreadCallCount || 0,
            s0ioctl: s0 && s0.stream_ops ? typeof s0.stream_ops.ioctl : "no-stream",
          });
        } catch(e) {}
      }
      return 1; // WASMACS_WAIT_INPUT
    }

  function _wasmacs_os_timing_checkpoint(code) {
      if (typeof self !== "undefined" && typeof self.postMessage === "function") {
        try {
          self.postMessage({
            type: "os-timing-checkpoint",
            code: code,
            ts: Date.now(),
            queueLen: (globalThis.__wasmacsTerminalInputBytes || []).length,
            outLen: (globalThis.__wasmacsTerminalOutputBytes || []).length,
          });
        } catch(e) {}
      }
    }



  
  
  var stackAlloc = (sz) => __emscripten_stack_alloc(sz);
  var stringToUTF8OnStack = (str) => {
      var size = lengthBytesUTF8(str) + 1;
      var ret = stackAlloc(size);
      stringToUTF8(str, ret, size);
      return ret;
    };



  var getCFunc = (ident) => {
      var func = Module['_' + ident]; // closure exported function
      assert(func, `Cannot call unknown function ${ident}, make sure it is exported`);
      return func;
    };
  
  var writeArrayToMemory = (array, buffer) => {
      assert(array.length >= 0, 'writeArrayToMemory array must have a length (should be an array or typed array)')
      HEAP8.set(array, buffer);
    };
  
  
  
  
  
  
    /**
   * @param {string|null=} returnType
   * @param {Array=} argTypes
   * @param {Array=} args
   * @param {Object=} opts
   */
  var ccall = (ident, returnType, argTypes, args, opts) => {
      // For fast lookup of conversion functions
      var toC = {
        'string': (str) => {
          var ret = 0;
          if (str !== null && str !== undefined && str !== 0) { // null string
            ret = stringToUTF8OnStack(str);
          }
          return ret;
        },
        'array': (arr) => {
          var ret = stackAlloc(arr.length);
          writeArrayToMemory(arr, ret);
          return ret;
        }
      };
  
      function convertReturnValue(ret) {
        if (returnType === 'string') {
          return UTF8ToString(ret);
        }
        if (returnType === 'boolean') return Boolean(ret);
        return ret;
      }
  
      var func = getCFunc(ident);
      var cArgs = [];
      var stack = 0;
      assert(returnType !== 'array', 'return type should not be "array"');
      if (args) {
        for (var i = 0; i < args.length; i++) {
          var converter = toC[argTypes[i]];
          if (converter) {
            if (stack === 0) stack = stackSave();
            cArgs[i] = converter(args[i]);
          } else {
            cArgs[i] = args[i];
          }
        }
      }
      var ret = func(...cArgs);
      function onDone(ret) {
        if (stack !== 0) stackRestore(stack);
        return convertReturnValue(ret);
      }
  
      ret = onDone(ret);
      return ret;
    };


  var FS_createPath = (...args) => FS.createPath(...args);


  var FS_readFile = (...args) => FS.readFile(...args);


  var FS_unlink = (...args) => FS.unlink(...args);

  var FS_createLazyFile = (...args) => FS.createLazyFile(...args);

  var FS_createDevice = (...args) => FS.createDevice(...args);




  FS.createPreloadedFile = FS_createPreloadedFile;
  FS.preloadFile = FS_preloadFile;
  FS.staticInit();;
ENV.TERM    = ENV.TERM    || 'xterm-256color';
  ENV.TERMCAP = ENV.TERMCAP || 'xterm-256color:co#80:li#24:Co#16777216:cl=\\E[H\\E[2J:cm=\\E[%i%d;%dH:up=\\E[A:do=\\E[B:nd=\\E[C:le=\\b:bs:ku=\\E[A:kd=\\E[B:kr=\\E[C:kl=\\E[D:kh=\\E[H:@7=\\E[F:kD=\\E[3~:ks=\\E[?1h\\E=:ke=\\E[?1l\\E>:vi=\\E[?25l:ve=\\E[?25h:vs=\\E[?25h:ti=\\E[?1049h:te=\\E[?1049l:so=\\E[7m:se=\\E[27m:us=\\E[4m:ue=\\E[24m:md=\\E[1m:mr=\\E[7m:me=\\E[0m:AF=\\E[38;5;%dm:AB=\\E[48;5;%dm:op=\\E[39;49m:';
  ENV.COLORTERM = ENV.COLORTERM || 'truecolor';
  ENV.HOME    = ENV.HOME    || '/home/user';
  ENV.USER    = ENV.USER    || 'wasmacs';
  ENV.LOGNAME = ENV.LOGNAME || 'wasmacs';
  globalThis.__wasmacsInputSAB = globalThis.__wasmacsInputSAB || null;
  globalThis.__wasmacsTerminalSizeSAB = globalThis.__wasmacsTerminalSizeSAB || null;
  globalThis.__wasmacsTerminalResizeSeen = globalThis.__wasmacsTerminalResizeSeen || 0;
  globalThis.__wasmacsTerminalOutputBytes = globalThis.__wasmacsTerminalOutputBytes || [];
  globalThis.__wasmacsTerminalInputBytes  = globalThis.__wasmacsTerminalInputBytes  || [];
  globalThis.__wasmacsSentOutputCount     = globalThis.__wasmacsSentOutputCount     || 0;
  globalThis.__wasmacsHostWaitForInputCount = globalThis.__wasmacsHostWaitForInputCount || 0;
  globalThis.__wasmacsTerminalRows = globalThis.__wasmacsTerminalRows || 24;
  globalThis.__wasmacsTerminalCols = globalThis.__wasmacsTerminalCols || 80;
  function wasmacsCaptureTerminalText(text) {
    var bytes = new TextEncoder().encode(String(text));
    for (var i = 0; i < bytes.length; i++) globalThis.__wasmacsTerminalOutputBytes.push(bytes[i]);
  }
  function wasmacsCaptureTTYByte(tty, val) {
    if (val === null) {
      if (tty && tty.output && tty.output.length > 0) {
        for (var i = 0; i < tty.output.length; i++) globalThis.__wasmacsTerminalOutputBytes.push(tty.output[i] & 255);
        tty.output = [];
      }
      return;
    }
    globalThis.__wasmacsTerminalOutputBytes.push(val & 255);
  };
  Module.print = wasmacsCaptureTerminalText;
  Module.printErr = Module.printErr || function (text) { console.error(text); };
  try { out = wasmacsCaptureTerminalText; } catch (_) {}
  try {
    if (typeof TTY !== 'undefined' && TTY.default_tty_ops) {
      TTY.default_tty_ops.get_char = function () {
        var q = globalThis.__wasmacsTerminalInputBytes || [];
        return q.length ? q.shift() : undefined;
      };
      TTY.default_tty_ops.put_char = wasmacsCaptureTTYByte;
      TTY.default_tty_ops.fsync = function (tty) { wasmacsCaptureTTYByte(tty, null); };
      TTY.default_tty_ops.ioctl_tcgets = function () {
        return { c_iflag:0, c_oflag:0, c_cflag:2237, c_lflag:0,
          c_cc:[3,28,127,21,4,0,1,0,17,19,26,0,18,15,23,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0] };
      };
      TTY.default_tty_ops.ioctl_tcsets = function () { return 0; };
      TTY.default_tty_ops.ioctl_tiocgwinsz = function () {
        return [globalThis.__wasmacsTerminalRows || 24, globalThis.__wasmacsTerminalCols || 80];
      };
    }
    if (typeof TTY !== 'undefined' && TTY.default_tty1_ops) {
      TTY.default_tty1_ops.put_char = wasmacsCaptureTTYByte;
      TTY.default_tty1_ops.fsync = function (tty) { wasmacsCaptureTTYByte(tty, null); };
    }
    if (typeof TTY !== 'undefined' && TTY.ttys) {
      Object.keys(TTY.ttys).forEach(function (dev) {
        var tty = TTY.ttys[dev];
        if (tty && tty.ops) {
          tty.ops.put_char = wasmacsCaptureTTYByte;
          tty.ops.fsync = function (ttyArg) { wasmacsCaptureTTYByte(ttyArg, null); };
        }
      });
    }
    // ── OS compat: add FIONREAD ioctl to TTY stream ops ──────────
    // Emacs tty_read_avail_input calls ioctl(FIONREAD) to check how many
    // bytes are available before calling emacs_read.  Emscripten's TTY
    // stream_ops has no ioctl method by default, so we add one that
    // reports bytes from our input queue.
    if (typeof TTY !== 'undefined' && TTY.stream_ops) {
      TTY.stream_ops.ioctl = function(stream, cmd, arg) {
        if (cmd === 0x541B) {  // FIONREAD
          globalThis.__wasmacsFionreadCallCount = (globalThis.__wasmacsFionreadCallCount || 0) + 1;
          var q = globalThis.__wasmacsTerminalInputBytes || [];
          var available = q.length;
          if (stream.tty && stream.tty.input) available += stream.tty.input.length;
          try { HEAP32[arg >> 2] = available; } catch(e) {}
          globalThis.__wasmacsLastFionread = { ts: Date.now(), available: available, queueLen: q.length, callCount: globalThis.__wasmacsFionreadCallCount };
          return 0;
        }
        // Fallback for other ioctls: return ENOTTY
        return -25;
      };
    }
  } catch(e) {
    // TTY setup failed — terminal output will not work but won't break initialization
    console.warn('[wasmacs-atomics] TTY hook setup failed:', e);
  };
// End JS library code

// include: postlibrary.js
// This file is included after the automatically-generated JS library code
// but before the wasm module is created.

{

  // Begin ATMODULES hooks
  if (Module['noExitRuntime']) noExitRuntime = Module['noExitRuntime'];
if (Module['preloadPlugins']) preloadPlugins = Module['preloadPlugins'];
if (Module['print']) out = Module['print'];
if (Module['printErr']) err = Module['printErr'];
if (Module['wasmBinary']) wasmBinary = Module['wasmBinary'];
  // End ATMODULES hooks

  checkIncomingModuleAPI();

  if (Module['arguments']) arguments_ = Module['arguments'];
  if (Module['thisProgram']) thisProgram = Module['thisProgram'];

  // Assertions on removed incoming Module JS APIs.
  assert(typeof Module['memoryInitializerPrefixURL'] == 'undefined', 'Module.memoryInitializerPrefixURL option was removed, use Module.locateFile instead');
  assert(typeof Module['pthreadMainPrefixURL'] == 'undefined', 'Module.pthreadMainPrefixURL option was removed, use Module.locateFile instead');
  assert(typeof Module['cdInitializerPrefixURL'] == 'undefined', 'Module.cdInitializerPrefixURL option was removed, use Module.locateFile instead');
  assert(typeof Module['filePackagePrefixURL'] == 'undefined', 'Module.filePackagePrefixURL option was removed, use Module.locateFile instead');
  assert(typeof Module['read'] == 'undefined', 'Module.read option was removed');
  assert(typeof Module['readAsync'] == 'undefined', 'Module.readAsync option was removed (modify readAsync in JS)');
  assert(typeof Module['readBinary'] == 'undefined', 'Module.readBinary option was removed (modify readBinary in JS)');
  assert(typeof Module['setWindowTitle'] == 'undefined', 'Module.setWindowTitle option was removed (modify emscripten_set_window_title in JS)');
  assert(typeof Module['TOTAL_MEMORY'] == 'undefined', 'Module.TOTAL_MEMORY has been renamed Module.INITIAL_MEMORY');
  assert(typeof Module['ENVIRONMENT'] == 'undefined', 'Module.ENVIRONMENT has been deprecated. To force the environment, use the ENVIRONMENT compile-time option (for example, -sENVIRONMENT=web or -sENVIRONMENT=node)');
  assert(typeof Module['STACK_SIZE'] == 'undefined', 'STACK_SIZE can no longer be set at runtime.  Use -sSTACK_SIZE at link time')
  // If memory is defined in wasm, the user can't provide it, or set INITIAL_MEMORY
  assert(typeof Module['wasmMemory'] == 'undefined', 'Use of `wasmMemory` detected.  Use -sIMPORTED_MEMORY to define wasmMemory externally');
  assert(typeof Module['INITIAL_MEMORY'] == 'undefined', 'Detected runtime INITIAL_MEMORY setting.  Use -sIMPORTED_MEMORY to define wasmMemory dynamically');

  if (Module['preInit']) {
    if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
    while (Module['preInit'].length > 0) {
      Module['preInit'].shift()();
    }
  }
  consumedModuleProp('preInit');
}

// Begin runtime exports
  Module['callMain'] = callMain;
  Module['addRunDependency'] = addRunDependency;
  Module['removeRunDependency'] = removeRunDependency;
  Module['ccall'] = ccall;
  Module['FS_preloadFile'] = FS_preloadFile;
  Module['FS_unlink'] = FS_unlink;
  Module['FS_createPath'] = FS_createPath;
  Module['FS_createDevice'] = FS_createDevice;
  Module['FS_readFile'] = FS_readFile;
  Module['FS'] = FS;
  Module['FS_createDataFile'] = FS_createDataFile;
  Module['FS_createLazyFile'] = FS_createLazyFile;
  var missingLibrarySymbols = [
  'writeI53ToI64',
  'writeI53ToI64Clamped',
  'writeI53ToI64Signaling',
  'writeI53ToU64Clamped',
  'writeI53ToU64Signaling',
  'readI53FromU64',
  'convertI32PairToI53',
  'convertI32PairToI53Checked',
  'convertU32PairToI53',
  'getTempRet0',
  'setTempRet0',
  'createNamedFunction',
  'withStackSave',
  'readEmAsmArgs',
  'jstoi_q',
  'autoResumeAudioContext',
  'getDynCaller',
  'dynCall',
  'runtimeKeepalivePush',
  'runtimeKeepalivePop',
  'asmjsMangle',
  'HandleAllocator',
  'addOnInit',
  'addOnPostCtor',
  'addOnPreMain',
  'addOnExit',
  'STACK_SIZE',
  'STACK_ALIGN',
  'POINTER_SIZE',
  'ASSERTIONS',
  'cwrap',
  'convertJsFunctionToWasm',
  'getEmptyTableSlot',
  'updateTableMap',
  'getFunctionAddress',
  'addFunction',
  'removeFunction',
  'intArrayToString',
  'AsciiToString',
  'stringToAscii',
  'UTF16ToString',
  'stringToUTF16',
  'lengthBytesUTF16',
  'UTF32ToString',
  'stringToUTF32',
  'lengthBytesUTF32',
  'stringToNewUTF8',
  'registerKeyEventCallback',
  'maybeCStringToJsString',
  'findEventTarget',
  'getBoundingClientRect',
  'fillMouseEventData',
  'registerMouseEventCallback',
  'registerWheelEventCallback',
  'registerUiEventCallback',
  'registerFocusEventCallback',
  'fillDeviceOrientationEventData',
  'registerDeviceOrientationEventCallback',
  'fillDeviceMotionEventData',
  'registerDeviceMotionEventCallback',
  'screenOrientation',
  'fillOrientationChangeEventData',
  'registerOrientationChangeEventCallback',
  'fillFullscreenChangeEventData',
  'registerFullscreenChangeEventCallback',
  'JSEvents_requestFullscreen',
  'JSEvents_resizeCanvasForFullscreen',
  'registerRestoreOldStyle',
  'hideEverythingExceptGivenElement',
  'restoreHiddenElements',
  'setLetterbox',
  'softFullscreenResizeWebGLRenderTarget',
  'doRequestFullscreen',
  'fillPointerlockChangeEventData',
  'registerPointerlockChangeEventCallback',
  'registerPointerlockErrorEventCallback',
  'requestPointerLock',
  'fillVisibilityChangeEventData',
  'registerVisibilityChangeEventCallback',
  'registerTouchEventCallback',
  'fillGamepadEventData',
  'registerGamepadEventCallback',
  'registerBeforeUnloadEventCallback',
  'fillBatteryEventData',
  'registerBatteryEventCallback',
  'setCanvasElementSize',
  'getCanvasElementSize',
  'jsStackTrace',
  'getCallstack',
  'convertPCtoSourceLocation',
  'wasiRightsToMuslOFlags',
  'wasiOFlagsToMuslOFlags',
  'safeSetTimeout',
  'setImmediateWrapped',
  'safeRequestAnimationFrame',
  'clearImmediateWrapped',
  'registerPostMainLoop',
  'registerPreMainLoop',
  'getPromise',
  'makePromise',
  'idsToPromises',
  'makePromiseCallback',
  'ExceptionInfo',
  'findMatchingCatch',
  'incrementUncaughtExceptionCount',
  'decrementUncaughtExceptionCount',
  'Browser_asyncPrepareDataCounter',
  'arraySum',
  'addDays',
  'FS_mkdirTree',
  '_setNetworkCallback',
  'heapObjectForWebGLType',
  'toTypedArrayIndex',
  'webgl_enable_ANGLE_instanced_arrays',
  'webgl_enable_OES_vertex_array_object',
  'webgl_enable_WEBGL_draw_buffers',
  'webgl_enable_WEBGL_multi_draw',
  'webgl_enable_EXT_polygon_offset_clamp',
  'webgl_enable_EXT_clip_control',
  'webgl_enable_WEBGL_polygon_mode',
  'emscriptenWebGLGet',
  'computeUnpackAlignedImageSize',
  'colorChannelsInGlTextureFormat',
  'emscriptenWebGLGetTexPixelData',
  'emscriptenWebGLGetUniform',
  'webglGetUniformLocation',
  'webglPrepareUniformLocationsBeforeFirstUse',
  'webglGetLeftBracePos',
  'emscriptenWebGLGetVertexAttrib',
  '__glGetActiveAttribOrUniform',
  'writeGLArray',
  'registerWebGlEventCallback',
  'runAndAbortIfError',
  'ALLOC_NORMAL',
  'ALLOC_STACK',
  'allocate',
  'writeStringToMemory',
  'writeAsciiToMemory',
  'allocateUTF8',
  'allocateUTF8OnStack',
  'demangle',
  'stackTrace',
  'getNativeTypeSize',
];
missingLibrarySymbols.forEach(missingLibrarySymbol)

  var unexportedSymbols = [
  'run',
  'out',
  'err',
  'abort',
  'wasmExports',
  'writeStackCookie',
  'checkStackCookie',
  'readI53FromI64',
  'INT53_MAX',
  'INT53_MIN',
  'bigintToI53Checked',
  'HEAP8',
  'HEAPU8',
  'HEAP16',
  'HEAPU16',
  'HEAP32',
  'HEAPU32',
  'HEAPF32',
  'HEAPF64',
  'HEAP64',
  'HEAPU64',
  'stackSave',
  'stackRestore',
  'stackAlloc',
  'ptrToString',
  'zeroMemory',
  'exitJS',
  'getHeapMax',
  'growMemory',
  'ENV',
  'setStackLimits',
  'ERRNO_CODES',
  'strError',
  'inetPton4',
  'inetNtop4',
  'inetPton6',
  'inetNtop6',
  'readSockaddr',
  'writeSockaddr',
  'DNS',
  'Protocols',
  'Sockets',
  'timers',
  'warnOnce',
  'readEmAsmArgsArray',
  'getExecutableName',
  'handleException',
  'keepRuntimeAlive',
  'callUserCallback',
  'maybeExit',
  'asyncLoad',
  'alignMemory',
  'mmapAlloc',
  'wasmTable',
  'wasmMemory',
  'getUniqueRunDependency',
  'noExitRuntime',
  'addOnPreRun',
  'addOnPostRun',
  'freeTableIndexes',
  'functionsInTableMap',
  'setValue',
  'getValue',
  'PATH',
  'PATH_FS',
  'UTF8Decoder',
  'UTF8ArrayToString',
  'UTF8ToString',
  'stringToUTF8Array',
  'stringToUTF8',
  'lengthBytesUTF8',
  'intArrayFromString',
  'UTF16Decoder',
  'stringToUTF8OnStack',
  'writeArrayToMemory',
  'JSEvents',
  'specialHTMLTargets',
  'findCanvasEventTarget',
  'currentFullscreenStrategy',
  'restoreOldWindowedStyle',
  'UNWIND_CACHE',
  'ExitStatus',
  'getEnvStrings',
  'checkWasiClock',
  'doReadv',
  'doWritev',
  'initRandomFill',
  'randomFill',
  'emSetImmediate',
  'emClearImmediate_deps',
  'emClearImmediate',
  'promiseMap',
  'uncaughtExceptionCount',
  'exceptionCaught',
  'Browser',
  'requestFullscreen',
  'requestFullScreen',
  'setCanvasSize',
  'getUserMedia',
  'createContext',
  'getPreloadedImageData__data',
  'wget',
  'MONTH_DAYS_REGULAR',
  'MONTH_DAYS_LEAP',
  'MONTH_DAYS_REGULAR_CUMULATIVE',
  'MONTH_DAYS_LEAP_CUMULATIVE',
  'isLeapYear',
  'ydayFromDate',
  'SYSCALLS',
  'getSocketFromFD',
  'getSocketAddress',
  'preloadPlugins',
  'FS_createPreloadedFile',
  'FS_modeStringToFlags',
  'FS_getMode',
  'FS_fileDataToTypedArray',
  'FS_stdin_getChar_buffer',
  'FS_stdin_getChar',
  'FS_root',
  'FS_mounts',
  'FS_devices',
  'FS_streams',
  'FS_nextInode',
  'FS_nameTable',
  'FS_currentPath',
  'FS_initialized',
  'FS_ignorePermissions',
  'FS_filesystems',
  'FS_syncFSRequests',
  'FS_lookupPath',
  'FS_getPath',
  'FS_hashName',
  'FS_hashAddNode',
  'FS_hashRemoveNode',
  'FS_lookupNode',
  'FS_createNode',
  'FS_destroyNode',
  'FS_isRoot',
  'FS_isMountpoint',
  'FS_isFile',
  'FS_isDir',
  'FS_isLink',
  'FS_isChrdev',
  'FS_isBlkdev',
  'FS_isFIFO',
  'FS_isSocket',
  'FS_flagsToPermissionString',
  'FS_nodePermissions',
  'FS_mayLookup',
  'FS_mayCreate',
  'FS_mayDelete',
  'FS_mayOpen',
  'FS_checkOpExists',
  'FS_nextfd',
  'FS_getStreamChecked',
  'FS_getStream',
  'FS_createStream',
  'FS_closeStream',
  'FS_dupStream',
  'FS_doSetAttr',
  'FS_chrdev_stream_ops',
  'FS_major',
  'FS_minor',
  'FS_makedev',
  'FS_registerDevice',
  'FS_getDevice',
  'FS_getMounts',
  'FS_syncfs',
  'FS_mount',
  'FS_unmount',
  'FS_lookup',
  'FS_mknod',
  'FS_statfs',
  'FS_statfsStream',
  'FS_statfsNode',
  'FS_create',
  'FS_mkdir',
  'FS_mkdev',
  'FS_symlink',
  'FS_rename',
  'FS_rmdir',
  'FS_readdir',
  'FS_readlink',
  'FS_stat',
  'FS_fstat',
  'FS_lstat',
  'FS_doChmod',
  'FS_chmod',
  'FS_lchmod',
  'FS_fchmod',
  'FS_doChown',
  'FS_chown',
  'FS_lchown',
  'FS_fchown',
  'FS_doTruncate',
  'FS_truncate',
  'FS_ftruncate',
  'FS_utime',
  'FS_open',
  'FS_close',
  'FS_isClosed',
  'FS_llseek',
  'FS_read',
  'FS_write',
  'FS_mmap',
  'FS_msync',
  'FS_ioctl',
  'FS_writeFile',
  'FS_cwd',
  'FS_chdir',
  'FS_createDefaultDirectories',
  'FS_createDefaultDevices',
  'FS_createSpecialDirectories',
  'FS_createStandardStreams',
  'FS_staticInit',
  'FS_init',
  'FS_quit',
  'FS_findObject',
  'FS_analyzePath',
  'FS_createFile',
  'FS_forceLoadFile',
  'MEMFS',
  'TTY',
  'PIPEFS',
  'SOCKFS',
  'tempFixedLengthArray',
  'miniTempWebGLFloatBuffers',
  'miniTempWebGLIntBuffers',
  'GL',
  'AL',
  'GLUT',
  'EGL',
  'GLEW',
  'IDBStore',
  'SDL',
  'SDL_gfx',
  'print',
  'printErr',
  'jstoi_s',
  'wasmacs_atomics_env',
];
unexportedSymbols.forEach(unexportedRuntimeSymbol);

  // End runtime exports
  // Begin JS library exports
  Module['_wasmacs_os_timing_checkpoint'] = _wasmacs_os_timing_checkpoint;
  // End JS library exports

// end include: postlibrary.js

function checkIncomingModuleAPI() {
  ignoredModuleProp('fetchSettings');
  ignoredModuleProp('logReadFiles');
  ignoredModuleProp('loadSplitModule');
  ignoredModuleProp('onMalloc');
  ignoredModuleProp('onRealloc');
  ignoredModuleProp('onFree');
  ignoredModuleProp('onSbrkGrow');
}
function wasmacs_host_network_fetch_json(request_json) {
  function returnJson(value) {
    var json = JSON.stringify(value);
    var size = lengthBytesUTF8(json) + 1;
    var ptr = _malloc(size);
    if (!ptr) return 0;
    stringToUTF8(json, ptr, size);
    return ptr;
  }
  function fail(message) { return returnJson({ error: String(message) }); }
  try {
    if (typeof self === "undefined" || typeof self.postMessage !== "function") {
      return fail("host.network.fetch relay requires a worker postMessage host");
    }
    if (typeof SharedArrayBuffer !== "function" || typeof Atomics === "undefined") {
      return fail("host.network.fetch relay requires SharedArrayBuffer and Atomics");
    }
    var requestJson = UTF8ToString(request_json);
    var responseSAB = globalThis.__wasmacsNetworkResponseSAB;
    if (!responseSAB) {
      responseSAB = new SharedArrayBuffer(64 * 1024 * 1024);
      globalThis.__wasmacsNetworkResponseSAB = responseSAB;
    }
    var signal = new Int32Array(responseSAB, 0, 4);
    var data = new Uint8Array(responseSAB, 16);
    Atomics.store(signal, 0, 1);
    Atomics.store(signal, 1, 0);
    self.postMessage({
      type: "host-network-fetch",
      requestJson: requestJson,
      responseSAB: responseSAB
    });
    var waitResult = Atomics.wait(signal, 0, 1, 120000);
    if (waitResult === "timed-out") {
      return fail("host.network.fetch main-thread relay timed out");
    }
    var length = Atomics.load(signal, 1);
    if (!Number.isFinite(length) || length <= 0 || length > data.length) {
      return fail("host.network.fetch main-thread relay returned invalid length " + length);
    }
    var text = new TextDecoder().decode(new Uint8Array(data.subarray(0, length)));
    Atomics.store(signal, 0, 0);
    Atomics.store(signal, 1, 0);
    try {
      return returnJson(JSON.parse(text));
    } catch (parseError) {
      return fail("host.network.fetch main-thread relay returned invalid JSON: " + parseError.message);
    }
  } catch (error) {
    return fail(error && error.message ? error.message : error);
  }
}

// Imports from the Wasm binary.
var _strerror = makeInvalidEarlyAccess('_strerror');
var _wasmacs_last_result = Module['_wasmacs_last_result'] = makeInvalidEarlyAccess('_wasmacs_last_result');
var _wasmacs_os_network_fetch_json = Module['_wasmacs_os_network_fetch_json'] = makeInvalidEarlyAccess('_wasmacs_os_network_fetch_json');
var _wasmacs_entrypoint_state = Module['_wasmacs_entrypoint_state'] = makeInvalidEarlyAccess('_wasmacs_entrypoint_state');
var _wasmacs_command_state = Module['_wasmacs_command_state'] = makeInvalidEarlyAccess('_wasmacs_command_state');
var _wasmacs_os_lifecycle_phase = Module['_wasmacs_os_lifecycle_phase'] = makeInvalidEarlyAccess('_wasmacs_os_lifecycle_phase');
var _wasmacs_os_root_state_snapshot = Module['_wasmacs_os_root_state_snapshot'] = makeInvalidEarlyAccess('_wasmacs_os_root_state_snapshot');
var _wasmacs_os_gc_permission = Module['_wasmacs_os_gc_permission'] = makeInvalidEarlyAccess('_wasmacs_os_gc_permission');
var _wasmacs_os_pending_command_state = Module['_wasmacs_os_pending_command_state'] = makeInvalidEarlyAccess('_wasmacs_os_pending_command_state');
var _wasmacs_os_lifecycle_state = Module['_wasmacs_os_lifecycle_state'] = makeInvalidEarlyAccess('_wasmacs_os_lifecycle_state');
var _wasmacs_os_stack_bounds_probe = Module['_wasmacs_os_stack_bounds_probe'] = makeInvalidEarlyAccess('_wasmacs_os_stack_bounds_probe');
var _wasmacs_os_gc_permission_state = Module['_wasmacs_os_gc_permission_state'] = makeInvalidEarlyAccess('_wasmacs_os_gc_permission_state');
var _wasmacs_os_root_safety_probe = Module['_wasmacs_os_root_safety_probe'] = makeInvalidEarlyAccess('_wasmacs_os_root_safety_probe');
var _wasmacs_os_apply_terminal_resize = Module['_wasmacs_os_apply_terminal_resize'] = makeInvalidEarlyAccess('_wasmacs_os_apply_terminal_resize');
var _wasmacs_os_pin_backtrace_args = Module['_wasmacs_os_pin_backtrace_args'] = makeInvalidEarlyAccess('_wasmacs_os_pin_backtrace_args');
var _wasmacs_pin_specpdl_backtrace_args = Module['_wasmacs_pin_specpdl_backtrace_args'] = makeInvalidEarlyAccess('_wasmacs_pin_specpdl_backtrace_args');
var _wasmacs_minibuffer_state = Module['_wasmacs_minibuffer_state'] = makeInvalidEarlyAccess('_wasmacs_minibuffer_state');
var _wasmacs_interactive_state = Module['_wasmacs_interactive_state'] = makeInvalidEarlyAccess('_wasmacs_interactive_state');
var _wasmacs_command_begin_minibuffer_probe = Module['_wasmacs_command_begin_minibuffer_probe'] = makeInvalidEarlyAccess('_wasmacs_command_begin_minibuffer_probe');
var _wasmacs_command_begin_minibuffer_force_probe = Module['_wasmacs_command_begin_minibuffer_force_probe'] = makeInvalidEarlyAccess('_wasmacs_command_begin_minibuffer_force_probe');
var _wasmacs_command_begin_bare_recursive_edit_probe = Module['_wasmacs_command_begin_bare_recursive_edit_probe'] = makeInvalidEarlyAccess('_wasmacs_command_begin_bare_recursive_edit_probe');
var _wasmacs_scrub_specpdl_backtrace_args = Module['_wasmacs_scrub_specpdl_backtrace_args'] = makeInvalidEarlyAccess('_wasmacs_scrub_specpdl_backtrace_args');
var _wasmacs_garbage_collect = Module['_wasmacs_garbage_collect'] = makeInvalidEarlyAccess('_wasmacs_garbage_collect');
var _wasmacs_eval_string = Module['_wasmacs_eval_string'] = makeInvalidEarlyAccess('_wasmacs_eval_string');
var _wasmacs_os_release_backtrace_args = Module['_wasmacs_os_release_backtrace_args'] = makeInvalidEarlyAccess('_wasmacs_os_release_backtrace_args');
var _wasmacs_os_push_gc_guard = Module['_wasmacs_os_push_gc_guard'] = makeInvalidEarlyAccess('_wasmacs_os_push_gc_guard');
var _wasmacs_os_pop_gc_guard = Module['_wasmacs_os_pop_gc_guard'] = makeInvalidEarlyAccess('_wasmacs_os_pop_gc_guard');
var _wasmacs_os_begin_command = Module['_wasmacs_os_begin_command'] = makeInvalidEarlyAccess('_wasmacs_os_begin_command');
var _wasmacs_os_finish_command = Module['_wasmacs_os_finish_command'] = makeInvalidEarlyAccess('_wasmacs_os_finish_command');
var _wasmacs_os_cancel_command = Module['_wasmacs_os_cancel_command'] = makeInvalidEarlyAccess('_wasmacs_os_cancel_command');
var _wasmacs_os_configure_dired_without_ls = Module['_wasmacs_os_configure_dired_without_ls'] = makeInvalidEarlyAccess('_wasmacs_os_configure_dired_without_ls');
var _wasmacs_os_dired_without_ls_probe = Module['_wasmacs_os_dired_without_ls_probe'] = makeInvalidEarlyAccess('_wasmacs_os_dired_without_ls_probe');
var _wasmacs_os_filesystem_dired_state = Module['_wasmacs_os_filesystem_dired_state'] = makeInvalidEarlyAccess('_wasmacs_os_filesystem_dired_state');
var _wasmacs_os_url_fetch_loader_state = Module['_wasmacs_os_url_fetch_loader_state'] = makeInvalidEarlyAccess('_wasmacs_os_url_fetch_loader_state');
var _main = Module['_main'] = makeInvalidEarlyAccess('_main');
var _wasmacs_input_text = Module['_wasmacs_input_text'] = makeInvalidEarlyAccess('_wasmacs_input_text');
var _wasmacs_input_cancel = Module['_wasmacs_input_cancel'] = makeInvalidEarlyAccess('_wasmacs_input_cancel');
var _ntohs = makeInvalidEarlyAccess('_ntohs');
var _htons = makeInvalidEarlyAccess('_htons');
var _malloc = Module['_malloc'] = makeInvalidEarlyAccess('_malloc');
var _free = Module['_free'] = makeInvalidEarlyAccess('_free');
var _fflush = makeInvalidEarlyAccess('_fflush');
var _emscripten_stack_get_end = makeInvalidEarlyAccess('_emscripten_stack_get_end');
var _emscripten_stack_get_base = makeInvalidEarlyAccess('_emscripten_stack_get_base');
var _htonl = makeInvalidEarlyAccess('_htonl');
var __emscripten_timeout = makeInvalidEarlyAccess('__emscripten_timeout');
var _setThrew = makeInvalidEarlyAccess('_setThrew');
var _emscripten_stack_init = makeInvalidEarlyAccess('_emscripten_stack_init');
var _emscripten_stack_get_free = makeInvalidEarlyAccess('_emscripten_stack_get_free');
var __emscripten_stack_restore = makeInvalidEarlyAccess('__emscripten_stack_restore');
var __emscripten_stack_alloc = makeInvalidEarlyAccess('__emscripten_stack_alloc');
var _emscripten_stack_get_current = makeInvalidEarlyAccess('_emscripten_stack_get_current');
var ___set_stack_limits = Module['___set_stack_limits'] = makeInvalidEarlyAccess('___set_stack_limits');
var memory = makeInvalidEarlyAccess('memory');
var __indirect_function_table = makeInvalidEarlyAccess('__indirect_function_table');
var wasmMemory = makeInvalidEarlyAccess('wasmMemory');
var wasmTable = makeInvalidEarlyAccess('wasmTable');

function assignWasmExports(wasmExports) {
  assert(typeof wasmExports['strerror'] != 'undefined', 'missing Wasm export: strerror');
  assert(typeof wasmExports['wasmacs_last_result'] != 'undefined', 'missing Wasm export: wasmacs_last_result');
  assert(typeof wasmExports['wasmacs_os_network_fetch_json'] != 'undefined', 'missing Wasm export: wasmacs_os_network_fetch_json');
  assert(typeof wasmExports['wasmacs_entrypoint_state'] != 'undefined', 'missing Wasm export: wasmacs_entrypoint_state');
  assert(typeof wasmExports['wasmacs_command_state'] != 'undefined', 'missing Wasm export: wasmacs_command_state');
  assert(typeof wasmExports['wasmacs_os_lifecycle_phase'] != 'undefined', 'missing Wasm export: wasmacs_os_lifecycle_phase');
  assert(typeof wasmExports['wasmacs_os_root_state_snapshot'] != 'undefined', 'missing Wasm export: wasmacs_os_root_state_snapshot');
  assert(typeof wasmExports['wasmacs_os_gc_permission'] != 'undefined', 'missing Wasm export: wasmacs_os_gc_permission');
  assert(typeof wasmExports['wasmacs_os_pending_command_state'] != 'undefined', 'missing Wasm export: wasmacs_os_pending_command_state');
  assert(typeof wasmExports['wasmacs_os_lifecycle_state'] != 'undefined', 'missing Wasm export: wasmacs_os_lifecycle_state');
  assert(typeof wasmExports['wasmacs_os_stack_bounds_probe'] != 'undefined', 'missing Wasm export: wasmacs_os_stack_bounds_probe');
  assert(typeof wasmExports['wasmacs_os_gc_permission_state'] != 'undefined', 'missing Wasm export: wasmacs_os_gc_permission_state');
  assert(typeof wasmExports['wasmacs_os_root_safety_probe'] != 'undefined', 'missing Wasm export: wasmacs_os_root_safety_probe');
  assert(typeof wasmExports['wasmacs_os_apply_terminal_resize'] != 'undefined', 'missing Wasm export: wasmacs_os_apply_terminal_resize');
  assert(typeof wasmExports['wasmacs_os_pin_backtrace_args'] != 'undefined', 'missing Wasm export: wasmacs_os_pin_backtrace_args');
  assert(typeof wasmExports['wasmacs_pin_specpdl_backtrace_args'] != 'undefined', 'missing Wasm export: wasmacs_pin_specpdl_backtrace_args');
  assert(typeof wasmExports['wasmacs_minibuffer_state'] != 'undefined', 'missing Wasm export: wasmacs_minibuffer_state');
  assert(typeof wasmExports['wasmacs_interactive_state'] != 'undefined', 'missing Wasm export: wasmacs_interactive_state');
  assert(typeof wasmExports['wasmacs_command_begin_minibuffer_probe'] != 'undefined', 'missing Wasm export: wasmacs_command_begin_minibuffer_probe');
  assert(typeof wasmExports['wasmacs_command_begin_minibuffer_force_probe'] != 'undefined', 'missing Wasm export: wasmacs_command_begin_minibuffer_force_probe');
  assert(typeof wasmExports['wasmacs_command_begin_bare_recursive_edit_probe'] != 'undefined', 'missing Wasm export: wasmacs_command_begin_bare_recursive_edit_probe');
  assert(typeof wasmExports['wasmacs_scrub_specpdl_backtrace_args'] != 'undefined', 'missing Wasm export: wasmacs_scrub_specpdl_backtrace_args');
  assert(typeof wasmExports['wasmacs_garbage_collect'] != 'undefined', 'missing Wasm export: wasmacs_garbage_collect');
  assert(typeof wasmExports['wasmacs_eval_string'] != 'undefined', 'missing Wasm export: wasmacs_eval_string');
  assert(typeof wasmExports['wasmacs_os_release_backtrace_args'] != 'undefined', 'missing Wasm export: wasmacs_os_release_backtrace_args');
  assert(typeof wasmExports['wasmacs_os_push_gc_guard'] != 'undefined', 'missing Wasm export: wasmacs_os_push_gc_guard');
  assert(typeof wasmExports['wasmacs_os_pop_gc_guard'] != 'undefined', 'missing Wasm export: wasmacs_os_pop_gc_guard');
  assert(typeof wasmExports['wasmacs_os_begin_command'] != 'undefined', 'missing Wasm export: wasmacs_os_begin_command');
  assert(typeof wasmExports['wasmacs_os_finish_command'] != 'undefined', 'missing Wasm export: wasmacs_os_finish_command');
  assert(typeof wasmExports['wasmacs_os_cancel_command'] != 'undefined', 'missing Wasm export: wasmacs_os_cancel_command');
  assert(typeof wasmExports['wasmacs_os_configure_dired_without_ls'] != 'undefined', 'missing Wasm export: wasmacs_os_configure_dired_without_ls');
  assert(typeof wasmExports['wasmacs_os_dired_without_ls_probe'] != 'undefined', 'missing Wasm export: wasmacs_os_dired_without_ls_probe');
  assert(typeof wasmExports['wasmacs_os_filesystem_dired_state'] != 'undefined', 'missing Wasm export: wasmacs_os_filesystem_dired_state');
  assert(typeof wasmExports['wasmacs_os_url_fetch_loader_state'] != 'undefined', 'missing Wasm export: wasmacs_os_url_fetch_loader_state');
  assert(typeof wasmExports['__main_argc_argv'] != 'undefined', 'missing Wasm export: __main_argc_argv');
  assert(typeof wasmExports['wasmacs_input_text'] != 'undefined', 'missing Wasm export: wasmacs_input_text');
  assert(typeof wasmExports['wasmacs_input_cancel'] != 'undefined', 'missing Wasm export: wasmacs_input_cancel');
  assert(typeof wasmExports['ntohs'] != 'undefined', 'missing Wasm export: ntohs');
  assert(typeof wasmExports['htons'] != 'undefined', 'missing Wasm export: htons');
  assert(typeof wasmExports['malloc'] != 'undefined', 'missing Wasm export: malloc');
  assert(typeof wasmExports['free'] != 'undefined', 'missing Wasm export: free');
  assert(typeof wasmExports['fflush'] != 'undefined', 'missing Wasm export: fflush');
  assert(typeof wasmExports['emscripten_stack_get_end'] != 'undefined', 'missing Wasm export: emscripten_stack_get_end');
  assert(typeof wasmExports['emscripten_stack_get_base'] != 'undefined', 'missing Wasm export: emscripten_stack_get_base');
  assert(typeof wasmExports['htonl'] != 'undefined', 'missing Wasm export: htonl');
  assert(typeof wasmExports['_emscripten_timeout'] != 'undefined', 'missing Wasm export: _emscripten_timeout');
  assert(typeof wasmExports['setThrew'] != 'undefined', 'missing Wasm export: setThrew');
  assert(typeof wasmExports['emscripten_stack_init'] != 'undefined', 'missing Wasm export: emscripten_stack_init');
  assert(typeof wasmExports['emscripten_stack_get_free'] != 'undefined', 'missing Wasm export: emscripten_stack_get_free');
  assert(typeof wasmExports['_emscripten_stack_restore'] != 'undefined', 'missing Wasm export: _emscripten_stack_restore');
  assert(typeof wasmExports['_emscripten_stack_alloc'] != 'undefined', 'missing Wasm export: _emscripten_stack_alloc');
  assert(typeof wasmExports['emscripten_stack_get_current'] != 'undefined', 'missing Wasm export: emscripten_stack_get_current');
  assert(typeof wasmExports['__set_stack_limits'] != 'undefined', 'missing Wasm export: __set_stack_limits');
  assert(typeof wasmExports['memory'] != 'undefined', 'missing Wasm export: memory');
  assert(typeof wasmExports['__indirect_function_table'] != 'undefined', 'missing Wasm export: __indirect_function_table');
  _strerror = createExportWrapper('strerror', 1);
  _wasmacs_last_result = Module['_wasmacs_last_result'] = createExportWrapper('wasmacs_last_result', 0);
  _wasmacs_os_network_fetch_json = Module['_wasmacs_os_network_fetch_json'] = createExportWrapper('wasmacs_os_network_fetch_json', 1);
  _wasmacs_entrypoint_state = Module['_wasmacs_entrypoint_state'] = createExportWrapper('wasmacs_entrypoint_state', 0);
  _wasmacs_command_state = Module['_wasmacs_command_state'] = createExportWrapper('wasmacs_command_state', 0);
  _wasmacs_os_lifecycle_phase = Module['_wasmacs_os_lifecycle_phase'] = createExportWrapper('wasmacs_os_lifecycle_phase', 0);
  _wasmacs_os_root_state_snapshot = Module['_wasmacs_os_root_state_snapshot'] = createExportWrapper('wasmacs_os_root_state_snapshot', 0);
  _wasmacs_os_gc_permission = Module['_wasmacs_os_gc_permission'] = createExportWrapper('wasmacs_os_gc_permission', 0);
  _wasmacs_os_pending_command_state = Module['_wasmacs_os_pending_command_state'] = createExportWrapper('wasmacs_os_pending_command_state', 0);
  _wasmacs_os_lifecycle_state = Module['_wasmacs_os_lifecycle_state'] = createExportWrapper('wasmacs_os_lifecycle_state', 0);
  _wasmacs_os_stack_bounds_probe = Module['_wasmacs_os_stack_bounds_probe'] = createExportWrapper('wasmacs_os_stack_bounds_probe', 0);
  _wasmacs_os_gc_permission_state = Module['_wasmacs_os_gc_permission_state'] = createExportWrapper('wasmacs_os_gc_permission_state', 0);
  _wasmacs_os_root_safety_probe = Module['_wasmacs_os_root_safety_probe'] = createExportWrapper('wasmacs_os_root_safety_probe', 0);
  _wasmacs_os_apply_terminal_resize = Module['_wasmacs_os_apply_terminal_resize'] = createExportWrapper('wasmacs_os_apply_terminal_resize', 2);
  _wasmacs_os_pin_backtrace_args = Module['_wasmacs_os_pin_backtrace_args'] = createExportWrapper('wasmacs_os_pin_backtrace_args', 0);
  _wasmacs_pin_specpdl_backtrace_args = Module['_wasmacs_pin_specpdl_backtrace_args'] = createExportWrapper('wasmacs_pin_specpdl_backtrace_args', 0);
  _wasmacs_minibuffer_state = Module['_wasmacs_minibuffer_state'] = createExportWrapper('wasmacs_minibuffer_state', 0);
  _wasmacs_interactive_state = Module['_wasmacs_interactive_state'] = createExportWrapper('wasmacs_interactive_state', 0);
  _wasmacs_command_begin_minibuffer_probe = Module['_wasmacs_command_begin_minibuffer_probe'] = createExportWrapper('wasmacs_command_begin_minibuffer_probe', 0);
  _wasmacs_command_begin_minibuffer_force_probe = Module['_wasmacs_command_begin_minibuffer_force_probe'] = createExportWrapper('wasmacs_command_begin_minibuffer_force_probe', 0);
  _wasmacs_command_begin_bare_recursive_edit_probe = Module['_wasmacs_command_begin_bare_recursive_edit_probe'] = createExportWrapper('wasmacs_command_begin_bare_recursive_edit_probe', 0);
  _wasmacs_scrub_specpdl_backtrace_args = Module['_wasmacs_scrub_specpdl_backtrace_args'] = createExportWrapper('wasmacs_scrub_specpdl_backtrace_args', 0);
  _wasmacs_garbage_collect = Module['_wasmacs_garbage_collect'] = createExportWrapper('wasmacs_garbage_collect', 0);
  _wasmacs_eval_string = Module['_wasmacs_eval_string'] = createExportWrapper('wasmacs_eval_string', 1);
  _wasmacs_os_release_backtrace_args = Module['_wasmacs_os_release_backtrace_args'] = createExportWrapper('wasmacs_os_release_backtrace_args', 0);
  _wasmacs_os_push_gc_guard = Module['_wasmacs_os_push_gc_guard'] = createExportWrapper('wasmacs_os_push_gc_guard', 0);
  _wasmacs_os_pop_gc_guard = Module['_wasmacs_os_pop_gc_guard'] = createExportWrapper('wasmacs_os_pop_gc_guard', 0);
  _wasmacs_os_begin_command = Module['_wasmacs_os_begin_command'] = createExportWrapper('wasmacs_os_begin_command', 1);
  _wasmacs_os_finish_command = Module['_wasmacs_os_finish_command'] = createExportWrapper('wasmacs_os_finish_command', 0);
  _wasmacs_os_cancel_command = Module['_wasmacs_os_cancel_command'] = createExportWrapper('wasmacs_os_cancel_command', 0);
  _wasmacs_os_configure_dired_without_ls = Module['_wasmacs_os_configure_dired_without_ls'] = createExportWrapper('wasmacs_os_configure_dired_without_ls', 0);
  _wasmacs_os_dired_without_ls_probe = Module['_wasmacs_os_dired_without_ls_probe'] = createExportWrapper('wasmacs_os_dired_without_ls_probe', 0);
  _wasmacs_os_filesystem_dired_state = Module['_wasmacs_os_filesystem_dired_state'] = createExportWrapper('wasmacs_os_filesystem_dired_state', 0);
  _wasmacs_os_url_fetch_loader_state = Module['_wasmacs_os_url_fetch_loader_state'] = createExportWrapper('wasmacs_os_url_fetch_loader_state', 0);
  _main = Module['_main'] = createExportWrapper('__main_argc_argv', 2);
  _wasmacs_input_text = Module['_wasmacs_input_text'] = createExportWrapper('wasmacs_input_text', 1);
  _wasmacs_input_cancel = Module['_wasmacs_input_cancel'] = createExportWrapper('wasmacs_input_cancel', 0);
  _ntohs = createExportWrapper('ntohs', 1);
  _htons = createExportWrapper('htons', 1);
  _malloc = Module['_malloc'] = createExportWrapper('malloc', 1);
  _free = Module['_free'] = createExportWrapper('free', 1);
  _fflush = createExportWrapper('fflush', 1);
  _emscripten_stack_get_end = wasmExports['emscripten_stack_get_end'];
  _emscripten_stack_get_base = wasmExports['emscripten_stack_get_base'];
  _htonl = createExportWrapper('htonl', 1);
  __emscripten_timeout = createExportWrapper('_emscripten_timeout', 2);
  _setThrew = createExportWrapper('setThrew', 2);
  _emscripten_stack_init = wasmExports['emscripten_stack_init'];
  _emscripten_stack_get_free = wasmExports['emscripten_stack_get_free'];
  __emscripten_stack_restore = wasmExports['_emscripten_stack_restore'];
  __emscripten_stack_alloc = wasmExports['_emscripten_stack_alloc'];
  _emscripten_stack_get_current = wasmExports['emscripten_stack_get_current'];
  ___set_stack_limits = Module['___set_stack_limits'] = createExportWrapper('__set_stack_limits', 2);
  memory = wasmMemory = wasmExports['memory'];
  __indirect_function_table = wasmTable = wasmExports['__indirect_function_table'];
}

var wasmImports = {
  /** @export */
  __call_sighandler: ___call_sighandler,
  /** @export */
  __handle_stack_overflow: ___handle_stack_overflow,
  /** @export */
  __syscall_accept4: ___syscall_accept4,
  /** @export */
  __syscall_bind: ___syscall_bind,
  /** @export */
  __syscall_chdir: ___syscall_chdir,
  /** @export */
  __syscall_chmod: ___syscall_chmod,
  /** @export */
  __syscall_connect: ___syscall_connect,
  /** @export */
  __syscall_dup3: ___syscall_dup3,
  /** @export */
  __syscall_faccessat: ___syscall_faccessat,
  /** @export */
  __syscall_fchmod: ___syscall_fchmod,
  /** @export */
  __syscall_fchmodat2: ___syscall_fchmodat2,
  /** @export */
  __syscall_fchown32: ___syscall_fchown32,
  /** @export */
  __syscall_fcntl64: ___syscall_fcntl64,
  /** @export */
  __syscall_fstat64: ___syscall_fstat64,
  /** @export */
  __syscall_ftruncate64: ___syscall_ftruncate64,
  /** @export */
  __syscall_getcwd: ___syscall_getcwd,
  /** @export */
  __syscall_getdents64: ___syscall_getdents64,
  /** @export */
  __syscall_getsockname: ___syscall_getsockname,
  /** @export */
  __syscall_getsockopt: ___syscall_getsockopt,
  /** @export */
  __syscall_ioctl: ___syscall_ioctl,
  /** @export */
  __syscall_listen: ___syscall_listen,
  /** @export */
  __syscall_lstat64: ___syscall_lstat64,
  /** @export */
  __syscall_mkdirat: ___syscall_mkdirat,
  /** @export */
  __syscall_newfstatat: ___syscall_newfstatat,
  /** @export */
  __syscall_openat: ___syscall_openat,
  /** @export */
  __syscall_pipe2: ___syscall_pipe2,
  /** @export */
  __syscall_poll: ___syscall_poll,
  /** @export */
  __syscall_readlinkat: ___syscall_readlinkat,
  /** @export */
  __syscall_recvfrom: ___syscall_recvfrom,
  /** @export */
  __syscall_renameat: ___syscall_renameat,
  /** @export */
  __syscall_rmdir: ___syscall_rmdir,
  /** @export */
  __syscall_sendto: ___syscall_sendto,
  /** @export */
  __syscall_socket: ___syscall_socket,
  /** @export */
  __syscall_stat64: ___syscall_stat64,
  /** @export */
  __syscall_statfs64: ___syscall_statfs64,
  /** @export */
  __syscall_symlinkat: ___syscall_symlinkat,
  /** @export */
  __syscall_umask: ___syscall_umask,
  /** @export */
  __syscall_unlinkat: ___syscall_unlinkat,
  /** @export */
  __syscall_utimensat: ___syscall_utimensat,
  /** @export */
  _abort_js: __abort_js,
  /** @export */
  _emscripten_runtime_keepalive_clear: __emscripten_runtime_keepalive_clear,
  /** @export */
  _emscripten_throw_longjmp: __emscripten_throw_longjmp,
  /** @export */
  _gmtime_js: __gmtime_js,
  /** @export */
  _localtime_js: __localtime_js,
  /** @export */
  _setitimer_js: __setitimer_js,
  /** @export */
  _tzset_js: __tzset_js,
  /** @export */
  clock_time_get: _clock_time_get,
  /** @export */
  emscripten_err: _emscripten_err,
  /** @export */
  emscripten_get_heap_max: _emscripten_get_heap_max,
  /** @export */
  emscripten_get_now: _emscripten_get_now,
  /** @export */
  emscripten_resize_heap: _emscripten_resize_heap,
  /** @export */
  environ_get: _environ_get,
  /** @export */
  environ_sizes_get: _environ_sizes_get,
  /** @export */
  exit: _exit,
  /** @export */
  fd_close: _fd_close,
  /** @export */
  fd_fdstat_get: _fd_fdstat_get,
  /** @export */
  fd_read: _fd_read,
  /** @export */
  fd_seek: _fd_seek,
  /** @export */
  fd_sync: _fd_sync,
  /** @export */
  fd_write: _fd_write,
  /** @export */
  getaddrinfo: _getaddrinfo,
  /** @export */
  invoke_i,
  /** @export */
  invoke_ii,
  /** @export */
  invoke_iii,
  /** @export */
  invoke_iiii,
  /** @export */
  invoke_iiiiiii,
  /** @export */
  invoke_iij,
  /** @export */
  invoke_ij,
  /** @export */
  invoke_iji,
  /** @export */
  invoke_ijii,
  /** @export */
  invoke_ijj,
  /** @export */
  invoke_ijjj,
  /** @export */
  invoke_j,
  /** @export */
  invoke_ji,
  /** @export */
  invoke_jii,
  /** @export */
  invoke_jiii,
  /** @export */
  invoke_jiij,
  /** @export */
  invoke_jiiji,
  /** @export */
  invoke_jij,
  /** @export */
  invoke_jijjii,
  /** @export */
  invoke_jj,
  /** @export */
  invoke_jji,
  /** @export */
  invoke_jjii,
  /** @export */
  invoke_jjij,
  /** @export */
  invoke_jjj,
  /** @export */
  invoke_jjji,
  /** @export */
  invoke_jjjiii,
  /** @export */
  invoke_jjjj,
  /** @export */
  invoke_jjjjj,
  /** @export */
  invoke_v,
  /** @export */
  invoke_vi,
  /** @export */
  invoke_vii,
  /** @export */
  invoke_viii,
  /** @export */
  invoke_viiiii,
  /** @export */
  invoke_vij,
  /** @export */
  invoke_viji,
  /** @export */
  invoke_vj,
  /** @export */
  invoke_vji,
  /** @export */
  invoke_vjij,
  /** @export */
  invoke_vjj,
  /** @export */
  invoke_vjjji,
  /** @export */
  invoke_vjjjj,
  /** @export */
  proc_exit: _proc_exit,
  /** @export */
  wasmacs_host_flush_terminal_output: _wasmacs_host_flush_terminal_output,
  /** @export */
  wasmacs_host_network_fetch_json,
  /** @export */
  wasmacs_host_terminal_resize_ack: _wasmacs_host_terminal_resize_ack,
  /** @export */
  wasmacs_host_terminal_resize_cols: _wasmacs_host_terminal_resize_cols,
  /** @export */
  wasmacs_host_terminal_resize_pending: _wasmacs_host_terminal_resize_pending,
  /** @export */
  wasmacs_host_terminal_resize_rows: _wasmacs_host_terminal_resize_rows,
  /** @export */
  wasmacs_host_wait_for_input: _wasmacs_host_wait_for_input,
  /** @export */
  wasmacs_os_timing_checkpoint: _wasmacs_os_timing_checkpoint
};

function invoke_v(index) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)();
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_ji(index,a1) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_jjij(index,a1,a2,a3) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2,a3);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_jjj(index,a1,a2) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_ij(index,a1) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_vi(index,a1) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_i(index) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)();
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_jj(index,a1) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_ijj(index,a1,a2) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_ii(index,a1) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_vii(index,a1,a2) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1,a2);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_jjii(index,a1,a2,a3) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2,a3);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_jij(index,a1,a2) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_jjji(index,a1,a2,a3) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2,a3);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_vij(index,a1,a2) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1,a2);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_iiii(index,a1,a2,a3) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2,a3);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_jiiji(index,a1,a2,a3,a4) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2,a3,a4);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_iii(index,a1,a2) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_jjjiii(index,a1,a2,a3,a4,a5) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2,a3,a4,a5);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_jii(index,a1,a2) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_vjj(index,a1,a2) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1,a2);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_vj(index,a1) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_j(index) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)();
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_viji(index,a1,a2,a3) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1,a2,a3);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_jijjii(index,a1,a2,a3,a4,a5) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2,a3,a4,a5);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_vjjjj(index,a1,a2,a3,a4) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1,a2,a3,a4);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_jjjj(index,a1,a2,a3) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2,a3);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_viii(index,a1,a2,a3) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1,a2,a3);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_viiiii(index,a1,a2,a3,a4,a5) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1,a2,a3,a4,a5);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_iiiiiii(index,a1,a2,a3,a4,a5,a6) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2,a3,a4,a5,a6);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_jiij(index,a1,a2,a3) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2,a3);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_iji(index,a1,a2) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_jji(index,a1,a2) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_ijjj(index,a1,a2,a3) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2,a3);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_jjjjj(index,a1,a2,a3,a4) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2,a3,a4);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_ijii(index,a1,a2,a3) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2,a3);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_vjjji(index,a1,a2,a3,a4) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1,a2,a3,a4);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_vji(index,a1,a2) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1,a2);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_jiii(index,a1,a2,a3) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2,a3);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
    return 0n;
  }
}

function invoke_vjij(index,a1,a2,a3) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1,a2,a3);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_iij(index,a1,a2) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}


// include: postamble.js
// === Auto-generated postamble setup entry stuff ===

var calledRun;

function callMain(args = []) {
  assert(runDependencies == 0, 'cannot call main when async dependencies remain! (listen on Module["onRuntimeInitialized"])');
  assert(typeof onPreRuns === 'undefined' || onPreRuns.length == 0, 'cannot call main when preRun functions remain to be called');

  var entryFunction = _main;

  args.unshift(thisProgram);

  var argc = args.length;
  var argv = stackAlloc((argc + 1) * 4);
  var argv_ptr = argv;
  for (var arg of args) {
    HEAPU32[((argv_ptr)>>2)] = stringToUTF8OnStack(arg);
    argv_ptr += 4;
  }
  HEAPU32[((argv_ptr)>>2)] = 0;

  try {

    var ret = entryFunction(argc, argv);

    // if we're not running an evented main loop, it's time to exit
    exitJS(ret, /* implicit = */ true);
    return ret;
  } catch (e) {
    return handleException(e);
  }
}

function stackCheckInit() {
  // This is normally called automatically during __wasm_call_ctors but need to
  // get these values before even running any of the ctors so we call it redundantly
  // here.
  _emscripten_stack_init();
  // TODO(sbc): Move writeStackCookie to native to to avoid this.
  writeStackCookie();
}

function run(args = arguments_) {

  if (runDependencies > 0) {
    dependenciesFulfilled = run;
    return;
  }

  stackCheckInit();

  preRun();

  // a preRun added a dependency, run will be called later
  if (runDependencies > 0) {
    dependenciesFulfilled = run;
    return;
  }

  function doRun() {
    // run may have just been called through dependencies being fulfilled just in this very frame,
    // or while the async setStatus time below was happening
    assert(!calledRun);
    calledRun = true;
    Module['calledRun'] = true;

    if (ABORT) return;

    initRuntime();

    preMain();

    Module['onRuntimeInitialized']?.();
    consumedModuleProp('onRuntimeInitialized');

    var noInitialRun = Module['noInitialRun'] || false;
    if (!noInitialRun) callMain(args);

    postRun();
  }

  if (Module['setStatus']) {
    Module['setStatus']('Running...');
    setTimeout(() => {
      setTimeout(() => Module['setStatus'](''), 1);
      doRun();
    }, 1);
  } else
  {
    doRun();
  }
  checkStackCookie();
}

function checkUnflushedContent() {
  // Compiler settings do not allow exiting the runtime, so flushing
  // the streams is not possible. but in ASSERTIONS mode we check
  // if there was something to flush, and if so tell the user they
  // should request that the runtime be exitable.
  // Normally we would not even include flush() at all, but in ASSERTIONS
  // builds we do so just for this check, and here we see if there is any
  // content to flush, that is, we check if there would have been
  // something a non-ASSERTIONS build would have not seen.
  // How we flush the streams depends on whether we are in SYSCALLS_REQUIRE_FILESYSTEM=0
  // mode (which has its own special function for this; otherwise, all
  // the code is inside libc)
  var oldOut = out;
  var oldErr = err;
  var has = false;
  out = err = (x) => {
    has = true;
  }
  try { // it doesn't matter if it fails
    _fflush(0);
    // also flush in the JS FS layer
    for (var name of ['stdout', 'stderr']) {
      var info = FS.analyzePath('/dev/' + name);
      if (!info) return;
      var stream = info.object;
      var rdev = stream.rdev;
      var tty = TTY.ttys[rdev];
      if (tty?.output?.length) {
        has = true;
      }
    }
  } catch(e) {}
  out = oldOut;
  err = oldErr;
  if (has) {
    warnOnce('stdio streams had content in them that was not flushed. you should set EXIT_RUNTIME to 1 (see the Emscripten FAQ), or make sure to emit a newline when you printf etc.');
  }
}

var wasmExports;

// With async instantation wasmExports is assigned asynchronously when the
// instance is received.
createWasm();

run();

// end include: postamble.js

