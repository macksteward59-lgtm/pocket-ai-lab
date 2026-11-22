#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ "$(uname -sm)" != "Linux x86_64" ]]; then
  echo "This installer uses the Linux x86_64 CPU build of llama.cpp." >&2
  exit 1
fi
here=$(cd -- "$(dirname -- "$0")" && pwd)
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT

fetch_checked() {
  local url=$1 destination=$2 sha=$3
  curl --fail --location --proto '=https' --retry 2 --max-time 600 \
    --silent --show-error "$url" --output "$destination"
  printf '%s  %s\n' "$sha" "$destination" | sha256sum --check --status
}

fetch_checked \
  'https://github.com/ggml-org/llama.cpp/releases/download/b12608/llama-b12608-bin-ubuntu-x64.tar.gz' \
  "$stage/llama.tar.gz" 437a78088609f8faac6eddb8654614a0bafd761d3e9803b304c1b623074f599c
tar --extract --gzip --file="$stage/llama.tar.gz" --directory="$stage"
fetch_checked \
  'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf?download=true' \
  "$stage/model.gguf" 6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e

if [[ ${1:-} == --compare-passages ]]; then
  [[ $# == 2 ]] || exit 2
  python3 "$here/../passage-check/compare.py" --gguf "$stage/model.gguf" \
    --llama-server "$stage/llama-b12608/llama-server" --output-dir "$2"
  exit
fi

if [[ ${1:-} == --passage-results ]]; then
  [[ $# == 2 ]] || exit 2
  python3 "$here/../passage-check/server.py" --gguf "$stage/model.gguf" \
    --llama-server "$stage/llama-b12608/llama-server" --output "$2"
  exit
fi

cp "$here/package.json" "$here/package-lock.json" "$stage/"
npm ci --prefix "$stage" --ignore-scripts --no-audit --no-fund >&2

python3 "$here/review.py" --gguf "$stage/model.gguf" \
  --openclaw "$stage/node_modules/.bin/openclaw" \
  --llama-server "$stage/llama-b12608/llama-server" "$@"
