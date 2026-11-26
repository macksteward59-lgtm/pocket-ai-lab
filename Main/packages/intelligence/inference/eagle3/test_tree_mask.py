import json
import unittest
from pathlib import Path

from tree_mask import Eagle3TreeError, additive_tree_mask


ROOT = {"id": "root", "parent": None}
LEFT = {"id": "left", "parent": "root"}
RIGHT = {"id": "right", "parent": "root"}


class TreeMaskTests(unittest.TestCase):
    def test_siblings_are_blocked_and_ancestors_are_allowed(self):
        mask = additive_tree_mask([ROOT, LEFT, RIGHT])
        self.assertEqual(mask[0], [0.0, float("-inf"), float("-inf")])
        self.assertEqual(mask[1], [0.0, 0.0, float("-inf")])
        self.assertEqual(mask[2], [0.0, float("-inf"), 0.0])

    def test_a_child_does_not_become_visible_because_it_is_listed_first(self):
        mask = additive_tree_mask([
            {"id": "child", "parent": "root"},
            {"id": "root", "parent": None},
        ])
        self.assertEqual(mask[0], [0.0, 0.0])
        self.assertEqual(mask[1], [float("-inf"), 0.0])

    def test_a_grandchild_sees_the_chain_and_not_its_own_descendant(self):
        nodes = [
            ROOT,
            {"id": "mid", "parent": "root"},
            {"id": "leaf", "parent": "mid"},
        ]
        mask = additive_tree_mask(nodes)
        self.assertEqual(mask[1], [0.0, 0.0, float("-inf")])
        self.assertEqual(mask[2], [0.0, 0.0, 0.0])
        self.assertEqual(mask[0][2], float("-inf"))

    def test_cycles_duplicates_missing_parents_and_indexes_fail_closed(self):
        with self.assertRaises(Eagle3TreeError) as cycle:
            additive_tree_mask([
                {"id": "root", "parent": None},
                {"id": "a", "parent": "b"},
                {"id": "b", "parent": "a"},
            ])
        self.assertEqual(cycle.exception.code, "cycle")
        with self.assertRaises(Eagle3TreeError) as no_root:
            additive_tree_mask([
                {"id": "a", "parent": "b"},
                {"id": "b", "parent": "a"},
            ])
        self.assertEqual(no_root.exception.code, "no_root")
        with self.assertRaises(Eagle3TreeError) as duplicate:
            additive_tree_mask([ROOT, {"id": "root", "parent": "root"}])
        self.assertEqual(duplicate.exception.code, "duplicate_id")
        with self.assertRaises(Eagle3TreeError) as missing:
            additive_tree_mask([ROOT, {"id": "orphan", "parent": "missing"}])
        self.assertEqual(missing.exception.code, "missing_parent")
        with self.assertRaises(Eagle3TreeError) as indexed:
            additive_tree_mask([{"id": 0, "parent": None}])
        self.assertEqual(indexed.exception.code, "bad_index")
        with self.assertRaises(Eagle3TreeError) as parent_index:
            additive_tree_mask([ROOT, {"id": "child", "parent": 0}])
        self.assertEqual(parent_index.exception.code, "bad_index")

    def test_multiple_roots_and_empty_trees_are_rejected(self):
        with self.assertRaises(Eagle3TreeError) as many:
            additive_tree_mask([ROOT, {"id": "other", "parent": None}])
        self.assertEqual(many.exception.code, "multiple_roots")
        with self.assertRaises(Eagle3TreeError) as empty:
            additive_tree_mask([])
        self.assertEqual(empty.exception.code, "no_root")

    def test_torch_is_not_required_to_import_the_mask(self):
        source = Path(__file__).with_name("tree_mask.py").read_text(encoding="utf-8")
        self.assertNotIn("import torch", source)
        package = json.loads(Path(__file__).resolve().parents[4].joinpath("package.json").read_text(encoding="utf-8"))
        names = set(package["dependencies"]) | set(package["devDependencies"])
        self.assertNotIn("torch", names)


if __name__ == "__main__":
    unittest.main()
