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

The engine XCFramework must include iOS-device arm64, iOS Simulator, and macOS slices. The macOS slice is for host tests only, not iPhone execution.

The build sequence is:

```bash
brew install cmake ninja xcodegen
runtime/ios/scripts/build-llama-cpp.sh simulator
runtime/ios/scripts/build-llama-cpp.sh ios-device
runtime/ios/scripts/build-llama-cpp.sh macos
runtime/ios/scripts/build-llama-cpp.sh xcframework
xcodegen generate --spec ios/project.yml --project ios
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

### Export an evaluation for independent review

In **Self-evaluation history**, expand an attempt and copy its **Event SHA-256**. **Export this attempt as JSON** opens the Files picker. Each export contains that attempt’s prompt, output, model identifiers and evaluation metadata. The owner chooses the destination.

On a computer with this checkout, check the file against the digest you copied separately from the app.

```bash
python3 tools/evaluation-review/verify.py attempt.json --expected-event-hash "$event_hash"
```

A match shows that the selected event’s hashed bytes match that digest. Hardware identity, an Apple signature, review of the result, and physical-device acceptance each require separate evidence. A running journal detects a removed tail. Across restarts, retain an independent digest to identify a previously seen event.

To check a literal task answer, record the event digest before closing Pocket AI Lab. Reopen the app, export the same attempt, and supply the prompt and expected answer independently. For the starter suite’s `task-exact-token` case, run the following command.

```bash
python3 tools/evaluation-review/verify.py attempt.json --expected-event-hash "$event_hash" \
  --expect-answer "Return exactly this token and nothing else: PAL_TASK_COMPLETE" "PAL_TASK_COMPLETE"
```

The checker requires a completed attempt and compares the recorded prompt and output exactly, including whitespace. Suite 1.1.0 also uses a literal comparison in its four exact-answer cases. Earlier attempts retain their original suite version and score. Record the physical device and observed run separately.

### Compare the phone and server on the same passage check

The hosted Apple workflow publishes a **pocket-ai-lab-device-kit** artifact when its extracted Xcode project builds for generic iOS. On a Mac with Xcode, open the artifact ZIP, verify its tarball against the included SHA-256 file, extract it, and open `PocketAILab/ios/PocketAILab.xcodeproj`. The kit includes the pinned native libraries and source for signing with your Personal Team and running on a paired device. It contains no Apple signing material or model weights.

In **Local AI**, load an imported GGUF and tap **Check source evidence**. Six bundled questions exercise two published facts, two records with different synthetic balances and two questions whose evidence is absent. The expected response for a supported claim includes the passage label. Both implementations use the versioned prompts and expected outputs in [PassageChecks.json](PocketAILab/PassageChecks.json).

For a comparable model, use Qwen2.5-1.5B-Instruct Q4_K_M, SHA-256 `6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e`. The server uses llama.cpp's chat endpoint. Native uses the currently loaded app runtime and its input formatting. Record the actual model hash and runtime on each side. The accepted research target for this fixed check is six exact answers, including both abstentions.

On the physical iPhone, run offline after importing and loading the model. In **Evaluation history**, record the case ID and event digest from an attempt. Terminate the app, relaunch it and export that same saved attempt. The independent reader checks both the event digest and the answer against the pinned suite, for example:

```sh
python3 tools/evaluation-review/verify.py attempt.json --expected-event-hash "$event_hash" --passage-case account-corrected
```

Repeat for the other cases and retain failures. Separately record the device model, iOS/app build, offline state and any observed interruptions or thermal limits. The file digest alone cannot attest to hardware. The server reference can be reproduced on Linux x86_64 with `bash tools/openclaw-review/run-linux.sh --passage-results passage-server.json`. It writes raw outputs, model identity, runtime version and per-case scores. Inspect the artifact from the **Source passage server proof** workflow for the hosted run.
