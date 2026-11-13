SHELL := /bin/bash

.PHONY: all check-patches host-abi build-artifacts userland vscode-build vscode-assets test test-process build docs dev clean clean-vscode

all: build

# Verify that src/c/patches/*.patch apply to the pinned vendor/emacs.
check-patches:
	src/build/apply-emacs-patches.sh --check

host-abi:
	node src/build/generate-host-abi-wit.mjs

# Canonical product build (Atomics + pdump).  The Emacs patch layer is applied
# by build-emacs-browser-atomics-pdump-profile.sh.
build-artifacts: check-patches
	src/build/build-native-baseline.sh
	src/build/build-system-lisp-image.sh
	src/build/create-user-filesystem-image.sh
	src/build/probe-emacs-pdump-configure.sh
	src/build/build-emacs-browser-atomics-pdump-profile.sh
	src/userland/build.sh

# The programs Emacs can run as subprocesses (busybox sh + tools, git, GNU
# grep).  Sources are downloaded once into build/userland/dl (sha256 pinned).
userland:
	src/userland/build.sh

test:
	npm test

# Process service: kernel tests (need emcc) and real Emacs starting real
# subprocesses under Node (need the product build and the userland).
test-process:
	npm run test:process

build: build-artifacts
	node src/build/build-site.mjs

docs: build

vscode-assets:
	node src/build/build-vscode-assets.mjs

vscode-build:
	tools/scripts/build-emacs-browser-asyncify-spike.sh
	node src/build/build-vscode-assets.mjs

dev:
	npm run dev

clean:
	rm -rf dist
	mkdir -p build docs logs
	find build docs -mindepth 1 -maxdepth 1 -exec rm -rf {} +

clean-vscode:
	rm -rf build2 vscode
