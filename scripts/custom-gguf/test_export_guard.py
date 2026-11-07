import unittest

from export_guard import export_allowed


class ExportGuardTests(unittest.TestCase):
    def test_no_improvement_blocks_export(self):
        allowed, reason = export_allowed({
            "heldoutExact": 0,
            "baselineExact": 0,
            "heldoutCount": 2,
            "authorized": False,
        })
        self.assertFalse(allowed)
        self.assertIn("did not improve", reason)

    def test_an_authorization_flag_in_the_report_blocks_export(self):
        allowed, reason = export_allowed({
            "heldoutExact": 2,
            "baselineExact": 0,
            "heldoutCount": 2,
            "authorized": True,
        })
        self.assertFalse(allowed)
        self.assertIn("authorization", reason)

    def test_improvement_without_an_authorization_flag_allows_export(self):
        allowed, reason = export_allowed({
            "heldoutExact": 1,
            "baselineExact": 0,
            "heldoutCount": 2,
            "authorized": False,
        })
        self.assertTrue(allowed)
        self.assertIn("improved", reason)


if __name__ == "__main__":
    unittest.main()
