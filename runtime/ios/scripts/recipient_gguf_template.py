#!/usr/bin/env python3
"""Inspect a pinned GGUF's declared recipient template without running it.

Format references, at this repository's exact llama.cpp pin:
https://github.com/ggml-org/llama.cpp/blob/5f490d7bfe78844e6390c869454c149fd7e003a8/ggml/include/gguf.h
https://github.com/ggml-org/llama.cpp/blob/5f490d7bfe78844e6390c869454c149fd7e003a8/gguf-py/gguf/gguf_reader.py
https://github.com/ggml-org/llama.cpp/blob/5f490d7bfe78844e6390c869454c149fd7e003a8/gguf-py/gguf/gguf_writer.py

This deliberately restricted reader supports little-endian GGUF versions 2/3
and their flat metadata types. It does not validate tensor directories or parse
tensor payloads. The full file is streamed through the required pin digest; only
a bounded prefix from that same stream is retained and parsed after verification.
No model, tokenizer, Jinja template, or network operation is executed.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import struct
import sys
import tempfile
from typing import BinaryIO


HEADER_BYTES = 24
MAX_METADATA_BYTES = 16 * 1024 * 1024  # Includes the header and all KV bytes.
MAX_PIN_BYTES = 64 * 1024
MAX_MODEL_BYTES = 16 * 1024 * 1024 * 1024
HASH_CHUNK_BYTES = 1024 * 1024
MAX_METADATA_KEYS = 4096
MAX_TENSORS = 1_000_000
MAX_KEY_BYTES = 512
MAX_STRING_BYTES = 1024 * 1024
MAX_TOKEN_BYTES = 16 * 1024
MAX_ARRAY_ELEMENTS = 1_000_000
MAX_SPECIAL_TOKENS = 64

# The integer values and scalar widths are the pinned gguf_type wire enum.
UINT8, INT8, UINT16, INT16, UINT32, INT32, FLOAT32 = range(7)
BOOL, STRING, ARRAY, UINT64, INT64, FLOAT64 = range(7, 13)
SCALARS = {
    UINT8: "B", INT8: "b", UINT16: "H", INT16: "h", UINT32: "I",
    INT32: "i", FLOAT32: "f", BOOL: "B", UINT64: "Q", INT64: "q", FLOAT64: "d",
}
TEMPLATE_KEY = "tokenizer.chat_template"
TOKENS_KEY = "tokenizer.ggml.tokens"
TOKENIZER_TYPES = {
    "tokenizer.ggml.model": STRING,
    "tokenizer.ggml.pre": STRING,
    "tokenizer.ggml.add_bos_token": BOOL,
    "tokenizer.ggml.add_eos_token": BOOL,
    "tokenizer.ggml.add_space_prefix": BOOL,
    "tokenizer.ggml.remove_extra_whitespaces": BOOL,
    "tokenizer.ggml.clean_spaces": BOOL,
}
SPECIAL_ID_KEY = re.compile(r"tokenizer\.ggml\.[A-Za-z0-9_]+_token_id\Z")


class InspectionError(ValueError):
    """The pinned artifact or this reader's supported metadata contract failed."""


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise InspectionError("Pin JSON contains a duplicate key.")
        result[key] = value
    return result


def _reject_json_constant(value: str) -> None:
    raise InspectionError("Pin JSON contains a non-finite number.")


def _load_pin(path: Path) -> dict[str, object]:
    with path.open("rb") as source:
        raw = source.read(MAX_PIN_BYTES + 1)
    if len(raw) > MAX_PIN_BYTES:
        raise InspectionError("Pin JSON exceeds its byte limit.")
    try:
        pin = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object,
                         parse_constant=_reject_json_constant)
    except InspectionError:
        raise
    except (UnicodeDecodeError, ValueError, RecursionError) as error:
        raise InspectionError("Pin is not valid UTF-8 JSON.") from error
    if not isinstance(pin, dict):
        raise InspectionError("Pin must be a JSON object.")
    size, digest = pin.get("bytes"), pin.get("sha256")
    if type(size) is not int or not HEADER_BYTES <= size <= MAX_MODEL_BYTES:
        raise InspectionError("Pin bytes must be an integer within the model size bounds.")
    if not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
        raise InspectionError("Pin SHA-256 must contain exactly 64 lowercase hex digits.")
    return pin


def _verified_prefix(source: BinaryIO, expected_size: int, expected_digest: str) -> bytes:
    info = os.fstat(source.fileno())
    if not stat.S_ISREG(info.st_mode) or info.st_size != expected_size:
        raise InspectionError("Model must be a regular file with the exact pinned size.")
    digest = hashlib.sha256()
    prefix = bytearray()
    observed = 0
    # One extra byte detects growth without reading an unbounded changing file.
    while observed <= expected_size:
        chunk = source.read(min(HASH_CHUNK_BYTES, expected_size + 1 - observed))
        if not chunk:
            break
        digest.update(chunk)
        observed += len(chunk)
        if len(prefix) < MAX_METADATA_BYTES:
            prefix.extend(chunk[:MAX_METADATA_BYTES - len(prefix)])
    if observed != expected_size:
        raise InspectionError("Model size changed or differs from the pin during hashing.")
    if digest.hexdigest() != expected_digest:
        raise InspectionError("Model SHA-256 does not match the pin.")
    return bytes(prefix)


class _Reader:
    def __init__(self, prefix: bytes, file_size: int, offset: int = 0):
        self.data = memoryview(prefix)
        self.file_size = file_size
        self.offset = offset

    def take(self, count: int) -> memoryview:
        end = self.offset + count
        if count < 0 or end > self.file_size:
            raise InspectionError("Truncated GGUF header or metadata.")
        if end > MAX_METADATA_BYTES or end > len(self.data):
            raise InspectionError("GGUF metadata exceeds the bounded prefix budget.")
        result = self.data[self.offset:end]
        self.offset = end
        return result

    def number(self, code: str) -> int | float:
        return struct.unpack("<" + code, self.take(struct.calcsize("<" + code)))[0]

    def string(self, limit: int = MAX_STRING_BYTES) -> bytes:
        count = self.number("Q")
        if count > limit:
            raise InspectionError("GGUF string exceeds its byte limit.")
        raw = bytes(self.take(count))
        try:
            raw.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise InspectionError("GGUF metadata string is not valid UTF-8.") from error
        return raw

    def scalar(self, kind: int) -> int | float | bool:
        value = self.number(SCALARS[kind])
        if kind == BOOL:
            if value not in (0, 1):
                raise InspectionError("GGUF Boolean must be encoded as zero or one.")
            return bool(value)
        if kind in (FLOAT32, FLOAT64) and not math.isfinite(value):
            raise InspectionError("Non-finite GGUF metadata numbers are unsupported.")
        return value

    def value(self, kind: int, vocabulary: bool = False) -> object:
        if kind == STRING:
            return self.string()
        if kind in SCALARS:
            return self.scalar(kind)
        if kind != ARRAY:
            raise InspectionError("Unsupported GGUF metadata value type.")
        element_kind = self.number("I")
        count = self.number("Q")
        if count > MAX_ARRAY_ELEMENTS:
            raise InspectionError("GGUF array exceeds its element limit.")
        if element_kind == ARRAY:
            raise InspectionError("Nested GGUF arrays are unsupported.")
        if element_kind not in SCALARS and element_kind != STRING:
            raise InspectionError("Unsupported GGUF array element type.")
        if vocabulary and element_kind != STRING:
            raise InspectionError("Tokenizer tokens must be an array of strings.")
        start = self.offset
        if element_kind == STRING:
            # Even empty strings need a uint64 length; reject impossible counts first.
            minimum = count * 8
            if minimum > self.file_size - self.offset:
                raise InspectionError("Truncated GGUF string array.")
            if minimum > min(len(self.data), MAX_METADATA_BYTES) - self.offset:
                raise InspectionError("GGUF string array exceeds the metadata budget.")
            for _ in range(count):
                self.string(MAX_TOKEN_BYTES if vocabulary else MAX_STRING_BYTES)
        else:
            block = self.take(count * struct.calcsize("<" + SCALARS[element_kind]))
            if element_kind == BOOL and any(value not in (0, 1) for value in block):
                raise InspectionError("GGUF Boolean array contains a non-Boolean byte.")
            if element_kind in (FLOAT32, FLOAT64):
                if any(not math.isfinite(item[0]) for item in struct.iter_unpack("<" + SCALARS[element_kind], block)):
                    raise InspectionError("Non-finite GGUF array numbers are unsupported.")
        # Keep offsets only, never materialize the complete vocabulary or other arrays.
        return (start, count) if vocabulary else None


def _string_record(raw: bytes) -> dict[str, object]:
    return {"text": raw.decode("utf-8"), "utf8ByteLength": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest()}


def _inspect_metadata(prefix: bytes, file_size: int) -> dict[str, object]:
    reader = _Reader(prefix, file_size)
    if bytes(reader.take(4)) != b"GGUF":
        raise InspectionError("Invalid GGUF magic.")
    version = reader.number("I")
    if version not in (2, 3):
        raise InspectionError("Only little-endian GGUF versions 2 and 3 are supported.")
    tensor_count, key_count = reader.number("Q"), reader.number("Q")
    if tensor_count > MAX_TENSORS or key_count > MAX_METADATA_KEYS:
        raise InspectionError("GGUF header count exceeds the configured bound.")
    seen: set[bytes] = set()
    template: bytes | None = None
    tokenizer: dict[str, object] = {}
    token_ids: dict[str, int] = {}
    vocabulary: tuple[int, int] | None = None
    for _ in range(key_count):
        raw_key = reader.string(MAX_KEY_BYTES)
        if not raw_key or b"\x00" in raw_key:
            raise InspectionError("GGUF metadata keys must be nonempty without NUL bytes.")
        if raw_key in seen:
            raise InspectionError("Duplicate GGUF metadata key.")
        seen.add(raw_key)
        key = raw_key.decode("utf-8")
        kind = reader.number("I")
        expected_kind = STRING if key == TEMPLATE_KEY else TOKENIZER_TYPES.get(key)
        if key == TOKENS_KEY:
            expected_kind = ARRAY
        special = SPECIAL_ID_KEY.fullmatch(key) is not None
        if special:
            expected_kind = UINT32
        if expected_kind is not None and kind != expected_kind:
            raise InspectionError("Known tokenizer metadata has the wrong GGUF type.")
        value = reader.value(kind, vocabulary=key == TOKENS_KEY)
        if key == TEMPLATE_KEY:
            template = value
        elif key in TOKENIZER_TYPES:
            tokenizer[key] = value.decode("utf-8") if kind == STRING else value
        elif key == TOKENS_KEY:
            vocabulary = value
        elif special:
            if len(token_ids) >= MAX_SPECIAL_TOKENS:
                raise InspectionError("Too many special token ID declarations.")
            token_ids[key] = value
    if template is None or len(template) == 0:
        raise InspectionError("A nonempty STRING tokenizer.chat_template is required; no template is inferred.")
    metadata_end = reader.offset
    # This is only a conservative impossibility check, not tensor validation.
    if tensor_count * 24 > file_size - metadata_end:
        raise InspectionError("File cannot contain its declared tensor directory.")
    tokens: dict[int, bytes] = {}
    if vocabulary is not None:
        start, count = vocabulary
        wanted = set(token_ids.values())
        if any(token_id >= count for token_id in wanted):
            raise InspectionError("Special token ID is outside the declared vocabulary.")
        if wanted:
            token_reader = _Reader(prefix, file_size, start)
            for index in range(max(wanted) + 1):
                raw_token = token_reader.string(MAX_TOKEN_BYTES)
                if index in wanted:
                    tokens[index] = raw_token
    specials: dict[str, object] = {}
    for key, token_id in sorted(token_ids.items()):
        item: dict[str, object] = {"id": token_id, "ggufType": "UINT32"}
        if vocabulary is None:
            item["tokenStringStatus"] = "unknown-vocabulary-absent"
        else:
            item["tokenStringStatus"] = "present"
            item["tokenString"] = _string_record(tokens[token_id])
        specials[key] = item
    return {
        "gguf": {"version": version, "byteOrder": "little", "tensorCountDeclared": tensor_count,
                 "metadataKeyCount": key_count, "headerAndMetadataBytes": metadata_end,
                 "tensorDirectoryValidated": False, "tensorPayloadParsed": False},
        "chatTemplate": {"metadataKey": TEMPLATE_KEY, "present": True,
                         **_string_record(template), "utf8Base64": base64.b64encode(template).decode("ascii")},
        "tokenizerMetadata": tokenizer,
        "missingTokenizerMetadataKeys": sorted(set(TOKENIZER_TYPES) - set(tokenizer)),
        "vocabulary": {"present": vocabulary is not None, **({"count": vocabulary[1]} if vocabulary else {})},
        "specialTokens": specials,
    }


def inspect_model(model_path: Path, pin_path: Path) -> dict[str, object]:
    pin = _load_pin(pin_path)
    with model_path.open("rb") as source:
        prefix = _verified_prefix(source, pin["bytes"], pin["sha256"])
    result = _inspect_metadata(prefix, pin["bytes"])
    return {
        "schemaVersion": 1,
        "probe": "pinned-gguf-recipient-template-metadata",
        "verifiedModel": {"bytes": pin["bytes"], "sha256": pin["sha256"]},
        "limits": {"metadataPrefixBytes": MAX_METADATA_BYTES, "metadataKeys": MAX_METADATA_KEYS,
                   "tensorsDeclared": MAX_TENSORS, "keyBytes": MAX_KEY_BYTES,
                   "stringBytes": MAX_STRING_BYTES, "tokenBytes": MAX_TOKEN_BYTES,
                   "arrayElements": MAX_ARRAY_ELEMENTS, "specialTokenIDs": MAX_SPECIAL_TOKENS},
        "evidenceBoundary": {
            "templateRendered": False, "tokenizationExecuted": False, "inferenceExecuted": False,
            "runtimeDefaultFlagsInferred": False, "recipientQualityEstablished": False,
            "note": "Artifact declarations only. Missing flags remain unknown. No Jinja/template execution, model loading, runtime readiness, publisher authentication or authorization is established.",
        },
        **result,
    }


def _write_report(output: Path, report: dict[str, object], inputs: tuple[Path, ...]) -> None:
    for input_path in inputs:
        if output.resolve() == input_path.resolve() or (output.exists() and os.path.samefile(output, input_path)):
            raise InspectionError("Output must not overwrite the model or pin, including aliases.")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n",
                                         dir=output.parent, prefix=".recipient-template-", suffix=".tmp",
                                         delete=False) as destination:
            temporary = destination.name
            json.dump(report, destination, indent=2, sort_keys=True, ensure_ascii=True, allow_nan=False)
            destination.write("\n")
            destination.flush()
            os.fsync(destination.fileno())
        os.replace(temporary, output)
        temporary = None
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--pin", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        report = inspect_model(args.model, args.pin)
        _write_report(args.output, report, (args.model, args.pin))
    except (InspectionError, OSError) as error:
        print(f"Recipient template metadata probe failed: {error}", file=sys.stderr)
        return 2
    print("Pinned GGUF metadata inspected; no template rendering or inference was performed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
