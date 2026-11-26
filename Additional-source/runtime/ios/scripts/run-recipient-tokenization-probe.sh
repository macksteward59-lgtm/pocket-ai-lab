#!/usr/bin/env bash
# Run a vocabulary-only probe against the existing verified macOS llama.cpp
# build. Does not fetch/build dependencies or perform model inference. Stdout is
# JSONL; compiler, library, and pin verification diagnostics remain on stderr.
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 MODEL_GGUF PROMPT_DIRECTORY PROMPT_COUNT" >&2
  exit 2
fi
if [[ "$(uname -s)" != Darwin ]]; then
  echo "This runner requires the pinned macOS libraries. Compile main.c with -fsyntax-only for a Linux source check." >&2
  exit 2
fi

recipient_probe_ios="$(cd "$(dirname "$0")/.." && pwd)"
recipient_probe_headers="$recipient_probe_ios/Sources/LlamaCppBridge/vendor"
recipient_probe_archives="$recipient_probe_ios/build/macos"
recipient_probe_model="$1"
recipient_probe_prompts="$2"
recipient_probe_count="$3"

for recipient_probe_header in llama.h gguf.h ggml.h ggml-backend.h ggml-cpu.h ggml-opt.h ggml-alloc.h; do
  if [[ ! -s "$recipient_probe_headers/$recipient_probe_header" ]]; then
    echo "Missing verified pinned public header: $recipient_probe_header" >&2
    exit 2
  fi
done
recipient_probe_libraries=(llama ggml ggml-cpu ggml-metal ggml-base vendor-hash)
for recipient_probe_library in "${recipient_probe_libraries[@]}"; do
  if [[ ! -s "$recipient_probe_archives/lib$recipient_probe_library.a" ]]; then
    echo "Missing verified pinned macOS archive: lib$recipient_probe_library.a" >&2
    exit 2
  fi
done

recipient_probe_verify_pin() {
  python3 - "$recipient_probe_ios" "$recipient_probe_model" <<'PY'
import hashlib
import json
import os
import pathlib
import stat
import sys

ios, model_path = map(pathlib.Path, sys.argv[1:])
pin = json.loads((ios / "pin/llama-cpp.json").read_text())
header = (ios / "Sources/LlamaCppBridge/include/pocket_llama_pin.h").read_text()
for key, macro in (("tag", "POCKET_LLAMA_PIN_TAG"), ("commit", "POCKET_LLAMA_PIN_COMMIT"), ("sha256", "POCKET_LLAMA_PIN_SHA256")):
    if f'#define {macro} "{pin[key]}"' not in header:
        raise SystemExit(f"Pinned llama.cpp header mismatch for {key}")

# The existing build helper verifies the source archive and upstream llama.h.
# Check the public headers have not diverged from that prepared source tree.
source = ios / "build/src" / ("llama.cpp-" + pin["tag"])
for name in ("llama.h", "gguf.h", "ggml.h", "ggml-backend.h", "ggml-cpu.h", "ggml-opt.h", "ggml-alloc.h"):
    original = source / ("include" if name == "llama.h" else "ggml/include") / name
    staged = ios / "Sources/LlamaCppBridge/vendor" / name
    if original.read_bytes() != staged.read_bytes():
        raise SystemExit(f"Pinned staged header differs from verified source: {name}")

model_pin = json.loads((ios / "pin/smoke-gguf.json").read_text())
digest = hashlib.sha256()
size = 0
with os.fdopen(os.open(model_path, os.O_RDONLY | os.O_NONBLOCK), "rb") as handle:
    observed = os.fstat(handle.fileno())
    if not stat.S_ISREG(observed.st_mode):
        raise SystemExit("Pinned GGUF must be a regular file")
    if observed.st_size != model_pin["bytes"]:
        raise SystemExit("GGUF byte length does not match the repository pin")
    while chunk := handle.read(1_048_576):
        digest.update(chunk)
        size += len(chunk)
        if size > model_pin["bytes"]:
            raise SystemExit("GGUF grew beyond the pinned byte length during verification")
if size != model_pin["bytes"] or digest.hexdigest() != model_pin["sha256"]:
    raise SystemExit("Complete GGUF size/SHA-256 does not match the repository pin")
print(f"Vocabulary-only model pin verified: {size} bytes, sha256 {digest.hexdigest()}", file=sys.stderr)
PY
}

recipient_probe_verify_pin
recipient_probe_build="$(mktemp -d "${TMPDIR:-/tmp}/pocket-recipient-tokenization.XXXXXX")"
trap 'rm -rf "$recipient_probe_build"' EXIT

xcrun clang -std=c11 -O2 -Wall -Wextra -Werror -mmacosx-version-min=14.0 \
  -I "$recipient_probe_ios/Sources/LlamaCppBridge/include" \
  -I "$recipient_probe_headers" \
  -c "$recipient_probe_ios/Tests/RecipientTokenizationProbe/main.c" \
  -o "$recipient_probe_build/main.o" >&2

recipient_probe_link_args=()
for recipient_probe_library in "${recipient_probe_libraries[@]}"; do
  recipient_probe_link_args+=("$recipient_probe_archives/lib$recipient_probe_library.a")
done
xcrun clang++ -mmacosx-version-min=14.0 "$recipient_probe_build/main.o" \
  "${recipient_probe_link_args[@]}" \
  -framework Foundation -framework Metal -framework MetalKit -framework Accelerate -ObjC \
  -o "$recipient_probe_build/recipient-tokenization-probe" >&2

recipient_probe_status=0
"$recipient_probe_build/recipient-tokenization-probe" \
  "$recipient_probe_model" "$recipient_probe_prompts" "$recipient_probe_count" || recipient_probe_status=$?
# This check does not attest an in-memory load. It binds the recorded probe to
# unchanged observed artifact bytes before/after vocabulary-only execution.
recipient_probe_verify_pin
exit "$recipient_probe_status"
