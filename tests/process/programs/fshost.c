/* fshost.c -- stands in for Emacs in the kernel tests: a plain (not
 * asyncified) Emscripten program whose only job is to own the shared FS and a
 * heap that the test driver uses for system call arguments. */
#include <signal.h>
#include <emscripten.h>

static volatile int sigchld_count;
static void on_sigchld(int sig) { (void)sig; sigchld_count++; }

EMSCRIPTEN_KEEPALIVE int fshost_sigchld_count(void) { return sigchld_count; }
EMSCRIPTEN_KEEPALIVE void fshost_raise(int sig) { raise(sig); }

int main(void) {
  signal(SIGCHLD, on_sigchld);
  return 0;
}
