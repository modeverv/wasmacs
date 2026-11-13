# Sourced by build scripts: the emcc flags every wasmacs process needs.
#
#   source src/runtime/process/child/wasmacs-child-flags.sh
#   emcc ... ${wasmacs_child_ldflags} -sEXPORT_NAME=wasmacsProgram_<name> \
#        "${wasmacs_child_rt_c}" -o <name>.js
#
# The program image is the pair <name>.js (MODULARIZE factory, global
# wasmacsProgram_<name>) + <name>.wasm.
wasmacs_child_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
wasmacs_child_rt_c="${wasmacs_child_dir}/wasmacs-child-rt.c"
# ASYNCIFY=1                 blocking system calls unwind into the kernel
# ASYNCIFY_STACK_SIZE        room for the unwound call stack (also the fork snapshot)
# WASM_ASYNC_COMPILATION=0   a process is created synchronously inside the Emacs worker
# INVOKE_RUN=0               the kernel starts main() (wasmacs_rt_start)
# EXIT_RUNTIME=1             atexit handlers and stdio flushing at exit
wasmacs_child_ldflags="-sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=${WASMACS_CHILD_ASYNCIFY_STACK_SIZE:-262144} \
-sMODULARIZE=1 -sWASM_ASYNC_COMPILATION=0 -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 \
-sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,worker,node \
-sNODEJS_CATCH_EXIT=0 -sNODEJS_CATCH_REJECTION=0 \
--js-library ${wasmacs_child_dir}/wasmacs-child-library.js \
--pre-js ${wasmacs_child_dir}/wasmacs-child-pre.js"
