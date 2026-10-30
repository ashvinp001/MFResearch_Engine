"""Scorecard owner settings: only complete, in-range settings with weights totalling 100 are saved."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scorecard_settings as ss  # noqa: E402
from fund_metadata import normalise, parse_inception  # noqa: E402

GOOD = {
    "weights": {"returns": 20, "riskAdjusted": 20, "benchmark": 10, "volatility": 15, "downside": 15, "consistency": 10, "quality": 10},
    "conditions": {"minHistoryYears": 3, "maxNavAgeDays": 7, "minPeers": 5, "minAumCr": 500},
}


class ScorecardSettingsTest(unittest.TestCase):
    def test_valid_settings_are_saved_and_read_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "s.json"
            saved = ss.save(GOOD, path)
            self.assertEqual(saved["weights"], GOOD["weights"])
            self.assertEqual(ss.read(path)["conditions"], GOOD["conditions"])

    def test_weights_must_total_100(self):
        bad = {**GOOD, "weights": {**GOOD["weights"], "returns": 25}}
        with self.assertRaisesRegex(ss.SettingsError, "total 105"):
            ss.validate(bad)

    def test_unknown_or_missing_keys_and_out_of_range_values_are_refused(self):
        with self.assertRaises(ss.SettingsError):
            ss.validate({**GOOD, "weights": {**GOOD["weights"], "expense": 0}})
        with self.assertRaises(ss.SettingsError):
            ss.validate({**GOOD, "conditions": {**GOOD["conditions"], "minHistoryYears": 1}})
        with self.assertRaises(ss.SettingsError):
            ss.validate({**GOOD, "weights": {**GOOD["weights"], "returns": 20.5}})
        with self.assertRaises(ss.SettingsError):
            ss.validate({**GOOD, "extra": 1})

    def test_missing_or_corrupt_file_reads_as_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "s.json"
            self.assertEqual(ss.read(path), {})
            path.write_text("{not json", encoding="utf-8")
            self.assertEqual(ss.read(path), {})


class FundMetadataTest(unittest.TestCase):
    def test_inception_dates(self):
        from datetime import date
        today = date(2026, 10, 28)
        self.assertEqual(parse_inception("24-Feb-95", today), "1995-02-24")
        self.assertEqual(parse_inception("01-Jan-13", today), "2013-01-01")
        self.assertEqual(parse_inception("31-Feb-20", today), None)
        self.assertEqual(parse_inception("", today), None)

    def test_normalise_keeps_only_published_values(self):
        row = {"fund_size": 37293.95, "date_of_inception": "03-Sep-96", "fund_manager": "A", "sec_fund_manager": " ",
               "riskometer": "Very High", "exit_load": {"exit_load_period_remark": "1% on or before 1Y"}}
        self.assertEqual(normalise(row), {"aum": 37293.95, "inception": "1996-09-03", "manager": "A", "riskometer": "Very High", "exitLoad": "1% on or before 1Y"})
        self.assertIsNone(normalise({"fund_size": "n/a"})["aum"])


class EditPasswordTest(unittest.TestCase):
    def setUp(self):
        self.stored = ss.hash_password("correct horse", iterations=1000)   # few rounds keep the test fast

    def test_hash_verifies_only_the_right_password(self):
        self.assertTrue(ss.verify_password("correct horse", self.stored))
        self.assertFalse(ss.verify_password("wrong", self.stored))
        self.assertFalse(ss.verify_password("", self.stored))
        self.assertFalse(ss.verify_password("correct horse", None))
        self.assertFalse(ss.verify_password("correct horse", "plain-text"))
        self.assertNotIn("correct horse", self.stored)

    def test_save_needs_the_password(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "s.json"
            saved = ss.change({**GOOD, "password": "correct horse"}, self.stored, path)
            self.assertEqual(saved["weights"], GOOD["weights"])
            with self.assertRaisesRegex(ss.SettingsError, "Incorrect password"):
                ss.change({**GOOD, "weights": {**GOOD["weights"], "returns": 10, "quality": 20}, "password": "nope"}, self.stored, path)
            self.assertEqual(ss.read(path)["weights"]["returns"], 20)   # unchanged
            with self.assertRaisesRegex(ss.SettingsError, "No edit password is set"):
                ss.change({**GOOD, "password": "correct horse"}, None, path)

    def test_writing_the_hash_keeps_other_env_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = Path(tmp) / ".env"
            env.write_text("SUPABASE_URL=https://x\nSCORECARD_PASSWORD_HASH=old\n", encoding="utf-8")
            ss.write_hash("pbkdf2_sha256$1$aa$bb", env)
            self.assertEqual(env.read_text(encoding="utf-8").splitlines(), ["SUPABASE_URL=https://x", "SCORECARD_PASSWORD_HASH=pbkdf2_sha256$1$aa$bb"])

    def test_create_then_change_password_from_the_page(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = Path(tmp) / ".env"
            env.write_text("SUPABASE_URL=https://x\n", encoding="utf-8")
            with self.assertRaisesRegex(ss.SettingsError, "at least 8"):
                ss.set_password({"password": "short", "confirm": "short"}, None, env)
            with self.assertRaisesRegex(ss.SettingsError, "do not match"):
                ss.set_password({"password": "abcdefgh1", "confirm": "abcdefgh2"}, None, env)
            self.assertEqual(ss.set_password({"password": "abcdefgh1", "confirm": "abcdefgh1"}, None, env), {"ok": True, "changed": False})
            stored = env.read_text(encoding="utf-8").splitlines()[-1].split("=", 1)[1]
            self.assertTrue(ss.verify_password("abcdefgh1", stored))
            self.assertNotIn("abcdefgh1", env.read_text(encoding="utf-8"))
            with self.assertRaisesRegex(ss.SettingsError, "final"):   # the owner's decision: no changes once set
                ss.set_password({"current": "abcdefgh1", "password": "newpass99", "confirm": "newpass99"}, stored, env)
            self.assertTrue(ss.verify_password("abcdefgh1", env.read_text(encoding="utf-8").splitlines()[-1].split("=", 1)[1]))
            with self.assertRaisesRegex(ss.SettingsError, "Current password is incorrect"):   # if ever reopened
                ss.set_password({"current": "wrong-one", "password": "newpass99", "confirm": "newpass99"}, stored, env, final=False)
            self.assertEqual(ss.set_password({"current": "abcdefgh1", "password": "newpass99", "confirm": "newpass99"}, stored, env, final=False)["changed"], True)


if __name__ == "__main__":
    unittest.main()
