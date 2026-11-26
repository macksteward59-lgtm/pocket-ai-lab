# Full-paper evidence distillation

The frozen #287 reader missed all 24 supported cases in the #288 QASPER test slice. This follow-up uses separate QASPER training papers for fitting and a fresh official development split for scoring. The #288 test result motivated the method and is excluded from final evaluation. No validation outcomes have been inspected to choose the method.

## Frozen plan

Use the original QASPER 0.3 train/dev archive with SHA-256 `a28fdf966db827bcee3d873107d6b6669864fb7ca8fbf73a192f5e39191bdb5a`. Apply #288's fixed paper-topic filter, minimum length, question eligibility, source cap and deterministic question selection separately to each split. Verify document IDs are disjoint across all three official splits. Do not train on development or test questions. The unit of success is the evidence-aligned sentence or an explicit abstention.

Rank sentences within their own paper with BM25, using k1=1.2, b=0.75 and the existing reader's tokenizer. Shortlist five in stable order. Fit the same 97-parameter network. For each training question with a reference, label one gold sentence and the strongest non-reference competitor. If necessary include a reference sentence in the last training slot. For a training question labelled missing, label the first retrieved candidate. Never inject a reference at evaluation. Retain all eligible evaluation questions in the denominator, including when retrieval misses the reference.

Reuse #287's CPU DeepSeek teacher, source-excluded calibration, fixed probability threshold and optimizer. Compare the domain-trained hard- and soft-label readers, the same architecture directly supervised on all sampled pairs, and the original hard reader on both full text and the identical shortlist. Report retrieval recall at one and five for supported questions. Report refusals, wrong selections and unsupported answers separately. A candidate requires at least half of documented answers, zero wrong selections, and zero answers on missing facts for further answer-mode consideration. The benchmark represents annotation agreement and cannot certify all possible valid phrasing.

Only the public research-paper training questions go to the local teacher. Export the weights before generating development predictions. No model deployment or device promotion is part of this experiment.
