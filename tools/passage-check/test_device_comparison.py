import hashlib
import json
import unittest
from uuid import NAMESPACE_URL, uuid5

from device_comparison import PASSAGE_SUITE, compare_device


def digest(value):
    return hashlib.sha256(value).hexdigest()


class DeviceComparisonTests(unittest.TestCase):
    def setUp(self):
        self.suite = json.loads(PASSAGE_SUITE.read_bytes())
        self.model = "f" * 64
        self.attempts, self.server_rows = [], []
        for case in self.suite["cases"]:
            self.attempts.append(dict(suiteID=self.suite["suiteID"], suiteVersion=self.suite["version"],
                caseID=case["id"], prompt=case["prompt"], output=case["expected"], status="completed",
                maxTokens=self.suite["maxTokens"], scoringRule="exactMatch", modelArtifactSHA256=self.model,
                providerKind="llamaCppBackend", nativeExecutionObserved=True, runtimeSessionID="synthetic-session",
                requestID="native-" + case["id"]))
            self.server_rows.append(dict(caseID=case["id"], promptSHA256=digest(case["prompt"].encode()),
                output=case["expected"], finishReason="stop", requestID="server-" + case["id"]))
        self.server = dict(suiteID=self.suite["suiteID"], suiteVersion=self.suite["version"],
            suiteSHA256=digest(PASSAGE_SUITE.read_bytes()), modelSHA256=self.model, cases=self.server_rows)

    def inputs(self):
        files, hashes = [], {}
        previous = "GENESIS"
        for sequence, attempt in enumerate(self.attempts, 1):
            key = attempt["caseID"]
            event = str(uuid5(NAMESPACE_URL, "urn:pocket:test:" + key))
            payload = json.dumps(dict(kind="attempt", attempt=attempt))
            h = digest(f"{sequence}\n{event}\n{previous}\n{payload}".encode())
            files.append(json.dumps(dict(format="pocket-ai-lab.evaluation-attempt.v1", sequence=sequence,
                eventID=event, previousHash=previous, payloadJSON=payload, eventHash=h)).encode())
            hashes[key], previous = h, h
        raw = json.dumps(self.server).encode()
        return files, hashes, raw, digest(raw)

    def test_compares_each_raw_reply_without_claiming_device_identity(self):
        self.attempts[0]["nativeExecutionObserved"] = False
        self.attempts[1]["output"] = "wrong"
        self.server_rows[2]["finishReason"] = "length"
        files, hashes, raw, h = self.inputs()
        result = compare_device(files[::-1], hashes, raw, h)
        self.assertEqual((result["nativePassed"], result["serverPassed"], result["total"]), (4, 5, 6))
        self.assertFalse(result["hardwareVerified"])

    def test_mixed_models_and_sessions_are_rejected(self):
        for field in ("modelArtifactSHA256", "runtimeSessionID"):
            with self.subTest(field=field):
                original = self.attempts[0][field]
                self.attempts[0][field] = "b" * 64
                with self.assertRaises(ValueError):
                    compare_device(*self.inputs())
                self.attempts[0][field] = original

    def test_rejects_incomplete_duplicate_or_mismatched_records(self):
        files, hashes, raw, h = self.inputs()
        with self.assertRaises(ValueError):
            compare_device(files[1:], hashes, raw, h)
        with self.assertRaises(ValueError):
            compare_device([files[1], *files[1:]], hashes, raw, h)
        with self.assertRaises(ValueError):
            compare_device(files, hashes, raw, "0" * 64)
        hashes[self.attempts[1]["caseID"]] = "0" * 64
        with self.assertRaises(ValueError):
            compare_device(files, hashes, raw, h)

    def test_rejects_unrelated_server_prompts_and_duplicate_jobs(self):
        self.server_rows[0]["promptSHA256"] = "0" * 64
        with self.assertRaises(ValueError):
            compare_device(*self.inputs())
        self.server_rows[0]["requestID"] = self.server_rows[1]["requestID"]
        with self.assertRaises(ValueError):
            compare_device(*self.inputs())
