# config.mak for building git with Emscripten as a wasmacs process image.
#
# build.sh copies this file to <git-src>/config.mak.  git's Makefile includes
# config.mak right after config.mak.uname (Makefile:1042-1044), so everything
# here overrides the uname-derived defaults.  The uname_* variables themselves
# MUST be given on the gmake command line (see build.sh): config.mak.uname runs
# `uname -s` on the build host and would otherwise apply the Darwin block
# (CommonCrypto, precompose_utf8.o, -framework CoreServices, arc4random ...).

# ---- toolchain -------------------------------------------------------------
CC = emcc
AR = emar
# -sUSE_ZLIB=1 is needed at compile time (zlib.h include path) and at link time
# (libz.a from the Emscripten port).  CFLAGS is part of the link line as well
# (Makefile:2654 "$(CC) $(ALL_CFLAGS) -o $@ $(ALL_LDFLAGS) ...").
CFLAGS = -O2 -sUSE_ZLIB=1 $(WASMACS_EXTRA_CFLAGS)
# LDFLAGS is supplied per flavour by build.sh on the command line.

# ---- installation layout compiled into the binary ----------------------------
# prefix=/usr gives: exec-path /usr/libexec/git-core, system config /etc/gitconfig,
# templates /usr/share/git-core/templates (Makefile: sysconfdir=/etc iff prefix=/usr).
prefix = /usr

# ---- things we do not have / do not want -------------------------------------
# Homebrew's shellenv exports HOMEBREW_PREFIX; git's Makefile (1714-1730) then adds
# -I/opt/homebrew/opt/gettext/include and -L.../lib (host headers!) to every
# compile even though this is a cross build.
NO_HOMEBREW = YesPlease
NO_OPENSSL = YesPlease
NO_CURL = YesPlease
NO_EXPAT = YesPlease
NO_GETTEXT = YesPlease
NO_PERL = YesPlease
NO_PYTHON = YesPlease
NO_TCLTK = YesPlease
NO_ICONV = YesPlease
NO_PTHREADS = YesPlease
NO_MMAP = YesPlease
NO_UNIX_SOCKETS = YesPlease
NO_IPV6 = YesPlease
# musl's regexec() has no REG_STARTEND -> use the bundled compat/regex.
NO_REGEX = NeedsStartEnd
# setitimer() exists in Emscripten but its timer is a JS setTimeout() that can
# never fire while a synchronous program is running; git only uses it for the
# progress meter and early-output.  The stub in git-compat-util.h "pretends
# success".
NO_SETITIMER = YesPlease
SKIP_DASHED_BUILT_INS = YesPlease
NO_INSTALL_HARDLINKS = YesPlease

# ---- things we do have (same set the Linux block of config.mak.uname uses) ---
HAVE_ALLOCA_H = YesPlease
HAVE_PATHS_H = YesPlease
HAVE_STRINGS_H = YesPlease
HAVE_CLOCK_GETTIME = YesPlease
HAVE_CLOCK_MONOTONIC = YesPlease
HAVE_GETDELIM = YesPlease
HAVE_DEV_TTY = YesPlease
FREAD_READS_DIRECTORIES = UnfortunatelyYes
# getentropy() -> __wasi_random_get -> crypto.getRandomValues (no /dev/urandom needed)
CSPRNG_METHOD = getentropy

# ---- behaviour defaults ----------------------------------------------------------
# There is no terminal to page on (Emacs talks to git through pipes).  "cat" is
# special-cased in pager.c (git_pager() returns NULL -> no subprocess).
DEFAULT_PAGER = cat

# ---- helper target used by build.sh -------------------------------------------
# Compile everything the "git" link needs, without linking.  The recipe is
# expanded late, so $(BUILTIN_OBJS)/$(LIB_FILE) are complete even though this
# file is included in the middle of the Makefile.
.PHONY: wasmacs-objects
wasmacs-objects:
	+@$(MAKE) --no-print-directory git.o common-main.o $(BUILTIN_OBJS) $(LIB_FILE)

# Compile the pinned upstream remote helper against the browser HTTP adapter.
# NO_CURL stays enabled for libgit and the main binary: no socket-backed curl,
# SOCKFS, threads, native TLS or HTTP protocol implementation is linked.
remote-curl.o: remote-curl.c $(WASMACS_HTTP_INCLUDE)/curl/curl.h $(WASMACS_HTTP_INCLUDE)/curl/easy.h
	$(CC) $(ALL_CFLAGS) -I$(WASMACS_HTTP_INCLUDE) -c $< -o $@
wasmacs-http-browser.o: wasmacs-http-browser.c $(WASMACS_HTTP_INCLUDE)/curl/curl.h $(WASMACS_HTTP_INCLUDE)/curl/easy.h
	$(CC) $(ALL_CFLAGS) -I$(WASMACS_HTTP_INCLUDE) -c $< -o $@
.PHONY: wasmacs-http-objects
wasmacs-http-objects:
	+@$(MAKE) --no-print-directory remote-curl.o wasmacs-http-browser.o $(GITLIBS)
git-http$X: remote-curl.o wasmacs-http-browser.o $(GITLIBS)
	$(CC) $(ALL_CFLAGS) -o $@ $(ALL_LDFLAGS) $(filter %.o,$^) $(LIBS)
