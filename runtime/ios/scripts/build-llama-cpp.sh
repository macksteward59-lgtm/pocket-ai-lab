#!/usr/bin/env bash
# Download, verify, and build the pinned llama.cpp static library.
# Destinations: verify, simulator, ios-device, macos, linux, xcframework, fetch-gguf, write-smoke-path
set -euo pipefail

IOS="$(cd "$(dirname "$0")/.." && pwd)"
PIN_JSON="$IOS/pin/llama-cpp.json"
PIN_HEADER="$IOS/Sources/LlamaCppBridge/include/pocket_llama_pin.h"
GGUF_JSON="$IOS/pin/smoke-gguf.json"
BUILD="$IOS/build"
CACHE="$BUILD/cache"
SRC="$BUILD/src"

destination="${1:-}"
if [[ -z "$destination" ]]; then
  echo "usage: $0 verify|simulator|ios-device|macos|linux|xcframework|fetch-gguf|write-smoke-path [gguf-path]" >&2
  exit 2
fi

python3 - "$PIN_JSON" "$PIN_HEADER" <<'PY'
import json, pathlib, sys
pin = json.loads(pathlib.Path(sys.argv[1]).read_text())
header = pathlib.Path(sys.argv[2]).read_text()
expected = {
    "tag": "POCKET_LLAMA_PIN_TAG",
    "commit": "POCKET_LLAMA_PIN_COMMIT",
    "sha256": "POCKET_LLAMA_PIN_SHA256",
}
for key, macro in expected.items():
    needle = f'#define {macro} "{pin[key]}"'
    if needle not in header:
        raise SystemExit(f"pocket_llama_pin.h does not match pin/llama-cpp.json for {key}")
print(f"pin header matches {pin['tag']} {pin['commit']}")
PY

read_pin() {
  python3 - "$PIN_JSON" "$1" <<'PY'
import json, pathlib, sys
pin = json.loads(pathlib.Path(sys.argv[1]).read_text())
print(pin[sys.argv[2]])
PY
}

verify_sources() {
  local tag commit sha bytes url
  tag="$(read_pin tag)"
  commit="$(read_pin commit)"
  sha="$(read_pin sha256)"
  bytes="$(read_pin bytes)"
  url="$(read_pin tarballUrl)"
  mkdir -p "$CACHE" "$SRC"
  local tarball="$CACHE/llama.cpp-${tag}.tar.gz"
  local src_dir="$SRC/llama.cpp-${tag}"

  python3 - "$tag" "$commit" <<'PY'
import json, sys, urllib.request
tag, commit = sys.argv[1], sys.argv[2]
url = f"https://api.github.com/repos/ggml-org/llama.cpp/git/ref/tags/{tag}"
request = urllib.request.Request(url, headers={
    "User-Agent": "pocket-ai-lab-ios-llama",
    "Accept": "application/vnd.github+json",
})
with urllib.request.urlopen(request, timeout=60) as response:
    payload = json.load(response)
obj = payload["object"]
sha = obj["sha"]
kind = obj["type"]
if kind == "tag":
    peel = urllib.request.Request(obj["url"], headers={
        "User-Agent": "pocket-ai-lab-ios-llama",
        "Accept": "application/vnd.github+json",
    })
    with urllib.request.urlopen(peel, timeout=60) as response:
        tag_obj = json.load(response)
    sha = tag_obj["object"]["sha"]
    kind = tag_obj["object"]["type"]
if kind != "commit":
    raise SystemExit(f"tag {tag} did not resolve to a commit")
if sha != commit:
    raise SystemExit(f"tag {tag} points at {sha}, pin expects {commit}")
print(f"tag {tag} commit {sha}", file=sys.stderr)
PY

  if [[ ! -f "$tarball" ]] || ! python3 - "$tarball" "$sha" "$bytes" <<'PY'
import hashlib, pathlib, sys
path, sha, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
data = pathlib.Path(path).read_bytes()
raise SystemExit(0 if len(data) == size and hashlib.sha256(data).hexdigest() == sha else 1)
PY
  then
    echo "downloading $url" >&2
    curl -fL --retry 5 --retry-delay 2 -o "$tarball.partial" "$url"
    mv "$tarball.partial" "$tarball"
  fi

  python3 - "$tarball" "$sha" "$bytes" <<'PY'
import hashlib, pathlib, sys
path, sha, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
data = pathlib.Path(path).read_bytes()
digest = hashlib.sha256(data).hexdigest()
if len(data) != size or digest != sha:
    raise SystemExit(f"tarball check failed bytes={len(data)} sha256={digest}")
print(f"tarball sha256 {digest} bytes {len(data)}", file=sys.stderr)
PY

  local stamp="$SRC/.extracted-$sha"
  if [[ ! -f "$stamp" || ! -f "$src_dir/include/llama.h" ]]; then
    rm -rf "$src_dir"
    tar -xzf "$tarball" -C "$SRC"
  fi
  if [[ ! -f "$src_dir/include/llama.h" ]]; then
    echo "extracted tree is missing include/llama.h" >&2
    exit 1
  fi
  python3 - "$src_dir/include/llama.h" "$commit" <<'PY'
import pathlib, sys, urllib.request
local = pathlib.Path(sys.argv[1]).read_bytes()
url = f"https://raw.githubusercontent.com/ggml-org/llama.cpp/{sys.argv[2]}/include/llama.h"
request = urllib.request.Request(url, headers={"User-Agent": "pocket-ai-lab-ios-llama"})
with urllib.request.urlopen(request, timeout=60) as response:
    remote = response.read()
if local != remote:
    raise SystemExit("include/llama.h does not match the pinned commit")
print(f"include/llama.h matches {sys.argv[2]}", file=sys.stderr)
PY
  mkdir -p "$BUILD/include" "$IOS/Sources/LlamaCppBridge/vendor"
  cp -f "$src_dir/include/"*.h "$BUILD/include/"
  cp -f "$src_dir/ggml/include/"*.h "$BUILD/include/"
  cp -f "$BUILD/include/"*.h "$IOS/Sources/LlamaCppBridge/vendor/"
  : > "$stamp"
  echo "$src_dir"
}

jobs() {
  if [[ "$(uname)" == "Darwin" ]]; then
    sysctl -n hw.ncpu
  else
    nproc
  fi
}

find_one() {
  local root="$1"
  local name="$2"
  local found=""
  local candidate
  while IFS= read -r candidate; do
    found="$candidate"
    break
  done < <(find "$root" -name "$name" -type f)
  if [[ -z "$found" ]]; then
    echo "missing $name under $root" >&2
    exit 1
  fi
  echo "$found"
}

build_one() {
  local name="$1"
  shift
  local src_dir
  src_dir="$(verify_sources)"
  # The extracted tree is not a git checkout. Stop git from walking into this repo.
  export GIT_CEILING_DIRECTORIES="$SRC"
  local cmake_dir="$BUILD/cmake-$name"
  local out_dir="$BUILD/$name"
  mkdir -p "$out_dir"
  local generator=()
  if command -v ninja >/dev/null 2>&1; then
    generator=(-G Ninja)
  fi
  cmake -S "$src_dir" -B "$cmake_dir" "${generator[@]}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_BACKEND_DL=OFF \
    -DGGML_NATIVE=OFF \
    -DGGML_OPENMP=OFF \
    -DGGML_BLAS=OFF \
    -DGGML_RPC=OFF \
    -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_TOOLS=OFF \
    -DLLAMA_BUILD_EXAMPLES=OFF \
    -DLLAMA_BUILD_SERVER=OFF \
    -DLLAMA_BUILD_COMMON=OFF \
    -DLLAMA_BUILD_APP=OFF \
    -DLLAMA_OPENSSL=OFF \
    -DLLAMA_BUILD_IS_DEV=OFF \
    -DLLAMA_BUILD_COMMIT="$(read_pin commit)" \
    "$@"
  cmake --build "$cmake_dir" --parallel "$(jobs)"
  # Keep each archive intact. Repacking drops duplicate member names such as quants.c.o.
  copy_archive "$cmake_dir" "$out_dir" libllama.a
  copy_archive "$cmake_dir" "$out_dir" libggml.a
  copy_archive "$cmake_dir" "$out_dir" libggml-base.a
  copy_archive "$cmake_dir" "$out_dir" libggml-cpu.a
  copy_archive "$cmake_dir" "$out_dir" libvendor-hash.a
  require_symbol "$out_dir/libllama.a" llama_backend_init
  if [[ "$name" != "linux" ]]; then
    copy_archive "$cmake_dir" "$out_dir" libggml-metal.a
    require_symbol "$out_dir/libggml-metal.a" ggml_backend_metal_reg
  fi
  echo "staged llama.cpp archives in $out_dir"
}

copy_archive() {
  local cmake_dir="$1"
  local out_dir="$2"
  local name="$3"
  cp "$(find_one "$cmake_dir" "$name")" "$out_dir/$name"
}

require_symbol() {
  local archive="$1"
  local symbol="$2"
  local listing
  listing="$(mktemp)"
  nm "$archive" > "$listing"
  if ! grep -E " T _?${symbol}$" "$listing" >/dev/null; then
    rm -f "$listing"
    echo "$archive is missing $symbol" >&2
    exit 1
  fi
  rm -f "$listing"
}

case "$destination" in
  verify)
    verify_sources >/dev/null
    ;;
  simulator)
    # Build both simulator CPU slices even on the Intel hosted runner. The app's
    # generic simulator build links arm64 as well as x86_64.
    build_one simulator \
      -DCMAKE_SYSTEM_NAME=iOS \
      -DCMAKE_OSX_SYSROOT=iphonesimulator \
      -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" \
      -DCMAKE_OSX_DEPLOYMENT_TARGET=16.0 \
      -DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY \
      -DGGML_METAL=ON \
      -DGGML_METAL_EMBED_LIBRARY=ON \
      -DGGML_METAL_TARGET_OS=ios \
      -DGGML_ACCELERATE=ON
    ;;
  ios-device)
    # Physical iPhone/iPad arm64 device slice; keep separate from simulator arm64.
    build_one ios-device \
      -DCMAKE_SYSTEM_NAME=iOS \
      -DCMAKE_OSX_SYSROOT=iphoneos \
      -DCMAKE_OSX_ARCHITECTURES=arm64 \
      -DCMAKE_OSX_DEPLOYMENT_TARGET=16.0 \
      -DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY \
      -DGGML_METAL=ON \
      -DGGML_METAL_EMBED_LIBRARY=ON \
      -DGGML_METAL_TARGET_OS=ios \
      -DGGML_ACCELERATE=ON
    ;;
  macos)
    build_one macos \
      -DCMAKE_OSX_ARCHITECTURES="$(uname -m)" \
      -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0 \
      -DGGML_METAL=ON \
      -DGGML_METAL_EMBED_LIBRARY=ON \
      -DGGML_METAL_TARGET_OS=macos \
      -DGGML_ACCELERATE=ON
    ;;
  linux)
    build_one linux \
      -DGGML_METAL=OFF \
      -DGGML_ACCELERATE=OFF
    ;;
  xcframework)
    name=""
    for name in libllama.a libggml.a libggml-base.a libggml-cpu.a libggml-metal.a libvendor-hash.a; do
      if [[ ! -f "$BUILD/simulator/$name" || ! -f "$BUILD/ios-device/$name" || ! -f "$BUILD/macos/$name" ]]; then
        echo "missing $name in the simulator, ios-device, or macos build" >&2
        exit 1
      fi
    done
    rm -rf "$BUILD/xc"
    mkdir -p "$BUILD/xc"
    for name in llama ggml ggml-base ggml-cpu ggml-metal vendor-hash; do
      rm -rf "$BUILD/xc/${name}.xcframework"
      xcodebuild -create-xcframework \
        -library "$BUILD/ios-device/lib${name}.a" \
        -library "$BUILD/simulator/lib${name}.a" \
        -library "$BUILD/macos/lib${name}.a" \
        -output "$BUILD/xc/${name}.xcframework"
    done
    ;;
  fetch-gguf)
    python3 - "$GGUF_JSON" "$BUILD/models" <<'PY'
import hashlib, json, pathlib, sys, urllib.request
pin = json.loads(pathlib.Path(sys.argv[1]).read_text())
dest_dir = pathlib.Path(sys.argv[2])
dest_dir.mkdir(parents=True, exist_ok=True)
dest = dest_dir / pin["filename"]
def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
if dest.is_file() and dest.stat().st_size == pin["bytes"] and digest(dest) == pin["sha256"]:
    print(dest)
    raise SystemExit(0)
tmp = dest.with_suffix(dest.suffix + ".partial")
request = urllib.request.Request(pin["sourceUrl"], headers={"User-Agent": "pocket-ai-lab-ios-llama"})
with urllib.request.urlopen(request, timeout=120) as response, tmp.open("wb") as handle:
    while True:
        chunk = response.read(1024 * 1024)
        if not chunk:
            break
        handle.write(chunk)
got = digest(tmp)
if tmp.stat().st_size != pin["bytes"] or got != pin["sha256"]:
    tmp.unlink(missing_ok=True)
    raise SystemExit(f"GGUF check failed bytes={tmp.stat().st_size if tmp.exists() else 0} sha256={got}")
tmp.replace(dest)
print(dest)
PY
    ;;
  write-smoke-path)
    gguf_path="${2:-}"
    if [[ -z "$gguf_path" || "$gguf_path" == *"\""* || "$gguf_path" == *$'\\'* ]]; then
      echo "write-smoke-path needs a GGUF path without quotes" >&2
      exit 2
    fi
    python3 - "$IOS/Tests/LlamaEngineTests/SmokePath.swift" "$gguf_path" <<'PY'
import pathlib, sys
target, gguf = sys.argv[1], sys.argv[2]
pathlib.Path(target).write_text(
    "enum SmokePath {\n"
    f"    static let path: String? = \"{gguf}\"\n"
    "    static let required = true\n"
    "}\n"
)
print(f"wrote smoke path {gguf}")
PY
    ;;
  *)
    echo "unknown destination: $destination" >&2
    exit 2
    ;;
esac
