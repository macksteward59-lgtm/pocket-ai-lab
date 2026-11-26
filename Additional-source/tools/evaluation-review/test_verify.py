import hashlib
import json
import unittest

from verify import verify


class ReviewTests(unittest.TestCase):
    def setUp(self):
        payload = '{"attempt":{"output":"café/茶","startedAt":1.25},"kind":"attempt"}'
        identity = "b0e7e2ea-b562-4e97-8e54-ec95f8a82424"
        self.digest = hashlib.sha256(f"1\n{identity}\nGENESIS\n{payload}".encode()).hexdigest()
        self.record = {"format": "pocket-ai-lab.evaluation-attempt.v1", "sequence": 1,
                       "eventID": identity, "previousHash": "GENESIS", "eventHash": self.digest,
                       "payloadJSON": payload}

    def check(self, record, expected=None):
        return verify(json.dumps(record).encode(), self.digest if expected is None else expected)

    def test_checks_original_bytes(self):
        self.assertEqual(self.check(self.record)["matchedEventSHA256"], self.digest)
        changed = dict(self.record, payloadJSON=self.record["payloadJSON"].replace("/", "\\/"))
        with self.assertRaises(ValueError):
            self.check(changed)

    def test_separate_hash_is_required(self):
        with self.assertRaises(ValueError):
            self.check(self.record, "0" * 64)

    def test_tampered_event_and_broken_headers(self):
        for field, value in [("eventHash", "0" * 64), ("sequence", True), ("sequence", 2),
                             ("previousHash", "bad"), ("eventID", "bad"), ("format", "new")]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.check(dict(self.record, **{field: value}))

    def test_duplicate_json_keys_are_rejected(self):
        duplicated = json.dumps(self.record).replace('"sequence": 1', '"sequence": 2, "sequence": 1')
        with self.assertRaises(ValueError):
            verify(duplicated.encode(), self.digest)


if __name__ == "__main__":
    unittest.main()
