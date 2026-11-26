import json
import unittest
from unittest.mock import patch

import experiment as exp
from student import fit, pick, predict


class DistillationTests(unittest.TestCase):
    def test_frozen_split_and_gold(self):
        train = exp.training_docs()
        test = json.loads((exp.HERE/"heldout.json").read_bytes())
        exp.validate(train)
        exp.validate(test, train)
        self.assertEqual([sum(len(d["questions"]) for d in fold) for fold in (train, test)], [44,16])
        self.assertEqual(sum(k < 0 for d in test for _, k in d["questions"]), 8)
        with self.assertRaises(ValueError):
            exp.validate([train[0]], train)

    def test_teacher_probs_need_both_labels(self):
        malformed = {"completion_probabilities":[{"top_probs":[{"id":3, "prob":1.0}]}]}
        with patch.object(exp, "post", return_value=malformed), self.assertRaises(ValueError):
            exp.teach(None, {"Y":2, "N":3}, "When?", "At noon.")

    def test_retains_verified_soft_targets_only(self):
        rows = [dict(source="one", question="Which tag?", sentences=["Tag copper.", "Tag teal."], gold=0,
                     teacher=[{"probYes":.85}, {"probYes":.35}]),
                dict(source="two", question="Which tag?", sentences=["Tag copper.", "Tag teal."], gold=0,
                     teacher=[{"probYes":.9}, {"probYes":.1}]),
                dict(source="one", question="When?", sentences=["Tag copper."], gold=-1, teacher=[{"probYes":.7}])]
        with patch.object(exp, "fit", side_effect=lambda pairs:[p for _,p in pairs]):
            nets, stats = exp.learn(rows)
        self.assertEqual(nets["hard"], [1,0,1,0])
        self.assertEqual(nets["direct"], [1,0,1,0,0])
        self.assertAlmostEqual(nets["student"][0], .85)
        self.assertAlmostEqual(stats["crossFittedOffsets"]["two"], exp.calibration([rows[0],rows[2]]))
        self.assertEqual(stats["retainedPairs"], 4)

    def test_saved_student_and_abstention(self):
        with self.assertRaises(ValueError):
            fit([])
        self.assertEqual(pick([.5, .1]), -1)
        self.assertEqual(pick([.6, .8]), 1)
        rows = [dict(source="one", question="Which color?", sentences=["It has the color teal.", "It closes at noon."],
                     gold=0, teacher=[{"probYes":.8},{"probYes":.1}])]
        nets, _ = exp.learn(rows + [dict(rows[0], source="two")])
        q, s = rows[0]["question"], rows[0]["sentences"]
        self.assertEqual(predict(nets["student"],q,s), predict(json.loads(json.dumps(nets["student"])),q,s))
