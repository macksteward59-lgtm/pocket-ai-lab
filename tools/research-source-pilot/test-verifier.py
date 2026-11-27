#!/usr/bin/env python3
"""Independent replay goldens and receipt-tampering regressions (stdlib only).

Usage: python3 test-verifier.py [TRUSTED-FREEZE-SHA256 REPORT.json]
Uses the actual JS-produced report as the positive fixture. No JavaScript runs.
All mutations happen in temporary copies, never in the candidate's frozen data.
The no-argument invocation uses the explicitly recorded v1 test-fixture anchor,
not an adjacent digest file. Production verification always requires an anchor.
"""

import copy
import importlib.util
import json
import math
from pathlib import Path
import shutil
import sys
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
spec = importlib.util.spec_from_file_location("independent_source_verifier", HERE / "verify.py")
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)
TRUSTED = None
REPORT = None
TEST_FIXTURE_ANCHOR = "1ce55de2ac1227914b99335f124fa874afe7ef6591b71a917f51f137a6ff9d06"


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def zero_model(intercept=0.0):
    return {"version": 1, "features": list(verifier.FEATURE_NAMES),
            "weights": [[0.0] * 10 for _ in range(8)], "biases": [0.0] * 8,
            "output": [0.0] * 8, "intercept": intercept}


class NumericalGoldens(unittest.TestCase):
    def test_duplicate_tokens_have_distinct_set_and_count_semantics(self):
        observed = verifier.feature_rows("How many cats cats?", ["two cats", "three dogs"])
        expected = [[0.5, 0.5, 1 / 3, 0.5, 0, 1, 1, 1, 0.5, 1 / 3],
                    [0, 0, 0, 0, 0, 1, 1, 1, -0.5, 1]]
        for actual, target in zip(observed, expected):
            for left, right in zip(actual, target):
                self.assertAlmostEqual(left, right, places=15)

    def test_threshold_is_strict_and_ties_choose_first(self):
        self.assertEqual(verifier.replay(zero_model(), "cats", ["cats", "dogs"]), (-1, [0.5, 0.5]))
        selected, scores = verifier.replay(zero_model(0.01), "cats", ["cats", "dogs"])
        self.assertEqual(selected, 0)
        self.assertEqual(scores[0], scores[1])

    def test_clipping_and_ascii_number_semantics(self):
        self.assertAlmostEqual(verifier.forward(zero_model(-1000), [0] * 10), 1 / (1 + math.exp(40)))
        rows = verifier.feature_rows("How many?", ["\u0661", "one", "1"])
        self.assertEqual([row[6] for row in rows], [0, 1, 1])
        self.assertEqual(verifier.js_length("\U0001f600"), 2)

    def test_bool_and_nonfinite_weights_are_not_numbers(self):
        for field, value in (("version", True), ("intercept", False), ("intercept", float("nan")), ("intercept", float("inf"))):
            with self.subTest(field=field, value=value):
                model = zero_model()
                model[field] = value
                with self.assertRaises(verifier.VerificationError):
                    verifier.validate_weights(model)


class FrozenReceiptChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pocket-independent-verifier-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "candidate"
        self.directory = self.root / "tools/research-source-pilot"
        self.directory.mkdir(parents=True)
        for filename in (*verifier.FROZEN_FILES, "freeze.json"):
            shutil.copyfile(HERE / filename, self.directory / filename)
        baseline = verifier.parse_json((HERE / "baseline.json").read_bytes())
        for entry in baseline["files"]:
            target = self.root / entry["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / entry["path"], target)
        self.report = verifier.parse_json(REPORT.read_bytes())
        self.report_path = self.root / "report.json"
        shutil.copyfile(REPORT, self.report_path)

    def verify(self, trusted=TRUSTED):
        # Default arguments are bound at definition time, before CLI parsing.
        return verifier.verify_report(TRUSTED if trusted is None else trusted,
                                      self.report_path, self.directory, self.root)

    def reject_report(self, mutation):
        changed = copy.deepcopy(self.report)
        mutation(changed)
        dump(self.report_path, changed)
        with self.assertRaises(verifier.VerificationError):
            self.verify()

    @staticmethod
    def answered(report):
        return next(output for row in report["cases"] for output in row["outputs"] if output["selected_note_id"] is not None)

    def refreeze(self, filename, document):
        """For schema tests, explicitly trust a new fixture digest, not production data."""
        dump(self.directory / filename, document)
        freeze = verifier.parse_json((self.directory / "freeze.json").read_bytes())
        freeze["files"][filename] = verifier.sha256((self.directory / filename).read_bytes())
        dump(self.directory / "freeze.json", freeze)
        return verifier.sha256((self.directory / "freeze.json").read_bytes())

    def test_actual_report_replays_all_predictions(self):
        result = self.verify()
        self.assertEqual(result["predictions_replayed"], 48)
        self.assertEqual(result["cases_verified"], 24)
        self.assertEqual(result["baseline_assets_verified"], 10)
        self.assertLessEqual(result["maximum_probability_difference"], 1e-12)
        self.assertEqual(result["metrics"]["soft"]["supported"]["correct"], 9)
        self.assertEqual(result["metrics"]["hard"]["abstention"]["answered"], 2)

    def test_wrong_trusted_digest_fails(self):
        with self.assertRaises(verifier.VerificationError):
            self.verify("0" * 64)

    def test_forged_adjacent_report_digest_is_not_trusted(self):
        changed = copy.deepcopy(self.report)
        changed["cases"][0]["outputs"][0]["correct"] = not changed["cases"][0]["outputs"][0]["correct"]
        dump(self.report_path, changed)
        self.report_path.with_suffix(".sha256").write_text(verifier.sha256(self.report_path.read_bytes()) + "\n")
        with self.assertRaises(verifier.VerificationError):
            self.verify()

    def test_scope_overclaims_and_boolean_substitution_fail(self):
        changes = {"execution_scope": "physical-device", "evaluation_kind": "blinded-benchmark",
                   "model_training": 0, "remote_actions": 0,
                   "primary_source_semantics_independently_proven": True,
                   "baseline_revision": "0" * 40, "freeze_sha256": "0" * 64}
        for name, value in changes.items():
            with self.subTest(name=name):
                self.reject_report(lambda report, n=name, v=value: report.update({n: v}))

    def test_missing_and_duplicate_case_rows_fail(self):
        self.reject_report(lambda report: report["cases"].pop())
        self.reject_report(lambda report: report["cases"].__setitem__(1, copy.deepcopy(report["cases"][0])))

    def test_missing_and_duplicate_model_outputs_fail(self):
        self.reject_report(lambda report: report["cases"][0]["outputs"].pop())
        self.reject_report(lambda report: report["cases"][0]["outputs"].__setitem__(1, copy.deepcopy(report["cases"][0]["outputs"][0])))

    def test_duplicate_models_and_changed_identity_fail(self):
        self.reject_report(lambda report: report["models"].__setitem__(1, copy.deepcopy(report["models"][0])))
        self.reject_report(lambda report: report["models"][0].update({"model_id": "0" * 64}))

    def test_model_normalization_cannot_redefine_identity(self):
        def mutate(report):
            model = report["models"][0]
            model["weights_json"] = json.dumps(json.loads(model["weights_json"]), indent=2)
            model["model_id"] = model["weights_sha256"] = verifier.sha256(model["weights_json"])
        self.reject_report(mutate)

    def test_probability_tampering_and_boolean_probability_fail(self):
        self.reject_report(lambda report: report["cases"][0]["outputs"][0]["probabilities"].__setitem__(0, 0.999))
        self.reject_report(lambda report: report["cases"][0]["outputs"][0]["probabilities"].__setitem__(0, False))
        self.reject_report(lambda report: report["cases"][0]["outputs"][0]["probabilities"].__setitem__(0, float("nan")))

    def test_case_labels_and_source_identity_fail_if_changed(self):
        for key, value in (("source_id", "fake-source"), ("kind", "supported"), ("expected_note_id", True)):
            with self.subTest(key=key):
                self.reject_report(lambda report, k=key, v=value: report["cases"][-1].update({k: v}))

    def test_selected_note_answer_digest_and_decision_fail_if_changed(self):
        for key, value in (("selected_note_id", "fake-note"), ("answer_sha256", "0" * 64), ("decision", "approved")):
            with self.subTest(key=key):
                self.reject_report(lambda report, k=key, v=value: self.answered(report).update({k: v}))

    def test_citation_version_locator_and_digests_fail_if_changed(self):
        for key, value in (("version", "unverified-new-version"), ("locator", "fabricated page"),
                           ("note_sha256", "0" * 64), ("source_record_sha256", "0" * 64),
                           ("source_family", "another-family"), ("source_id", "another-source")):
            with self.subTest(key=key):
                self.reject_report(lambda report, k=key, v=value: self.answered(report)["citation"].update({k: v}))

    def test_wrong_bool_flags_and_boolean_metric_fail(self):
        self.reject_report(lambda report: self.answered(report).update({"citation_binding_valid": 1}))
        self.reject_report(lambda report: self.answered(report).update({"correct": int(self.answered(report)["correct"])}))
        self.reject_report(lambda report: report["metrics"]["soft"]["supported"].update({"wrong_selection": False}))
        self.reject_report(lambda report: report["metrics"]["hard"]["abstention"].update({"answered": 0}))

    def test_duplicate_json_keys_and_unknown_fields_fail(self):
        raw = self.report_path.read_text()
        self.report_path.write_text(raw.replace("{", '{"schema":"forged",', 1))
        with self.assertRaises(verifier.VerificationError):
            self.verify()
        self.reject_report(lambda report: report.update({"signed": True}))

    def test_altered_source_author_version_and_locator_fail_under_original_anchor(self):
        original = verifier.parse_json((HERE / "sources.json").read_bytes())
        for field in ("authors", "version", "locator"):
            with self.subTest(field=field):
                corpus = copy.deepcopy(original)
                if field == "authors":
                    corpus["sources"][0][field] = ["Invented Author"]
                elif field == "version":
                    corpus["sources"][0][field] = "invented revision"
                else:
                    corpus["sources"][0]["notes"][0][field] = "invented location"
                dump(self.directory / "sources.json", corpus)
                with self.assertRaises(verifier.VerificationError):
                    self.verify()

    def test_refrozen_source_cannot_replace_original_trust_anchor(self):
        corpus = verifier.parse_json((self.directory / "sources.json").read_bytes())
        corpus["sources"][0]["authors"] = ["Invented Author"]
        forged = self.refreeze("sources.json", corpus)
        self.report["freeze_sha256"] = forged
        dump(self.report_path, self.report)
        (self.directory / "FROZEN_SHA256.txt").write_text(forged + "\n")
        with self.assertRaises(verifier.VerificationError):
            self.verify()

    def test_source_record_hash_binds_author_even_with_explicit_new_fixture_anchor(self):
        corpus = verifier.parse_json((self.directory / "sources.json").read_bytes())
        corpus["sources"][0]["authors"] = ["Invented Author"]
        new_fixture_anchor = self.refreeze("sources.json", corpus)
        self.report["freeze_sha256"] = new_fixture_anchor
        dump(self.report_path, self.report)
        with self.assertRaisesRegex(verifier.VerificationError, "Citation binding"):
            self.verify(new_fixture_anchor)

    def test_family_split_leak_fails_even_with_explicit_new_fixture_anchor(self):
        corpus = verifier.parse_json((self.directory / "sources.json").read_bytes())
        corpus["training_sources"] = [{"id": "train-other-version", "family": corpus["sources"][0]["family"], "split": "training"}]
        digest = self.refreeze("sources.json", corpus)
        with self.assertRaisesRegex(verifier.VerificationError, "family split leakage"):
            self.verify(digest)

    def test_source_id_alias_crosses_no_split(self):
        corpus = verifier.parse_json((self.directory / "sources.json").read_bytes())
        corpus["training_sources"] = [{"id": corpus["sources"][0]["id"], "family": "renamed-family", "split": "training"}]
        digest = self.refreeze("sources.json", corpus)
        with self.assertRaisesRegex(verifier.VerificationError, "Duplicate source ID"):
            self.verify(digest)

    def test_duplicate_training_ids_fail(self):
        corpus = verifier.parse_json((self.directory / "sources.json").read_bytes())
        item = {"id": "duplicate-training", "family": "some-training-family", "split": "training"}
        corpus["training_sources"] = [item, copy.deepcopy(item)]
        digest = self.refreeze("sources.json", corpus)
        with self.assertRaisesRegex(verifier.VerificationError, "Duplicate training"):
            self.verify(digest)

    def test_baseline_changes_and_missing_asset_fail(self):
        path = self.root / "apps/web/model-workshop/reader.js"
        original = path.read_bytes()
        path.write_bytes(original + b"\n")
        with self.assertRaisesRegex(verifier.VerificationError, "Pinned baseline changed"):
            self.verify()
        path.unlink()
        with self.assertRaisesRegex(verifier.VerificationError, "Missing regular file"):
            self.verify()

    def test_baseline_bool_bytes_and_wrong_blob_id_fail(self):
        original = verifier.parse_json((self.directory / "baseline.json").read_bytes())
        for field, value, message in (("bytes", True, "byte count"), ("git_blob_sha", "0" * 40, "Git blob mismatch")):
            with self.subTest(field=field):
                baseline = copy.deepcopy(original)
                baseline["files"][0][field] = value
                digest = self.refreeze("baseline.json", baseline)
                with self.assertRaisesRegex(verifier.VerificationError, message):
                    self.verify(digest)


def main():
    global TRUSTED, REPORT
    if len(sys.argv) == 1:
        TRUSTED = TEST_FIXTURE_ANCHOR
        REPORT = ROOT / "evidence/research-source-pilot/report.json"
    elif len(sys.argv) == 3:
        TRUSTED = sys.argv[1]
        REPORT = Path(sys.argv[2]).resolve()
    else:
        print("Usage: python3 test-verifier.py [TRUSTED-FREEZE-SHA256 REPORT.json]", file=sys.stderr)
        return 2
    result = unittest.main(argv=[sys.argv[0]], verbosity=2, exit=False)
    return 0 if result.result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
