#!/usr/bin/env bash
# Build SQLite for the Emacs runtime: one object file that the Emacs link
# takes in (see build-emacs-browser-atomics-pdump-profile.sh), so that
# Emacs's own SQLite support (sqlite-open, sqlite-execute, sqlite-select)
# works in the browser.
#
# SQLite is in the public domain (https://www.sqlite.org/copyright.html).
# The amalgamation is downloaded from sqlite.org and checked against the
# SHA3-256 that sqlite.org publishes for it; nothing of it is kept in this
# repository.
#
# Idempotent.  Output: build/sqlite/sqlite3.o and build/sqlite/sqlite3.h.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQLITE_VERSION="${SQLITE_VERSION:-3.54.1}"
case "${SQLITE_VERSION}" in
  3.54.1)
    SQLITE_ZIP=sqlite-amalgamation-3540100
    SQLITE_URL=https://www.sqlite.org/2026/${SQLITE_ZIP}.zip
    # SHA3-256, as listed on https://www.sqlite.org/download.html
    SQLITE_SHA3=92281c86e2957f9b9305890f9ac04204caa7b677cc868dc326d942689df28e30 ;;
  *) echo "build-sqlite.sh: no pinned hash for SQLite ${SQLITE_VERSION}" >&2; exit 2 ;;
esac

out="${repo_root}/build/sqlite"
zip="${out}/${SQLITE_ZIP}.zip"
mkdir -p "${out}"
for tool in emcc curl unzip python3; do
  command -v "${tool}" >/dev/null 2>&1 || { echo "build-sqlite.sh: ${tool} not found" >&2; exit 127; }
done

if [ ! -f "${zip}" ]; then
  echo "downloading ${SQLITE_URL}"
  curl -fsSL --retry 3 -o "${zip}.part" "${SQLITE_URL}"
  mv "${zip}.part" "${zip}"
fi
actual=$(python3 -c 'import hashlib, sys; print(hashlib.sha3_256(open(sys.argv[1], "rb").read()).hexdigest())' "${zip}")
if [ "${actual}" != "${SQLITE_SHA3}" ]; then
  echo "build-sqlite.sh: SHA3-256 mismatch for ${SQLITE_ZIP}.zip: got ${actual}, want ${SQLITE_SHA3}" >&2
  exit 1
fi

if [ ! -f "${out}/sqlite3.o" ] || [ "${zip}" -nt "${out}/sqlite3.o" ] || [ "${BASH_SOURCE[0]}" -nt "${out}/sqlite3.o" ]; then
  echo "building SQLite ${SQLITE_VERSION}"
  rm -rf "${out}/${SQLITE_ZIP}"
  unzip -q -o "${zip}" -d "${out}"
  cp "${out}/${SQLITE_ZIP}/sqlite3.h" "${out}/sqlite3.h"
  # One thread, no extension loading (there is no dlopen), no write-ahead
  # log (it needs shared memory mappings).  The database files live in the
  # runtime's in-memory filesystem.
  emcc -O2 -c "${out}/${SQLITE_ZIP}/sqlite3.c" -o "${out}/sqlite3.o" \
    -DSQLITE_THREADSAFE=0 \
    -DSQLITE_OMIT_LOAD_EXTENSION \
    -DSQLITE_OMIT_WAL \
    -DSQLITE_OMIT_SHARED_CACHE \
    -DSQLITE_OMIT_DEPRECATED \
    -DSQLITE_DEFAULT_MEMSTATUS=0 \
    -DSQLITE_TEMP_STORE=2 \
    -DSQLITE_ENABLE_LOCKING_STYLE=0
fi
echo "SQLITE:${out}/sqlite3.o"
