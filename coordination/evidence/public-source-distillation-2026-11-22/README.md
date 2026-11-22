# Public-document distillation pilot

The best small sentence selector in this experiment used hard labels from the reviewed examples on which DeepSeek agreed. It scored 29/32 across eight new documents. Training on the teacher's calibrated probabilities scored 25/32. Both students had the same 97-parameter architecture, training examples and features. The pilot supports trying the hard-label model on a larger blind test. Neither model is connected to the live app.

## Questions and results

Each question gets one source with candidate sentences. A correct response selects the exact supporting sentence, or returns `UNKNOWN` when the requested fact is missing from the summary. Counts below give correct supplied facts followed by correct abstentions. Each cell is out of eight in each group.

| Method | Four format specifications | Four additional topics | Total correct |
|---|---|---|---|
| DeepSeek, raw Y/N | 5 and 0 | Untested | 5/16 |
| DeepSeek, calibrated | 5 and 1 | Untested | 6/16 |
| Fixed word overlap | 7 and 3 | 7 and 6 | 23/32 |
| Direct supervision on all 80 reviewed sentence pairs | 7 and 7 | 6 and 6 | 26/32 |
| Verified hard labels on 50 retained pairs | 8 and 7 | 7 and 7 | **29/32** |
| Distilled probabilities on the same 50 | 7 and 7 | 3 and 8 | **25/32** |

The soft-label student met the original pilot target on the format specifications. On the second test it declined to answer five questions whose answers were in the source, including the mass of a nickel. The hard-label student's 29/32 comprises 15/16 supplied facts and 14/16 correct abstentions. The questions and short source summaries were authored for this pilot. These results measure sentence selection in this setting. They do not establish general reasoning or physical-device performance.

## How the run was conducted

[Draft #287](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/287) is stacked on #285. The [preregistered split and measures](https://github.com/macksteward59-lgtm/pocket-ai-lab/tree/2d8e0f00e668962291ab4c1856c612ab3809a900/tools/public-source-distillation) contain eight reviewed training sources and four distinct evaluation documents. Training used 28 questions with supplied facts and 16 missing-fact questions. The four held-out specifications covered JSON, gzip, CSV and PNG. Each source was accompanied by a bounded summary, and a fact was judged absent relative to that summary. The trainer received no held-out questions for fitting or calibration.

The teacher was the community Q4_K_M conversion of [DeepSeek-R1-Distill-Qwen-1.5B](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B) at model repository commit `9cc28b17e86fa2415fcb070f8ee5ec27c965aa61`. The model bytes were SHA-256 `1741e5b2d062b07acf048bf0d2c514dadf2a48f94e2b4aa0cfe069af3838ee2f`. A pinned llama.cpp b12608 server ran locally on the GitHub-hosted Linux CPU. No third-party model API or Cloudflare inference was used. This is a binary reading test using the model's next-token preferences.

In the [initial run](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45046248800) the teacher favored Y for all 80 training pairs. That left zero verified negative examples and halted training. Before running the test set, the [amendment](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/865864e69790bddfdcf43ce38640f884aefb12a8/tools/public-source-distillation/README.md) introduced supervised calibration of the teacher's log odds. Each training document used an offset from the other seven. The held-out teacher used an offset from all eight. The calibrated teacher agreed on 18 positive and 32 negative training pairs. Both students trained on those same 50. A separate control used all 80 reviewed answers. The evaluation loaded the frozen model files. [Successful CPU run](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45046515302) · [General CI](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45046510536)

For the transfer check, the [additional question file was committed](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/45d0a5da5a3faa736189d4696fe59d5f6e6c0bdd/coordination/evidence/public-source-distillation-2026-11-22/transfer-questions.json) before replay. It uses public information from [NASA on Mars' moons](https://science.nasa.gov/mars/moons/), the [U.S. Mint coin specifications](https://www.usmint.gov/content/usmint/us/en/learn/coins-and-medals/circulating-coins/coin-specifications.html), [FIDE's virtual chessboard rules](https://handbook.fide.com/files/handbook/OnlineChessRegulations.pdf), and [NIST on the second](https://www.nist.gov/pml/owm/si-units-time). Source IDs, URLs, summary sentences and questions were checked for reuse across sets. The three weight files and thresholds stayed fixed. The teacher did not run on these additional documents. All 16 soft-student responses were also replayed through the standalone command.

## Reuse and verification

The [portable reader](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/865864e69790bddfdcf43ce38640f884aefb12a8/tools/public-source-distillation/student.py) uses Python's standard library. Download it with either the [hard-label weights](hard.json) or [soft-label weights](student.json). Pass a question and one or more candidate sentences from the same source. For example:

```sh
python3 student.py --model hard.json \
  --question "Where can the optional CSV header appear?" \
  --sentence "A CSV file may place an optional header on its first line." \
  --sentence "Inside a quoted CSV field, a literal double quote is represented by two successive double quotes."
```

The soft and hard weight files use 2,243 and 2,205 bytes. These sizes exclude the Python runtime and feature code. On the first held-out set the median score time was 0.049 ms per question for the in-process soft student and 352 ms for the loaded teacher over local HTTP, with two sequential sentence requests per question. This is a host-path measurement. Phone latency, memory and integration remain unmeasured.

| Artifact | SHA-256 |
|---|---|
| [Initial training trace](raw-teacher-attempt.zip) | `abe03aa5fcda274cdea348e781703e2756ac70e4da1ecd1bd426d8061f2c68bc` |
| [Calibrated run, both traces and all three model exports](calibrated-run.zip) | `10d1c9f4b37ee3eba0d727fe17f38cb60bf4ee19e73db9e2d5ff2ffff56c48ed` |
| [Verified hard-label model](hard.json) | `cbe45e272cd1f398bb2b141a5ef0ee453db70d1e78f288c988f73f09b1ee82e9` |
| [Soft-label student](student.json) | `a83d342fa81b413eb38602ed2c6f76f3be4153fad3db5b628f1ea02314826754` |
| [Transfer questions](transfer-questions.json) | `b2ac6e95e0805575e15ad3e24d4189202d1786f01488d2b04a114d11c846c2aa` |
| [Transfer scores and CLI responses](transfer-results.json) | `7c583d4b324daee6aa9ace4cce6f833237d14a29d399276d816a7645913ab270` |

Independent checks recomputed the calibration offsets from the recorded training probabilities, checked the model-file digest, reloaded all exported students, and checked each prediction against its source and answer key. The next validation should include independently authored questions, longer documents and a signed device run before any mobile promotion.
