# Source-check measurements and verified device kit

[Draft PR #261](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/261) extends the phone/server passage check in [#258](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/258). Source `2115057a6affe8160c786309b56a2100ad883c81`. The attached frontier research and project roadmap called for measured iPhone resource use. This checkpoint makes one run reviewable after the app reopens its journal.

| Observation | Result |
| --- | --- |
| Environment | Hosted Intel Mac, iOS Simulator, Version 26.1 (Build 23B86) |
| Answers | The XCTest used a mock provider. The reviewer counted 0 native generations. |
| Cases | 6/6 distinct frozen questions in order, all with OS observations |
| Process footprint | Largest observed value was 70,107,136 bytes (66.86 MiB). It includes the test app and its provider. |
| Sampling | 12 observations, counts by case 2, 2, 2, 2, 2, 2, with an initial and final reading in every case |
| Energy and heat | Worst reported thermal state `nominal`. Available app memory on the physical device and battery use remain unmeasured. |
| Comparison | The pinned Linux 1.5B reference retains 3/6 exact answers. The simulator test fixture has a different model fingerprint. |
| Apple test result | The simulator passed 76 app unit tests and one UI test. Its runtime suite reported 154 tests, five skipped and zero failures. The Memory vault check passed. |
| Separate macOS model gate | The frozen macOS model benchmark and its independent check failed. Of 36 trials, 32 replies were malformed and four generations failed. |

## Reproduce the readback

The test opened its persisted journal, ran the same suite again under the same lease, and checked that each invocation retained its own identifier and digest. The [original simulator file](simulator-run.json) contains the first invocation. Its separately recorded run digest in the [Apple job](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44986761973/job/137098990530) is `0f912f644adc4cdfaaca0244a5b8f1446f19d0acb2a9ba735199acc07b056a7d`. The [review output](reviewed-simulator-run.json) was produced by the Python code inside the downloaded device kit.

From the extracted `PocketAILab` folder, run

```sh
python3 tools/evaluation-review/source_run.py simulator-run.json --expected-run-hash 0f912f644adc4cdfaaca0244a5b8f1446f19d0acb2a9ba735199acc07b056a7d
```

The reviewer rejected a mismatched digest and a change to one event payload. It reported an independently digested five-case prefix as incomplete and exited with status 1. A valid digest checks the selected records and their order. Physical-device identity still requires an independent observation.

## Run it on the iPhone Air

1. Download the [device test kit](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44986761973/artifacts/14740773243). The [package record](kit.json) gives both archive hashes and the tested source commit. Extract the ZIP and then the tarball on the Mac. Open `PocketAILab/ios/PocketAILab.xcodeproj`, select the paired phone, and sign the app using the owner's Personal Team.
2. Import the [same model as the Linux run](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/blob/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf). Before importing, run `shasum -a 256` on the GGUF on the Mac and confirm the model SHA-256 `6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e`. Record the device model and iOS build separately.
3. In Local AI, load the model, go offline, and choose **Check source evidence**. Copy the run SHA-256 separately, quit and reopen the app, then use **Self-evaluation history → Latest source check → Export source check as JSON**.
4. Run the same review command on the Mac with the phone export and independently copied digest. Inspect case coverage, provider, model fingerprint, resource observations and raw responses. Preserve failures and partial runs. The first physical run is outstanding.

Resource samples cover generation. Loading the model, hashing the file and spikes between samples fall outside this measurement. Thermal pressure and Low Power Mode do not measure energy consumption. The repository contains only the synthetic CI run and the hosted reference.

## Three measured runs on a Linux server

Each run launched a fresh CPU-only llama.cpp server and sent the same six frozen questions. The server validated the pinned GGUF on each invocation. The local process returned 4/6 exact answers on all three runs. The saved GitHub-hosted reference returned 3/6. In both local misses the model returned the correct balance but omitted the required passage label. [Per-case results, original replies, timings and resource usage](linux-server-runs.json).

| Run | Exact answers | Maximum resident size | Elapsed, including startup and shutdown |
| --- | ---: | ---: | ---: |
| 1 | 4/6 | 1,851,716 KiB | 7.910 s |
| 2 | 4/6 | 1,851,736 KiB | 8.441 s |
| 3 | 4/6 | 1,851,352 KiB | 7.119 s |

Linux reported maximum resident set size for the inference process over its lifetime via `wait4`. The iOS measurement samples app footprint during individual generation requests. Their values use different accounting and time windows. One cannot be substituted for the other when choosing an iPhone memory budget. [Linux resource accounting](https://man7.org/linux/man-pages/man2/getrusage.2.html).

To repeat on Linux, use the pinned GGUF, the same llama.cpp release, and a fresh directory for each measurement. Make the executable [recorder](measure-server.py) available beside the checkout. Set the paths in the following commands to local files.

```sh
export POCKET_LLAMA_SERVER=/absolute/path/to/llama-server
export POCKET_SERVER_USAGE="$PWD/usage.json"
python3 tools/passage-check/server.py --gguf "$gguf" --llama-server "$recorder" --output "$PWD/answers.json"
```
