/*
 * wasmacs-child-rt.c -- C side of the wasmacs process runtime.
 *
 * Linked into every program that runs as a process under the wasmacs kernel.
 * It replaces Emscripten's "there are no processes" stubs
 * (system/lib/libc/emscripten_libc_stubs.c: fork/vfork/execve/posix_spawn,
 * system/lib/libc/emscripten_syscall_stubs.c: __syscall_wait4/getpid/...,
 * system/lib/libc/kill.c) with calls into the kernel.  The kernel entry points
 * are JS imports implemented in wasmacs-child-library.js.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include <emscripten.h>

/* ---- kernel entry points (JS imports) ------------------------------------ */
int wasmacs_k_fork(void);                 /* may unwind (Asyncify) */
int wasmacs_k_vfork(void);                /* may unwind */
int wasmacs_k_wait4(int pid, int *wstatus, int options, void *rusage); /* may unwind */
int wasmacs_k_sleep(int ms_lo, int ms_hi);  /* may unwind; returns 0 or -EINTR */
int wasmacs_k_pause(void);                /* may unwind; returns -EINTR */
int wasmacs_k_execve(const char *path, char *const argv[], char *const envp[]);
int wasmacs_k_spawn(pid_t *pid, const char *path, const int *ops, int nops,
                    char *const argv[], char *const envp[], const char *search_path,
                    int flags, int pgroup);
int wasmacs_k_getpid(void);
int wasmacs_k_getppid(void);
int wasmacs_k_getpgid(int pid);
int wasmacs_k_setpgid(int pid, int pgid);
int wasmacs_k_getsid(int pid);
int wasmacs_k_setsid(void);
int wasmacs_k_kill(int pid, int sig);

extern char **environ;

/* ---- fork / vfork / exec -------------------------------------------------- */
pid_t fork(void) {
  int r = wasmacs_k_fork();
  if (r < 0) { errno = -r; return -1; }
  return r;
}

/* vfork() is fork() plus "the parent stays suspended until the child calls
 * execve() or _exit()".  The child works on a copy of the address space, which
 * POSIX allows. */
pid_t vfork(void) {
  int r = wasmacs_k_vfork();
  if (r < 0) { errno = -r; return -1; }
  return r;
}

int execve(const char *path, char *const argv[], char *const envp[]) {
  /* Only returns on failure. */
  int r = wasmacs_k_execve(path, argv, envp ? envp : environ);
  errno = -r;
  return -1;
}

/* ---- wait / ids ----------------------------------------------------------- */
int __syscall_wait4(int pid, intptr_t wstatus, int options, int rusage) {
  return wasmacs_k_wait4(pid, (int *)wstatus, options, (void *)(intptr_t)rusage);
}
int __syscall_getpid(void) { return wasmacs_k_getpid(); }
int __syscall_getppid(void) { return wasmacs_k_getppid(); }
int __syscall_getpgid(int pid) { return wasmacs_k_getpgid(pid); }
int __syscall_setpgid(int pid, int pgid) { return wasmacs_k_setpgid(pid, pgid); }
int __syscall_getsid(int pid) { return wasmacs_k_getsid(pid); }
int __syscall_setsid(void) { return wasmacs_k_setsid(); }
int __syscall_pause(void) { return wasmacs_k_pause(); }

/* ---- signals --------------------------------------------------------------
 * Signals between processes are delivered by the kernel.  The handler tables
 * and the signal mask stay in Emscripten's libc (sigaction.c, raise.c,
 * pthread_sigmask.c); the kernel asks for the disposition and runs handlers
 * through the two exported helpers below. */
int kill(pid_t pid, int sig) {
  int r = wasmacs_k_kill(pid, sig);
  if (r < 0) { errno = -r; return -1; }
  return 0;
}

/* 0 = default action, 1 = ignored, 2 = a handler is installed. */
EMSCRIPTEN_KEEPALIVE int wasmacs_rt_sig_disposition(int sig) {
  struct sigaction sa;
  if (sig <= 0 || sig >= _NSIG || sigaction(sig, NULL, &sa) != 0) return 0;
  if (sa.sa_flags & SA_SIGINFO) return 2;
  if (sa.sa_handler == SIG_DFL) return 0;
  if (sa.sa_handler == SIG_IGN) return 1;
  return 2;
}

/* Run the handler of SIG now (or leave it pending in libc when it is masked). */
EMSCRIPTEN_KEEPALIVE void wasmacs_rt_deliver_signal(int sig) {
  raise(sig);
}

int sigsuspend(const sigset_t *mask) {
  sigset_t old;
  sigprocmask(SIG_SETMASK, mask, &old);
  int r = wasmacs_k_pause();
  sigprocmask(SIG_SETMASK, &old, NULL);
  errno = -r;
  return -1;
}

/* ---- sleeping -------------------------------------------------------------
 * Emscripten's nanosleep busy-waits in single-threaded builds
 * (emscripten_thread_sleep).  Block in the kernel instead so that other
 * processes and Emacs keep running. */
int nanosleep(const struct timespec *req, struct timespec *rem) {
  if (!req || req->tv_nsec < 0 || req->tv_nsec > 999999999L || req->tv_sec < 0) {
    errno = EINVAL;
    return -1;
  }
  long long ms = (long long)req->tv_sec * 1000 + (req->tv_nsec + 999999) / 1000000;
  int r = wasmacs_k_sleep((int)(ms & 0xffffffff), (int)(ms >> 32));
  if (r < 0) {
    if (rem) { rem->tv_sec = 0; rem->tv_nsec = 0; }
    errno = -r;
    return -1;
  }
  return 0;
}

int clock_nanosleep(clockid_t clk, int flags, const struct timespec *req, struct timespec *rem) {
  if (flags & TIMER_ABSTIME) {
    struct timespec now, d;
    if (clock_gettime(clk, &now) != 0) return errno;
    d.tv_sec = req->tv_sec - now.tv_sec;
    d.tv_nsec = req->tv_nsec - now.tv_nsec;
    if (d.tv_nsec < 0) { d.tv_nsec += 1000000000L; d.tv_sec -= 1; }
    if (d.tv_sec < 0) return 0;
    return nanosleep(&d, NULL) == 0 ? 0 : errno;
  }
  return nanosleep(req, rem) == 0 ? 0 : errno;
}

int usleep(useconds_t usec) {
  struct timespec ts = { usec / 1000000, (long)(usec % 1000000) * 1000 };
  return nanosleep(&ts, NULL);
}

unsigned sleep(unsigned seconds) {
  struct timespec ts = { seconds, 0 };
  return nanosleep(&ts, NULL) == 0 ? 0 : seconds;
}

/* ---- posix_spawn / posix_spawnp (implemented in the kernel: no memory copy) */

/* musl's private file-action record (system/lib/libc/musl/src/process/fdop.h) */
struct fdop {
  struct fdop *next, *prev;
  int cmd, fd, srcfd, oflag;
  mode_t mode;
  char path[];
};

static int do_spawn(pid_t *restrict res, const char *restrict path,
                    const posix_spawn_file_actions_t *fa,
                    const posix_spawnattr_t *restrict attr,
                    char *const argv[restrict], char *const envp[restrict],
                    const char *search_path) {
  int n = 0, i = 0;
  struct fdop *op = fa ? (struct fdop *)fa->__actions : 0;
  struct fdop *last = 0;
  short flags = 0;
  pid_t pgroup = 0;
  if (attr) {
    posix_spawnattr_getflags(attr, &flags);
    posix_spawnattr_getpgroup(attr, &pgroup);
  }
  /* __actions points at the most recently added action; ->next leads to the
   * older ones.  Actions must be applied oldest first. */
  for (; op; op = op->next) { last = op; n++; }
  int *ops = n ? malloc(sizeof(int) * 6 * n) : 0;
  if (n && !ops) return ENOMEM;
  for (op = last; op; op = op->prev, i++) {
    ops[i * 6 + 0] = op->cmd;
    ops[i * 6 + 1] = op->fd;
    ops[i * 6 + 2] = op->srcfd;
    ops[i * 6 + 3] = op->oflag;
    ops[i * 6 + 4] = (int)op->mode;
    ops[i * 6 + 5] = (op->cmd == 3 /* FDOP_OPEN */ || op->cmd == 4 /* FDOP_CHDIR */)
                         ? (int)(intptr_t)op->path : 0;
  }
  int r = wasmacs_k_spawn(res, path, ops, n, argv, envp ? envp : environ, search_path,
                          flags, pgroup);
  free(ops);
  return r; /* an errno value, as posix_spawn() specifies */
}

int posix_spawn(pid_t *restrict res, const char *restrict path,
                const posix_spawn_file_actions_t *fa,
                const posix_spawnattr_t *restrict attr,
                char *const argv[restrict], char *const envp[restrict]) {
  return do_spawn(res, path, fa, attr, argv, envp, 0);
}

int posix_spawnp(pid_t *restrict res, const char *restrict file,
                 const posix_spawn_file_actions_t *fa,
                 const posix_spawnattr_t *restrict attr,
                 char *const argv[restrict], char *const envp[restrict]) {
  const char *path = getenv("PATH");
  return do_spawn(res, file, fa, attr, argv, envp, path ? path : "/bin:/usr/bin");
}

/* ---- system() ------------------------------------------------------------- */
int system(const char *cmd) {
  if (!cmd) return 1;
  pid_t pid;
  char *argv[] = { "sh", "-c", (char *)cmd, 0 };
  int r = posix_spawn(&pid, "/bin/sh", 0, 0, argv, environ);
  if (r != 0) { errno = r; return -1; }
  int status;
  while (waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR) return -1;
  }
  return status;
}

/* ---- libc gaps -------------------------------------------------------------
 * Linux system calls that Emscripten's headers declare but its libc does not
 * implement.  Programs that use them as an optimisation fall back to plain
 * read()/write() when they fail this way (GNU grep: splice to /dev/null). */
ssize_t splice(int fd_in, off_t *off_in, int fd_out, off_t *off_out, size_t len, unsigned flags) {
  (void)fd_in; (void)off_in; (void)fd_out; (void)off_out; (void)len; (void)flags;
  errno = EINVAL;
  return -1;
}

/* ---- exit ------------------------------------------------------------------
 * Emscripten implements exit() in JS ($exitJS), which calls back into wasm
 * (atexit handlers, fflush).  If such a callback has to block (flushing stdout
 * into a full pipe) the JS frame in the middle cannot be unwound.  This is
 * musl's exit() again, so that the whole exit path is wasm. */
void __funcs_on_exit(void);
void __stdio_exit(void);

_Noreturn void exit(int code) {
  __funcs_on_exit(); /* atexit() handlers; needs -sEXIT_RUNTIME=1 */
  __stdio_exit();    /* flush all stdio streams */
  _Exit(code);       /* -> proc_exit import -> kernel */
}

/* ---- process entry ---------------------------------------------------------
 * Called by the scheduler (WK.start) instead of Emscripten's callMain().
 * Static constructors run here, inside the process. */
void __wasm_call_ctors(void);
__attribute__((weak)) int __main_argc_argv(int argc, char **argv);
__attribute__((weak)) int __main_void(void);

EMSCRIPTEN_KEEPALIVE void wasmacs_rt_start(int argc, char **argv) {
  __wasm_call_ctors();
  int rc = __main_argc_argv ? __main_argc_argv(argc, argv) : __main_void();
  exit(rc);
}
