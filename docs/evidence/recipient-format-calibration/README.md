# Recipient format-calibration evidence — PR #234

Both attempt-1 [PR #234](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/234) runs are preserved here. The first failed before native tokenization or inference. The second captured all 72 scheduled attempts and passed measurement integrity, then **failed the strict chat-format gate**. Original recipient v1 negative results and acceptance criteria remain unchanged.

## Run comparison

| Evidence | [44774751361](44774751361/) | [44777249548](44777249548/) |
| --- | --- | --- |
| Source | [`811b02646fc30cba4eea86dc53adecde208b7222`](https://github.com/macksteward59-lgtm/pocket-ai-lab/commit/811b02646fc30cba4eea86dc53adecde208b7222) | [`6a61281a1d28a6b8ee1a292c74f8515c2250d110`](https://github.com/macksteward59-lgtm/pocket-ai-lab/commit/6a61281a1d28a6b8ee1a292c74f8515c2250d110) |
| Native run | Failed during probe compilation | Failed only strict chat-format gate |
| General CI / 43 Python tests | Passed / passed | Passed / passed |
| Vocabulary observations | None | All 72 prompts verified |
| Generation attempts | None; unmeasured | 36 raw + 36 chat |
| Measurement integrity | Failed for missing observations | Passed |
| Strict raw A/B answers | Unmeasured | **0/36** |
| Strict chat A/B answers | Unmeasured | **0/36** |
| Generation errors, raw / chat | Unmeasured | **4 / 0** |
| Native fixture tests / measurement XCTest | Skipped / skipped | 7 passed / 1 passed |
| Separate chat-format gate | Skipped | **Failed** |

The first run's undeclared `O_NOFOLLOW` errors stopped compilation. A guarded Darwin declaration macro enabled the second run while preserving existing no-follow operations, frozen inputs, settings and gates. The later vocabulary-only probe verified the pinned template and input sequences; it did not instrument the generation invocation itself. See the original workflows [44774751361](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44774751361) and [44777249548](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44777249548).

## Measured negative result

The fixed run recorded 32 raw text returns rejected by the frozen exact A/B parser and four empty-output generation errors. The chat arm recorded no generation errors but all 36 text returns were also invalid: `"B: maple"`, `"B: cedar"`, and `"No stored word is"`, 12 each. No outputs were reinterpreted or rescored. Each format scored 0/12 in every correct, absent and counterfactual condition; intended switches and paired correct counts were zero. Passing the measurement XCTest establishes consistent capture, not satisfaction of the separate format gate.

The original v1 negatives remain at [parent run 44759190955](../native-recipient-v1/44759190955/) and [child run 44762948524](../native-recipient-v1/44762948524/): 36 attempts, 32 invalid returns, four empty-output errors and 0/12 per condition in each run. Their unchanged completion/error assertions and independent verifier failed. All 36 new raw trial contents match the child v1 observations excluding UUIDs and latency; this comparison does not change those results.

The fixed run's measured interval was **22.073 seconds**; the whole measurement XCTest was **66.206 seconds**. These scopes differ. No performance comparison, isolated causal explanation, useful private-fact or learned GIE communication, physical-device acceptance or production readiness is established.

## Preservation

The unchanged format manifest is 44,072 bytes, SHA-256 `95acbcd4237899a2234fd9c16f5e86823cec1595e6922c96cb54851d15432992`: 12 cases × 3 conditions × 2 formats. Each directory preserves the exact ZIP, all non-prompt artifact members, the complete native/evidence-contract/general-CI job logs, original capture metadata and separate independent audit. All 72 prompts per run are inside the exact ZIP. Large artifact logs and all complete job logs use deterministic gzip (level 9, timestamp zero, no filename) plus Base64. Other artifact JSON/JSONL/text files are verbatim copies.

| Run | Original ZIP bytes | SHA-256 |
| --- | ---: | --- |
| 44774751361 | 39,323 | `8e934e88330f6d47023e5112f911925b329ef6c626dd118397e8861dcb3cd819` |
| 44777249548 | 105,688 | `e501207e0fe98bdc919b6103b4b61233fa95026bb851509254636d7d73d5a0ac` |

## Restoring the preserved files

Run `sha256sum -c SHA256SUMS` here to verify all published files, including the per-run checksum manifests. Each run's manifest covers every file inside that run except itself. `representation-index.json` maps encoded files to original paths, sizes and SHA-256 values; `artifact-members.json` covers all original archive members.

Run the following here to restore either selected run into a fresh directory. The reconstructed ZIP contains every original member, including all 72 prompts.

```sh
python3 - 44777249548 restored-44777249548 <<'PY'
import base64, gzip, hashlib, json, pathlib, sys
source = pathlib.Path(sys.argv[1]).resolve()
target = pathlib.Path(sys.argv[2]).resolve()
target.mkdir(parents=True, exist_ok=False)
index = json.loads((source / 'representation-index.json').read_text())
for item in index['encodedFiles'] + index['verbatimFiles']:
    data = (source / item['storedPath']).read_bytes()
    if 'encoding' in item:
        data = base64.b64decode(b''.join(data.splitlines()), validate=True)
        if item['encoding'] == 'gzip+base64':
            data = gzip.decompress(data)
        else:
            assert item['encoding'] == 'base64'
    assert len(data) == item['originalBytes']
    assert hashlib.sha256(data).hexdigest() == item['originalSHA256']
    output = (target / item['restorePath']).resolve()
    assert target in output.parents
    output.parent.mkdir(parents=True, exist_ok=True)
    assert not output.exists()
    output.write_bytes(data)
print('Restored and verified', target)
PY
```

Every encoded representation was decoded and byte-compared with its captured original; all 177 archive members, including 144 prompts, and all directly copied reports were verified. This preservation step performed no inference, rescoring or workflow rerun.
