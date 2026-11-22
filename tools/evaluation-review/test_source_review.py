import hashlib
import json
import unittest

from source_review import ROOT, review


class ReviewedSourceTests(unittest.TestCase):
    def setUp(self):
        self.original = json.loads((ROOT / "ios/PocketAILab/SourceAnswerExample.json").read_text())
        draft = {key: self.original[key] for key in ("registerRevision", "model", "modelSHA256", "requestID", "question")}
        draft.update(origin="imported", excerpt=self.original["answer"], passage=self.original["retrieved"][0].copy())
        self.record = {"draft": draft, "corrections": [{"date": "2026-11-22T00:00:00Z", "excerpt": "00:00 UTC"}]}

    def package(self):
        payload = json.dumps(self.record, separators=(",", ":"))
        digest = hashlib.sha256(payload.encode()).hexdigest()
        return json.dumps({"format": "pocket-ai-lab.source-review.v1", "payloadJSON": payload, "sha256": digest}), digest

    def test_reconciles_original_correction_and_citation(self):
        result = review(*self.package(), json.dumps(self.original))
        self.assertEqual((result["original"], result["current"], result["source"]),
                         (self.original["answer"], "00:00 UTC", "CF-QUOTA"))
        self.assertTrue(result["originalFileMatched"])
        self.assertFalse(result["hardwareVerified"])

    def test_rejects_mismatched_external_digest(self):
        data, _ = self.package()
        with self.assertRaises(ValueError):
            review(data, "0" * 64)

    def test_rejects_altered_passage_and_unsupported_correction(self):
        self.record["corrections"][0]["excerpt"] = "noon"
        with self.assertRaises(ValueError):
            review(*self.package())
        self.record["corrections"].clear()
        self.record["draft"]["passage"]["url"] += "#other"
        with self.assertRaises(ValueError):
            review(*self.package())

    def test_rejects_changed_server_output_and_identity(self):
        for key in ("rawOutput", "requestID"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                review(*self.package(), json.dumps({**self.original, key: "replaced"}))

    def test_rejects_consecutive_identical_edits(self):
        self.record["corrections"] *= 2
        with self.assertRaises(ValueError):
            review(*self.package())


if __name__ == "__main__":
    unittest.main()
