import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def rows(name):
    return [json.loads(line) for line in (ROOT / "data" / name).read_text(encoding="utf-8").splitlines() if line.strip()]


class SplitTests(unittest.TestCase):
    def test_held_out_prompts_are_absent_from_training(self):
        train = {row["prompt"] for row in rows("train.jsonl")}
        held = rows("heldout.jsonl")
        self.assertGreaterEqual(len(held), 1)
        for row in held:
            self.assertNotIn(row["prompt"], train)
            self.assertTrue(row["synthetic"])
            self.assertEqual(row["split"], "heldout")

    def test_training_rows_are_labeled_synthetic(self):
        train = rows("train.jsonl")
        self.assertGreaterEqual(len(train), 6)
        self.assertTrue(all(row["synthetic"] is True and row["split"] == "train" for row in train))


if __name__ == "__main__":
    unittest.main()
