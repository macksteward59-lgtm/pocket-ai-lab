"""Atomic CPU LoRA checkpoints with JSON metadata and named safetensors."""
import hashlib
import json
import os
from pathlib import Path
import stat
import struct

MAX_BYTES = 32 << 20
MAX_HEADER = 256 << 10
MAX_DRAFTS = 32


class InvalidCheckpoint(ValueError):
    pass


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def split(raw):
    if len(raw) < 8:
        raise ValueError("truncated header")
    length = struct.unpack_from("<Q", raw)[0]
    if not 0 < length <= min(MAX_HEADER, len(raw) - 8):
        raise ValueError("invalid header size")
    header = json.loads(raw[8:8 + length])
    return header, memoryview(raw)[8 + length:]


def checksum(manifest, layout, payload):
    return hashlib.sha256(encoded([manifest, layout, hashlib.sha256(payload).hexdigest()])).hexdigest()


def read(path, with_state=False):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as f:
            st = os.fstat(f.fileno())
            if not stat.S_ISREG(st.st_mode) or not 0 < st.st_size <= MAX_BYTES:
                raise ValueError("invalid checkpoint size")
            raw = f.read(st.st_size + 1)
            if len(raw) != st.st_size:
                raise ValueError("checkpoint changed")
        layout, payload = split(raw)
        metadata = layout.pop("__metadata__")
        manifest = json.loads(metadata["manifest"])
        if metadata["checksum"] != checksum(manifest, layout, payload):
            raise ValueError("checkpoint checksum mismatch")
        tensors = None
        if with_state:
            from safetensors.torch import load
            tensors = load(raw)
        return manifest, tensors
    except (OSError, ValueError, KeyError, TypeError, AttributeError, RuntimeError, RecursionError) as exc:
        raise InvalidCheckpoint("The saved training checkpoint failed its integrity check.") from exc


def save(path, manifest, model, optimizer):
    import torch
    from safetensors.torch import save as serialize
    tensors = {"cpu_rng": torch.get_rng_state()}
    for name, parameter in model.named_parameters():
        if parameter.requires_grad:
            tensors["adapter/" + name] = parameter.detach()
            for key in ("step", "exp_avg", "exp_avg_sq"):
                tensors[key + "/" + name] = optimizer.state[parameter][key]

    layout, payload = split(serialize(tensors))
    layout.pop("__metadata__", None)
    layout["__metadata__"] = {"manifest": encoded(manifest).decode(),
                              "checksum": checksum(manifest, layout, payload)}
    header = encoded(layout)
    header += b" " * (-len(header) % 8)
    if len(header) > MAX_HEADER or 8 + len(header) + len(payload) > MAX_BYTES:
        raise InvalidCheckpoint("The training checkpoint exceeds the local size limit.")

    # The worker lock serializes every writer. A kill during writing leaves the
    # previous checkpoint intact and at most one bounded, disposable staging file.
    temp = path.parent / ".pending.safetensors"
    temp.unlink(missing_ok=True)
    try:
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(struct.pack("<Q", len(header)))
            f.write(header)
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
        fsync_dir(path.parent)
    finally:
        temp.unlink(missing_ok=True)


def restore(tensors, model, optimizer, step):
    import torch
    try:
        rng = tensors.pop("cpu_rng")
        if rng.dtype != torch.uint8 or rng.shape != torch.get_rng_state().shape:
            raise ValueError("invalid CPU RNG")
        with torch.no_grad():
            for name, parameter in model.named_parameters():
                if not parameter.requires_grad:
                    continue
                restored = {}
                for key in ("adapter", "exp_avg", "exp_avg_sq", "step"):
                    value = tensors.pop(key + "/" + name)
                    if key == "step":
                        if value.ndim != 0 or value.dtype != torch.float32 or value.item() != step:
                            raise ValueError("invalid AdamW step")
                    elif (value.shape != parameter.shape or value.dtype != parameter.dtype
                            or not torch.isfinite(value).all()):
                        raise ValueError("invalid adapter or AdamW moment")
                    if key == "adapter":
                        parameter.copy_(value)
                    else:
                        restored[key] = value
                if (restored["exp_avg_sq"] < 0).any():
                    raise ValueError("invalid second moment")
                optimizer.state[parameter] = restored
        if tensors:
            raise ValueError("unexpected training tensors")
        torch.set_rng_state(rng)
    except (KeyError, ValueError, TypeError, RuntimeError) as exc:
        raise InvalidCheckpoint("The saved optimizer or adapter state is incompatible.") from exc


def remove(path):
    if path.exists():
        path.unlink()
        fsync_dir(path.parent)
