import unittest
from types import SimpleNamespace

from retrieval_windows import candidate_windows, paragraph_ranges, passages, summarize, unique_sentences


class WordLimit:
    def encode(self, text):
        return SimpleNamespace(overflowing=len(text.split()) > 5)


class RetrievalWindowTests(unittest.TestCase):
    def test_identical_paragraphs_keep_separate_boundaries(self):
        paragraph = "First sentence. Second sentence."
        paper = {"abstract": paragraph, "full_text": [{"paragraphs": ["", paragraph]}]}
        sentences, _ = passages(paper)
        self.assertEqual(paragraph_ranges(paper, sentences), [(0, 2), (2, 4)])
        self.assertEqual(candidate_windows(paper, sentences, WordLimit()),
                         [((0, 2), paragraph), ((2, 4), paragraph)])

    def test_truncation_falls_back_to_full_anchor_or_skips_it(self):
        paper = {"abstract": "One two. Four five six. This sentence is too long to fit.",
                 "full_text": []}
        sentences, _ = passages(paper)
        self.assertEqual(candidate_windows(paper, sentences, WordLimit()),
                         [((0, 1), "One two."), ((1, 2), "Four five six.")])

    def test_sentence_id_mismatch_fails_instead_of_scoring_wrong_span(self):
        paper = {"abstract": "Source sentence.", "full_text": []}
        with self.assertRaisesRegex(ValueError, "segmentation differs"):
            paragraph_ranges(paper, ["Different text."])

    def test_budget_counts_overlap_once_and_clips_final_span(self):
        self.assertEqual(unique_sentences([(3, 6), (4, 7), (0, 3)], 5), [3, 4, 5, 6, 0])

    def test_candidate_hits_and_equal_sentence_budget_are_distinct(self):
        row = {
            "gold": [5],
            "ranks": {
                "bm25": [(0, 1)],
                "e5Sentence": [(0, 1), (5, 6)],
                "e5Window": [(0, 3), (3, 6)],
            },
        }
        counts = summarize([row])
        self.assertEqual(counts["e5Window"]["top5Candidates"], 1)
        self.assertEqual(counts["e5Window"]["within5UniqueSentences"], 0)
        self.assertEqual(counts["e5Window"]["within20UniqueSentences"], 1)
        self.assertEqual(counts["e5Sentence"]["within5UniqueSentences"], 1)


if __name__ == "__main__":
    unittest.main()
