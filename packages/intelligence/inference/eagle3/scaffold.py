"""Experimental EAGLE-3-inspired draft scaffold.

This is not the SafeAILab EAGLE-3 module at
https://github.com/SafeAILab/EAGLE/blob/d7161f9f94aaa345654d9b4045931145811d4d03/eagle/traineagle3/cnets.py
and it is not a TorchSpec draft model
(https://github.com/lightseekorg/TorchSpec). Upstream EAGLE-3 uses
``nn.Linear(3H, H, bias=False)`` into a ``LlamaDecoderLayeremb`` with
Llama RMSNorm. This file instead uses the supplied experimental shape:
``feature_projection`` is ``Linear(3H, H)``, ``state_token_fusion`` is
``Linear(2H, H)``, the mixer is ``nn.TransformerDecoderLayer`` (LayerNorm and
GELU, not Llama RMSNorm, RoPE, or SwiGLU), and ``lm_head`` is
``Linear(H, V, bias=False)``.

Nothing here is trained, exported, or able to accelerate a GGUF. Feature
fusion is not authorization. The tree mask is required on every forward so
the generic decoder layer cannot attend to future or sibling nodes.
"""

from __future__ import annotations

import inspect

import torch
from torch import nn

from tree_mask import additive_tree_mask


class Eagle3ScaffoldError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class ExperimentalEagle3Scaffold(nn.Module):
    """Untrained shape check for the supplied fusion and tree mask.

    ``grants_authorization`` is a constant false. The forward result is logits
    only. It is not an APEX receipt.
    """

    grants_authorization = False

    def __init__(self, hidden_size: int, vocab_size: int, nhead: int = 1, *, dtype: torch.dtype | None = None, device: torch.device | str | None = None) -> None:
        super().__init__()
        if not isinstance(hidden_size, int) or hidden_size < 1:
            raise Eagle3ScaffoldError("bad_shape", "hidden_size must be a positive integer")
        if not isinstance(vocab_size, int) or vocab_size < 1:
            raise Eagle3ScaffoldError("bad_shape", "vocab_size must be a positive integer")
        if not isinstance(nhead, int) or nhead < 1 or hidden_size % nhead != 0:
            raise Eagle3ScaffoldError("bad_shape", "nhead must divide hidden_size")
        self.hidden_size = hidden_size
        self.vocab_size = vocab_size
        self.feature_projection = nn.Linear(3 * hidden_size, hidden_size)
        self.state_token_fusion = nn.Linear(2 * hidden_size, hidden_size)
        layer_kwargs = {
            "d_model": hidden_size,
            "nhead": nhead,
            "dim_feedforward": hidden_size * 4,
            "dropout": 0.0,
            "activation": "gelu",
            "batch_first": True,
            "norm_first": False,
        }
        parameters = inspect.signature(nn.TransformerDecoderLayer).parameters
        if "enable_nested_tensor" in parameters:
            layer_kwargs["enable_nested_tensor"] = False
        self.extrapolation = nn.TransformerDecoderLayer(**layer_kwargs)
        self.lm_head = nn.Linear(hidden_size, vocab_size, bias=False)
        if dtype is not None or device is not None:
            self.to(device=device, dtype=dtype)

    def forward(self, low: torch.Tensor, mid: torch.Tensor, high: torch.Tensor, draft_token_embeddings: torch.Tensor, nodes: list[dict]) -> torch.Tensor:
        if self.grants_authorization:
            raise Eagle3ScaffoldError("authorization", "This scaffold cannot grant authorization")
        mask = additive_tree_mask(nodes)
        count = len(mask)
        low_b = _sequence(low, "low", self.hidden_size, count)
        mid_b = _sequence(mid, "mid", self.hidden_size, count)
        high_b = _sequence(high, "high", self.hidden_size, count)
        draft_b = _sequence(draft_token_embeddings, "draft_token_embeddings", self.hidden_size, count)
        _same_layout(low_b, mid_b, high_b, draft_b)
        projected = self.feature_projection(torch.cat((low_b, mid_b, high_b), dim=-1))
        fused = self.state_token_fusion(torch.cat((projected, draft_b), dim=-1))
        additive = torch.tensor(mask, dtype=fused.dtype, device=fused.device)
        hidden = self.extrapolation(tgt=fused, memory=projected, tgt_mask=additive, memory_mask=additive)
        return self.lm_head(hidden)


def _sequence(value: object, name: str, hidden: int, count: int) -> torch.Tensor:
    if not torch.is_tensor(value):
        raise Eagle3ScaffoldError("bad_tensor", name + " must be a tensor")
    tensor = value
    if tensor.ndim == 2:
        tensor = tensor.unsqueeze(0)
    if tensor.ndim != 3 or tensor.shape[-1] != hidden or tensor.shape[-2] != count:
        raise Eagle3ScaffoldError("bad_shape", name + " must be [N, H] or [B, N, H] for this scaffold")
    return tensor


def _same_layout(*tensors: torch.Tensor) -> None:
    first = tensors[0]
    for tensor in tensors[1:]:
        if tensor.shape[0] != first.shape[0]:
            raise Eagle3ScaffoldError("bad_shape", "Feature tensors must share a batch size")
        if tensor.dtype != first.dtype or tensor.device != first.device:
            raise Eagle3ScaffoldError("bad_layout", "Feature tensors must share dtype and device")
