"""Tests for benchmark mapping, price checks and files. Run:  python -m unittest discover -s data-pipeline/tests"""

import sys
import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from benchmark_data import (  # noqa: E402
    BenchmarkError, check_history, compare_on, family, from_parquet, object_path, resolve_mapping, sheet_reference, to_parquet,
    two_year_windows, value_text,
)

HEADER = {"A": "SCHEME CODE", "B": "SCHEME NAME", "C": "BENCHMARK", "D": "BENCHMARK CODE", "E": "ALTERNATE BENCHMARK",
          "F": "ALTERNATE BENCHMARK CODE", "G": "FINAL BENCHMARK CODE"}


def scheme(code, plan="Direct", name="Fund"):
    return {"schemeCode": code, "schemeName": name, "plan": plan, "category": "Large Cap Fund"}


def sheet_row(code, final, declared="NIFTY 100 TRI", alt="NIFTY 50 TRI", dcode="OB1", acode="AB2"):
    return {"A": f"{code}.0", "B": "x", "C": declared, "D": dcode, "E": alt, "F": acode, "G": final}


def live_row(code, final, declared="NIFTY 100 TRI", alt="NIFTY 50 TRI"):
    return {"scheme_code": str(code), "final_benchmark": final, "benchmark": declared, "alt_benchmark": alt}


class MappingTests(unittest.TestCase):
    def test_sheet_keeps_only_our_codes_and_checks_columns(self):
        ref = sheet_reference([HEADER, sheet_row(1, "OB1"), sheet_row(99, "OB1")], {1, 2})
        self.assertEqual(list(ref), [1])
        with self.assertRaises(BenchmarkError):
            sheet_reference([{**HEADER, "G": "FINAL"}], {1})
        with self.assertRaises(BenchmarkError):
            sheet_reference([HEADER, sheet_row(1, "OB1"), sheet_row(1, "OB1")], {1})

    def test_resolution_rules(self):
        schemes = [scheme(1), scheme(2), scheme(3), scheme(4), scheme(5)]
        sheet = sheet_reference([HEADER, sheet_row(1, "OB1"), sheet_row(2, "OB7", declared="BSE 100 TRI"), sheet_row(3, "AUB3", alt="CRISIL Liquid Fund Index")], {1, 2, 3, 4, 5})
        live = [live_row(1, "OB1"), live_row(2, "OB9", declared="BSE India Infrastructure TRI"), live_row(4, "AB2")]
        mapping, report = resolve_mapping(schemes, live, sheet)
        f = mapping["funds"]
        self.assertEqual((f["1"]["benchmarkCode"], f["1"]["source"]), ("OB1", "pulse+sheet"))           # agree: verified
        self.assertEqual((f["2"]["benchmarkCode"], f["2"]["source"], f["2"]["sheetCode"]), ("OB9", "pulse", "OB7"))  # differ: Pulse live
        self.assertEqual((f["3"]["benchmarkCode"], f["3"]["source"]), ("AUB3", "sheet"))                # only the sheet
        self.assertEqual((f["4"]["benchmarkCode"], f["4"]["source"]), ("AB2", "pulse"))                 # only Pulse
        self.assertNotIn("5", f)                                                                        # neither
        self.assertEqual([d["schemeCode"] for d in report["differFromSheet"]], [2])
        self.assertEqual([n["schemeCode"] for n in report["noBenchmark"]], [5])
        # names: O… codes by the declared benchmark, A… codes (incl. AUB) by the alternate
        self.assertEqual(f["2"]["benchmarkName"], "BSE India Infrastructure TRI")
        self.assertEqual(f["3"]["benchmarkName"], "CRISIL Liquid Fund Index")
        self.assertEqual(f["4"]["benchmarkName"], "NIFTY 50 TRI")

    def test_name_conflict_is_reported_and_most_used_name_kept(self):
        live = [live_row(1, "OB1", declared="A"), live_row(2, "OB1", declared="A"), live_row(3, "OB1", declared="B")]
        mapping, report = resolve_mapping([scheme(1), scheme(2), scheme(3)], live, {})
        self.assertEqual(mapping["benchmarks"]["OB1"], "A")
        self.assertEqual(report["nameConflicts"], {"OB1": {"A": 2, "B": 1}})

    def test_bad_codes_are_ignored(self):
        mapping, _ = resolve_mapping([scheme(1)], [live_row(1, "")], {})
        self.assertEqual(mapping["funds"], {})


class PriceTests(unittest.TestCase):
    def test_windows_cover_the_range_within_two_years(self):
        w = two_year_windows(date(2015, 1, 1), date(2020, 3, 5))
        self.assertEqual(w[0], (date(2015, 1, 1), date(2016, 12, 31)))
        self.assertEqual(w[-1], (date(2019, 1, 1), date(2020, 3, 5)))
        for (_, end), (start, _) in zip(w, w[1:]):
            self.assertEqual((start - end).days, 1)   # no gap, no overlap
        self.assertEqual(two_year_windows(date(2016, 2, 29), date(2019, 1, 1))[0][1], date(2018, 2, 28))

    def test_values_are_exact(self):
        self.assertEqual(value_text(36541.61), "36541.61")
        self.assertEqual(value_text(5243.2864), "5243.2864")
        self.assertEqual(value_text(100), "100")

    def win(self, start, end, prices, code="OB48"):
        return ((start, end), {"final_benchmark": code, "nav_history": prices})

    def test_history_checks(self):
        ok = check_history("OB48", [self.win(date(2015, 1, 1), date(2016, 12, 31), {"2016-12-30": 100.5, "2016-12-29": 100}),
                                    self.win(date(2017, 1, 1), date(2018, 12, 31), {"2017-01-02": 101.25})])
        self.assertTrue(ok.ok)
        self.assertEqual(ok.rows, [(date(2016, 12, 29), Decimal("100")), (date(2016, 12, 30), Decimal("100.5")), (date(2017, 1, 2), Decimal("101.25"))])
        self.assertIn("returned code", check_history("OB48", [self.win(date(2015, 1, 1), date(2016, 12, 31), {"2016-01-01": 1}, code="OB49")]).reason)
        self.assertIn("outside", check_history("OB48", [self.win(date(2015, 1, 1), date(2015, 12, 31), {"2016-01-01": 1})]).reason)
        self.assertEqual(check_history("OB48", [self.win(date(2015, 1, 1), date(2015, 12, 31), {})]).reason, "no prices")
        dup = check_history("OB48", [self.win(date(2015, 1, 1), date(2016, 12, 31), {"2016-06-01": 10}),
                                     self.win(date(2016, 6, 1), date(2016, 12, 31), {"2016-06-01": 11})])
        self.assertIn("two different values", dup.reason)

    def test_null_price_is_left_out_and_flagged(self):
        c = check_history("AHB13", [self.win(date(2020, 1, 1), date(2020, 12, 31), {"2020-03-02": 100, "2020-03-03": None, "2020-03-04": 101}, code="AHB13")])
        self.assertTrue(c.ok)
        self.assertEqual([d.isoformat() for d, _ in c.rows], ["2020-03-02", "2020-03-04"])
        self.assertTrue(any("without a price" in f and "2020-03-03" in f for f in c.flags))

    def test_spike_left_out_and_lasting_move_kept(self):
        # 180 is a one-day spike (left out); 101 -> 75 (−25.7%) is lasting: kept as published and flagged.
        prices = {"2020-03-02": 100, "2020-03-03": 180, "2020-03-04": 101, "2020-03-05": 75, "2020-03-06": 76}
        c = check_history("OB48", [self.win(date(2020, 1, 1), date(2020, 12, 31), prices)])
        self.assertEqual([d.isoformat() for d, _ in c.rows], ["2020-03-02", "2020-03-04", "2020-03-05", "2020-03-06"])
        self.assertTrue(any("spike" in f for f in c.flags))
        self.assertTrue(any("large move kept as published: -25.7%" in f for f in c.flags))

    def test_real_jump_then_gradual_recovery_is_kept(self):
        # As NIFTY PSU Bank on 25-Oct-2017 (+29.6%): a real level that drifts — never treated as an error.
        prices = {"2017-10-24": 4019.9, "2017-10-25": 5210.82, "2017-10-30": 4900, "2017-11-10": 4300, "2017-11-20": 4150}
        c = check_history("OB84", [self.win(date(2017, 1, 1), date(2017, 12, 31), prices, code="OB84")])
        self.assertEqual(len(c.rows), 5)

    def test_dip_below_the_nav_threshold_is_still_a_spike_for_an_index(self):
        # As seen in Pulse (AHB39, 29-Jun-2026): −46.7% for one day, back the next.
        prices = {"2026-06-25": 100, "2026-06-29": 53.3, "2026-06-30": 100.8}
        c = check_history("AHB39", [self.win(date(2026, 1, 1), date(2026, 12, 31), prices, code="AHB39")])
        self.assertEqual([d.isoformat() for d, _ in c.rows], ["2026-06-25", "2026-06-30"])
        self.assertFalse(any("series break" in f for f in c.flags))

    def test_bad_stretch_of_days_is_left_out_not_a_break(self):
        # As seen in Pulse (AHB24, Feb 2022): −74% for two weeks, then back to the old level.
        prices = {"2022-01-31": 14700, "2022-02-01": 3830, "2022-02-02": 3850, "2022-02-14": 3860, "2022-02-15": 14720, "2022-02-16": 14750}
        c = check_history("AHB24", [self.win(date(2022, 1, 1), date(2022, 12, 31), prices, code="AHB24")])
        self.assertEqual([d.isoformat() for d, _ in c.rows], ["2022-01-31", "2022-02-15", "2022-02-16"])
        self.assertTrue(any("bad stretch left out: 2022-02-01 to 2022-02-14" in f for f in c.flags))
        self.assertFalse(any("series break" in f for f in c.flags))

    def test_price_list_with_fewer_decimals_is_the_same_price(self):
        rows = [(date(2024, 6, 28), Decimal("39118.86"))]
        self.assertTrue(compare_on(rows, date(2024, 6, 28), Decimal("39119")))
        self.assertFalse(compare_on([(date(2020, 12, 31), Decimal("50005"))], date(2020, 12, 31), Decimal("49996")))

    def test_a_real_crash_day_is_kept(self):
        # March 2020: NIFTY 50 fell ~13% in a day — a real move, below the 20% limit.
        prices = {"2020-03-20": 100, "2020-03-23": 87, "2020-03-24": 89}
        c = check_history("OB48", [self.win(date(2020, 1, 1), date(2020, 12, 31), prices)])
        self.assertEqual(len(c.rows), 3)
        self.assertEqual(c.flags, [])

    def test_compare_and_parquet_round_trip(self):
        rows = [(date(2026, 10, 20), Decimal("5243.2864")), (date(2026, 10, 21), Decimal("5250.34"))]
        self.assertTrue(compare_on(rows, date(2026, 10, 21), Decimal("5250.34")))
        self.assertFalse(compare_on(rows, date(2026, 10, 21), Decimal("5250.35")))
        self.assertIsNone(compare_on(rows, date(2026, 10, 19), Decimal("1")))
        self.assertEqual(from_parquet(to_parquet(rows, "AUB2", "CRISIL Composite Bond Fund Index", "t")),
                         [(d, v.quantize(Decimal("0.000001"))) for d, v in rows])

    def test_layout(self):
        self.assertEqual(object_path("AUB3"), "prices/aub/AUB3.parquet")
        self.assertEqual(object_path("OHB66"), "prices/ohb/OHB66.parquet")
        self.assertEqual(family("AHB24"), "ahb")
        with self.assertRaises(BenchmarkError):
            family("X1")


if __name__ == "__main__":
    unittest.main()
