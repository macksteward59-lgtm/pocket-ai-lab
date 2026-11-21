# Closed-choice fact recall

The iOS calibration in [run 44777249548](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44777249548) returned zero exact A/B answers across 36 chat prompts. Does limiting the output to one of those two letters also make the recipient follow a supplied fact?

## Frozen design

Use all 36 chat rows from the existing recipient format calibration. These development cases were already examined. For each prompt run an unrestricted control and a second arm with the llama.cpp grammar `root ::= "A" | "B"`. Alternate which arm runs first across source ordinals. Each call starts with the full prompt and disables prompt caching. Use the same b12233 Linux x86_64 CPU server, checked SmolLM2-135M Q4_K_M model, 512-token context, greedy decoding and four-token maximum in both arms. Check input tokens against the archived native tokenizer results before generating. Supply only prompt token IDs and the decoding parameters to the server.

The fixture has 12 cases, two answer positions, and three message conditions. In the correct condition the message gives the original fact. In the counterfactual condition it states the opposite fact. Score that condition against the changed fact. In the absent condition no fact is provided. Agreement with the hidden original answer is a baseline, not evidence of recall.

Apply the original exact-letter parser to complete outputs. Keep every raw response, error and stop reason. Use fixed denominators even for errors. Report the number of valid letters out of 36, correct answers in each condition out of 12, and the number of cases with correct answers on **both** the original and reversed messages out of 12. Count A and B outputs to expose fixed-position strategies.

Set the following criteria before obtaining results. Format passes at 36/36. For a positive development signal the constrained arm must also reach 10/12 for each supplied-message condition, 9/12 correctly switched pairs, and strictly more correctly switched pairs than its control. A failed quality criterion is a valid experimental outcome. This is a Linux diagnostic on known synthetic cases. A device acceptance decision would need new held-out cases and a physical-device run.

## Reproduce

From the repository root on Linux x86_64, run `bash tools/recipient-choice/run.sh /tmp/choice-evidence` with an unused output directory. The runner downloads two checksum-pinned files and uses a loopback server. It writes preflight evidence, one record for each scheduled inference, a JSON summary and a Markdown table. GitHub Actions publishes these files even if a measurement error interrupts the run.
