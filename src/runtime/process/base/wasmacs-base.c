/* wasmacs-base.c -- the system module when Emacs is not init.
 *
 * The process kernel needs one Emscripten filesystem that every process
 * shares.  When Emacs is init, that is the filesystem of Emacs's own module.
 * When another program is init (/bin/sh on the console, see
 * ../wasmacs-boot.js), nothing has loaded Emacs, and this module provides the
 * filesystem instead: a program that does nothing, linked with the complete
 * Emscripten FS.  It never runs as a process.  */
int main(void) { return 0; }
