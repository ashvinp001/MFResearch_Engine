"""Tests for the peer statistics (Recommendation_Logic.md §2). Run:  python -m unittest discover -s data-pipeline/tests"""

import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from peer_stats import (  # noqa: E402
    MIN_PEERS, Series, attach_benchmarks, benchmark_figures, drawdown_3y, fund_figures, last_completed_month_end, month_ends, nav_on, peer_statistics,
    period_start, quartile, sharpe_3y, trailing,
)

T = date(2026, 10, 21)


def growth_series(rate, start=date(2015, 1, 1), end=T, skip=()):
    """A NAV growing at exactly `rate` a year (365-day compounding) on every calendar day."""
    rows, d = [], start
    while d <= end:
        if d not in skip:
            rows.append((d, 100 * (1 + rate) ** ((d - start).days / 365)))
        d += timedelta(days=1)
    return Series(rows)


class LookupTests(unittest.TestCase):
    def test_period_start_clamps_to_month_end(self):
        self.assertEqual(period_start(date(2024, 3, 31), 1), date(2024, 2, 29))
        self.assertEqual(period_start(date(2024, 2, 29), 12), date(2023, 2, 28))
        self.assertEqual(period_start(date(2026, 10, 21), 36), date(2023, 10, 21))
        self.assertEqual(period_start(date(2026, 1, 15), 1), date(2025, 12, 15))

    def test_nav_on_steps_at_most_ten_days(self):
        gap = {date(2020, 1, 1) - timedelta(days=k) for k in range(11)}
        series = growth_series(0.1, skip=gap)
        self.assertIsNone(nav_on(series, date(2020, 1, 1), "previous"))
        self.assertEqual(nav_on(series, date(2020, 1, 1), "next")[0], date(2020, 1, 2))
        self.assertEqual(nav_on(series, date(2019, 12, 31), "previous")[0], date(2019, 12, 21))

    def test_month_ends(self):
        self.assertEqual(last_completed_month_end(T), date(2026, 9, 30))
        self.assertEqual(month_ends(date(2026, 3, 31), 3), [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31)])

    def test_quartile_is_the_excel_formula(self):
        self.assertEqual([quartile(r, 10) for r in range(1, 11)], [1, 1, 1, 2, 2, 3, 3, 3, 4, 4])
        self.assertEqual([quartile(r, 5) for r in range(1, 6)], [1, 1, 2, 3, 4])


class FundFigureTests(unittest.TestCase):
    def test_cagr_on_actual_days(self):
        series = growth_series(0.12)
        anchor = (series.dates[-1], series.navs[-1])
        self.assertAlmostEqual(trailing(series, anchor, 36), 0.12, places=10)
        self.assertAlmostEqual(trailing(series, anchor, 60), 0.12, places=10)
        # 1Y is simple: exactly 365 days back here, so the same 12%.
        self.assertAlmostEqual(trailing(series, anchor, 12), 0.12, places=10)

    def test_no_history_is_none_never_zero(self):
        series = growth_series(0.12, start=date(2025, 1, 1))
        anchor = (series.dates[-1], series.navs[-1])
        self.assertIsNone(trailing(series, anchor, 36))
        self.assertIsNone(sharpe_3y(series, anchor, None))
        self.assertEqual(drawdown_3y(series, anchor), (None, None))
        f = fund_figures(series, month_ends(last_completed_month_end(T), 24))
        self.assertIsNone(f["r3y"])
        self.assertIsNone(f["r5y"])
        self.assertEqual(f["rolling"], {})
        self.assertIsNotNone(f["r1y"])

    def test_sharpe_by_hand(self):
        # NAV flat within each month; month k moves by +2% / −1% alternately -> 36 month-end returns,
        # 18 of +0.02 and 18 of −0.01: mean 0.005, sample variance 36 × 0.015² / 35.
        rows, d, nav, month = [], date(2022, 1, 1), 100.0, 0
        while d <= T:
            if d.month != month:
                month = d.month
                nav *= 1.02 if d.month % 2 else 0.99
            rows.append((d, nav))
            d += timedelta(days=1)
        series = Series(rows)
        sd = (36 * 0.015 ** 2 / 35) ** 0.5 * 12 ** 0.5
        self.assertAlmostEqual(sharpe_3y(series, (series.dates[-1], series.navs[-1]), 0.12), (0.12 - 0.065) / sd, places=9)
        self.assertIsNone(sharpe_3y(series, (series.dates[-1], series.navs[-1]), None))

    def test_drawdown_and_worst_day(self):
        days = [T - timedelta(days=4 * 365) + timedelta(days=k) for k in range(4 * 365 + 1)]
        navs = [100.0] * len(days)
        i = len(days) - 100
        navs[i:] = [120.0] * (len(days) - i)
        navs[i + 10:] = [90.0] * (len(days) - i - 10)
        navs[i + 20:] = [130.0] * (len(days) - i - 20)
        series = Series(list(zip(days, navs)))
        deepest, worst = drawdown_3y(series, (days[-1], navs[-1]))
        self.assertAlmostEqual(deepest, 90 / 120 - 1)
        self.assertAlmostEqual(worst, 90 / 120 - 1)


class BenchmarkFigureTests(unittest.TestCase):
    def test_benchmark_is_anchored_at_the_fund_date(self):
        bench = growth_series(0.10)                       # prices to T (21-Oct-2026)
        f = benchmark_figures(bench, date(2026, 9, 30))   # fund's latest NAV is older: same period as the fund
        self.assertEqual(f["anchorDate"], "2026-09-30")
        self.assertAlmostEqual(f["r3y"], 10.0, places=3)
        self.assertAlmostEqual(f["r1y"], 10.0, places=3)

    def test_no_benchmark_price_near_the_fund_date(self):
        bench = growth_series(0.10, end=date(2026, 9, 1))
        self.assertIsNone(benchmark_figures(bench, date(2026, 10, 21)))   # 50 days apart: beyond the 10-day lookup

    def test_attach(self):
        funds = {"1": {"navDate": "2026-10-21"}, "2": {"navDate": "2026-10-21"}, "3": {"navDate": "2026-10-21"}}
        mapping = {"funds": {"1": {"benchmarkCode": "OB48", "benchmarkName": "NIFTY 50"}, "2": {"benchmarkCode": "OB26"}}}
        self.assertEqual(attach_benchmarks(funds, mapping, {"OB48": growth_series(0.1), "OB56": growth_series(0.12)}, "NIFTY 500"), 1)
        self.assertEqual((funds["1"]["benchmark"]["code"], funds["1"]["benchmark"]["name"]), ("OB48", "NIFTY 50"))
        self.assertAlmostEqual(funds["3"]["market"]["r3y"], 12.0, places=3)   # the market is there for every fund
        self.assertEqual(funds["3"]["market"]["name"], "NIFTY 500")
        self.assertIsNone(funds["2"]["benchmark"])        # mapped, but that benchmark was not stored
        self.assertIsNone(funds["3"]["benchmark"])        # not mapped

    def test_pulse_made_blend_is_not_used(self):
        funds = {"1": {"navDate": "2026-10-21"}}
        mapping = {"funds": {"1": {"benchmarkCode": "AB124", "benchmarkName": "NIFTY 50 Index(50%)+CRISIL Short Term Index(50%)"}}}
        self.assertEqual(attach_benchmarks(funds, mapping, {"AB124": growth_series(0.1)}), 0)
        self.assertIsNone(funds["1"]["benchmark"])
        self.assertEqual(funds["1"]["benchmarkExcluded"]["code"], "AB124")
        # official single (hybrid) indices are used
        funds = {"1": {"navDate": "2026-10-21"}}
        mapping = {"funds": {"1": {"benchmarkCode": "AUB11", "benchmarkName": "CRISIL Hybrid 35+65 - Aggressive Fund Index"}}}
        self.assertEqual(attach_benchmarks(funds, mapping, {"AUB11": growth_series(0.1)}), 1)


class PeerTests(unittest.TestCase):
    ENDS = month_ends(last_completed_month_end(T), 24)

    def figures(self, rates):
        return {code: fund_figures(growth_series(rate), self.ENDS) for code, rate in rates.items()}

    def test_median_rank_quartile_and_consistency(self):
        rates = {1: 0.10, 2: 0.12, 3: 0.14, 4: 0.16, 5: 0.18, 6: 0.20}
        groups, funds = peer_statistics(self.figures(rates), {c: "Direct|Equity|Mid Cap Fund" for c in rates}, self.ENDS)
        g = groups["Direct|Equity|Mid Cap Fund"]
        self.assertEqual(g["n"]["r3y"], 6)
        self.assertAlmostEqual(g["median"]["r3y"], 15.0, places=3)
        self.assertEqual((funds["6"]["rank3y"], funds["6"]["quartile3y"], funds["6"]["n3y"]), (1, 1, 6))
        self.assertEqual((funds["1"]["rank3y"], funds["1"]["quartile3y"]), (6, 4))
        # Above the median in every window -> 100%; below in every window -> 0%.
        self.assertEqual(funds["6"]["consistency"], 100.0)
        self.assertEqual(funds["1"]["consistency"], 0.0)
        self.assertEqual(funds["1"]["windows"], 24)

    def test_ties_share_a_rank(self):
        rates = {1: 0.10, 2: 0.10, 3: 0.14, 4: 0.16, 5: 0.18}
        _, funds = peer_statistics(self.figures(rates), {c: "g" for c in rates}, self.ENDS)
        self.assertEqual(funds["1"]["rank3y"], funds["2"]["rank3y"])
        self.assertEqual(funds["1"]["rank3y"], 4)

    def test_small_group_has_no_median_or_rank(self):
        rates = {c: 0.1 + c / 100 for c in range(1, MIN_PEERS)}
        groups, funds = peer_statistics(self.figures(rates), {c: "g" for c in rates}, self.ENDS)
        self.assertIsNone(groups["g"]["median"]["r3y"])
        self.assertTrue(all(f["rank3y"] is None and f["consistency"] is None for f in funds.values()))

    def test_young_fund_is_left_out_of_ranks_not_scored_zero(self):
        figures = self.figures({1: 0.10, 2: 0.12, 3: 0.14, 4: 0.16, 5: 0.18})
        figures[9] = fund_figures(growth_series(0.5, start=date(2025, 6, 1)), self.ENDS)
        groups, funds = peer_statistics(figures, {c: "g" for c in figures}, self.ENDS)
        self.assertEqual(groups["g"]["n"]["r3y"], 5)
        self.assertEqual(groups["g"]["n"]["r1y"], 6)
        self.assertIsNone(funds["9"]["rank3y"])
        self.assertIsNone(funds["9"]["consistency"])


if __name__ == "__main__":
    unittest.main()
