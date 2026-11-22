import unittest

from retrieval_rerank import hit, rank_candidates


class RerankingTests(unittest.TestCase):
    def test_tied_logits_preserve_the_original_rank(self):
        self.assertEqual(rank_candidates([9, 2, 3, 4], [0.0, 1.0, 1.0, -1.0]), [2, 3, 9, 4])

    def test_evidence_outside_the_display_budget_does_not_count(self):
        reranked = rank_candidates([9, 2, 3, 4], [0.0, 1.0, 1.0, -1.0])
        self.assertFalse(hit(reranked, [9], 2))
        self.assertTrue(hit(reranked, [9], 3))


if __name__ == "__main__":
    unittest.main()
