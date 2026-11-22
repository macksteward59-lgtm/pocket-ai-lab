import contextlib
import io
import json
import sys
import unittest
from unittest.mock import patch

import answer as cli
from compare_support import passes


class SupportTests(unittest.TestCase):
    def setUp(self):
        self.proposal = dict(question="How many petals?", status="quote_proposed", answer="six",
                             source="FLOWER", sourceURL="https://example.org", model=cli.MODEL,
                             retrieved=[dict(id="FLOWER", finding="The flower has six petals.")],
                             requestID="first", semanticSupportVerified=False)

    def decision(self, verdict, finish="stop"):
        return dict(id="second", model=cli.MODEL, choices=[
            dict(message=dict(content=verdict), finish_reason=finish)])

    def test_rejected_quote_retains_its_provenance(self):
        with patch.object(cli, "request_reply", return_value=self.decision("NO")):
            result = cli.assess_support(self.proposal, object())
        self.assertEqual((result["answer"], result["source"], result["status"]),
                         ("UNKNOWN", None, "insufficient_evidence"))
        self.assertNotIn("sourceURL", result)
        check = result["supportAssessment"]
        self.assertEqual((result["requestID"], check["requestID"]), ("first", "second"))
        self.assertEqual((check["proposedQuote"], check["proposedSource"]), ("six", "FLOWER"))
        self.assertEqual(self.proposal["answer"], "six")

    def test_accepted_quote_still_has_no_independent_semantic_verification(self):
        with patch.object(cli, "request_reply", return_value=self.decision("YES")):
            result = cli.assess_support(self.proposal, object())
        self.assertEqual(result["answer"], "six")
        self.assertFalse(result["semanticSupportVerified"])

    def test_invalid_assessment_cannot_accept_quote(self):
        for verdict, finish in (("YES", "length"), ("maybe", "stop")):
            with self.subTest(verdict=verdict), patch.object(cli, "request_reply", return_value=self.decision(verdict, finish)):
                with self.assertRaises(ValueError):
                    cli.assess_support(self.proposal, object())

    def test_initial_abstention_skips_second_call(self):
        with patch.object(cli, "request_reply") as call:
            for status in ("no_candidates", "abstained"):
                record = {"status": status}
                self.assertIs(cli.assess_support(record, None), record)
            call.assert_not_called()

    def test_question_flag_uses_assessed_output(self):
        argv = ["answer.py", "--assess-support", "--source-id", "CF-QUOTA", "--question", "neurons",
                "--gguf", "model.gguf", "--llama-server", __file__]
        with patch.object(sys, "argv", argv), patch.object(cli, "verify_model"), patch.object(cli, "local_server"), \
                patch.object(cli, "answer", return_value=self.proposal), \
                patch.object(cli, "request_reply", return_value=self.decision("NO")), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            cli.main()
        self.assertEqual(json.loads(output.getvalue())["status"], "insufficient_evidence")

    def test_all_required_facts_and_correct_source_are_necessary(self):
        case = dict(requires=["amber", "violet"], sourceID="A")
        row = dict(status="quote_proposed", answer="amber and violet", source="A")
        self.assertTrue(passes(case, row))
        self.assertFalse(passes(case, dict(row, answer="amber")))
        self.assertFalse(passes(case, dict(row, source="B")))
        self.assertFalse(passes(dict(requires=[]), row))
