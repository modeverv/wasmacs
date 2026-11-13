# Read after CPython's generated Makefile. configure expands PLATFORM_OBJS
# into a literal list, so filter the actual archive member list here.
LIBRARY_OBJS := $(filter-out Python/emscripten_syscalls.o,$(LIBRARY_OBJS))
$(LIBRARY): $(lastword $(MAKEFILE_LIST))

.PHONY: wasmacs-print-link-libs
wasmacs-print-link-libs:
	@echo $(MODLIBS) $(LIBS) $(SYSLIBS)
