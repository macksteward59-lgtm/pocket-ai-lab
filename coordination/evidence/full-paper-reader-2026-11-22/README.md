# How the distilled reader performs on complete research papers

The frozen 29/32 short-document reader matched zero of the 24 independently annotated answers on the first full-paper test. It correctly declined all 15 unanswerable questions. A native Swift port on an iOS 26.2 simulator matched every Python choice and all 6,152 sentence probabilities within the specified tolerance. The reader remains experimental. A subsequent full-paper training run and a separate retrieval comparison identify how much evidence is lost before the reader can select it.

## Original reader on complete text

[Draft #288](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/288) was tested at `307b5f3676a85042a0e2e4017a091689db72c6a1`. The [frozen plan](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/f42ff1ea320050e81ddcae08c5e985d9a1a5697a/tools/long-document-reader/README.md) pinned the previous weights, QASPER release, reference alignment, topic filter, deterministic sampling and source cap. [QASPER](https://aclanthology.org/2021.naacl-main.365/) provides questions, answers and supporting evidence authored by NLP practitioners. Inputs comprised the whole supplied abstract and extracted body text of each selected paper. Table images and PDF layout were excluded. This benchmark scores a supported answer only when its selected sentence contains an accepted extractive answer and occurs in that annotation's evidence paragraph. Other semantically valid phrasings may receive no credit.

The official test split contributed **39 questions from 32 papers**, with 71–367 sentence candidates per paper (median 164.5). This specialist slice had 123 aligned positive questions and 15 eligible unanimously absent questions before deterministic selection. The test therefore contains 24 supported and 15 absent questions.

| Frozen model | Correct / supported | Chose a different sentence | Declined a supported question | Correct / absent | Correct with annotated evidence paragraphs supplied, positives only |
|---|---:|---:|---:|---:|---:|
| Hard-label reader | 0/24 | 5 | 19 | 15/15 | 1/24 |
| Soft-label reader | 0/24 | 12 | 12 | 14/15 | 3/24 |
| Fixed overlap | 1/24 | 9 | 14 | 11/15 | 1/24 |

The Linux and macOS case reports agreed. The optimized Swift program actually executed inside a booted iPhone simulator. For 39 decisions the maximum absolute difference from Python was 1.665e-16 across 6,152 scores. Median native scoring time per question was 1.15 ms after document preprocessing. This is simulator timing for a standalone reader. There is no signed iPhone Air timing, memory measurement or production-app integration in this experiment. [Hosted Linux and simulator verification](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45067865338)

## New full-paper training with a five-sentence shortlist

[Draft #290](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/290) first fixed the [training protocol](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/bd73a550fe5f9169e8e7534196df2bcd36a89409/tools/full-paper-distillation/README.md) and evaluated on a fresh official development split. BM25 ranked sentences from each whole paper. Training pairs from 48 questions on 39 training papers went to the pinned DeepSeek-R1-Distill-Qwen-1.5B CPU teacher. The protocol supplied one reference sentence during training when retrieval missed it. Development retrieval never saw reference indices. The 23 development papers shared no paper IDs with the training or official test splits. The trained weights were written before selecting development questions. The final run retained 36 of 72 training pairs after calibration on other training documents.

On 24 supported development questions, BM25 retrieved an accepted sentence first for 1 question and in the top five for 7. The other 17 questions had no accepted answer in the available shortlist. On the final hosted run, outcomes were:

| Reader | Supported correct / 24 | Other sentences selected on supported questions | Refusals on supported questions | Unsupported selections / 14 absent |
|---|---:|---:|---:|---:|
| Previous hard reader, full text | 0 | 4 | 20 | 1 |
| Previous hard reader, shortlist | 0 | 4 | 20 | 1 |
| Verified hard training pairs | 0 | 18 | 6 | 13 |
| Calibrated soft training labels | 3 | 6 | 15 | 6 |
| Direct training on all pairs | 1 | 16 | 7 | 11 |

No candidate met the frozen answer-mode criteria. Teacher outputs and therefore retained examples varied across repeated hosted executions. The four observed runs are listed in order. The same 38 development questions were used in each run and count as one sample.

| Run | Retained / 72 | Hard correct / 24 | Hard unsupported / 14 | Soft correct / 24 | Soft unsupported / 14 |
|---|---:|---:|---:|---:|---:|
| [1](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45068214664) | 41 | 1 | 12 | 1 | 6 |
| [2](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45068435322) | 36 | 0 | 13 | 3 | 6 |
| [3](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45068508294) | 41 | 1 | 12 | 1 | 6 |
| [4](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45068537686) | 36 | 0 | 13 | 3 | 6 |

## Independent evidence-search comparison

The [retrieval plan](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/aed2855a08650f27084e5b1a49db1650325866ce/tools/full-paper-distillation/retrieval-plan.md) froze E5-small-v2 and BM25 before comparing them on 24 further QASPER test papers. All 32 papers used in the original full-document test were excluded. Each new paper contributed one supported question. Relevance refers to the same extractive reference and evidence alignment as above. Sentences were ranked within their paper. No reader was fitted on these papers.

| Search method | Evidence first / 24 | Evidence in first five / 24 |
|---|---:|---:|
| BM25 | 0 | 7 |
| E5-small-v2, int8 CPU | 5 | 10 |

E5 recovered three more cases in the first five overall. Fourteen of 24 still lacked an accepted supporting sentence among those five. These are search results on answerable questions. Abstention was not tested in this comparison. E5's pretrained corpus overlap with public documents was not established. [Encoder model card](https://huggingface.co/intfloat/e5-small-v2) · [Hosted retrieval run](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45068537650)

## Reproduction and retained records

The scripts fetch the pinned public QASPER distribution. Corpus attribution and source materials are available from [Allen Institute for AI](https://huggingface.co/datasets/allenai/qasper). The archives retain question IDs, source indices, individual decisions and the numerical outputs required for verification. They do not redistribute the paper text. We independently recomputed reference-based scores, verified every archived blob, reloaded and refitted the three exported readers from each run's teacher trace, and matched the native choices against the Linux report.

| Archive | SHA-256 |
|---|---|
| [full-text-linux.zip](full-text-linux.zip) | `476164e629335e10ff2f035b242540d4b576c0fad17ef3b0b037fdf7c222b1ad` |
| [full-text-ios.zip](full-text-ios.zip) | `ef12b9b6c43c5ab4bbaa6e1c7ac80e818287e19a2fd6ddbef24d31ba9771e828` |
| [first-full-paper-training.zip](first-full-paper-training.zip) | `fa17fcb4b363148457e47e37c14ca3e3a45c3637ee464cad0e8cc33e412068ce` |
| [second-full-paper-training.zip](second-full-paper-training.zip) | `26ccbf183fcdd93505e9b903ae82d668b04d64d4fa2a1b0f2b250dc6158b43bd` |
| [third-full-paper-training.zip](third-full-paper-training.zip) | `f13a9d0c1131f3d4d49810d836a75c65fe502ecc9df5dfa1b5d0dd4ba4cf65e4` |
| [final-full-paper-training.zip](final-full-paper-training.zip) | `80f21a37425467cc959bcd33f18e20606e7e1a680c35be7781b0c920ea4ec364` |
| [fresh-paper-retrieval.zip](fresh-paper-retrieval.zip) | `2bf00bbbbdaa91ed699105793ce2b7d289a5f90b497d089cdd2c2969bbfa12ef` |

The next reading experiment should measure evidence recall over neighboring sentences or whole paragraphs, alongside a separate check that the cited text answers the question. Existing results qualify the simulator implementation for further tests. They give no basis for enabling automatic full-paper answers.
