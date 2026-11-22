import unittest
from experiment_full import BM25, inputs_for_teacher


class RetrievalTests(unittest.TestCase):
    def test_order_is_stable_and_counts_topic_specific_words(self):
        i=BM25(["a red ferry", "a blue ferry", "a bridge", "a park", "a lake", "a pier"])
        self.assertEqual(i.shortlist("blue ferry")[0],1)
        self.assertEqual(i.shortlist("unseen"),[0,1,2,3,4])

    def test_injection_is_only_in_training_and_negatives_are_not_other_references(self):
        frozen=[1,2,3,4,5]
        ids,selected,gold=inputs_for_teacher(frozen,[7])
        self.assertEqual((ids,selected,gold),([1,2,3,4,7],[4,0],0))
        self.assertEqual(frozen,[1,2,3,4,5])
        ids,selected,gold=inputs_for_teacher(frozen,[1,2])
        self.assertEqual([ids[i] for i in selected],[1,3])
        self.assertEqual(inputs_for_teacher(frozen,[]),(frozen,[0],-1))
