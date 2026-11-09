# iOS LlamaEngine Gate 2

This slice links a pinned llama.cpp into `runtime/ios/` and keeps Gate 1 fail-closed. It does not grant APEX authorization. Model text is not a receipt, a verification, or an `authorized` flag. This repository does not record a physical iPhone run.

## Pin

llama.cpp tag `b12233`, commit `5f490d7bfe78844e6390c869454c149fd7e003a8`.

The GitHub archive is `https://github.com/ggml-org/llama.cpp/archive/refs/tags/b12233.tar.gz`.

- SHA-256 `76572f95d0ce2b7603fe77d472d29f7df9f0f9c12ae126d8b167252212e8babe`
- 39154253 bytes

`runtime/ios/scripts/build-llama-cpp.sh` checks that the tag resolves to that commit, checks the archive hash and size, and checks that `include/llama.h` matches the file at that commit. The same values are in `runtime/ios/pin/llama-cpp.json` and `runtime/ios/Sources/LlamaCppBridge/include/pocket_llama_pin.h`. The script stops if they disagree. The archive is not committed.

The smoke weight is the existing SmolLM2 135M Instruct Q4_K_M pin: SHA-256 `2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d`, 105454432 bytes. CI downloads it and does not commit it.

## Backend

`PlaceholderLlamaEngine` still throws `LlamaEngineError.backendUnavailable` and does not yield a token.

`LlamaCppMetalBackend` is compiled in two ways:

- Without `POCKET_LLAMA_LINKED`, load and generate throw `backendUnavailable`. The macOS workflow typechecks that branch with the iOS simulator SDK.
- With the flag, the Swift package links the pinned llama, ggml, CPU, Metal, and hash static archives. They are built with `GGML_METAL=ON` and `GGML_METAL_EMBED_LIBRARY=ON` for the iOS simulator and for macOS. The archives are not repacked, because llama.cpp repeats member names such as `quants.c.o`. `requireMetal` defaults to true. If this process cannot create a Metal backend, load throws `backendUnavailable` and does not open the GGUF. `requireMetal: false` is an explicit CPU load. Empty or whitespace-only decode throws `backendFailed` and yields nothing. A missing file throws `invalidModel`. A file llama.cpp rejects throws `backendFailed`.

Generation asks llama.cpp for one completed string. The engine does not substitute a placeholder. `LlamaOffloadReport.offloadedLayers` is parsed from llama.cpp's own `offloaded N/M layers to GPU` log line. `-1` means that line was not logged. The report is llama.cpp's statement, not a GPU-counter sample from this repository.

Context length must be from 1 through 8192. That bound also applies to the loopback client, which is otherwise unchanged: loopback only, health `{"status":"ok"}`, and one token from non-empty `/completion` content.

## What GitHub macOS CI runs

`.github/workflows/ios-llamaengine-ci.yml` runs on `macos-15`:

1. Verify the llama.cpp tag, commit, archive hash, and `include/llama.h`.
2. Build the static Metal libraries for `iphonesimulator` arm64 and for macOS arm64, then make one xcframework per archive.
3. Typecheck the Swift sources with the unlinked branch.
4. `xcodebuild test` on an available iPhone simulator. Those tests cover the placeholder, the forced Metal-unavailable failure, a missing file, a non-GGUF file, request bounds, and the loopback checks. The smoke GGUF is not injected for this destination, so the simulator does not run generation.
5. Download the SmolLM2 GGUF, check SHA-256 and size, then `xcodebuild test` on the macOS host. That run includes the same fail-closed tests plus one greedy smoke generation (`temperature` 0, 8 tokens). If the host probe says Metal initialized, the test requires llama.cpp to log a GPU offload greater than zero. If it does not, the test uses CPU and requires `requireMetal: true` to throw.

The job summary prints the `POCKET_LLAMA_PROBE`, `POCKET_LLAMA_OFFLOAD`, and `POCKET_LLAMA_SMOKE` lines. Those lines are the evidence for that commit. A green job is not a claim that an iPhone executed Metal.

## Still requires a physical device

- Load a GGUF from an app sandbox on a physical iPhone and generate tokens there.
- Confirm Metal kernels, GPU family, memory, and thermal behavior on that phone. The simulator probe is not that measurement, even when `metalDeviceUsable` is true.
- Run generation inside the iOS Simulator. This workflow does not copy the GGUF into the simulator, and it does not treat a simulator Metal device as device acceptance.
- Sign and install an app. This slice is a Swift package and XCTest, not an installed product.
- Background execution, memory warnings, and Low Power Mode.
- Any reading of model text as permission. Nothing in this slice does that, on CI or on a phone.
