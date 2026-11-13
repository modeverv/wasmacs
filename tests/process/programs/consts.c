/* Prints the libc constants that src/runtime/process/wasmacs-kernel.js hardcodes,
 * straight from the Emscripten headers, as JSON.  The kernel tests compare them. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <stddef.h>
#include <stdio.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#define K(x) printf("%s\"%s\": %ld", first ? "" : ", ", #x, (long)(x)), first = 0

int main(void) {
  int first = 1;
  printf("{");
  K(EPERM); K(ENOENT); K(ESRCH); K(EINTR); K(EIO); K(E2BIG); K(ENOEXEC); K(EBADF);
  K(ECHILD); K(EAGAIN); K(ENOMEM); K(EACCES); K(EFAULT); K(EEXIST); K(ENOTDIR);
  K(EISDIR); K(EINVAL); K(EMFILE); K(ENOTTY); K(ESPIPE); K(EPIPE); K(ENOSYS); K(ELOOP); K(ENXIO);
  K(O_RDONLY); K(O_WRONLY); K(O_RDWR); K(O_ACCMODE); K(O_CREAT); K(O_EXCL);
  K(O_NOCTTY); K(O_TRUNC); K(O_APPEND); K(O_NONBLOCK); K(O_CLOEXEC);
  K(S_IFMT); K(S_IFIFO); K(S_IFCHR); K(S_IFREG); K(S_IFDIR);
  K(POLLIN); K(POLLPRI); K(POLLOUT); K(POLLERR); K(POLLHUP); K(POLLNVAL);
  K(POLLRDNORM); K(POLLWRNORM);
  K(WNOHANG); K(WUNTRACED);
  K(SIGHUP); K(SIGINT); K(SIGQUIT); K(SIGILL); K(SIGABRT); K(SIGKILL); K(SIGSEGV);
  K(SIGPIPE); K(SIGALRM); K(SIGTERM); K(SIGCHLD); K(SIGCONT); K(SIGSTOP); K(SIGTSTP);
  K(SIGTTIN); K(SIGTTOU); K(SIGURG); K(SIGWINCH);
  K(FIONREAD); K(PIPE_BUF);
  K(POSIX_SPAWN_SETPGROUP); K(POSIX_SPAWN_SETSID);
  K(NCCS); K(VINTR); K(VQUIT); K(VERASE); K(VKILL); K(VEOF); K(VTIME); K(VMIN);
  K(VSTART); K(VSTOP); K(VSUSP); K(VEOL); K(VREPRINT); K(VWERASE); K(VLNEXT); K(VEOL2);
  K(ISTRIP); K(INLCR); K(IGNCR); K(ICRNL); K(IXON); K(IXANY); K(IUTF8);
  K(OPOST); K(ONLCR); K(OCRNL); K(ONOCR); K(ONLRET); K(TABDLY); K(XTABS);
  K(B38400); K(CS8); K(CREAD); K(HUPCL);
  K(ISIG); K(ICANON); K(ECHO); K(ECHOE); K(ECHOK); K(ECHONL); K(NOFLSH); K(ECHOCTL); K(ECHOKE); K(IEXTEN);
  K(TCGETS); K(TCSETS); K(TCSETSW); K(TCSETSF); K(TCSBRK); K(TCXONC); K(TCFLSH); K(TIOCSCTTY);
  K(TIOCGPGRP); K(TIOCSPGRP); K(TIOCOUTQ); K(TIOCGWINSZ); K(TIOCSWINSZ); K(FIONBIO); K(TIOCNOTTY);
  K(TCSBRKP); K(TIOCGSID); K(TIOCGPTN); K(TIOCSPTLCK); K(FIONCLEX); K(FIOCLEX);
  K(TCOOFF); K(TCOON); K(TCIFLUSH); K(TCOFLUSH); K(TCIOFLUSH);
  printf(", \"NSIG\": %d, \"F_DUPFD_CLOEXEC\": %d, \"sizeof_pollfd\": %d", _NSIG, F_DUPFD_CLOEXEC, (int)sizeof(struct pollfd));
  printf(", \"sizeof_termios\": %d, \"termios_c_cc\": %d}\n", (int)sizeof(struct termios), (int)offsetof(struct termios, c_cc));
  return 0;
}
