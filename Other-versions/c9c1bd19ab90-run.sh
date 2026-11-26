#!/usr/bin/env bash
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
out=$(realpath -m "${1:?specify a new output directory}")
mode=${2:-original}
case "$mode" in original|smol|qwen|source-review) ;; *) echo "Unknown comparison mode" >&2; exit 2 ;; esac
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
if [[ "$mode" == qwen || "$mode" == source-review ]]; then
  model_url='https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf?download=true'
  model_sha=6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e
else
  pin=runtime/ios/pin/smoke-gguf.json
  model_url=$(jq -r .sourceUrl "$pin")
  model_sha=$(jq -r .sha256 "$pin")
fi
fetch_checked "$model_url" "$stage/model.gguf" "$model_sha"
if [[ "$mode" == original || "$mode" == smol ]]; then
  [[ "$(stat -c %s "$stage/model.gguf")" == "$(jq -r .bytes "$pin")" ]]
fi
"$stage/llama-$release/llama-server" --host 127.0.0.1 --port 18083 --model "$stage/model.gguf" \
    --ctx-size 512 --parallel 1 --threads 2 --n-gpu-layers 0 --no-warmup >"$stage/server.log" 2>&1 &
server_pid=$!
for ((attempt=0; attempt<90; attempt++)); do
  kill -0 "$server_pid" || { echo 'Local inference server exited during startup'; exit 1; }
  if curl -fsS http://127.0.0.1:18083/health >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:18083/health >/dev/null
if [[ "$mode" == original ]]; then
  python3 tools/recipient-choice/measure.py "$out"
elif [[ "$mode" == source-review ]]; then
  fetch_checked 'https://raw.githubusercontent.com/macksteward59-lgtm/pocket-ai-lab/996d8ed1fc600e828f996ca59b506816e7a52c55/docs/research/project-sources.json' "$stage/sources.json" 9cf4acff35b106767f049de9814a9cc660796515d530d58622efabefd2b996c7
  python3 tools/source-recall/study.py "$stage/sources.json" "$out"
else
  python3 tools/recipient-choice/fresh.py "$out" "$mode" "$model_sha"
fi
