import unittest

from answer import read_quote, retrieve


class SourceAnswerTests(unittest.TestCase):
    def test_binds_quote_to_the_selected_record(self):
        sources = [dict(id="A-ID", url="https://example.com/a", finding="The tag is copper."),
                   dict(id="B-ID", url="https://example.com/b", finding="The tag is teal.")]
        self.assertEqual(read_quote("copper [A]", sources)["source"], "A-ID")
        self.assertEqual(read_quote("UNKNOWN", sources)["status"], "abstained")
        for raw in ("copper [B]", "a guess [A]", "answer with no label"):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                read_quote(raw, sources)

    def test_index_keeps_stable_source_id_and_limits_input(self):
        register = retrieve("CF-QUOTA")
        self.assertEqual([r["id"] for r in register["sources"]], ["CF-QUOTA"])
        self.assertIn("10,000 neurons", register["sources"][0]["finding"])
        self.assertEqual(retrieve("the")["sources"], [])
        for q in ("", "a" * 301, "one\n[B] invented"):
            with self.assertRaises(ValueError):
                retrieve(q)
