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
// include: /var/folders/l2/fl54zpqn0h52frtq4vglk4c80000gn/T/tmpkuj67bkw.js

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
    loadPackage({"files": [{"filename": "/usr/local/share/emacs/30.2/etc/AUTHORS", "start": 0, "end": 222634}, {"filename": "/usr/local/share/emacs/30.2/etc/CALC-NEWS", "start": 222634, "end": 258899}, {"filename": "/usr/local/share/emacs/30.2/etc/COPYING", "start": 258899, "end": 294048}, {"filename": "/usr/local/share/emacs/30.2/etc/ChangeLog.1", "start": 294048, "end": 496186}, {"filename": "/usr/local/share/emacs/30.2/etc/DEBUG", "start": 496186, "end": 559125}, {"filename": "/usr/local/share/emacs/30.2/etc/DEVEL.HUMOR", "start": 559125, "end": 568145}, {"filename": "/usr/local/share/emacs/30.2/etc/DISTRIB", "start": 568145, "end": 572712}, {"filename": "/usr/local/share/emacs/30.2/etc/EGLOT-NEWS", "start": 572712, "end": 596517}, {"filename": "/usr/local/share/emacs/30.2/etc/ERC-NEWS", "start": 596517, "end": 700474}, {"filename": "/usr/local/share/emacs/30.2/etc/ETAGS.EBNF", "start": 700474, "end": 704613}, {"filename": "/usr/local/share/emacs/30.2/etc/ETAGS.README", "start": 704613, "end": 706897}, {"filename": "/usr/local/share/emacs/30.2/etc/HELLO", "start": 706897, "end": 716135}, {"filename": "/usr/local/share/emacs/30.2/etc/HISTORY", "start": 716135, "end": 722278}, {"filename": "/usr/local/share/emacs/30.2/etc/JOKES", "start": 722278, "end": 734541}, {"filename": "/usr/local/share/emacs/30.2/etc/MACHINES", "start": 734541, "end": 741520}, {"filename": "/usr/local/share/emacs/30.2/etc/MH-E-NEWS", "start": 741520, "end": 856308}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS", "start": 856308, "end": 982216}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.1-17", "start": 982216, "end": 1081363}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.18", "start": 1081363, "end": 1145144}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.19", "start": 1145144, "end": 1418917}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.20", "start": 1418917, "end": 1607955}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.21", "start": 1607955, "end": 1800145}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.22", "start": 1800145, "end": 2038761}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.23", "start": 2038761, "end": 2141683}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.24", "start": 2141683, "end": 2296193}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.25", "start": 2296193, "end": 2373670}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.26", "start": 2373670, "end": 2454948}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.27", "start": 2454948, "end": 2596211}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.28", "start": 2596211, "end": 2770458}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.29", "start": 2770458, "end": 2959381}, {"filename": "/usr/local/share/emacs/30.2/etc/NEWS.unknown", "start": 2959381, "end": 2960151}, {"filename": "/usr/local/share/emacs/30.2/etc/NEXTSTEP", "start": 2960151, "end": 2972282}, {"filename": "/usr/local/share/emacs/30.2/etc/NXML-NEWS", "start": 2972282, "end": 2979658}, {"filename": "/usr/local/share/emacs/30.2/etc/ORG-NEWS", "start": 2979658, "end": 3308794}, {"filename": "/usr/local/share/emacs/30.2/etc/PROBLEMS", "start": 3308794, "end": 3507884}, {"filename": "/usr/local/share/emacs/30.2/etc/README", "start": 3507884, "end": 3508363}, {"filename": "/usr/local/share/emacs/30.2/etc/TERMS", "start": 3508363, "end": 3518418}, {"filename": "/usr/local/share/emacs/30.2/etc/TODO", "start": 3518418, "end": 3593763}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-10.map", "start": 3593763, "end": 3594649}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-11.map", "start": 3594649, "end": 3594761}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-13.map", "start": 3594761, "end": 3595789}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-14.map", "start": 3595789, "end": 3596376}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-15.map", "start": 3596376, "end": 3596635}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-16.map", "start": 3596635, "end": 3597462}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-2.map", "start": 3597462, "end": 3598602}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-3.map", "start": 3598602, "end": 3599313}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-4.map", "start": 3599313, "end": 3600268}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-5.map", "start": 3600268, "end": 3600449}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-6.map", "start": 3600449, "end": 3600620}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-7.map", "start": 3600620, "end": 3600941}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-8.map", "start": 3600941, "end": 3601139}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/8859-9.map", "start": 3601139, "end": 3601351}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/ALTERNATIVNYJ.map", "start": 3601351, "end": 3602312}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/BIG5-1.map", "start": 3602312, "end": 3689362}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/BIG5-2.map", "start": 3689362, "end": 3796978}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/BIG5-HKSCS.map", "start": 3796978, "end": 4046474}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/BIG5.map", "start": 4046474, "end": 4241142}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CNS-1.map", "start": 4241142, "end": 4318212}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CNS-2.map", "start": 4318212, "end": 4423048}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CNS-3.map", "start": 4423048, "end": 4507914}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CNS-4.map", "start": 4507914, "end": 4611686}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CNS-5.map", "start": 4611686, "end": 4737244}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CNS-6.map", "start": 4737244, "end": 4829892}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CNS-7.map", "start": 4829892, "end": 4924900}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CNS-F.map", "start": 4924900, "end": 4985023}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP10007.map", "start": 4985023, "end": 4985876}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1125.map", "start": 4985876, "end": 4986690}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1250.map", "start": 4986690, "end": 4988029}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1251.map", "start": 4988029, "end": 4988776}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1252.map", "start": 4988776, "end": 4989162}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1253.map", "start": 4989162, "end": 4989631}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1254.map", "start": 4989631, "end": 4990128}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1255.map", "start": 4990128, "end": 4990602}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1256.map", "start": 4990602, "end": 4991454}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1257.map", "start": 4991454, "end": 4992672}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP1258.map", "start": 4992672, "end": 4993367}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP720.map", "start": 4993367, "end": 4994563}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP737.map", "start": 4994563, "end": 4995574}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP775.map", "start": 4995574, "end": 4997121}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP858.map", "start": 4997121, "end": 4998839}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP932-2BYTE.map", "start": 4998839, "end": 5208536}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/CP949-2BYTE.map", "start": 5208536, "end": 5341206}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/EBCDICUK.map", "start": 5341206, "end": 5342205}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/EBCDICUS.map", "start": 5342205, "end": 5343204}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/GB180302.map", "start": 5343204, "end": 5508135}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/GB180304.map", "start": 5508135, "end": 5513701}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/GB2312.map", "start": 5513701, "end": 5607256}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/GBK.map", "start": 5607256, "end": 5770423}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/HP-ROMAN8.map", "start": 5770423, "end": 5771592}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM037.map", "start": 5771592, "end": 5773575}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM038.map", "start": 5773575, "end": 5774571}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM1004.map", "start": 5774571, "end": 5774910}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM1026.map", "start": 5774910, "end": 5776915}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM1047.map", "start": 5776915, "end": 5778906}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM256.map", "start": 5778906, "end": 5780882}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM273.map", "start": 5780882, "end": 5782872}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM274.map", "start": 5782872, "end": 5783868}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM275.map", "start": 5783868, "end": 5784864}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM277.map", "start": 5784864, "end": 5786847}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM278.map", "start": 5786847, "end": 5788842}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM280.map", "start": 5788842, "end": 5790858}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM281.map", "start": 5790858, "end": 5791854}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM284.map", "start": 5791854, "end": 5793830}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM285.map", "start": 5793830, "end": 5795813}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM290.map", "start": 5795813, "end": 5797345}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM297.map", "start": 5797345, "end": 5799354}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM420.map", "start": 5799354, "end": 5801183}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM423.map", "start": 5801183, "end": 5802719}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM424.map", "start": 5802719, "end": 5804119}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM437.map", "start": 5804119, "end": 5805646}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM500.map", "start": 5805646, "end": 5807622}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM850.map", "start": 5807622, "end": 5809158}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM851.map", "start": 5809158, "end": 5810362}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM852.map", "start": 5810362, "end": 5811847}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM855.map", "start": 5811847, "end": 5813437}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM856.map", "start": 5813437, "end": 5814293}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM857.map", "start": 5814293, "end": 5815779}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM860.map", "start": 5815779, "end": 5817306}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM861.map", "start": 5817306, "end": 5818840}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM862.map", "start": 5818840, "end": 5820074}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM863.map", "start": 5820074, "end": 5821608}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM864.map", "start": 5821608, "end": 5823022}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM865.map", "start": 5823022, "end": 5824556}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM866.map", "start": 5824556, "end": 5825377}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM868.map", "start": 5825377, "end": 5826517}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM869.map", "start": 5826517, "end": 5827594}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM870.map", "start": 5827594, "end": 5829728}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM871.map", "start": 5829728, "end": 5831718}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM874.map", "start": 5831718, "end": 5831924}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM875.map", "start": 5831924, "end": 5833477}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM880.map", "start": 5833477, "end": 5835177}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM891.map", "start": 5835177, "end": 5835250}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM903.map", "start": 5835250, "end": 5835323}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM904.map", "start": 5835323, "end": 5835432}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM905.map", "start": 5835432, "end": 5837354}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/IBM918.map", "start": 5837354, "end": 5839016}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/JISC6226.map", "start": 5839016, "end": 5934383}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/JISX0201.map", "start": 5934383, "end": 5934554}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/JISX0208.map", "start": 5934554, "end": 6030916}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/JISX0212.map", "start": 6030916, "end": 6098942}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/JISX2131.map", "start": 6098942, "end": 6221772}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/JISX2132.map", "start": 6221772, "end": 6257046}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/JISX213A.map", "start": 6257046, "end": 6257285}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/JOHAB.map", "start": 6257285, "end": 6346492}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/KA-ACADEMY.map", "start": 6346492, "end": 6346920}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/KA-PS.map", "start": 6346920, "end": 6347471}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/KOI-8.map", "start": 6347471, "end": 6348051}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/KOI8-R.map", "start": 6348051, "end": 6349070}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/KOI8-T.map", "start": 6349070, "end": 6350111}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/KOI8-U.map", "start": 6350111, "end": 6351265}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/KSC5601.map", "start": 6351265, "end": 6449531}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/KSC5636.map", "start": 6449531, "end": 6449634}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MACINTOSH.map", "start": 6449634, "end": 6451110}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MIK.map", "start": 6451110, "end": 6452010}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MULE-ethiopic.map", "start": 6452010, "end": 6456910}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MULE-ipa.map", "start": 6456910, "end": 6457712}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MULE-is13194.map", "start": 6457712, "end": 6458778}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MULE-lviscii.map", "start": 6458778, "end": 6459652}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MULE-sisheng.map", "start": 6459652, "end": 6460574}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MULE-tibetan.map", "start": 6460574, "end": 6463346}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/MULE-uviscii.map", "start": 6463346, "end": 6464220}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/NEXTSTEP.map", "start": 6464220, "end": 6465239}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/PTCP154.map", "start": 6465239, "end": 6466122}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/README", "start": 6466122, "end": 6467812}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/TIS-620.map", "start": 6467812, "end": 6467920}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/VISCII.map", "start": 6467920, "end": 6469508}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/VSCII-2.map", "start": 6469508, "end": 6470737}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/VSCII.map", "start": 6470737, "end": 6472535}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/stdenc.map", "start": 6472535, "end": 6474521}, {"filename": "/usr/local/share/emacs/30.2/etc/charsets/symbol.map", "start": 6474521, "end": 6476987}, {"filename": "/usr/local/share/emacs/30.2/etc/compilation.txt", "start": 6476987, "end": 6499550}, {"filename": "/usr/local/share/emacs/30.2/etc/copyright-assign.txt", "start": 6499550, "end": 6500520}, {"filename": "/usr/local/share/emacs/30.2/etc/e/README", "start": 6500520, "end": 6501111}, {"filename": "/usr/local/share/emacs/30.2/etc/e/eterm-color", "start": 6501111, "end": 6502429}, {"filename": "/usr/local/share/emacs/30.2/etc/e/eterm-color.ti", "start": 6502429, "end": 6504363}, {"filename": "/usr/local/share/emacs/30.2/etc/e/eterm-direct", "start": 6504363, "end": 6505760}, {"filename": "/usr/local/share/emacs/30.2/etc/edt-user.el", "start": 6505760, "end": 6512747}, {"filename": "/usr/local/share/emacs/30.2/etc/emacs-buffer.gdb", "start": 6512747, "end": 6521517}, {"filename": "/usr/local/share/emacs/30.2/etc/emacs-mail.desktop", "start": 6521517, "end": 6521773}, {"filename": "/usr/local/share/emacs/30.2/etc/emacs.desktop", "start": 6521773, "end": 6522181}, {"filename": "/usr/local/share/emacs/30.2/etc/emacs.icon", "start": 6522181, "end": 6524114}, {"filename": "/usr/local/share/emacs/30.2/etc/emacs.metainfo.xml", "start": 6524114, "end": 6526385}, {"filename": "/usr/local/share/emacs/30.2/etc/emacs.service", "start": 6526385, "end": 6527184}, {"filename": "/usr/local/share/emacs/30.2/etc/emacs_lldb.py", "start": 6527184, "end": 6540408}, {"filename": "/usr/local/share/emacs/30.2/etc/emacsclient-mail.desktop", "start": 6540408, "end": 6541024}, {"filename": "/usr/local/share/emacs/30.2/etc/emacsclient.desktop", "start": 6541024, "end": 6541858}, {"filename": "/usr/local/share/emacs/30.2/etc/enriched.txt", "start": 6541858, "end": 6553128}, {"filename": "/usr/local/share/emacs/30.2/etc/forms/README", "start": 6553128, "end": 6553197}, {"filename": "/usr/local/share/emacs/30.2/etc/forms/forms-d2.dat", "start": 6553197, "end": 6553762}, {"filename": "/usr/local/share/emacs/30.2/etc/forms/forms-d2.el", "start": 6553762, "end": 6556861}, {"filename": "/usr/local/share/emacs/30.2/etc/forms/forms-pass.el", "start": 6556861, "end": 6557553}, {"filename": "/usr/local/share/emacs/30.2/etc/future-bug", "start": 6557553, "end": 6559126}, {"filename": "/usr/local/share/emacs/30.2/etc/gnus-tut.txt", "start": 6559126, "end": 6569722}, {"filename": "/usr/local/share/emacs/30.2/etc/gnus/gnus-setup.ast", "start": 6569722, "end": 6571197}, {"filename": "/usr/local/share/emacs/30.2/etc/gnus/news-server.ast", "start": 6571197, "end": 6572926}, {"filename": "/usr/local/share/emacs/30.2/etc/grep.txt", "start": 6572926, "end": 6578015}, {"filename": "/usr/local/share/emacs/30.2/etc/images/README", "start": 6578015, "end": 6584195}, {"filename": "/usr/local/share/emacs/30.2/etc/images/alt.pbm", "start": 6584195, "end": 6584280}, {"filename": "/usr/local/share/emacs/30.2/etc/images/attach.pbm", "start": 6584280, "end": 6584361}, {"filename": "/usr/local/share/emacs/30.2/etc/images/attach.xpm", "start": 6584361, "end": 6587252}, {"filename": "/usr/local/share/emacs/30.2/etc/images/back-arrow.pbm", "start": 6587252, "end": 6587437}, {"filename": "/usr/local/share/emacs/30.2/etc/images/back-arrow.xpm", "start": 6587437, "end": 6588615}, {"filename": "/usr/local/share/emacs/30.2/etc/images/bookmark_add.pbm", "start": 6588615, "end": 6588696}, {"filename": "/usr/local/share/emacs/30.2/etc/images/bookmark_add.xpm", "start": 6588696, "end": 6592900}, {"filename": "/usr/local/share/emacs/30.2/etc/images/cancel.pbm", "start": 6592900, "end": 6592981}, {"filename": "/usr/local/share/emacs/30.2/etc/images/cancel.xpm", "start": 6592981, "end": 6593848}, {"filename": "/usr/local/share/emacs/30.2/etc/images/checkbox-mixed.svg", "start": 6593848, "end": 6594268}, {"filename": "/usr/local/share/emacs/30.2/etc/images/checked.svg", "start": 6594268, "end": 6594695}, {"filename": "/usr/local/share/emacs/30.2/etc/images/checked.xpm", "start": 6594695, "end": 6595009}, {"filename": "/usr/local/share/emacs/30.2/etc/images/close.pbm", "start": 6595009, "end": 6595208}, {"filename": "/usr/local/share/emacs/30.2/etc/images/close.xpm", "start": 6595208, "end": 6595961}, {"filename": "/usr/local/share/emacs/30.2/etc/images/commit.pbm", "start": 6595961, "end": 6596042}, {"filename": "/usr/local/share/emacs/30.2/etc/images/commit.xpm", "start": 6596042, "end": 6597862}, {"filename": "/usr/local/share/emacs/30.2/etc/images/conceal.pbm", "start": 6597862, "end": 6597903}, {"filename": "/usr/local/share/emacs/30.2/etc/images/conceal.svg", "start": 6597903, "end": 6599035}, {"filename": "/usr/local/share/emacs/30.2/etc/images/connect-to-url.pbm", "start": 6599035, "end": 6599116}, {"filename": "/usr/local/share/emacs/30.2/etc/images/connect-to-url.xpm", "start": 6599116, "end": 6604492}, {"filename": "/usr/local/share/emacs/30.2/etc/images/connect.pbm", "start": 6604492, "end": 6604573}, {"filename": "/usr/local/share/emacs/30.2/etc/images/connect.xpm", "start": 6604573, "end": 6606175}, {"filename": "/usr/local/share/emacs/30.2/etc/images/contact.pbm", "start": 6606175, "end": 6606256}, {"filename": "/usr/local/share/emacs/30.2/etc/images/contact.xpm", "start": 6606256, "end": 6609197}, {"filename": "/usr/local/share/emacs/30.2/etc/images/copy.pbm", "start": 6609197, "end": 6609324}, {"filename": "/usr/local/share/emacs/30.2/etc/images/copy.xpm", "start": 6609324, "end": 6610437}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ctrl.pbm", "start": 6610437, "end": 6610541}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/README", "start": 6610541, "end": 6610951}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/down-pushed.pbm", "start": 6610951, "end": 6610971}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/down-pushed.xpm", "start": 6610971, "end": 6611228}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/down.pbm", "start": 6611228, "end": 6611253}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/down.xpm", "start": 6611253, "end": 6611473}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/right-pushed.pbm", "start": 6611473, "end": 6611493}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/right-pushed.xpm", "start": 6611493, "end": 6611751}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/right.pbm", "start": 6611751, "end": 6611776}, {"filename": "/usr/local/share/emacs/30.2/etc/images/custom/right.xpm", "start": 6611776, "end": 6611997}, {"filename": "/usr/local/share/emacs/30.2/etc/images/cut.pbm", "start": 6611997, "end": 6612182}, {"filename": "/usr/local/share/emacs/30.2/etc/images/cut.xpm", "start": 6612182, "end": 6613504}, {"filename": "/usr/local/share/emacs/30.2/etc/images/data-save.pbm", "start": 6613504, "end": 6613585}, {"filename": "/usr/local/share/emacs/30.2/etc/images/data-save.xpm", "start": 6613585, "end": 6618266}, {"filename": "/usr/local/share/emacs/30.2/etc/images/delete.pbm", "start": 6618266, "end": 6618347}, {"filename": "/usr/local/share/emacs/30.2/etc/images/delete.xpm", "start": 6618347, "end": 6623543}, {"filename": "/usr/local/share/emacs/30.2/etc/images/describe.pbm", "start": 6623543, "end": 6623624}, {"filename": "/usr/local/share/emacs/30.2/etc/images/describe.xpm", "start": 6623624, "end": 6625379}, {"filename": "/usr/local/share/emacs/30.2/etc/images/diropen.pbm", "start": 6625379, "end": 6625460}, {"filename": "/usr/local/share/emacs/30.2/etc/images/diropen.xpm", "start": 6625460, "end": 6626321}, {"filename": "/usr/local/share/emacs/30.2/etc/images/disconnect.pbm", "start": 6626321, "end": 6626402}, {"filename": "/usr/local/share/emacs/30.2/etc/images/disconnect.xpm", "start": 6626402, "end": 6627767}, {"filename": "/usr/local/share/emacs/30.2/etc/images/down.svg", "start": 6627767, "end": 6632569}, {"filename": "/usr/local/share/emacs/30.2/etc/images/exit.pbm", "start": 6632569, "end": 6632650}, {"filename": "/usr/local/share/emacs/30.2/etc/images/exit.xpm", "start": 6632650, "end": 6636196}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/README", "start": 6636196, "end": 6636740}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/bits.pbm", "start": 6636740, "end": 6636779}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/bits.xpm", "start": 6636779, "end": 6637146}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/bitsbang.pbm", "start": 6637146, "end": 6637185}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/bitsbang.xpm", "start": 6637185, "end": 6637569}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/box-minus.pbm", "start": 6637569, "end": 6637623}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/box-minus.xpm", "start": 6637623, "end": 6638101}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/box-plus.pbm", "start": 6638101, "end": 6638155}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/box-plus.xpm", "start": 6638155, "end": 6638632}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/box.pbm", "start": 6638632, "end": 6638686}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/box.xpm", "start": 6638686, "end": 6639158}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/checkmark.pbm", "start": 6639158, "end": 6639197}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/checkmark.xpm", "start": 6639197, "end": 6639564}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/dir-minus.pbm", "start": 6639564, "end": 6639618}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/dir-minus.xpm", "start": 6639618, "end": 6640111}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/dir-plus.pbm", "start": 6640111, "end": 6640165}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/dir-plus.xpm", "start": 6640165, "end": 6640657}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/dir.pbm", "start": 6640657, "end": 6640711}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/dir.xpm", "start": 6640711, "end": 6641198}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/doc-minus.pbm", "start": 6641198, "end": 6641237}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/doc-minus.xpm", "start": 6641237, "end": 6641655}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/doc-plus.pbm", "start": 6641655, "end": 6641694}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/doc-plus.xpm", "start": 6641694, "end": 6642111}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/doc.pbm", "start": 6642111, "end": 6642150}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/doc.xpm", "start": 6642150, "end": 6642562}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/info.pbm", "start": 6642562, "end": 6642601}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/info.xpm", "start": 6642601, "end": 6642924}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/key.pbm", "start": 6642924, "end": 6642965}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/key.xpm", "start": 6642965, "end": 6643394}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/label.pbm", "start": 6643394, "end": 6643435}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/label.xpm", "start": 6643435, "end": 6643752}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/lock.pbm", "start": 6643752, "end": 6643793}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/lock.xpm", "start": 6643793, "end": 6644223}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/mail.pbm", "start": 6644223, "end": 6644277}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/mail.xpm", "start": 6644277, "end": 6644750}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/page-minus.pbm", "start": 6644750, "end": 6644804}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/page-minus.xpm", "start": 6644804, "end": 6645296}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/page-plus.pbm", "start": 6645296, "end": 6645350}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/page-plus.xpm", "start": 6645350, "end": 6645841}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/page.pbm", "start": 6645841, "end": 6645895}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/page.xpm", "start": 6645895, "end": 6646381}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-gt.pbm", "start": 6646381, "end": 6646435}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-gt.xpm", "start": 6646435, "end": 6646910}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-minus.pbm", "start": 6646910, "end": 6646964}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-minus.xpm", "start": 6646964, "end": 6647437}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-plus.pbm", "start": 6647437, "end": 6647491}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-plus.xpm", "start": 6647491, "end": 6647964}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-type.pbm", "start": 6647964, "end": 6648018}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-type.xpm", "start": 6648018, "end": 6648495}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-v.pbm", "start": 6648495, "end": 6648549}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag-v.xpm", "start": 6648549, "end": 6649023}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag.pbm", "start": 6649023, "end": 6649077}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/tag.xpm", "start": 6649077, "end": 6649549}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/unlock.pbm", "start": 6649549, "end": 6649590}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ezimage/unlock.xpm", "start": 6649590, "end": 6650022}, {"filename": "/usr/local/share/emacs/30.2/etc/images/fwd-arrow.pbm", "start": 6650022, "end": 6650207}, {"filename": "/usr/local/share/emacs/30.2/etc/images/fwd-arrow.xpm", "start": 6650207, "end": 6651579}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gen-changelog.pbm", "start": 6651579, "end": 6651660}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gen-changelog.xpm", "start": 6651660, "end": 6654941}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus.pbm", "start": 6654941, "end": 6664234}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/README", "start": 6664234, "end": 6666025}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/followup.pbm", "start": 6666025, "end": 6666106}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/followup.xpm", "start": 6666106, "end": 6666910}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/fuwo.pbm", "start": 6666910, "end": 6666991}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/fuwo.xpm", "start": 6666991, "end": 6667791}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/gnus-pointer.svg", "start": 6667791, "end": 6673218}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/gnus-pointer.xbm", "start": 6673218, "end": 6673499}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/gnus-pointer.xpm", "start": 6673499, "end": 6673952}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/gnus.png", "start": 6673952, "end": 6694003}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/gnus.svg", "start": 6694003, "end": 6709551}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/gnus.xbm", "start": 6709551, "end": 6757281}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/gnus.xpm", "start": 6757281, "end": 6832550}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/kill-group.pbm", "start": 6832550, "end": 6832631}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/kill-group.xpm", "start": 6832631, "end": 6833416}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/mail-reply.pbm", "start": 6833416, "end": 6833497}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/mail-reply.xpm", "start": 6833497, "end": 6834324}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/mail-send.pbm", "start": 6834324, "end": 6834405}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/mail-send.xpm", "start": 6834405, "end": 6835355}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/preview.xbm", "start": 6835355, "end": 6835933}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/preview.xpm", "start": 6835933, "end": 6836739}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/toggle-subscription.pbm", "start": 6836739, "end": 6836820}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gnus/toggle-subscription.xpm", "start": 6836820, "end": 6838024}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/README", "start": 6838024, "end": 6840187}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/all.pbm", "start": 6840187, "end": 6840268}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/all.xpm", "start": 6840268, "end": 6841049}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/break.pbm", "start": 6841049, "end": 6841130}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/break.xpm", "start": 6841130, "end": 6841883}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/cont.pbm", "start": 6841883, "end": 6841964}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/cont.xpm", "start": 6841964, "end": 6842780}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/down.pbm", "start": 6842780, "end": 6842861}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/down.xpm", "start": 6842861, "end": 6843872}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/finish.pbm", "start": 6843872, "end": 6843953}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/finish.xpm", "start": 6843953, "end": 6844782}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/go.pbm", "start": 6844782, "end": 6844863}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/go.xpm", "start": 6844863, "end": 6845640}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/next.pbm", "start": 6845640, "end": 6845721}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/next.xpm", "start": 6845721, "end": 6846548}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/nexti.pbm", "start": 6846548, "end": 6846629}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/nexti.xpm", "start": 6846629, "end": 6847476}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/pp.pbm", "start": 6847476, "end": 6847557}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/pp.xpm", "start": 6847557, "end": 6848313}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/print.pbm", "start": 6848313, "end": 6848394}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/print.xpm", "start": 6848394, "end": 6849153}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/pstar.pbm", "start": 6849153, "end": 6849234}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/pstar.xpm", "start": 6849234, "end": 6849993}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rcont.pbm", "start": 6849993, "end": 6850074}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rcont.xpm", "start": 6850074, "end": 6850898}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/recstart.pbm", "start": 6850898, "end": 6850979}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/recstart.xpm", "start": 6850979, "end": 6851732}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/recstop.pbm", "start": 6851732, "end": 6851813}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/recstop.xpm", "start": 6851813, "end": 6852566}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/remove.pbm", "start": 6852566, "end": 6852696}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/remove.xpm", "start": 6852696, "end": 6853464}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rfinish.pbm", "start": 6853464, "end": 6853545}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rfinish.xpm", "start": 6853545, "end": 6854365}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rnext.pbm", "start": 6854365, "end": 6854446}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rnext.xpm", "start": 6854446, "end": 6855281}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rnexti.pbm", "start": 6855281, "end": 6855362}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rnexti.xpm", "start": 6855362, "end": 6856183}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rstep.pbm", "start": 6856183, "end": 6856264}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rstep.xpm", "start": 6856264, "end": 6857101}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rstepi.pbm", "start": 6857101, "end": 6857182}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/rstepi.xpm", "start": 6857182, "end": 6857988}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/run.pbm", "start": 6857988, "end": 6858069}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/run.xpm", "start": 6858069, "end": 6858925}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/step.pbm", "start": 6858925, "end": 6859006}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/step.xpm", "start": 6859006, "end": 6859818}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/stepi.pbm", "start": 6859818, "end": 6859899}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/stepi.xpm", "start": 6859899, "end": 6860725}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/stop.pbm", "start": 6860725, "end": 6860806}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/stop.xpm", "start": 6860806, "end": 6861579}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/thread.pbm", "start": 6861579, "end": 6861660}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/thread.xpm", "start": 6861660, "end": 6862459}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/until.pbm", "start": 6862459, "end": 6862540}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/until.xpm", "start": 6862540, "end": 6863353}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/up.pbm", "start": 6863353, "end": 6863434}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/up.xpm", "start": 6863434, "end": 6864443}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/watch.pbm", "start": 6864443, "end": 6864524}, {"filename": "/usr/local/share/emacs/30.2/etc/images/gud/watch.xpm", "start": 6864524, "end": 6865473}, {"filename": "/usr/local/share/emacs/30.2/etc/images/help.pbm", "start": 6865473, "end": 6865658}, {"filename": "/usr/local/share/emacs/30.2/etc/images/help.xpm", "start": 6865658, "end": 6870862}, {"filename": "/usr/local/share/emacs/30.2/etc/images/home.pbm", "start": 6870862, "end": 6871047}, {"filename": "/usr/local/share/emacs/30.2/etc/images/home.xpm", "start": 6871047, "end": 6873963}, {"filename": "/usr/local/share/emacs/30.2/etc/images/hyper.pbm", "start": 6873963, "end": 6874086}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/README", "start": 6874086, "end": 6877511}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/closed.png", "start": 6877511, "end": 6877743}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/closed.xpm", "start": 6877743, "end": 6878158}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/empty.png", "start": 6878158, "end": 6878389}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/empty.xpm", "start": 6878389, "end": 6878806}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/end-connector.png", "start": 6878806, "end": 6878913}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/end-connector.xpm", "start": 6878913, "end": 6879242}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/extender-connector.png", "start": 6879242, "end": 6879334}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/extender-connector.xpm", "start": 6879334, "end": 6879663}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/leaf.png", "start": 6879663, "end": 6879874}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/leaf.xpm", "start": 6879874, "end": 6880473}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/locked-encrypted.png", "start": 6880473, "end": 6880683}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/locked-encrypted.xpm", "start": 6880683, "end": 6881055}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/mid-connector.png", "start": 6881055, "end": 6881180}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/mid-connector.xpm", "start": 6881180, "end": 6881509}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/opened.png", "start": 6881509, "end": 6881715}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/opened.xpm", "start": 6881715, "end": 6882072}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/skip-descender.png", "start": 6882072, "end": 6882156}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/skip-descender.xpm", "start": 6882156, "end": 6882470}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/through-descender.png", "start": 6882470, "end": 6882562}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/through-descender.xpm", "start": 6882562, "end": 6882891}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/unlocked-encrypted.png", "start": 6882891, "end": 6883093}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/dark-bg/unlocked-encrypted.xpm", "start": 6883093, "end": 6883465}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/closed.png", "start": 6883465, "end": 6883677}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/closed.xpm", "start": 6883677, "end": 6884001}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/empty.png", "start": 6884001, "end": 6884215}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/empty.xpm", "start": 6884215, "end": 6884557}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/end-connector.png", "start": 6884557, "end": 6884668}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/end-connector.xpm", "start": 6884668, "end": 6884997}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/extender-connector.png", "start": 6884997, "end": 6885102}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/extender-connector.xpm", "start": 6885102, "end": 6885431}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/leaf.png", "start": 6885431, "end": 6885642}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/leaf.xpm", "start": 6885642, "end": 6886241}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/locked-encrypted.png", "start": 6886241, "end": 6886451}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/locked-encrypted.xpm", "start": 6886451, "end": 6886823}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/mid-connector.png", "start": 6886823, "end": 6886938}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/mid-connector.xpm", "start": 6886938, "end": 6887267}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/opened.png", "start": 6887267, "end": 6887479}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/opened.xpm", "start": 6887479, "end": 6887821}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/skip-descender.png", "start": 6887821, "end": 6887905}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/skip-descender.xpm", "start": 6887905, "end": 6888219}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/through-descender.png", "start": 6888219, "end": 6888324}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/through-descender.xpm", "start": 6888324, "end": 6888653}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/unlocked-encrypted.png", "start": 6888653, "end": 6888855}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/allout-widgets/light-bg/unlocked-encrypted.xpm", "start": 6888855, "end": 6889227}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/128x128/apps/emacs.png", "start": 6889227, "end": 6902689}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/128x128/apps/emacs23.png", "start": 6902689, "end": 6924440}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/16x16/apps/emacs.png", "start": 6924440, "end": 6925394}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/16x16/apps/emacs22.png", "start": 6925394, "end": 6926099}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/16x16/apps/emacs23.png", "start": 6926099, "end": 6927102}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/24x24/apps/emacs.png", "start": 6927102, "end": 6928670}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/24x24/apps/emacs22.png", "start": 6928670, "end": 6929658}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/24x24/apps/emacs23.png", "start": 6929658, "end": 6931375}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/32x32/apps/emacs.png", "start": 6931375, "end": 6933611}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/32x32/apps/emacs22.png", "start": 6933611, "end": 6936015}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/32x32/apps/emacs23.png", "start": 6936015, "end": 6938557}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/48x48/apps/emacs.png", "start": 6938557, "end": 6942193}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/48x48/apps/emacs22.png", "start": 6942193, "end": 6945624}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/48x48/apps/emacs23.png", "start": 6945624, "end": 6951017}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/scalable/apps/emacs.ico", "start": 6951017, "end": 7036199}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/scalable/apps/emacs.svg", "start": 7036199, "end": 7049558}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/scalable/apps/emacs23.svg", "start": 7049558, "end": 7064062}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/scalable/mimetypes/emacs-document.svg", "start": 7064062, "end": 7077745}, {"filename": "/usr/local/share/emacs/30.2/etc/images/icons/hicolor/scalable/mimetypes/emacs-document23.svg", "start": 7077745, "end": 7089396}, {"filename": "/usr/local/share/emacs/30.2/etc/images/index.pbm", "start": 7089396, "end": 7089581}, {"filename": "/usr/local/share/emacs/30.2/etc/images/index.xpm", "start": 7089581, "end": 7093666}, {"filename": "/usr/local/share/emacs/30.2/etc/images/info.pbm", "start": 7093666, "end": 7093747}, {"filename": "/usr/local/share/emacs/30.2/etc/images/info.xpm", "start": 7093747, "end": 7094905}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ins-changelog.pbm", "start": 7094905, "end": 7094986}, {"filename": "/usr/local/share/emacs/30.2/etc/images/ins-changelog.xpm", "start": 7094986, "end": 7096310}, {"filename": "/usr/local/share/emacs/30.2/etc/images/jump-to.pbm", "start": 7096310, "end": 7096495}, {"filename": "/usr/local/share/emacs/30.2/etc/images/jump-to.xpm", "start": 7096495, "end": 7100102}, {"filename": "/usr/local/share/emacs/30.2/etc/images/last-page.pbm", "start": 7100102, "end": 7100183}, {"filename": "/usr/local/share/emacs/30.2/etc/images/last-page.xpm", "start": 7100183, "end": 7102333}, {"filename": "/usr/local/share/emacs/30.2/etc/images/left-arrow.pbm", "start": 7102333, "end": 7102518}, {"filename": "/usr/local/share/emacs/30.2/etc/images/left-arrow.xpm", "start": 7102518, "end": 7103892}, {"filename": "/usr/local/share/emacs/30.2/etc/images/left.svg", "start": 7103892, "end": 7108772}, {"filename": "/usr/local/share/emacs/30.2/etc/images/letter.pbm", "start": 7108772, "end": 7108801}, {"filename": "/usr/local/share/emacs/30.2/etc/images/letter.xpm", "start": 7108801, "end": 7109062}, {"filename": "/usr/local/share/emacs/30.2/etc/images/load-changelog.pbm", "start": 7109062, "end": 7109143}, {"filename": "/usr/local/share/emacs/30.2/etc/images/load-changelog.xpm", "start": 7109143, "end": 7110684}, {"filename": "/usr/local/share/emacs/30.2/etc/images/lock-broken.pbm", "start": 7110684, "end": 7110765}, {"filename": "/usr/local/share/emacs/30.2/etc/images/lock-broken.xpm", "start": 7110765, "end": 7115342}, {"filename": "/usr/local/share/emacs/30.2/etc/images/lock-ok.pbm", "start": 7115342, "end": 7115423}, {"filename": "/usr/local/share/emacs/30.2/etc/images/lock-ok.xpm", "start": 7115423, "end": 7119740}, {"filename": "/usr/local/share/emacs/30.2/etc/images/lock.pbm", "start": 7119740, "end": 7119821}, {"filename": "/usr/local/share/emacs/30.2/etc/images/lock.xpm", "start": 7119821, "end": 7124327}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/README", "start": 7124327, "end": 7124815}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/back-arrow.xpm", "start": 7124815, "end": 7125632}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/copy.xpm", "start": 7125632, "end": 7126444}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/cut.xpm", "start": 7126444, "end": 7127271}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/fwd-arrow.xpm", "start": 7127271, "end": 7128072}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/help.xpm", "start": 7128072, "end": 7128976}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/home.xpm", "start": 7128976, "end": 7129865}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/index.xpm", "start": 7129865, "end": 7130694}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/jump-to.xpm", "start": 7130694, "end": 7131540}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/left-arrow.xpm", "start": 7131540, "end": 7132374}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/new.xpm", "start": 7132374, "end": 7133186}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/next-node.xpm", "start": 7133186, "end": 7134033}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/open.xpm", "start": 7134033, "end": 7134876}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/paste.xpm", "start": 7134876, "end": 7135720}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/preferences.xpm", "start": 7135720, "end": 7136601}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/prev-node.xpm", "start": 7136601, "end": 7137433}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/print.xpm", "start": 7137433, "end": 7138247}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/right-arrow.xpm", "start": 7138247, "end": 7139067}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/save.xpm", "start": 7139067, "end": 7139970}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/saveas.xpm", "start": 7139970, "end": 7140891}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/search.xpm", "start": 7140891, "end": 7141706}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/spell.xpm", "start": 7141706, "end": 7142550}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/undo.xpm", "start": 7142550, "end": 7143348}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/up-arrow.xpm", "start": 7143348, "end": 7144195}, {"filename": "/usr/local/share/emacs/30.2/etc/images/low-color/up-node.xpm", "start": 7144195, "end": 7145040}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/README", "start": 7145040, "end": 7146677}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/compose.pbm", "start": 7146677, "end": 7146758}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/compose.xpm", "start": 7146758, "end": 7151240}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/copy.pbm", "start": 7151240, "end": 7151321}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/copy.xpm", "start": 7151321, "end": 7153210}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/flag-for-followup.pbm", "start": 7153210, "end": 7153291}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/flag-for-followup.xpm", "start": 7153291, "end": 7157164}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/forward.pbm", "start": 7157164, "end": 7157245}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/forward.xpm", "start": 7157245, "end": 7158957}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/inbox.pbm", "start": 7158957, "end": 7159038}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/inbox.xpm", "start": 7159038, "end": 7160908}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/move.pbm", "start": 7160908, "end": 7160989}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/move.xpm", "start": 7160989, "end": 7162863}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/not-spam.pbm", "start": 7162863, "end": 7162944}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/not-spam.xpm", "start": 7162944, "end": 7166206}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/outbox.pbm", "start": 7166206, "end": 7166287}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/outbox.xpm", "start": 7166287, "end": 7168053}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/preview.pbm", "start": 7168053, "end": 7168134}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/preview.xpm", "start": 7168134, "end": 7171858}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/repack.pbm", "start": 7171858, "end": 7171939}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/repack.xpm", "start": 7171939, "end": 7173909}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/reply-all.pbm", "start": 7173909, "end": 7173990}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/reply-all.xpm", "start": 7173990, "end": 7177693}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/reply-from.pbm", "start": 7177693, "end": 7177774}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/reply-from.xpm", "start": 7177774, "end": 7179643}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/reply-to.pbm", "start": 7179643, "end": 7179724}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/reply-to.xpm", "start": 7179724, "end": 7183892}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/reply.pbm", "start": 7183892, "end": 7183973}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/reply.xpm", "start": 7183973, "end": 7185713}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/save-draft.pbm", "start": 7185713, "end": 7185794}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/save-draft.xpm", "start": 7185794, "end": 7187612}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/save.xpm", "start": 7187612, "end": 7193141}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/send.pbm", "start": 7193141, "end": 7193222}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/send.xpm", "start": 7193222, "end": 7194826}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mail/spam.xpm", "start": 7194826, "end": 7199172}, {"filename": "/usr/local/share/emacs/30.2/etc/images/meta.pbm", "start": 7199172, "end": 7199276}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mh-logo.pbm", "start": 7199276, "end": 7199324}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mh-logo.xpm", "start": 7199324, "end": 7199700}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/README", "start": 7199700, "end": 7200006}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/add.pbm", "start": 7200006, "end": 7200087}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/add.xpm", "start": 7200087, "end": 7200891}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/ffwd.pbm", "start": 7200891, "end": 7200972}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/ffwd.xpm", "start": 7200972, "end": 7201800}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/next.pbm", "start": 7201800, "end": 7201881}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/next.xpm", "start": 7201881, "end": 7202709}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/pause.pbm", "start": 7202709, "end": 7202790}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/pause.xpm", "start": 7202790, "end": 7203596}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/play.pbm", "start": 7203596, "end": 7203677}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/play.xpm", "start": 7203677, "end": 7204505}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/prev.pbm", "start": 7204505, "end": 7204586}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/prev.xpm", "start": 7204586, "end": 7205391}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/rewind.pbm", "start": 7205391, "end": 7205472}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/rewind.xpm", "start": 7205472, "end": 7206279}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/stop.pbm", "start": 7206279, "end": 7206360}, {"filename": "/usr/local/share/emacs/30.2/etc/images/mpc/stop.xpm", "start": 7206360, "end": 7207165}, {"filename": "/usr/local/share/emacs/30.2/etc/images/new.pbm", "start": 7207165, "end": 7207350}, {"filename": "/usr/local/share/emacs/30.2/etc/images/new.xpm", "start": 7207350, "end": 7210681}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/README", "start": 7210681, "end": 7211059}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/browse-url.xpm", "start": 7211059, "end": 7212368}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/get-all.xpm", "start": 7212368, "end": 7214144}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/mark-immortal.xpm", "start": 7214144, "end": 7216940}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/mark-read.xpm", "start": 7216940, "end": 7218328}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/narrow.xpm", "start": 7218328, "end": 7219773}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/next-feed.xpm", "start": 7219773, "end": 7221356}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/next-item.xpm", "start": 7221356, "end": 7222709}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/prev-feed.xpm", "start": 7222709, "end": 7224217}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/prev-item.xpm", "start": 7224217, "end": 7225529}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/rss-feed.png", "start": 7225529, "end": 7226168}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/rss-feed.svg", "start": 7226168, "end": 7230274}, {"filename": "/usr/local/share/emacs/30.2/etc/images/newsticker/update.xpm", "start": 7230274, "end": 7231554}, {"filename": "/usr/local/share/emacs/30.2/etc/images/next-node.pbm", "start": 7231554, "end": 7231681}, {"filename": "/usr/local/share/emacs/30.2/etc/images/next-node.xpm", "start": 7231681, "end": 7232680}, {"filename": "/usr/local/share/emacs/30.2/etc/images/next-page.pbm", "start": 7232680, "end": 7232761}, {"filename": "/usr/local/share/emacs/30.2/etc/images/next-page.xpm", "start": 7232761, "end": 7235543}, {"filename": "/usr/local/share/emacs/30.2/etc/images/open.pbm", "start": 7235543, "end": 7235728}, {"filename": "/usr/local/share/emacs/30.2/etc/images/open.xpm", "start": 7235728, "end": 7239796}, {"filename": "/usr/local/share/emacs/30.2/etc/images/outline-close.pbm", "start": 7239796, "end": 7239835}, {"filename": "/usr/local/share/emacs/30.2/etc/images/outline-close.svg", "start": 7239835, "end": 7240051}, {"filename": "/usr/local/share/emacs/30.2/etc/images/outline-open.pbm", "start": 7240051, "end": 7240090}, {"filename": "/usr/local/share/emacs/30.2/etc/images/outline-open.svg", "start": 7240090, "end": 7240264}, {"filename": "/usr/local/share/emacs/30.2/etc/images/paste.pbm", "start": 7240264, "end": 7240449}, {"filename": "/usr/local/share/emacs/30.2/etc/images/paste.xpm", "start": 7240449, "end": 7242508}, {"filename": "/usr/local/share/emacs/30.2/etc/images/preferences.pbm", "start": 7242508, "end": 7242693}, {"filename": "/usr/local/share/emacs/30.2/etc/images/preferences.xpm", "start": 7242693, "end": 7244728}, {"filename": "/usr/local/share/emacs/30.2/etc/images/prev-node.pbm", "start": 7244728, "end": 7244855}, {"filename": "/usr/local/share/emacs/30.2/etc/images/prev-node.xpm", "start": 7244855, "end": 7245839}, {"filename": "/usr/local/share/emacs/30.2/etc/images/print.pbm", "start": 7245839, "end": 7246024}, {"filename": "/usr/local/share/emacs/30.2/etc/images/print.xpm", "start": 7246024, "end": 7250125}, {"filename": "/usr/local/share/emacs/30.2/etc/images/radio-checked.svg", "start": 7250125, "end": 7250575}, {"filename": "/usr/local/share/emacs/30.2/etc/images/radio-mixed.svg", "start": 7250575, "end": 7250902}, {"filename": "/usr/local/share/emacs/30.2/etc/images/radio.svg", "start": 7250902, "end": 7251141}, {"filename": "/usr/local/share/emacs/30.2/etc/images/redo.pbm", "start": 7251141, "end": 7251222}, {"filename": "/usr/local/share/emacs/30.2/etc/images/redo.xpm", "start": 7251222, "end": 7252581}, {"filename": "/usr/local/share/emacs/30.2/etc/images/refresh.pbm", "start": 7252581, "end": 7252662}, {"filename": "/usr/local/share/emacs/30.2/etc/images/refresh.xpm", "start": 7252662, "end": 7255981}, {"filename": "/usr/local/share/emacs/30.2/etc/images/reveal.pbm", "start": 7255981, "end": 7256022}, {"filename": "/usr/local/share/emacs/30.2/etc/images/reveal.svg", "start": 7256022, "end": 7256613}, {"filename": "/usr/local/share/emacs/30.2/etc/images/right-arrow.pbm", "start": 7256613, "end": 7256798}, {"filename": "/usr/local/share/emacs/30.2/etc/images/right-arrow.xpm", "start": 7256798, "end": 7258143}, {"filename": "/usr/local/share/emacs/30.2/etc/images/right.svg", "start": 7258143, "end": 7263021}, {"filename": "/usr/local/share/emacs/30.2/etc/images/save.pbm", "start": 7263021, "end": 7263148}, {"filename": "/usr/local/share/emacs/30.2/etc/images/save.xpm", "start": 7263148, "end": 7267968}, {"filename": "/usr/local/share/emacs/30.2/etc/images/saveas.pbm", "start": 7267968, "end": 7268153}, {"filename": "/usr/local/share/emacs/30.2/etc/images/saveas.xpm", "start": 7268153, "end": 7273647}, {"filename": "/usr/local/share/emacs/30.2/etc/images/search-replace.pbm", "start": 7273647, "end": 7273728}, {"filename": "/usr/local/share/emacs/30.2/etc/images/search-replace.xpm", "start": 7273728, "end": 7278926}, {"filename": "/usr/local/share/emacs/30.2/etc/images/search.pbm", "start": 7278926, "end": 7279111}, {"filename": "/usr/local/share/emacs/30.2/etc/images/search.xpm", "start": 7279111, "end": 7283725}, {"filename": "/usr/local/share/emacs/30.2/etc/images/separator.pbm", "start": 7283725, "end": 7283757}, {"filename": "/usr/local/share/emacs/30.2/etc/images/separator.xpm", "start": 7283757, "end": 7284001}, {"filename": "/usr/local/share/emacs/30.2/etc/images/shift.pbm", "start": 7284001, "end": 7284170}, {"filename": "/usr/local/share/emacs/30.2/etc/images/show.pbm", "start": 7284170, "end": 7284251}, {"filename": "/usr/local/share/emacs/30.2/etc/images/show.xpm", "start": 7284251, "end": 7287999}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/README", "start": 7287999, "end": 7288442}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/blink.pbm", "start": 7288442, "end": 7288479}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/blink.xpm", "start": 7288479, "end": 7288813}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/braindamaged.pbm", "start": 7288813, "end": 7288850}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/braindamaged.xpm", "start": 7288850, "end": 7289182}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/cry.pbm", "start": 7289182, "end": 7289219}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/cry.xpm", "start": 7289219, "end": 7289551}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/dead.pbm", "start": 7289551, "end": 7289588}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/dead.xpm", "start": 7289588, "end": 7289921}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/evil.pbm", "start": 7289921, "end": 7289958}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/evil.xpm", "start": 7289958, "end": 7290295}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/forced.pbm", "start": 7290295, "end": 7290332}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/forced.xpm", "start": 7290332, "end": 7290667}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/frown.pbm", "start": 7290667, "end": 7290704}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/frown.xpm", "start": 7290704, "end": 7291038}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/README", "start": 7291038, "end": 7291370}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/blink.xpm", "start": 7291370, "end": 7291778}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/braindamaged.xpm", "start": 7291778, "end": 7292178}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/cry.xpm", "start": 7292178, "end": 7292569}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/dead.xpm", "start": 7292569, "end": 7292931}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/evil.xpm", "start": 7292931, "end": 7293323}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/forced.xpm", "start": 7293323, "end": 7293717}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/frown.xpm", "start": 7293717, "end": 7294095}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/grin.xpm", "start": 7294095, "end": 7294517}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/indifferent.xpm", "start": 7294517, "end": 7294916}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/reverse-smile.xpm", "start": 7294916, "end": 7295302}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/sad.xpm", "start": 7295302, "end": 7295678}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/smile.xpm", "start": 7295678, "end": 7296056}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grayscale/wry.xpm", "start": 7296056, "end": 7296447}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grin.pbm", "start": 7296447, "end": 7296484}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/grin.xpm", "start": 7296484, "end": 7296832}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/indifferent.pbm", "start": 7296832, "end": 7296869}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/indifferent.xpm", "start": 7296869, "end": 7297209}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/README", "start": 7297209, "end": 7297541}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/blink.xpm", "start": 7297541, "end": 7298063}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/braindamaged.xpm", "start": 7298063, "end": 7298576}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/cry.xpm", "start": 7298576, "end": 7299080}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/dead.xpm", "start": 7299080, "end": 7299585}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/evil.xpm", "start": 7299585, "end": 7300106}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/forced.xpm", "start": 7300106, "end": 7300613}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/frown.xpm", "start": 7300613, "end": 7301119}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/grin.xpm", "start": 7301119, "end": 7301655}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/indifferent.xpm", "start": 7301655, "end": 7302167}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/reverse-smile.xpm", "start": 7302167, "end": 7302697}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/sad.xpm", "start": 7302697, "end": 7303201}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/smile.xpm", "start": 7303201, "end": 7303723}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/medium/wry.xpm", "start": 7303723, "end": 7304227}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/sad.pbm", "start": 7304227, "end": 7304264}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/sad.xpm", "start": 7304264, "end": 7304596}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/smile.pbm", "start": 7304596, "end": 7304633}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/smile.xpm", "start": 7304633, "end": 7304967}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/wry.pbm", "start": 7304967, "end": 7305004}, {"filename": "/usr/local/share/emacs/30.2/etc/images/smilies/wry.xpm", "start": 7305004, "end": 7305336}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-ascending.pbm", "start": 7305336, "end": 7305417}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-ascending.xpm", "start": 7305417, "end": 7306660}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-column-ascending.pbm", "start": 7306660, "end": 7306741}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-column-ascending.xpm", "start": 7306741, "end": 7307516}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-criteria.pbm", "start": 7307516, "end": 7307597}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-criteria.xpm", "start": 7307597, "end": 7308755}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-descending.pbm", "start": 7308755, "end": 7308836}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-descending.xpm", "start": 7308836, "end": 7310095}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-row-ascending.pbm", "start": 7310095, "end": 7310155}, {"filename": "/usr/local/share/emacs/30.2/etc/images/sort-row-ascending.xpm", "start": 7310155, "end": 7310680}, {"filename": "/usr/local/share/emacs/30.2/etc/images/spell.pbm", "start": 7310680, "end": 7310865}, {"filename": "/usr/local/share/emacs/30.2/etc/images/spell.xpm", "start": 7310865, "end": 7312144}, {"filename": "/usr/local/share/emacs/30.2/etc/images/splash.bmp", "start": 7312144, "end": 7466686}, {"filename": "/usr/local/share/emacs/30.2/etc/images/splash.pbm", "start": 7466686, "end": 7476483}, {"filename": "/usr/local/share/emacs/30.2/etc/images/splash.png", "start": 7476483, "end": 7501643}, {"filename": "/usr/local/share/emacs/30.2/etc/images/splash.svg", "start": 7501643, "end": 7513820}, {"filename": "/usr/local/share/emacs/30.2/etc/images/splash.xpm", "start": 7513820, "end": 7672137}, {"filename": "/usr/local/share/emacs/30.2/etc/images/super.pbm", "start": 7672137, "end": 7672260}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/README", "start": 7672260, "end": 7673730}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/check-mark_16.pbm", "start": 7673730, "end": 7673771}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/check-mark_16.svg", "start": 7673771, "end": 7673989}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/chevron_down_16.pbm", "start": 7673989, "end": 7674030}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/chevron_down_16.svg", "start": 7674030, "end": 7674177}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/chevron_left_16.pbm", "start": 7674177, "end": 7674218}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/chevron_left_16.svg", "start": 7674218, "end": 7674377}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/chevron_right_16.pbm", "start": 7674377, "end": 7674418}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/chevron_right_16.svg", "start": 7674418, "end": 7674583}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/chevron_up_16.pbm", "start": 7674583, "end": 7674624}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/chevron_up_16.svg", "start": 7674624, "end": 7674772}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/cross_16.pbm", "start": 7674772, "end": 7674813}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/cross_16.svg", "start": 7674813, "end": 7675104}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/cross_circle_16.pbm", "start": 7675104, "end": 7675145}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/cross_circle_16.svg", "start": 7675145, "end": 7675684}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/cross_circle_fill_16.pbm", "start": 7675684, "end": 7675725}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/cross_circle_fill_16.svg", "start": 7675725, "end": 7676160}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/dot_large_16.pbm", "start": 7676160, "end": 7676201}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/dot_large_16.svg", "start": 7676201, "end": 7676324}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/dot_medium_16.pbm", "start": 7676324, "end": 7676365}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/dot_medium_16.svg", "start": 7676365, "end": 7676488}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/dot_small_16.pbm", "start": 7676488, "end": 7676529}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/dot_small_16.svg", "start": 7676529, "end": 7676652}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/heart_16.pbm", "start": 7676652, "end": 7676693}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/heart_16.svg", "start": 7676693, "end": 7677202}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/heart_fill_16.pbm", "start": 7677202, "end": 7677243}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/heart_fill_16.svg", "start": 7677243, "end": 7677493}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/heart_half_16.pbm", "start": 7677493, "end": 7677534}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/heart_half_16.svg", "start": 7677534, "end": 7677942}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/menu_16.pbm", "start": 7677942, "end": 7677983}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/menu_16.svg", "start": 7677983, "end": 7678176}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/minus_16.pbm", "start": 7678176, "end": 7678217}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/minus_16.svg", "start": 7678217, "end": 7678344}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/minus_circle_16.pbm", "start": 7678344, "end": 7678385}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/minus_circle_16.svg", "start": 7678385, "end": 7678764}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/minus_circle_fill_16.pbm", "start": 7678764, "end": 7678805}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/minus_circle_fill_16.svg", "start": 7678805, "end": 7679070}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/plus_16.pbm", "start": 7679070, "end": 7679111}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/plus_16.svg", "start": 7679111, "end": 7679258}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/plus_circle_16.pbm", "start": 7679258, "end": 7679299}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/plus_circle_16.svg", "start": 7679299, "end": 7679696}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/plus_circle_fill_16.pbm", "start": 7679696, "end": 7679737}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/plus_circle_fill_16.svg", "start": 7679737, "end": 7680018}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/star_16.pbm", "start": 7680018, "end": 7680059}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/star_16.svg", "start": 7680059, "end": 7680511}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/star_fill_16.pbm", "start": 7680511, "end": 7680552}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/star_fill_16.svg", "start": 7680552, "end": 7680797}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/star_half_16.pbm", "start": 7680797, "end": 7680869}, {"filename": "/usr/local/share/emacs/30.2/etc/images/symbols/star_half_16.svg", "start": 7680869, "end": 7681266}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tabs/README", "start": 7681266, "end": 7681595}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tabs/close.xpm", "start": 7681595, "end": 7681821}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tabs/left-arrow.xpm", "start": 7681821, "end": 7682052}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tabs/new.xpm", "start": 7682052, "end": 7682276}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tabs/right-arrow.xpm", "start": 7682276, "end": 7682508}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/README", "start": 7682508, "end": 7682956}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/close.png", "start": 7682956, "end": 7683256}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/close.xpm", "start": 7683256, "end": 7683862}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/empty.png", "start": 7683862, "end": 7684160}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/empty.xpm", "start": 7684160, "end": 7684766}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/end-guide.png", "start": 7684766, "end": 7684947}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/end-guide.xpm", "start": 7684947, "end": 7685241}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/guide.png", "start": 7685241, "end": 7685421}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/guide.xpm", "start": 7685421, "end": 7685711}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/handle.png", "start": 7685711, "end": 7685891}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/handle.xpm", "start": 7685891, "end": 7686267}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/leaf.png", "start": 7686267, "end": 7686544}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/leaf.xpm", "start": 7686544, "end": 7687149}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/no-guide.png", "start": 7687149, "end": 7687319}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/no-guide.xpm", "start": 7687319, "end": 7687597}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/no-handle.png", "start": 7687597, "end": 7687770}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/no-handle.xpm", "start": 7687770, "end": 7688134}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/nohandle-guide.png", "start": 7688134, "end": 7688314}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/nohandle-guide.xpm", "start": 7688314, "end": 7688604}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/open.png", "start": 7688604, "end": 7688917}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/default/open.xpm", "start": 7688917, "end": 7689553}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/README", "start": 7689553, "end": 7690005}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/close.png", "start": 7690005, "end": 7690303}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/close.xpm", "start": 7690303, "end": 7691020}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/empty.png", "start": 7691020, "end": 7691325}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/empty.xpm", "start": 7691325, "end": 7691967}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/end-guide.png", "start": 7691967, "end": 7692144}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/end-guide.xpm", "start": 7692144, "end": 7692448}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/guide.png", "start": 7692448, "end": 7692626}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/guide.xpm", "start": 7692626, "end": 7692926}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/handle.png", "start": 7692926, "end": 7693106}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/handle.xpm", "start": 7693106, "end": 7693496}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/leaf.png", "start": 7693496, "end": 7693832}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/leaf.xpm", "start": 7693832, "end": 7694457}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/no-guide.png", "start": 7694457, "end": 7694628}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/no-guide.xpm", "start": 7694628, "end": 7694916}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/no-handle.png", "start": 7694916, "end": 7695089}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/no-handle.xpm", "start": 7695089, "end": 7695467}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/nohandle-guide.png", "start": 7695467, "end": 7695645}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/nohandle-guide.xpm", "start": 7695645, "end": 7695945}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/open.png", "start": 7695945, "end": 7696289}, {"filename": "/usr/local/share/emacs/30.2/etc/images/tree-widget/folder/open.xpm", "start": 7696289, "end": 7696990}, {"filename": "/usr/local/share/emacs/30.2/etc/images/unchecked.pbm", "start": 7696990, "end": 7697023}, {"filename": "/usr/local/share/emacs/30.2/etc/images/unchecked.svg", "start": 7697023, "end": 7697355}, {"filename": "/usr/local/share/emacs/30.2/etc/images/unchecked.xpm", "start": 7697355, "end": 7697671}, {"filename": "/usr/local/share/emacs/30.2/etc/images/undo.pbm", "start": 7697671, "end": 7697856}, {"filename": "/usr/local/share/emacs/30.2/etc/images/undo.xpm", "start": 7697856, "end": 7699044}, {"filename": "/usr/local/share/emacs/30.2/etc/images/up-arrow.pbm", "start": 7699044, "end": 7699229}, {"filename": "/usr/local/share/emacs/30.2/etc/images/up-arrow.xpm", "start": 7699229, "end": 7700961}, {"filename": "/usr/local/share/emacs/30.2/etc/images/up-node.pbm", "start": 7700961, "end": 7701088}, {"filename": "/usr/local/share/emacs/30.2/etc/images/up-node.xpm", "start": 7701088, "end": 7702085}, {"filename": "/usr/local/share/emacs/30.2/etc/images/up.svg", "start": 7702085, "end": 7706886}, {"filename": "/usr/local/share/emacs/30.2/etc/images/view-diff.pbm", "start": 7706886, "end": 7706967}, {"filename": "/usr/local/share/emacs/30.2/etc/images/view-diff.xpm", "start": 7706967, "end": 7708667}, {"filename": "/usr/local/share/emacs/30.2/etc/images/zoom-in.pbm", "start": 7708667, "end": 7708748}, {"filename": "/usr/local/share/emacs/30.2/etc/images/zoom-in.xpm", "start": 7708748, "end": 7712163}, {"filename": "/usr/local/share/emacs/30.2/etc/images/zoom-out.pbm", "start": 7712163, "end": 7712244}, {"filename": "/usr/local/share/emacs/30.2/etc/images/zoom-out.xpm", "start": 7712244, "end": 7715644}, {"filename": "/usr/local/share/emacs/30.2/etc/nxml/README", "start": 7715644, "end": 7715691}, {"filename": "/usr/local/share/emacs/30.2/etc/nxml/test-invalid.xml", "start": 7715691, "end": 7715889}, {"filename": "/usr/local/share/emacs/30.2/etc/nxml/test-valid.xml", "start": 7715889, "end": 7716074}, {"filename": "/usr/local/share/emacs/30.2/etc/org.gnu.emacs.defaults.gschema.xml", "start": 7716074, "end": 7719468}, {"filename": "/usr/local/share/emacs/30.2/etc/org/OrgOdtContentTemplate.xml", "start": 7719468, "end": 7740434}, {"filename": "/usr/local/share/emacs/30.2/etc/org/OrgOdtStyles.xml", "start": 7740434, "end": 7811132}, {"filename": "/usr/local/share/emacs/30.2/etc/org/README", "start": 7811132, "end": 7812481}, {"filename": "/usr/local/share/emacs/30.2/etc/org/csl/README", "start": 7812481, "end": 7812801}, {"filename": "/usr/local/share/emacs/30.2/etc/org/csl/chicago-author-date.csl", "start": 7812801, "end": 7834996}, {"filename": "/usr/local/share/emacs/30.2/etc/org/csl/locales-en-US.xml", "start": 7834996, "end": 7846364}, {"filename": "/usr/local/share/emacs/30.2/etc/package-keyring.gpg", "start": 7846364, "end": 7848707}, {"filename": "/usr/local/share/emacs/30.2/etc/ps-prin0.ps", "start": 7848707, "end": 7854033}, {"filename": "/usr/local/share/emacs/30.2/etc/ps-prin1.ps", "start": 7854033, "end": 7877268}, {"filename": "/usr/local/share/emacs/30.2/etc/publicsuffix.txt", "start": 7877268, "end": 8193920}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/Makefile", "start": 8193920, "end": 8203910}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/README", "start": 8203910, "end": 8207236}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/calccard.tex", "start": 8207236, "end": 8227604}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/cs-dired-ref.tex", "start": 8227604, "end": 8241842}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/cs-refcard.tex", "start": 8241842, "end": 8263571}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/cs-survival.tex", "start": 8263571, "end": 8276774}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/de-refcard.tex", "start": 8276774, "end": 8299257}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/dired-ref.tex", "start": 8299257, "end": 8313288}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/emacsver.tex", "start": 8313288, "end": 8313553}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/emacsver.tex.in", "start": 8313553, "end": 8313830}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/fr-dired-ref.tex", "start": 8313830, "end": 8329476}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/fr-refcard.tex", "start": 8329476, "end": 8352321}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/fr-survival.tex", "start": 8352321, "end": 8366383}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/gnus-logo.eps", "start": 8366383, "end": 8431407}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/gnus-logo.pdf", "start": 8431407, "end": 8435065}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/gnus-refcard.tex", "start": 8435065, "end": 8496423}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/orgcard.tex", "start": 8496423, "end": 8520781}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/pdflayout.sty", "start": 8520781, "end": 8522085}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/pl-refcard.tex", "start": 8522085, "end": 8557543}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/pt-br-refcard.tex", "start": 8557543, "end": 8579600}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/refcard.tex", "start": 8579600, "end": 8601274}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/ru-refcard.tex", "start": 8601274, "end": 8627176}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/sk-dired-ref.tex", "start": 8627176, "end": 8641507}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/sk-refcard.tex", "start": 8641507, "end": 8663396}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/sk-survival.tex", "start": 8663396, "end": 8676841}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/survival.tex", "start": 8676841, "end": 8688994}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/vipcard.tex", "start": 8688994, "end": 8710751}, {"filename": "/usr/local/share/emacs/30.2/etc/refcards/viperCard.tex", "start": 8710751, "end": 8734715}, {"filename": "/usr/local/share/emacs/30.2/etc/rgb.txt", "start": 8734715, "end": 8753759}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/OpenDocument-schema-v1.3+libreoffice.rnc", "start": 8753759, "end": 8787128}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/OpenDocument-schema-v1.3.rnc", "start": 8787128, "end": 9005139}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/README", "start": 9005139, "end": 9011292}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/calstbl.rnc", "start": 9011292, "end": 9018695}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dbcalstbl.rnc", "start": 9018695, "end": 9019457}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dbhier.rnc", "start": 9019457, "end": 9058838}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dbnotn.rnc", "start": 9058838, "end": 9061449}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dbpool.rnc", "start": 9061449, "end": 9203789}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dbstart.rnc", "start": 9203789, "end": 9204142}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/docbook.rnc", "start": 9204142, "end": 9205940}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dotnet-appconfig.rnc", "start": 9205940, "end": 9220053}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dotnet-packages-config.rnc", "start": 9220053, "end": 9220312}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dotnet-packages-props.rnc", "start": 9220312, "end": 9220977}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/dotnet-resx.rnc", "start": 9220977, "end": 9222529}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/locate.rnc", "start": 9222529, "end": 9229317}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/msbuild.rnc", "start": 9229317, "end": 9268838}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/nuget.rnc", "start": 9268838, "end": 9269415}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/nuspec.rnc", "start": 9269415, "end": 9272905}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/od-manifest-schema-v1.2-os.rnc", "start": 9272905, "end": 9276720}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/rdfxml.rnc", "start": 9276720, "end": 9282994}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/relaxng.rnc", "start": 9282994, "end": 9285839}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/schemas.xml", "start": 9285839, "end": 9290248}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-applet.rnc", "start": 9290248, "end": 9290689}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-attribs.rnc", "start": 9290689, "end": 9291146}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-base.rnc", "start": 9291146, "end": 9291267}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-bdo.rnc", "start": 9291267, "end": 9291483}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-bform.rnc", "start": 9291483, "end": 9293138}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-btable.rnc", "start": 9293138, "end": 9294113}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-csismap.rnc", "start": 9294113, "end": 9294930}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-datatypes.rnc", "start": 9294930, "end": 9296404}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-edit.rnc", "start": 9296404, "end": 9296737}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-events.rnc", "start": 9296737, "end": 9298393}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-form.rnc", "start": 9298393, "end": 9300047}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-frames.rnc", "start": 9300047, "end": 9300821}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-hypertext.rnc", "start": 9300821, "end": 9301300}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-iframe.rnc", "start": 9301300, "end": 9301765}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-image.rnc", "start": 9301765, "end": 9302055}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-inlstyle.rnc", "start": 9302055, "end": 9302119}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-legacy.rnc", "start": 9302119, "end": 9305661}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-link.rnc", "start": 9305661, "end": 9306063}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-lst.rnc", "start": 9306063, "end": 9306538}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-meta.rnc", "start": 9306538, "end": 9306788}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-nameident.rnc", "start": 9306788, "end": 9307060}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-object.rnc", "start": 9307060, "end": 9307735}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-param.rnc", "start": 9307735, "end": 9307973}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-pres.rnc", "start": 9307973, "end": 9308622}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-ruby.rnc", "start": 9308622, "end": 9309161}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-script.rnc", "start": 9309161, "end": 9309644}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-ssismap.rnc", "start": 9309644, "end": 9309748}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-struct.rnc", "start": 9309748, "end": 9310261}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-table.rnc", "start": 9310261, "end": 9312191}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-text.rnc", "start": 9312191, "end": 9314557}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-tgt.rnc", "start": 9314557, "end": 9314763}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml-xstyle.rnc", "start": 9314763, "end": 9315019}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xhtml.rnc", "start": 9315019, "end": 9315973}, {"filename": "/usr/local/share/emacs/30.2/etc/schema/xslt.rnc", "start": 9315973, "end": 9326602}, {"filename": "/usr/local/share/emacs/30.2/etc/ses-example.ses", "start": 9326602, "end": 9335231}, {"filename": "/usr/local/share/emacs/30.2/etc/spook.lines", "start": 9335231, "end": 9348020}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/c.srt", "start": 9348020, "end": 9351161}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/cpp.srt", "start": 9351161, "end": 9354327}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/default.srt", "start": 9354327, "end": 9356290}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/doc-cpp.srt", "start": 9356290, "end": 9358907}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/doc-default.srt", "start": 9358907, "end": 9361089}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/doc-java.srt", "start": 9361089, "end": 9363713}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/ede-autoconf.srt", "start": 9363713, "end": 9365506}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/ede-make.srt", "start": 9365506, "end": 9367597}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/el.srt", "start": 9367597, "end": 9374433}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/getset-cpp.srt", "start": 9374433, "end": 9375785}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/java.srt", "start": 9375785, "end": 9379577}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/make.srt", "start": 9379577, "end": 9381160}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/proj-test.srt", "start": 9381160, "end": 9382250}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/template.srt", "start": 9382250, "end": 9386529}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/test.srt", "start": 9386529, "end": 9390750}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/texi.srt", "start": 9390750, "end": 9393443}, {"filename": "/usr/local/share/emacs/30.2/etc/srecode/wisent.srt", "start": 9393443, "end": 9395482}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/adwaita-theme.el", "start": 9395482, "end": 9400748}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/deeper-blue-theme.el", "start": 9400748, "end": 9407332}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/dichromacy-theme.el", "start": 9407332, "end": 9414857}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/leuven-dark-theme.el", "start": 9414857, "end": 9482919}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/leuven-theme.el", "start": 9482919, "end": 9553943}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/light-blue-theme.el", "start": 9553943, "end": 9557074}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/manoj-dark-theme.el", "start": 9557074, "end": 9598608}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/misterioso-theme.el", "start": 9598608, "end": 9605691}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-operandi-deuteranopia-theme.el", "start": 9605691, "end": 9620924}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-operandi-theme.el", "start": 9620924, "end": 9635895}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-operandi-tinted-theme.el", "start": 9635895, "end": 9650954}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-operandi-tritanopia-theme.el", "start": 9650954, "end": 9666040}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-themes.el", "start": 9666040, "end": 9877182}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-vivendi-deuteranopia-theme.el", "start": 9877182, "end": 9892438}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-vivendi-theme.el", "start": 9892438, "end": 9907424}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-vivendi-tinted-theme.el", "start": 9907424, "end": 9922509}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/modus-vivendi-tritanopia-theme.el", "start": 9922509, "end": 9937603}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/tango-dark-theme.el", "start": 9937603, "end": 9947408}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/tango-theme.el", "start": 9947408, "end": 9956536}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/tsdh-dark-theme.el", "start": 9956536, "end": 9965142}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/tsdh-light-theme.el", "start": 9965142, "end": 9971326}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/wheatgrass-theme.el", "start": 9971326, "end": 9975867}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/whiteboard-theme.el", "start": 9975867, "end": 9981801}, {"filename": "/usr/local/share/emacs/30.2/etc/themes/wombat-theme.el", "start": 9981801, "end": 9988446}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL", "start": 9988446, "end": 10036349}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.bg", "start": 10036349, "end": 10122029}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.cn", "start": 10122029, "end": 10178107}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.cs", "start": 10178107, "end": 10232513}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.de", "start": 10232513, "end": 10299578}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.el_GR", "start": 10299578, "end": 10395219}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.eo", "start": 10395219, "end": 10442045}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.es", "start": 10442045, "end": 10494905}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.fa", "start": 10494905, "end": 10574469}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.fr", "start": 10574469, "end": 10629078}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.he", "start": 10629078, "end": 10696016}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.it", "start": 10696016, "end": 10750631}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.ja", "start": 10750631, "end": 10803433}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.ko", "start": 10803433, "end": 10857333}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.nl", "start": 10857333, "end": 10911451}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.pl", "start": 10911451, "end": 10967083}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.pt_BR", "start": 10967083, "end": 11014276}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.ro", "start": 11014276, "end": 11063778}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.ru", "start": 11063778, "end": 11151205}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.sk", "start": 11151205, "end": 11201464}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.sl", "start": 11201464, "end": 11250745}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.sv", "start": 11250745, "end": 11302093}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.th", "start": 11302093, "end": 11424136}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.translators", "start": 11424136, "end": 11427194}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.uk", "start": 11427194, "end": 11510729}, {"filename": "/usr/local/share/emacs/30.2/etc/tutorials/TUTORIAL.zh", "start": 11510729, "end": 11569136}, {"filename": "/usr/local/share/emacs/30.2/etc/w32-feature.el", "start": 11569136, "end": 11572502}, {"filename": "/usr/local/share/emacs/30.2/etc/yow.lines", "start": 11572502, "end": 11572902}, {"filename": "/usr/local/share/emacs/30.2/lisp/COPYING", "start": 11572902, "end": 11608051}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.1", "start": 11608051, "end": 11706452}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.10", "start": 11706452, "end": 12585480}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.11", "start": 12585480, "end": 13122670}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.12", "start": 13122670, "end": 14373341}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.13", "start": 14373341, "end": 14998698}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.14", "start": 14998698, "end": 15771928}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.15", "start": 15771928, "end": 16641486}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.16", "start": 16641486, "end": 17580756}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.17", "start": 17580756, "end": 18576461}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.2", "start": 18576461, "end": 18701206}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.3", "start": 18701206, "end": 19145296}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.4", "start": 19145296, "end": 19464395}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.5", "start": 19464395, "end": 19805023}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.6", "start": 19805023, "end": 20097318}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.7", "start": 20097318, "end": 20943503}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.8", "start": 20943503, "end": 21292285}, {"filename": "/usr/local/share/emacs/30.2/lisp/ChangeLog.9", "start": 21292285, "end": 22043188}, {"filename": "/usr/local/share/emacs/30.2/lisp/Makefile.in", "start": 22043188, "end": 22066020}, {"filename": "/usr/local/share/emacs/30.2/lisp/README", "start": 22066020, "end": 22066557}, {"filename": "/usr/local/share/emacs/30.2/lisp/abbrev.el", "start": 22066557, "end": 22119164}, {"filename": "/usr/local/share/emacs/30.2/lisp/abbrev.elc", "start": 22119164, "end": 22164265}, {"filename": "/usr/local/share/emacs/30.2/lisp/align.el", "start": 22164265, "end": 22224786}, {"filename": "/usr/local/share/emacs/30.2/lisp/align.elc", "start": 22224786, "end": 22266408}, {"filename": "/usr/local/share/emacs/30.2/lisp/allout-widgets.el", "start": 22266408, "end": 22367076}, {"filename": "/usr/local/share/emacs/30.2/lisp/allout-widgets.elc", "start": 22367076, "end": 22427013}, {"filename": "/usr/local/share/emacs/30.2/lisp/allout.el", "start": 22427013, "end": 22692706}, {"filename": "/usr/local/share/emacs/30.2/lisp/allout.elc", "start": 22692706, "end": 22884545}, {"filename": "/usr/local/share/emacs/30.2/lisp/ansi-color.el", "start": 22884545, "end": 22924439}, {"filename": "/usr/local/share/emacs/30.2/lisp/ansi-color.elc", "start": 22924439, "end": 22954270}, {"filename": "/usr/local/share/emacs/30.2/lisp/ansi-osc.el", "start": 22954270, "end": 22962375}, {"filename": "/usr/local/share/emacs/30.2/lisp/ansi-osc.elc", "start": 22962375, "end": 22968190}, {"filename": "/usr/local/share/emacs/30.2/lisp/apropos.el", "start": 22968190, "end": 23021223}, {"filename": "/usr/local/share/emacs/30.2/lisp/apropos.elc", "start": 23021223, "end": 23063038}, {"filename": "/usr/local/share/emacs/30.2/lisp/arc-mode.el", "start": 23063038, "end": 23162991}, {"filename": "/usr/local/share/emacs/30.2/lisp/arc-mode.elc", "start": 23162991, "end": 23246204}, {"filename": "/usr/local/share/emacs/30.2/lisp/array.el", "start": 23246204, "end": 23280822}, {"filename": "/usr/local/share/emacs/30.2/lisp/array.elc", "start": 23280822, "end": 23307738}, {"filename": "/usr/local/share/emacs/30.2/lisp/auth-source-pass.el", "start": 23307738, "end": 23326892}, {"filename": "/usr/local/share/emacs/30.2/lisp/auth-source-pass.elc", "start": 23326892, "end": 23342812}, {"filename": "/usr/local/share/emacs/30.2/lisp/auth-source.el", "start": 23342812, "end": 23455981}, {"filename": "/usr/local/share/emacs/30.2/lisp/auth-source.elc", "start": 23455981, "end": 23526482}, {"filename": "/usr/local/share/emacs/30.2/lisp/autoinsert.el", "start": 23526482, "end": 23541786}, {"filename": "/usr/local/share/emacs/30.2/lisp/autoinsert.elc", "start": 23541786, "end": 23555857}, {"filename": "/usr/local/share/emacs/30.2/lisp/autorevert.el", "start": 23555857, "end": 23595709}, {"filename": "/usr/local/share/emacs/30.2/lisp/autorevert.elc", "start": 23595709, "end": 23629148}, {"filename": "/usr/local/share/emacs/30.2/lisp/avoid.el", "start": 23629148, "end": 23647384}, {"filename": "/usr/local/share/emacs/30.2/lisp/avoid.elc", "start": 23647384, "end": 23659241}, {"filename": "/usr/local/share/emacs/30.2/lisp/battery.el", "start": 23659241, "end": 23710356}, {"filename": "/usr/local/share/emacs/30.2/lisp/battery.elc", "start": 23710356, "end": 23750192}, {"filename": "/usr/local/share/emacs/30.2/lisp/bind-key.el", "start": 23750192, "end": 23773647}, {"filename": "/usr/local/share/emacs/30.2/lisp/bind-key.elc", "start": 23773647, "end": 23789384}, {"filename": "/usr/local/share/emacs/30.2/lisp/bindings.el", "start": 23789384, "end": 23856163}, {"filename": "/usr/local/share/emacs/30.2/lisp/bindings.elc", "start": 23856163, "end": 23908761}, {"filename": "/usr/local/share/emacs/30.2/lisp/bookmark.el", "start": 23908761, "end": 24018256}, {"filename": "/usr/local/share/emacs/30.2/lisp/bookmark.elc", "start": 24018256, "end": 24106649}, {"filename": "/usr/local/share/emacs/30.2/lisp/bs.el", "start": 24106649, "end": 24163352}, {"filename": "/usr/local/share/emacs/30.2/lisp/bs.elc", "start": 24163352, "end": 24212853}, {"filename": "/usr/local/share/emacs/30.2/lisp/buff-menu.el", "start": 24212853, "end": 24249119}, {"filename": "/usr/local/share/emacs/30.2/lisp/buff-menu.elc", "start": 24249119, "end": 24283645}, {"filename": "/usr/local/share/emacs/30.2/lisp/button.el", "start": 24283645, "end": 24309883}, {"filename": "/usr/local/share/emacs/30.2/lisp/button.elc", "start": 24309883, "end": 24330790}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-aent.el", "start": 24330790, "end": 24374584}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-aent.elc", "start": 24374584, "end": 24401352}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-alg.el", "start": 24401352, "end": 24468726}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-alg.elc", "start": 24468726, "end": 24518824}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-arith.el", "start": 24518824, "end": 24615611}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-arith.elc", "start": 24615611, "end": 24699282}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-bin.el", "start": 24699282, "end": 24720975}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-bin.elc", "start": 24720975, "end": 24739049}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-comb.el", "start": 24739049, "end": 24774384}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-comb.elc", "start": 24774384, "end": 24803896}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-cplx.el", "start": 24803896, "end": 24813960}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-cplx.elc", "start": 24813960, "end": 24822187}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-embed.el", "start": 24822187, "end": 24873224}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-embed.elc", "start": 24873224, "end": 24902851}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-ext.el", "start": 24902851, "end": 25032617}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-ext.elc", "start": 25032617, "end": 25141713}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-fin.el", "start": 25141713, "end": 25155084}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-fin.elc", "start": 25155084, "end": 25166958}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-forms.el", "start": 25166958, "end": 25252017}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-forms.elc", "start": 25252017, "end": 25309680}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-frac.el", "start": 25309680, "end": 25316488}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-frac.elc", "start": 25316488, "end": 25322687}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-funcs.el", "start": 25322687, "end": 25355792}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-funcs.elc", "start": 25355792, "end": 25382371}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-graph.el", "start": 25382371, "end": 25438798}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-graph.elc", "start": 25438798, "end": 25475066}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-help.el", "start": 25475066, "end": 25501826}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-help.elc", "start": 25501826, "end": 25523804}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-incom.el", "start": 25523804, "end": 25531077}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-incom.elc", "start": 25531077, "end": 25536064}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-keypd.el", "start": 25536064, "end": 25557225}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-keypd.elc", "start": 25557225, "end": 25572456}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-lang.el", "start": 25572456, "end": 25660629}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-lang.elc", "start": 25660629, "end": 25721195}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-loaddefs.el", "start": 25721195, "end": 25730276}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-loaddefs.elc", "start": 25730276, "end": 25739401}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-macs.el", "start": 25739401, "end": 25744078}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-macs.elc", "start": 25744078, "end": 25750973}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-map.el", "start": 25750973, "end": 25791985}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-map.elc", "start": 25791985, "end": 25821236}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-math.el", "start": 25821236, "end": 25890324}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-math.elc", "start": 25890324, "end": 25950734}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-menu.el", "start": 25950734, "end": 26013242}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-menu.elc", "start": 26013242, "end": 26052552}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-misc.el", "start": 26052552, "end": 26082553}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-misc.elc", "start": 26082553, "end": 26105041}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-mode.el", "start": 26105041, "end": 26127153}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-mode.elc", "start": 26127153, "end": 26149060}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-mtx.el", "start": 26149060, "end": 26159872}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-mtx.elc", "start": 26159872, "end": 26166810}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-nlfit.el", "start": 26166810, "end": 26197008}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-nlfit.elc", "start": 26197008, "end": 26210369}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-poly.el", "start": 26210369, "end": 26250254}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-poly.elc", "start": 26250254, "end": 26275632}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-prog.el", "start": 26275632, "end": 26349965}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-prog.elc", "start": 26349965, "end": 26403019}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-rewr.el", "start": 26403019, "end": 26477612}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-rewr.elc", "start": 26477612, "end": 26518181}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-rules.el", "start": 26518181, "end": 26535926}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-rules.elc", "start": 26535926, "end": 26553402}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-sel.el", "start": 26553402, "end": 26581328}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-sel.elc", "start": 26581328, "end": 26601636}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-stat.el", "start": 26601636, "end": 26619843}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-stat.elc", "start": 26619843, "end": 26634054}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-store.el", "start": 26634054, "end": 26657322}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-store.elc", "start": 26657322, "end": 26676048}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-stuff.el", "start": 26676048, "end": 26685671}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-stuff.elc", "start": 26685671, "end": 26693288}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-trail.el", "start": 26693288, "end": 26698006}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-trail.elc", "start": 26698006, "end": 26702429}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-undo.el", "start": 26702429, "end": 26707058}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-undo.elc", "start": 26707058, "end": 26710107}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-units.el", "start": 26710107, "end": 26789009}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-units.elc", "start": 26789009, "end": 26845189}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-vec.el", "start": 26845189, "end": 26896060}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-vec.elc", "start": 26896060, "end": 26936907}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-yank.el", "start": 26936907, "end": 26965522}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc-yank.elc", "start": 26965522, "end": 26987168}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc.el", "start": 26987168, "end": 27115534}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calc.elc", "start": 27115534, "end": 27220949}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calcalg2.el", "start": 27220949, "end": 27349963}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calcalg2.elc", "start": 27349963, "end": 27432742}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calcalg3.el", "start": 27432742, "end": 27498780}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calcalg3.elc", "start": 27498780, "end": 27541087}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calccomp.el", "start": 27541087, "end": 27604814}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calccomp.elc", "start": 27604814, "end": 27640651}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calcsel2.el", "start": 27640651, "end": 27650056}, {"filename": "/usr/local/share/emacs/30.2/lisp/calc/calcsel2.elc", "start": 27650056, "end": 27655749}, {"filename": "/usr/local/share/emacs/30.2/lisp/calculator.el", "start": 27655749, "end": 27723355}, {"filename": "/usr/local/share/emacs/30.2/lisp/calculator.elc", "start": 27723355, "end": 27777546}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/appt.el", "start": 27777546, "end": 27810246}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/appt.elc", "start": 27810246, "end": 27828866}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-bahai.el", "start": 27828866, "end": 27843474}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-bahai.elc", "start": 27843474, "end": 27855669}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-china.el", "start": 27855669, "end": 27891670}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-china.elc", "start": 27891670, "end": 27923264}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-coptic.el", "start": 27923264, "end": 27933907}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-coptic.elc", "start": 27933907, "end": 27942670}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-dst.el", "start": 27942670, "end": 27963309}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-dst.elc", "start": 27963309, "end": 27981217}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-french.el", "start": 27981217, "end": 28000828}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-french.elc", "start": 28000828, "end": 28016164}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-hebrew.el", "start": 28016164, "end": 28069806}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-hebrew.elc", "start": 28069806, "end": 28117458}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-html.el", "start": 28117458, "end": 28134932}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-html.elc", "start": 28134932, "end": 28151473}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-islam.el", "start": 28151473, "end": 28165879}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-islam.elc", "start": 28165879, "end": 28178454}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-iso.el", "start": 28178454, "end": 28184403}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-iso.elc", "start": 28184403, "end": 28190717}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-julian.el", "start": 28190717, "end": 28199309}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-julian.elc", "start": 28199309, "end": 28207119}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-loaddefs.el", "start": 28207119, "end": 28236493}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-loaddefs.elc", "start": 28236493, "end": 28266809}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-mayan.el", "start": 28266809, "end": 28282028}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-mayan.elc", "start": 28282028, "end": 28299757}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-menu.el", "start": 28299757, "end": 28312036}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-menu.elc", "start": 28312036, "end": 28321682}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-move.el", "start": 28321682, "end": 28337795}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-move.elc", "start": 28337795, "end": 28351888}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-persia.el", "start": 28351888, "end": 28360390}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-persia.elc", "start": 28360390, "end": 28366567}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-tex.el", "start": 28366567, "end": 28438279}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-tex.elc", "start": 28438279, "end": 28512409}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-x.el", "start": 28512409, "end": 28518217}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/cal-x.elc", "start": 28518217, "end": 28522669}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/calendar.el", "start": 28522669, "end": 28643418}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/calendar.elc", "start": 28643418, "end": 28745974}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/diary-lib.el", "start": 28745974, "end": 28865200}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/diary-lib.elc", "start": 28865200, "end": 28969979}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/diary-loaddefs.el", "start": 28969979, "end": 28979569}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/diary-loaddefs.elc", "start": 28979569, "end": 28988885}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/holiday-loaddefs.el", "start": 28988885, "end": 28993304}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/holiday-loaddefs.elc", "start": 28993304, "end": 28997508}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/holidays.el", "start": 28997508, "end": 29032118}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/holidays.elc", "start": 29032118, "end": 29065027}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/icalendar.el", "start": 29065027, "end": 29177695}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/icalendar.elc", "start": 29177695, "end": 29236611}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/iso8601.el", "start": 29236611, "end": 29253088}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/iso8601.elc", "start": 29253088, "end": 29262694}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/lunar.el", "start": 29262694, "end": 29282546}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/lunar.elc", "start": 29282546, "end": 29294906}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/parse-time.el", "start": 29294906, "end": 29303348}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/parse-time.elc", "start": 29303348, "end": 29309206}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/solar.el", "start": 29309206, "end": 29353619}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/solar.elc", "start": 29353619, "end": 29391870}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/time-date.el", "start": 29391870, "end": 29415518}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/time-date.elc", "start": 29415518, "end": 29431286}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/timeclock.el", "start": 29431286, "end": 29481478}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/timeclock.elc", "start": 29481478, "end": 29530402}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/todo-mode.el", "start": 29530402, "end": 29804794}, {"filename": "/usr/local/share/emacs/30.2/lisp/calendar/todo-mode.elc", "start": 29804794, "end": 30005957}, {"filename": "/usr/local/share/emacs/30.2/lisp/case-table.el", "start": 30005957, "end": 30013219}, {"filename": "/usr/local/share/emacs/30.2/lisp/case-table.elc", "start": 30013219, "end": 30017917}, {"filename": "/usr/local/share/emacs/30.2/lisp/cdl.el", "start": 30017917, "end": 30019569}, {"filename": "/usr/local/share/emacs/30.2/lisp/cdl.elc", "start": 30019569, "end": 30020324}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ChangeLog.1", "start": 30020324, "end": 30155486}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet-cscope.el", "start": 30155486, "end": 30161086}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet-cscope.elc", "start": 30161086, "end": 30165236}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet-files.el", "start": 30165236, "end": 30169413}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet-files.elc", "start": 30169413, "end": 30171450}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet-global.el", "start": 30171450, "end": 30178177}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet-global.elc", "start": 30178177, "end": 30183256}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet-idutils.el", "start": 30183256, "end": 30189824}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet-idutils.elc", "start": 30189824, "end": 30194833}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet.el", "start": 30194833, "end": 30199760}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/cedet.elc", "start": 30199760, "end": 30203246}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/data-debug.el", "start": 30203246, "end": 30238646}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/data-debug.elc", "start": 30238646, "end": 30265994}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede.el", "start": 30265994, "end": 30321543}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede.elc", "start": 30321543, "end": 30368777}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/auto.el", "start": 30368777, "end": 30381327}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/auto.elc", "start": 30381327, "end": 30392160}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/autoconf-edit.el", "start": 30392160, "end": 30407027}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/autoconf-edit.elc", "start": 30407027, "end": 30418448}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/base.el", "start": 30418448, "end": 30441047}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/base.elc", "start": 30441047, "end": 30464212}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/config.el", "start": 30464212, "end": 30479191}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/config.elc", "start": 30479191, "end": 30505160}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/cpp-root.el", "start": 30505160, "end": 30523580}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/cpp-root.elc", "start": 30523580, "end": 30535208}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/custom.el", "start": 30535208, "end": 30543210}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/custom.elc", "start": 30543210, "end": 30548314}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/detect.el", "start": 30548314, "end": 30555103}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/detect.elc", "start": 30555103, "end": 30558632}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/dired.el", "start": 30558632, "end": 30561757}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/dired.elc", "start": 30561757, "end": 30565443}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/emacs.el", "start": 30565443, "end": 30573431}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/emacs.elc", "start": 30573431, "end": 30583981}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/files.el", "start": 30583981, "end": 30604385}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/files.elc", "start": 30604385, "end": 30617455}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/generic.el", "start": 30617455, "end": 30630897}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/generic.elc", "start": 30630897, "end": 30652349}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/linux.el", "start": 30652349, "end": 30665653}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/linux.elc", "start": 30665653, "end": 30680091}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/loaddefs.el", "start": 30680091, "end": 30684939}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/loaddefs.elc", "start": 30684939, "end": 30689412}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/locate.el", "start": 30689412, "end": 30701792}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/locate.elc", "start": 30701792, "end": 30716841}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/make.el", "start": 30716841, "end": 30720052}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/make.elc", "start": 30720052, "end": 30722023}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/makefile-edit.el", "start": 30722023, "end": 30726102}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/makefile-edit.elc", "start": 30726102, "end": 30728477}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/pconf.el", "start": 30728477, "end": 30735755}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/pconf.elc", "start": 30735755, "end": 30740512}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/pmake.el", "start": 30740512, "end": 30764637}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/pmake.elc", "start": 30764637, "end": 30783029}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-archive.el", "start": 30783029, "end": 30785364}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-archive.elc", "start": 30785364, "end": 30788536}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-aux.el", "start": 30788536, "end": 30790120}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-aux.elc", "start": 30790120, "end": 30791956}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-comp.el", "start": 30791956, "end": 30804662}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-comp.elc", "start": 30804662, "end": 30820394}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-elisp.el", "start": 30820394, "end": 30835657}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-elisp.elc", "start": 30835657, "end": 30852595}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-info.el", "start": 30852595, "end": 30859103}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-info.elc", "start": 30859103, "end": 30866191}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-misc.el", "start": 30866191, "end": 30869264}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-misc.elc", "start": 30869264, "end": 30872507}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-obj.el", "start": 30872507, "end": 30881824}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-obj.elc", "start": 30881824, "end": 30892442}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-prog.el", "start": 30892442, "end": 30897273}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-prog.elc", "start": 30897273, "end": 30903540}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-scheme.el", "start": 30903540, "end": 30905191}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-scheme.elc", "start": 30905191, "end": 30906984}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-shared.el", "start": 30906984, "end": 30914038}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj-shared.elc", "start": 30914038, "end": 30920621}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj.el", "start": 30920621, "end": 30948223}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/proj.elc", "start": 30948223, "end": 30974683}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/project-am.el", "start": 30974683, "end": 31010099}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/project-am.elc", "start": 31010099, "end": 31054018}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/shell.el", "start": 31054018, "end": 31056922}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/shell.elc", "start": 31056922, "end": 31058235}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/simple.el", "start": 31058235, "end": 31062366}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/simple.elc", "start": 31062366, "end": 31066984}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/source.el", "start": 31066984, "end": 31073033}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/source.elc", "start": 31073033, "end": 31078139}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/speedbar.el", "start": 31078139, "end": 31090770}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/speedbar.elc", "start": 31090770, "end": 31100695}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/srecode.el", "start": 31100695, "end": 31103994}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/srecode.elc", "start": 31103994, "end": 31105789}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/system.el", "start": 31105789, "end": 31110566}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/system.elc", "start": 31110566, "end": 31113163}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/util.el", "start": 31113163, "end": 31116756}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/ede/util.elc", "start": 31116756, "end": 31118981}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/mode-local.el", "start": 31118981, "end": 31154234}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/mode-local.elc", "start": 31154234, "end": 31186288}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/pulse.el", "start": 31186288, "end": 31194654}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/pulse.elc", "start": 31194654, "end": 31200113}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic.el", "start": 31200113, "end": 31246895}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic.elc", "start": 31246895, "end": 31290316}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze.el", "start": 31290316, "end": 31322561}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze.elc", "start": 31322561, "end": 31352091}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze/complete.el", "start": 31352091, "end": 31361904}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze/complete.elc", "start": 31361904, "end": 31369371}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze/debug.el", "start": 31369371, "end": 31388604}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze/debug.elc", "start": 31388604, "end": 31405648}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze/fcn.el", "start": 31405648, "end": 31417440}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze/fcn.elc", "start": 31417440, "end": 31427295}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze/refs.el", "start": 31427295, "end": 31439978}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/analyze/refs.elc", "start": 31439978, "end": 31450095}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine.el", "start": 31450095, "end": 31462922}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine.elc", "start": 31462922, "end": 31467453}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/c.el", "start": 31467453, "end": 31550683}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/c.elc", "start": 31550683, "end": 31646942}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/debug.el", "start": 31646942, "end": 31651715}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/debug.elc", "start": 31651715, "end": 31658579}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/el.el", "start": 31658579, "end": 31688654}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/el.elc", "start": 31688654, "end": 31724216}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/gcc.el", "start": 31724216, "end": 31734498}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/gcc.elc", "start": 31734498, "end": 31739158}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/grammar.el", "start": 31739158, "end": 31761122}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/grammar.elc", "start": 31761122, "end": 31779851}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/make.el", "start": 31779851, "end": 31788380}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/make.elc", "start": 31788380, "end": 31803032}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/scm.el", "start": 31803032, "end": 31807138}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/bovine/scm.elc", "start": 31807138, "end": 31815541}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/chart.el", "start": 31815541, "end": 31821071}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/chart.elc", "start": 31821071, "end": 31825148}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/complete.el", "start": 31825148, "end": 31911859}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/complete.elc", "start": 31911859, "end": 31989753}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/ctxt.el", "start": 31989753, "end": 32014853}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/ctxt.elc", "start": 32014853, "end": 32049685}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-debug.el", "start": 32049685, "end": 32053173}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-debug.elc", "start": 32053173, "end": 32055501}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-ebrowse.el", "start": 32055501, "end": 32079120}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-ebrowse.elc", "start": 32079120, "end": 32100608}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-el.el", "start": 32100608, "end": 32113554}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-el.elc", "start": 32113554, "end": 32128776}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-file.el", "start": 32128776, "end": 32145497}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-file.elc", "start": 32145497, "end": 32160123}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-find.el", "start": 32160123, "end": 32214675}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-find.elc", "start": 32214675, "end": 32256990}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-global.el", "start": 32256990, "end": 32265781}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-global.elc", "start": 32265781, "end": 32276240}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-javascript.el", "start": 32276240, "end": 32287497}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-javascript.elc", "start": 32287497, "end": 32300177}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-mode.el", "start": 32300177, "end": 32307675}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-mode.elc", "start": 32307675, "end": 32314571}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-ref.el", "start": 32314571, "end": 32320430}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-ref.elc", "start": 32320430, "end": 32325183}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-typecache.el", "start": 32325183, "end": 32346622}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db-typecache.elc", "start": 32346622, "end": 32364726}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db.el", "start": 32364726, "end": 32404912}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/db.elc", "start": 32404912, "end": 32445100}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/debug.el", "start": 32445100, "end": 32463919}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/debug.elc", "start": 32463919, "end": 32481697}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/decorate.el", "start": 32481697, "end": 32492686}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/decorate.elc", "start": 32492686, "end": 32500815}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/decorate/include.el", "start": 32500815, "end": 32531344}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/decorate/include.elc", "start": 32531344, "end": 32562527}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/decorate/mode.el", "start": 32562527, "end": 32583812}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/decorate/mode.elc", "start": 32583812, "end": 32616824}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/dep.el", "start": 32616824, "end": 32624845}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/dep.elc", "start": 32624845, "end": 32631803}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/doc.el", "start": 32631803, "end": 32637223}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/doc.elc", "start": 32637223, "end": 32641003}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/ede-grammar.el", "start": 32641003, "end": 32648753}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/ede-grammar.elc", "start": 32648753, "end": 32658655}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/edit.el", "start": 32658655, "end": 32697551}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/edit.elc", "start": 32697551, "end": 32717442}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/find.el", "start": 32717442, "end": 32744877}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/find.elc", "start": 32744877, "end": 32768388}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/format.el", "start": 32768388, "end": 32795597}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/format.elc", "start": 32795597, "end": 32828140}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/fw.el", "start": 32828140, "end": 32845547}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/fw.elc", "start": 32845547, "end": 32857806}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/grammar.el", "start": 32857806, "end": 32931931}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/grammar.elc", "start": 32931931, "end": 33010825}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/grm-wy-boot.el", "start": 33010825, "end": 33022850}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/grm-wy-boot.elc", "start": 33022850, "end": 33073721}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/html.el", "start": 33073721, "end": 33082474}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/html.elc", "start": 33082474, "end": 33089649}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/ia-sb.el", "start": 33089649, "end": 33101522}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/ia-sb.elc", "start": 33101522, "end": 33111073}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/ia.el", "start": 33111073, "end": 33128395}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/ia.elc", "start": 33128395, "end": 33139511}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/idle.el", "start": 33139511, "end": 33187271}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/idle.elc", "start": 33187271, "end": 33251903}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/imenu.el", "start": 33251903, "end": 33271221}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/imenu.elc", "start": 33271221, "end": 33283191}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/java.el", "start": 33283191, "end": 33299985}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/java.elc", "start": 33299985, "end": 33316837}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/lex-spp.el", "start": 33316837, "end": 33365067}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/lex-spp.elc", "start": 33365067, "end": 33397908}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/lex.el", "start": 33397908, "end": 33468503}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/lex.elc", "start": 33468503, "end": 33541272}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/loaddefs.el", "start": 33541272, "end": 33599819}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/loaddefs.elc", "start": 33599819, "end": 33657470}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/mru-bookmark.el", "start": 33657470, "end": 33671168}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/mru-bookmark.elc", "start": 33671168, "end": 33687779}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/sb.el", "start": 33687779, "end": 33702843}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/sb.elc", "start": 33702843, "end": 33714069}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/scope.el", "start": 33714069, "end": 33745521}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/scope.elc", "start": 33745521, "end": 33769469}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/senator.el", "start": 33769469, "end": 33802006}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/senator.elc", "start": 33802006, "end": 33831891}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/sort.el", "start": 33831891, "end": 33852401}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/sort.elc", "start": 33852401, "end": 33870232}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref.el", "start": 33870232, "end": 33892028}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref.elc", "start": 33892028, "end": 33908645}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/cscope.el", "start": 33908645, "end": 33912207}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/cscope.elc", "start": 33912207, "end": 33915304}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/filter.el", "start": 33915304, "end": 33921098}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/filter.elc", "start": 33921098, "end": 33925183}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/global.el", "start": 33925183, "end": 33928004}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/global.elc", "start": 33928004, "end": 33930791}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/grep.el", "start": 33930791, "end": 33939355}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/grep.elc", "start": 33939355, "end": 33945609}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/idutils.el", "start": 33945609, "end": 33948579}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/idutils.elc", "start": 33948579, "end": 33951479}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/list.el", "start": 33951479, "end": 33969313}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/symref/list.elc", "start": 33969313, "end": 33984671}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/tag-file.el", "start": 33984671, "end": 33992351}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/tag-file.elc", "start": 33992351, "end": 33997639}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/tag-ls.el", "start": 33997639, "end": 34015054}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/tag-ls.elc", "start": 34015054, "end": 34037864}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/tag-write.el", "start": 34037864, "end": 34043357}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/tag-write.elc", "start": 34043357, "end": 34046892}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/tag.el", "start": 34046892, "end": 34097458}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/tag.elc", "start": 34097458, "end": 34154860}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/texi.el", "start": 34154860, "end": 34179362}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/texi.elc", "start": 34179362, "end": 34196798}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/util-modes.el", "start": 34196798, "end": 34233553}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/util-modes.elc", "start": 34233553, "end": 34284636}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/util.el", "start": 34284636, "end": 34300725}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/util.elc", "start": 34300725, "end": 34313325}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent.el", "start": 34313325, "end": 34326500}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent.elc", "start": 34326500, "end": 34334193}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/comp.el", "start": 34334193, "end": 34461591}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/comp.elc", "start": 34461591, "end": 34564982}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/grammar.el", "start": 34564982, "end": 34588102}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/grammar.elc", "start": 34588102, "end": 34613152}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/java-tags.el", "start": 34613152, "end": 34617861}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/java-tags.elc", "start": 34617861, "end": 34621392}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/javascript.el", "start": 34621392, "end": 34627234}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/javascript.elc", "start": 34627234, "end": 34632662}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/python.el", "start": 34632662, "end": 34655634}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/python.elc", "start": 34655634, "end": 34681360}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/wisent.el", "start": 34681360, "end": 34699789}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/semantic/wisent/wisent.elc", "start": 34699789, "end": 34713912}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode.el", "start": 34713912, "end": 34715835}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode.elc", "start": 34715835, "end": 34716366}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/args.el", "start": 34716366, "end": 34724876}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/args.elc", "start": 34724876, "end": 34729258}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/compile.el", "start": 34729258, "end": 34750347}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/compile.elc", "start": 34750347, "end": 34766512}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/cpp.el", "start": 34766512, "end": 34774488}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/cpp.elc", "start": 34774488, "end": 34779380}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/ctxt.el", "start": 34779380, "end": 34787947}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/ctxt.elc", "start": 34787947, "end": 34793616}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/dictionary.el", "start": 34793616, "end": 34815962}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/dictionary.elc", "start": 34815962, "end": 34836721}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/document.el", "start": 34836721, "end": 34863593}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/document.elc", "start": 34863593, "end": 34881989}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/el.el", "start": 34881989, "end": 34885562}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/el.elc", "start": 34885562, "end": 34887831}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/expandproto.el", "start": 34887831, "end": 34891744}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/expandproto.elc", "start": 34891744, "end": 34893703}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/extract.el", "start": 34893703, "end": 34902096}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/extract.elc", "start": 34902096, "end": 34908717}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/fields.el", "start": 34908717, "end": 34923263}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/fields.elc", "start": 34923263, "end": 34939152}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/filters.el", "start": 34939152, "end": 34941062}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/filters.elc", "start": 34941062, "end": 34941645}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/find.el", "start": 34941645, "end": 34951596}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/find.elc", "start": 34951596, "end": 34958755}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/getset.el", "start": 34958755, "end": 34969972}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/getset.elc", "start": 34969972, "end": 34977341}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/insert.el", "start": 34977341, "end": 35016845}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/insert.elc", "start": 35016845, "end": 35059740}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/java.el", "start": 35059740, "end": 35062716}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/java.elc", "start": 35062716, "end": 35064048}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/loaddefs.el", "start": 35064048, "end": 35071430}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/loaddefs.elc", "start": 35071430, "end": 35078488}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/map.el", "start": 35078488, "end": 35092042}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/map.elc", "start": 35092042, "end": 35102696}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/mode.el", "start": 35102696, "end": 35114955}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/mode.elc", "start": 35114955, "end": 35127698}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/semantic.el", "start": 35127698, "end": 35142175}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/semantic.elc", "start": 35142175, "end": 35153651}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/srt-mode.el", "start": 35153651, "end": 35177740}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/srt-mode.elc", "start": 35177740, "end": 35200994}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/srt.el", "start": 35200994, "end": 35204738}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/srt.elc", "start": 35204738, "end": 35207211}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/table.el", "start": 35207211, "end": 35217127}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/table.elc", "start": 35217127, "end": 35226824}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/template.el", "start": 35226824, "end": 35229112}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/template.elc", "start": 35229112, "end": 35230536}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/texi.el", "start": 35230536, "end": 35240462}, {"filename": "/usr/local/share/emacs/30.2/lisp/cedet/srecode/texi.elc", "start": 35240462, "end": 35248933}, {"filename": "/usr/local/share/emacs/30.2/lisp/char-fold.el", "start": 35248933, "end": 35272170}, {"filename": "/usr/local/share/emacs/30.2/lisp/char-fold.elc", "start": 35272170, "end": 35597582}, {"filename": "/usr/local/share/emacs/30.2/lisp/chistory.el", "start": 35597582, "end": 35604367}, {"filename": "/usr/local/share/emacs/30.2/lisp/chistory.elc", "start": 35604367, "end": 35612333}, {"filename": "/usr/local/share/emacs/30.2/lisp/cmuscheme.el", "start": 35612333, "end": 35633692}, {"filename": "/usr/local/share/emacs/30.2/lisp/cmuscheme.elc", "start": 35633692, "end": 35652413}, {"filename": "/usr/local/share/emacs/30.2/lisp/color.el", "start": 35652413, "end": 35671090}, {"filename": "/usr/local/share/emacs/30.2/lisp/color.elc", "start": 35671090, "end": 35685134}, {"filename": "/usr/local/share/emacs/30.2/lisp/comint.el", "start": 35685134, "end": 35871952}, {"filename": "/usr/local/share/emacs/30.2/lisp/comint.elc", "start": 35871952, "end": 36007410}, {"filename": "/usr/local/share/emacs/30.2/lisp/completion-preview.el", "start": 36007410, "end": 36038084}, {"filename": "/usr/local/share/emacs/30.2/lisp/completion-preview.elc", "start": 36038084, "end": 36067438}, {"filename": "/usr/local/share/emacs/30.2/lisp/completion.el", "start": 36067438, "end": 36153073}, {"filename": "/usr/local/share/emacs/30.2/lisp/completion.elc", "start": 36153073, "end": 36195503}, {"filename": "/usr/local/share/emacs/30.2/lisp/composite.el", "start": 36195503, "end": 36231328}, {"filename": "/usr/local/share/emacs/30.2/lisp/composite.elc", "start": 36231328, "end": 36263746}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-dep.el", "start": 36263746, "end": 36274248}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-dep.elc", "start": 36274248, "end": 36280993}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-edit.el", "start": 36280993, "end": 36507276}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-edit.elc", "start": 36507276, "end": 36685779}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-face.el", "start": 36685779, "end": 36701319}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-face.elc", "start": 36701319, "end": 36712617}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-start.el", "start": 36712617, "end": 36754009}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-start.elc", "start": 36754009, "end": 36778511}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-theme.el", "start": 36778511, "end": 36805690}, {"filename": "/usr/local/share/emacs/30.2/lisp/cus-theme.elc", "start": 36805690, "end": 36831353}, {"filename": "/usr/local/share/emacs/30.2/lisp/custom.el", "start": 36831353, "end": 36904846}, {"filename": "/usr/local/share/emacs/30.2/lisp/custom.elc", "start": 36904846, "end": 36959187}, {"filename": "/usr/local/share/emacs/30.2/lisp/dabbrev.el", "start": 36959187, "end": 37002479}, {"filename": "/usr/local/share/emacs/30.2/lisp/dabbrev.elc", "start": 37002479, "end": 37026532}, {"filename": "/usr/local/share/emacs/30.2/lisp/delim-col.el", "start": 37026532, "end": 37042496}, {"filename": "/usr/local/share/emacs/30.2/lisp/delim-col.elc", "start": 37042496, "end": 37051418}, {"filename": "/usr/local/share/emacs/30.2/lisp/delsel.el", "start": 37051418, "end": 37066356}, {"filename": "/usr/local/share/emacs/30.2/lisp/delsel.elc", "start": 37066356, "end": 37077024}, {"filename": "/usr/local/share/emacs/30.2/lisp/descr-text.el", "start": 37077024, "end": 37120921}, {"filename": "/usr/local/share/emacs/30.2/lisp/descr-text.elc", "start": 37120921, "end": 37146825}, {"filename": "/usr/local/share/emacs/30.2/lisp/desktop.el", "start": 37146825, "end": 37217602}, {"filename": "/usr/local/share/emacs/30.2/lisp/desktop.elc", "start": 37217602, "end": 37269821}, {"filename": "/usr/local/share/emacs/30.2/lisp/dframe.el", "start": 37269821, "end": 37301797}, {"filename": "/usr/local/share/emacs/30.2/lisp/dframe.elc", "start": 37301797, "end": 37321716}, {"filename": "/usr/local/share/emacs/30.2/lisp/dired-aux.el", "start": 37321716, "end": 37487592}, {"filename": "/usr/local/share/emacs/30.2/lisp/dired-aux.elc", "start": 37487592, "end": 37603902}, {"filename": "/usr/local/share/emacs/30.2/lisp/dired-loaddefs.el", "start": 37603902, "end": 37632672}, {"filename": "/usr/local/share/emacs/30.2/lisp/dired-loaddefs.elc", "start": 37632672, "end": 37662270}, {"filename": "/usr/local/share/emacs/30.2/lisp/dired-x.el", "start": 37662270, "end": 37707768}, {"filename": "/usr/local/share/emacs/30.2/lisp/dired-x.elc", "start": 37707768, "end": 37741439}, {"filename": "/usr/local/share/emacs/30.2/lisp/dired.el", "start": 37741439, "end": 37961332}, {"filename": "/usr/local/share/emacs/30.2/lisp/dired.elc", "start": 37961332, "end": 38126948}, {"filename": "/usr/local/share/emacs/30.2/lisp/dirtrack.el", "start": 38126948, "end": 38137394}, {"filename": "/usr/local/share/emacs/30.2/lisp/dirtrack.elc", "start": 38137394, "end": 38145893}, {"filename": "/usr/local/share/emacs/30.2/lisp/disp-table.el", "start": 38145893, "end": 38159567}, {"filename": "/usr/local/share/emacs/30.2/lisp/disp-table.elc", "start": 38159567, "end": 38170443}, {"filename": "/usr/local/share/emacs/30.2/lisp/display-fill-column-indicator.el", "start": 38170443, "end": 38173778}, {"filename": "/usr/local/share/emacs/30.2/lisp/display-fill-column-indicator.elc", "start": 38173778, "end": 38183593}, {"filename": "/usr/local/share/emacs/30.2/lisp/display-line-numbers.el", "start": 38183593, "end": 38192042}, {"filename": "/usr/local/share/emacs/30.2/lisp/display-line-numbers.elc", "start": 38192042, "end": 38206667}, {"filename": "/usr/local/share/emacs/30.2/lisp/dnd.el", "start": 38206667, "end": 38235461}, {"filename": "/usr/local/share/emacs/30.2/lisp/dnd.elc", "start": 38235461, "end": 38256424}, {"filename": "/usr/local/share/emacs/30.2/lisp/doc-view.el", "start": 38256424, "end": 38359782}, {"filename": "/usr/local/share/emacs/30.2/lisp/doc-view.elc", "start": 38359782, "end": 38438420}, {"filename": "/usr/local/share/emacs/30.2/lisp/dom.el", "start": 38438420, "end": 38448130}, {"filename": "/usr/local/share/emacs/30.2/lisp/dom.elc", "start": 38448130, "end": 38456092}, {"filename": "/usr/local/share/emacs/30.2/lisp/dos-fns.el", "start": 38456092, "end": 38467321}, {"filename": "/usr/local/share/emacs/30.2/lisp/dos-fns.elc", "start": 38467321, "end": 38472144}, {"filename": "/usr/local/share/emacs/30.2/lisp/dos-vars.el", "start": 38472144, "end": 38473673}, {"filename": "/usr/local/share/emacs/30.2/lisp/dos-vars.elc", "start": 38473673, "end": 38474577}, {"filename": "/usr/local/share/emacs/30.2/lisp/dos-w32.el", "start": 38474577, "end": 38493788}, {"filename": "/usr/local/share/emacs/30.2/lisp/dos-w32.elc", "start": 38493788, "end": 38505150}, {"filename": "/usr/local/share/emacs/30.2/lisp/double.el", "start": 38505150, "end": 38510709}, {"filename": "/usr/local/share/emacs/30.2/lisp/double.elc", "start": 38510709, "end": 38515283}, {"filename": "/usr/local/share/emacs/30.2/lisp/dynamic-setting.el", "start": 38515283, "end": 38518655}, {"filename": "/usr/local/share/emacs/30.2/lisp/dynamic-setting.elc", "start": 38518655, "end": 38520224}, {"filename": "/usr/local/share/emacs/30.2/lisp/ebuff-menu.el", "start": 38520224, "end": 38530830}, {"filename": "/usr/local/share/emacs/30.2/lisp/ebuff-menu.elc", "start": 38530830, "end": 38541055}, {"filename": "/usr/local/share/emacs/30.2/lisp/echistory.el", "start": 38541055, "end": 38547173}, {"filename": "/usr/local/share/emacs/30.2/lisp/echistory.elc", "start": 38547173, "end": 38551731}, {"filename": "/usr/local/share/emacs/30.2/lisp/ecomplete.el", "start": 38551731, "end": 38564617}, {"filename": "/usr/local/share/emacs/30.2/lisp/ecomplete.elc", "start": 38564617, "end": 38573943}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-conf-mode.el", "start": 38573943, "end": 38577164}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-conf-mode.elc", "start": 38577164, "end": 38580971}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-core-handle.el", "start": 38580971, "end": 38589049}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-core-handle.elc", "start": 38589049, "end": 38605841}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-core.el", "start": 38605841, "end": 38612305}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-core.elc", "start": 38612305, "end": 38614983}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-fnmatch.el", "start": 38614983, "end": 38625786}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-fnmatch.elc", "start": 38625786, "end": 38630366}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-tools.el", "start": 38630366, "end": 38634969}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig-tools.elc", "start": 38634969, "end": 38637751}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig.el", "start": 38637751, "end": 38673397}, {"filename": "/usr/local/share/emacs/30.2/lisp/editorconfig.elc", "start": 38673397, "end": 38700234}, {"filename": "/usr/local/share/emacs/30.2/lisp/edmacro.el", "start": 38700234, "end": 38731440}, {"filename": "/usr/local/share/emacs/30.2/lisp/edmacro.elc", "start": 38731440, "end": 38752370}, {"filename": "/usr/local/share/emacs/30.2/lisp/ehelp.el", "start": 38752370, "end": 38769475}, {"filename": "/usr/local/share/emacs/30.2/lisp/ehelp.elc", "start": 38769475, "end": 38780653}, {"filename": "/usr/local/share/emacs/30.2/lisp/elec-pair.el", "start": 38780653, "end": 38812505}, {"filename": "/usr/local/share/emacs/30.2/lisp/elec-pair.elc", "start": 38812505, "end": 38836918}, {"filename": "/usr/local/share/emacs/30.2/lisp/electric.el", "start": 38836918, "end": 38869036}, {"filename": "/usr/local/share/emacs/30.2/lisp/electric.elc", "start": 38869036, "end": 38899843}, {"filename": "/usr/local/share/emacs/30.2/lisp/elide-head.el", "start": 38899843, "end": 38906424}, {"filename": "/usr/local/share/emacs/30.2/lisp/elide-head.elc", "start": 38906424, "end": 38912321}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/advice.el", "start": 38912321, "end": 39051317}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/advice.elc", "start": 39051317, "end": 39105798}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/avl-tree.el", "start": 39105798, "end": 39129628}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/avl-tree.elc", "start": 39129628, "end": 39157934}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/backquote.el", "start": 39157934, "end": 39167569}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/backquote.elc", "start": 39167569, "end": 39171845}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/backtrace.el", "start": 39171845, "end": 39209596}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/backtrace.elc", "start": 39209596, "end": 39251122}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/benchmark.el", "start": 39251122, "end": 39258324}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/benchmark.elc", "start": 39258324, "end": 39263222}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/bindat.el", "start": 39263222, "end": 39299190}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/bindat.elc", "start": 39299190, "end": 39330681}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/byte-opt.el", "start": 39330681, "end": 39466768}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/byte-opt.elc", "start": 39466768, "end": 39528196}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/byte-run.el", "start": 39528196, "end": 39560112}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/byte-run.elc", "start": 39560112, "end": 39582542}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/bytecomp.el", "start": 39582542, "end": 39838691}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/bytecomp.elc", "start": 39838691, "end": 40026607}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cconv.el", "start": 40026607, "end": 40070016}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cconv.elc", "start": 40070016, "end": 40094720}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/chart.el", "start": 40094720, "end": 40121733}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/chart.elc", "start": 40121733, "end": 40149732}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/check-declare.el", "start": 40149732, "end": 40165121}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/check-declare.elc", "start": 40165121, "end": 40174193}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/checkdoc.el", "start": 40174193, "end": 40290886}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/checkdoc.elc", "start": 40290886, "end": 40372915}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-extra.el", "start": 40372915, "end": 40406240}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-extra.elc", "start": 40406240, "end": 40436376}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-generic.el", "start": 40436376, "end": 40502761}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-generic.elc", "start": 40502761, "end": 40569909}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-indent.el", "start": 40569909, "end": 40604926}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-indent.elc", "start": 40604926, "end": 40622877}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-lib.el", "start": 40622877, "end": 40644866}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-lib.elc", "start": 40644866, "end": 40665915}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-loaddefs.el", "start": 40665915, "end": 40715268}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-loaddefs.elc", "start": 40715268, "end": 40765343}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-macs.el", "start": 40765343, "end": 40925523}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-macs.elc", "start": 40925523, "end": 41025820}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-preloaded.el", "start": 41025820, "end": 41048565}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-preloaded.elc", "start": 41048565, "end": 41094246}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-print.el", "start": 41094246, "end": 41121371}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-print.elc", "start": 41121371, "end": 41139664}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-seq.el", "start": 41139664, "end": 41182806}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cl-seq.elc", "start": 41182806, "end": 41221434}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/comp-common.el", "start": 41221434, "end": 41244987}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/comp-common.elc", "start": 41244987, "end": 41266328}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/comp-cstr.el", "start": 41266328, "end": 41315170}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/comp-cstr.elc", "start": 41315170, "end": 41396298}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/comp-run.el", "start": 41396298, "end": 41418283}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/comp-run.elc", "start": 41418283, "end": 41432971}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/comp.el", "start": 41432971, "end": 41587641}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/comp.elc", "start": 41587641, "end": 41970505}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/compat.el", "start": 41970505, "end": 41974486}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/compat.elc", "start": 41974486, "end": 41975226}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/copyright.el", "start": 41975226, "end": 41989880}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/copyright.elc", "start": 41989880, "end": 42000509}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/crm.el", "start": 42000509, "end": 42013501}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/crm.elc", "start": 42013501, "end": 42020960}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cursor-sensor.el", "start": 42020960, "end": 42031203}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/cursor-sensor.elc", "start": 42031203, "end": 42038741}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/debug-early.el", "start": 42038741, "end": 42043768}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/debug-early.elc", "start": 42043768, "end": 42046367}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/debug.el", "start": 42046367, "end": 42080399}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/debug.elc", "start": 42080399, "end": 42118729}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/derived.el", "start": 42118729, "end": 42133983}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/derived.elc", "start": 42133983, "end": 42142845}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/disass.el", "start": 42142845, "end": 42154714}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/disass.elc", "start": 42154714, "end": 42161943}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/easy-mmode.el", "start": 42161943, "end": 42197688}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/easy-mmode.elc", "start": 42197688, "end": 42221347}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/easymenu.el", "start": 42221347, "end": 42249510}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/easymenu.elc", "start": 42249510, "end": 42268667}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/edebug.el", "start": 42268667, "end": 42443163}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/edebug.elc", "start": 42443163, "end": 42573133}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-base.el", "start": 42573133, "end": 42592063}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-base.elc", "start": 42592063, "end": 42609834}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-core.el", "start": 42609834, "end": 42654891}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-core.elc", "start": 42654891, "end": 42695615}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-custom.el", "start": 42695615, "end": 42712869}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-custom.elc", "start": 42712869, "end": 42728338}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-datadebug.el", "start": 42728338, "end": 42733044}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-datadebug.elc", "start": 42733044, "end": 42735904}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-opt.el", "start": 42735904, "end": 42747493}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-opt.elc", "start": 42747493, "end": 42756202}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-speedbar.el", "start": 42756202, "end": 42771943}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio-speedbar.elc", "start": 42771943, "end": 42785021}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio.el", "start": 42785021, "end": 42825330}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eieio.elc", "start": 42825330, "end": 42859787}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eldoc.el", "start": 42859787, "end": 42904101}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/eldoc.elc", "start": 42904101, "end": 42942277}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/elint.el", "start": 42942277, "end": 42982232}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/elint.elc", "start": 42982232, "end": 43014118}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/elp.el", "start": 43014118, "end": 43036599}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/elp.elc", "start": 43036599, "end": 43052251}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ert-font-lock.el", "start": 43052251, "end": 43067175}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ert-font-lock.elc", "start": 43067175, "end": 43077164}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ert-x.el", "start": 43077164, "end": 43100120}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ert-x.elc", "start": 43100120, "end": 43120809}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ert.el", "start": 43120809, "end": 43251555}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ert.elc", "start": 43251555, "end": 43450242}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ewoc.el", "start": 43450242, "end": 43472790}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ewoc.elc", "start": 43472790, "end": 43499001}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/faceup.el", "start": 43499001, "end": 43543364}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/faceup.elc", "start": 43543364, "end": 43559969}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/find-func.el", "start": 43559969, "end": 43592943}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/find-func.elc", "start": 43592943, "end": 43617110}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/float-sup.el", "start": 43617110, "end": 43619063}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/float-sup.elc", "start": 43619063, "end": 43620073}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/generate-lisp-file.el", "start": 43620073, "end": 43624491}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/generate-lisp-file.elc", "start": 43624491, "end": 43628227}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/generator.el", "start": 43628227, "end": 43660073}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/generator.elc", "start": 43660073, "end": 43682764}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/generic.el", "start": 43682764, "end": 43695101}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/generic.elc", "start": 43695101, "end": 43701976}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/gv.el", "start": 43701976, "end": 43737845}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/gv.elc", "start": 43737845, "end": 43774606}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/helper.el", "start": 43774606, "end": 43779607}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/helper.elc", "start": 43779607, "end": 43783375}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/hierarchy.el", "start": 43783375, "end": 43808687}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/hierarchy.elc", "start": 43808687, "end": 43839757}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/icons.el", "start": 43839757, "end": 43850631}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/icons.elc", "start": 43850631, "end": 43858538}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/inline.el", "start": 43858538, "end": 43869488}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/inline.elc", "start": 43869488, "end": 43876910}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/let-alist.el", "start": 43876910, "end": 43882810}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/let-alist.elc", "start": 43882810, "end": 43886054}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/lisp-mnt.el", "start": 43886054, "end": 43910707}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/lisp-mnt.elc", "start": 43910707, "end": 43935220}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/lisp-mode.el", "start": 43935220, "end": 44005073}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/lisp-mode.elc", "start": 44005073, "end": 44049580}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/lisp.el", "start": 44049580, "end": 44089731}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/lisp.elc", "start": 44089731, "end": 44116288}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/loaddefs-gen.el", "start": 44116288, "end": 44153022}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/loaddefs-gen.elc", "start": 44153022, "end": 44173388}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/macroexp.el", "start": 44173388, "end": 44211022}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/macroexp.elc", "start": 44211022, "end": 44234648}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/map-ynp.el", "start": 44234648, "end": 44253359}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/map-ynp.elc", "start": 44253359, "end": 44264505}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/map.el", "start": 44264505, "end": 44288320}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/map.elc", "start": 44288320, "end": 44316048}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/memory-report.el", "start": 44316048, "end": 44329250}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/memory-report.elc", "start": 44329250, "end": 44338829}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/multisession.el", "start": 44338829, "end": 44357343}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/multisession.elc", "start": 44357343, "end": 44384001}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/nadvice.el", "start": 44384001, "end": 44413772}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/nadvice.elc", "start": 44413772, "end": 44434478}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/oclosure.el", "start": 44434478, "end": 44460201}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/oclosure.elc", "start": 44460201, "end": 44482101}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/package-vc.el", "start": 44482101, "end": 44528647}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/package-vc.elc", "start": 44528647, "end": 44566406}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/package-x.el", "start": 44566406, "end": 44579191}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/package-x.elc", "start": 44579191, "end": 44587959}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/package.el", "start": 44587959, "end": 44793075}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/package.elc", "start": 44793075, "end": 44976199}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/pcase.el", "start": 44976199, "end": 45028555}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/pcase.elc", "start": 45028555, "end": 45057157}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/pp.el", "start": 45057157, "end": 45083320}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/pp.elc", "start": 45083320, "end": 45099396}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/radix-tree.el", "start": 45099396, "end": 45108872}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/radix-tree.elc", "start": 45108872, "end": 45113989}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/range.el", "start": 45113989, "end": 45129482}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/range.elc", "start": 45129482, "end": 45136826}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/re-builder.el", "start": 45136826, "end": 45167602}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/re-builder.elc", "start": 45167602, "end": 45194133}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/regexp-opt.el", "start": 45194133, "end": 45206986}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/regexp-opt.elc", "start": 45206986, "end": 45213084}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/regi.el", "start": 45213084, "end": 45221976}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/regi.elc", "start": 45221976, "end": 45227593}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ring.el", "start": 45227593, "end": 45236436}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/ring.elc", "start": 45236436, "end": 45242597}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/rmc.el", "start": 45242597, "end": 45255907}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/rmc.elc", "start": 45255907, "end": 45262995}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/rx.el", "start": 45262995, "end": 45333971}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/rx.elc", "start": 45333971, "end": 45378366}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/seq.el", "start": 45378366, "end": 45403674}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/seq.elc", "start": 45403674, "end": 45437451}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/shadow.el", "start": 45437451, "end": 45449098}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/shadow.elc", "start": 45449098, "end": 45458172}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/shortdoc.el", "start": 45458172, "end": 45511795}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/shortdoc.elc", "start": 45511795, "end": 45558903}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/shorthands.el", "start": 45558903, "end": 45562159}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/shorthands.elc", "start": 45562159, "end": 45563517}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/smie.el", "start": 45563517, "end": 45669180}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/smie.elc", "start": 45669180, "end": 45718241}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/subr-x.el", "start": 45718241, "end": 45739020}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/subr-x.elc", "start": 45739020, "end": 45754848}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/syntax.el", "start": 45754848, "end": 45791724}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/syntax.elc", "start": 45791724, "end": 45821857}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/tabulated-list.el", "start": 45821857, "end": 45861933}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/tabulated-list.elc", "start": 45861933, "end": 45894006}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/tcover-ses.el", "start": 45894006, "end": 45913058}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/tcover-ses.elc", "start": 45913058, "end": 45924564}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/testcover.el", "start": 45924564, "end": 45952941}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/testcover.elc", "start": 45952941, "end": 45972866}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/text-property-search.el", "start": 45972866, "end": 45982182}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/text-property-search.elc", "start": 45982182, "end": 45991175}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/thunk.el", "start": 45991175, "end": 45995397}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/thunk.elc", "start": 45995397, "end": 45998222}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/timer-list.el", "start": 45998222, "end": 46003194}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/timer-list.elc", "start": 46003194, "end": 46008168}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/timer.el", "start": 46008168, "end": 46031520}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/timer.elc", "start": 46031520, "end": 46054903}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/tq.el", "start": 46054903, "end": 46061441}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/tq.elc", "start": 46061441, "end": 46064992}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/trace.el", "start": 46064992, "end": 46076564}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/trace.elc", "start": 46076564, "end": 46083514}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/track-changes.el", "start": 46083514, "end": 46115011}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/track-changes.elc", "start": 46115011, "end": 46144823}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/unsafep.el", "start": 46144823, "end": 46155637}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/unsafep.elc", "start": 46155637, "end": 46159760}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/vtable.el", "start": 46159760, "end": 46201624}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/vtable.elc", "start": 46201624, "end": 46248135}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/warnings.el", "start": 46248135, "end": 46265542}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lisp/warnings.elc", "start": 46265542, "end": 46278310}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lock.el", "start": 46278310, "end": 46288346}, {"filename": "/usr/local/share/emacs/30.2/lisp/emacs-lock.elc", "start": 46288346, "end": 46297185}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/cua-base.el", "start": 46297185, "end": 46351098}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/cua-base.elc", "start": 46351098, "end": 46386687}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/cua-gmrk.el", "start": 46386687, "end": 46401475}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/cua-gmrk.elc", "start": 46401475, "end": 46411498}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/cua-rect.el", "start": 46411498, "end": 46466659}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/cua-rect.elc", "start": 46466659, "end": 46510484}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt-lk201.el", "start": 46510484, "end": 46512874}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt-lk201.elc", "start": 46512874, "end": 46513812}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt-mapper.el", "start": 46513812, "end": 46532751}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt-mapper.elc", "start": 46532751, "end": 46544675}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt-pc.el", "start": 46544675, "end": 46548340}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt-pc.elc", "start": 46548340, "end": 46549255}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt-vt100.el", "start": 46549255, "end": 46550813}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt-vt100.elc", "start": 46550813, "end": 46551173}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt.el", "start": 46551173, "end": 46638119}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/edt.elc", "start": 46638119, "end": 46701239}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/keypad.el", "start": 46701239, "end": 46711358}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/keypad.elc", "start": 46711358, "end": 46717533}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-cmd.el", "start": 46717533, "end": 46887533}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-cmd.elc", "start": 46887533, "end": 47013345}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-ex.el", "start": 47013345, "end": 47089313}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-ex.elc", "start": 47089313, "end": 47137966}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-init.el", "start": 47137966, "end": 47172042}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-init.elc", "start": 47172042, "end": 47204671}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-keym.el", "start": 47204671, "end": 47232530}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-keym.elc", "start": 47232530, "end": 47254075}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-macs.el", "start": 47254075, "end": 47286165}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-macs.elc", "start": 47286165, "end": 47305438}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-mous.el", "start": 47305438, "end": 47327639}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-mous.elc", "start": 47327639, "end": 47342156}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-util.el", "start": 47342156, "end": 47387990}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper-util.elc", "start": 47387990, "end": 47420044}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper.el", "start": 47420044, "end": 47468515}, {"filename": "/usr/local/share/emacs/30.2/lisp/emulation/viper.elc", "start": 47468515, "end": 47493448}, {"filename": "/usr/local/share/emacs/30.2/lisp/env.el", "start": 47493448, "end": 47503319}, {"filename": "/usr/local/share/emacs/30.2/lisp/env.elc", "start": 47503319, "end": 47510405}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-dired.el", "start": 47510405, "end": 47512512}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-dired.elc", "start": 47512512, "end": 47513836}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-file.el", "start": 47513836, "end": 47528332}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-file.elc", "start": 47528332, "end": 47537181}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-hook.el", "start": 47537181, "end": 47541541}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-hook.elc", "start": 47541541, "end": 47547126}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-ks.el", "start": 47547126, "end": 47559465}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-ks.elc", "start": 47559465, "end": 47584555}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-mail.el", "start": 47584555, "end": 47593550}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa-mail.elc", "start": 47593550, "end": 47604225}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa.el", "start": 47604225, "end": 47647919}, {"filename": "/usr/local/share/emacs/30.2/lisp/epa.elc", "start": 47647919, "end": 47693217}, {"filename": "/usr/local/share/emacs/30.2/lisp/epg-config.el", "start": 47693217, "end": 47704460}, {"filename": "/usr/local/share/emacs/30.2/lisp/epg-config.elc", "start": 47704460, "end": 47713449}, {"filename": "/usr/local/share/emacs/30.2/lisp/epg.el", "start": 47713449, "end": 47794119}, {"filename": "/usr/local/share/emacs/30.2/lisp/epg.elc", "start": 47794119, "end": 47967803}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/ChangeLog.1", "start": 47967803, "end": 48391304}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/ChangeLog.2", "start": 48391304, "end": 48417152}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-autoaway.el", "start": 48417152, "end": 48428045}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-autoaway.elc", "start": 48428045, "end": 48441651}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-backend.el", "start": 48441651, "end": 48563686}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-backend.elc", "start": 48563686, "end": 48748691}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-button.el", "start": 48748691, "end": 48787257}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-button.elc", "start": 48787257, "end": 48847083}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-capab.el", "start": 48847083, "end": 48855736}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-capab.elc", "start": 48855736, "end": 48865187}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-common.el", "start": 48865187, "end": 48893751}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-common.elc", "start": 48893751, "end": 49000228}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-compat.el", "start": 49000228, "end": 49019546}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-compat.elc", "start": 49019546, "end": 49031862}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-dcc.el", "start": 49031862, "end": 49085181}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-dcc.elc", "start": 49085181, "end": 49134818}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-desktop-notifications.el", "start": 49134818, "end": 49139620}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-desktop-notifications.elc", "start": 49139620, "end": 49146977}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-ezbounce.el", "start": 49146977, "end": 49152894}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-ezbounce.elc", "start": 49152894, "end": 49157623}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-fill.el", "start": 49157623, "end": 49198341}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-fill.elc", "start": 49198341, "end": 49237776}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-goodies.el", "start": 49237776, "end": 49294704}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-goodies.elc", "start": 49294704, "end": 49382785}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-ibuffer.el", "start": 49382785, "end": 49388961}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-ibuffer.elc", "start": 49388961, "end": 49395161}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-identd.el", "start": 49395161, "end": 49399317}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-identd.elc", "start": 49399317, "end": 49405842}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-imenu.el", "start": 49405842, "end": 49411390}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-imenu.elc", "start": 49411390, "end": 49418234}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-join.el", "start": 49418234, "end": 49429494}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-join.elc", "start": 49429494, "end": 49442721}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-lang.el", "start": 49442721, "end": 49448720}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-lang.elc", "start": 49448720, "end": 49453277}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-list.el", "start": 49453277, "end": 49461136}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-list.elc", "start": 49461136, "end": 49472831}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-loaddefs.el", "start": 49472831, "end": 49486381}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-loaddefs.elc", "start": 49486381, "end": 49499073}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-log.el", "start": 49499073, "end": 49517664}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-log.elc", "start": 49517664, "end": 49535044}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-match.el", "start": 49535044, "end": 49559873}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-match.elc", "start": 49559873, "end": 49584075}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-menu.el", "start": 49584075, "end": 49589170}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-menu.elc", "start": 49589170, "end": 49597115}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-netsplit.el", "start": 49597115, "end": 49604714}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-netsplit.elc", "start": 49604714, "end": 49615128}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-networks.el", "start": 49615128, "end": 49696298}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-networks.elc", "start": 49696298, "end": 49787405}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-nicks.el", "start": 49787405, "end": 49822992}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-nicks.elc", "start": 49822992, "end": 49857048}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-notify.el", "start": 49857048, "end": 49867090}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-notify.elc", "start": 49867090, "end": 49880197}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-page.el", "start": 49880197, "end": 49884173}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-page.elc", "start": 49884173, "end": 49890916}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-pcomplete.el", "start": 49890916, "end": 49900928}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-pcomplete.elc", "start": 49900928, "end": 49914482}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-replace.el", "start": 49914482, "end": 49917446}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-replace.elc", "start": 49917446, "end": 49923067}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-ring.el", "start": 49923067, "end": 49928684}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-ring.elc", "start": 49928684, "end": 49935938}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-sasl.el", "start": 49935938, "end": 49955032}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-sasl.elc", "start": 49955032, "end": 49986317}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-services.el", "start": 49986317, "end": 50012275}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-services.elc", "start": 50012275, "end": 50043494}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-sound.el", "start": 50043494, "end": 50048422}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-sound.elc", "start": 50048422, "end": 50055871}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-speedbar.el", "start": 50055871, "end": 50083733}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-speedbar.elc", "start": 50083733, "end": 50109711}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-spelling.el", "start": 50109711, "end": 50114011}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-spelling.elc", "start": 50114011, "end": 50120526}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-stamp.el", "start": 50120526, "end": 50173003}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-stamp.elc", "start": 50173003, "end": 50231114}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-status-sidebar.el", "start": 50231114, "end": 50257679}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-status-sidebar.elc", "start": 50257679, "end": 50284783}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-track.el", "start": 50284783, "end": 50334209}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-track.elc", "start": 50334209, "end": 50380153}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-truncate.el", "start": 50380153, "end": 50385937}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-truncate.elc", "start": 50385937, "end": 50392781}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-xdcc.el", "start": 50392781, "end": 50397437}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc-xdcc.elc", "start": 50397437, "end": 50405010}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc.el", "start": 50405010, "end": 50819189}, {"filename": "/usr/local/share/emacs/30.2/lisp/erc/erc.elc", "start": 50819189, "end": 51204538}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-alias.el", "start": 51204538, "end": 51215569}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-alias.elc", "start": 51215569, "end": 51222137}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-banner.el", "start": 51222137, "end": 51225200}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-banner.elc", "start": 51225200, "end": 51226543}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-basic.el", "start": 51226543, "end": 51234636}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-basic.elc", "start": 51234636, "end": 51239953}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-cmpl.el", "start": 51239953, "end": 51261367}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-cmpl.elc", "start": 51261367, "end": 51277642}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-dirs.el", "start": 51277642, "end": 51299673}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-dirs.elc", "start": 51299673, "end": 51317000}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-elecslash.el", "start": 51317000, "end": 51321391}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-elecslash.elc", "start": 51321391, "end": 51323904}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-extpipe.el", "start": 51323904, "end": 51333075}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-extpipe.elc", "start": 51333075, "end": 51338780}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-glob.el", "start": 51338780, "end": 51354699}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-glob.elc", "start": 51354699, "end": 51365912}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-hist.el", "start": 51365912, "end": 51405530}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-hist.elc", "start": 51405530, "end": 51438144}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-ls.el", "start": 51438144, "end": 51471972}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-ls.elc", "start": 51471972, "end": 51500172}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-pred.el", "start": 51500172, "end": 51521729}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-pred.elc", "start": 51521729, "end": 51540888}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-prompt.el", "start": 51540888, "end": 51550434}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-prompt.elc", "start": 51550434, "end": 51560167}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-rebind.el", "start": 51560167, "end": 51568303}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-rebind.elc", "start": 51568303, "end": 51577741}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-script.el", "start": 51577741, "end": 51584815}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-script.elc", "start": 51584815, "end": 51593353}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-smart.el", "start": 51593353, "end": 51604832}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-smart.elc", "start": 51604832, "end": 51612850}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-term.el", "start": 51612850, "end": 51626258}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-term.elc", "start": 51626258, "end": 51632029}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-tramp.el", "start": 51632029, "end": 51638019}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-tramp.elc", "start": 51638019, "end": 51642403}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-unix.el", "start": 51642403, "end": 51681227}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-unix.elc", "start": 51681227, "end": 51718162}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-xtra.el", "start": 51718162, "end": 51721154}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/em-xtra.elc", "start": 51721154, "end": 51723538}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-arg.el", "start": 51723538, "end": 51752781}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-arg.elc", "start": 51752781, "end": 51778103}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-cmd.el", "start": 51778103, "end": 51841521}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-cmd.elc", "start": 51841521, "end": 51897444}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-ext.el", "start": 51897444, "end": 51912263}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-ext.elc", "start": 51912263, "end": 51924762}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-io.el", "start": 51924762, "end": 51956569}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-io.elc", "start": 51956569, "end": 51987682}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-mode.el", "start": 51987682, "end": 52026063}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-mode.elc", "start": 52026063, "end": 52058493}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-module-loaddefs.el", "start": 52058493, "end": 52066609}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-module-loaddefs.elc", "start": 52066609, "end": 52073686}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-module.el", "start": 52073686, "end": 52080243}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-module.elc", "start": 52080243, "end": 52085829}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-opt.el", "start": 52085829, "end": 52098270}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-opt.elc", "start": 52098270, "end": 52106991}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-proc.el", "start": 52106991, "end": 52136970}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-proc.elc", "start": 52136970, "end": 52160214}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-util.el", "start": 52160214, "end": 52192719}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-util.elc", "start": 52192719, "end": 52221359}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-var.el", "start": 52221359, "end": 52256012}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/esh-var.elc", "start": 52256012, "end": 52284161}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/eshell.el", "start": 52284161, "end": 52299700}, {"filename": "/usr/local/share/emacs/30.2/lisp/eshell/eshell.elc", "start": 52299700, "end": 52308503}, {"filename": "/usr/local/share/emacs/30.2/lisp/expand.el", "start": 52308503, "end": 52322341}, {"filename": "/usr/local/share/emacs/30.2/lisp/expand.elc", "start": 52322341, "end": 52331692}, {"filename": "/usr/local/share/emacs/30.2/lisp/external-completion.el", "start": 52331692, "end": 52340056}, {"filename": "/usr/local/share/emacs/30.2/lisp/external-completion.elc", "start": 52340056, "end": 52344784}, {"filename": "/usr/local/share/emacs/30.2/lisp/ezimage.el", "start": 52344784, "end": 52354017}, {"filename": "/usr/local/share/emacs/30.2/lisp/ezimage.elc", "start": 52354017, "end": 52363499}, {"filename": "/usr/local/share/emacs/30.2/lisp/face-remap.el", "start": 52363499, "end": 52390179}, {"filename": "/usr/local/share/emacs/30.2/lisp/face-remap.elc", "start": 52390179, "end": 52413977}, {"filename": "/usr/local/share/emacs/30.2/lisp/facemenu.el", "start": 52413977, "end": 52451250}, {"filename": "/usr/local/share/emacs/30.2/lisp/facemenu.elc", "start": 52451250, "end": 52479530}, {"filename": "/usr/local/share/emacs/30.2/lisp/faces.el", "start": 52479530, "end": 52608008}, {"filename": "/usr/local/share/emacs/30.2/lisp/faces.elc", "start": 52608008, "end": 52709613}, {"filename": "/usr/local/share/emacs/30.2/lisp/ffap.el", "start": 52709613, "end": 52791926}, {"filename": "/usr/local/share/emacs/30.2/lisp/ffap.elc", "start": 52791926, "end": 52849942}, {"filename": "/usr/local/share/emacs/30.2/lisp/filecache.el", "start": 52849942, "end": 52875559}, {"filename": "/usr/local/share/emacs/30.2/lisp/filecache.elc", "start": 52875559, "end": 52892121}, {"filename": "/usr/local/share/emacs/30.2/lisp/fileloop.el", "start": 52892121, "end": 52901364}, {"filename": "/usr/local/share/emacs/30.2/lisp/fileloop.elc", "start": 52901364, "end": 52907733}, {"filename": "/usr/local/share/emacs/30.2/lisp/filenotify.el", "start": 52907733, "end": 52930250}, {"filename": "/usr/local/share/emacs/30.2/lisp/filenotify.elc", "start": 52930250, "end": 52960091}, {"filename": "/usr/local/share/emacs/30.2/lisp/files-x.el", "start": 52960091, "end": 53001157}, {"filename": "/usr/local/share/emacs/30.2/lisp/files-x.elc", "start": 53001157, "end": 53033832}, {"filename": "/usr/local/share/emacs/30.2/lisp/files.el", "start": 53033832, "end": 53435617}, {"filename": "/usr/local/share/emacs/30.2/lisp/files.elc", "start": 53435617, "end": 53728955}, {"filename": "/usr/local/share/emacs/30.2/lisp/filesets.el", "start": 53728955, "end": 53815376}, {"filename": "/usr/local/share/emacs/30.2/lisp/filesets.elc", "start": 53815376, "end": 53887839}, {"filename": "/usr/local/share/emacs/30.2/lisp/find-cmd.el", "start": 53887839, "end": 53895871}, {"filename": "/usr/local/share/emacs/30.2/lisp/find-cmd.elc", "start": 53895871, "end": 53900582}, {"filename": "/usr/local/share/emacs/30.2/lisp/find-dired.el", "start": 53900582, "end": 53917325}, {"filename": "/usr/local/share/emacs/30.2/lisp/find-dired.elc", "start": 53917325, "end": 53929543}, {"filename": "/usr/local/share/emacs/30.2/lisp/find-file.el", "start": 53929543, "end": 53962345}, {"filename": "/usr/local/share/emacs/30.2/lisp/find-file.elc", "start": 53962345, "end": 53980959}, {"filename": "/usr/local/share/emacs/30.2/lisp/find-lisp.el", "start": 53980959, "end": 53994676}, {"filename": "/usr/local/share/emacs/30.2/lisp/find-lisp.elc", "start": 53994676, "end": 54003279}, {"filename": "/usr/local/share/emacs/30.2/lisp/finder.el", "start": 54003279, "end": 54020821}, {"filename": "/usr/local/share/emacs/30.2/lisp/finder.elc", "start": 54020821, "end": 54035573}, {"filename": "/usr/local/share/emacs/30.2/lisp/flow-ctrl.el", "start": 54035573, "end": 54040658}, {"filename": "/usr/local/share/emacs/30.2/lisp/flow-ctrl.elc", "start": 54040658, "end": 54042577}, {"filename": "/usr/local/share/emacs/30.2/lisp/foldout.el", "start": 54042577, "end": 54063091}, {"filename": "/usr/local/share/emacs/30.2/lisp/foldout.elc", "start": 54063091, "end": 54069975}, {"filename": "/usr/local/share/emacs/30.2/lisp/follow.el", "start": 54069975, "end": 54138470}, {"filename": "/usr/local/share/emacs/30.2/lisp/follow.elc", "start": 54138470, "end": 54180139}, {"filename": "/usr/local/share/emacs/30.2/lisp/font-core.el", "start": 54180139, "end": 54192456}, {"filename": "/usr/local/share/emacs/30.2/lisp/font-core.elc", "start": 54192456, "end": 54204869}, {"filename": "/usr/local/share/emacs/30.2/lisp/font-lock.el", "start": 54204869, "end": 54311961}, {"filename": "/usr/local/share/emacs/30.2/lisp/font-lock.elc", "start": 54311961, "end": 54378668}, {"filename": "/usr/local/share/emacs/30.2/lisp/format-spec.el", "start": 54378668, "end": 54386808}, {"filename": "/usr/local/share/emacs/30.2/lisp/format-spec.elc", "start": 54386808, "end": 54391985}, {"filename": "/usr/local/share/emacs/30.2/lisp/format.el", "start": 54391985, "end": 54435829}, {"filename": "/usr/local/share/emacs/30.2/lisp/format.elc", "start": 54435829, "end": 54462935}, {"filename": "/usr/local/share/emacs/30.2/lisp/forms.el", "start": 54462935, "end": 54531708}, {"filename": "/usr/local/share/emacs/30.2/lisp/forms.elc", "start": 54531708, "end": 54567343}, {"filename": "/usr/local/share/emacs/30.2/lisp/frame.el", "start": 54567343, "end": 54699981}, {"filename": "/usr/local/share/emacs/30.2/lisp/frame.elc", "start": 54699981, "end": 54804880}, {"filename": "/usr/local/share/emacs/30.2/lisp/frameset.el", "start": 54804880, "end": 54871517}, {"filename": "/usr/local/share/emacs/30.2/lisp/frameset.elc", "start": 54871517, "end": 54921356}, {"filename": "/usr/local/share/emacs/30.2/lisp/fringe.el", "start": 54921356, "end": 54934256}, {"filename": "/usr/local/share/emacs/30.2/lisp/fringe.elc", "start": 54934256, "end": 54944773}, {"filename": "/usr/local/share/emacs/30.2/lisp/generic-x.el", "start": 54944773, "end": 54993730}, {"filename": "/usr/local/share/emacs/30.2/lisp/generic-x.elc", "start": 54993730, "end": 55035588}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/ChangeLog.1", "start": 55035588, "end": 55142433}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/ChangeLog.2", "start": 55142433, "end": 55757189}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/ChangeLog.3", "start": 55757189, "end": 56675573}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/canlock.el", "start": 56675573, "end": 56683922}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/canlock.elc", "start": 56683922, "end": 56689531}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/deuglify.el", "start": 56689531, "end": 56707088}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/deuglify.elc", "start": 56707088, "end": 56715521}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gmm-utils.el", "start": 56715521, "end": 56723188}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gmm-utils.elc", "start": 56723188, "end": 56728204}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-agent.el", "start": 56728204, "end": 56885864}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-agent.elc", "start": 56885864, "end": 57005880}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-art.el", "start": 57005880, "end": 57339470}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-art.elc", "start": 57339470, "end": 57636309}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-async.el", "start": 57636309, "end": 57649572}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-async.elc", "start": 57649572, "end": 57661087}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-bcklg.el", "start": 57661087, "end": 57665927}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-bcklg.elc", "start": 57665927, "end": 57668387}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-bookmark.el", "start": 57668387, "end": 57698582}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-bookmark.elc", "start": 57698582, "end": 57724464}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-cache.el", "start": 57724464, "end": 57756698}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-cache.elc", "start": 57756698, "end": 57780769}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-cite.el", "start": 57780769, "end": 57819761}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-cite.elc", "start": 57819761, "end": 57847181}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-cloud.el", "start": 57847181, "end": 57867174}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-cloud.elc", "start": 57867174, "end": 57884107}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-cus.el", "start": 57884107, "end": 57925954}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-cus.elc", "start": 57925954, "end": 57965625}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-dbus.el", "start": 57965625, "end": 57967894}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-dbus.elc", "start": 57967894, "end": 57969256}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-delay.el", "start": 57969256, "end": 57975848}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-delay.elc", "start": 57975848, "end": 57980641}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-demon.el", "start": 57980641, "end": 57989997}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-demon.elc", "start": 57989997, "end": 57997305}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-diary.el", "start": 57997305, "end": 58010922}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-diary.elc", "start": 58010922, "end": 58019503}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-dired.el", "start": 58019503, "end": 58028671}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-dired.elc", "start": 58028671, "end": 58037030}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-draft.el", "start": 58037030, "end": 58049016}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-draft.elc", "start": 58049016, "end": 58061445}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-dup.el", "start": 58061445, "end": 58066876}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-dup.elc", "start": 58066876, "end": 58071229}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-eform.el", "start": 58071229, "end": 58075128}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-eform.elc", "start": 58075128, "end": 58080196}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-fun.el", "start": 58080196, "end": 58091171}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-fun.elc", "start": 58091171, "end": 58101420}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-gravatar.el", "start": 58101420, "end": 58107115}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-gravatar.elc", "start": 58107115, "end": 58111013}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-group.el", "start": 58111013, "end": 58293013}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-group.elc", "start": 58293013, "end": 58459514}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-html.el", "start": 58459514, "end": 58477149}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-html.elc", "start": 58477149, "end": 58490264}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-icalendar.el", "start": 58490264, "end": 58533469}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-icalendar.elc", "start": 58533469, "end": 58576421}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-int.el", "start": 58576421, "end": 58612659}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-int.elc", "start": 58612659, "end": 58674617}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-kill.el", "start": 58674617, "end": 58697957}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-kill.elc", "start": 58697957, "end": 58717222}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-logic.el", "start": 58717222, "end": 58725542}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-logic.elc", "start": 58725542, "end": 58730219}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-mh.el", "start": 58730219, "end": 58734313}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-mh.elc", "start": 58734313, "end": 58737110}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-ml.el", "start": 58737110, "end": 58742844}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-ml.elc", "start": 58742844, "end": 58749041}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-mlspl.el", "start": 58749041, "end": 58758456}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-mlspl.elc", "start": 58758456, "end": 58764681}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-msg.el", "start": 58764681, "end": 58834738}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-msg.elc", "start": 58834738, "end": 58917150}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-notifications.el", "start": 58917150, "end": 58926160}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-notifications.elc", "start": 58926160, "end": 58931782}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-picon.el", "start": 58931782, "end": 58942396}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-picon.elc", "start": 58942396, "end": 58950510}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-range.el", "start": 58950510, "end": 58959329}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-range.elc", "start": 58959329, "end": 58965082}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-registry.el", "start": 58965082, "end": 59017169}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-registry.elc", "start": 59017169, "end": 59052639}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-rfc1843.el", "start": 59052639, "end": 59055112}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-rfc1843.elc", "start": 59055112, "end": 59056394}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-rmail.el", "start": 59056394, "end": 59061843}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-rmail.elc", "start": 59061843, "end": 59064544}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-salt.el", "start": 59064544, "end": 59094007}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-salt.elc", "start": 59094007, "end": 59123335}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-score.el", "start": 59123335, "end": 59236797}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-score.elc", "start": 59236797, "end": 59315696}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-search.el", "start": 59315696, "end": 59399695}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-search.elc", "start": 59399695, "end": 59486552}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-sieve.el", "start": 59486552, "end": 59494220}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-sieve.elc", "start": 59494220, "end": 59502356}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-spec.el", "start": 59502356, "end": 59523504}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-spec.elc", "start": 59523504, "end": 59536791}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-srvr.el", "start": 59536791, "end": 59575586}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-srvr.elc", "start": 59575586, "end": 59627624}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-start.el", "start": 59627624, "end": 59746749}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-start.elc", "start": 59746749, "end": 59883724}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-sum.el", "start": 59883724, "end": 60380201}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-sum.elc", "start": 60380201, "end": 60825385}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-topic.el", "start": 60825385, "end": 60888411}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-topic.elc", "start": 60888411, "end": 60937276}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-undo.el", "start": 60937276, "end": 60942881}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-undo.elc", "start": 60942881, "end": 60947701}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-util.el", "start": 60947701, "end": 61001566}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-util.elc", "start": 61001566, "end": 61047833}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-uu.el", "start": 61047833, "end": 61122794}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-uu.elc", "start": 61122794, "end": 61181326}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-vm.el", "start": 61181326, "end": 61184560}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-vm.elc", "start": 61184560, "end": 61186742}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-win.el", "start": 61186742, "end": 61204015}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus-win.elc", "start": 61204015, "end": 61215240}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus.el", "start": 61215240, "end": 61361734}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gnus.elc", "start": 61361734, "end": 61528385}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gssapi.el", "start": 61528385, "end": 61531870}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/gssapi.elc", "start": 61531870, "end": 61533841}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mail-source.el", "start": 61533841, "end": 61573747}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mail-source.elc", "start": 61573747, "end": 61602040}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/message.el", "start": 61602040, "end": 61928776}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/message.elc", "start": 61928776, "end": 62187247}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-archive.el", "start": 62187247, "end": 62190937}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-archive.elc", "start": 62190937, "end": 62193783}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-bodies.el", "start": 62193783, "end": 62203822}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-bodies.elc", "start": 62203822, "end": 62209541}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-decode.el", "start": 62209541, "end": 62278171}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-decode.elc", "start": 62278171, "end": 62334751}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-encode.el", "start": 62334751, "end": 62342927}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-encode.elc", "start": 62342927, "end": 62349019}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-extern.el", "start": 62349019, "end": 62354328}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-extern.elc", "start": 62354328, "end": 62358147}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-partial.el", "start": 62358147, "end": 62363023}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-partial.elc", "start": 62363023, "end": 62365788}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-url.el", "start": 62365788, "end": 62379264}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-url.elc", "start": 62379264, "end": 62388969}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-util.el", "start": 62388969, "end": 62419310}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-util.elc", "start": 62419310, "end": 62441780}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-uu.el", "start": 62441780, "end": 62466405}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-uu.elc", "start": 62466405, "end": 62489015}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-view.el", "start": 62489015, "end": 62512343}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mm-view.elc", "start": 62512343, "end": 62530791}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml-sec.el", "start": 62530791, "end": 62572014}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml-sec.elc", "start": 62572014, "end": 62609396}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml-smime.el", "start": 62609396, "end": 62624282}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml-smime.elc", "start": 62624282, "end": 62634742}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml.el", "start": 62634742, "end": 62698412}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml.elc", "start": 62698412, "end": 62745635}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml1991.el", "start": 62745635, "end": 62756195}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml1991.elc", "start": 62756195, "end": 62763538}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml2015.el", "start": 62763538, "end": 62796982}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/mml2015.elc", "start": 62796982, "end": 62823052}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnagent.el", "start": 62823052, "end": 62831654}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnagent.elc", "start": 62831654, "end": 62842593}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnatom.el", "start": 62842593, "end": 62855170}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnatom.elc", "start": 62855170, "end": 62866030}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnbabyl.el", "start": 62866030, "end": 62887896}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnbabyl.elc", "start": 62887896, "end": 62905383}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nndiary.el", "start": 62905383, "end": 62961160}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nndiary.elc", "start": 62961160, "end": 63000416}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nndir.el", "start": 63000416, "end": 63003418}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nndir.elc", "start": 63003418, "end": 63007226}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nndoc.el", "start": 63007226, "end": 63045189}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nndoc.elc", "start": 63045189, "end": 63075870}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nndraft.el", "start": 63075870, "end": 63087842}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nndraft.elc", "start": 63087842, "end": 63098957}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nneething.el", "start": 63098957, "end": 63112830}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nneething.elc", "start": 63112830, "end": 63124716}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnfeed.el", "start": 63124716, "end": 63154985}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnfeed.elc", "start": 63154985, "end": 63182306}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnfolder.el", "start": 63182306, "end": 63225158}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnfolder.elc", "start": 63225158, "end": 63258267}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nngateway.el", "start": 63258267, "end": 63261128}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nngateway.elc", "start": 63261128, "end": 63264282}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnheader.el", "start": 63264282, "end": 63300533}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnheader.elc", "start": 63300533, "end": 63339676}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnimap.el", "start": 63339676, "end": 63419876}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnimap.elc", "start": 63419876, "end": 63493670}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmail.el", "start": 63493670, "end": 63566918}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmail.elc", "start": 63566918, "end": 63621441}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmaildir.el", "start": 63621441, "end": 63690163}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmaildir.elc", "start": 63690163, "end": 63784638}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmairix.el", "start": 63784638, "end": 63859860}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmairix.elc", "start": 63859860, "end": 63934110}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmbox.el", "start": 63934110, "end": 63958686}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmbox.elc", "start": 63958686, "end": 63977958}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmh.el", "start": 63977958, "end": 63997622}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnmh.elc", "start": 63997622, "end": 64013249}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnml.el", "start": 64013249, "end": 64056958}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnml.elc", "start": 64056958, "end": 64091360}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnnil.el", "start": 64091360, "end": 64093594}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnnil.elc", "start": 64093594, "end": 64095105}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnoo.el", "start": 64095105, "end": 64106346}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnoo.elc", "start": 64106346, "end": 64115112}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnregistry.el", "start": 64115112, "end": 64117164}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnregistry.elc", "start": 64117164, "end": 64118661}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnrss.el", "start": 64118661, "end": 64152252}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnrss.elc", "start": 64152252, "end": 64181038}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnselect.el", "start": 64181038, "end": 64224832}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnselect.elc", "start": 64224832, "end": 64269111}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnspool.el", "start": 64269111, "end": 64285257}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnspool.elc", "start": 64285257, "end": 64301681}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nntp.el", "start": 64301681, "end": 64376892}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nntp.elc", "start": 64376892, "end": 64442045}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnvirtual.el", "start": 64442045, "end": 64470061}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnvirtual.elc", "start": 64470061, "end": 64489650}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnweb.el", "start": 64489650, "end": 64508157}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/nnweb.elc", "start": 64508157, "end": 64525262}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/score-mode.el", "start": 64525262, "end": 64528913}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/score-mode.elc", "start": 64528913, "end": 64533738}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/smiley.el", "start": 64533738, "end": 64542529}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/smiley.elc", "start": 64542529, "end": 64548705}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/smime.el", "start": 64548705, "end": 64572884}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/smime.elc", "start": 64572884, "end": 64592088}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/spam-report.el", "start": 64592088, "end": 64606350}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/spam-report.elc", "start": 64606350, "end": 64617842}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/spam-stat.el", "start": 64617842, "end": 64641057}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/spam-stat.elc", "start": 64641057, "end": 64661308}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/spam-wash.el", "start": 64661308, "end": 64663647}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/spam-wash.elc", "start": 64663647, "end": 64664582}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/spam.el", "start": 64664582, "end": 64772590}, {"filename": "/usr/local/share/emacs/30.2/lisp/gnus/spam.elc", "start": 64772590, "end": 64856675}, {"filename": "/usr/local/share/emacs/30.2/lisp/help-at-pt.el", "start": 64856675, "end": 64871915}, {"filename": "/usr/local/share/emacs/30.2/lisp/help-at-pt.elc", "start": 64871915, "end": 64883780}, {"filename": "/usr/local/share/emacs/30.2/lisp/help-fns.el", "start": 64883780, "end": 64989894}, {"filename": "/usr/local/share/emacs/30.2/lisp/help-fns.elc", "start": 64989894, "end": 65059702}, {"filename": "/usr/local/share/emacs/30.2/lisp/help-macro.el", "start": 65059702, "end": 65071165}, {"filename": "/usr/local/share/emacs/30.2/lisp/help-macro.elc", "start": 65071165, "end": 65075561}, {"filename": "/usr/local/share/emacs/30.2/lisp/help-mode.el", "start": 65075561, "end": 65115246}, {"filename": "/usr/local/share/emacs/30.2/lisp/help-mode.elc", "start": 65115246, "end": 65146350}, {"filename": "/usr/local/share/emacs/30.2/lisp/help.el", "start": 65146350, "end": 65252063}, {"filename": "/usr/local/share/emacs/30.2/lisp/help.elc", "start": 65252063, "end": 65320765}, {"filename": "/usr/local/share/emacs/30.2/lisp/hex-util.el", "start": 65320765, "end": 65323261}, {"filename": "/usr/local/share/emacs/30.2/lisp/hex-util.elc", "start": 65323261, "end": 65324344}, {"filename": "/usr/local/share/emacs/30.2/lisp/hexl.el", "start": 65324344, "end": 65371247}, {"filename": "/usr/local/share/emacs/30.2/lisp/hexl.elc", "start": 65371247, "end": 65412479}, {"filename": "/usr/local/share/emacs/30.2/lisp/hfy-cmap.el", "start": 65412479, "end": 65453517}, {"filename": "/usr/local/share/emacs/30.2/lisp/hfy-cmap.elc", "start": 65453517, "end": 65479345}, {"filename": "/usr/local/share/emacs/30.2/lisp/hi-lock.el", "start": 65479345, "end": 65518633}, {"filename": "/usr/local/share/emacs/30.2/lisp/hi-lock.elc", "start": 65518633, "end": 65552507}, {"filename": "/usr/local/share/emacs/30.2/lisp/hilit-chg.el", "start": 65552507, "end": 65589662}, {"filename": "/usr/local/share/emacs/30.2/lisp/hilit-chg.elc", "start": 65589662, "end": 65618421}, {"filename": "/usr/local/share/emacs/30.2/lisp/hippie-exp.el", "start": 65618421, "end": 65658597}, {"filename": "/usr/local/share/emacs/30.2/lisp/hippie-exp.elc", "start": 65658597, "end": 65680417}, {"filename": "/usr/local/share/emacs/30.2/lisp/hl-line.el", "start": 65680417, "end": 65692474}, {"filename": "/usr/local/share/emacs/30.2/lisp/hl-line.elc", "start": 65692474, "end": 65705312}, {"filename": "/usr/local/share/emacs/30.2/lisp/htmlfontify.el", "start": 65705312, "end": 65806135}, {"filename": "/usr/local/share/emacs/30.2/lisp/htmlfontify.elc", "start": 65806135, "end": 65872082}, {"filename": "/usr/local/share/emacs/30.2/lisp/ibuf-ext.el", "start": 65872082, "end": 65946317}, {"filename": "/usr/local/share/emacs/30.2/lisp/ibuf-ext.elc", "start": 65946317, "end": 66027275}, {"filename": "/usr/local/share/emacs/30.2/lisp/ibuf-macs.el", "start": 66027275, "end": 66041317}, {"filename": "/usr/local/share/emacs/30.2/lisp/ibuf-macs.elc", "start": 66041317, "end": 66054193}, {"filename": "/usr/local/share/emacs/30.2/lisp/ibuffer-loaddefs.el", "start": 66054193, "end": 66067372}, {"filename": "/usr/local/share/emacs/30.2/lisp/ibuffer-loaddefs.elc", "start": 66067372, "end": 66081085}, {"filename": "/usr/local/share/emacs/30.2/lisp/ibuffer.el", "start": 66081085, "end": 66180431}, {"filename": "/usr/local/share/emacs/30.2/lisp/ibuffer.elc", "start": 66180431, "end": 66275706}, {"filename": "/usr/local/share/emacs/30.2/lisp/icomplete.el", "start": 66275706, "end": 66325983}, {"filename": "/usr/local/share/emacs/30.2/lisp/icomplete.elc", "start": 66325983, "end": 66364040}, {"filename": "/usr/local/share/emacs/30.2/lisp/ido.el", "start": 66364040, "end": 66544487}, {"filename": "/usr/local/share/emacs/30.2/lisp/ido.elc", "start": 66544487, "end": 66675010}, {"filename": "/usr/local/share/emacs/30.2/lisp/ielm.el", "start": 66675010, "end": 66703169}, {"filename": "/usr/local/share/emacs/30.2/lisp/ielm.elc", "start": 66703169, "end": 66725174}, {"filename": "/usr/local/share/emacs/30.2/lisp/iimage.el", "start": 66725174, "end": 66730473}, {"filename": "/usr/local/share/emacs/30.2/lisp/iimage.elc", "start": 66730473, "end": 66735890}, {"filename": "/usr/local/share/emacs/30.2/lisp/image-file.el", "start": 66735890, "end": 66743520}, {"filename": "/usr/local/share/emacs/30.2/lisp/image-file.elc", "start": 66743520, "end": 66750650}, {"filename": "/usr/local/share/emacs/30.2/lisp/image-mode.el", "start": 66750650, "end": 66816989}, {"filename": "/usr/local/share/emacs/30.2/lisp/image-mode.elc", "start": 66816989, "end": 66868731}, {"filename": "/usr/local/share/emacs/30.2/lisp/image.el", "start": 66868731, "end": 66934366}, {"filename": "/usr/local/share/emacs/30.2/lisp/image.elc", "start": 66934366, "end": 66982435}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/compface.el", "start": 66982435, "end": 66984383}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/compface.elc", "start": 66984383, "end": 66985286}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/exif.el", "start": 66985286, "end": 66997987}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/exif.elc", "start": 66997987, "end": 67005624}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/gravatar.el", "start": 67005624, "end": 67018759}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/gravatar.elc", "start": 67018759, "end": 67028453}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-converter.el", "start": 67028453, "end": 67042722}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-converter.elc", "start": 67042722, "end": 67052995}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-crop.el", "start": 67052995, "end": 67070849}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-crop.elc", "start": 67070849, "end": 67084320}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired-dired.el", "start": 67084320, "end": 67101445}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired-dired.elc", "start": 67101445, "end": 67119854}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired-external.el", "start": 67119854, "end": 67149363}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired-external.elc", "start": 67149363, "end": 67170993}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired-tags.el", "start": 67170993, "end": 67184277}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired-tags.elc", "start": 67184277, "end": 67194319}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired-util.el", "start": 67194319, "end": 67203243}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired-util.elc", "start": 67203243, "end": 67210435}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired.el", "start": 67210435, "end": 67294813}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/image-dired.elc", "start": 67294813, "end": 67378287}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/wallpaper.el", "start": 67378287, "end": 67401458}, {"filename": "/usr/local/share/emacs/30.2/lisp/image/wallpaper.elc", "start": 67401458, "end": 67425471}, {"filename": "/usr/local/share/emacs/30.2/lisp/imenu.el", "start": 67425471, "end": 67463710}, {"filename": "/usr/local/share/emacs/30.2/lisp/imenu.elc", "start": 67463710, "end": 67492313}, {"filename": "/usr/local/share/emacs/30.2/lisp/indent-aux.el", "start": 67492313, "end": 67495054}, {"filename": "/usr/local/share/emacs/30.2/lisp/indent-aux.elc", "start": 67495054, "end": 67499049}, {"filename": "/usr/local/share/emacs/30.2/lisp/indent.el", "start": 67499049, "end": 67531380}, {"filename": "/usr/local/share/emacs/30.2/lisp/indent.elc", "start": 67531380, "end": 67556822}, {"filename": "/usr/local/share/emacs/30.2/lisp/info-look.el", "start": 67556822, "end": 67605718}, {"filename": "/usr/local/share/emacs/30.2/lisp/info-look.elc", "start": 67605718, "end": 67639372}, {"filename": "/usr/local/share/emacs/30.2/lisp/info-xref.el", "start": 67639372, "end": 67662065}, {"filename": "/usr/local/share/emacs/30.2/lisp/info-xref.elc", "start": 67662065, "end": 67678624}, {"filename": "/usr/local/share/emacs/30.2/lisp/info.el", "start": 67678624, "end": 67908109}, {"filename": "/usr/local/share/emacs/30.2/lisp/info.elc", "start": 67908109, "end": 68064074}, {"filename": "/usr/local/share/emacs/30.2/lisp/informat.el", "start": 68064074, "end": 68081374}, {"filename": "/usr/local/share/emacs/30.2/lisp/informat.elc", "start": 68081374, "end": 68090943}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ccl.el", "start": 68090943, "end": 68142953}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ccl.elc", "start": 68142953, "end": 68182719}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/characters.el", "start": 68182719, "end": 68247305}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/characters.elc", "start": 68247305, "end": 68286113}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/charprop.el", "start": 68286113, "end": 68291740}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/charscript.el", "start": 68291740, "end": 68317859}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/cp51932.el", "start": 68317859, "end": 68327490}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/emoji-zwj.el", "start": 68327490, "end": 68445090}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/emoji.el", "start": 68445090, "end": 68474173}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/emoji.elc", "start": 68474173, "end": 68497498}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/eucjp-ms.el", "start": 68497498, "end": 68537435}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/fontset.el", "start": 68537435, "end": 68593684}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/fontset.elc", "start": 68593684, "end": 68629742}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/isearch-x.el", "start": 68629742, "end": 68635468}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/isearch-x.elc", "start": 68635468, "end": 68638356}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/iso-ascii.el", "start": 68638356, "end": 68646139}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/iso-ascii.elc", "start": 68646139, "end": 68651937}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/iso-cvt.el", "start": 68651937, "end": 68675604}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/iso-cvt.elc", "start": 68675604, "end": 68694011}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/iso-transl.el", "start": 68694011, "end": 68705058}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/iso-transl.elc", "start": 68705058, "end": 68711702}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ja-dic-cnv.el", "start": 68711702, "end": 68730928}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ja-dic-cnv.elc", "start": 68730928, "end": 68742230}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ja-dic-utl.el", "start": 68742230, "end": 68750138}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ja-dic-utl.elc", "start": 68750138, "end": 68754786}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/kinsoku.el", "start": 68754786, "end": 68761387}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/kinsoku.elc", "start": 68761387, "end": 68764242}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/kkc.el", "start": 68764242, "end": 68788383}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/kkc.elc", "start": 68788383, "end": 68802281}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/latexenc.el", "start": 68802281, "end": 68810499}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/latexenc.elc", "start": 68810499, "end": 68814441}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/latin1-disp.el", "start": 68814441, "end": 68874930}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/latin1-disp.elc", "start": 68874930, "end": 68919942}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule-cmds.el", "start": 68919942, "end": 69062425}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule-cmds.elc", "start": 69062425, "end": 69161331}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule-conf.el", "start": 69161331, "end": 69211600}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule-conf.elc", "start": 69211600, "end": 69250648}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule-diag.el", "start": 69250648, "end": 69295761}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule-diag.elc", "start": 69295761, "end": 69332450}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule-util.el", "start": 69332450, "end": 69353497}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule-util.elc", "start": 69353497, "end": 69367112}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule.el", "start": 69367112, "end": 69471142}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/mule.elc", "start": 69471142, "end": 69546690}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ogonek.el", "start": 69546690, "end": 69567309}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ogonek.elc", "start": 69567309, "end": 69583828}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/quail.el", "start": 69583828, "end": 69704317}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/quail.elc", "start": 69704317, "end": 69786787}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/rfc1843.el", "start": 69786787, "end": 69790987}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/rfc1843.elc", "start": 69790987, "end": 69794587}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/robin.el", "start": 69794587, "end": 69811708}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/robin.elc", "start": 69811708, "end": 69819431}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/textsec-check.el", "start": 69819431, "end": 69822085}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/textsec-check.elc", "start": 69822085, "end": 69824100}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/textsec.el", "start": 69824100, "end": 69844592}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/textsec.elc", "start": 69844592, "end": 69859991}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/titdic-cnv.el", "start": 69859991, "end": 69908596}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/titdic-cnv.elc", "start": 69908596, "end": 69946120}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ucs-normalize.el", "start": 69946120, "end": 69975065}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/ucs-normalize.elc", "start": 69975065, "end": 70201834}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-bidi.el", "start": 70201834, "end": 70213545}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-brackets.el", "start": 70213545, "end": 70219032}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-category.el", "start": 70219032, "end": 70236774}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-combining.el", "start": 70236774, "end": 70246314}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-comment.el", "start": 70246314, "end": 70249167}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-confusable.el", "start": 70249167, "end": 70324910}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-decimal.el", "start": 70324910, "end": 70328560}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-decomposition.el", "start": 70328560, "end": 70359677}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-digit.el", "start": 70359677, "end": 70363567}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-lowercase.el", "start": 70363567, "end": 70372192}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-mirrored.el", "start": 70372192, "end": 70384319}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-name.el", "start": 70384319, "end": 70619149}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-numeric.el", "start": 70619149, "end": 70625396}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-old-name.el", "start": 70625396, "end": 70645624}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-scripts.el", "start": 70645624, "end": 70680512}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-special-lowercase.el", "start": 70680512, "end": 70682724}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-special-titlecase.el", "start": 70682724, "end": 70689519}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-special-uppercase.el", "start": 70689519, "end": 70696524}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-titlecase.el", "start": 70696524, "end": 70705255}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/uni-uppercase.el", "start": 70705255, "end": 70713982}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/utf-7.el", "start": 70713982, "end": 70718327}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/utf-7.elc", "start": 70718327, "end": 70720150}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/utf7.el", "start": 70720150, "end": 70728835}, {"filename": "/usr/local/share/emacs/30.2/lisp/international/utf7.elc", "start": 70728835, "end": 70734296}, {"filename": "/usr/local/share/emacs/30.2/lisp/isearch.el", "start": 70734296, "end": 70935454}, {"filename": "/usr/local/share/emacs/30.2/lisp/isearch.elc", "start": 70935454, "end": 71113512}, {"filename": "/usr/local/share/emacs/30.2/lisp/isearchb.el", "start": 71113512, "end": 71121577}, {"filename": "/usr/local/share/emacs/30.2/lisp/isearchb.elc", "start": 71121577, "end": 71126017}, {"filename": "/usr/local/share/emacs/30.2/lisp/jit-lock.el", "start": 71126017, "end": 71160449}, {"filename": "/usr/local/share/emacs/30.2/lisp/jit-lock.elc", "start": 71160449, "end": 71185399}, {"filename": "/usr/local/share/emacs/30.2/lisp/jka-cmpr-hook.el", "start": 71185399, "end": 71201019}, {"filename": "/usr/local/share/emacs/30.2/lisp/jka-cmpr-hook.elc", "start": 71201019, "end": 71215349}, {"filename": "/usr/local/share/emacs/30.2/lisp/jka-compr.el", "start": 71215349, "end": 71241829}, {"filename": "/usr/local/share/emacs/30.2/lisp/jka-compr.elc", "start": 71241829, "end": 71253993}, {"filename": "/usr/local/share/emacs/30.2/lisp/json.el", "start": 71253993, "end": 71285356}, {"filename": "/usr/local/share/emacs/30.2/lisp/json.elc", "start": 71285356, "end": 71313604}, {"filename": "/usr/local/share/emacs/30.2/lisp/jsonrpc.el", "start": 71313604, "end": 71364674}, {"filename": "/usr/local/share/emacs/30.2/lisp/jsonrpc.elc", "start": 71364674, "end": 71412392}, {"filename": "/usr/local/share/emacs/30.2/lisp/kermit.el", "start": 71412392, "end": 71419025}, {"filename": "/usr/local/share/emacs/30.2/lisp/kermit.elc", "start": 71419025, "end": 71421745}, {"filename": "/usr/local/share/emacs/30.2/lisp/keymap.el", "start": 71421745, "end": 71452688}, {"filename": "/usr/local/share/emacs/30.2/lisp/keymap.elc", "start": 71452688, "end": 71478428}, {"filename": "/usr/local/share/emacs/30.2/lisp/kmacro.el", "start": 71478428, "end": 71554023}, {"filename": "/usr/local/share/emacs/30.2/lisp/kmacro.elc", "start": 71554023, "end": 71614347}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/burmese.el", "start": 71614347, "end": 71616776}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/burmese.elc", "start": 71616776, "end": 71617753}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/cham.el", "start": 71617753, "end": 71619373}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/cham.elc", "start": 71619373, "end": 71619982}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/china-util.el", "start": 71619982, "end": 71626712}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/china-util.elc", "start": 71626712, "end": 71630334}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/chinese.el", "start": 71630334, "end": 71640735}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/chinese.elc", "start": 71640735, "end": 71647753}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/cyril-util.el", "start": 71647753, "end": 71655454}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/cyril-util.elc", "start": 71655454, "end": 71660378}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/cyrillic.el", "start": 71660378, "end": 71669273}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/cyrillic.elc", "start": 71669273, "end": 71674508}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/czech.el", "start": 71674508, "end": 71676055}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/czech.elc", "start": 71676055, "end": 71676658}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/english.el", "start": 71676658, "end": 71679208}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/english.elc", "start": 71679208, "end": 71680111}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/ethio-util.el", "start": 71680111, "end": 71735234}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/ethio-util.elc", "start": 71735234, "end": 71794924}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/ethiopic.el", "start": 71794924, "end": 71798114}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/ethiopic.elc", "start": 71798114, "end": 71799514}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/european.el", "start": 71799514, "end": 71823743}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/european.elc", "start": 71823743, "end": 71842199}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/georgian.el", "start": 71842199, "end": 71843745}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/georgian.elc", "start": 71843745, "end": 71844392}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/greek.el", "start": 71844392, "end": 71847154}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/greek.elc", "start": 71847154, "end": 71848420}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/hanja-util.el", "start": 71848420, "end": 72368090}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/hanja-util.elc", "start": 72368090, "end": 72780863}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/hebrew.el", "start": 72780863, "end": 72790813}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/hebrew.elc", "start": 72790813, "end": 72795110}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/ind-util.el", "start": 72795110, "end": 72838212}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/ind-util.elc", "start": 72838212, "end": 72883173}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/indian.el", "start": 72883173, "end": 72917645}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/indian.elc", "start": 72917645, "end": 72933423}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/indonesian.el", "start": 72933423, "end": 72942600}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/indonesian.elc", "start": 72942600, "end": 72946034}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/japan-util.el", "start": 72946034, "end": 72959949}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/japan-util.elc", "start": 72959949, "end": 72970416}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/japanese.el", "start": 72970416, "end": 72980440}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/japanese.elc", "start": 72980440, "end": 72987093}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/khmer.el", "start": 72987093, "end": 72988556}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/khmer.elc", "start": 72988556, "end": 72989051}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/korea-util.el", "start": 72989051, "end": 72994307}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/korea-util.elc", "start": 72994307, "end": 72997782}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/korean.el", "start": 72997782, "end": 73001697}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/korean.elc", "start": 73001697, "end": 73003810}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/lao-util.el", "start": 73003810, "end": 73018606}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/lao-util.elc", "start": 73018606, "end": 73028857}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/lao.el", "start": 73028857, "end": 73031869}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/lao.elc", "start": 73031869, "end": 73033055}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/misc-lang.el", "start": 73033055, "end": 73047011}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/misc-lang.elc", "start": 73047011, "end": 73054093}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/philippine.el", "start": 73054093, "end": 73058023}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/philippine.elc", "start": 73058023, "end": 73059636}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/romanian.el", "start": 73059636, "end": 73061490}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/romanian.elc", "start": 73061490, "end": 73062377}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/sinhala.el", "start": 73062377, "end": 73064080}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/sinhala.elc", "start": 73064080, "end": 73064623}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/slovak.el", "start": 73064623, "end": 73066253}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/slovak.elc", "start": 73066253, "end": 73066865}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/tai-viet.el", "start": 73066865, "end": 73069234}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/tai-viet.elc", "start": 73069234, "end": 73070548}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/thai-util.el", "start": 73070548, "end": 73080034}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/thai-util.elc", "start": 73080034, "end": 73088078}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/thai-word.el", "start": 73088078, "end": 73311618}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/thai-word.elc", "start": 73311618, "end": 73514546}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/thai.el", "start": 73514546, "end": 73519403}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/thai.elc", "start": 73519403, "end": 73521950}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/tibet-util.el", "start": 73521950, "end": 73537078}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/tibet-util.elc", "start": 73537078, "end": 73544791}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/tibetan.el", "start": 73544791, "end": 73562955}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/tibetan.elc", "start": 73562955, "end": 73573876}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/tv-util.el", "start": 73573876, "end": 73578739}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/tv-util.elc", "start": 73578739, "end": 73581266}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/utf-8-lang.el", "start": 73581266, "end": 73583263}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/utf-8-lang.elc", "start": 73583263, "end": 73583667}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/viet-util.el", "start": 73583667, "end": 73592993}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/viet-util.elc", "start": 73592993, "end": 73597175}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/vietnamese.el", "start": 73597175, "end": 73600953}, {"filename": "/usr/local/share/emacs/30.2/lisp/language/vietnamese.elc", "start": 73600953, "end": 73602854}, {"filename": "/usr/local/share/emacs/30.2/lisp/ldefs-boot.el", "start": 73602854, "end": 75131217}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/arabic.el", "start": 75131217, "end": 75133359}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/arabic.elc", "start": 75133359, "end": 75135742}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/cham.el", "start": 75135742, "end": 75137846}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/cham.elc", "start": 75137846, "end": 75140652}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/compose.el", "start": 75140652, "end": 75184594}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/compose.elc", "start": 75184594, "end": 75304921}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/croatian.el", "start": 75304921, "end": 75308270}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/croatian.elc", "start": 75308270, "end": 75313529}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/cyril-jis.el", "start": 75313529, "end": 75316350}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/cyril-jis.elc", "start": 75316350, "end": 75319956}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/cyrillic.el", "start": 75319956, "end": 75354609}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/cyrillic.elc", "start": 75354609, "end": 75414933}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/czech.el", "start": 75414933, "end": 75422851}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/czech.elc", "start": 75422851, "end": 75439449}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/emoji.el", "start": 75439449, "end": 75521107}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/emoji.elc", "start": 75521107, "end": 75921244}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/ethiopic.el", "start": 75921244, "end": 75940102}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/ethiopic.elc", "start": 75940102, "end": 75979137}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/georgian.el", "start": 75979137, "end": 75982283}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/georgian.elc", "start": 75982283, "end": 75987313}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/greek.el", "start": 75987313, "end": 76011149}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/greek.elc", "start": 76011149, "end": 76064792}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hangul.el", "start": 76064792, "end": 76086906}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hangul.elc", "start": 76086906, "end": 76104214}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hanja-jis.el", "start": 76104214, "end": 76133413}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hanja-jis.elc", "start": 76133413, "end": 76357832}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hanja.el", "start": 76357832, "end": 76379608}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hanja.elc", "start": 76379608, "end": 76541510}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hanja3.el", "start": 76541510, "end": 76567909}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hanja3.elc", "start": 76567909, "end": 76776182}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hebrew.el", "start": 76776182, "end": 76797096}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/hebrew.elc", "start": 76797096, "end": 76825599}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/indian.el", "start": 76825599, "end": 76879476}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/indian.elc", "start": 76879476, "end": 76950366}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/indonesian.el", "start": 76950366, "end": 76958882}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/indonesian.elc", "start": 76958882, "end": 76977106}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/ipa-praat.el", "start": 76977106, "end": 76988254}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/ipa-praat.elc", "start": 76988254, "end": 76999767}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/ipa.el", "start": 76999767, "end": 77019650}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/ipa.elc", "start": 77019650, "end": 77035605}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/japanese.el", "start": 77035605, "end": 77057433}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/japanese.elc", "start": 77057433, "end": 77074095}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/lao.el", "start": 77074095, "end": 77080180}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/lao.elc", "start": 77080180, "end": 77083955}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/latin-alt.el", "start": 77083955, "end": 77116290}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/latin-alt.elc", "start": 77116290, "end": 77173411}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/latin-ltx.el", "start": 77173411, "end": 77194495}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/latin-ltx.elc", "start": 77194495, "end": 77295810}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/latin-post.el", "start": 77295810, "end": 77343370}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/latin-post.elc", "start": 77343370, "end": 77434113}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/latin-pre.el", "start": 77434113, "end": 77460859}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/latin-pre.elc", "start": 77460859, "end": 77510395}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/lrt.el", "start": 77510395, "end": 77513413}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/lrt.elc", "start": 77513413, "end": 77514831}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/misc-lang.el", "start": 77514831, "end": 77550964}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/misc-lang.elc", "start": 77550964, "end": 77615679}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/pakistan.el", "start": 77615679, "end": 77632096}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/pakistan.elc", "start": 77632096, "end": 77652671}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/persian.el", "start": 77652671, "end": 77671231}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/persian.elc", "start": 77671231, "end": 77681393}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/philippine.el", "start": 77681393, "end": 77684414}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/philippine.elc", "start": 77684414, "end": 77688507}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/programmer-dvorak.el", "start": 77688507, "end": 77691087}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/programmer-dvorak.elc", "start": 77691087, "end": 77694459}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/py-punct.el", "start": 77694459, "end": 77696989}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/py-punct.elc", "start": 77696989, "end": 77698349}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/pypunct-b5.el", "start": 77698349, "end": 77700178}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/pypunct-b5.elc", "start": 77700178, "end": 77701004}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/rfc1345.el", "start": 77701004, "end": 77728811}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/rfc1345.elc", "start": 77728811, "end": 77798799}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/sami.el", "start": 77798799, "end": 77809622}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/sami.elc", "start": 77809622, "end": 77833250}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/sgml-input.el", "start": 77833250, "end": 77882971}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/sgml-input.elc", "start": 77882971, "end": 77950072}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/sisheng.el", "start": 77950072, "end": 77957842}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/sisheng.elc", "start": 77957842, "end": 77962594}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/slovak.el", "start": 77962594, "end": 77970696}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/slovak.elc", "start": 77970696, "end": 77987177}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/symbol-ksc.el", "start": 77987177, "end": 77994265}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/symbol-ksc.elc", "start": 77994265, "end": 78025620}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/tamil-dvorak.el", "start": 78025620, "end": 78028630}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/tamil-dvorak.elc", "start": 78028630, "end": 78032275}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/thai.el", "start": 78032275, "end": 78036821}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/thai.elc", "start": 78036821, "end": 78043813}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/tibetan.el", "start": 78043813, "end": 78059762}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/tibetan.elc", "start": 78059762, "end": 78069412}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/uni-input.el", "start": 78069412, "end": 78073682}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/uni-input.elc", "start": 78073682, "end": 78076491}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/viqr.el", "start": 78076491, "end": 78078824}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/viqr.elc", "start": 78078824, "end": 78084866}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/vntelex.el", "start": 78084866, "end": 78098186}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/vntelex.elc", "start": 78098186, "end": 78110605}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/vnvni.el", "start": 78110605, "end": 78122077}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/vnvni.elc", "start": 78122077, "end": 78130397}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/welsh.el", "start": 78130397, "end": 78133775}, {"filename": "/usr/local/share/emacs/30.2/lisp/leim/quail/welsh.elc", "start": 78133775, "end": 78136646}, {"filename": "/usr/local/share/emacs/30.2/lisp/loaddefs.el", "start": 78136646, "end": 79664987}, {"filename": "/usr/local/share/emacs/30.2/lisp/loaddefs.elc", "start": 79664987, "end": 81161107}, {"filename": "/usr/local/share/emacs/30.2/lisp/loadhist.el", "start": 81161107, "end": 81175159}, {"filename": "/usr/local/share/emacs/30.2/lisp/loadhist.elc", "start": 81175159, "end": 81184945}, {"filename": "/usr/local/share/emacs/30.2/lisp/loadup.el", "start": 81184945, "end": 81214918}, {"filename": "/usr/local/share/emacs/30.2/lisp/locate.el", "start": 81214918, "end": 81241033}, {"filename": "/usr/local/share/emacs/30.2/lisp/locate.elc", "start": 81241033, "end": 81260786}, {"filename": "/usr/local/share/emacs/30.2/lisp/lpr.el", "start": 81260786, "end": 81273751}, {"filename": "/usr/local/share/emacs/30.2/lisp/lpr.elc", "start": 81273751, "end": 81283497}, {"filename": "/usr/local/share/emacs/30.2/lisp/ls-lisp.el", "start": 81283497, "end": 81322180}, {"filename": "/usr/local/share/emacs/30.2/lisp/ls-lisp.elc", "start": 81322180, "end": 81346245}, {"filename": "/usr/local/share/emacs/30.2/lisp/macros.el", "start": 81346245, "end": 81355058}, {"filename": "/usr/local/share/emacs/30.2/lisp/macros.elc", "start": 81355058, "end": 81361139}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/binhex.el", "start": 81361139, "end": 81373015}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/binhex.elc", "start": 81373015, "end": 81381282}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/blessmail.el", "start": 81381282, "end": 81383861}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/emacsbug.el", "start": 81383861, "end": 81407799}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/emacsbug.elc", "start": 81407799, "end": 81424893}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/feedmail.el", "start": 81424893, "end": 81562045}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/feedmail.elc", "start": 81562045, "end": 81661035}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/flow-fill.el", "start": 81661035, "end": 81667793}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/flow-fill.elc", "start": 81667793, "end": 81670915}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/footnote.el", "start": 81670915, "end": 81705873}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/footnote.elc", "start": 81705873, "end": 81733761}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/hashcash.el", "start": 81733761, "end": 81747408}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/hashcash.elc", "start": 81747408, "end": 81758194}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/ietf-drums-date.el", "start": 81758194, "end": 81770220}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/ietf-drums-date.elc", "start": 81770220, "end": 81776368}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/ietf-drums.el", "start": 81776368, "end": 81787576}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/ietf-drums.elc", "start": 81787576, "end": 81796914}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-extr.el", "start": 81796914, "end": 81875276}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-extr.elc", "start": 81875276, "end": 81910218}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-hist.el", "start": 81910218, "end": 81921131}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-hist.elc", "start": 81921131, "end": 81935422}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-parse.el", "start": 81935422, "end": 81940422}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-parse.elc", "start": 81940422, "end": 81943716}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-prsvr.el", "start": 81943716, "end": 81945313}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-prsvr.elc", "start": 81945313, "end": 81946096}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-utils.el", "start": 81946096, "end": 81961163}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mail-utils.elc", "start": 81961163, "end": 81970563}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mailabbrev.el", "start": 81970563, "end": 81995587}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mailabbrev.elc", "start": 81995587, "end": 82010911}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mailalias.el", "start": 82010911, "end": 82032362}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mailalias.elc", "start": 82032362, "end": 82045840}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mailclient.el", "start": 82045840, "end": 82053641}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mailclient.elc", "start": 82053641, "end": 82057604}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mailheader.el", "start": 82057604, "end": 82065748}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mailheader.elc", "start": 82065748, "end": 82070809}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mspools.el", "start": 82070809, "end": 82084413}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/mspools.elc", "start": 82084413, "end": 82093157}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/qp.el", "start": 82093157, "end": 82099777}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/qp.elc", "start": 82099777, "end": 82103661}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/reporter.el", "start": 82103661, "end": 82118360}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/reporter.elc", "start": 82118360, "end": 82127098}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc2045.el", "start": 82127098, "end": 82128598}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc2045.elc", "start": 82128598, "end": 82129092}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc2047.el", "start": 82129092, "end": 82170908}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc2047.elc", "start": 82170908, "end": 82195762}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc2231.el", "start": 82195762, "end": 82205835}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc2231.elc", "start": 82205835, "end": 82212035}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc6068.el", "start": 82212035, "end": 82215081}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc6068.elc", "start": 82215081, "end": 82216958}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc822.el", "start": 82216958, "end": 82227857}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rfc822.elc", "start": 82227857, "end": 82233173}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmail-spam-filter.el", "start": 82233173, "end": 82256949}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmail-spam-filter.elc", "start": 82256949, "end": 82269627}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmail.el", "start": 82269627, "end": 82458705}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmail.elc", "start": 82458705, "end": 82590298}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailedit.el", "start": 82590298, "end": 82610264}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailedit.elc", "start": 82610264, "end": 82619652}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailkwd.el", "start": 82619652, "end": 82626753}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailkwd.elc", "start": 82626753, "end": 82631466}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailmm.el", "start": 82631466, "end": 82694365}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailmm.elc", "start": 82694365, "end": 82755642}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailmsc.el", "start": 82755642, "end": 82757652}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailmsc.elc", "start": 82757652, "end": 82758711}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailout.el", "start": 82758711, "end": 82785496}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailout.elc", "start": 82785496, "end": 82803128}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailsort.el", "start": 82803128, "end": 82812170}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailsort.elc", "start": 82812170, "end": 82818150}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailsum.el", "start": 82818150, "end": 82898142}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/rmailsum.elc", "start": 82898142, "end": 82960593}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/sendmail.el", "start": 82960593, "end": 83039004}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/sendmail.elc", "start": 83039004, "end": 83094707}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/smtpmail.el", "start": 83094707, "end": 83137082}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/smtpmail.elc", "start": 83137082, "end": 83164356}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/supercite.el", "start": 83164356, "end": 83232362}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/supercite.elc", "start": 83232362, "end": 83291732}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/undigest.el", "start": 83291732, "end": 83305690}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/undigest.elc", "start": 83305690, "end": 83314414}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/unrmail.el", "start": 83314414, "end": 83323915}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/unrmail.elc", "start": 83323915, "end": 83328916}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/uudecode.el", "start": 83328916, "end": 83335442}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/uudecode.elc", "start": 83335442, "end": 83340250}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/yenc.el", "start": 83340250, "end": 83345394}, {"filename": "/usr/local/share/emacs/30.2/lisp/mail/yenc.elc", "start": 83345394, "end": 83348644}, {"filename": "/usr/local/share/emacs/30.2/lisp/man.el", "start": 83348644, "end": 83431072}, {"filename": "/usr/local/share/emacs/30.2/lisp/man.elc", "start": 83431072, "end": 83493393}, {"filename": "/usr/local/share/emacs/30.2/lisp/master.el", "start": 83493393, "end": 83498218}, {"filename": "/usr/local/share/emacs/30.2/lisp/master.elc", "start": 83498218, "end": 83503078}, {"filename": "/usr/local/share/emacs/30.2/lisp/mb-depth.el", "start": 83503078, "end": 83506545}, {"filename": "/usr/local/share/emacs/30.2/lisp/mb-depth.elc", "start": 83506545, "end": 83511047}, {"filename": "/usr/local/share/emacs/30.2/lisp/md4.el", "start": 83511047, "end": 83519952}, {"filename": "/usr/local/share/emacs/30.2/lisp/md4.elc", "start": 83519952, "end": 83528334}, {"filename": "/usr/local/share/emacs/30.2/lisp/menu-bar.el", "start": 83528334, "end": 83659021}, {"filename": "/usr/local/share/emacs/30.2/lisp/menu-bar.elc", "start": 83659021, "end": 83761477}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/ChangeLog.1", "start": 83761477, "end": 84205571}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/ChangeLog.2", "start": 84205571, "end": 84351345}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-acros.el", "start": 84351345, "end": 84360227}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-acros.elc", "start": 84360227, "end": 84366472}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-alias.el", "start": 84366472, "end": 84393783}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-alias.elc", "start": 84393783, "end": 84411337}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-buffers.el", "start": 84411337, "end": 84414452}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-buffers.elc", "start": 84414452, "end": 84415754}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-comp.el", "start": 84415754, "end": 84468084}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-comp.elc", "start": 84468084, "end": 84505127}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-e.el", "start": 84505127, "end": 84648621}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-e.elc", "start": 84648621, "end": 84770214}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-folder.el", "start": 84770214, "end": 84851451}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-folder.elc", "start": 84851451, "end": 84915209}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-funcs.el", "start": 84915209, "end": 84930389}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-funcs.elc", "start": 84930389, "end": 84942539}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-gnus.el", "start": 84942539, "end": 84946370}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-gnus.elc", "start": 84946370, "end": 84948846}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-identity.el", "start": 84948846, "end": 84960603}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-identity.elc", "start": 84960603, "end": 84968775}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-inc.el", "start": 84968775, "end": 84971676}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-inc.elc", "start": 84971676, "end": 84973222}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-junk.el", "start": 84973222, "end": 84993995}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-junk.elc", "start": 84993995, "end": 85012743}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-letter.el", "start": 85012743, "end": 85050555}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-letter.elc", "start": 85050555, "end": 85078535}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-limit.el", "start": 85078535, "end": 85090998}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-limit.elc", "start": 85090998, "end": 85100880}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-loaddefs.el", "start": 85100880, "end": 85195196}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-loaddefs.elc", "start": 85195196, "end": 85292648}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-mime.el", "start": 85292648, "end": 85366242}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-mime.elc", "start": 85366242, "end": 85424349}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-print.el", "start": 85424349, "end": 85433568}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-print.elc", "start": 85433568, "end": 85441527}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-scan.el", "start": 85441527, "end": 85461478}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-scan.elc", "start": 85461478, "end": 85479798}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-search.el", "start": 85479798, "end": 85557591}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-search.elc", "start": 85557591, "end": 85615389}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-seq.el", "start": 85615389, "end": 85655930}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-seq.elc", "start": 85655930, "end": 85691410}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-show.el", "start": 85691410, "end": 85727749}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-show.elc", "start": 85727749, "end": 85832768}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-speed.el", "start": 85832768, "end": 85856491}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-speed.elc", "start": 85856491, "end": 85871638}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-thread.el", "start": 85871638, "end": 85908791}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-thread.elc", "start": 85908791, "end": 85970304}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-tool-bar.el", "start": 85970304, "end": 85987753}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-tool-bar.elc", "start": 85987753, "end": 86010334}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-utils.el", "start": 86010334, "end": 86050561}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-utils.elc", "start": 86050561, "end": 86077998}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-xface.el", "start": 86077998, "end": 86095032}, {"filename": "/usr/local/share/emacs/30.2/lisp/mh-e/mh-xface.elc", "start": 86095032, "end": 86107400}, {"filename": "/usr/local/share/emacs/30.2/lisp/midnight.el", "start": 86107400, "end": 86117429}, {"filename": "/usr/local/share/emacs/30.2/lisp/midnight.elc", "start": 86117429, "end": 86128293}, {"filename": "/usr/local/share/emacs/30.2/lisp/minibuf-eldef.el", "start": 86128293, "end": 86136773}, {"filename": "/usr/local/share/emacs/30.2/lisp/minibuf-eldef.elc", "start": 86136773, "end": 86143840}, {"filename": "/usr/local/share/emacs/30.2/lisp/minibuffer.el", "start": 86143840, "end": 86391114}, {"filename": "/usr/local/share/emacs/30.2/lisp/minibuffer.elc", "start": 86391114, "end": 86549651}, {"filename": "/usr/local/share/emacs/30.2/lisp/misc.el", "start": 86549651, "end": 86562091}, {"filename": "/usr/local/share/emacs/30.2/lisp/misc.elc", "start": 86562091, "end": 86570872}, {"filename": "/usr/local/share/emacs/30.2/lisp/misearch.el", "start": 86570872, "end": 86594115}, {"filename": "/usr/local/share/emacs/30.2/lisp/misearch.elc", "start": 86594115, "end": 86611497}, {"filename": "/usr/local/share/emacs/30.2/lisp/mouse-copy.el", "start": 86611497, "end": 86620114}, {"filename": "/usr/local/share/emacs/30.2/lisp/mouse-copy.elc", "start": 86620114, "end": 86623208}, {"filename": "/usr/local/share/emacs/30.2/lisp/mouse-drag.el", "start": 86623208, "end": 86636215}, {"filename": "/usr/local/share/emacs/30.2/lisp/mouse-drag.elc", "start": 86636215, "end": 86642503}, {"filename": "/usr/local/share/emacs/30.2/lisp/mouse.el", "start": 86642503, "end": 86807056}, {"filename": "/usr/local/share/emacs/30.2/lisp/mouse.elc", "start": 86807056, "end": 86903321}, {"filename": "/usr/local/share/emacs/30.2/lisp/mpc.el", "start": 86903321, "end": 87023059}, {"filename": "/usr/local/share/emacs/30.2/lisp/mpc.elc", "start": 87023059, "end": 87102881}, {"filename": "/usr/local/share/emacs/30.2/lisp/msb.el", "start": 87102881, "end": 87141680}, {"filename": "/usr/local/share/emacs/30.2/lisp/msb.elc", "start": 87141680, "end": 87169462}, {"filename": "/usr/local/share/emacs/30.2/lisp/mwheel.el", "start": 87169462, "end": 87190841}, {"filename": "/usr/local/share/emacs/30.2/lisp/mwheel.elc", "start": 87190841, "end": 87208358}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/ange-ftp.el", "start": 87208358, "end": 87454179}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/ange-ftp.elc", "start": 87454179, "end": 87580598}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/browse-url.el", "start": 87580598, "end": 87652692}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/browse-url.elc", "start": 87652692, "end": 87713291}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dbus.el", "start": 87713291, "end": 87801906}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dbus.elc", "start": 87801906, "end": 87874868}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dictionary-connection.el", "start": 87874868, "end": 87881221}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dictionary-connection.elc", "start": 87881221, "end": 87887181}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dictionary.el", "start": 87887181, "end": 87950166}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dictionary.elc", "start": 87950166, "end": 88004990}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dig.el", "start": 88004990, "end": 88011477}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dig.elc", "start": 88011477, "end": 88018403}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dns.el", "start": 88018403, "end": 88036525}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/dns.elc", "start": 88036525, "end": 88048760}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-bob.el", "start": 88048760, "end": 88057990}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-bob.elc", "start": 88057990, "end": 88065622}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-capf.el", "start": 88065622, "end": 88071384}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-capf.elc", "start": 88071384, "end": 88073278}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-export.el", "start": 88073278, "end": 88081996}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-export.elc", "start": 88081996, "end": 88087258}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-hotlist.el", "start": 88087258, "end": 88093462}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-hotlist.elc", "start": 88093462, "end": 88099957}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-vars.el", "start": 88099957, "end": 88118875}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc-vars.elc", "start": 88118875, "end": 88137651}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc.el", "start": 88137651, "end": 88187801}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudc.elc", "start": 88187801, "end": 88226161}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-bbdb.el", "start": 88226161, "end": 88236777}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-bbdb.elc", "start": 88236777, "end": 88242685}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-ecomplete.el", "start": 88242685, "end": 88246589}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-ecomplete.elc", "start": 88246589, "end": 88248369}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-ldap.el", "start": 88248369, "end": 88256172}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-ldap.elc", "start": 88256172, "end": 88261386}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-mab.el", "start": 88261386, "end": 88265453}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-mab.elc", "start": 88265453, "end": 88267613}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-macos-contacts.el", "start": 88267613, "end": 88277427}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-macos-contacts.elc", "start": 88277427, "end": 88283917}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-mailabbrev.el", "start": 88283917, "end": 88289002}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eudcb-mailabbrev.elc", "start": 88289002, "end": 88290896}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eww.el", "start": 88290896, "end": 88397980}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/eww.elc", "start": 88397980, "end": 88490432}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/gnutls.el", "start": 88490432, "end": 88507183}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/gnutls.elc", "start": 88507183, "end": 88519924}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/goto-addr.el", "start": 88519924, "end": 88531893}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/goto-addr.elc", "start": 88531893, "end": 88547704}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/hmac-def.el", "start": 88547704, "end": 88550679}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/hmac-def.elc", "start": 88550679, "end": 88552374}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/hmac-md5.el", "start": 88552374, "end": 88554110}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/hmac-md5.elc", "start": 88554110, "end": 88556036}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/imap.el", "start": 88556036, "end": 88661052}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/imap.elc", "start": 88661052, "end": 88763610}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/ldap.el", "start": 88763610, "end": 88792379}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/ldap.elc", "start": 88792379, "end": 88810483}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/mailcap.el", "start": 88810483, "end": 88854777}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/mailcap.elc", "start": 88854777, "end": 88885873}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/mairix.el", "start": 88885873, "end": 88917728}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/mairix.elc", "start": 88917728, "end": 88943536}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/net-utils.el", "start": 88943536, "end": 88977363}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/net-utils.elc", "start": 88977363, "end": 89014503}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/network-stream.el", "start": 89014503, "end": 89036006}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/network-stream.elc", "start": 89036006, "end": 89048934}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-backend.el", "start": 89048934, "end": 89153680}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-backend.elc", "start": 89153680, "end": 89220449}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-plainview.el", "start": 89220449, "end": 89290433}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-plainview.elc", "start": 89290433, "end": 89338730}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-reader.el", "start": 89338730, "end": 89353145}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-reader.elc", "start": 89353145, "end": 89362874}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-ticker.el", "start": 89362874, "end": 89376893}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-ticker.elc", "start": 89376893, "end": 89385982}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-treeview.el", "start": 89385982, "end": 89478997}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newst-treeview.elc", "start": 89478997, "end": 89556416}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newsticker.el", "start": 89556416, "end": 89573774}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/newsticker.elc", "start": 89573774, "end": 89574217}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/nsm.el", "start": 89574217, "end": 89617866}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/nsm.elc", "start": 89617866, "end": 89652755}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/ntlm.el", "start": 89652755, "end": 89680067}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/ntlm.elc", "start": 89680067, "end": 89696556}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/pop3.el", "start": 89696556, "end": 89725827}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/pop3.elc", "start": 89725827, "end": 89746025}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/puny.el", "start": 89746025, "end": 89755617}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/puny.elc", "start": 89755617, "end": 89760445}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/rcirc.el", "start": 89760445, "end": 89929348}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/rcirc.elc", "start": 89929348, "end": 90082613}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/rfc2104.el", "start": 90082613, "end": 90086425}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/rfc2104.elc", "start": 90086425, "end": 90087303}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-cram.el", "start": 90087303, "end": 90088884}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-cram.elc", "start": 90088884, "end": 90089573}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-digest.el", "start": 90089573, "end": 90094351}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-digest.elc", "start": 90094351, "end": 90097390}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-ntlm.el", "start": 90097390, "end": 90099767}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-ntlm.elc", "start": 90099767, "end": 90101049}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-scram-rfc.el", "start": 90101049, "end": 90107971}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-scram-rfc.elc", "start": 90107971, "end": 90111618}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-scram-sha256.el", "start": 90111618, "end": 90113527}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl-scram-sha256.elc", "start": 90113527, "end": 90114533}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl.el", "start": 90114533, "end": 90122793}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sasl.elc", "start": 90122793, "end": 90129114}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/secrets.el", "start": 90129114, "end": 90164626}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/secrets.elc", "start": 90164626, "end": 90188391}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/shr-color.el", "start": 90188391, "end": 90201585}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/shr-color.elc", "start": 90201585, "end": 90210277}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/shr.el", "start": 90210277, "end": 90310589}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/shr.elc", "start": 90310589, "end": 90384374}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sieve-manage.el", "start": 90384374, "end": 90407366}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sieve-manage.elc", "start": 90407366, "end": 90424352}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sieve-mode.el", "start": 90424352, "end": 90430536}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sieve-mode.elc", "start": 90430536, "end": 90436409}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sieve.el", "start": 90436409, "end": 90449264}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/sieve.elc", "start": 90449264, "end": 90460714}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/snmp-mode.el", "start": 90460714, "end": 90482689}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/snmp-mode.elc", "start": 90482689, "end": 90497196}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/soap-client.el", "start": 90497196, "end": 90639506}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/soap-client.elc", "start": 90639506, "end": 90873357}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/soap-inspect.el", "start": 90873357, "end": 90894216}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/soap-inspect.elc", "start": 90894216, "end": 90914289}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/socks.el", "start": 90914289, "end": 90937563}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/socks.elc", "start": 90937563, "end": 90950181}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/telnet.el", "start": 90950181, "end": 90961107}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/telnet.elc", "start": 90961107, "end": 90970478}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-adb.el", "start": 90970478, "end": 91021199}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-adb.elc", "start": 91021199, "end": 91105008}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-androidsu.el", "start": 91105008, "end": 91129492}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-androidsu.elc", "start": 91129492, "end": 91153616}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-archive.el", "start": 91153616, "end": 91185732}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-archive.elc", "start": 91185732, "end": 91212446}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-cache.el", "start": 91212446, "end": 91240080}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-cache.elc", "start": 91240080, "end": 91262707}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-cmds.el", "start": 91262707, "end": 91295103}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-cmds.elc", "start": 91295103, "end": 91322601}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-compat.el", "start": 91322601, "end": 91337634}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-compat.elc", "start": 91337634, "end": 91348931}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-container.el", "start": 91348931, "end": 91374679}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-container.elc", "start": 91374679, "end": 91398335}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-crypt.el", "start": 91398335, "end": 91435539}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-crypt.elc", "start": 91435539, "end": 91485185}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-ftp.el", "start": 91485185, "end": 91493388}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-ftp.elc", "start": 91493388, "end": 91497742}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-fuse.el", "start": 91497742, "end": 91507773}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-fuse.elc", "start": 91507773, "end": 91524806}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-gvfs.el", "start": 91524806, "end": 91629574}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-gvfs.elc", "start": 91629574, "end": 91743768}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-integration.el", "start": 91743768, "end": 91762899}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-integration.elc", "start": 91762899, "end": 91776148}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-loaddefs.el", "start": 91776148, "end": 91885303}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-loaddefs.elc", "start": 91885303, "end": 92005695}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-message.el", "start": 92005695, "end": 92028272}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-message.elc", "start": 92028272, "end": 92046421}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-rclone.el", "start": 92046421, "end": 92065154}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-rclone.elc", "start": 92065154, "end": 92087154}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-sh.el", "start": 92087154, "end": 92335320}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-sh.elc", "start": 92335320, "end": 92575823}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-smb.el", "start": 92575823, "end": 92652882}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-smb.elc", "start": 92652882, "end": 92753273}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-sshfs.el", "start": 92753273, "end": 92770037}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-sshfs.elc", "start": 92770037, "end": 92796715}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-sudoedit.el", "start": 92796715, "end": 92832815}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-sudoedit.elc", "start": 92832815, "end": 92893773}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-uu.el", "start": 92893773, "end": 92896892}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp-uu.elc", "start": 92896892, "end": 92898485}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp.el", "start": 92898485, "end": 93185663}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/tramp.elc", "start": 93185663, "end": 93470679}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/trampver.el", "start": 93470679, "end": 93475048}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/trampver.elc", "start": 93475048, "end": 93477508}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/webjump.el", "start": 93477508, "end": 93493651}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/webjump.elc", "start": 93493651, "end": 93504038}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/zeroconf.el", "start": 93504038, "end": 93529360}, {"filename": "/usr/local/share/emacs/30.2/lisp/net/zeroconf.elc", "start": 93529360, "end": 93547499}, {"filename": "/usr/local/share/emacs/30.2/lisp/newcomment.el", "start": 93547499, "end": 93613216}, {"filename": "/usr/local/share/emacs/30.2/lisp/newcomment.elc", "start": 93613216, "end": 93653410}, {"filename": "/usr/local/share/emacs/30.2/lisp/notifications.el", "start": 93653410, "end": 93670903}, {"filename": "/usr/local/share/emacs/30.2/lisp/notifications.elc", "start": 93670903, "end": 93684017}, {"filename": "/usr/local/share/emacs/30.2/lisp/novice.el", "start": 93684017, "end": 93690936}, {"filename": "/usr/local/share/emacs/30.2/lisp/novice.elc", "start": 93690936, "end": 93694539}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-enc.el", "start": 93694539, "end": 93700218}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-enc.elc", "start": 93700218, "end": 93703213}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-maint.el", "start": 93703213, "end": 93705378}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-maint.elc", "start": 93705378, "end": 93706228}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-mode.el", "start": 93706228, "end": 93789500}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-mode.elc", "start": 93789500, "end": 93855099}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-ns.el", "start": 93855099, "end": 93859856}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-ns.elc", "start": 93859856, "end": 93863825}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-outln.el", "start": 93863825, "end": 93900082}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-outln.elc", "start": 93900082, "end": 93926890}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-parse.el", "start": 93926890, "end": 93938648}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-parse.elc", "start": 93938648, "end": 93947096}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-rap.el", "start": 93947096, "end": 93958285}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-rap.elc", "start": 93958285, "end": 93964735}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-util.el", "start": 93964735, "end": 93967685}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/nxml-util.elc", "start": 93967685, "end": 93969947}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-cmpct.el", "start": 93969947, "end": 93998847}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-cmpct.elc", "start": 93998847, "end": 94024090}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-dt.el", "start": 94024090, "end": 94026266}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-dt.elc", "start": 94026266, "end": 94027802}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-loc.el", "start": 94027802, "end": 94046048}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-loc.elc", "start": 94046048, "end": 94059718}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-maint.el", "start": 94059718, "end": 94068449}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-maint.elc", "start": 94068449, "end": 94073657}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-match.el", "start": 94073657, "end": 94127284}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-match.elc", "start": 94127284, "end": 94178081}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-nxml.el", "start": 94178081, "end": 94197751}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-nxml.elc", "start": 94197751, "end": 94211356}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-parse.el", "start": 94211356, "end": 94214974}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-parse.elc", "start": 94214974, "end": 94217307}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-pttrn.el", "start": 94217307, "end": 94222228}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-pttrn.elc", "start": 94222228, "end": 94225597}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-uri.el", "start": 94225597, "end": 94236538}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-uri.elc", "start": 94236538, "end": 94243994}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-util.el", "start": 94243994, "end": 94246181}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-util.elc", "start": 94246181, "end": 94247563}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-valid.el", "start": 94247563, "end": 94296301}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-valid.elc", "start": 94296301, "end": 94332071}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-xsd.el", "start": 94332071, "end": 94361052}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/rng-xsd.elc", "start": 94361052, "end": 94382934}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/xmltok.el", "start": 94382934, "end": 94442812}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/xmltok.elc", "start": 94442812, "end": 94479120}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/xsd-regexp.el", "start": 94479120, "end": 94533993}, {"filename": "/usr/local/share/emacs/30.2/lisp/nxml/xsd-regexp.elc", "start": 94533993, "end": 94574053}, {"filename": "/usr/local/share/emacs/30.2/lisp/obarray.el", "start": 94574053, "end": 94575944}, {"filename": "/usr/local/share/emacs/30.2/lisp/obarray.elc", "start": 94575944, "end": 94577018}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/autoarg.el", "start": 94577018, "end": 94582486}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/autoarg.elc", "start": 94582486, "end": 94590199}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/autoload.el", "start": 94590199, "end": 94632158}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/autoload.elc", "start": 94632158, "end": 94652700}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/bruce.el", "start": 94652700, "end": 94658789}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/bruce.elc", "start": 94658789, "end": 94660088}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/cc-compat.el", "start": 94660088, "end": 94665832}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/cc-compat.elc", "start": 94665832, "end": 94668219}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/cl-compat.el", "start": 94668219, "end": 94673926}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/cl-compat.elc", "start": 94673926, "end": 94677938}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/cl.el", "start": 94677938, "end": 94705138}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/cl.elc", "start": 94705138, "end": 94720264}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/crisp.el", "start": 94720264, "end": 94734430}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/crisp.elc", "start": 94734430, "end": 94745712}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/eieio-compat.el", "start": 94745712, "end": 94757029}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/eieio-compat.elc", "start": 94757029, "end": 94764759}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/eudcb-ph.el", "start": 94764759, "end": 94772929}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/eudcb-ph.elc", "start": 94772929, "end": 94778603}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/gs.el", "start": 94778603, "end": 94787155}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/gs.elc", "start": 94787155, "end": 94790502}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/gulp.el", "start": 94790502, "end": 94796710}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/gulp.elc", "start": 94796710, "end": 94801340}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/html2text.el", "start": 94801340, "end": 94815372}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/html2text.elc", "start": 94815372, "end": 94824583}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/info-edit.el", "start": 94824583, "end": 94827638}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/info-edit.elc", "start": 94827638, "end": 94831680}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/inversion.el", "start": 94831680, "end": 94850675}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/inversion.elc", "start": 94850675, "end": 94863101}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/iswitchb.el", "start": 94863101, "end": 94910931}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/iswitchb.elc", "start": 94910931, "end": 94942777}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/landmark.el", "start": 94942777, "end": 95002770}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/landmark.elc", "start": 95002770, "end": 95043983}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/linum.el", "start": 95043983, "end": 95054273}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/linum.elc", "start": 95054273, "end": 95065459}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/longlines.el", "start": 95065459, "end": 95085216}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/longlines.elc", "start": 95085216, "end": 95101424}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/makesum.el", "start": 95101424, "end": 95105075}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/makesum.elc", "start": 95105075, "end": 95107063}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/mantemp.el", "start": 95107063, "end": 95115026}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/mantemp.elc", "start": 95115026, "end": 95118347}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/meese.el", "start": 95118347, "end": 95119609}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/meese.elc", "start": 95119609, "end": 95120110}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/messcompat.el", "start": 95120110, "end": 95121910}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/metamail.el", "start": 95121910, "end": 95129549}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/metamail.elc", "start": 95129549, "end": 95133608}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/mh-compat.el", "start": 95133608, "end": 95138327}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/mh-compat.elc", "start": 95138327, "end": 95141630}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/netrc.el", "start": 95141630, "end": 95149381}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/netrc.elc", "start": 95149381, "end": 95154217}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/nnir.el", "start": 95154217, "end": 95203742}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/nnir.elc", "start": 95203742, "end": 95242059}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/otodo-mode.el", "start": 95242059, "end": 95278241}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/otodo-mode.elc", "start": 95278241, "end": 95302677}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-def.el", "start": 95302677, "end": 95305335}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-def.elc", "start": 95305335, "end": 95307714}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-gpg.el", "start": 95307714, "end": 95323170}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-gpg.elc", "start": 95323170, "end": 95335555}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-parse.el", "start": 95335555, "end": 95351743}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-parse.elc", "start": 95351743, "end": 95364597}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-pgp.el", "start": 95364597, "end": 95373774}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-pgp.elc", "start": 95373774, "end": 95381056}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-pgp5.el", "start": 95381056, "end": 95389705}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg-pgp5.elc", "start": 95389705, "end": 95397026}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg.el", "start": 95397026, "end": 95414719}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/pgg.elc", "start": 95414719, "end": 95433255}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/ps-def.el", "start": 95433255, "end": 95435008}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/ps-def.elc", "start": 95435008, "end": 95435854}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/quickurl.el", "start": 95435854, "end": 95454460}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/quickurl.elc", "start": 95454460, "end": 95472488}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/rcompile.el", "start": 95472488, "end": 95479660}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/rcompile.elc", "start": 95479660, "end": 95482504}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/rfc2368.el", "start": 95482504, "end": 95486928}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/rfc2368.elc", "start": 95486928, "end": 95488919}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/rlogin.el", "start": 95488919, "end": 95500392}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/rlogin.elc", "start": 95500392, "end": 95511330}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/sb-image.el", "start": 95511330, "end": 95512891}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/sb-image.elc", "start": 95512891, "end": 95513104}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/starttls.el", "start": 95513104, "end": 95524224}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/starttls.elc", "start": 95524224, "end": 95530294}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/sup-mouse.el", "start": 95530294, "end": 95536164}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/sup-mouse.elc", "start": 95536164, "end": 95539915}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/terminal.el", "start": 95539915, "end": 95586119}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/terminal.elc", "start": 95586119, "end": 95616771}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/thumbs.el", "start": 95616771, "end": 95642168}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/thumbs.elc", "start": 95642168, "end": 95667988}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/tls.el", "start": 95667988, "end": 95678617}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/tls.elc", "start": 95678617, "end": 95685821}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/tpu-edt.el", "start": 95685821, "end": 95772750}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/tpu-edt.elc", "start": 95772750, "end": 95833311}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/tpu-extras.el", "start": 95833311, "end": 95848673}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/tpu-extras.elc", "start": 95848673, "end": 95860077}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/tpu-mapper.el", "start": 95860077, "end": 95872980}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/tpu-mapper.elc", "start": 95872980, "end": 95883210}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/uce.el", "start": 95883210, "end": 95899070}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/uce.elc", "start": 95899070, "end": 95907508}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/url-about.el", "start": 95907508, "end": 95910962}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/url-about.elc", "start": 95910962, "end": 95913471}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/url-dired.el", "start": 95913471, "end": 95915296}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/url-dired.elc", "start": 95915296, "end": 95918226}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/url-ns.el", "start": 95918226, "end": 95921695}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/url-ns.elc", "start": 95921695, "end": 95923659}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vc-arch.el", "start": 95923659, "end": 95948296}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vc-arch.elc", "start": 95948296, "end": 95965349}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vc-mtn.el", "start": 95965349, "end": 95979172}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vc-mtn.elc", "start": 95979172, "end": 95992636}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vi.el", "start": 95992636, "end": 96051312}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vi.elc", "start": 96051312, "end": 96099555}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vip.el", "start": 96099555, "end": 96195514}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vip.elc", "start": 96195514, "end": 96272365}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vt-control.el", "start": 96272365, "end": 96275655}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vt-control.elc", "start": 96275655, "end": 96277236}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vt100-led.el", "start": 96277236, "end": 96279243}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/vt100-led.elc", "start": 96279243, "end": 96280296}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/ws-mode.el", "start": 96280296, "end": 96298711}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/ws-mode.elc", "start": 96298711, "end": 96322909}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/yow.el", "start": 96322909, "end": 96325802}, {"filename": "/usr/local/share/emacs/30.2/lisp/obsolete/yow.elc", "start": 96325802, "end": 96327863}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ChangeLog.1", "start": 96327863, "end": 97482377}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-C.el", "start": 97482377, "end": 97500061}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-C.elc", "start": 97500061, "end": 97516055}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-R.el", "start": 97516055, "end": 97536224}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-R.elc", "start": 97536224, "end": 97556703}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-awk.el", "start": 97556703, "end": 97561047}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-awk.elc", "start": 97561047, "end": 97565836}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-calc.el", "start": 97565836, "end": 97570630}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-calc.elc", "start": 97570630, "end": 97574683}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-clojure.el", "start": 97574683, "end": 97588619}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-clojure.elc", "start": 97588619, "end": 97600953}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-comint.el", "start": 97600953, "end": 97616982}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-comint.elc", "start": 97616982, "end": 97631246}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-core.el", "start": 97631246, "end": 97776947}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-core.elc", "start": 97776947, "end": 97900046}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-css.el", "start": 97900046, "end": 97901565}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-css.elc", "start": 97901565, "end": 97903843}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-ditaa.el", "start": 97903843, "end": 97908025}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-ditaa.elc", "start": 97908025, "end": 97912604}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-dot.el", "start": 97912604, "end": 97915916}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-dot.elc", "start": 97915916, "end": 97919443}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-emacs-lisp.el", "start": 97919443, "end": 97924225}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-emacs-lisp.elc", "start": 97924225, "end": 97929267}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-eshell.el", "start": 97929267, "end": 97933307}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-eshell.elc", "start": 97933307, "end": 97937732}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-eval.el", "start": 97937732, "end": 97944643}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-eval.elc", "start": 97944643, "end": 97950440}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-exp.el", "start": 97950440, "end": 97969288}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-exp.elc", "start": 97969288, "end": 97983344}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-forth.el", "start": 97983344, "end": 97986547}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-forth.elc", "start": 97986547, "end": 97990037}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-fortran.el", "start": 97990037, "end": 97996941}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-fortran.elc", "start": 97996941, "end": 98004038}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-gnuplot.el", "start": 98004038, "end": 98016769}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-gnuplot.elc", "start": 98016769, "end": 98027706}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-groovy.el", "start": 98027706, "end": 98032023}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-groovy.elc", "start": 98032023, "end": 98037071}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-haskell.el", "start": 98037071, "end": 98053307}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-haskell.elc", "start": 98053307, "end": 98068574}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-java.el", "start": 98068574, "end": 98089350}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-java.elc", "start": 98089350, "end": 98106376}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-js.el", "start": 98106376, "end": 98114210}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-js.elc", "start": 98114210, "end": 98122786}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-julia.el", "start": 98122786, "end": 98135451}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-julia.elc", "start": 98135451, "end": 98148746}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-latex.el", "start": 98148746, "end": 98160593}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-latex.elc", "start": 98160593, "end": 98170972}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-lilypond.el", "start": 98170972, "end": 98187867}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-lilypond.elc", "start": 98187867, "end": 98203676}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-lisp.el", "start": 98203676, "end": 98209001}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-lisp.elc", "start": 98209001, "end": 98214389}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-lob.el", "start": 98214389, "end": 98220901}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-lob.elc", "start": 98220901, "end": 98228867}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-lua.el", "start": 98228867, "end": 98244030}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-lua.elc", "start": 98244030, "end": 98259796}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-makefile.el", "start": 98259796, "end": 98261334}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-makefile.elc", "start": 98261334, "end": 98263629}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-matlab.el", "start": 98263629, "end": 98265038}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-matlab.elc", "start": 98265038, "end": 98266902}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-maxima.el", "start": 98266902, "end": 98275091}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-maxima.elc", "start": 98275091, "end": 98282659}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-ocaml.el", "start": 98282659, "end": 98289018}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-ocaml.elc", "start": 98289018, "end": 98296267}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-octave.el", "start": 98296267, "end": 98306419}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-octave.elc", "start": 98306419, "end": 98318029}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-org.el", "start": 98318029, "end": 98320985}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-org.elc", "start": 98320985, "end": 98324352}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-perl.el", "start": 98324352, "end": 98329709}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-perl.elc", "start": 98329709, "end": 98335640}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-plantuml.el", "start": 98335640, "end": 98342096}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-plantuml.elc", "start": 98342096, "end": 98349207}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-processing.el", "start": 98349207, "end": 98356280}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-processing.elc", "start": 98356280, "end": 98362351}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-python.el", "start": 98362351, "end": 98385612}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-python.elc", "start": 98385612, "end": 98408043}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-ref.el", "start": 98408043, "end": 98417680}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-ref.elc", "start": 98417680, "end": 98425108}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-ruby.el", "start": 98425108, "end": 98435707}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-ruby.elc", "start": 98435707, "end": 98447940}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-sass.el", "start": 98447940, "end": 98450488}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-sass.elc", "start": 98450488, "end": 98453412}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-scheme.el", "start": 98453412, "end": 98464902}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-scheme.elc", "start": 98464902, "end": 98473759}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-screen.el", "start": 98473759, "end": 98479427}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-screen.elc", "start": 98479427, "end": 98485082}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-sed.el", "start": 98485082, "end": 98488809}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-sed.elc", "start": 98488809, "end": 98493001}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-shell.el", "start": 98493001, "end": 98509338}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-shell.elc", "start": 98509338, "end": 98525617}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-sql.el", "start": 98525617, "end": 98541475}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-sql.elc", "start": 98541475, "end": 98554304}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-sqlite.el", "start": 98554304, "end": 98559604}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-sqlite.elc", "start": 98559604, "end": 98565301}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-table.el", "start": 98565301, "end": 98570699}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-table.elc", "start": 98570699, "end": 98575365}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-tangle.el", "start": 98575365, "end": 98605835}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob-tangle.elc", "start": 98605835, "end": 98631947}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob.el", "start": 98631947, "end": 98633267}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ob.elc", "start": 98633267, "end": 98635314}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-basic.el", "start": 98635314, "end": 98674438}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-basic.elc", "start": 98674438, "end": 98700614}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-biblatex.el", "start": 98700614, "end": 98718981}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-biblatex.elc", "start": 98718981, "end": 98732247}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-bibtex.el", "start": 98732247, "end": 98735149}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-bibtex.elc", "start": 98735149, "end": 98738361}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-csl.el", "start": 98738361, "end": 98775018}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-csl.elc", "start": 98775018, "end": 98801545}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-natbib.el", "start": 98801545, "end": 98809905}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc-natbib.elc", "start": 98809905, "end": 98817622}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc.el", "start": 98817622, "end": 98892396}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/oc.elc", "start": 98892396, "end": 98975923}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-bbdb.el", "start": 98975923, "end": 98996555}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-bbdb.elc", "start": 98996555, "end": 99010894}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-bibtex.el", "start": 99010894, "end": 99045421}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-bibtex.elc", "start": 99045421, "end": 99074176}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-docview.el", "start": 99074176, "end": 99077984}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-docview.elc", "start": 99077984, "end": 99081538}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-doi.el", "start": 99081538, "end": 99084008}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-doi.elc", "start": 99084008, "end": 99087273}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-eshell.el", "start": 99087273, "end": 99089825}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-eshell.elc", "start": 99089825, "end": 99092870}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-eww.el", "start": 99092870, "end": 99099037}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-eww.elc", "start": 99099037, "end": 99103704}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-gnus.el", "start": 99103704, "end": 99114330}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-gnus.elc", "start": 99114330, "end": 99123626}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-info.el", "start": 99123626, "end": 99131330}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-info.elc", "start": 99131330, "end": 99138914}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-irc.el", "start": 99138914, "end": 99148740}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-irc.elc", "start": 99148740, "end": 99156032}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-man.el", "start": 99156032, "end": 99161020}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-man.elc", "start": 99161020, "end": 99165563}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-mhe.el", "start": 99165563, "end": 99173550}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-mhe.elc", "start": 99173550, "end": 99180300}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-rmail.el", "start": 99180300, "end": 99184599}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-rmail.elc", "start": 99184599, "end": 99188578}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-w3m.el", "start": 99188578, "end": 99197943}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol-w3m.elc", "start": 99197943, "end": 99203650}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol.el", "start": 99203650, "end": 99292544}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ol.elc", "start": 99292544, "end": 99364424}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-agenda.el", "start": 99364424, "end": 99815367}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-agenda.elc", "start": 99815367, "end": 100226810}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-archive.el", "start": 100226810, "end": 100251487}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-archive.elc", "start": 100251487, "end": 100271719}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-attach-git.el", "start": 100271719, "end": 100277424}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-attach-git.elc", "start": 100277424, "end": 100283513}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-attach.el", "start": 100283513, "end": 100317671}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-attach.elc", "start": 100317671, "end": 100349696}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-capture.el", "start": 100349696, "end": 100431999}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-capture.elc", "start": 100431999, "end": 100508719}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-clock.el", "start": 100508719, "end": 100637213}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-clock.elc", "start": 100637213, "end": 100745764}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-colview.el", "start": 100745764, "end": 100818153}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-colview.elc", "start": 100818153, "end": 100895428}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-compat.el", "start": 100895428, "end": 100965099}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-compat.elc", "start": 100965099, "end": 101030022}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-crypt.el", "start": 101030022, "end": 101042969}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-crypt.elc", "start": 101042969, "end": 101053869}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-ctags.el", "start": 101053869, "end": 101074775}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-ctags.elc", "start": 101074775, "end": 101089077}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-cycle.el", "start": 101089077, "end": 101123923}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-cycle.elc", "start": 101123923, "end": 101150029}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-datetree.el", "start": 101150029, "end": 101161056}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-datetree.elc", "start": 101161056, "end": 101171267}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-duration.el", "start": 101171267, "end": 101187025}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-duration.elc", "start": 101187025, "end": 101200360}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-element-ast.el", "start": 101200360, "end": 101247563}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-element-ast.elc", "start": 101247563, "end": 101304332}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-element.el", "start": 101304332, "end": 101671785}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-element.elc", "start": 101671785, "end": 102066939}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-entities.el", "start": 102066939, "end": 102097130}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-entities.elc", "start": 102097130, "end": 102126237}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-faces.el", "start": 102126237, "end": 102154922}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-faces.elc", "start": 102154922, "end": 102186193}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-feed.el", "start": 102186193, "end": 102212851}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-feed.elc", "start": 102212851, "end": 102233650}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-fold-core.el", "start": 102233650, "end": 102316976}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-fold-core.elc", "start": 102316976, "end": 102384189}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-fold.el", "start": 102384189, "end": 102422585}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-fold.elc", "start": 102422585, "end": 102453983}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-footnote.el", "start": 102453983, "end": 102492529}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-footnote.elc", "start": 102492529, "end": 102533317}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-goto.el", "start": 102533317, "end": 102543810}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-goto.elc", "start": 102543810, "end": 102554466}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-habit.el", "start": 102554466, "end": 102571992}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-habit.elc", "start": 102571992, "end": 102588060}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-id.el", "start": 102588060, "end": 102621654}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-id.elc", "start": 102621654, "end": 102651701}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-indent.el", "start": 102651701, "end": 102669395}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-indent.elc", "start": 102669395, "end": 102686975}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-inlinetask.el", "start": 102686975, "end": 102700088}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-inlinetask.elc", "start": 102700088, "end": 102710457}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-keys.el", "start": 102710457, "end": 102753001}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-keys.elc", "start": 102753001, "end": 102779770}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-lint.el", "start": 102779770, "end": 102849009}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-lint.elc", "start": 102849009, "end": 102958061}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-list.el", "start": 102958061, "end": 103098297}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-list.elc", "start": 103098297, "end": 103203283}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-loaddefs.el", "start": 103203283, "end": 103321692}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-loaddefs.elc", "start": 103321692, "end": 103443110}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-macro.el", "start": 103443110, "end": 103461193}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-macro.elc", "start": 103461193, "end": 103476598}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-macs.el", "start": 103476598, "end": 103545878}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-macs.elc", "start": 103545878, "end": 103607630}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-mobile.el", "start": 103607630, "end": 103650677}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-mobile.elc", "start": 103650677, "end": 103694096}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-mouse.el", "start": 103694096, "end": 103733694}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-mouse.elc", "start": 103733694, "end": 103767363}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-num.el", "start": 103767363, "end": 103786711}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-num.elc", "start": 103786711, "end": 103804792}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-pcomplete.el", "start": 103804792, "end": 103821572}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-pcomplete.elc", "start": 103821572, "end": 103835849}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-persist.el", "start": 103835849, "end": 103897631}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-persist.elc", "start": 103897631, "end": 103940430}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-plot.el", "start": 103940430, "end": 103968264}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-plot.elc", "start": 103968264, "end": 103991801}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-protocol.el", "start": 103991801, "end": 104022938}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-protocol.elc", "start": 104022938, "end": 104046406}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-refile.el", "start": 104046406, "end": 104077410}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-refile.elc", "start": 104077410, "end": 104103125}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-src.el", "start": 104103125, "end": 104162087}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-src.elc", "start": 104162087, "end": 104213543}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-table.el", "start": 104213543, "end": 104458899}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-table.elc", "start": 104458899, "end": 104677933}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-tempo.el", "start": 104677933, "end": 104684558}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-tempo.elc", "start": 104684558, "end": 104691016}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-timer.el", "start": 104691016, "end": 104709601}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-timer.elc", "start": 104709601, "end": 104725468}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org-version.el", "start": 104725468, "end": 104726089}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org.el", "start": 104726089, "end": 105617269}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/org.elc", "start": 105617269, "end": 106384107}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-ascii.el", "start": 106384107, "end": 106465227}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-ascii.elc", "start": 106465227, "end": 106532322}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-beamer.el", "start": 106532322, "end": 106578974}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-beamer.elc", "start": 106578974, "end": 106616082}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-html.el", "start": 106616082, "end": 106772843}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-html.elc", "start": 106772843, "end": 106909240}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-icalendar.el", "start": 106909240, "end": 106958046}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-icalendar.elc", "start": 106958046, "end": 106998800}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-koma-letter.el", "start": 106998800, "end": 107039415}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-koma-letter.elc", "start": 107039415, "end": 107070762}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-latex.el", "start": 107070762, "end": 107250836}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-latex.elc", "start": 107250836, "end": 107404174}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-man.el", "start": 107404174, "end": 107443132}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-man.elc", "start": 107443132, "end": 107475148}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-md.el", "start": 107475148, "end": 107504239}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-md.elc", "start": 107504239, "end": 107531519}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-odt.el", "start": 107531519, "end": 107695878}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-odt.elc", "start": 107695878, "end": 107823456}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-org.el", "start": 107823456, "end": 107837129}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-org.elc", "start": 107837129, "end": 107851533}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-publish.el", "start": 107851533, "end": 107904143}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-publish.elc", "start": 107904143, "end": 107950158}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-texinfo.el", "start": 107950158, "end": 108028297}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox-texinfo.elc", "start": 108028297, "end": 108100590}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox.el", "start": 108100590, "end": 108400563}, {"filename": "/usr/local/share/emacs/30.2/lisp/org/ox.elc", "start": 108400563, "end": 108656769}, {"filename": "/usr/local/share/emacs/30.2/lisp/outline.el", "start": 108656769, "end": 108739039}, {"filename": "/usr/local/share/emacs/30.2/lisp/outline.elc", "start": 108739039, "end": 108808374}, {"filename": "/usr/local/share/emacs/30.2/lisp/paren.el", "start": 108808374, "end": 108830109}, {"filename": "/usr/local/share/emacs/30.2/lisp/paren.elc", "start": 108830109, "end": 108847534}, {"filename": "/usr/local/share/emacs/30.2/lisp/password-cache.el", "start": 108847534, "end": 108851709}, {"filename": "/usr/local/share/emacs/30.2/lisp/password-cache.elc", "start": 108851709, "end": 108854330}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-cvs.el", "start": 108854330, "end": 108861330}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-cvs.elc", "start": 108861330, "end": 108867356}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-git.el", "start": 108867356, "end": 108872128}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-git.elc", "start": 108872128, "end": 108875545}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-gnu.el", "start": 108875545, "end": 108890328}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-gnu.elc", "start": 108890328, "end": 108903397}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-linux.el", "start": 108903397, "end": 108910286}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-linux.elc", "start": 108910286, "end": 108915844}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-rpm.el", "start": 108915844, "end": 108929394}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-rpm.elc", "start": 108929394, "end": 108942646}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-unix.el", "start": 108942646, "end": 108964869}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-unix.elc", "start": 108964869, "end": 108988916}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-x.el", "start": 108988916, "end": 109001753}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcmpl-x.elc", "start": 109001753, "end": 109013274}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcomplete.el", "start": 109013274, "end": 109075866}, {"filename": "/usr/local/share/emacs/30.2/lisp/pcomplete.elc", "start": 109075866, "end": 109121619}, {"filename": "/usr/local/share/emacs/30.2/lisp/pgtk-dnd.el", "start": 109121619, "end": 109139546}, {"filename": "/usr/local/share/emacs/30.2/lisp/pgtk-dnd.elc", "start": 109139546, "end": 109151704}, {"filename": "/usr/local/share/emacs/30.2/lisp/pixel-scroll.el", "start": 109151704, "end": 109189216}, {"filename": "/usr/local/share/emacs/30.2/lisp/pixel-scroll.elc", "start": 109189216, "end": 109217532}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/5x5.el", "start": 109217532, "end": 109247349}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/5x5.elc", "start": 109247349, "end": 109268863}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/animate.el", "start": 109268863, "end": 109276556}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/animate.elc", "start": 109276556, "end": 109280988}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/blackbox.el", "start": 109280988, "end": 109295956}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/blackbox.elc", "start": 109295956, "end": 109308665}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/bubbles.el", "start": 109308665, "end": 109352728}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/bubbles.elc", "start": 109352728, "end": 109396877}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/cookie1.el", "start": 109396877, "end": 109406366}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/cookie1.elc", "start": 109406366, "end": 109412760}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/decipher.el", "start": 109412760, "end": 109453881}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/decipher.elc", "start": 109453881, "end": 109478533}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/dissociate.el", "start": 109478533, "end": 109481790}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/dissociate.elc", "start": 109481790, "end": 109483241}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/doctor.el", "start": 109483241, "end": 109546081}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/doctor.elc", "start": 109546081, "end": 109595505}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/dunnet.el", "start": 109595505, "end": 109708993}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/dunnet.elc", "start": 109708993, "end": 109798254}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/fortune.el", "start": 109798254, "end": 109810160}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/fortune.elc", "start": 109810160, "end": 109818984}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/gamegrid.el", "start": 109818984, "end": 109842563}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/gamegrid.elc", "start": 109842563, "end": 109858336}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/gametree.el", "start": 109858336, "end": 109882474}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/gametree.elc", "start": 109882474, "end": 109901586}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/gomoku.el", "start": 109901586, "end": 109946967}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/gomoku.elc", "start": 109946967, "end": 109976385}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/handwrite.el", "start": 109976385, "end": 110038517}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/handwrite.elc", "start": 110038517, "end": 110098399}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/hanoi.el", "start": 110098399, "end": 110116581}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/hanoi.elc", "start": 110116581, "end": 110124942}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/life.el", "start": 110124942, "end": 110136996}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/life.elc", "start": 110136996, "end": 110146678}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/morse.el", "start": 110146678, "end": 110153289}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/morse.elc", "start": 110153289, "end": 110157300}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/mpuz.el", "start": 110157300, "end": 110172736}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/mpuz.elc", "start": 110172736, "end": 110186761}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/pong.el", "start": 110186761, "end": 110199620}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/pong.elc", "start": 110199620, "end": 110209872}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/snake.el", "start": 110209872, "end": 110222009}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/snake.elc", "start": 110222009, "end": 110233896}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/solitaire.el", "start": 110233896, "end": 110247796}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/solitaire.elc", "start": 110247796, "end": 110260955}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/spook.el", "start": 110260955, "end": 110263199}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/spook.elc", "start": 110263199, "end": 110264387}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/studly.el", "start": 110264387, "end": 110266314}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/studly.elc", "start": 110266314, "end": 110267325}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/tetris.el", "start": 110267325, "end": 110287669}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/tetris.elc", "start": 110287669, "end": 110306201}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/zone.el", "start": 110306201, "end": 110328968}, {"filename": "/usr/local/share/emacs/30.2/lisp/play/zone.elc", "start": 110328968, "end": 110343659}, {"filename": "/usr/local/share/emacs/30.2/lisp/plstore.el", "start": 110343659, "end": 110370780}, {"filename": "/usr/local/share/emacs/30.2/lisp/plstore.elc", "start": 110370780, "end": 110386860}, {"filename": "/usr/local/share/emacs/30.2/lisp/printing.el", "start": 110386860, "end": 110601124}, {"filename": "/usr/local/share/emacs/30.2/lisp/printing.elc", "start": 110601124, "end": 110758891}, {"filename": "/usr/local/share/emacs/30.2/lisp/proced.el", "start": 110758891, "end": 110858529}, {"filename": "/usr/local/share/emacs/30.2/lisp/proced.elc", "start": 110858529, "end": 110935320}, {"filename": "/usr/local/share/emacs/30.2/lisp/profiler.el", "start": 110935320, "end": 110968475}, {"filename": "/usr/local/share/emacs/30.2/lisp/profiler.elc", "start": 110968475, "end": 111011247}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/antlr-mode.el", "start": 111011247, "end": 111112973}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/antlr-mode.elc", "start": 111112973, "end": 111190767}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/asm-mode.el", "start": 111190767, "end": 111199304}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/asm-mode.elc", "start": 111199304, "end": 111206527}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/autoconf.el", "start": 111206527, "end": 111210214}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/autoconf.elc", "start": 111210214, "end": 111214573}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/bat-mode.el", "start": 111214573, "end": 111221676}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/bat-mode.elc", "start": 111221676, "end": 111228058}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/bug-reference.el", "start": 111228058, "end": 111259134}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/bug-reference.elc", "start": 111259134, "end": 111286043}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/c-ts-common.el", "start": 111286043, "end": 111305051}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/c-ts-common.elc", "start": 111305051, "end": 111313971}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/c-ts-mode.el", "start": 111313971, "end": 111375578}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/c-ts-mode.elc", "start": 111375578, "end": 111425162}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-align.el", "start": 111425162, "end": 111480981}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-align.elc", "start": 111480981, "end": 111522788}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-awk.el", "start": 111522788, "end": 111578901}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-awk.elc", "start": 111578901, "end": 111599378}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-bytecomp.el", "start": 111599378, "end": 111616721}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-bytecomp.elc", "start": 111616721, "end": 111628010}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-cmds.el", "start": 111628010, "end": 111815952}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-cmds.elc", "start": 111815952, "end": 111923137}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-defs.el", "start": 111923137, "end": 112033678}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-defs.elc", "start": 112033678, "end": 112104577}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-engine.el", "start": 112104577, "end": 112708233}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-engine.elc", "start": 112708233, "end": 112984661}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-fonts.el", "start": 112984661, "end": 113120090}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-fonts.elc", "start": 113120090, "end": 113287840}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-guess.el", "start": 113287840, "end": 113307896}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-guess.elc", "start": 113307896, "end": 113321425}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-langs.el", "start": 113321425, "end": 113504131}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-langs.elc", "start": 113504131, "end": 113631179}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-menus.el", "start": 113631179, "end": 113648776}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-menus.elc", "start": 113648776, "end": 113656111}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-mode.el", "start": 113656111, "end": 113788599}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-mode.elc", "start": 113788599, "end": 114059063}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-styles.el", "start": 114059063, "end": 114084104}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-styles.elc", "start": 114084104, "end": 114100872}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-vars.el", "start": 114100872, "end": 114181930}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cc-vars.elc", "start": 114181930, "end": 114264102}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cfengine.el", "start": 114264102, "end": 114326431}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cfengine.elc", "start": 114326431, "end": 114374652}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cl-font-lock.el", "start": 114374652, "end": 114391585}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cl-font-lock.elc", "start": 114391585, "end": 114408304}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cmacexp.el", "start": 114408304, "end": 114422751}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cmacexp.elc", "start": 114422751, "end": 114428658}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cmake-ts-mode.el", "start": 114428658, "end": 114437640}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cmake-ts-mode.elc", "start": 114437640, "end": 114445870}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/compile.el", "start": 114445870, "end": 114591499}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/compile.elc", "start": 114591499, "end": 114696670}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cperl-mode.el", "start": 114696670, "end": 115074225}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cperl-mode.elc", "start": 115074225, "end": 115326570}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cpp.el", "start": 115326570, "end": 115355475}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cpp.elc", "start": 115355475, "end": 115379536}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/csharp-mode.el", "start": 115379536, "end": 115418507}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/csharp-mode.elc", "start": 115418507, "end": 115542671}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cwarn.el", "start": 115542671, "end": 115553572}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/cwarn.elc", "start": 115553572, "end": 115565481}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/dcl-mode.el", "start": 115565481, "end": 115639719}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/dcl-mode.elc", "start": 115639719, "end": 115690048}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/dockerfile-ts-mode.el", "start": 115690048, "end": 115695894}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/dockerfile-ts-mode.elc", "start": 115695894, "end": 115701842}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-abn.el", "start": 115701842, "end": 115720082}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-abn.elc", "start": 115720082, "end": 115726517}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-bnf.el", "start": 115726517, "end": 115744541}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-bnf.elc", "start": 115744541, "end": 115751850}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-dtd.el", "start": 115751850, "end": 115793693}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-dtd.elc", "start": 115793693, "end": 115806598}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-ebx.el", "start": 115806598, "end": 115825143}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-ebx.elc", "start": 115825143, "end": 115832698}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-iso.el", "start": 115832698, "end": 115849965}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-iso.elc", "start": 115849965, "end": 115857250}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-otz.el", "start": 115857250, "end": 115876461}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-otz.elc", "start": 115876461, "end": 115884488}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-yac.el", "start": 115884488, "end": 115898038}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf-yac.elc", "start": 115898038, "end": 115905032}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf2ps.el", "start": 115905032, "end": 116090244}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebnf2ps.elc", "start": 116090244, "end": 116213482}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebrowse.el", "start": 116213482, "end": 116365268}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ebrowse.elc", "start": 116365268, "end": 116573281}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/eglot.el", "start": 116573281, "end": 116768376}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/eglot.elc", "start": 116768376, "end": 116939325}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/elisp-mode.el", "start": 116939325, "end": 117041008}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/elisp-mode.elc", "start": 117041008, "end": 117116608}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/elixir-ts-mode.el", "start": 117116608, "end": 117146478}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/elixir-ts-mode.elc", "start": 117146478, "end": 117169508}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/erts-mode.el", "start": 117169508, "end": 117177082}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/erts-mode.elc", "start": 117177082, "end": 117184172}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/etags-regen.el", "start": 117184172, "end": 117201263}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/etags-regen.elc", "start": 117201263, "end": 117215025}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/etags.el", "start": 117215025, "end": 117306889}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/etags.elc", "start": 117306889, "end": 117383172}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/executable.el", "start": 117383172, "end": 117394762}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/executable.elc", "start": 117394762, "end": 117402846}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/f90.el", "start": 117402846, "end": 117508423}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/f90.elc", "start": 117508423, "end": 117607703}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/flymake-cc.el", "start": 117607703, "end": 117613979}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/flymake-cc.elc", "start": 117613979, "end": 117617529}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/flymake-proc.el", "start": 117617529, "end": 117671717}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/flymake-proc.elc", "start": 117671717, "end": 117709966}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/flymake.el", "start": 117709966, "end": 117799952}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/flymake.elc", "start": 117799952, "end": 117897586}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/fortran.el", "start": 117897586, "end": 117992054}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/fortran.elc", "start": 117992054, "end": 118054153}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/gdb-mi.el", "start": 118054153, "end": 118264839}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/gdb-mi.elc", "start": 118264839, "end": 118480786}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/glasses.el", "start": 118480786, "end": 118493612}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/glasses.elc", "start": 118493612, "end": 118505185}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/go-ts-mode.el", "start": 118505185, "end": 118522768}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/go-ts-mode.elc", "start": 118522768, "end": 118540649}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/grep.el", "start": 118540649, "end": 118600940}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/grep.elc", "start": 118600940, "end": 118648267}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/gud.el", "start": 118648267, "end": 118809636}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/gud.elc", "start": 118809636, "end": 118922412}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/heex-ts-mode.el", "start": 118922412, "end": 118929471}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/heex-ts-mode.elc", "start": 118929471, "end": 118935990}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/hideif.el", "start": 118935990, "end": 119049008}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/hideif.elc", "start": 119049008, "end": 119113981}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/hideshow.el", "start": 119113981, "end": 119156300}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/hideshow.elc", "start": 119156300, "end": 119185332}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/icon.el", "start": 119185332, "end": 119208836}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/icon.elc", "start": 119208836, "end": 119225523}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlw-complete-structtag.el", "start": 119225523, "end": 119235747}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlw-complete-structtag.elc", "start": 119235747, "end": 119239879}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlw-help.el", "start": 119239879, "end": 119290198}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlw-help.elc", "start": 119290198, "end": 119326439}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlw-shell.el", "start": 119326439, "end": 119497632}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlw-shell.elc", "start": 119497632, "end": 119629419}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlw-toolbar.el", "start": 119629419, "end": 119658521}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlw-toolbar.elc", "start": 119658521, "end": 119686547}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlwave.el", "start": 119686547, "end": 120028371}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/idlwave.elc", "start": 120028371, "end": 120278132}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/inf-lisp.el", "start": 120278132, "end": 120306252}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/inf-lisp.elc", "start": 120306252, "end": 120327824}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/java-ts-mode.el", "start": 120327824, "end": 120344669}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/java-ts-mode.elc", "start": 120344669, "end": 120359133}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/js.el", "start": 120359133, "end": 120515828}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/js.elc", "start": 120515828, "end": 120687888}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/json-ts-mode.el", "start": 120687888, "end": 120693359}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/json-ts-mode.elc", "start": 120693359, "end": 120698771}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ld-script.el", "start": 120698771, "end": 120704480}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ld-script.elc", "start": 120704480, "end": 120709731}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/lua-ts-mode.el", "start": 120709731, "end": 120742875}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/lua-ts-mode.elc", "start": 120742875, "end": 120770402}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/m4-mode.el", "start": 120770402, "end": 120776719}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/m4-mode.elc", "start": 120776719, "end": 120784444}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/make-mode.el", "start": 120784444, "end": 120853052}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/make-mode.elc", "start": 120853052, "end": 120916399}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/meta-mode.el", "start": 120916399, "end": 120953970}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/meta-mode.elc", "start": 120953970, "end": 120985727}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/mixal-mode.el", "start": 120985727, "end": 121029004}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/mixal-mode.elc", "start": 121029004, "end": 121066458}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/modula2.el", "start": 121066458, "end": 121087822}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/modula2.elc", "start": 121087822, "end": 121118229}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/octave.el", "start": 121118229, "end": 121192474}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/octave.elc", "start": 121192474, "end": 121255768}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/opascal.el", "start": 121255768, "end": 121327168}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/opascal.elc", "start": 121327168, "end": 121378036}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/pascal.el", "start": 121378036, "end": 121432005}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/pascal.elc", "start": 121432005, "end": 121471608}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/peg.el", "start": 121471608, "end": 121506675}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/peg.elc", "start": 121506675, "end": 121532725}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/perl-mode.el", "start": 121532725, "end": 121587285}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/perl-mode.elc", "start": 121587285, "end": 121619049}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/php-ts-mode.el", "start": 121619049, "end": 121692919}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/php-ts-mode.elc", "start": 121692919, "end": 121753392}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/prog-mode.el", "start": 121753392, "end": 121767907}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/prog-mode.elc", "start": 121767907, "end": 121786397}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/project.el", "start": 121786397, "end": 121879506}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/project.elc", "start": 121879506, "end": 121948493}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/prolog.el", "start": 121948493, "end": 122080236}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/prolog.elc", "start": 122080236, "end": 122163700}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ps-mode.el", "start": 122163700, "end": 122199712}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ps-mode.elc", "start": 122199712, "end": 122233261}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/python.el", "start": 122233261, "end": 122540494}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/python.elc", "start": 122540494, "end": 122780381}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ruby-mode.el", "start": 122780381, "end": 122884131}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ruby-mode.elc", "start": 122884131, "end": 122955765}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ruby-ts-mode.el", "start": 122955765, "end": 123008039}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/ruby-ts-mode.elc", "start": 123008039, "end": 123038408}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/rust-ts-mode.el", "start": 123038408, "end": 123061998}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/rust-ts-mode.elc", "start": 123061998, "end": 123081990}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/scheme.el", "start": 123081990, "end": 123111984}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/scheme.elc", "start": 123111984, "end": 123132790}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/sh-script.el", "start": 123132790, "end": 123255755}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/sh-script.elc", "start": 123255755, "end": 123363485}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/simula.el", "start": 123363485, "end": 123420685}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/simula.elc", "start": 123420685, "end": 123463323}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/sql.el", "start": 123463323, "end": 123693266}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/sql.elc", "start": 123693266, "end": 123880974}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/subword.el", "start": 123880974, "end": 123893457}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/subword.elc", "start": 123893457, "end": 123912322}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/tcl.el", "start": 123912322, "end": 123970090}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/tcl.elc", "start": 123970090, "end": 124011588}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/typescript-ts-mode.el", "start": 124011588, "end": 124037015}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/typescript-ts-mode.elc", "start": 124037015, "end": 124062435}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/vera-mode.el", "start": 124062435, "end": 124115683}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/vera-mode.elc", "start": 124115683, "end": 124159441}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/verilog-mode.el", "start": 124159441, "end": 124788876}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/verilog-mode.elc", "start": 124788876, "end": 125290285}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/vhdl-mode.el", "start": 125290285, "end": 125995768}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/vhdl-mode.elc", "start": 125995768, "end": 126528619}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/which-func.el", "start": 126528619, "end": 126544830}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/which-func.elc", "start": 126544830, "end": 126558133}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/xref.el", "start": 126558133, "end": 126646137}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/xref.elc", "start": 126646137, "end": 126743358}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/xscheme.el", "start": 126743358, "end": 126786409}, {"filename": "/usr/local/share/emacs/30.2/lisp/progmodes/xscheme.elc", "start": 126786409, "end": 126824692}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-bdf.el", "start": 126824692, "end": 126840766}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-bdf.elc", "start": 126840766, "end": 126853756}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-mule.el", "start": 126853756, "end": 126897987}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-mule.elc", "start": 126897987, "end": 126934027}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-print-loaddefs.el", "start": 126934027, "end": 126936737}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-print-loaddefs.elc", "start": 126936737, "end": 126939284}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-print.el", "start": 126939284, "end": 127167597}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-print.elc", "start": 127167597, "end": 127313540}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-samp.el", "start": 127313540, "end": 127323677}, {"filename": "/usr/local/share/emacs/30.2/lisp/ps-samp.elc", "start": 127323677, "end": 127328553}, {"filename": "/usr/local/share/emacs/30.2/lisp/recentf.el", "start": 127328553, "end": 127381915}, {"filename": "/usr/local/share/emacs/30.2/lisp/recentf.elc", "start": 127381915, "end": 127432142}, {"filename": "/usr/local/share/emacs/30.2/lisp/rect.el", "start": 127432142, "end": 127471456}, {"filename": "/usr/local/share/emacs/30.2/lisp/rect.elc", "start": 127471456, "end": 127500295}, {"filename": "/usr/local/share/emacs/30.2/lisp/register.el", "start": 127500295, "end": 127544729}, {"filename": "/usr/local/share/emacs/30.2/lisp/register.elc", "start": 127544729, "end": 127601273}, {"filename": "/usr/local/share/emacs/30.2/lisp/registry.el", "start": 127601273, "end": 127615491}, {"filename": "/usr/local/share/emacs/30.2/lisp/registry.elc", "start": 127615491, "end": 127625609}, {"filename": "/usr/local/share/emacs/30.2/lisp/repeat.el", "start": 127625609, "end": 127656996}, {"filename": "/usr/local/share/emacs/30.2/lisp/repeat.elc", "start": 127656996, "end": 127675687}, {"filename": "/usr/local/share/emacs/30.2/lisp/replace.el", "start": 127675687, "end": 127814814}, {"filename": "/usr/local/share/emacs/30.2/lisp/replace.elc", "start": 127814814, "end": 127913885}, {"filename": "/usr/local/share/emacs/30.2/lisp/reposition.el", "start": 127913885, "end": 127921652}, {"filename": "/usr/local/share/emacs/30.2/lisp/reposition.elc", "start": 127921652, "end": 127924125}, {"filename": "/usr/local/share/emacs/30.2/lisp/reveal.el", "start": 127924125, "end": 127934575}, {"filename": "/usr/local/share/emacs/30.2/lisp/reveal.elc", "start": 127934575, "end": 127943146}, {"filename": "/usr/local/share/emacs/30.2/lisp/rfn-eshadow.el", "start": 127943146, "end": 127952469}, {"filename": "/usr/local/share/emacs/30.2/lisp/rfn-eshadow.elc", "start": 127952469, "end": 127960413}, {"filename": "/usr/local/share/emacs/30.2/lisp/rot13.el", "start": 127960413, "end": 127964941}, {"filename": "/usr/local/share/emacs/30.2/lisp/rot13.elc", "start": 127964941, "end": 127967473}, {"filename": "/usr/local/share/emacs/30.2/lisp/rtree.el", "start": 127967473, "end": 127975937}, {"filename": "/usr/local/share/emacs/30.2/lisp/rtree.elc", "start": 127975937, "end": 127979665}, {"filename": "/usr/local/share/emacs/30.2/lisp/ruler-mode.el", "start": 127979665, "end": 128008987}, {"filename": "/usr/local/share/emacs/30.2/lisp/ruler-mode.elc", "start": 128008987, "end": 128032217}, {"filename": "/usr/local/share/emacs/30.2/lisp/savehist.el", "start": 128032217, "end": 128046350}, {"filename": "/usr/local/share/emacs/30.2/lisp/savehist.elc", "start": 128046350, "end": 128058320}, {"filename": "/usr/local/share/emacs/30.2/lisp/saveplace.el", "start": 128058320, "end": 128077104}, {"filename": "/usr/local/share/emacs/30.2/lisp/saveplace.elc", "start": 128077104, "end": 128093216}, {"filename": "/usr/local/share/emacs/30.2/lisp/scroll-all.el", "start": 128093216, "end": 128097452}, {"filename": "/usr/local/share/emacs/30.2/lisp/scroll-all.elc", "start": 128097452, "end": 128102370}, {"filename": "/usr/local/share/emacs/30.2/lisp/scroll-bar.el", "start": 128102370, "end": 128120594}, {"filename": "/usr/local/share/emacs/30.2/lisp/scroll-bar.elc", "start": 128120594, "end": 128138150}, {"filename": "/usr/local/share/emacs/30.2/lisp/scroll-lock.el", "start": 128138150, "end": 128143264}, {"filename": "/usr/local/share/emacs/30.2/lisp/scroll-lock.elc", "start": 128143264, "end": 128148777}, {"filename": "/usr/local/share/emacs/30.2/lisp/select.el", "start": 128148777, "end": 128188868}, {"filename": "/usr/local/share/emacs/30.2/lisp/select.elc", "start": 128188868, "end": 128220466}, {"filename": "/usr/local/share/emacs/30.2/lisp/server.el", "start": 128220466, "end": 128307361}, {"filename": "/usr/local/share/emacs/30.2/lisp/server.elc", "start": 128307361, "end": 128365532}, {"filename": "/usr/local/share/emacs/30.2/lisp/ses.el", "start": 128365532, "end": 128528478}, {"filename": "/usr/local/share/emacs/30.2/lisp/ses.elc", "start": 128528478, "end": 128661821}, {"filename": "/usr/local/share/emacs/30.2/lisp/shadowfile.el", "start": 128661821, "end": 128693857}, {"filename": "/usr/local/share/emacs/30.2/lisp/shadowfile.elc", "start": 128693857, "end": 128726650}, {"filename": "/usr/local/share/emacs/30.2/lisp/shell.el", "start": 128726650, "end": 128802889}, {"filename": "/usr/local/share/emacs/30.2/lisp/shell.elc", "start": 128802889, "end": 128865724}, {"filename": "/usr/local/share/emacs/30.2/lisp/simple.el", "start": 128865724, "end": 129346824}, {"filename": "/usr/local/share/emacs/30.2/lisp/simple.elc", "start": 129346824, "end": 129737176}, {"filename": "/usr/local/share/emacs/30.2/lisp/skeleton.el", "start": 129737176, "end": 129761227}, {"filename": "/usr/local/share/emacs/30.2/lisp/skeleton.elc", "start": 129761227, "end": 129777306}, {"filename": "/usr/local/share/emacs/30.2/lisp/so-long.el", "start": 129777306, "end": 129873832}, {"filename": "/usr/local/share/emacs/30.2/lisp/so-long.elc", "start": 129873832, "end": 129927824}, {"filename": "/usr/local/share/emacs/30.2/lisp/sort.el", "start": 129927824, "end": 129952802}, {"filename": "/usr/local/share/emacs/30.2/lisp/sort.elc", "start": 129952802, "end": 129968483}, {"filename": "/usr/local/share/emacs/30.2/lisp/soundex.el", "start": 129968483, "end": 129970939}, {"filename": "/usr/local/share/emacs/30.2/lisp/soundex.elc", "start": 129970939, "end": 129971760}, {"filename": "/usr/local/share/emacs/30.2/lisp/speedbar.el", "start": 129971760, "end": 130123234}, {"filename": "/usr/local/share/emacs/30.2/lisp/speedbar.elc", "start": 130123234, "end": 130242469}, {"filename": "/usr/local/share/emacs/30.2/lisp/sqlite-mode.el", "start": 130242469, "end": 130250619}, {"filename": "/usr/local/share/emacs/30.2/lisp/sqlite-mode.elc", "start": 130250619, "end": 130257915}, {"filename": "/usr/local/share/emacs/30.2/lisp/sqlite.el", "start": 130257915, "end": 130259880}, {"filename": "/usr/local/share/emacs/30.2/lisp/sqlite.elc", "start": 130259880, "end": 130260758}, {"filename": "/usr/local/share/emacs/30.2/lisp/startup.el", "start": 130260758, "end": 130387677}, {"filename": "/usr/local/share/emacs/30.2/lisp/startup.elc", "start": 130387677, "end": 130463311}, {"filename": "/usr/local/share/emacs/30.2/lisp/strokes.el", "start": 130463311, "end": 130531100}, {"filename": "/usr/local/share/emacs/30.2/lisp/strokes.elc", "start": 130531100, "end": 130577243}, {"filename": "/usr/local/share/emacs/30.2/lisp/subdirs.el", "start": 130577243, "end": 130577735}, {"filename": "/usr/local/share/emacs/30.2/lisp/subr.el", "start": 130577735, "end": 130891524}, {"filename": "/usr/local/share/emacs/30.2/lisp/subr.elc", "start": 130891524, "end": 131144321}, {"filename": "/usr/local/share/emacs/30.2/lisp/svg.el", "start": 131144321, "end": 131160339}, {"filename": "/usr/local/share/emacs/30.2/lisp/svg.elc", "start": 131160339, "end": 131172845}, {"filename": "/usr/local/share/emacs/30.2/lisp/t-mouse.el", "start": 131172845, "end": 131176337}, {"filename": "/usr/local/share/emacs/30.2/lisp/t-mouse.elc", "start": 131176337, "end": 131180513}, {"filename": "/usr/local/share/emacs/30.2/lisp/tab-bar.el", "start": 131180513, "end": 131304896}, {"filename": "/usr/local/share/emacs/30.2/lisp/tab-bar.elc", "start": 131304896, "end": 131407820}, {"filename": "/usr/local/share/emacs/30.2/lisp/tab-line.el", "start": 131407820, "end": 131460273}, {"filename": "/usr/local/share/emacs/30.2/lisp/tab-line.elc", "start": 131460273, "end": 131508990}, {"filename": "/usr/local/share/emacs/30.2/lisp/tabify.el", "start": 131508990, "end": 131513234}, {"filename": "/usr/local/share/emacs/30.2/lisp/tabify.elc", "start": 131513234, "end": 131515114}, {"filename": "/usr/local/share/emacs/30.2/lisp/talk.el", "start": 131515114, "end": 131519447}, {"filename": "/usr/local/share/emacs/30.2/lisp/talk.elc", "start": 131519447, "end": 131522100}, {"filename": "/usr/local/share/emacs/30.2/lisp/tar-mode.el", "start": 131522100, "end": 131586854}, {"filename": "/usr/local/share/emacs/30.2/lisp/tar-mode.elc", "start": 131586854, "end": 131651209}, {"filename": "/usr/local/share/emacs/30.2/lisp/tempo.el", "start": 131651209, "end": 131678166}, {"filename": "/usr/local/share/emacs/30.2/lisp/tempo.elc", "start": 131678166, "end": 131698185}, {"filename": "/usr/local/share/emacs/30.2/lisp/term.el", "start": 131698185, "end": 131890230}, {"filename": "/usr/local/share/emacs/30.2/lisp/term.elc", "start": 131890230, "end": 132008667}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/AT386.el", "start": 132008667, "end": 132010920}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/AT386.elc", "start": 132010920, "end": 132011600}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/README", "start": 132011600, "end": 132022808}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/android-win.el", "start": 132022808, "end": 132048047}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/android-win.elc", "start": 132048047, "end": 132062620}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/bobcat.el", "start": 132062620, "end": 132062921}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/bobcat.elc", "start": 132062921, "end": 132063190}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/common-win.el", "start": 132063190, "end": 132083371}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/common-win.elc", "start": 132083371, "end": 132098064}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/cygwin.el", "start": 132098064, "end": 132098351}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/cygwin.elc", "start": 132098351, "end": 132098584}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/fbterm.el", "start": 132098584, "end": 132099473}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/fbterm.elc", "start": 132099473, "end": 132099790}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/haiku-win.el", "start": 132099790, "end": 132129470}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/haiku-win.elc", "start": 132129470, "end": 132149221}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/internal.el", "start": 132149221, "end": 132174355}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/internal.elc", "start": 132174355, "end": 132192653}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/iris-ansi.el", "start": 132192653, "end": 132201623}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/iris-ansi.elc", "start": 132201623, "end": 132208927}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/konsole.el", "start": 132208927, "end": 132209286}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/konsole.elc", "start": 132209286, "end": 132209592}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/linux.el", "start": 132209592, "end": 132210517}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/linux.elc", "start": 132210517, "end": 132211034}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/lk201.el", "start": 132211034, "end": 132214039}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/lk201.elc", "start": 132214039, "end": 132216072}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/news.el", "start": 132216072, "end": 132218800}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/news.elc", "start": 132218800, "end": 132219708}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/ns-win.el", "start": 132219708, "end": 132254781}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/ns-win.elc", "start": 132254781, "end": 132277599}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/pc-win.el", "start": 132277599, "end": 132294405}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/pc-win.elc", "start": 132294405, "end": 132302854}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/pgtk-win.el", "start": 132302854, "end": 132316684}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/pgtk-win.elc", "start": 132316684, "end": 132327349}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/rxvt.el", "start": 132327349, "end": 132335446}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/rxvt.elc", "start": 132335446, "end": 132340574}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/screen.el", "start": 132340574, "end": 132341612}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/screen.elc", "start": 132341612, "end": 132342453}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/st.el", "start": 132342453, "end": 132343182}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/st.elc", "start": 132343182, "end": 132343862}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/sun.el", "start": 132343862, "end": 132348570}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/sun.elc", "start": 132348570, "end": 132351576}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/tmux.el", "start": 132351576, "end": 132352575}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/tmux.elc", "start": 132352575, "end": 132353400}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/tty-colors.el", "start": 132353400, "end": 132391841}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/tty-colors.elc", "start": 132391841, "end": 132420878}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/tvi970.el", "start": 132420878, "end": 132425380}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/tvi970.elc", "start": 132425380, "end": 132429019}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/vt100.el", "start": 132429019, "end": 132430908}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/vt100.elc", "start": 132430908, "end": 132433819}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/vt200.el", "start": 132433819, "end": 132434315}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/vt200.elc", "start": 132434315, "end": 132434705}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/w32-win.el", "start": 132434705, "end": 132460351}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/w32-win.elc", "start": 132460351, "end": 132473250}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/w32console.el", "start": 132473250, "end": 132477144}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/w32console.elc", "start": 132477144, "end": 132478746}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/wyse50.el", "start": 132478746, "end": 132484791}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/wyse50.elc", "start": 132484791, "end": 132486617}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/x-win.el", "start": 132486617, "end": 132530705}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/x-win.elc", "start": 132530705, "end": 132562189}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/xterm.el", "start": 132562189, "end": 132608243}, {"filename": "/usr/local/share/emacs/30.2/lisp/term/xterm.elc", "start": 132608243, "end": 132640557}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/artist.el", "start": 132640557, "end": 132835714}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/artist.elc", "start": 132835714, "end": 132997325}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/bib-mode.el", "start": 132997325, "end": 133004648}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/bib-mode.elc", "start": 133004648, "end": 133012670}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/bibtex-style.el", "start": 133012670, "end": 133018006}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/bibtex-style.elc", "start": 133018006, "end": 133023043}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/bibtex.el", "start": 133023043, "end": 133285504}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/bibtex.elc", "start": 133285504, "end": 133479596}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/conf-mode.el", "start": 133479596, "end": 133505703}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/conf-mode.elc", "start": 133505703, "end": 133546397}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/css-mode.el", "start": 133546397, "end": 133627198}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/css-mode.elc", "start": 133627198, "end": 133699379}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/dns-mode.el", "start": 133699379, "end": 133712337}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/dns-mode.elc", "start": 133712337, "end": 133723825}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/emacs-authors-mode.el", "start": 133723825, "end": 133729966}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/emacs-authors-mode.elc", "start": 133729966, "end": 133737171}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/emacs-news-mode.el", "start": 133737171, "end": 133749120}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/emacs-news-mode.elc", "start": 133749120, "end": 133762542}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/enriched.el", "start": 133762542, "end": 133783931}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/enriched.elc", "start": 133783931, "end": 133800715}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/fill.el", "start": 133800715, "end": 133864428}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/fill.elc", "start": 133864428, "end": 133901724}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/flyspell.el", "start": 133901724, "end": 134005122}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/flyspell.elc", "start": 134005122, "end": 134062227}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/glyphless-mode.el", "start": 134062227, "end": 134064844}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/glyphless-mode.elc", "start": 134064844, "end": 134068383}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/html-ts-mode.el", "start": 134068383, "end": 134073078}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/html-ts-mode.elc", "start": 134073078, "end": 134078368}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/ispell.el", "start": 134078368, "end": 134263195}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/ispell.elc", "start": 134263195, "end": 134383418}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/less-css-mode.el", "start": 134383418, "end": 134392050}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/less-css-mode.elc", "start": 134392050, "end": 134399620}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/makeinfo.el", "start": 134399620, "end": 134410190}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/makeinfo.elc", "start": 134410190, "end": 134415946}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/mhtml-mode.el", "start": 134415946, "end": 134429994}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/mhtml-mode.elc", "start": 134429994, "end": 134453337}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/nroff-mode.el", "start": 134453337, "end": 134464417}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/nroff-mode.elc", "start": 134464417, "end": 134475797}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/page-ext.el", "start": 134475797, "end": 134505146}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/page-ext.elc", "start": 134505146, "end": 134524369}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/page.el", "start": 134524369, "end": 134530994}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/page.elc", "start": 134530994, "end": 134534476}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/paragraphs.el", "start": 134534476, "end": 134557955}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/paragraphs.elc", "start": 134557955, "end": 134577769}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/picture.el", "start": 134577769, "end": 134610143}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/picture.elc", "start": 134610143, "end": 134637716}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/pixel-fill.el", "start": 134637716, "end": 134646995}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/pixel-fill.elc", "start": 134646995, "end": 134653781}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/po.el", "start": 134653781, "end": 134658862}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/po.elc", "start": 134658862, "end": 134661216}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/refbib.el", "start": 134661216, "end": 134686140}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/refbib.elc", "start": 134686140, "end": 134704297}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/refer.el", "start": 134704297, "end": 134721031}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/refer.elc", "start": 134721031, "end": 134729930}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/refill.el", "start": 134729930, "end": 134740268}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/refill.elc", "start": 134740268, "end": 134746733}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-auc.el", "start": 134746733, "end": 134756341}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-auc.elc", "start": 134756341, "end": 134762336}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-cite.el", "start": 134762336, "end": 134817563}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-cite.elc", "start": 134817563, "end": 134850183}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-dcr.el", "start": 134850183, "end": 134869683}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-dcr.elc", "start": 134869683, "end": 134881065}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-global.el", "start": 134881065, "end": 134902394}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-global.elc", "start": 134902394, "end": 134914910}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-index.el", "start": 134914910, "end": 135004349}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-index.elc", "start": 135004349, "end": 135069064}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-loaddefs.el", "start": 135069064, "end": 135092634}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-loaddefs.elc", "start": 135092634, "end": 135116490}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-parse.el", "start": 135116490, "end": 135163390}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-parse.elc", "start": 135163390, "end": 135189155}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-ref.el", "start": 135189155, "end": 135225545}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-ref.elc", "start": 135225545, "end": 135244471}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-sel.el", "start": 135244471, "end": 135271821}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-sel.elc", "start": 135271821, "end": 135293047}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-toc.el", "start": 135293047, "end": 135337440}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-toc.elc", "start": 135337440, "end": 135370500}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-vars.el", "start": 135370500, "end": 135462908}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex-vars.elc", "start": 135462908, "end": 135551675}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex.el", "start": 135551675, "end": 135644585}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/reftex.elc", "start": 135644585, "end": 135699751}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/remember.el", "start": 135699751, "end": 135725698}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/remember.elc", "start": 135725698, "end": 135746609}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/rst.el", "start": 135746609, "end": 135910773}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/rst.elc", "start": 135910773, "end": 136048382}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/sgml-mode.el", "start": 136048382, "end": 136149549}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/sgml-mode.elc", "start": 136149549, "end": 136262896}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/string-edit.el", "start": 136262896, "end": 136267817}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/string-edit.elc", "start": 136267817, "end": 136273587}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/table.el", "start": 136273587, "end": 136504500}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/table.elc", "start": 136504500, "end": 136666724}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/tex-mode.el", "start": 136666724, "end": 136805507}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/tex-mode.elc", "start": 136805507, "end": 136923760}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/texinfmt.el", "start": 136923760, "end": 137084537}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/texinfmt.elc", "start": 137084537, "end": 137167868}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/texinfo-loaddefs.el", "start": 137167868, "end": 137178506}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/texinfo-loaddefs.elc", "start": 137178506, "end": 137189044}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/texinfo.el", "start": 137189044, "end": 137229738}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/texinfo.elc", "start": 137229738, "end": 137281842}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/texnfo-upd.el", "start": 137281842, "end": 137360475}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/texnfo-upd.elc", "start": 137360475, "end": 137407783}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/text-mode.el", "start": 137407783, "end": 137418814}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/text-mode.elc", "start": 137418814, "end": 137431962}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/tildify.el", "start": 137431962, "end": 137452808}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/tildify.elc", "start": 137452808, "end": 137470716}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/toml-ts-mode.el", "start": 137470716, "end": 137475901}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/toml-ts-mode.elc", "start": 137475901, "end": 137481146}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/two-column.el", "start": 137481146, "end": 137503507}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/two-column.elc", "start": 137503507, "end": 137516143}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/underline.el", "start": 137516143, "end": 137518291}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/underline.elc", "start": 137518291, "end": 137519162}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/word-wrap-mode.el", "start": 137519162, "end": 137521872}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/word-wrap-mode.elc", "start": 137521872, "end": 137529156}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/yaml-ts-mode.el", "start": 137529156, "end": 137534684}, {"filename": "/usr/local/share/emacs/30.2/lisp/textmodes/yaml-ts-mode.elc", "start": 137534684, "end": 137540011}, {"filename": "/usr/local/share/emacs/30.2/lisp/theme-loaddefs.el", "start": 137540011, "end": 137545607}, {"filename": "/usr/local/share/emacs/30.2/lisp/thingatpt.el", "start": 137545607, "end": 137579229}, {"filename": "/usr/local/share/emacs/30.2/lisp/thingatpt.elc", "start": 137579229, "end": 137603431}, {"filename": "/usr/local/share/emacs/30.2/lisp/thread.el", "start": 137603431, "end": 137610931}, {"filename": "/usr/local/share/emacs/30.2/lisp/thread.elc", "start": 137610931, "end": 137618658}, {"filename": "/usr/local/share/emacs/30.2/lisp/time-stamp.el", "start": 137618658, "end": 137657661}, {"filename": "/usr/local/share/emacs/30.2/lisp/time-stamp.elc", "start": 137657661, "end": 137680335}, {"filename": "/usr/local/share/emacs/30.2/lisp/time.el", "start": 137680335, "end": 137704483}, {"filename": "/usr/local/share/emacs/30.2/lisp/time.elc", "start": 137704483, "end": 137730078}, {"filename": "/usr/local/share/emacs/30.2/lisp/timezone.el", "start": 137730078, "end": 137746064}, {"filename": "/usr/local/share/emacs/30.2/lisp/timezone.elc", "start": 137746064, "end": 137756586}, {"filename": "/usr/local/share/emacs/30.2/lisp/tmm.el", "start": 137756586, "end": 137777219}, {"filename": "/usr/local/share/emacs/30.2/lisp/tmm.elc", "start": 137777219, "end": 137789410}, {"filename": "/usr/local/share/emacs/30.2/lisp/tool-bar.el", "start": 137789410, "end": 137815922}, {"filename": "/usr/local/share/emacs/30.2/lisp/tool-bar.elc", "start": 137815922, "end": 137837589}, {"filename": "/usr/local/share/emacs/30.2/lisp/tooltip.el", "start": 137837589, "end": 137852703}, {"filename": "/usr/local/share/emacs/30.2/lisp/tooltip.elc", "start": 137852703, "end": 137867141}, {"filename": "/usr/local/share/emacs/30.2/lisp/touch-screen.el", "start": 137867141, "end": 137968258}, {"filename": "/usr/local/share/emacs/30.2/lisp/touch-screen.elc", "start": 137968258, "end": 138007634}, {"filename": "/usr/local/share/emacs/30.2/lisp/transient.el", "start": 138007634, "end": 138190685}, {"filename": "/usr/local/share/emacs/30.2/lisp/transient.elc", "start": 138190685, "end": 138376016}, {"filename": "/usr/local/share/emacs/30.2/lisp/tree-widget.el", "start": 138376016, "end": 138406021}, {"filename": "/usr/local/share/emacs/30.2/lisp/tree-widget.elc", "start": 138406021, "end": 138426678}, {"filename": "/usr/local/share/emacs/30.2/lisp/treesit.el", "start": 138426678, "end": 138600352}, {"filename": "/usr/local/share/emacs/30.2/lisp/treesit.elc", "start": 138600352, "end": 138723287}, {"filename": "/usr/local/share/emacs/30.2/lisp/tutorial.el", "start": 138723287, "end": 138762024}, {"filename": "/usr/local/share/emacs/30.2/lisp/tutorial.elc", "start": 138762024, "end": 138784501}, {"filename": "/usr/local/share/emacs/30.2/lisp/type-break.el", "start": 138784501, "end": 138831273}, {"filename": "/usr/local/share/emacs/30.2/lisp/type-break.elc", "start": 138831273, "end": 138871008}, {"filename": "/usr/local/share/emacs/30.2/lisp/uniquify.el", "start": 138871008, "end": 138893760}, {"filename": "/usr/local/share/emacs/30.2/lisp/uniquify.elc", "start": 138893760, "end": 138913025}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/ChangeLog.1", "start": 138913025, "end": 139020006}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-auth.el", "start": 139020006, "end": 139043350}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-auth.elc", "start": 139043350, "end": 139064434}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-cache.el", "start": 139064434, "end": 139072773}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-cache.elc", "start": 139072773, "end": 139079467}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-cid.el", "start": 139079467, "end": 139081339}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-cid.elc", "start": 139081339, "end": 139082216}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-cookie.el", "start": 139082216, "end": 139101053}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-cookie.elc", "start": 139101053, "end": 139125591}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-dav.el", "start": 139125591, "end": 139155634}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-dav.elc", "start": 139155634, "end": 139175168}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-domsuf.el", "start": 139175168, "end": 139178619}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-domsuf.elc", "start": 139178619, "end": 139180516}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-expand.el", "start": 139180516, "end": 139186853}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-expand.elc", "start": 139186853, "end": 139190671}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-file.el", "start": 139190671, "end": 139198842}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-file.elc", "start": 139198842, "end": 139206083}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-ftp.el", "start": 139206083, "end": 139207515}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-ftp.elc", "start": 139207515, "end": 139207966}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-future.el", "start": 139207966, "end": 139211719}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-future.elc", "start": 139211719, "end": 139221062}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-gw.el", "start": 139221062, "end": 139231168}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-gw.elc", "start": 139231168, "end": 139238896}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-handlers.el", "start": 139238896, "end": 139256901}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-handlers.elc", "start": 139256901, "end": 139278781}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-history.el", "start": 139278781, "end": 139285685}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-history.elc", "start": 139285685, "end": 139290862}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-http.el", "start": 139290862, "end": 139362052}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-http.elc", "start": 139362052, "end": 139400202}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-imap.el", "start": 139400202, "end": 139403020}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-imap.elc", "start": 139403020, "end": 139404687}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-irc.el", "start": 139404687, "end": 139408485}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-irc.elc", "start": 139408485, "end": 139411279}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-ldap.el", "start": 139411279, "end": 139419249}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-ldap.elc", "start": 139419249, "end": 139425390}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-mailto.el", "start": 139425390, "end": 139429826}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-mailto.elc", "start": 139429826, "end": 139432334}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-methods.el", "start": 139432334, "end": 139437897}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-methods.elc", "start": 139437897, "end": 139441554}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-misc.el", "start": 139441554, "end": 139445477}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-misc.elc", "start": 139445477, "end": 139448718}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-news.el", "start": 139448718, "end": 139452808}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-news.elc", "start": 139452808, "end": 139455701}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-nfs.el", "start": 139455701, "end": 139458763}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-nfs.elc", "start": 139458763, "end": 139462819}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-parse.el", "start": 139462819, "end": 139471548}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-parse.elc", "start": 139471548, "end": 139489196}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-privacy.el", "start": 139489196, "end": 139491478}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-privacy.elc", "start": 139491478, "end": 139492715}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-proxy.el", "start": 139492715, "end": 139495315}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-proxy.elc", "start": 139495315, "end": 139496807}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-queue.el", "start": 139496807, "end": 139504225}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-queue.elc", "start": 139504225, "end": 139519892}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-tramp.el", "start": 139519892, "end": 139523335}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-tramp.elc", "start": 139523335, "end": 139526235}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-util.el", "start": 139526235, "end": 139547404}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-util.elc", "start": 139547404, "end": 139563954}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-vars.el", "start": 139563954, "end": 139579688}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url-vars.elc", "start": 139579688, "end": 139596364}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url.el", "start": 139596364, "end": 139609562}, {"filename": "/usr/local/share/emacs/30.2/lisp/url/url.elc", "start": 139609562, "end": 139618558}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-bind-key.el", "start": 139618558, "end": 139625073}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-bind-key.elc", "start": 139625073, "end": 139629437}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-core.el", "start": 139629437, "end": 139701914}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-core.elc", "start": 139701914, "end": 139765474}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-delight.el", "start": 139765474, "end": 139768653}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-delight.elc", "start": 139768653, "end": 139770172}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-diminish.el", "start": 139770172, "end": 139772873}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-diminish.elc", "start": 139772873, "end": 139774290}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-ensure-system-package.el", "start": 139774290, "end": 139778190}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-ensure-system-package.elc", "start": 139778190, "end": 139780543}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-ensure.el", "start": 139780543, "end": 139788785}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-ensure.elc", "start": 139788785, "end": 139793992}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-jump.el", "start": 139793992, "end": 139796947}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-jump.elc", "start": 139796947, "end": 139798377}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-lint.el", "start": 139798377, "end": 139801250}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package-lint.elc", "start": 139801250, "end": 139802439}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package.el", "start": 139802439, "end": 139804534}, {"filename": "/usr/local/share/emacs/30.2/lisp/use-package/use-package.elc", "start": 139804534, "end": 139804928}, {"filename": "/usr/local/share/emacs/30.2/lisp/userlock.el", "start": 139804928, "end": 139813864}, {"filename": "/usr/local/share/emacs/30.2/lisp/userlock.elc", "start": 139813864, "end": 139820336}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/add-log.el", "start": 139820336, "end": 139874968}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/add-log.elc", "start": 139874968, "end": 139914456}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/compare-w.el", "start": 139914456, "end": 139931933}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/compare-w.elc", "start": 139931933, "end": 139943547}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/cvs-status.el", "start": 139943547, "end": 139961092}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/cvs-status.elc", "start": 139961092, "end": 139981898}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/diff-mode.el", "start": 139981898, "end": 140117741}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/diff-mode.elc", "start": 140117741, "end": 140207339}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/diff.el", "start": 140207339, "end": 140218677}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/diff.elc", "start": 140218677, "end": 140227491}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-diff.el", "start": 140227491, "end": 140280907}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-diff.elc", "start": 140280907, "end": 140316728}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-help.el", "start": 140316728, "end": 140329988}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-help.elc", "start": 140329988, "end": 140341756}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-hook.el", "start": 140341756, "end": 140351066}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-hook.elc", "start": 140351066, "end": 140357315}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-init.el", "start": 140357315, "end": 140418033}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-init.elc", "start": 140418033, "end": 140484034}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-merg.el", "start": 140484034, "end": 140498245}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-merg.elc", "start": 140498245, "end": 140507831}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-mult.el", "start": 140507831, "end": 140599932}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-mult.elc", "start": 140599932, "end": 140664168}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-ptch.el", "start": 140664168, "end": 140696628}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-ptch.elc", "start": 140696628, "end": 140717184}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-util.el", "start": 140717184, "end": 140868977}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-util.elc", "start": 140868977, "end": 140987399}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-vers.el", "start": 140987399, "end": 140994898}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-vers.elc", "start": 140994898, "end": 140999692}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-wind.el", "start": 140999692, "end": 141046719}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff-wind.elc", "start": 141046719, "end": 141076250}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff.el", "start": 141076250, "end": 141137369}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/ediff.elc", "start": 141137369, "end": 141178341}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/emerge.el", "start": 141178341, "end": 141296952}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/emerge.elc", "start": 141296952, "end": 141377261}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/log-edit.el", "start": 141377261, "end": 141435906}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/log-edit.elc", "start": 141435906, "end": 141477883}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/log-view.el", "start": 141477883, "end": 141501251}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/log-view.elc", "start": 141501251, "end": 141519933}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs-defs.el", "start": 141519933, "end": 141532507}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs-defs.elc", "start": 141532507, "end": 141544087}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs-info.el", "start": 141544087, "end": 141561020}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs-info.elc", "start": 141561020, "end": 141583430}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs-parse.el", "start": 141583430, "end": 141604643}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs-parse.elc", "start": 141604643, "end": 141618958}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs-util.el", "start": 141618958, "end": 141631036}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs-util.elc", "start": 141631036, "end": 141652869}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs.el", "start": 141652869, "end": 141752371}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/pcvs.elc", "start": 141752371, "end": 141842621}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/smerge-mode.el", "start": 141842621, "end": 141901680}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/smerge-mode.elc", "start": 141901680, "end": 141942769}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-annotate.el", "start": 141942769, "end": 141974945}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-annotate.elc", "start": 141974945, "end": 142001500}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-bzr.el", "start": 142001500, "end": 142058414}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-bzr.elc", "start": 142058414, "end": 142101363}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-cvs.el", "start": 142101363, "end": 142155361}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-cvs.elc", "start": 142155361, "end": 142197073}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-dav.el", "start": 142197073, "end": 142202384}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-dav.elc", "start": 142202384, "end": 142205448}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-dir.el", "start": 142205448, "end": 142267150}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-dir.elc", "start": 142267150, "end": 142317012}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-dispatcher.el", "start": 142317012, "end": 142354250}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-dispatcher.elc", "start": 142354250, "end": 142374178}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-filewise.el", "start": 142374178, "end": 142377460}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-filewise.elc", "start": 142377460, "end": 142378995}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-git.el", "start": 142378995, "end": 142475505}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-git.elc", "start": 142475505, "end": 142568205}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-hg.el", "start": 142568205, "end": 142631531}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-hg.elc", "start": 142631531, "end": 142694234}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-hooks.el", "start": 142694234, "end": 142736701}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-hooks.elc", "start": 142736701, "end": 142768603}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-rcs.el", "start": 142768603, "end": 142830439}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-rcs.elc", "start": 142830439, "end": 142868659}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-sccs.el", "start": 142868659, "end": 142887862}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-sccs.elc", "start": 142887862, "end": 142905114}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-src.el", "start": 142905114, "end": 142917158}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-src.elc", "start": 142917158, "end": 142924936}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-svn.el", "start": 142924936, "end": 142956617}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc-svn.elc", "start": 142956617, "end": 142980731}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc.el", "start": 142980731, "end": 143144146}, {"filename": "/usr/local/share/emacs/30.2/lisp/vc/vc.elc", "start": 143144146, "end": 143241864}, {"filename": "/usr/local/share/emacs/30.2/lisp/vcursor.el", "start": 143241864, "end": 143285782}, {"filename": "/usr/local/share/emacs/30.2/lisp/vcursor.elc", "start": 143285782, "end": 143310238}, {"filename": "/usr/local/share/emacs/30.2/lisp/version.el", "start": 143310238, "end": 143319801}, {"filename": "/usr/local/share/emacs/30.2/lisp/version.elc", "start": 143319801, "end": 143328493}, {"filename": "/usr/local/share/emacs/30.2/lisp/view.el", "start": 143328493, "end": 143366390}, {"filename": "/usr/local/share/emacs/30.2/lisp/view.elc", "start": 143366390, "end": 143400330}, {"filename": "/usr/local/share/emacs/30.2/lisp/visual-wrap.el", "start": 143400330, "end": 143408500}, {"filename": "/usr/local/share/emacs/30.2/lisp/visual-wrap.elc", "start": 143408500, "end": 143418182}, {"filename": "/usr/local/share/emacs/30.2/lisp/w32-fns.el", "start": 143418182, "end": 143434017}, {"filename": "/usr/local/share/emacs/30.2/lisp/w32-fns.elc", "start": 143434017, "end": 143444462}, {"filename": "/usr/local/share/emacs/30.2/lisp/w32-vars.el", "start": 143444462, "end": 143450879}, {"filename": "/usr/local/share/emacs/30.2/lisp/w32-vars.elc", "start": 143450879, "end": 143456026}, {"filename": "/usr/local/share/emacs/30.2/lisp/wasmacs-url-fetch.el", "start": 143456026, "end": 143462790}, {"filename": "/usr/local/share/emacs/30.2/lisp/wasmacs-url-fetch.elc", "start": 143462790, "end": 143467806}, {"filename": "/usr/local/share/emacs/30.2/lisp/wdired.el", "start": 143467806, "end": 143512011}, {"filename": "/usr/local/share/emacs/30.2/lisp/wdired.elc", "start": 143512011, "end": 143540875}, {"filename": "/usr/local/share/emacs/30.2/lisp/which-key.el", "start": 143540875, "end": 143660985}, {"filename": "/usr/local/share/emacs/30.2/lisp/which-key.elc", "start": 143660985, "end": 143777214}, {"filename": "/usr/local/share/emacs/30.2/lisp/whitespace.el", "start": 143777214, "end": 143877082}, {"filename": "/usr/local/share/emacs/30.2/lisp/whitespace.elc", "start": 143877082, "end": 143960142}, {"filename": "/usr/local/share/emacs/30.2/lisp/wid-browse.el", "start": 143960142, "end": 143967590}, {"filename": "/usr/local/share/emacs/30.2/lisp/wid-browse.elc", "start": 143967590, "end": 143977359}, {"filename": "/usr/local/share/emacs/30.2/lisp/wid-edit.el", "start": 143977359, "end": 144131503}, {"filename": "/usr/local/share/emacs/30.2/lisp/wid-edit.elc", "start": 144131503, "end": 144247380}, {"filename": "/usr/local/share/emacs/30.2/lisp/widget.el", "start": 144247380, "end": 144251316}, {"filename": "/usr/local/share/emacs/30.2/lisp/widget.elc", "start": 144251316, "end": 144252577}, {"filename": "/usr/local/share/emacs/30.2/lisp/windmove.el", "start": 144252577, "end": 144289489}, {"filename": "/usr/local/share/emacs/30.2/lisp/windmove.elc", "start": 144289489, "end": 144317442}, {"filename": "/usr/local/share/emacs/30.2/lisp/window-tool-bar.el", "start": 144317442, "end": 144338844}, {"filename": "/usr/local/share/emacs/30.2/lisp/window-tool-bar.elc", "start": 144338844, "end": 144356905}, {"filename": "/usr/local/share/emacs/30.2/lisp/window.el", "start": 144356905, "end": 144824707}, {"filename": "/usr/local/share/emacs/30.2/lisp/window.elc", "start": 144824707, "end": 145160212}, {"filename": "/usr/local/share/emacs/30.2/lisp/winner.el", "start": 145160212, "end": 145174803}, {"filename": "/usr/local/share/emacs/30.2/lisp/winner.elc", "start": 145174803, "end": 145187611}, {"filename": "/usr/local/share/emacs/30.2/lisp/woman.el", "start": 145187611, "end": 145363401}, {"filename": "/usr/local/share/emacs/30.2/lisp/woman.elc", "start": 145363401, "end": 145476397}, {"filename": "/usr/local/share/emacs/30.2/lisp/x-dnd.el", "start": 145476397, "end": 145551504}, {"filename": "/usr/local/share/emacs/30.2/lisp/x-dnd.elc", "start": 145551504, "end": 145597848}, {"filename": "/usr/local/share/emacs/30.2/lisp/xdg.el", "start": 145597848, "end": 145613579}, {"filename": "/usr/local/share/emacs/30.2/lisp/xdg.elc", "start": 145613579, "end": 145626435}, {"filename": "/usr/local/share/emacs/30.2/lisp/xml.el", "start": 145626435, "end": 145667059}, {"filename": "/usr/local/share/emacs/30.2/lisp/xml.elc", "start": 145667059, "end": 145692685}, {"filename": "/usr/local/share/emacs/30.2/lisp/xt-mouse.el", "start": 145692685, "end": 145715159}, {"filename": "/usr/local/share/emacs/30.2/lisp/xt-mouse.elc", "start": 145715159, "end": 145730418}, {"filename": "/usr/local/share/emacs/30.2/lisp/xwidget.el", "start": 145730418, "end": 145785276}, {"filename": "/usr/local/share/emacs/30.2/lisp/xwidget.elc", "start": 145785276, "end": 145834800}, {"filename": "/usr/local/share/emacs/30.2/lisp/yank-media.el", "start": 145834800, "end": 145842401}, {"filename": "/usr/local/share/emacs/30.2/lisp/yank-media.elc", "start": 145842401, "end": 145846992}], "remote_package_size": 145846992});

  })();

// end include: /var/folders/l2/fl54zpqn0h52frtq4vglk4c80000gn/T/tmpkuj67bkw.js
// include: /var/folders/l2/fl54zpqn0h52frtq4vglk4c80000gn/T/tmpwyv6a8i0.js

    // All the pre-js content up to here must remain later on, we need to run
    // it.
    if ((typeof ENVIRONMENT_IS_WASM_WORKER != 'undefined' && ENVIRONMENT_IS_WASM_WORKER) || (typeof ENVIRONMENT_IS_PTHREAD != 'undefined' && ENVIRONMENT_IS_PTHREAD) || (typeof ENVIRONMENT_IS_AUDIO_WORKLET != 'undefined' && ENVIRONMENT_IS_AUDIO_WORKLET)) Module['preRun'] = [];
    var necessaryPreJSTasks = Module['preRun'].slice();
  // end include: /var/folders/l2/fl54zpqn0h52frtq4vglk4c80000gn/T/tmpwyv6a8i0.js
// include: /var/folders/l2/fl54zpqn0h52frtq4vglk4c80000gn/T/tmp96bt7ybc.js

    if (!Module['preRun']) throw 'Module.preRun should exist because file support used it; did a pre-js delete it?';
    necessaryPreJSTasks.forEach((task) => {
      if (Module['preRun'].indexOf(task) < 0) throw 'All preRun tasks that exist before user pre-js code should remain after; did you replace Module or modify Module.preRun?';
    });
  // end include: /var/folders/l2/fl54zpqn0h52frtq4vglk4c80000gn/T/tmp96bt7ybc.js


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

  
  function _wasmacs_host_wait_for_input() {
      var tEnter = Date.now();
      globalThis.__wasmacsHostWaitForInputCount =
        (globalThis.__wasmacsHostWaitForInputCount || 0) + 1;
      var waitNum = globalThis.__wasmacsHostWaitForInputCount;
  
      // ── 1. Flush pending terminal output ────────────────────────
      var outBytes = globalThis.__wasmacsTerminalOutputBytes || [];
      var sentCount = globalThis.__wasmacsSentOutputCount || 0;
      if (outBytes.length > sentCount) {
        var newBytes = Array.prototype.slice.call(outBytes, sentCount);
        globalThis.__wasmacsSentOutputCount = outBytes.length;
        if (typeof self !== "undefined" && typeof self.postMessage === "function") {
          self.postMessage({ type: "terminal-output-bytes", bytes: newBytes });
        }
      }
  
      // ── 2. Block via Atomics.wait ────────────────────────────────
      var sab = globalThis.__wasmacsInputSAB;
      if (!sab) return;
      var signal = new Int32Array(sab, 0, 2);
  
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
        var result = Atomics.wait(signal, 0, lastSeen);
        if (globalThis.__wasmacsTerminalSizeSAB) {
          try {
            var sizeSignal = new Int32Array(globalThis.__wasmacsTerminalSizeSAB);
            if (Atomics.load(sizeSignal, 0) !== (globalThis.__wasmacsTerminalResizeSeen || 0))
              return;
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
function wasmacs_host_network_fetch_json(request_json) { function returnJson(value) { var json = JSON.stringify(value); var size = lengthBytesUTF8(json) + 1; var ptr = _malloc(size); if (!ptr) return 0; stringToUTF8(json, ptr, size); return ptr; } function fail(message) { return returnJson({ error: String(message) }); } function proxyFetch(request, directError) { var proxyUrl = new URL("/__wasmacs_network_fetch", typeof location !== "undefined" ? location.href : "http://127.0.0.1:5173/").href; var proxy = new XMLHttpRequest(); proxy.open("POST", proxyUrl, false); proxy.setRequestHeader("content-type", "application/json"); proxy.send(JSON.stringify(request)); if (proxy.responseText) { try { return returnJson(JSON.parse(proxy.responseText)); } catch (parseError) { return fail("host.network.fetch proxy returned invalid JSON: " + parseError.message); } } return fail("host.network.fetch direct request failed" + (directError && directError.message ? ": " + directError.message : "") + "; proxy status " + proxy.status); } function bytesToBase64(bytes) { var chunkSize = 0x8000; var binary = ""; for (var offset = 0; offset < bytes.length; offset += chunkSize) { var chunk = bytes.subarray(offset, offset + chunkSize); binary += String.fromCharCode.apply(null, chunk); } return btoa(binary); } try { var request = JSON.parse(UTF8ToString(request_json)); var url = String(request.url || ""); var parsed = new URL(url, typeof location !== "undefined" ? location.href : undefined); if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fail("unsupported URL scheme: " + parsed.protocol); var method = String(request.method || "GET").toUpperCase(); var xhr = new XMLHttpRequest(); xhr.open(method, parsed.href, false); var headers = Array.isArray(request.headers) ? request.headers : []; for (var i = 0; i < headers.length; i++) { var header = headers[i]; if (Array.isArray(header) && header.length >= 2) xhr.setRequestHeader(String(header[0]), String(header[1])); else if (header && typeof header === "object" && header.name) xhr.setRequestHeader(String(header.name), String(header.value || "")); } xhr.responseType = "arraybuffer"; xhr.send(request.body || null); var responseHeaders = []; var rawHeaders = xhr.getAllResponseHeaders() || ""; rawHeaders.trim().split(String.fromCharCode(10)).forEach(function (line) { if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1); if (!line) return; var colon = line.indexOf(":"); if (colon <= 0) return; responseHeaders.push({ name: line.slice(0, colon).trim().toLowerCase(), value: line.slice(colon + 1).trim(), }); }); var bodyBytes = new Uint8Array(xhr.response || new ArrayBuffer(0)); return returnJson({ url: xhr.responseURL || parsed.href, status: xhr.status, statusText: xhr.statusText || "", headers: responseHeaders, bodyBase64: bytesToBase64(bodyBytes), }); } catch (error) { try { var fallbackRequest = JSON.parse(UTF8ToString(request_json)); return proxyFetch(fallbackRequest, error); } catch (fallbackError) { return fail(fallbackError && fallbackError.message ? fallbackError.message : fallbackError); } } }

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

