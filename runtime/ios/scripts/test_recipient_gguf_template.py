"""Bounded synthetic fixtures; no model download, tokenizer, or inference."""

import base64
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

import recipient_gguf_template as probe


def string(raw):
    raw = raw.encode("utf-8") if isinstance(raw, str) else raw
    return struct.pack("<Q", len(raw)) + raw


def field(key, kind, encoded):
    return string(key) + struct.pack("<I", kind) + encoded


def scalar(key, kind, value):
    return field(key, kind, struct.pack("<" + probe.SCALARS[kind], value))


def text_field(key, raw):
    return field(key, probe.STRING, string(raw))


def array_field(key, element_kind, elements):
    values = b"".join(string(x) if element_kind == probe.STRING else
                      struct.pack("<" + probe.SCALARS[element_kind], x) for x in elements)
    return field(key, probe.ARRAY, struct.pack("<IQ", element_kind, len(elements)) + values)


def gguf(fields, tail=b"", tensors=0, version=3):
    return b"GGUF" + struct.pack("<IQQ", version, tensors, len(fields)) + b"".join(fields) + tail


class RecipientGGUFTemplateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.model = self.root / "model.gguf"
        self.pin = self.root / "pin.json"
        self.output = self.root / "report.json"

    def write_fixture(self, payload):
        self.model.write_bytes(payload)
        self.pin.write_text(json.dumps({"bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}))

    def inspect(self, payload):
        self.write_fixture(payload)
        return probe.inspect_model(self.model, self.pin)

    def rejected(self, payload, message):
        self.write_fixture(payload)
        with self.assertRaisesRegex(probe.InspectionError, message):
            probe.inspect_model(self.model, self.pin)

    def minimal(self, template="{{ messages }}"):
        return gguf([text_field(probe.TEMPLATE_KEY, template)])

    def cli(self, output=None):
        with redirect_stderr(io.StringIO()), redirect_stdout(io.StringIO()):
            return probe.main(["--model", str(self.model), "--pin", str(self.pin),
                               "--output", str(output or self.output)])

    def test_exact_template_bytes_and_explicit_flags_are_preserved(self):
        raw = "\r\n{{ raise_exception('do not execute') }} e\u0301 \u00e9\t\x00\U0001f642\n".encode("utf-8")
        fields = [text_field(probe.TEMPLATE_KEY, raw),
                  text_field("tokenizer.ggml.model", "gpt2"),
                  text_field("tokenizer.ggml.pre", "smollm"),
                  scalar("tokenizer.ggml.add_bos_token", probe.BOOL, 0),
                  scalar("tokenizer.ggml.add_eos_token", probe.BOOL, 1),
                  scalar("tokenizer.ggml.add_space_prefix", probe.BOOL, 1),
                  scalar("tokenizer.ggml.remove_extra_whitespaces", probe.BOOL, 0),
                  scalar("tokenizer.ggml.clean_spaces", probe.BOOL, 0)]
        report = self.inspect(gguf(fields))
        item = report["chatTemplate"]
        self.assertEqual(item["text"].encode("utf-8"), raw)
        self.assertEqual(base64.b64decode(item["utf8Base64"]), raw)
        self.assertEqual(item["utf8ByteLength"], len(raw))
        self.assertEqual(item["sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(report["tokenizerMetadata"], {"tokenizer.ggml.model": "gpt2",
                         "tokenizer.ggml.pre": "smollm", "tokenizer.ggml.add_bos_token": False,
                         "tokenizer.ggml.add_eos_token": True, "tokenizer.ggml.add_space_prefix": True,
                         "tokenizer.ggml.remove_extra_whitespaces": False, "tokenizer.ggml.clean_spaces": False})
        self.assertEqual(report["missingTokenizerMetadataKeys"], [])
        self.assertFalse(report["evidenceBoundary"]["templateRendered"])

    def test_literal_wire_fixture_is_independent_of_parser_type_constants(self):
        # Pinned gguf.h: STRING=8, ARRAY=9, UINT32=4, BOOL=7. This fixture uses
        # literal wire bytes and no fixture builder or probe enum/width lookup.
        payload = (
            b"GGUF\x03\x00\x00\x00"  # little-endian version 3
            b"\x00\x00\x00\x00\x00\x00\x00\x00"  # no tensors
            b"\x04\x00\x00\x00\x00\x00\x00\x00"  # four metadata keys
            b"\x17\x00\x00\x00\x00\x00\x00\x00tokenizer.chat_template"
            b"\x08\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00x"
            b"\x15\x00\x00\x00\x00\x00\x00\x00tokenizer.ggml.tokens"
            b"\x09\x00\x00\x00\x08\x00\x00\x00\x02\x00\x00\x00\x00\x00\x00\x00"
            b"\x03\x00\x00\x00\x00\x00\x00\x00<s>"
            b"\x04\x00\x00\x00\x00\x00\x00\x00</s>"
            b"\x1b\x00\x00\x00\x00\x00\x00\x00tokenizer.ggml.eos_token_id"
            b"\x04\x00\x00\x00\x01\x00\x00\x00"
            b"\x1c\x00\x00\x00\x00\x00\x00\x00tokenizer.ggml.add_bos_token"
            b"\x07\x00\x00\x00\x00"
        )
        report = self.inspect(payload)
        self.assertEqual(report["chatTemplate"]["text"], "x")
        self.assertEqual(report["gguf"]["metadataKeyCount"], 4)
        self.assertFalse(report["tokenizerMetadata"]["tokenizer.ggml.add_bos_token"])
        self.assertEqual(report["specialTokens"]["tokenizer.ggml.eos_token_id"]["id"], 1)
        self.assertEqual(report["specialTokens"]["tokenizer.ggml.eos_token_id"]["tokenString"]["text"], "</s>")

    def test_missing_flags_and_vocabulary_stay_unknown(self):
        report = self.inspect(gguf([text_field(probe.TEMPLATE_KEY, "x"),
                                   scalar("tokenizer.ggml.bos_token_id", probe.UINT32, 7)]))
        self.assertEqual(report["tokenizerMetadata"], {})
        self.assertEqual(report["missingTokenizerMetadataKeys"], sorted(probe.TOKENIZER_TYPES))
        self.assertEqual(report["vocabulary"], {"present": False})
        self.assertEqual(report["specialTokens"]["tokenizer.ggml.bos_token_id"],
                         {"id": 7, "ggufType": "UINT32", "tokenStringStatus": "unknown-vocabulary-absent"})

    def test_token_strings_resolve_when_ids_follow_or_precede_vocabulary(self):
        vocabulary = array_field(probe.TOKENS_KEY, probe.STRING, ["<bos>", "e\u0301", "<eos>\r\n"])
        ids = [scalar("tokenizer.ggml.bos_token_id", probe.UINT32, 0),
               scalar("tokenizer.ggml.eos_token_id", probe.UINT32, 2),
               scalar("tokenizer.ggml.padding_token_id", probe.UINT32, 2)]
        for fields in [ids + [vocabulary], [vocabulary] + ids]:
            with self.subTest(vocabulary_first=fields[0] == vocabulary):
                report = self.inspect(gguf([text_field(probe.TEMPLATE_KEY, "x")] + fields))
                self.assertEqual(report["vocabulary"], {"present": True, "count": 3})
                eos = report["specialTokens"]["tokenizer.ggml.eos_token_id"]["tokenString"]
                self.assertEqual(eos["text"], "<eos>\r\n")
                self.assertEqual(eos["sha256"], hashlib.sha256(b"<eos>\r\n").hexdigest())
                self.assertEqual(report["specialTokens"]["tokenizer.ggml.padding_token_id"]["tokenString"], eos)

    def test_pin_hash_covers_tail_outside_metadata(self):
        self.write_fixture(self.minimal() + b"opaque tensor bytes")
        data = self.model.read_bytes()
        self.model.write_bytes(data[:-1] + bytes([data[-1] ^ 1]))
        with self.assertRaisesRegex(probe.InspectionError, "SHA-256"):
            probe.inspect_model(self.model, self.pin)

    def test_pin_size_mismatch_and_invalid_pin_fields_fail_before_parsing(self):
        valid = self.minimal()
        for changes, error in [({"bytes": len(valid) + 1}, "exact pinned size"),
                               ({"bytes": True}, "Pin bytes"),
                               ({"bytes": probe.MAX_MODEL_BYTES + 1}, "Pin bytes"),
                               ({"sha256": "A" * 64}, "lowercase hex")]:
            with self.subTest(changes=changes):
                self.write_fixture(valid)
                pin = json.loads(self.pin.read_text()); pin.update(changes)
                self.pin.write_text(json.dumps(pin))
                with self.assertRaisesRegex(probe.InspectionError, error):
                    probe.inspect_model(self.model, self.pin)

    def test_duplicate_or_oversized_pin_json_is_rejected(self):
        self.write_fixture(self.minimal())
        for raw, message in [(b'{"bytes":24,"bytes":24}', "duplicate"),
                             (b" " * (probe.MAX_PIN_BYTES + 1), "byte limit"),
                             (b'{"bytes":NaN}', "non-finite"),
                             (b"[" * 2000 + b"]" * 2000, "JSON")]:
            with self.subTest(message=message):
                self.pin.write_bytes(raw)
                with self.assertRaisesRegex(probe.InspectionError, message):
                    probe.inspect_model(self.model, self.pin)

    def test_missing_empty_or_alternate_template_is_not_success(self):
        for fields in [[], [text_field(probe.TEMPLATE_KEY, "")],
                       [text_field("tokenizer.chat_template.default", "x")]]:
            with self.subTest(fields=fields):
                self.rejected(gguf(fields), "nonempty STRING tokenizer.chat_template")

    def test_known_metadata_types_are_strict(self):
        invalid = [array_field(probe.TEMPLATE_KEY, probe.STRING, ["x"]),
                   scalar("tokenizer.ggml.model", probe.UINT32, 0),
                   scalar("tokenizer.ggml.pre", probe.UINT32, 0),
                   scalar("tokenizer.ggml.add_bos_token", probe.UINT8, 1),
                   scalar("tokenizer.ggml.add_eos_token", probe.INT32, 0),
                   scalar("tokenizer.ggml.add_space_prefix", probe.UINT8, 1),
                   scalar("tokenizer.ggml.remove_extra_whitespaces", probe.UINT8, 0),
                   scalar("tokenizer.ggml.clean_spaces", probe.INT32, 0),
                   scalar("tokenizer.ggml.bos_token_id", probe.INT32, 0),
                   text_field(probe.TOKENS_KEY, "not an array")]
        for item in invalid:
            with self.subTest(item=item):
                self.rejected(gguf(([text_field(probe.TEMPLATE_KEY, "x")] if item != invalid[0] else []) + [item]), "wrong GGUF type")
        self.rejected(gguf([text_field(probe.TEMPLATE_KEY, "x"), array_field(probe.TOKENS_KEY, probe.UINT32, [1])]), "array of strings")

    def test_boolean_bytes_and_nonfinite_numbers_are_rejected(self):
        for item in [scalar("tokenizer.ggml.add_bos_token", probe.BOOL, 2),
                     array_field("other.bool", probe.BOOL, [0, 2]),
                     scalar("other.float", probe.FLOAT32, float("inf")),
                     array_field("other.floats", probe.FLOAT64, [float("nan")])]:
            with self.subTest(item=item):
                self.rejected(gguf([text_field(probe.TEMPLATE_KEY, "x"), item]), "Boolean|Non-finite")

    def test_every_truncated_metadata_prefix_fails_with_a_matching_fixture_pin(self):
        payload = gguf([text_field(probe.TEMPLATE_KEY, "{{ messages }}"),
                        array_field(probe.TOKENS_KEY, probe.STRING, ["<bos>", "<eos>"]),
                        scalar("tokenizer.ggml.eos_token_id", probe.UINT32, 1)])
        for end in range(probe.HEADER_BYTES, len(payload)):
            with self.subTest(length=end):
                self.rejected(payload[:end], "Truncated|string array")

    def test_invalid_magic_versions_and_header_counts_fail_closed(self):
        payload = self.minimal()
        self.rejected(b"NOPE" + payload[4:], "magic")
        for version in [1, 4, 0x03000000]:
            with self.subTest(version=version):
                self.rejected(gguf([text_field(probe.TEMPLATE_KEY, "x")], version=version), "little-endian")
        for counts in [(probe.MAX_TENSORS + 1, 0), (0, probe.MAX_METADATA_KEYS + 1), ((1 << 64) - 1, 1)]:
            self.rejected(b"GGUF" + struct.pack("<IQQ", 3, *counts), "header count")
        self.rejected(gguf([text_field(probe.TEMPLATE_KEY, "x")], tensors=1), "tensor directory")

    def test_versions_2_and_3_accept_flat_unselected_values(self):
        extra = [array_field("other.names", probe.STRING, ["", "\u00e9"])]
        for kind in probe.SCALARS:
            value = 1.25 if kind in (probe.FLOAT32, probe.FLOAT64) else 1
            extra.extend([scalar(f"other.scalar{kind}", kind, value),
                          array_field(f"other.array{kind}", kind, [value])])
        for version in [2, 3]:
            report = self.inspect(gguf(extra + [text_field(probe.TEMPLATE_KEY, "x")], version=version))
            self.assertEqual(report["gguf"]["version"], version)
            self.assertFalse(report["gguf"]["tensorDirectoryValidated"])

    def test_duplicate_empty_nul_and_invalid_utf8_keys_are_rejected(self):
        template = text_field(probe.TEMPLATE_KEY, "x")
        for key, error in [(b"", "nonempty"), (b"bad\x00key", "NUL"), (b"\xff", "UTF-8")]:
            self.rejected(gguf([template, field(key, probe.STRING, string("x"))]), error)
        self.rejected(gguf([template, template]), "Duplicate")
        self.rejected(gguf([text_field(probe.TEMPLATE_KEY, b"\xff")]), "UTF-8")

    def test_declared_string_array_and_metadata_limits_precede_allocation(self):
        template = text_field(probe.TEMPLATE_KEY, "x")
        self.rejected(gguf([field(probe.TEMPLATE_KEY, probe.STRING, struct.pack("<Q", probe.MAX_STRING_BYTES + 1))]), "string exceeds")
        self.rejected(gguf([struct.pack("<Q", probe.MAX_KEY_BYTES + 1)]), "string exceeds")
        bad_array = field("other", probe.ARRAY, struct.pack("<IQ", probe.UINT8, probe.MAX_ARRAY_ELEMENTS + 1))
        self.rejected(gguf([template, bad_array]), "element limit")
        self.write_fixture(self.minimal())
        with patch.object(probe, "MAX_METADATA_BYTES", probe.HEADER_BYTES + 4):
            with self.assertRaisesRegex(probe.InspectionError, "prefix budget"):
                probe.inspect_model(self.model, self.pin)

    def test_nested_and_unknown_types_are_rejected_even_for_empty_arrays(self):
        template = text_field(probe.TEMPLATE_KEY, "x")
        for kind in [probe.ARRAY, 99]:
            self.rejected(gguf([template, field("other", probe.ARRAY, struct.pack("<IQ", kind, 0))]), "Nested|Unsupported")
        self.rejected(gguf([template, field("other", 99, b"")]), "Unsupported")

    def test_special_id_and_token_length_bounds_are_enforced(self):
        template = text_field(probe.TEMPLATE_KEY, "x")
        self.rejected(gguf([template, array_field(probe.TOKENS_KEY, probe.STRING, ["x"]),
                            scalar("tokenizer.ggml.eos_token_id", probe.UINT32, 1)]), "outside")
        self.rejected(gguf([template, array_field(probe.TOKENS_KEY, probe.STRING, ["x" * (probe.MAX_TOKEN_BYTES + 1)])]), "string exceeds")
        ids = [scalar(f"tokenizer.ggml.test{i}_token_id", probe.UINT32, i) for i in range(probe.MAX_SPECIAL_TOKENS + 1)]
        self.rejected(gguf([template] + ids), "Too many")

    def test_cli_writes_json_only_after_successful_validation(self):
        self.write_fixture(self.minimal())
        self.assertEqual(self.cli(), 0)
        report = json.loads(self.output.read_text())
        self.assertEqual(report["verifiedModel"]["sha256"], hashlib.sha256(self.model.read_bytes()).hexdigest())
        old = self.output.read_bytes()
        self.model.write_bytes(b"bad")
        self.assertEqual(self.cli(), 2)
        self.assertEqual(self.output.read_bytes(), old)
        self.assertEqual(list(self.root.glob(".recipient-template-*.tmp")), [])

    def test_cli_output_must_not_overwrite_model_or_pin_including_aliases(self):
        self.write_fixture(self.minimal())
        original_model, original_pin = self.model.read_bytes(), self.pin.read_bytes()
        for target in [self.model, self.pin]:
            self.assertEqual(self.cli(target), 2)
        for target, name in [(self.model, "model-alias"), (self.pin, "pin-alias")]:
            alias = self.root / name
            alias.hardlink_to(target)
            self.assertEqual(self.cli(alias), 2)
        symlink = self.root / "model-symlink"
        symlink.symlink_to(self.model)
        self.assertEqual(self.cli(symlink), 2)
        self.assertEqual(self.model.read_bytes(), original_model)
        self.assertEqual(self.pin.read_bytes(), original_pin)

    def test_atomic_publication_failure_preserves_existing_output_and_removes_temporary(self):
        self.write_fixture(self.minimal())
        self.output.write_bytes(b"previous output")
        with patch.object(probe.os, "replace", side_effect=OSError("simulated replace failure")):
            self.assertEqual(self.cli(), 2)
        self.assertEqual(self.output.read_bytes(), b"previous output")
        self.assertEqual(list(self.root.glob(".recipient-template-*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
