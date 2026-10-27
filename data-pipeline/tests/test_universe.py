"""Tests for the fund-universe build. Run:  python -m unittest discover -s data-pipeline/tests"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from amfi_source import AmfiFormatError, parse_nav_file, parse_scheme_master  # noqa: E402
from build_universe import build, resolve  # noqa: E402
from scheme_lists import ListError, check, read_lists, write_lists  # noqa: E402
from universe_rules import (  # noqa: E402
    Excluded, Included, UnknownSectionError, classify, is_valid_isin, plan_option_from_nav_name,
)

HEADER = "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date"


def amfi_file(*blocks: str) -> str:
    return "\n".join([HEADER, "", *blocks, ""])


SAMPLE = amfi_file(
    "Open Ended Schemes(Equity Scheme - Flexi Cap Fund)", "", "HDFC Mutual Fund", "",
    "118955;INF179K01UT0;-;HDFC Flexi Cap Fund;Direct Plan;Growth Option;2000.50;20-Oct-2026",
    "101762;INF179K01608;-;HDFC Flexi Cap Fund;Regular Plan;GROWTH;1900.10;20-Oct-2026",
    "101763;INF179K01616;INF179K01624;HDFC Flexi Cap Fund;Regular Plan;IDCW Option;80.10;20-Oct-2026",
    "Open Ended Schemes(Equity Schemes - Flexi Cap Fund)", "", "Abakkus Mutual Fund", "",
    "154041;INF2JJD01169;-;Abakkus Flexi Cap Fund;Regular Plan;Growth;10.53;20-Oct-2026",
    "Open Ended Schemes(Exchange Traded Funds (ETFs) - Equity ETF)", "", "Zerodha Mutual Fund", "",
    "150001;INF0R8F01050;-;Zerodha Nifty 50 ETF;Direct Plan;;25.10;20-Oct-2026",
    "Open Ended Schemes(Debt Scheme - Liquid Fund)", "", "Old Mutual Fund", "",
    "100001;INF846K01EW2;-;Old Liquid Fund;Regular Plan;Growth;1000.00;01-Jan-2024",
)


def row(section: str, name: str = "X Fund", plan: str = "Regular Plan", option: str = "Growth"):
    text = amfi_file(section, "", "Test Mutual Fund", "", f"1;-;-;{name};{plan};{option};10.0;20-Oct-2026")
    return parse_nav_file(text)[0]


class ParseTests(unittest.TestCase):
    def test_columns_are_mapped_by_header(self):
        rows = parse_nav_file(SAMPLE)
        self.assertEqual(len(rows), 6)
        first = rows[0]
        self.assertEqual((first.scheme_code, first.plan, first.option, first.nav), (118955, "Direct Plan", "Growth Option", 2000.50))
        self.assertEqual((first.amc, first.isin_growth, first.isin_reinvest), ("HDFC Mutual Fund", "INF179K01UT0", None))
        self.assertEqual(first.nav_date.isoformat(), "2026-10-20")

    def test_changed_header_stops_the_build(self):
        with self.assertRaises(AmfiFormatError):
            parse_nav_file(SAMPLE.replace("Net Asset Value", "NAV"))

    def test_duplicate_scheme_code_stops_the_build(self):
        text = SAMPLE + "118955;-;-;Dup;Direct Plan;Growth;1;20-Oct-2026\n"
        with self.assertRaises(AmfiFormatError):
            parse_nav_file(text)

    def test_zero_or_na_nav_is_none(self):
        text = amfi_file("Open Ended Schemes(Debt Scheme - Liquid Fund)", "", "A MF", "", "2;-;-;Y;Regular Plan;Growth;N.A.;20-Oct-2026")
        self.assertIsNone(parse_nav_file(text)[0].nav)


class ClassifyTests(unittest.TestCase):
    LARGE = "Open Ended Schemes(Equity Scheme - Large Cap Fund)"

    def test_growth_spellings_and_plans(self):
        for option in ("Growth", "Growth Option", "GROWTH OPTION", "GROWTH Option", "(Growth)", "Cumulative", "Growth Option Option", "Regular Growth"):
            self.assertEqual(classify(row(self.LARGE, option=option)), Included("Equity", "Large Cap Fund", "Regular", "Growth"), option)
        self.assertEqual(classify(row(self.LARGE, plan="Direct Plan")).plan, "Direct")

    def test_income_distribution_options_are_out(self):
        for option in ("IDCW Option", "IDWC Option", "Dividend Payout", "Income Distribution cum Capital Withdrawal", "Monthly - Income Distribution cum capital withdrawal"):
            self.assertIsInstance(classify(row(self.LARGE, option=option)), Excluded, option)

    def test_special_purpose_plans_are_out(self):
        for option in ("Unclaimed Redemption Plan - Growth", "Institutional Plan-Growth Option", "Retail Plan Growth",
                       "Discontinued Growth", "Defunct Growth", "SG 1 Regular Growth", "Super Institutional Growth", "Bonus"):
            self.assertIsInstance(classify(row(self.LARGE, option=option)), Excluded, option)
        self.assertIsInstance(classify(row(self.LARGE, name="UTI Credit Risk Fund (Segregated - 06032020)")), Excluded)

    def test_a_name_containing_retail_is_not_excluded(self):
        self.assertIsInstance(classify(row(self.LARGE, name="ABC Retail Opportunities Fund")), Included)

    def test_main_fund_mentioning_side_pockets_stays_in(self):
        for name in ("Nippon India Credit Risk Fund (Existing Number of Segregated Portfolios - 1)",
                     "Franklin India Credit Risk Fund (No. of segregated portfolios-3)",
                     "Baroda BNP Paribas Short Term Fund (the scheme has 2 segregated portfolios)"):
            self.assertIsInstance(classify(row(self.LARGE, name=name)), Included, name)
        for name in ("UTI - Credit Risk Fund (Segregated - 06032020)", "UTI - Bond Fund ( Segregated - 17022020 )",
                     "Nippon India Credit Risk Fund - Segregated Portfolio 1"):
            self.assertIsInstance(classify(row(self.LARGE, name=name)), Excluded, name)

    def test_plan_printed_in_the_option_column_is_used(self):
        self.assertEqual(classify(row(self.LARGE, plan="", option="Direct Growth")).plan, "Direct")
        self.assertEqual(classify(row(self.LARGE, plan="", option="Regular Growth")).plan, "Regular")
        self.assertEqual(classify(row(self.LARGE, plan="", option="Growth")), Excluded("plan not stated"))

    def test_plan_must_be_stated_and_consistent(self):
        self.assertEqual(classify(row(self.LARGE, plan="")), Excluded("plan not stated"))
        self.assertEqual(classify(row(self.LARGE, option="")), Excluded("option not stated"))
        self.assertIsInstance(classify(row(self.LARGE, plan="Regular Plan", option="Direct Growth")), Excluded)

    def test_etfs_are_single_class(self):
        etf = "Open Ended Schemes(Exchange Traded Funds (ETFs) - Gold ETF)"
        self.assertEqual(classify(row(etf, plan="", option="")), Included("Other", "Gold ETF", "ETF", "ETF"))
        self.assertEqual(classify(row(etf, plan="Direct Plan", option="")).plan, "ETF")
        self.assertIsInstance(classify(row(etf, plan="", option="IDCW")), Excluded)

    def test_both_naming_systems_unify_only_exact_duplicates(self):
        old = classify(row("Open Ended Schemes(Equity Scheme - ELSS)"))
        new = classify(row("Open Ended Schemes(Equity Schemes - ELSS- Tax Saver Fund)"))
        self.assertEqual((old.category, new.category), ("ELSS (Tax Saver)", "ELSS (Tax Saver)"))
        short_old = classify(row("Open Ended Schemes(Debt Scheme - Short Duration Fund)"))
        short_new = classify(row("Open Ended Schemes(Income/Debt Oriented Schemes - Short Term Fund)"))
        self.assertNotEqual(short_old.category, short_new.category)

    def test_scope(self):
        self.assertEqual(classify(row("Open Ended Schemes(Solution Oriented Scheme - Retirement Fund)")).asset_class, "Solution Oriented")
        self.assertEqual(classify(row("Open Ended Schemes(Childrenâs Fund - Childrens' Fund)")).category, "Children's Fund")
        self.assertIsInstance(classify(row("Open Ended Schemes(Life Cycle Funds - Life Cycle Fund with Maturity of 5 Years)")), Excluded)
        # A new maturity AMFI adds later (seen 22-Oct-2026: 30 Years) is a Life Cycle fund too — out, not a stop.
        self.assertIsInstance(classify(row("Open Ended Schemes(Life Cycle Funds - Life Cycle Fund with Maturity of 30 Years)")), Excluded)
        self.assertEqual(classify(row("Close Ended Schemes(Debt Scheme - FMP)")), Excluded("not an open-ended scheme"))

    def test_unknown_heading_stops_the_build(self):
        with self.assertRaises(UnknownSectionError):
            classify(row("Open Ended Schemes(Equity Scheme - Brand New Category)"))

    def test_isin_check_digit(self):
        for isin in ("INF846K01EW2", "US0378331005", "INE002A01018"):
            self.assertTrue(is_valid_isin(isin), isin)
        self.assertFalse(is_valid_isin("INF846K01EW3"))
        self.assertFalse(is_valid_isin(None))


class BuildTests(unittest.TestCase):
    def test_build_contents(self):
        schemes, report = build(SAMPLE, None, [])
        self.assertEqual({s["schemeCode"]: f"{s['plan']}/{s['active']}" for s in schemes},
                         {118955: "Direct/True", 101762: "Regular/True", 154041: "Regular/True",
                          150001: "ETF/True", 100001: "Regular/False"})  # IDCW row excluded; stale NAV -> inactive
        self.assertEqual({s["category"] for s in schemes if s["schemeCode"] in (101762, 154041)}, {"Flexi Cap Fund"})
        self.assertEqual([e["reason"] for e in report["exclusions"]], ["IDCW / dividend option"])
        self.assertEqual((report["dataAsOf"], report["inUniverse"], report["active"]), ("2026-10-20", 5, 4))

    def test_rerun_is_idempotent_and_missing_codes_stay_inactive(self):
        first, _ = build(SAMPLE, None, [])
        again, _ = build(SAMPLE, None, first)
        self.assertEqual(again, first)
        without = SAMPLE.replace("154041;INF2JJD01169;-;Abakkus Flexi Cap Fund;Regular Plan;Growth;10.53;20-Oct-2026\n", "")
        later, report = build(without, None, first)
        self.assertEqual(len(later), 5)
        self.assertEqual([s["active"] for s in later if s["schemeCode"] == 154041], [False])
        self.assertEqual(report["carriedInactive"], 1)

    def test_unknown_heading_stops_before_anything_is_built(self):
        with self.assertRaises(UnknownSectionError):
            build(amfi_file("Open Ended Schemes(Equity Scheme - Brand New Category)", "", "A MF", "",
                            "9;-;-;Z;Regular Plan;Growth;1;20-Oct-2026"), None, [])


class ListTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name) / "schemes"

    def tearDown(self):
        self.tmp.cleanup()

    def read(self, name):
        return json.loads((self.out / name).read_text(encoding="utf-8"))

    def test_regular_direct_and_etf_are_written_apart_and_read_back(self):
        schemes, _ = build(SAMPLE, None, [])
        self.assertEqual(write_lists("2026-10-20", schemes, self.out), {"Regular": 3, "Direct": 1, "ETF": 1})
        regular = self.read("regular.json")
        self.assertEqual((regular["plan"], regular["dataAsOf"], regular["count"]), ("Regular", "2026-10-20", 3))
        self.assertEqual([s["schemeCode"] for s in regular["schemes"]], [100001, 101762, 154041])
        self.assertEqual(self.read("direct.json")["schemes"], [{
            "schemeCode": 118955, "schemeName": "HDFC Flexi Cap Fund", "amc": "HDFC Mutual Fund",
            "assetClass": "Equity", "category": "Flexi Cap Fund", "isin": "INF179K01UT0",
            "isinReinvest": None, "active": True,
        }])
        self.assertEqual(sorted(read_lists(self.out), key=lambda s: s["schemeCode"]), sorted(schemes, key=lambda s: s["schemeCode"]))

    def test_isin_shared_by_two_schemes_stops_the_write(self):
        schemes, _ = build(SAMPLE, None, [])
        schemes = [{**s, "isin": "INF179K01UT0"} if s["schemeCode"] == 154041 else s for s in schemes]
        with self.assertRaisesRegex(ListError, "INF179K01UT0 belongs to both"):
            write_lists("2026-10-20", schemes, self.out)
        self.assertFalse(self.out.exists())  # nothing written

    def test_bad_check_digit_stops_the_write(self):
        schemes, _ = build(SAMPLE, None, [])
        schemes = [{**s, "isinReinvest": "INF179K01UT1"} if s["schemeCode"] == 118955 else s for s in schemes]
        with self.assertRaisesRegex(ListError, "fails the check digit"):
            check(schemes)

MASTER_HEADER = "AMC,Code,Scheme Name,Scheme Type,Scheme Category,Scheme NAV Name,Scheme Minimum Amount,Launch Date, Closure Date,ISIN Div Payout/ ISIN GrowthISIN Div Reinvestment"


def master_csv(*rows):
    """rows: (code, scheme name, NAV name, launch date)."""
    return "\n".join([MASTER_HEADER, *[f'X AMC,{c},"{n}",Open Ended,Equity Scheme - Value Fund,"{nav}",1000,{d},,INF000000000'
                                         for c, n, nav, d in rows]])


class MasterTests(unittest.TestCase):
    VALUE = "Open Ended Schemes(Equity Scheme - Value Fund)"

    def one(self, name, plan, option, nav_name):
        r = row(self.VALUE, name=name, plan=plan, option=option)
        return classify(r, parse_scheme_master(master_csv((1, name, nav_name, "01-Jan-2015")))[1])

    def test_blank_columns_are_filled_from_the_master(self):
        self.assertEqual(self.one("ABSL Value Fund", "", "", "ABSL Value Fund - Growth - Direct Plan"),
                         Included("Equity", "Value Fund", "Direct", "Growth", "master"))
        self.assertEqual(self.one("ABSL Value Fund", "Regular Plan", "", "ABSL Value Fund - Regular - Growth").plan, "Regular")

    def test_master_idcw_or_unclear_wording_is_excluded(self):
        self.assertIsInstance(self.one("X Fund", "", "", "X Fund - Direct - IDCW"), Excluded)
        self.assertEqual(self.one("X Fund", "", "", "X Fund - Growth"), Excluded("plan not stated"))
        self.assertEqual(self.one("X Fund", "", "", "X Fund - Regular Plan"), Excluded("option not stated"))

    def test_fund_named_dividend_yield_is_not_the_dividend_option(self):
        self.assertEqual(plan_option_from_nav_name("SBI Dividend Yield Fund - Direct Plan - Growth", "SBI Dividend Yield Fund"),
                         ("Direct", "Growth"))

    def test_printed_columns_are_never_overridden(self):
        self.assertEqual(self.one("X Fund", "Regular Plan", "Growth", "X Fund - Direct - IDCW"),
                         Included("Equity", "Value Fund", "Regular", "Growth", "daily"))

    def test_main_plan_named_institutional_is_used_only_without_a_plain_growth_line(self):
        section = "Open Ended Schemes(Debt Scheme - Liquid Fund)"
        text = amfi_file(section, "", "Franklin Templeton Mutual Fund", "",
                         "100538;-;-;Franklin India Liquid Fund;Regular Plan;Growth;1;20-Oct-2026",
                         "100546;-;-;Franklin India Liquid Fund;Regular Plan;Super Institutional Growth;1;20-Oct-2026",
                         "118577;-;-;Franklin India Liquid Fund;Direct Plan;Super Institutional Growth;1;20-Oct-2026")
        included, excluded, _ = resolve(parse_nav_file(text), {})
        self.assertEqual(sorted((r.scheme_code, v.plan) for r, v in included), [(100538, "Regular"), (118577, "Direct")])
        self.assertEqual([r.scheme_code for r, _ in excluded], [100546])

    def test_master_filled_line_never_duplicates_a_printed_line(self):
        text = amfi_file(self.VALUE, "", "X AMC", "",
                         "1;-;-;X Fund;Regular Plan;Growth;1;20-Oct-2026",
                         "2;-;-;X Fund;;;1;20-Oct-2026")
        master = parse_scheme_master(master_csv((2, "X Fund", "X Fund - Regular - Growth", "01-Jan-2015")))
        included, excluded, _ = resolve(parse_nav_file(text), master)
        self.assertEqual([r.scheme_code for r, _ in included], [1])
        self.assertTrue(excluded[0][1].reason.startswith("duplicate"))

    def test_disagreements_between_the_two_files_are_reported(self):
        text = amfi_file(self.VALUE, "", "X AMC", "", "7;-;-;X Fund;Regular Plan;Growth;1;20-Oct-2026")
        master = parse_scheme_master(master_csv((7, "X Fund", "X Fund - IDCW Plan", "01-Jan-2015")))
        included, _, warnings = resolve(parse_nav_file(text), master)
        self.assertEqual(len(included), 1)
        self.assertEqual(len(warnings), 1)

    def test_fund_name_punctuation_differences_are_ignored(self):
        self.assertEqual(plan_option_from_nav_name("UTI-Dividend Yield Fund.-Growth-Direct", "UTI - Dividend Yield Fund"),
                         ("Direct", "Growth"))

    def test_master_identifies_side_pockets_and_mislabelled_lines_among_duplicates(self):
        text = amfi_file(self.VALUE, "", "X AMC", "",
                         "11;-;-;X Fund;Regular Plan;Growth;1;20-Oct-2026",
                         "12;-;-;X Fund;Regular Plan;Growth;1;20-Oct-2026",
                         "13;-;-;X Fund;Regular Plan;Growth;1;20-Oct-2026")
        master = parse_scheme_master(master_csv((11, "X Fund", "X Fund - Regular Plan - Growth", "01-Jan-2015"),
                                                (12, "X Fund - Segregated Portfolio 1", "X Fund - Segregated Portfolio 1 - Growth Plan", "01-Jan-2015"),
                                                (13, "X Fund", "X Fund - Regular Plan - IDCW", "01-Jan-2015")))
        included, excluded, warnings = resolve(parse_nav_file(text), master)
        self.assertEqual([r.scheme_code for r, _ in included], [11])
        self.assertEqual(sorted(r.scheme_code for r, _ in excluded), [12, 13])

    def test_a_funds_only_growth_line_is_never_dropped(self):
        text = amfi_file(self.VALUE, "", "X AMC", "", "21;-;-;X Fund;Direct Plan;Growth;1;20-Oct-2026")
        master = parse_scheme_master(master_csv((21, "X Fund", "X Fund - Super Institutional - Direct - Growth", "01-Jan-2015")))
        included, _, warnings = resolve(parse_nav_file(text), master)
        self.assertEqual([r.scheme_code for r, _ in included], [21])
        self.assertEqual(len(warnings), 1)

    def test_legacy_plan_without_plan_wording_gives_way_to_the_explicit_regular_plan(self):
        text = amfi_file(self.VALUE, "", "X AMC", "",
                         "31;-;-;X Liquid Fund;Regular Plan;Growth;4065;20-Oct-2026",
                         "32;-;-;X Liquid Fund;Regular Plan;Growth;2817;20-Oct-2026")
        master = parse_scheme_master(master_csv((31, "X Liquid Fund", "X Liquid Fund - Growth", "01-Jan-2002"),
                                                (32, "X Liquid Fund", "X Liquid Fund - Regular Growth", "01-Jan-2002")))
        included, excluded, warnings = resolve(parse_nav_file(text), master)
        self.assertEqual([r.scheme_code for r, _ in included], [32])
        self.assertTrue(excluded[0][1].reason.startswith("legacy plan"))
        self.assertEqual(warnings, [])

    def test_a_side_pocket_is_excluded_even_when_it_is_the_only_line(self):
        text = amfi_file(self.VALUE, "", "X AMC", "", "41;-;-;X Fund (No. of segregated portfolios-3);Direct Plan;Growth;1;20-Oct-2026")
        master = parse_scheme_master(master_csv((41, "X Fund", "X Fund - Segregated Portfolio 3 (Bond CO 23Dec21) - Direct Growth Plan", "01-Jan-2015")))
        included, excluded, _ = resolve(parse_nav_file(text), master)
        self.assertEqual(included, [])
        self.assertIn("segregated portfolio", excluded[0][1].reason)

    def test_names_that_differ_between_the_two_files_are_reported(self):
        text = amfi_file(self.VALUE, "", "X AMC", "", "51;-;-;X Medium Term Fund;Regular Plan;Growth;1;20-Oct-2026")
        master = parse_scheme_master(master_csv((51, "X Short Term Fund", "X Short Term Fund - Regular Plan - Growth", "01-Jan-2015")))
        _, _, warnings = resolve(parse_nav_file(text), master)
        self.assertTrue(any("name it differently" in w for w in warnings))

    def test_master_fills_a_blank_plan_and_the_scheme_is_listed(self):
        schemes, report = build(amfi_file(self.VALUE, "", "X AMC", "", "7;-;-;X Fund;;;1;20-Oct-2026"),
                                master_csv((7, "X Fund", "X Fund - Direct Plan - Growth", "05-Mar-2016")), [])
        self.assertEqual([(s["schemeCode"], s["plan"]) for s in schemes], [(7, "Direct")])
        self.assertEqual(report["plansFromSchemeMaster"], 1)


if __name__ == "__main__":
    unittest.main()
