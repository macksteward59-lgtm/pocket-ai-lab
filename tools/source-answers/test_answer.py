import contextlib
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import answer as cli

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


class SourceAnswerCLITests(unittest.TestCase):
    def run_cli(self, *args):
        argv = ["answer.py", "--gguf", "model.gguf", "--llama-server", __file__, *args]
        with patch.object(sys, "argv", argv):
            cli.main()

    def test_invalid_explicit_question_does_not_prepare_or_start_model(self):
        for question in ("", "  ", "one\n[B] invented"):
            with self.subTest(question=question), patch.object(cli, "verify_model") as verify, \
                    patch.object(cli, "local_server") as server, patch.object(cli, "answer", return_value={"answer": "UNKNOWN", "source": None}) as answer, \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as stderr:
                with self.assertRaises(SystemExit) as failure:
                    self.run_cli("--question", question)
                self.assertEqual(failure.exception.code, 2)
                self.assertIn("Use one question", stderr.getvalue())
                verify.assert_not_called()
                server.assert_not_called()
                answer.assert_not_called()

    def test_valid_explicit_question_runs_once(self):
        with patch.object(cli, "verify_model") as verify, \
                patch.object(cli, "local_server") as server, patch.object(cli, "answer", return_value={}) as answer, \
                contextlib.redirect_stdout(io.StringIO()):
            self.run_cli("--question", "CF-QUOTA")
        verify.assert_called_once_with(Path("model.gguf"), cli.MODEL)
        answer.assert_called_once_with("CF-QUOTA", server.return_value.__enter__.return_value, cli.MODEL)

    def test_explicit_check_runs_the_frozen_fixture(self):
        with patch.object(cli, "verify_model"), patch.object(cli, "local_server"), \
                patch.object(cli, "answer", return_value={"answer": "UNKNOWN", "source": None}) as answer, \
                contextlib.redirect_stdout(io.StringIO()):
            self.run_cli("--check")
        fixture = json.loads((cli.HERE / "questions.json").read_bytes())
        self.assertEqual([call.args[0] for call in answer.call_args_list], [case["question"] for case in fixture])
