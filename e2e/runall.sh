#!/bin/bash
# usage: runall.sh <iter-prefix> <drawings...>  — 3 browsers at a time
# Screenshots land in e2e/shots/<iter-prefix>_<drawing>/ (git-ignored).
P=$1; shift
DIR="$(cd "$(dirname "$0")" && pwd)"
run() { DRAW=$1 node "$DIR/moves.mjs" ${P}_$1 > /tmp/${P}_$1.log 2>&1; echo "$1 exit=$? errs=$(grep -c '^ERROR' "$DIR/shots/${P}_$1/log.txt")"; }
export -f run; export P DIR
printf "%s\n" "$@" | xargs -P 3 -I{} bash -c 'run {}'
