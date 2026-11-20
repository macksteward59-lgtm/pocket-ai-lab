# Final native outcome — run 44762948524

The completed [native CI run 44762948524](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44762948524), attempt 1, **failed**. The frozen recipient benchmark and its independent verifier were the only failed steps. All platform build and regression-test stages passed.

| Validation | Tests/cases | Skips | Failures |
| --- | ---: | ---: | ---: |
| Darwin bridge-drain fixture | 4 | 0 | 0 |
| macOS regression | 145 | 1 | 0 |
| Native iOS app XCTest | 60 | 0 | 0 |
| iOS engine simulator XCTest | 146 | 4 | 0 |
| Dedicated native recipient benchmark | 1 | 0 | 2 assertion failures |

The simulator and macOS engine totals each include the 16 controlled-input contracts and 16 recipient benchmark contracts. Generic physical-iOS linkage also passed; no physical phone executed these tests. The fixture ran against an explicitly fake backend and is not real-model execution.

## Exact source and observed behavior

- Draft [PR #232](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/232), source `1a3a9d2813ab8d0a5a6c582b8b93144b63ee4bd5`.
- Actual checked-out PR merge: `93dbe9b06da6064d490676d572c7729d63395701`.
- Both trees: `c23179ef455c4fc8200a5c5cad3d5594af90ab8f`.
- Job ID: `136381812208`; complete run metadata and all step conclusions are in `outcome.json`.

All five recorded text outputs—the initial ordinary generation, earlier captured output, two adjacent ordinary controls, and ordinary generation after the A/B/A input sequence—were exactly `" Paris. Paris is a city known for"`. All computed equality flags were true. The A/A maximum logit delta was 0.0; A/B was 11.335649490356445.

The pre-drain diagnostic PR #231 subsequently also passed its text controls and macOS regression. The earlier text mismatch did not reproduce in that run. The drain repair fixes an independently fixture-reproduced lifecycle defect; these text-control passes do not establish that it caused the earlier mismatch. No timing or performance comparison is claimed across the differently scheduled hosted runs.

The frozen recipient experiment attempted all 36 requests, returned 32 invalid A/B answers and four empty-output errors, and scored 0/12 in each condition. Its unchanged execution assertions expected 36 completed generations and zero errors, so both failed. The exact six-member artifact and independent forensic audit are preserved separately at [`../../native-recipient-v1/44762948524/`](../../native-recipient-v1/44762948524/). Cleanup reported the caller lease released and no remaining model, use pin, active request, queued request or reserved memory.

## Preserved full log

`native-job.log.gz.base64` contains the complete original job log, compressed with deterministic gzip and then Base64-encoded to preserve it through the text-only repository publication path. It is not a redacted excerpt. `outcome.json` is a readable extraction of provenance, test counts, exact markers, failed assertions, benchmark metrics, and interpretation limits.

The original UTF-8 log is 3,617,068 bytes, SHA-256 `c57b17f037d830a2f6b56ff83a94a943f6f58ae12b54da3a1f30c5d2ddda616a`. To reconstruct and verify it from this directory:

```sh
python3 - <<'PY'
import base64, gzip, hashlib, pathlib
encoded = pathlib.Path('native-job.log.gz.base64').read_bytes()
data = gzip.decompress(base64.b64decode(encoded))
assert len(data) == 3617068
assert hashlib.sha256(data).hexdigest() == 'c57b17f037d830a2f6b56ff83a94a943f6f58ae12b54da3a1f30c5d2ddda616a'
pathlib.Path('native-job.log').write_bytes(data)
PY
```

`SHA256SUMS` binds the compressed text, outcome report and this README. The full workflow remains failed, and the pull request remains a draft. This evidence does not establish useful private-fact or GIE communication, physical-iPhone acceptance, or production readiness.
