"""Tests for our own benchmarks and the category rules (benchmark_blends.py, MF_Calculation_Engine.md E7.1).
Run:  python -m unittest discover -s data-pipeline/tests"""

import sys
import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from benchmark_blends import (  # noqa: E402
    GOLD_CODE, GOLD_SILVER_CODE, SILVER_CODE, SP500, BlendError, apply_rules, blend_name, blend_rows, build_fund_blend, build_series, component,
    fund_rule, parse_blend,
)
from benchmark_data import STORED_CODE_RE, family, object_path  # noqa: E402

D = [date(2026, 1, d) for d in range(1, 8)]


def scheme(name, category, code=1):
    return {"schemeCode": code, "schemeName": name, "category": category}


class ParseBlend(unittest.TestCase):
    def test_balanced_advantage_blend(self):
        parts = parse_blend("NIFTY 50 Index(50%)+CRISIL Short Term Index(50%)")
        self.assertEqual([(c, w) for c, w, _ in parts], [("OB48", Decimal(50)), ("AUB1", Decimal(50))])
        self.assertEqual(blend_name(parts), "NIFTY 50 50% + CRISIL Short Term Bond 50%")

    def test_multi_asset_blend_with_gold_and_silver(self):
        parts = parse_blend("NIFTY 500 Index(65%)+CRISIL Short Term Bond Fund Index(25%)+Domestic Price of Gold(5%)+Domestic Price of Silver(5%)")
        self.assertEqual([c for c, _, _ in parts], ["OB56", "AUB1", GOLD_CODE, SILVER_CODE])

    def test_decimal_weights_and_name_variants(self):
        parts = parse_blend("NIFTY 50 Index(55%)+CRISIL Short Term Bond Fund Index(30%)+Domestic Price of Gold(7.5%)+Domestic Price of Silver(7.5%)")
        self.assertEqual(sum(w for _, w, _ in parts), Decimal(100))
        self.assertEqual(component("NIFTY Index 500")[0], "OB56")
        self.assertEqual(component("NIFTY 500 TRI")[0], "OB56")
        self.assertEqual(component("INR Price Of Gold")[0], GOLD_CODE)
        self.assertEqual(component("Domestic Price of Physical Gold")[0], GOLD_CODE)
        self.assertEqual(component("CRISIL Short-Term Bond")[0], "AUB1")
        self.assertEqual(component("CRISIL Short Term Bond Fund AII Index")[0], "AUB1")

    def test_index_name_with_a_plus_sign(self):
        parts = parse_blend("CRISIL Hybrid 35+65 - Aggressive Fund Index(90%)+Price of Physical Gold(5%)+Dow Jones(5%)")
        self.assertEqual([c for c, _, _ in parts], ["AUB11", GOLD_CODE, "AUB12"])
        with self.assertRaisesRegex(BlendError, "Hybrid 50"):   # CRISIL Hybrid 50+50 is not a stored index
            parse_blend("CRISIL Hybrid 50+50 Moderate Index(90%)+Domestic Price of Gold(10%)")

    def test_unknown_component_is_not_approximated(self):
        with self.assertRaisesRegex(BlendError, "iCOMDEX"):
            parse_blend("NIFTY 200 Index(65%)+CRISIL Composite Bond Fund Index(25%)+Domestic Price of Gold(6%)"
                        "+Domestic Price of Silver(1%)+iCOMDEX Composite Index(3%)")
        # "gold and silver" in one component has no stated split
        with self.assertRaises(BlendError):
            parse_blend("BSE 500 Index(25%)+Crisil Composite Bond Fund Index(45%)+Domestic prices of Gold and Silver(30%)")

    def test_weights_must_add_up_to_100(self):
        with self.assertRaisesRegex(BlendError, "120"):
            parse_blend("CRISIL Composite Bond Fund Index(40%)+CRISIL Liquid Fund Index(25%)+NIFTY 50 Index(40%)+Domestic price of Gold(15%)")


class BlendRows(unittest.TestCase):
    def test_daily_rebalanced_blend(self):
        a = [(D[0], Decimal(100)), (D[1], Decimal(110)), (D[2], Decimal(99))]
        b = [(D[0], Decimal(50)), (D[1], Decimal(50)), (D[2], Decimal(55))]
        rows = blend_rows([("A", Decimal(60)), ("B", Decimal(40))], {"A": a, "B": b})
        # day 1: 0.6 × 10% + 0.4 × 0% = 6% -> 106; day 2: 0.6 × −10% + 0.4 × 10% = −2% -> 103.88
        self.assertEqual([v for _, v in rows], [Decimal(100), Decimal("106.0"), Decimal("103.880")])

    def test_dates_missing_for_one_component_are_skipped_for_all(self):
        a = [(D[0], Decimal(100)), (D[1], Decimal(105)), (D[2], Decimal(110))]
        b = [(D[0], Decimal(100)), (D[2], Decimal(120))]           # no price on D[1]
        rows = blend_rows([("A", Decimal(50)), ("B", Decimal(50))], {"A": a, "B": b})
        self.assertEqual([d for d, _ in rows], [D[0], D[2]])
        self.assertEqual(rows[-1][1], Decimal(115))               # 0.5 × 10% + 0.5 × 20%

    def test_blend_starts_when_every_component_has_a_price(self):
        a = [(d, Decimal(100 + i)) for i, d in enumerate(D)]
        b = [(d, Decimal(10)) for d in D[3:]]
        self.assertEqual(blend_rows([("A", Decimal(50)), ("B", Decimal(50))], {"A": a, "B": b})[0], (D[3], Decimal(100)))

    def test_build_series_reports_what_cannot_be_built(self):
        gold = [(D[0], Decimal(50)), (D[1], Decimal(55))]
        silver = [(D[0], Decimal(80)), (D[1], Decimal(80))]
        synthetic = {GOLD_CODE: {"name": "g", "components": []},
                     GOLD_SILVER_CODE: {"name": "gs", "components": [[GOLD_CODE, "50"], [SILVER_CODE, "50"]]},
                     "SBAB124": {"name": "x", "components": [["OB48", "50"], ["AUB1", "50"]]}}
        out = build_series(synthetic, {SILVER_CODE: silver}, gold)
        self.assertEqual(out[GOLD_CODE], gold)
        self.assertEqual(out[GOLD_SILVER_CODE][-1][1], Decimal(105))   # 0.5 × 10% + 0.5 × 0%
        self.assertIn("OB48", out["SBAB124"])
        self.assertIn("Gold BeES", build_series({GOLD_CODE: {"name": "g", "components": []}}, {}, None)[GOLD_CODE])


class Rules(unittest.TestCase):
    def test_gold_silver_funds(self):
        self.assertEqual(fund_rule(scheme("Nippon India ETF Gold BeES", "Gold ETF"), None)[0], GOLD_CODE)
        self.assertEqual(fund_rule(scheme("Nippon India Gold Savings Fund", "FoF Domestic"), None)[0], GOLD_CODE)
        self.assertEqual(fund_rule(scheme("Aditya Birla Sun Life Gold ETF", "Equity ETF"), None)[0], GOLD_CODE)   # AMFI files it as equity
        self.assertEqual(fund_rule(scheme("HDFC Silver ETF", "Other ETFs"), None)[0], SILVER_CODE)
        self.assertEqual(fund_rule(scheme("Kotak Gold Silver Passive FOF", "FoF Domestic"), None)[0], GOLD_SILVER_CODE)
        # the AMC name "Mirae Asset" is not a multi-asset fund
        self.assertEqual(fund_rule(scheme("Mirae Asset Gold ETF Fund of Fund", "FoF Domestic"), None)[0], GOLD_CODE)
        self.assertEqual(fund_rule(scheme("Mirae Asset Silver ETF", "Silver ETF"), None)[0], SILVER_CODE)
        self.assertEqual(fund_rule(scheme("Mirae Asset Gold Silver Passive FoF", "FoF Domestic"), None)[0], GOLD_SILVER_CODE)

    def test_gold_mining_and_multi_asset_are_not_gold_price_funds(self):
        self.assertEqual(fund_rule(scheme("DSP World Gold Mining Overseas Equity Omni FoF", "FoF Overseas"), None)[0], SP500)
        self.assertEqual(fund_rule(scheme("Kotak World Gold Fund", "FoF Overseas"), None)[0], SP500)
        self.assertIsNone(fund_rule(scheme("Bandhan Multi-Asset Gold Passive FOF", "FoF Domestic"), {"benchmarkCode": "OB56", "benchmarkName": "NIFTY 500 Index"}))

    def test_overseas_funds(self):
        self.assertEqual(fund_rule(scheme("SBI International Access - US Equity FoF", "FoF Overseas"), {"benchmarkCode": "AUB12", "benchmarkName": "Dow Jones"})[0], SP500)
        self.assertIsNone(fund_rule(scheme("Motilal Oswal Nasdaq 100 FOF", "FoF Overseas"), {"benchmarkCode": "OB39", "benchmarkName": "NASDAQ 100 Index"}))
        self.assertEqual(fund_rule(scheme("Navi NASDAQ100 US Specific Equity Passive FOF", "FoF Overseas"), {"benchmarkCode": "AUB12"})[0], "OB39")
        self.assertIsNone(fund_rule(scheme("Bandhan US Treasury Bond 0-1 year FOF", "FoF Overseas"), {"benchmarkCode": "AUB4"}))
        self.assertEqual(fund_rule(scheme("Invesco India - Invesco Global Equity Income Fund of Fund", "FoF Overseas"), {"benchmarkCode": "AUB12"})[0], SP500)
        self.assertEqual(fund_rule(scheme("Mirae Asset Hang Seng TECH ETF", "ETFs investing overseas"), None)[0], "OB28")
        self.assertEqual(fund_rule(scheme("Mirae Asset NYSE FANG+ ETF", "ETFs investing overseas"), None)[0], SP500)

    def test_owner_choice_comes_first(self):
        dsp = {"benchmarkCode": "OHB71", "benchmarkName": "BSE Oil & Gas Index(35%)+BSE Metal Index(30%)+MSCI World Energy 10/40(35%)"}
        self.assertEqual(fund_rule(scheme("DSP Natural Resources and New Energy Fund", "Sectoral/Thematic"), dsp)[0], "OB318")

    def test_balanced_advantage_and_multi_asset_blends(self):
        baf = {"benchmarkCode": "AB124", "benchmarkName": "NIFTY 50 Index(50%)+CRISIL Short Term Index(50%)"}
        self.assertEqual(fund_rule(scheme("HDFC Balanced Advantage Fund", "Balanced Advantage / Dynamic Asset Allocation"), baf)[0], "SBAB124")
        self.assertEqual(fund_rule(scheme("SBI Dynamic Asset Allocation Active FoF", "FoF Domestic"), baf)[0], "SBAB124")
        single = {"benchmarkCode": "AUB11", "benchmarkName": "CRISIL Hybrid 35+65 - Aggressive Fund Index"}
        self.assertIsNone(fund_rule(scheme("X Balanced Advantage Fund", "Balanced Advantage / Dynamic Asset Allocation"), single))
        # every category with a Pulse blend (Equity Savings, Balanced Hybrid, …), e.g. with NIFTY 50 Arbitrage
        savings = {"benchmarkCode": "AHB5", "benchmarkName": "NIFTY 50 Arbitrage Index(65%)+CRISIL Short Term Bond Fund Index(25%)+NIFTY 50 Index(10%)"}
        self.assertEqual(fund_rule(scheme("X Equity Savings Fund", "Equity Savings"), savings)[0], "SBAHB5")
        self.assertEqual([c for c, _, _ in parse_blend(savings["benchmarkName"])], ["OB49", "AUB1", "OB48"])
        # run again on our own blend: left as it is (its name also carries % weights)
        ours = {"benchmarkCode": "SBAB124", "benchmarkName": "NIFTY 50 50% + CRISIL Short Term Bond 50%"}
        self.assertIsNone(fund_rule(scheme("HDFC Balanced Advantage Fund", "Balanced Advantage / Dynamic Asset Allocation"), ours))

    def test_apply_rules(self):
        mapping = {"funds": {
            "1": {"benchmarkCode": "AB124", "benchmarkName": "NIFTY 50 Index(50%)+CRISIL Short Term Index(50%)"},
            "2": {"benchmarkCode": "AHB77", "benchmarkName": "NIFTY 200 Index(65%)+CRISIL Composite Bond Fund Index(25%)+Domestic Price of Gold(6%)+Domestic Price of Silver(1%)+iCOMDEX Composite Index(3%)"},
            "3": {"benchmarkCode": "OB44", "benchmarkName": "NIFTY 100 Index"}},
            "benchmarks": {"AB124": "x", "AHB77": "y", "OB44": "NIFTY 100 Index"}}
        schemes = [scheme("A Balanced Advantage Fund", "Balanced Advantage / Dynamic Asset Allocation", 1),
                   scheme("B Multi Asset Allocation Fund", "Multi Asset Allocation", 2),
                   scheme("C Large Cap Fund", "Large Cap Fund", 3),
                   scheme("D Gold ETF", "Gold ETF", 4)]
        report = apply_rules(mapping, schemes, {"OB202": "Price of Silver"})
        funds = mapping["funds"]
        self.assertEqual(funds["1"]["benchmarkCode"], "SBAB124")
        self.assertEqual(funds["1"]["pulseCode"], "AB124")
        # its own blend cannot be built (iCOMDEX): the Multi Asset category standard, never a dash
        self.assertEqual((funds["2"]["benchmarkCode"], funds["2"]["rule"].startswith("category standard")), ("SBAHB91", True))
        self.assertEqual(report["notBuilt"], [])
        self.assertEqual(funds["3"]["benchmarkCode"], "OB44")
        self.assertEqual(funds["4"], {"benchmarkCode": GOLD_CODE, "benchmarkName": "Domestic Gold Price (Gold BeES NAV)", "rule": "gold fund", "source": "rule"})
        self.assertEqual(set(mapping["synthetic"]), {"SBAB124", "SBAHB91", GOLD_CODE})
        self.assertEqual(set(mapping["benchmarks"]), {"OB48", "AUB1", "OB56", "AUB2", "OB44"})   # components kept up to date daily

    def test_declared_or_alternate_benchmark_when_the_final_one_cannot_be_built(self):
        sbi = {"benchmarkCode": "AHB93", "benchmarkName": "CRISIL Composite Bond Fund Index(40%)+BSE 500 Index(40%)+Domestic Price of Gold(10%)+Domestic Price of Silver(5%)",
               "declaredBenchmark": "CRISIL Composite Bond Index(40%)+BSE 500 Index(45%)+Domestic Price of Gold(10%)+Domestic Price of Silver(5%)"}
        code, why, spec = build_fund_blend(scheme("SBI Multi Asset Allocation Fund", "Multi Asset Allocation"), sbi, "SBAHB93", {})
        self.assertEqual((code, "declared" in why), ("SBAHB93", True))
        self.assertEqual(spec["components"], [["AUB2", "40"], ["OB102", "45"], [GOLD_CODE, "10"], [SILVER_CODE, "5"]])
        # not a BAF / Multi Asset fund and nothing builds: stays without (listed in the report)
        thematic = {"benchmarkCode": "OHB43", "benchmarkName": "BSE India Infrastructure Index(50%)+BSE India Manufacturing Index(50%)"}
        self.assertIsInstance(build_fund_blend(scheme("X Manufacturing & Infrastructure Fund", "Sectoral/Thematic"), thematic, "SBOHB43", {}), str)


class Codes(unittest.TestCase):
    def test_our_codes_are_stored_under_their_own_family(self):
        for code in ("SBGOLD", "SBGS", "SBAB124", "SBAHB99"):
            self.assertTrue(STORED_CODE_RE.match(code))
        self.assertEqual(family("SBAB124"), "sb")
        self.assertEqual(object_path("SBGOLD"), "prices/sb/SBGOLD.parquet")
        self.assertEqual(family("AB124"), "ab")
        self.assertFalse(STORED_CODE_RE.match("SBX1"))


if __name__ == "__main__":
    unittest.main()
