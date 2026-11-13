/*
 * wasmacs_libc_compat.c - libc glue for BusyBox on Emscripten 5.0.7.
 *
 * Part 1: functions that BusyBox references and Emscripten's libc does not
 * provide at all (link error otherwise).  Emscripten builds musl without
 * src/signal/sigsuspend.c, without src/sched (except sched_yield.c) and
 * without src/linux (except getdents, gettid, utimes, statx, wait3, wait4);
 * see tools/system_libs.py:1161-1165 and :1366-1402.
 *
 * Part 2: saner "there is no process service" answers than the ones in
 * Emscripten's own weak stubs, which actively confuse POSIX shells.
 *
 * Every definition here is WEAK.  This object is linked before libc, so it
 * wins over libc's weak stubs, and the process service ("kernel") overrides
 * it by linking strong definitions (WASMACS_KERNEL_OBJS in build.sh).
 */
#define _GNU_SOURCE
#include <errno.h>
#include <sched.h>
#include <signal.h>
#include <string.h>
#include <stdint.h>
#include <unistd.h>

#define WEAK __attribute__((weak))

/* ===================================================== Part 1: missing */

/*
 * sigsuspend(): atomically replace the signal mask and wait for a signal.
 * Stand-alone (no kernel) nothing can ever send us a signal asynchronously,
 * so the only signals that can be delivered are the ones already pending.
 * Emscripten's sigprocmask() runs handlers of pending signals that become
 * unblocked (system/lib/libc/pthread_sigmask.c:30-37,65-67), which is exactly
 * the delivery step we need; then report EINTR like the real call.
 */
WEAK int sigsuspend(const sigset_t *mask)
{
	sigset_t old;

	sigprocmask(SIG_SETMASK, mask, &old);
	sigprocmask(SIG_SETMASK, &old, NULL);
	errno = EINTR;
	return -1;
}

/* hostname applet: reading works through uname(); setting is not permitted. */
WEAK int sethostname(const char *name, size_t len)
{
	(void)name; (void)len;
	errno = EPERM;
	return -1;
}

/* nproc applet (libbb/alloc_affinity.c): report exactly one usable CPU. */
WEAK int sched_getaffinity(pid_t pid, size_t cpusetsize, cpu_set_t *mask)
{
	(void)pid;
	if (cpusetsize < sizeof(unsigned long)) {
		errno = EINVAL;
		return -1;
	}
	memset(mask, 0, cpusetsize);
	*(unsigned long *)mask = 1UL;
	return 0;
}

/* sync applet with -f (FEATURE_SYNC_FANCY): there is one filesystem. */
WEAK int syncfs(int fd)
{
	(void)fd;
	sync();
	return 0;
}

/* ============================================ Part 2: no-kernel answers */

/*
 * execve(): Emscripten's stub fails with ENOEXEC for every path
 * (system/lib/libc/emscripten_libc_stubs.c:164-172).  POSIX shells read
 * ENOEXEC as "this is a shell script without #!": ash then re-executes
 * itself with the script as argument (shell/ash.c tryexec()), and when that
 * "fails" too it continues its $PATH walk with argv[0] aliasing its own
 * scratch buffer - an overlapping strcpy() that runs off the end of linear
 * memory ("RuntimeError: memory access out of bounds").  ENOSYS is the
 * honest answer and makes the shell print "CMD: Function not implemented"
 * (exit status 126).
 *
 * NOTE for the kernel's execve(): return ENOENT/ENOTDIR/EACCES like Linux
 * does, and ENOEXEC only for an existing file that is not a program.
 */
WEAK int execve(const char *path, char *const argv[], char *const envp[])
{
	(void)path; (void)argv; (void)envp;
	errno = ENOSYS;
	return -1;
}

/*
 * wait4() (and waitpid/wait/wait3 on top of it): Emscripten's stub returns
 * ENOSYS (system/lib/libc/emscripten_syscall_stubs.c:262).  Without a kernel
 * no child can exist, and POSIX says that is ECHILD.  hush reaps with
 * waitpid(-1, WNOHANG) after every command and complains about any other
 * errno.
 */
WEAK int __syscall_wait4(int pid, intptr_t wstatus, int options, int rusage)
{
	(void)pid; (void)wstatus; (void)options; (void)rusage;
	return -ECHILD;
}
