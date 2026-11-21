#!/usr/bin/env bash
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
out=$(realpath -m "${1:?specify a new output directory}")
mkdir "$out"
stage=$(mktemp -d)
server_pid=''
cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$stage"
}
trap cleanup EXIT
fetch_checked() {
  curl --fail --location --proto '=https' --silent --show-error --max-time 240 --retry 2 "$1" -o "$2"
  printf '%s  %s\n' "$3" "$2" | sha256sum --check --status
}
release=b12233
archive_sha=9f4a78cc4e4c9f5a166102a43f1d8f8e4e9d75e76823eb9505d05bbba288abd5
fetch_checked "https://github.com/ggml-org/llama.cpp/releases/download/$release/llama-$release-bin-ubuntu-x64.tar.gz" "$stage/llama.tar.gz" "$archive_sha"
tar -xzf "$stage/llama.tar.gz" -C "$stage"
pin=runtime/ios/pin/smoke-gguf.json
fetch_checked "$(jq -r .sourceUrl "$pin")" "$stage/model.gguf" "$(jq -r .sha256 "$pin")"
[[ "$(stat -c %s "$stage/model.gguf")" == "$(jq -r .bytes "$pin")" ]]
"$stage/llama-$release/llama-server" --host 127.0.0.1 --port 18083 --model "$stage/model.gguf" \
    --ctx-size 512 --parallel 1 --threads 2 --n-gpu-layers 0 --no-warmup >"$stage/server.log" 2>&1 &
server_pid=$!
for ((attempt=0; attempt<90; attempt++)); do
  kill -0 "$server_pid" || { echo 'Local inference server exited during startup'; exit 1; }
  if curl -fsS http://127.0.0.1:18083/health >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:18083/health >/dev/null
python3 tools/recipient-choice/measure.py "$out"
