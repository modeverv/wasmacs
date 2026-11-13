/* Prints the libc constants that src/runtime/process/wasmacs-kernel.js hardcodes,
 * straight from the Emscripten headers, as JSON.  The kernel tests compare them. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#define K(x) printf("%s\"%s\": %ld", first ? "" : ", ", #x, (long)(x)), first = 0

int main(void) {
  int first = 1;
  printf("{");
  K(EPERM); K(ENOENT); K(ESRCH); K(EINTR); K(EIO); K(E2BIG); K(ENOEXEC); K(EBADF);
  K(ECHILD); K(EAGAIN); K(ENOMEM); K(EACCES); K(EFAULT); K(EEXIST); K(ENOTDIR);
  K(EISDIR); K(EINVAL); K(EMFILE); K(ENOTTY); K(ESPIPE); K(EPIPE); K(ENOSYS); K(ELOOP);
  K(O_RDONLY); K(O_WRONLY); K(O_RDWR); K(O_ACCMODE); K(O_CREAT); K(O_EXCL);
  K(O_TRUNC); K(O_APPEND); K(O_NONBLOCK); K(O_CLOEXEC);
  K(S_IFMT); K(S_IFIFO); K(S_IFCHR); K(S_IFREG); K(S_IFDIR);
  K(POLLIN); K(POLLPRI); K(POLLOUT); K(POLLERR); K(POLLHUP); K(POLLNVAL);
  K(POLLRDNORM); K(POLLWRNORM);
  K(WNOHANG); K(WUNTRACED);
  K(SIGHUP); K(SIGINT); K(SIGQUIT); K(SIGILL); K(SIGABRT); K(SIGKILL); K(SIGSEGV);
  K(SIGPIPE); K(SIGALRM); K(SIGTERM); K(SIGCHLD); K(SIGCONT); K(SIGSTOP); K(SIGTSTP);
  K(SIGTTIN); K(SIGTTOU); K(SIGURG); K(SIGWINCH);
  K(FIONREAD); K(PIPE_BUF);
  K(POSIX_SPAWN_SETPGROUP); K(POSIX_SPAWN_SETSID);
  printf(", \"NSIG\": %d, \"F_DUPFD_CLOEXEC\": %d, \"sizeof_pollfd\": %d}\n", _NSIG, F_DUPFD_CLOEXEC, (int)sizeof(struct pollfd));
  return 0;
}
