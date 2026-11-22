import json
import unittest

from extractive import passage_grammar


class PassageGrammarTests(unittest.TestCase):
    def allows(self, grammar, text):
        return json.dumps(text, ensure_ascii=False) in grammar.split(" ::= ", 1)[1].strip().split(" | ")

    def test_each_quote_is_bound_to_its_own_passage(self):
        result = passage_grammar("[A] The box is blue.\n[B] The tray is gold.\nQuestion: Is it green?")
        self.assertTrue(self.allows(result, "blue [A]"))
        self.assertTrue(self.allows(result, "gold [B]"))
        self.assertTrue(self.allows(result, "UNKNOWN"))
        self.assertFalse(self.allows(result, "blue [B]"))
        self.assertFalse(self.allows(result, "green [A]"))

    def test_grammar_preserves_overlapping_evidence_and_escapes_quotes(self):
        result = passage_grammar('[A] Item "C" costs 3 units.\n[B] Item "D" costs 3 units.')
        self.assertTrue(self.allows(result, '"C" [A]'))
        self.assertTrue(self.allows(result, "3 units [A]"))
        self.assertTrue(self.allows(result, "3 units [B]"))

    def test_malformed_and_overlong_passages_fail(self):
        for prompt in ("[A] one", "[B] one\n[A] two", "[A] " + "x " * 65 + "\n[B] few"):
            with self.subTest(prompt=prompt), self.assertRaises(ValueError):
                passage_grammar(prompt)


if __name__ == "__main__":
    unittest.main()
