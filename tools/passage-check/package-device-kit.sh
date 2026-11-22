#!/usr/bin/env bash
# Run on the hosted Mac after the pinned dependency and native app builds.
set -euo pipefail
if [[ $# != 1 ]]; then echo "Usage: package-device-kit.sh output-directory" >&2; exit 2; fi
root=$(git rev-parse --show-toplevel)
destination=$1
mkdir -p "$destination"
destination=$(cd "$destination" && pwd)
stage=$(mktemp -d)
candidate=
trap 'rm -rf "$stage"; if [[ -n "$candidate" ]]; then rm -rf "$candidate"; fi' EXIT
candidate=$(mktemp -d "$destination/.device-kit.XXXXXX")
kit="$stage/PocketAILab"
mkdir -p "$kit"
cd "$root"
for path in docs/research/project-sources.json ios/PocketAILab ios/PocketAILabTests ios/PocketAILabUITests ios/PocketAILab.xcodeproj \
  ios/PRIVATE-IPHONE-TESTING.md runtime/ios/Package.swift runtime/ios/Sources runtime/ios/Tests \
  runtime/ios/build/xc runtime/ios/pin tools/evaluation-review/verify.py \
  tools/evaluation-review/source_run.py tools/evaluation-review/source_review.py tools/evaluation-review/hosted-passage-reference.json; do
  mkdir -p "$kit/$(dirname "$path")"
  cp -R "$path" "$kit/$path"
done
# Preserve upstream permission and attribution files with the binary libraries.
upstream=(runtime/ios/build/src/llama.cpp-*)
[[ ${#upstream[@]} == 1 && -f "${upstream[0]}/LICENSE" ]]
(cd "${upstream[0]}" && find . -type f \( -iname 'license*' -o -iname 'copying*' -o -iname 'notice*' -o -iname 'authors*' \) -print0) |
  while IFS= read -r -d '' file; do
    mkdir -p "$kit/third-party/llama.cpp/$(dirname "$file")"
    cp "${upstream[0]}/$file" "$kit/third-party/llama.cpp/$file"
  done
git rev-parse HEAD > "$kit/SOURCE-COMMIT.txt"
tar -czf "$candidate/pocket-ai-lab-device-kit.tar.gz" -C "$stage" PocketAILab
(cd "$candidate" && shasum -a 256 pocket-ai-lab-device-kit.tar.gz > pocket-ai-lab-device-kit.sha256)
# Build from a new extraction to catch host checkout paths and missing packaged dependencies.
mkdir "$stage/reopened"
tar -xzf "$candidate/pocket-ai-lab-device-kit.tar.gz" -C "$stage/reopened"
cd "$stage/reopened/PocketAILab"
xcodebuild build -project ios/PocketAILab.xcodeproj -scheme PocketAILab \
  -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath "$stage/derived" CODE_SIGNING_ALLOWED=NO
cmp ios/PocketAILab/PassageChecks.json "$stage/derived/Build/Products/Debug-iphoneos/PocketAILab.app/PassageChecks.json"

cmp docs/research/project-sources.json "$stage/derived/Build/Products/Debug-iphoneos/PocketAILab.app/project-sources.json"

# The public filenames must not be changed by a failed rebuild or fixture check.
for name in pocket-ai-lab-device-kit.tar.gz pocket-ai-lab-device-kit.sha256; do
  if [[ -d "$destination/$name" ]]; then
    echo "Cannot publish device kit over directory: $destination/$name" >&2
    exit 1
  fi
done
mv -f "$candidate/pocket-ai-lab-device-kit.tar.gz" "$destination/pocket-ai-lab-device-kit.tar.gz"
mv -f "$candidate/pocket-ai-lab-device-kit.sha256" "$destination/pocket-ai-lab-device-kit.sha256"
