SHELL := /bin/bash

EMACS_VERSION ?= 30.2
EMACS_WORK_DIR ?= build/emacs-$(EMACS_VERSION)-patched

.PHONY: all prepare host-abi build-artifacts vscode-build vscode-assets test build docs dev clean clean-vscode

all: build

prepare:
	WASMACS_EMACS_VERSION="$(EMACS_VERSION)" \
	WASMACS_EMACS_WORK_DIR="$(EMACS_WORK_DIR)" \
		src/build/prepare-emacs-source.sh

host-abi:
	node src/build/generate-host-abi-wit.mjs

build-artifacts: prepare
	src/build/build-native-baseline.sh
	src/build/build-system-lisp-image.sh
	src/build/create-user-filesystem-image.sh
	src/build/probe-emacs-pdump-configure.sh
	src/build/build-emacs-browser-atomics-pdump-profile.sh

test:
	npm test

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
