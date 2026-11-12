# Pocket AI Lab — private iPhone testing

This branch prepares a private personal-device test build. It is not an App Store, TestFlight, public distribution, or production-release project.

## App structure

- SwiftUI native shell: local GGUF chat, hybrid web workspace, and runtime diagnostics.
- XcodeGen project definition: project.yml.
- Existing PocketLlamaEngine package: inference stays behind the current engine API.
- APEX/East governance: model output remains untrusted proposal data. The app does not approve actions, mint evidence, or bypass Director/East controls.

The web workspace is a configurable HTTPS endpoint. The existing web product is server-backed; embedding static HTML would not provide its API, orchestration, or model providers. Native local chat is independent and calls the existing Swift inference engine directly.

## Cloud CI build

GitHub Actions compiles the app and runs simulator tests on a hosted macOS runner. CI does not sign with the user's Apple Personal Team and does not prove physical-device Metal execution.

The engine XCFramework must include iOS-device arm64, iOS Simulator, and macOS slices. CI links the native app against the generic iOS destination as well as the simulator. The macOS slice is for host tests only, not iPhone execution. A successful generic-device build proves compilation/linking only; it is not a physical-device execution test.

The build sequence is:

```bash
brew install cmake ninja xcodegen
runtime/ios/scripts/build-llama-cpp.sh simulator
runtime/ios/scripts/build-llama-cpp.sh ios-device
runtime/ios/scripts/build-llama-cpp.sh macos
runtime/ios/scripts/build-llama-cpp.sh xcframework
xcodegen generate --spec ios/project.yml --project ios/PocketAILab.xcodeproj
xcodebuild -project ios/PocketAILab.xcodeproj -scheme PocketAILab \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

## Free Apple Personal Team installation — deferred

When physical installation is scheduled:

1. Open the generated Xcode project on a Mac.
2. Connect and unlock the iPhone; trust the Mac.
3. Add the Apple Account in Xcode Settings > Accounts.
4. Select the connected iPhone as the run destination.
5. Under Signing & Capabilities, enable Automatically manage signing and select the Personal Team.
6. Enable Developer Mode on the iPhone if prompted, then choose Run.

A free Personal Team is for development testing, not durable distribution. Provisioning expires periodically (typically seven days); the app must be rebuilt/reinstalled. Direct Run from Xcode is the preferred free route. An unsigned IPA or simulator build cannot be installed on iPhone.

## Hybrid workspace security

The Workspace tab accepts HTTPS URLs. HTTP is accepted only for localhost development. The app does not silently expose a local server or create a public endpoint. The web server must enforce its own authentication, TLS, and authorization.

## Model import and acceptance

1. Import a .gguf model. It is copied into the app's private Documents/Models directory.
2. Tap Load model. A session is reported only if the linked llama.cpp backend loads it.
3. Send a short prompt and verify non-empty text returned by the engine.
4. Confirm runtime diagnostics on the physical device.
5. Record model name, file size/hash, iOS version, device model, memory behavior, thermal behavior, and a repeatable prompt/result.

Simulator success does not prove physical iPhone Metal execution. Physical-device model load, generation, memory, and thermal checks remain an explicit acceptance gate. Start with a small quantized GGUF model.

## Security and release boundaries

- Model output is untrusted text only.
- The app does not grant APEX approval, mint evidence, or bypass Director/East governance.
- The web workspace is separate and must enforce its own authorization.
- This initial scaffold does not encrypt GGUF files at rest.
- No Apple credentials, signing certificates, provisioning profiles, or model files belong in Git.
- No App Store, TestFlight, public distribution, or production release configuration is included.


## Competitive evaluation plan — required before merge

**Competitor baseline:** PocketPal AI for iOS, a directly comparable offline GGUF chat app using llama.cpp. Record the exact App Store version/build and date used for each test. References: [PocketPal AI on the App Store](https://apps.apple.com/us/app/pocketpal-ai/id6502579498) and [PocketPal AI source repository](https://github.com/a-ghorbani/pocketpal-ai). The competitor's published feature description identifies offline GGUF chat and llama.cpp as its local inference path.

**Controlled comparison:** Run on the same physical iPhone Air and iOS build. Use the same GGUF file (record SHA-256), quantization, context length, prompt template, system prompt, temperature, maximum output tokens, and fixed 20-prompt test set. Disable network access for local inference trials. Record three cold-start and three warm runs per prompt; report medians and p95 values. If PocketPal cannot load the exact same artifact or settings, mark that comparison non-comparable rather than claiming a win.

**Measurements:** valid/invalid import behavior, import duration, cold model-load duration, generation throughput (tokens/second), time to completed response, peak resident memory, memory-pressure events, thermal state before/after a 10-minute sustained run, battery delta, crash count, and blinded answer-quality scores on a fixed 0–4 rubric. Preserve raw device logs, app versions, model hash, and test configuration.

**Acceptance criteria:**

- 100% of valid test GGUF imports succeed; invalid headers are rejected without changing the previous model file.
- Zero stale-session responses, concurrent-load leaks, crashes, or unhandled memory-pressure terminations in the test set.
- Mean blinded answer-quality score is no worse than PocketPal by more than 2 percentage points, with no critical safety regression.
- Pocket AI Lab must beat the PocketPal baseline by at least 10% on one primary metric (median generation throughput or peak resident memory) while staying within 5% on the other performance metric and meeting the quality gate.
- Any result without the same device, model hash, and runtime settings is reported as a limitation, not as evidence of superiority.

**Current status:** This is a test plan, not a result. No Pocket AI Lab versus PocketPal performance claim is made until the physical iPhone Air measurements have been collected and reviewed.
