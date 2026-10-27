"""Tests for the PulseDB holdings mapping. Run:  python -m unittest discover -s data-pipeline/tests"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pulse_source import classify, look_through, normalise  # noqa: E402


def row(security, sector="", cap="", rating="", isin="", weight=1.0, coupon=0):
    return {"security": security, "sector": sector, "mkt_cap_category": cap, "rating": rating,
            "isin_security": isin, "holding_perc": weight, "coupon": coupon}


class ClassifyTests(unittest.TestCase):
    def test_every_rule_on_real_examples(self):
        cases = [
            (row("HDFC Bank Ltd", "Banks", "Large Cap", isin="INE040A01034"), "equity"),
            (row("Alphabet Inc", "IT - Software", "Overseas Equity", isin="US02079K3059"), "foreignEquity"),
            (row("Embassy Office Parks REIT", "REIT/InvIT", isin="INE041025011"), "reit"),
            (row("TRP_011026", "Cash/Deposits/Margins/Treps/Repo/Swaps"), "cash"),
            (row("Net Receivables / Payables"), "cash"),
            (row("Export Import Bank of India (14/12/2026)", "Banks", rating="CRISIL A1+", isin="INE514E16CL2"), "debt"),
            (row("91 Days TBILL MAT 171226", "Govt-Sec", isin="IN002025X199"), "debt"),
            (row("Reliance Industries Ltd.", "Commodity", rating="CARE A1+", isin="INE002A14KJ8"), "debt"),
            (row("GOLD .995 1KG BAR", "Commodity"), "gold"),
            (row("SILVER 30KG BAR", "Commodity"), "silver"),
            (row("Axis Gold ETF", "ETF Units", isin="INF846K01W80"), "fund"),
            (row("Kotak Money Market Fund Direct Growth", "Mutual Fund Units", isin="INF174K01NE9"), "fund"),
        ]
        for data, expected in cases:
            self.assertEqual(classify(data), expected, data["security"])

    def test_normalise_keeps_signed_weights_and_cap_class_only_for_equity(self):
        rows = normalise([row("A", "Banks", "Mid Cap", isin="INE1", weight=10), row("Net Receivables", weight=-0.24),
                          row("Bond", "Banks", "Large Cap", rating="AAA", isin="INE2", weight=5), row("Zero", weight=0)])
        self.assertEqual([(r["assetType"], r["marketCap"], r["weight"]) for r in rows],
                         [("equity", "mid", 10.0), ("cash", None, -0.24), ("debt", None, 5.0)])
        # The disclosed rating travels with debt rows only (debt credit quality, Recommendation_Logic.md §4.4).
        self.assertEqual([r["rating"] for r in rows], [None, None, "AAA"])


class LookThroughTests(unittest.TestCase):
    def test_fund_units_are_replaced_by_their_holdings_weighted(self):
        fof = normalise([row("Axis Gold ETF", "ETF Units", isin="INF846K01W80", weight=60),
                         row("Axis Silver ETF", "ETF Units", isin="INF846K011K1", weight=40)])
        inner = {"INF846K01W80": normalise([row("GOLD BAR", "Commodity", weight=98), row("Net Receivables", weight=2)]),
                 "INF846K011K1": normalise([row("SILVER BAR", "Commodity", weight=100)])}
        flat, unresolved = look_through(fof, inner.get)
        self.assertEqual([(r["assetType"], round(r["weight"], 4)) for r in flat], [("gold", 58.8), ("cash", 1.2), ("silver", 40.0)])
        self.assertEqual(unresolved, [])

    def test_unknown_fund_units_become_other_and_are_reported(self):
        flat, unresolved = look_through(normalise([row("CDMDF Class A2", "Mutual Fund Units", isin="INF0RQ622028", weight=0.2)]), lambda isin: None)
        self.assertEqual(([r["assetType"] for r in flat], unresolved), (["other"], ["CDMDF Class A2"]))


if __name__ == "__main__":
    unittest.main()
