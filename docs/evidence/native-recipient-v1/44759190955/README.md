# Pre-drain diagnostic and frozen recipient v1 — run 44759190955

The [native diagnostic run 44759190955](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44759190955), attempt 1, completed with **failure**. The native regression suites passed; the frozen recipient benchmark and independent verifier failed. This existing run was preserved unchanged while the child drain-repair branch was developed. It was not a retry selected to obtain a desired result.

## Exact source and regression results

- Draft [PR #231](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/231), source `0a3bc9df657445de4433f534c597ebdea0a34725`.
- Actual PR merge checkout: `95e690838724c5d4e43cbd3aa99bdae8eb49045a`.
- Source and checkout tree: `590e66c8278bcf11f0200dd0f98d96317fcfe3b7`.
- Job: `136366867224`.

Native app XCTest reported 60 tests and zero failures. Engine simulator XCTest reported 146 tests, four skips, and zero failures. macOS regression reported 145 tests, one skip, and zero failures. The simulator ultimately booted successfully; its inconsistent intermediate step status was not a confirmed boot failure.

All five recorded text outputs were exactly `" Paris. Paris is a city known for"`: initial ordinary generation, earlier capture, the two adjacent ordinary controls, and the ordinary generation after A/B/A. Every match flag was true. A/A logit maximum difference was 0.0; A/B was 11.335649490356445, with repeat tolerance 0.001.

The earlier ordinary-text mismatch did not reproduce on this pre-drain source. The independently fixture-reproduced drain lifecycle defect remains valid, but neither this run nor the child run establishes it as the cause of that earlier mismatch.

## Negative recipient result and comparison

All 36 scheduled requests were attempted. Of those, 32 returned text that failed the frozen exact A/B parser and four failed with empty-text backend errors. Each correct/absent/counterfactual arm scored 0/12, with all paired quality metrics also zero. The four error ordinals were 6, 14, 26 and 29. There were no budget-unstarted rows, and cleanup reported the lease released with no remaining models, uses or active/queued requests.

Raw output frequencies were 29 instances of `"\n\nWhat is"`, three of `" cedar\n\nWhat"`, and four null outputs carrying the empty-text error. The unchanged XCTest assertions required 36 completed generations and zero generation errors; both failed. The independent verifier also failed. A consistent forensic audit does not convert either failed gate into a pass.

Every trial matches the corresponding [child run 44762948524](../44762948524/) across ordinal, case, condition, prompt digest, raw output, status, parsed answer, expected answer, score and error. Request UUIDs and latency fields were excluded from that content comparison. The identical observations do not prove general equivalence or response quality. Recorded experiment elapsed time was 110,137 ms here and 9,477 ms in the child run; their different scheduling conditions do not support attributing a performance effect to the repair.

## Preserved evidence

The six original artifact members are preserved without byte changes. `artifact.zip.base64` also preserves the exact original ZIP bytes; Base64 decoding reconstructs the archive with the size and digest listed below. `outcome.json`, `audit.json` and `text-controls.json` contain the separately produced reports. `run-metadata.json` and `final-status.json` retain retrieved run/job/artifact provenance. Absolute scratch paths inside these original capture reports describe their initial capture location; the corresponding evidence is stored in this directory.

- Original artifact: `14644254061`, `native-recipient-text-44759190955-1`.
- Original ZIP: 30,131 bytes; SHA-256 `9642c4be702b24d48e0208775faddaa3453281b3e6ccdecb2ff04907ae0d6167`.
- Frozen manifest: SHA-256 `376b9eef0c0b6b935307a4e9b2ce48ad5780281a1944394ac7a174a40ca3a51d`.
- Model SHA-256: `2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d`.

`native-job.log.gz.base64` preserves the complete decoded API job log, including its leading UTF-8 BOM, using deterministic gzip plus Base64. Decode it as follows:

```sh
python3 - <<'PY'
import base64, gzip, hashlib, pathlib
data = gzip.decompress(base64.b64decode(pathlib.Path('native-job.log.gz.base64').read_bytes()))
assert len(data) == 3622932
assert hashlib.sha256(data).hexdigest() == '49b6b5fdba7aaaec8f6da2c62dff0c9f880b51a6062e8ced1a45f50d68fcdd10'
pathlib.Path('native-job.log').write_bytes(data)
PY
```

`SHA256SUMS` binds every preserved file in this directory. The frozen prompts, parser, model, generation settings, scoring and failed gates remain unchanged. Token IDs and termination reasons were not captured for the four empty results, so their cause remains unestablished. These are hosted Mac/simulator measurements, not physical-iPhone acceptance or a working GIE communication result.
