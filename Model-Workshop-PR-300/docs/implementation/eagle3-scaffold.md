# Experimental EAGLE-3 scaffold

`packages/intelligence/inference/eagle3/` is an untrained shape-and-mask check. It is not a runnable EAGLE-3 accelerator, not a GGUF, and not an authorization path. Feature fusion returns logits only. `grants_authorization` is the constant `false`.

## What the code actually is

`tree_mask.py` is pure Python. A node may attend to itself and its explicit ancestors. The additive mask uses `0` for an allowed position and `-inf` for a blocked position. Siblings are blocked. A child listed before its parent is still blocked from the parent's row, so this is not a triangular positional mask. Cycles, duplicate ids, missing parents, multiple roots, and integer indexes fail closed.

`scaffold.py` imports PyTorch. TypeScript dependencies do not include torch, and `npm test` still passes when torch is absent: the torch tests skip. When torch is installed, the module is:

| Piece | Supplied experimental definition |
|---|---|
| `feature_projection` | `nn.Linear(3H, H)` on the concatenation of low, mid, and high features |
| `state_token_fusion` | `nn.Linear(2H, H)` on the concatenation of the projection and the draft-token embedding |
| `extrapolation` | `nn.TransformerDecoderLayer` with GELU and LayerNorm |
| `lm_head` | `nn.Linear(H, V, bias=False)` |

Every forward pass builds the tree mask and passes it as both `tgt_mask` and `memory_mask`. Without those masks, `TransformerDecoderLayer` can attend across the whole sequence.

## What this is not

The SafeAILab EAGLE-3 training module at commit `d7161f9f94aaa345654d9b4045931145811d4d03` (`eagle/traineagle3/cnets.py`) uses `nn.Linear(hidden_size * 3, hidden_size, bias=False)`, a `LlamaDecoderLayeremb` built from `LlamaRMSNorm`, and `nn.Linear(hidden_size, draft_vocab_size, bias=False)`. That decoder is Llama attention, not `nn.TransformerDecoderLayer`. This scaffold does not load those weights and does not reproduce RMSNorm, RoPE, or SwiGLU.

[TorchSpec](https://github.com/lightseekorg/TorchSpec) is a separate PyTorch training framework. Its tree includes `torchspec/models/eagle3.py` and `torchspec/models/draft/llama3_eagle.py`. This repository does not import TorchSpec and does not claim to train or export a TorchSpec draft model.

A method named like EAGLE-3 does not make this module compatible with vLLM or SGLang. No draft weights are shipped. The pinned SmolLM2 GGUF in `scripts/local-gguf/` is an ordinary llama.cpp smoke model, not an EAGLE-3 head.
