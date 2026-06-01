#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 artifacts/system-lisp-emacs-30.2.wasifs" >&2
  exit 2
fi

image_path="$1"

if [[ ! -f "$image_path" ]]; then
  echo "missing image: $image_path" >&2
  exit 1
fi

echo "# wasifs tar listing"
echo "image: $image_path"
echo "sha256: $(shasum -a 256 "$image_path" | awk '{print $1}')"
echo
echo "## summary"
echo "system/lisp/*.el: $(tar tf "$image_path" | rg '^system/lisp/.+\.el$' | wc -l | tr -d ' ')"
echo "system/lisp/*.elc: $(tar tf "$image_path" | rg '^system/lisp/.+\.elc$' | wc -l | tr -d ' ')"
echo "system/lisp/*loaddefs.el: $(tar tf "$image_path" | rg '^system/lisp/.+loaddefs\.el$' | wc -l | tr -d ' ')"
echo
echo "## first entries"
tar tf "$image_path" | sed -n '1,40p'
