#!/usr/bin/env bash
set -euo pipefail
workshop_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$workshop_root"
# Reuse the existing reviewed tag/commit/tarball/header verification.
bash runtime/ios/scripts/build-llama-cpp.sh verify
workshop_tag="$(python3 -c 'import json;print(json.load(open("runtime/ios/pin/llama-cpp.json"))["tag"])')"
node --input-type=module <<'JS'
import { readFile } from "node:fs/promises";
import { loadFrozenProfile } from "./scripts/tool-workshop/profile.mjs";
const pin = JSON.parse(await readFile("runtime/ios/pin/llama-cpp.json", "utf8"));
const { profile } = await loadFrozenProfile();
if (pin.commit !== profile.llamaCommit) {
  throw new Error("Workshop runtime differs from the existing pinned llama.cpp revision.");
}
JS
workshop_source="$workshop_root/runtime/ios/build/src/llama.cpp-$workshop_tag"
workshop_build="$workshop_root/runtime/ios/build/workshop-server"
# Do not identify the extracted upstream source using the enclosing Pocket repo.
export GIT_CEILING_DIRECTORIES="$workshop_root/runtime/ios/build/src"
cmake -S "$workshop_source" -B "$workshop_build" -DCMAKE_BUILD_TYPE=Release \
  -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DGGML_CUDA=OFF -DGGML_METAL=OFF \
  -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_SERVER=ON \
  -DLLAMA_BUILD_UI=OFF -DLLAMA_USE_PREBUILT_UI=OFF
cmake --build "$workshop_build" --target llama-server --parallel 2
"$workshop_build/bin/llama-server" --version
