import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import answer
import reviewed


class ReviewedQuestionTests(unittest.TestCase):
    def test_all_listed_questions_return_exact_current_source_excerpts(self):
        register = json.loads((answer.HERE.parents[1] / "docs/research/project-sources.json").read_text())
        self.assertEqual(set(json.loads(reviewed.CATALOG.read_text())),
                         {source["id"] for source in register["sources"]})
        for source in register["sources"]:
            source_id = source["id"]
            record = answer.retrieve(source_id, source_id)
            listed = reviewed.reviewed_result(record, source_id)
            self.assertEqual(listed["status"], "questions_listed")
            self.assertTrue(listed["availableQuestions"])
            for question in listed["availableQuestions"]:
                with self.subTest(source=source_id, question=question):
                    row = reviewed.reviewed_result(record, source_id, question)
                    self.assertEqual(row["status"], "reviewed_answer")
                    self.assertEqual(row["sourceURL"], source["url"])
                    self.assertIn(row["answer"], source["finding"])
                    self.assertIsNone(row["model"])
                    self.assertNotIn("requestID", row)

    def test_revised_text_and_publisher_url_require_review_again(self):
        source_id = "CF-QUOTA"
        record = answer.retrieve(source_id, source_id)
        for field in ("finding", "url"):
            item = {**record["sources"][0]}
            item[field] += " amended"
            result = reviewed.reviewed_result(dict(record, sources=[item]), source_id)
            self.assertEqual((result["status"], result["availableQuestions"]), ("source_changed", []))
        self.assertEqual(reviewed.reviewed_result(record, "APPLE-TEAM")["status"], "source_unavailable")

    def test_unbound_excerpt_cannot_be_returned(self):
        record = answer.retrieve("CF-QUOTA", "CF-QUOTA")
        content = json.loads(reviewed.CATALOG.read_text())
        content["CF-QUOTA"]["questions"]["Unbound fact?"] = "unsupported value"
        with patch.object(Path, "read_text", return_value=json.dumps(content)):
            result = reviewed.reviewed_result(record, "CF-QUOTA", "Unbound fact?")
        self.assertEqual((result["answer"], result["status"]), ("UNKNOWN", "excerpt_unavailable"))

    def cli(self, *args):
        return subprocess.run([sys.executable, str(answer.HERE / "answer.py"), *args],
                              capture_output=True, text=True, timeout=15)

    def test_real_cli_lists_answers_and_abstains_without_model_arguments(self):
        def run(*args):
            reply = self.cli(*args)
            self.assertEqual(reply.returncode, 0, reply.stderr)
            return json.loads(reply.stdout)

        listed = run("--list-reviewed", "--source-id", "cf-quota")
        question = "What is the published daily free allocation and reset time?"
        self.assertIn(question, listed["availableQuestions"])
        opts = ["--question", question, "--reviewed-only", "--source-id"]
        row = run(*opts, "cf-quota")
        self.assertEqual(row["answer"], "The free allocation is 10,000 neurons per day, resetting at 00:00 UTC.")
        self.assertEqual(run(*opts, "APPLE-TEAM")["status"], "question_not_listed")
        self.assertEqual(run(*opts, "CF-QUOTA-MISSING")["status"], "source_unavailable")
        other = run("--question", "What is the free allocation for one request?", "--reviewed-only",
                    "--source-id", "cf-quota")
        self.assertEqual((other["answer"], other["status"], other["source"]),
                         ("UNKNOWN", "question_not_listed", None))
        self.assertEqual(other["availableQuestions"], listed["availableQuestions"])

    def test_flag_combinations_and_invalid_questions_are_rejected(self):
        for args in (["--reviewed-only", "--check"], ["--list-reviewed"],
                     ["--list-reviewed", "--assess-support", "--source-id", "CF-QUOTA"],
                     ["--reviewed-only", "--source-id", "CF-QUOTA", "--question", "two\nlines"]):
            with self.subTest(args=args):
                self.assertEqual(self.cli(*args).returncode, 2)
