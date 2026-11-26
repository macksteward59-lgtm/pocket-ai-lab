#!/usr/bin/env bash
# Candidate-only vocabulary observations against the existing pinned archives.
set -euo pipefail
if [[ $# -ne 3 || "$(uname -s)" != Darwin ]]; then
  echo "usage (macOS): $0 MODEL PROFILE PREPARED_DIRECTORY" >&2
  exit 2
fi
ds_probe_root="$(cd "$(dirname "$0")/../.." && pwd)"
ds_probe_ios="$ds_probe_root/runtime/ios"
ds_probe_model="$1"
ds_probe_profile="$2"
ds_probe_prepared="$3"
python3 "$ds_probe_root/scripts/model-qualification/qualification.py" verify-model --profile "$ds_probe_profile" --model "$ds_probe_model" >&2
python3 - "$ds_probe_ios" <<'PY'
import json,pathlib,sys
root=pathlib.Path(sys.argv[1])
pin=json.loads((root/'pin/llama-cpp.json').read_text())
assert pin['commit']=='5f490d7bfe78844e6390c869454c149fd7e003a8'
header=(root/'Sources/LlamaCppBridge/include/pocket_llama_pin.h').read_text()
for k,macro in [('tag','POCKET_LLAMA_PIN_TAG'),('commit','POCKET_LLAMA_PIN_COMMIT'),('sha256','POCKET_LLAMA_PIN_SHA256')]:
 assert '#define '+macro+' "'+pin[k]+'"' in header
for name in ('llama.h','gguf.h','ggml.h','ggml-backend.h','ggml-cpu.h','ggml-opt.h','ggml-alloc.h'):
 source=root/'build/src'/('llama.cpp-'+pin['tag'])/('include' if name=='llama.h' else 'ggml/include')/name
 assert source.read_bytes()==(root/'Sources/LlamaCppBridge/vendor'/name).read_bytes(),name
PY
ds_probe_build="$(mktemp -d /tmp/pocket-deepseek-probe.XXXXXX)"
trap 'rm -rf "$ds_probe_build"' EXIT
xcrun clang -std=c11 -O2 -Wall -Wextra -Werror -mmacosx-version-min=14.0 \
  -I "$ds_probe_ios/Sources/LlamaCppBridge/include" -I "$ds_probe_ios/Sources/LlamaCppBridge/vendor" \
  -c "$ds_probe_root/scripts/model-qualification/tokenizer-probe.c" -o "$ds_probe_build/main.o" >&2
ds_probe_libraries=()
for ds_probe_name in llama ggml ggml-cpu ggml-metal ggml-base vendor-hash; do
  ds_probe_libraries+=("$ds_probe_ios/build/macos/lib$ds_probe_name.a")
done
xcrun clang++ -mmacosx-version-min=14.0 "$ds_probe_build/main.o" "${ds_probe_libraries[@]}" \
  -framework Foundation -framework Metal -framework MetalKit -framework Accelerate -ObjC \
  -o "$ds_probe_build/tokenizer-probe" >&2
ds_probe_status=0
"$ds_probe_build/tokenizer-probe" "$ds_probe_model" "$ds_probe_prepared/prompts" || ds_probe_status=$?
python3 "$ds_probe_root/scripts/model-qualification/qualification.py" verify-model --profile "$ds_probe_profile" --model "$ds_probe_model" >&2
exit "$ds_probe_status"
