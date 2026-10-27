"""Tests for NAV history checks, layout and Parquet files. Run:  python -m unittest discover -s data-pipeline/tests"""

import sys
import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from amfi_source import AmfiFormatError, parse_nav_history  # noqa: E402
from nav_history import (  # noqa: E402
    check_layout, from_parquet, merge_daily, object_path, recover_interrupted, same_nav, sha256, slug, to_parquet, validate_history,
)

TODAY = date(2026, 10, 21)
AS_OF = date(2026, 10, 20)
SCHEME = {"schemeCode": 122639, "schemeName": "Parag Parikh Flexi Cap Fund", "amc": "PPFAS Mutual Fund",
          "plan": "Direct", "assetClass": "Equity", "category": "Flexi Cap Fund",
          "isin": "INF879O01027", "isinReinvest": None, "active": True}


def payload(rows, code="122639", isin="INF879O01027", status="SUCCESS"):
    return {"status": status, "meta": {"scheme_code": code, "isin_growth": isin, "isin_div_reinvestment": None},
            "data": [{"date": d, "nav": n} for d, n in rows]}


GOOD = [("20-10-2026", "90.35460"), ("19-10-2026", "90.10000"), ("31-12-2014", "10.00000"), ("02-01-2015", "10.10000")]


class ValidateTests(unittest.TestCase):
    def test_rows_are_exact_sorted_and_from_2015(self):
        checked = validate_history(SCHEME, payload(GOOD), {date(2026, 10, 20): "90.3546", date(2015, 1, 2): "10.1"}, AS_OF, TODAY)
        self.assertTrue(checked.ok, checked.reason)
        self.assertEqual(checked.rows, [(date(2015, 1, 2), Decimal("10.10000")), (date(2026, 10, 19), Decimal("90.10000")),
                                        (date(2026, 10, 20), Decimal("90.35460"))])
        self.assertEqual(checked.flags, [])
        self.assertEqual(checked.verified, 2)

    def test_any_historical_disagreement_with_amfi_rejects(self):
        checked = validate_history(SCHEME, payload(GOOD), {date(2026, 10, 20): "90.3546", date(2015, 1, 2): "10.2"}, AS_OF, TODAY)
        self.assertFalse(checked.ok)
        self.assertIn("NAV on 2015-01-02: MFAPI 10.10000, AMFI 10.2", checked.reason)

    def test_no_common_check_date_is_flagged(self):
        checked = validate_history(SCHEME, payload(GOOD), {date(2020, 12, 31): "50.0"}, AS_OF, TODAY)
        self.assertTrue(checked.ok)
        self.assertIn("not cross-checked", " ".join(checked.flags))

    def test_zero_and_unreadable_navs_are_left_out_and_counted(self):
        checked = validate_history(SCHEME, payload(GOOD + [("05-01-2015", "0.00000"), ("06-01-2015", "N.A.")]), {}, AS_OF, TODAY)
        self.assertTrue(checked.ok)
        self.assertEqual(len(checked.rows), 3)
        self.assertIn("2 row(s) without a valid positive NAV", checked.flags[0])

    def test_rejections(self):
        cases = [
            (payload(GOOD, code="999"), "expected 122639"),
            (payload(GOOD, isin="INF179K01830"), "ISIN mismatch"),
            (payload(GOOD + [("20-10-2026", "91.00000")]), "two different NAVs"),
            (payload(GOOD + [("22-10-2026", "91.00000")]), "future"),
            (payload(GOOD + [("2026/10/18", "91.00000")]), "unreadable date"),
            (payload(GOOD + [("17-10-2026", "91.1234567")]), "more than 6 decimals"),
            (payload([], status="ERROR"), "status"),
        ]
        for data, text in cases:
            checked = validate_history(SCHEME, data, {}, AS_OF, TODAY)
            self.assertFalse(checked.ok, text)
            self.assertIn(text, checked.reason)

    def test_latest_nav_must_agree_with_amfi(self):
        bad = validate_history(SCHEME, payload(GOOD), {date(2026, 10, 20): "90.3547"}, AS_OF, TODAY)
        self.assertFalse(bad.ok)
        self.assertIn("AMFI 90.3547", bad.reason)
        rounded = validate_history(SCHEME, payload(GOOD), {date(2026, 10, 20): "90.354604"}, AS_OF, TODAY)
        self.assertTrue(rounded.ok)
        self.assertIn("rounds", rounded.flags[0])

    def test_flags_never_change_values(self):
        rows = GOOD + [("21-10-2026", "200.00000"), ("20-10-2026", "90.35460")]
        checked = validate_history(SCHEME, payload(rows, isin=None), {date(2026, 10, 21): "200.0000"}, date(2026, 10, 21), TODAY)
        self.assertTrue(checked.ok)
        self.assertEqual(checked.rows[-1], (date(2026, 10, 21), Decimal("200.00000")))
        joined = " | ".join(checked.flags)
        for text in ("prints no ISIN", "exact duplicate", "+121.4%"):
            self.assertIn(text, joined)

    def test_one_day_outlier_is_left_out_but_a_lasting_level_change_is_kept(self):
        spike = [("25-05-2015", "24.85830"), ("26-05-2015", "24.85090"), ("27-05-2015", "42.28420"), ("28-05-2015", "24.78040")]
        face = [("02-05-2018", "24.38610"), ("03-05-2018", "2438.98970"), ("04-05-2018", "2439.37850")]
        checked = validate_history(SCHEME, payload(spike + face), {}, AS_OF, TODAY)
        self.assertTrue(checked.ok)
        self.assertNotIn(date(2015, 5, 27), [d for d, _ in checked.rows])
        self.assertIn(date(2018, 5, 3), [d for d, _ in checked.rows])
        joined = " | ".join(checked.flags)
        self.assertIn("one-day outlier left out: 42.28420 on 2015-05-27", joined)
        self.assertIn("NAV level changed +9901.6% from 2018-05-02 to 2018-05-03 (kept as published)", joined)

    def test_stale_active_scheme_is_flagged(self):
        checked = validate_history(SCHEME, payload(GOOD), {}, date(2026, 11, 5), date(2026, 11, 6))
        self.assertIn("16 days behind AMFI", " ".join(checked.flags))


class DailyMergeTests(unittest.TestCase):
    ROWS = [(date(2026, 10, 16), Decimal("90.884400")), (date(2026, 10, 19), Decimal("90.354600"))]

    def test_new_dates_are_added_exactly(self):
        rows, added, corrected, flags = merge_daily(self.ROWS, {date(2026, 10, 19): "90.3546", date(2026, 10, 20): "90.4100",
                                                                date(2026, 10, 21): "90.5"})
        self.assertEqual(rows[-2:], [(date(2026, 10, 20), Decimal("90.4100")), (date(2026, 10, 21), Decimal("90.5"))])
        self.assertEqual((added, corrected, flags), (2, 0, []))

    def test_fewer_printed_decimals_is_the_same_nav(self):
        rows, added, corrected, flags = merge_daily([(date(2026, 10, 5), Decimal("22.211000"))], {date(2026, 10, 5): "22.21"})
        self.assertEqual((rows, added, corrected, flags), ([(date(2026, 10, 5), Decimal("22.211000"))], 0, 0, []))
        self.assertTrue(same_nav(Decimal("90.354600"), Decimal("90.3546")))
        self.assertFalse(same_nav(Decimal("208.920200"), Decimal("208.9033")))

    def test_a_genuinely_different_stored_nav_is_corrected_to_amfi(self):
        rows, added, corrected, flags = merge_daily(self.ROWS, {date(2026, 10, 19): "91.0000"})
        self.assertEqual((rows[-1], added, corrected), ((date(2026, 10, 19), Decimal("91.0000")), 0, 1))
        self.assertIn("corrected to AMFI's 91.0000 (was 90.354600)", flags[0])

    def test_bad_navs_are_left_out_trailing_zeros_accepted_and_big_moves_flagged(self):
        rows, added, _, flags = merge_daily(self.ROWS, {date(2026, 10, 20): "N.A.", date(2026, 10, 21): "1.1234567",
                                                         date(2026, 10, 22): "200.0", date(2026, 10, 23): "200.43500000"})
        self.assertEqual(rows[-2:], [(date(2026, 10, 22), Decimal("200.0")), (date(2026, 10, 23), Decimal("200.435000"))])
        self.assertEqual(added, 2)
        joined = " | ".join(flags)
        for text in ("printed 'N.A.'", "more than 6 decimals", "level changed"):
            self.assertIn(text, joined)


class InterruptedRunRecoveryTests(unittest.TestCase):
    """A file uploaded by a run that was stopped before writing the manifest (26-Oct-2026: 602 funds)."""
    STORED = [(date(2026, 10, 16), Decimal("90.884400")), (date(2026, 10, 19), Decimal("90.354600"))]
    AMFI = {date(2026, 10, 19): "90.3546", date(2026, 10, 20): "90.4100", date(2026, 10, 23): "91.0000"}

    def file(self, rows):
        return to_parquet(rows, SCHEME, "2026-10-26T00:00:00+00:00")

    def recover(self, rows, last_value="90.354600", row_count=2, points=None):
        return recover_interrupted(self.file(rows), date(2026, 10, 19), last_value, row_count, self.AMFI if points is None else points)

    def test_the_interrupted_runs_own_file_is_adopted(self):
        merged, *_ = merge_daily(self.STORED, self.AMFI)   # exactly what the stopped run wrote
        self.assertEqual(self.recover(merged), merged)

    def test_a_newer_day_amfi_does_not_publish_is_refused(self):
        self.assertIsNone(self.recover(self.STORED + [(date(2026, 10, 21), Decimal("90.5"))]))

    def test_a_newer_day_with_a_different_value_is_refused(self):
        self.assertIsNone(self.recover(self.STORED + [(date(2026, 10, 20), Decimal("90.4200"))]))

    def test_lost_rows_or_a_changed_last_day_are_refused(self):
        self.assertIsNone(self.recover([(date(2026, 10, 19), Decimal("90.354600"))]))                       # fewer rows
        self.assertIsNone(self.recover([(date(2026, 10, 16), Decimal("90.884400")), (date(2026, 10, 20), Decimal("90.41"))]))  # last day gone
        self.assertIsNone(self.recover(self.STORED, last_value="80.000000", points={}))                        # last value changed
        self.assertIsNone(recover_interrupted(b"not a parquet file", date(2026, 10, 19), "90.3546", 2, self.AMFI))

    def test_a_last_day_corrected_to_amfi_is_accepted(self):
        corrected = [(date(2026, 10, 16), Decimal("90.884400")), (date(2026, 10, 19), Decimal("90.354600"))]
        self.assertEqual(self.recover(corrected, last_value="90.350000"), corrected)   # merge_daily corrected it to AMFI's 90.3546


class AmfiHistoryReportTests(unittest.TestCase):
    REPORT = "\n".join([
        "Scheme Code;NAV Name;Plan;Option;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Date", "",
        "Open Ended Schemes ( Equity Scheme - Flexi Cap Fund )", "", "PPFAS Mutual Fund",
        "122639;Parag Parikh Flexi Cap Fund - Direct Plan - Growth;Direct Plan;Growth;INF879O01027;;90.3546;19-Oct-2026",
        "122639;Parag Parikh Flexi Cap Fund - Direct Plan - Growth;Direct Plan;Growth;INF879O01027;;90.8844;16-Oct-2026",
        "122640;Some Fund;Direct Plan;Growth;INF879O01035;;N.A.;19-Oct-2026",
    ])

    def test_points_are_exact_and_header_mapped(self):
        self.assertEqual(parse_nav_history(self.REPORT), {(122639, date(2026, 10, 19)): "90.3546",
                                                          (122639, date(2026, 10, 16)): "90.8844"})

    def test_conflicting_or_changed_report_stops(self):
        with self.assertRaisesRegex(AmfiFormatError, "two NAVs"):
            parse_nav_history(self.REPORT + "\n122639;X;Direct Plan;Growth;INF879O01027;;91.0;19-Oct-2026")
        with self.assertRaisesRegex(AmfiFormatError, "header changed"):
            parse_nav_history(self.REPORT.replace("Net Asset Value", "NAV"))


class LayoutTests(unittest.TestCase):
    def test_paths(self):
        self.assertEqual(object_path(SCHEME), "nav/direct/equity/flexi-cap-fund/122639.parquet")
        self.assertEqual(slug("Balanced Advantage / Dynamic Asset Allocation"), "balanced-advantage-dynamic-asset-allocation")
        self.assertEqual(slug("Large & Mid Cap Fund"), "large-and-mid-cap-fund")
        self.assertEqual(object_path({**SCHEME, "plan": "ETF", "assetClass": "Other", "category": "Gold ETF"}),
                         "nav/etf/other/gold-etf/122639.parquet")

    def test_two_categories_never_share_a_folder(self):
        with self.assertRaisesRegex(ValueError, "would mix"):
            check_layout([SCHEME, {**SCHEME, "schemeCode": 1, "category": "Flexi-Cap Fund"}])


class ParquetTests(unittest.TestCase):
    def test_round_trip_is_exact_and_deterministic(self):
        rows = [(date(2015, 1, 2), Decimal("10.10000")), (date(2026, 10, 20), Decimal("1234.567891"))]
        data = to_parquet(rows, SCHEME, "2026-10-21T00:00:00+00:00")
        self.assertEqual(from_parquet(data), rows)
        self.assertEqual(sha256(data), sha256(to_parquet(rows, SCHEME, "2026-10-21T00:00:00+00:00")))


if __name__ == "__main__":
    unittest.main()
