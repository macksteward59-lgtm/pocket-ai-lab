## Pilot contract

Compare a one-token DeepSeek reader with a compact trainable sentence selector, a fixed word-overlap baseline, and the same selector trained directly on reviewed labels. The eight source summaries and their reviewed answers in #285 supply 28 answerable questions (14 original and 14 paraphrases) and 16 authored missing-fact questions. The four separate specifications in `heldout.json` supply eight documented facts and eight missing facts. All replies concern the supplied summary alone.

Freeze these questions before inference. Fit only on training documents. The teacher gives each question/sentence pair a probability of support, constrained to Y or N on an equal basis. Keep a training pair only when its teacher choice agrees with the reviewed binary label. Use its probability as the student target. Compare against a hard-label student on the same retained pairs and a directly supervised student on all reviewed pairs. Return the top sentence only when its support probability exceeds 0.5. Score document-level outcomes by exact sentence index or explicit abstention. A wrong sentence on an answerable question is a miss. Score the supported and unsupported groups separately.

A candidate for further validation must match or exceed teacher correctness in both groups and beat the fixed word-overlap baseline overall. Only report an advantage from soft labels when the comparison with hard labels supports one. Collect CPU timing and the portable student's byte size. Physical-device performance requires a separate run. This pilot never promotes a model into the app automatically.

## Training-only calibration amendment

The first [CPU run](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45046248800) stopped before fitting or opening the evaluation set. DeepSeek assigned higher probability to Y on every training pair, including all 52 unsupported pairs. The two-class fitting check correctly rejected the remaining single-class sample.

The amended run keeps the original questions, splits, output threshold and acceptance criteria. It subtracts an offset from the teacher's Y-versus-N log odds. The offset is halfway between the mean log odds for reviewed positive and negative pairs, giving both classes equal weight. For each training document its offset is calculated from the other seven training documents. One final offset from the eight training documents is frozen for evaluation. The raw teacher remains a separate comparison. This is supervised calibration on training material. It cannot add distinctions the raw probabilities fail to express.

The student is a single hidden layer of eight units over ten text-matching features. It selects from sentences in the supplied source and can abstain. The pilot uses one-token decisions from the 1.5B DeepSeek checkpoint. The held-out comparison does not evaluate an unrestricted generative assistant. The fixed lexical control uses a Jaccard overlap threshold of 0.15.

To replay a saved student with Python's standard library, supply a question and the source's candidate sentences.

```sh
python3 tools/public-source-distillation/student.py --model student.json \
  --question 'When does the ferry depart?' \
  --sentence 'The ferry leaves at noon.' --sentence 'Tickets are blue.'
```
