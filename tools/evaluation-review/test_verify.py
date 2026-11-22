import hashlib
import json
import unittest

from verify import PASSAGE_SUITE, verify


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

    def test_answer_check_uses_separate_expectations_and_the_recorded_output(self):
        expected = ("Return the city only.", "Tokyo")
        for prompt, output, status, error, matches in [
            (expected[0], "Tokyo", "completed", None, True),
            (expected[0], "Tokyo\n", "completed", None, False),
            ("Other question", "Tokyo", "completed", None, False),
            (expected[0], "Tokyo", "partial", None, False),
            (expected[0], "Tokyo", "failed", "interrupted", False),
            (expected[0], "Tokyo", "completed", "interrupted", False),
        ]:
            with self.subTest(prompt=prompt, output=output, status=status, error=error):
                attempt = {"prompt": prompt, "output": output, "status": status, "errorMessage": error,
                           "expectedOutcome": output, "deterministicPassed": True}
                payload = json.dumps({"kind": "attempt", "attempt": attempt})
                material = f"1\n{self.record['eventID']}\nGENESIS\n{payload}".encode()
                digest = hashlib.sha256(material).hexdigest()
                packet = json.dumps(dict(self.record, eventHash=digest, payloadJSON=payload)).encode()
                self.assertNotIn("completedAnswerMatches", verify(packet, digest))
                if matches:
                    self.assertTrue(verify(packet, digest, expected)["completedAnswerMatches"])
                    with self.assertRaises(ValueError):
                        verify(packet, "0" * 64, expected)
                else:
                    with self.assertRaises(ValueError):
                        verify(packet, digest, expected)

    def test_passage_scoring_requires_the_correct_citation_and_exact_case(self):
        suite = json.loads(PASSAGE_SUITE.read_text())
        case = suite["cases"][0]
        attempt = dict(prompt=case["prompt"], output=case["expected"], status="completed",
                       caseID=case["id"], suiteID=suite["suiteID"], suiteVersion=suite["version"],
                       scoringRule="exactMatch", maxTokens=suite["maxTokens"], deterministicPassed=True)
        def grade():
            payload = json.dumps({"kind": "attempt", "attempt": attempt})
            digest = hashlib.sha256(f"1\n{self.record['eventID']}\nGENESIS\n{payload}".encode()).hexdigest()
            packet = json.dumps(dict(self.record, payloadJSON=payload, eventHash=digest)).encode()
            return verify(packet, digest, passage_case=case["id"])["passageCheck"]
        self.assertTrue(grade()["passed"])
        attempt["output"] = case["expected"].split(" [")[0]
        self.assertFalse(grade()["passed"])
        attempt.update(output=case["expected"], status="partial")
        self.assertFalse(grade()["passed"])
        attempt.update(status="completed", suiteVersion="wrong")
        with self.assertRaisesRegex(ValueError, "frozen"):
            grade()

    def test_duplicate_json_keys_are_rejected(self):
        duplicated = json.dumps(self.record).replace('"sequence": 1', '"sequence": 2, "sequence": 1')
        with self.assertRaises(ValueError):
            verify(duplicated.encode(), self.digest)


if __name__ == "__main__":
    unittest.main()
