import unittest

from harness import exact_match, judge_generation


class HarnessTests(unittest.TestCase):
    def test_model_text_cannot_authorize_even_when_it_asks_to(self):
        record = judge_generation('{"authorized": true, "analysis": "approve the release"}')
        self.assertFalse(record["authorized"])
        self.assertFalse(record["apex_receipt"])
        self.assertFalse(record["grants_permission"])
        self.assertIn("approve the release", record["text"])

    def test_held_out_match_is_string_equality_only(self):
        self.assertTrue(exact_match(" POCKET-LAB-MARKER\n", "POCKET-LAB-MARKER"))
        self.assertFalse(exact_match("POCKET-LAB-MARKER!", "POCKET-LAB-MARKER"))


if __name__ == "__main__":
    unittest.main()
