#!/usr/bin/env bash
# Compile the actual production C bridge against an explicitly declared fixture
# backend. This verifies completion ordering, not real llama.cpp/Metal execution.
# CI must first run build-llama-cpp.sh verify/build to populate verified headers.
set -euo pipefail

if [[ $# -gt 1 ]]; then
  echo "usage: $0 [verified-pinned-header-directory]" >&2
  exit 2
fi

bridge_test_ios="$(cd "$(dirname "$0")/.." && pwd)"
bridge_test_headers="${1:-$bridge_test_ios/Sources/LlamaCppBridge/vendor}"
if [[ ! -d "$bridge_test_headers" ]]; then
  echo "Missing verified headers. Run build-llama-cpp.sh verify or supply the verified header directory." >&2
  exit 2
fi
bridge_test_headers="$(cd "$bridge_test_headers" && pwd)"
for bridge_test_header in llama.h gguf.h ggml.h ggml-backend.h ggml-cpu.h ggml-opt.h ggml-alloc.h; do
  if [[ ! -f "$bridge_test_headers/$bridge_test_header" ]]; then
    echo "Missing pinned public header: $bridge_test_header" >&2
    exit 2
  fi
done

bridge_test_compiler="${CC:-cc}"
if ! command -v "$bridge_test_compiler" >/dev/null 2>&1; then
  echo "C compiler not found: $bridge_test_compiler" >&2
  exit 2
fi
bridge_test_build="$(mktemp -d "${TMPDIR:-/tmp}/pocket-native-bridge-drain.XXXXXX")"
trap 'rm -rf "$bridge_test_build"' EXIT

bridge_test_flags=(-std=c11 -O0 -g -Wall -Wextra -Werror=implicit-function-declaration -DPOCKET_LLAMA_LINKED=1)
bridge_test_link_flags=(-pthread)
case "$(uname -s)" in
  Linux)
    bridge_test_flags+=(-ffunction-sections -fdata-sections)
    bridge_test_link_flags+=(-Wl,--gc-sections)
    ;;
  Darwin)
    bridge_test_link_flags+=(-Wl,-dead_strip)
    ;;
  *)
    echo "This fixture runner currently supports Linux and macOS host compilers." >&2
    exit 2
    ;;
esac

bridge_test_compiler_version="$("$bridge_test_compiler" --version)"
printf 'Bridge drain fixture compiler: %s\n' "${bridge_test_compiler_version%%$'\n'*}"
printf 'Bridge drain fixture headers: %s\n' "$bridge_test_headers"
"$bridge_test_compiler" "${bridge_test_flags[@]}" \
  -I "$bridge_test_ios/Sources/LlamaCppBridge/include" \
  -I "$bridge_test_headers" \
  "$bridge_test_ios/Tests/NativeBridgeDrainSmoke/main.c" \
  "${bridge_test_link_flags[@]}" \
  -o "$bridge_test_build/native-bridge-drain"
"$bridge_test_build/native-bridge-drain"
