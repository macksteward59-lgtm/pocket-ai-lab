import unittest

try:
    import torch
except ImportError:
    torch = None

if torch is not None:
    from torch import nn
    from scaffold import Eagle3ScaffoldError, ExperimentalEagle3Scaffold


@unittest.skipUnless(torch is not None, "torch is optional and is not a TypeScript dependency")
class ScaffoldTests(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(0)
        self.nodes = [
            {"id": "root", "parent": None},
            {"id": "left", "parent": "root"},
            {"id": "right", "parent": "root"},
        ]
        self.model = ExperimentalEagle3Scaffold(8, 16, nhead=2).eval()

    def _inputs(self):
        return [torch.randn(1, 3, 8) for _ in range(4)]

    def test_dimensions_and_the_supplied_layer_kinds(self):
        model = self.model
        self.assertEqual(model.feature_projection.in_features, 24)
        self.assertEqual(model.feature_projection.out_features, 8)
        self.assertEqual(model.state_token_fusion.in_features, 16)
        self.assertEqual(model.state_token_fusion.out_features, 8)
        self.assertIsNone(model.lm_head.bias)
        self.assertEqual(model.lm_head.out_features, 16)
        self.assertIsInstance(model.extrapolation, nn.TransformerDecoderLayer)
        self.assertIsInstance(model.extrapolation.norm1, nn.LayerNorm)
        self.assertFalse(model.grants_authorization)
        logits = model(*self._inputs(), self.nodes)
        self.assertEqual(tuple(logits.shape), (1, 3, 16))
        self.assertFalse(hasattr(logits, "authorized"))

    def test_sibling_and_descendant_positions_do_not_change_allowed_nodes(self):
        low, mid, high, draft = self._inputs()
        base = self.model(low, mid, high, draft, self.nodes)
        low_right = low.clone()
        low_right[:, 2, :] += 4
        blocked = self.model(low_right, mid, high, draft, self.nodes)
        torch.testing.assert_close(blocked[:, 0], base[:, 0])
        torch.testing.assert_close(blocked[:, 1], base[:, 1])
        self.assertGreater((blocked[:, 2] - base[:, 2]).abs().max().item(), 1e-4)

        low_left = low.clone()
        low_left[:, 1, :] += 4
        child = self.model(low_left, mid, high, draft, self.nodes)
        torch.testing.assert_close(child[:, 0], base[:, 0])
        torch.testing.assert_close(child[:, 2], base[:, 2])
        self.assertGreater((child[:, 1] - base[:, 1]).abs().max().item(), 1e-4)

    def test_an_ancestor_change_is_visible_to_its_descendant(self):
        low, mid, high, draft = self._inputs()
        base = self.model(low, mid, high, draft, self.nodes)
        low_root = low.clone()
        low_root[:, 0, :] += 4
        changed = self.model(low_root, mid, high, draft, self.nodes)
        self.assertGreater((changed[:, 1] - base[:, 1]).abs().max().item(), 1e-4)
        self.assertGreater((changed[:, 0] - base[:, 0]).abs().max().item(), 1e-4)

    def test_dtype_device_and_shape_mismatches_fail_closed(self):
        model = ExperimentalEagle3Scaffold(4, 6, dtype=torch.float64, device="cpu").eval()
        self.assertEqual(model.lm_head.weight.dtype, torch.float64)
        self.assertEqual(model.lm_head.weight.device.type, "cpu")
        nodes = [{"id": "root", "parent": None}]
        low = torch.randn(1, 4, dtype=torch.float64)
        mid = torch.randn(1, 4, dtype=torch.float64)
        high = torch.randn(1, 4, dtype=torch.float64)
        draft = torch.randn(1, 4, dtype=torch.float64)
        logits = model(low, mid, high, draft, nodes)
        self.assertEqual(logits.dtype, torch.float64)
        self.assertEqual(logits.device.type, "cpu")
        with self.assertRaises(Eagle3ScaffoldError) as mismatch:
            model(low.float(), mid, high, draft, nodes)
        self.assertEqual(mismatch.exception.code, "bad_layout")
        with self.assertRaises(Eagle3ScaffoldError) as shape:
            model(low[:, :3], mid, high, draft, nodes)
        self.assertEqual(shape.exception.code, "bad_shape")


if __name__ == "__main__":
    unittest.main()
