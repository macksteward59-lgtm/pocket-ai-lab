#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required. This portable launcher does not install Node and is not a standalone native installer."
  exit 1
fi
exec node "$(dirname "$0")/launcher.mjs" "$@"
