/*
 * ktest.c -- multi-mode test program for the wasmacs process kernel.
 *
 *   ktest <mode> [args...]
 *
 * Built by tests/process/build-test-programs.sh and driven by
 * tests/process/run-kernel-tests.mjs (no Emacs involved) and by the Emacs
 * integration probes.
 */
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <setjmp.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern char **environ;

static int fail(const char *what) {
  printf("FAIL %s: %s\n", what, strerror(errno));
  fflush(stdout);
  return 1;
}

/* ---- hello: argv, environment, cwd ---------------------------------------- */
static int mode_hello(int argc, char **argv) {
  char cwd[256];
  printf("argc=%d\n", argc);
  for (int i = 0; i < argc; i++) printf("argv[%d]=%s\n", i, argv[i]);
  printf("KTEST_VAR=%s\n", getenv("KTEST_VAR") ? getenv("KTEST_VAR") : "(unset)");
  printf("cwd=%s\n", getcwd(cwd, sizeof cwd) ? cwd : "?");
  printf("pid=%d ppid=%d pgid=%d\n", getpid(), getppid(), getpgid(0));
  printf("isatty=%d%d%d\n", isatty(0), isatty(1), isatty(2));
  fprintf(stderr, "hello-stderr\n");
  return argc;
}

/* ---- cat: stdin -> stdout until EOF ----------------------------------------- */
static int mode_cat(void) {
  char buf[4096];
  ssize_t n;
  long total = 0;
  while ((n = read(0, buf, sizeof buf)) > 0) {
    ssize_t off = 0;
    while (off < n) {
      ssize_t w = write(1, buf + off, n - off);
      if (w < 0) return fail("write");
      off += w;
    }
    total += n;
  }
  if (n < 0) return fail("read");
  fprintf(stderr, "cat: %ld bytes\n", total);
  return 0;
}

/* ---- produce N: N numbered lines -------------------------------------------- */
static int mode_produce(long n) {
  for (long i = 0; i < n; i++) printf("line %ld of the producer output\n", i);
  return 0;
}

/* ---- count: lines and a checksum of stdin ----------------------------------- */
static int mode_count(void) {
  char buf[8192];
  ssize_t n;
  long lines = 0, bytes = 0;
  unsigned long sum = 0;
  while ((n = read(0, buf, sizeof buf)) > 0) {
    for (ssize_t i = 0; i < n; i++) {
      sum = sum * 31 + (unsigned char)buf[i];
      if (buf[i] == '\n') lines++;
    }
    bytes += n;
  }
  printf("lines=%ld bytes=%ld sum=%lu\n", lines, bytes, sum);
  return 0;
}

/* ---- fsops: the filesystem is shared with the host -------------------------- */
static int mode_fsops(const char *dir) {
  char path[512], buf[128];
  struct stat st;
  if (mkdir(dir, 0755) != 0 && errno != EEXIST) return fail("mkdir");
  snprintf(path, sizeof path, "%s/from-child.txt", dir);
  FILE *f = fopen(path, "w");
  if (!f) return fail("fopen w");
  fputs("written by the child\n", f);
  fclose(f);
  if (stat(path, &st) != 0 || st.st_size != 21) return fail("stat size");
  snprintf(path, sizeof path, "%s/from-host.txt", dir);
  f = fopen(path, "r");
  if (!f) return fail("fopen host file");
  if (!fgets(buf, sizeof buf, f)) return fail("fgets");
  fclose(f);
  printf("host-file=%s", buf);
  if (chdir(dir) != 0) return fail("chdir");
  if (rename("from-child.txt", "renamed.txt") != 0) return fail("rename");
  if (symlink("renamed.txt", "link.txt") != 0) return fail("symlink");
  if (readlink("link.txt", buf, sizeof buf) != 11) return fail("readlink");
  if (chmod("renamed.txt", 0600) != 0) return fail("chmod");
  DIR *d = opendir(".");
  if (!d) return fail("opendir");
  int n = 0;
  struct dirent *e;
  while ((e = readdir(d))) if (e->d_name[0] != '.') n++;
  closedir(d);
  printf("entries=%d cwd=%s\n", n, getcwd(buf, sizeof buf));
  /* mmap of a file must read into this process's own memory */
  int fd = open("renamed.txt", O_RDONLY);
  if (fd < 0) return fail("open for mmap");
  char *m = mmap(0, 21, PROT_READ, MAP_PRIVATE, fd, 0);
  if (m == MAP_FAILED) return fail("mmap");
  printf("mmap=%.*s", 21, m);
  munmap(m, 21);
  close(fd);
  if (unlink("link.txt") != 0) return fail("unlink");
  return 0;
}

/* ---- fork: memory is copied, descriptors are shared ------------------------- */
static int deep(int depth, int *pfd) {
  volatile char pad[256];
  for (unsigned i = 0; i < sizeof pad; i++) pad[i] = (char)depth;
  if (depth > 0) {
    int r = deep(depth - 1, pfd);
    return pad[17] == (char)depth ? r : -1000;
  }
  pid_t pid = fork();
  if (pid < 0) return -1;
  if (pid == 0) {
    close(pfd[0]);
    const char *msg = "from the forked child\n";
    write(pfd[1], msg, strlen(msg));
    return 0; /* the child returns through all frames too */
  }
  return pid;
}

static int mode_fork(void) {
  int pfd[2];
  static int counter = 41;
  char *heap = strdup("heap-before-fork");
  if (pipe(pfd) != 0) return fail("pipe");
  printf("unflushed-before-fork ");
  int r = deep(20, pfd);
  if (r == -1000 || r < 0) return fail("fork/deep");
  if (r == 0) {
    /* child */
    counter = 1000;
    strcpy(heap, "child-heap");
    printf("child counter=%d heap=%s\n", counter, heap);
    exit(7);
  }
  close(pfd[1]);
  char buf[64];
  ssize_t n, total = 0;
  while ((n = read(pfd[0], buf + total, sizeof buf - 1 - total)) > 0) total += n;
  buf[total] = 0;
  int status;
  if (waitpid(r, &status, 0) != r) return fail("waitpid");
  counter++;
  printf("parent counter=%d heap=%s status=%d msg=%s", counter, heap,
         WIFEXITED(status) ? WEXITSTATUS(status) : -1, buf);
  return 0;
}

/* ---- pipeline: what a shell does for "produce N | count" -------------------- */
static int mode_pipeline(const char *self, const char *n, int use_vfork) {
  int pfd[2];
  if (pipe(pfd) != 0) return fail("pipe");
  pid_t a = use_vfork ? vfork() : fork();
  if (a < 0) return fail("fork a");
  if (a == 0) {
    dup2(pfd[1], 1);
    close(pfd[0]);
    close(pfd[1]);
    execl(self, "ktest", "produce", n, (char *)0);
    _exit(127);
  }
  pid_t b = use_vfork ? vfork() : fork();
  if (b < 0) return fail("fork b");
  if (b == 0) {
    dup2(pfd[0], 0);
    close(pfd[0]);
    close(pfd[1]);
    execl(self, "ktest", "count", (char *)0);
    _exit(127);
  }
  close(pfd[0]);
  close(pfd[1]);
  int sa, sb;
  if (waitpid(a, &sa, 0) != a || waitpid(b, &sb, 0) != b) return fail("waitpid");
  printf("pipeline status=%d,%d\n", WEXITSTATUS(sa), WEXITSTATUS(sb));
  return 0;
}

/* ---- spawn: posix_spawnp + wait ---------------------------------------------- */
static int mode_spawn(void) {
  pid_t pid;
  char *argv[] = { "ktest", "hello", "spawned", 0 };
  int r = posix_spawnp(&pid, "ktest", 0, 0, argv, environ);
  if (r != 0) { errno = r; return fail("posix_spawnp"); }
  int status;
  if (waitpid(pid, &status, 0) != pid) return fail("waitpid");
  printf("spawn status=%d\n", WEXITSTATUS(status));
  r = posix_spawnp(&pid, "no-such-program", 0, 0, argv, environ);
  printf("spawn missing=%s\n", r == ENOENT ? "ENOENT" : strerror(r));
  if (waitpid(-1, &status, WNOHANG) != -1 || errno != ECHILD) return fail("ECHILD");
  printf("system=%d\n", WEXITSTATUS(system("exit 9")));
  return 0;
}

/* ---- signals ------------------------------------------------------------------ */
static volatile sig_atomic_t got_signal;
static void on_signal(int sig) { got_signal = sig; }

static int mode_sigread(void) {
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = on_signal;
  sigaction(SIGINT, &sa, 0);
  signal(SIGUSR1, SIG_IGN);
  printf("ready\n");
  fflush(stdout);
  char c;
  ssize_t n = read(0, &c, 1);
  printf("read=%zd errno=%s got=%d\n", n, n < 0 && errno == EINTR ? "EINTR" : "other", (int)got_signal);
  fflush(stdout);
  n = read(0, &c, 1); /* blocks again; a second SIGINT interrupts again */
  printf("second=%zd got=%d\n", n, (int)got_signal);
  return 5;
}

static sigjmp_buf jb;
static void on_jump(int sig) { siglongjmp(jb, sig); }

static int mode_sigjmp(void) {
  signal(SIGINT, on_jump);
  int sig = sigsetjmp(jb, 1);
  if (sig == 0) {
    printf("ready\n");
    fflush(stdout);
    char c;
    read(0, &c, 1);
    printf("not interrupted\n");
    return 1;
  }
  printf("jumped out of read with signal %d\n", sig);
  return 0;
}

static int mode_block(void) {
  printf("ready\n");
  fflush(stdout);
  char c;
  read(0, &c, 1);
  return 0;
}

/* ---- sleep MS: kernel timers --------------------------------------------------- */
static int mode_sleep(long ms) {
  struct timespec ts = { ms / 1000, (ms % 1000) * 1000000L }, a, b;
  clock_gettime(CLOCK_MONOTONIC, &a);
  nanosleep(&ts, 0);
  clock_gettime(CLOCK_MONOTONIC, &b);
  long elapsed = (b.tv_sec - a.tv_sec) * 1000 + (b.tv_nsec - a.tv_nsec) / 1000000;
  printf("slept>=%ld %s\n", ms, elapsed >= ms - 2 ? "ok" : "TOO-SHORT");
  return 0;
}

/* ---- spin MS: a busy process must not starve the host --------------------------- */
static int mode_spin(long ms) {
  struct timespec a, b;
  clock_gettime(CLOCK_MONOTONIC, &a);
  unsigned long iterations = 0;
  struct stat st;
  for (;;) {
    stat("/", &st); /* a preemption point */
    iterations++;
    clock_gettime(CLOCK_MONOTONIC, &b);
    if ((b.tv_sec - a.tv_sec) * 1000 + (b.tv_nsec - a.tv_nsec) / 1000000 >= ms) break;
  }
  printf("spin done iterations=%lu\n", iterations);
  return 0;
}

/* ---- exits ------------------------------------------------------------------------ */
static int mode_crash(const char *how) {
  if (!strcmp(how, "abort")) abort();
  if (!strcmp(how, "segv")) { volatile int *p = (int *)0xfffffff0u; *p = 1; }
  if (!strcmp(how, "exit3")) exit(3);
  if (!strcmp(how, "return4")) return 4;
  if (!strcmp(how, "kill-self")) { kill(getpid(), SIGTERM); return 99; }
  return 98;
}

/* ---- fdcheck FD: is a descriptor open in this image? ------------------------------- */
static int mode_fdcheck(int fd) {
  printf("fd %d %s\n", fd, fcntl(fd, F_GETFD) >= 0 ? "open" : "closed");
  return 0;
}

static int mode_cloexec(const char *self) {
  int keep = open("/tmp", O_RDONLY | O_DIRECTORY);
  int gone = open("/tmp", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  int dupped = fcntl(gone, F_DUPFD_CLOEXEC, 20);
  int cleared = dup(gone); /* dup clears FD_CLOEXEC */
  char a[16], b[16], c[16], d[16];
  snprintf(a, sizeof a, "%d", keep);
  snprintf(b, sizeof b, "%d", gone);
  snprintf(c, sizeof c, "%d", dupped);
  snprintf(d, sizeof d, "%d", cleared);
  printf("flags keep=%d gone=%d dupped=%d cleared=%d\n", fcntl(keep, F_GETFD), fcntl(gone, F_GETFD),
         fcntl(dupped, F_GETFD), fcntl(cleared, F_GETFD));
  fflush(stdout);
  pid_t pid = fork();
  if (pid == 0) {
    execl(self, "ktest", "fdcheck4", a, b, c, d, (char *)0);
    _exit(127);
  }
  int status;
  waitpid(pid, &status, 0);
  return WEXITSTATUS(status);
}

/* FIOCLEX/FIONCLEX affect descriptor flags, including files and pipes. */
static int mode_ioctl_cloexec(const char *self) {
  int file = open("/bin/ktest", O_RDONLY);
  if (file < 0) return fail("open");
  int duplicate = dup(file), pfd[2];
  if (duplicate < 0 || pipe(pfd) != 0) return fail("dup/pipe");
  if (ioctl(file, FIOCLEX) != 0 || ioctl(duplicate, FIOCLEX) != 0
      || ioctl(duplicate, FIONCLEX) != 0 || ioctl(pfd[0], FIOCLEX) != 0
      || ioctl(pfd[1], FIOCLEX) != 0 || ioctl(pfd[1], FIONCLEX) != 0) {
    return fail("ioctl close-on-exec");
  }
  printf("ioctl flags file=%d duplicate=%d pipe-read=%d pipe-write=%d\n",
         fcntl(file, F_GETFD), fcntl(duplicate, F_GETFD),
         fcntl(pfd[0], F_GETFD), fcntl(pfd[1], F_GETFD));

  int bad = dup(file);
  if (bad < 0 || close(bad) != 0) return fail("close bad fd");
  errno = 0;
  if (ioctl(bad, FIOCLEX) != -1 || errno != EBADF) return fail("FIOCLEX EBADF");
  errno = 0;
  if (ioctl(bad, FIONCLEX) != -1 || errno != EBADF) return fail("FIONCLEX EBADF");
  printf("ioctl invalid set=EBADF clear=EBADF\n");
  fflush(stdout);

  char a[16], b[16], c[16], d[16];
  snprintf(a, sizeof a, "%d", file);
  snprintf(b, sizeof b, "%d", duplicate);
  snprintf(c, sizeof c, "%d", pfd[0]);
  snprintf(d, sizeof d, "%d", pfd[1]);
  pid_t pid = fork();
  if (pid < 0) return fail("fork");
  if (pid == 0) {
    execl(self, "ktest", "fdcheck4", a, b, c, d, (char *)0);
    _exit(127);
  }
  int status;
  if (waitpid(pid, &status, 0) != pid) return fail("waitpid");
  return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}

/* ---- poll: timeout and readiness on a pipe ------------------------------------------ */
static int mode_poll(void) {
  struct pollfd p = { 0, POLLIN, 0 };
  int r = poll(&p, 1, 50);
  printf("poll-timeout=%d\n", r);
  fflush(stdout);
  r = poll(&p, 1, -1);
  char buf[16];
  ssize_t n = read(0, buf, sizeof buf);
  printf("poll-ready=%d revents=%d read=%zd\n", r, p.revents & (POLLIN | POLLHUP), n);
  return 0;
}

/* ---- big N: N bytes of a known pattern ---------------------------------------------- */
static int mode_big(long n) {
  char buf[65536];
  for (unsigned i = 0; i < sizeof buf; i++) buf[i] = (char)('a' + i % 26);
  long left = n;
  while (left > 0) {
    long chunk = left < (long)sizeof buf ? left : (long)sizeof buf;
    ssize_t w = write(1, buf, chunk);
    if (w < 0) return fail("write");
    left -= w;
  }
  return 0;
}

int main(int argc, char **argv) {
  const char *mode = argc > 1 ? argv[1] : "hello";
  if (!strcmp(mode, "hello")) return mode_hello(argc, argv);
  if (!strcmp(mode, "cat")) return mode_cat();
  if (!strcmp(mode, "produce")) return mode_produce(atol(argv[2]));
  if (!strcmp(mode, "count")) return mode_count();
  if (!strcmp(mode, "fsops")) return mode_fsops(argv[2]);
  if (!strcmp(mode, "fork")) return mode_fork();
  if (!strcmp(mode, "pipeline")) return mode_pipeline(argv[2], argv[3], 0);
  if (!strcmp(mode, "vpipeline")) return mode_pipeline(argv[2], argv[3], 1);
  if (!strcmp(mode, "spawn")) return mode_spawn();
  if (!strcmp(mode, "sigread")) return mode_sigread();
  if (!strcmp(mode, "sigjmp")) return mode_sigjmp();
  if (!strcmp(mode, "block")) return mode_block();
  if (!strcmp(mode, "sleep")) return mode_sleep(atol(argv[2]));
  if (!strcmp(mode, "spin")) return mode_spin(atol(argv[2]));
  if (!strcmp(mode, "crash")) return mode_crash(argv[2]);
  if (!strcmp(mode, "fdcheck")) return mode_fdcheck(atoi(argv[2]));
  if (!strcmp(mode, "fdcheck4")) {
    for (int i = 2; i < 6; i++) mode_fdcheck(atoi(argv[i]));
    return 0;
  }
  if (!strcmp(mode, "cloexec")) return mode_cloexec(argv[2]);
  if (!strcmp(mode, "ioctl-cloexec")) return mode_ioctl_cloexec(argv[2]);
  if (!strcmp(mode, "poll")) return mode_poll();
  if (!strcmp(mode, "big")) return mode_big(atol(argv[2]));
  printf("ktest: unknown mode %s\n", mode);
  return 2;
}
