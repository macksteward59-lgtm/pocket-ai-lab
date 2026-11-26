import unittest
from benchmark import passages, reference, load_nets, evaluate


class ReferenceTests(unittest.TestCase):
    def setUp(self):
        self.sentences, self.groups = passages({"abstract":"The number is 12.0.",
            "full_text":[{"paragraphs":["A cylinder holds 2 cups. Another vessel holds 20 cups."]}]})

    def answer(self, span, evidence):
        return {"answer":{"unanswerable":False, "extractive_spans":[span], "evidence":[evidence]}}

    def test_evidence_and_whole_span_must_match_same_reference(self):
        a = self.answer("2", "A cylinder holds 2 cups. Another vessel holds 20 cups.")
        self.assertEqual(reference({"answers":[a]},self.sentences,self.groups), (([1],[1,2]),"supported"))
        b = self.answer("2","The number is 12.0.")
        self.assertIsNone(reference({"answers":[b]},self.sentences,self.groups)[0])
        c = self.answer("cylinder","The number is 12.0.")
        self.assertIsNone(reference({"answers":[b,c]},self.sentences,self.groups)[0])

    def test_disagreement_is_excluded(self):
        absent = {"answer":{"unanswerable":True}}
        a = self.answer("2","The number is 12.0.")
        self.assertEqual(reference({"answers":[absent]},self.sentences,self.groups), (([],[]),"absent"))
        self.assertEqual(reference({"answers":[absent,a]},self.sentences,self.groups)[1],"disagreement")

    def test_original_weights_and_scores(self):
        choices, scores = evaluate("How much does the cylinder hold?", self.sentences, load_nets())
        self.assertEqual(set(choices), {"hard","soft","lexical"})
        self.assertEqual(len(scores), 3)
        self.assertTrue(all(0 <= x <= 1 for x in scores))
