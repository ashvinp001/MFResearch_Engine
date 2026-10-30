"""Peer statistics for the Invest / Hold / Sell logic (Recommendation_Logic.md §2) -> Supabase stats/peer-stats.json.

Usage:
    python data-pipeline/peer_stats.py             # after the daily update (run_daily.ps1)
    python data-pipeline/peer_stats.py --dry-run   # compute and print a summary; nothing written

For every stored, active scheme whose latest NAV is current (at most STALE_DAYS before AMFI's data date),
at its own ANCHOR T (latest NAV), with the same rules as calculation-engine/analytics (MF_Calculation_Engine.md):
  r1y, r3y, r5y    E2 trailing returns: start NAV NEAREST-PREVIOUS (10-day cap); > 12 months = CAGR on actual days
  sharpe3y         E12 R1/R2: month-end returns over the last 36 completed months (min 30), σ = STDEV.S × √12,
                   Sharpe = (r3y − Rf) / σ
  maxDrawdown3y    E12 R5 on the daily NAVs from the 3Y start NAV to T
  worstDay3y       the largest fall between two consecutive stored NAVs in the same window
  rolling 3Y       the fund's 3Y CAGR (E2) anchored at each of the last ROLLING_WINDOWS completed month-ends
Peer group = plan (Regular / Direct / ETF) + AMFI asset class + AMFI category, exactly as in the fund lists;
nothing is merged or renamed. Per group and metric: n and median, the median only when n >= MIN_PEERS.
Per fund: rank and E9 quartile on r3y and on sharpe3y (only when the group has >= MIN_PEERS values), and
consistency = share of rolling windows where the fund's 3Y CAGR >= the group's median for that window
(windows where the group has >= MIN_PEERS funds; at least MIN_WINDOWS such windows, else null).
Per fund also its own benchmark (benchmark bucket: mapping/funds.json + prices): the benchmark's 1Y / 3Y / 5Y by E2,
anchored at the fund's ANCHOR date (benchmark price by E1 NEAREST-PREVIOUS) — null when there is none — and the
broad market (MARKET_CODE, NIFTY 500) on the same anchor ("market"), for the sector check of sector funds.
A figure that cannot be computed is null: never 0, never estimated. Ratios are stored as percent (12.34).
"""

from __future__ import annotations

import argparse
import math
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import settings  # noqa: E402
from benchmark_data import MANIFEST_PATH as BENCH_MANIFEST_PATH, MAPPING_PATH as BENCH_MAPPING_PATH  # noqa: E402
from benchmark_data import COMPOSITE_REASON, is_composite  # noqa: E402
from benchmark_data import from_parquet as bench_from_parquet  # noqa: E402
from nav_history import MANIFEST_PATH, from_parquet, sha256  # noqa: E402
from scheme_lists import read_lists  # noqa: E402
from supabase_storage import StorageClient, StorageError  # noqa: E402

STATS_PATH = "stats/peer-stats.json"
SCHEMA_VERSION = 1
MAX_STEP_DAYS = 10        # E1 lookup cap        (calculation-engine/config.js NAV_LOOKUP)
RISK_FREE_RATE = 0.065    # E12 Rf p.a.          (calculation-engine/config.js RISK)
RISK_MONTHS = 36          # E12 window            (calculation-engine/config.js RISK)
RISK_MIN_OBSERVATIONS = 30
STALE_DAYS = 7            # a scheme whose latest NAV is older than this is left out of every peer group
MIN_PEERS = 5             # a median / rank needs at least this many funds in the group
ROLLING_WINDOWS = 24      # monthly rolling 3Y windows used for consistency
MIN_WINDOWS = 12
METRICS = ("r1y", "r3y", "r5y", "sharpe3y", "maxDrawdown3y")
MARKET_CODE = "OB56"      # NIFTY 500 (total return) — the broad Indian market, for the sector check
WORKERS = 12


class Series:
    """Daily NAVs, dates strictly ascending (as stored)."""

    def __init__(self, rows):
        self.dates = [d for d, _ in rows]
        self.navs = [float(n) for _, n in rows]
        self.index = {d: i for i, d in enumerate(self.dates)}
        for i in range(1, len(self.dates)):
            if self.dates[i] <= self.dates[i - 1] or not self.navs[i] > 0:
                raise ValueError(f"bad NAV series at {self.dates[i]}")


def nav_on(series: Series, day: date, rule: str = "previous"):
    """E1: the day itself, then one calendar day at a time (back for previous), at most MAX_STEP_DAYS."""
    step = -1 if rule == "previous" else 1
    for k in range(MAX_STEP_DAYS + 1):
        candidate = day + timedelta(days=k * step)
        i = series.index.get(candidate)
        if i is not None:
            return candidate, series.navs[i]
    return None


def period_start(anchor: date, months: int) -> date:
    """T − period, calendar arithmetic, the day clamped to the month's last day (returns.js periodStart)."""
    total = anchor.year * 12 + (anchor.month - 1) - months
    year, month = divmod(total, 12)
    month += 1
    last_day = (date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)).day
    return date(year, month, min(anchor.day, last_day))


def trailing(series: Series, anchor, months: int):
    """E2 return as a ratio, or None. anchor = (date, nav)."""
    start = nav_on(series, period_start(anchor[0], months), "previous")
    if start is None:
        return None
    growth = anchor[1] / start[1]
    if months <= 12:
        return growth - 1
    days = (anchor[0] - start[0]).days
    return growth ** (365 / days) - 1 if days > 0 else None


def last_completed_month_end(day: date) -> date:
    return day.replace(day=1) - timedelta(days=1)


def month_ends(last: date, count: int) -> list[date]:
    """The last calendar day of `count` months ending with `last`'s month, oldest first."""
    out, current = [], last
    for _ in range(count):
        out.append(current)
        current = current.replace(day=1) - timedelta(days=1)
    return out[::-1]


def sharpe_3y(series: Series, anchor, r3y):
    if r3y is None:
        return None
    navs = [nav_on(series, d, "previous") for d in month_ends(last_completed_month_end(anchor[0]), RISK_MONTHS + 1)]
    monthly = [b[1] / a[1] - 1 for a, b in zip(navs, navs[1:]) if a and b]
    if len(monthly) < RISK_MIN_OBSERVATIONS:
        return None
    sd = statistics.stdev(monthly) * math.sqrt(12)
    return (r3y - RISK_FREE_RATE) / sd if sd > 0 else None


def drawdown_3y(series: Series, anchor):
    """(max drawdown, worst one-step fall) over the daily NAVs from the 3Y start NAV to the anchor, or (None, None)."""
    start = nav_on(series, period_start(anchor[0], 36), "previous")
    if start is None:
        return None, None
    navs = series.navs[series.index[start[0]]: series.index[anchor[0]] + 1]
    peak, deepest, worst = navs[0], 0.0, 0.0
    for prev, nav in zip(navs, navs[1:]):
        peak = max(peak, nav)
        deepest = min(deepest, nav / peak - 1)
        worst = min(worst, nav / prev - 1)
    return deepest, worst


def quartile(rank: int, n: int) -> int:
    """E9, the owner's Excel formula."""
    if rank <= math.ceil(n * 0.25):
        return 1
    if rank <= math.ceil(n * 0.50):
        return 2
    if rank <= math.ceil(n * 0.75):
        return 3
    return 4


def fund_figures(series: Series, ends: list[date]) -> dict:
    anchor = (series.dates[-1], series.navs[-1])
    r3y = trailing(series, anchor, 36)
    deepest, worst = drawdown_3y(series, anchor)
    rolling = {}
    for end in ends:
        point = nav_on(series, end, "previous")
        value = trailing(series, point, 36) if point else None
        if value is not None:
            rolling[end] = value
    return {"navDate": anchor[0], "firstDate": series.dates[0], "r1y": trailing(series, anchor, 12), "r3y": r3y,
            "r5y": trailing(series, anchor, 60), "sharpe3y": sharpe_3y(series, anchor, r3y),
            "maxDrawdown3y": deepest, "worstDay3y": worst, "rolling": rolling}


def peer_statistics(figures: dict, group_of: dict, ends: list[date]) -> tuple[dict, dict]:
    """figures: {code: fund_figures}; group_of: {code: group key}. Returns (groups, funds) ready to publish."""
    members: dict[str, list[int]] = {}
    for code in figures:
        members.setdefault(group_of[code], []).append(code)

    groups, funds = {}, {}
    for key, codes in members.items():
        n, median = {}, {}
        for metric in METRICS:
            values = [figures[c][metric] for c in codes if figures[c][metric] is not None]
            n[metric] = len(values)
            median[metric] = statistics.median(values) if len(values) >= MIN_PEERS else None
        window_median = {}
        for end in ends:
            values = [figures[c]["rolling"][end] for c in codes if end in figures[c]["rolling"]]
            if len(values) >= MIN_PEERS:
                window_median[end] = statistics.median(values)
        groups[key] = {"funds": len(codes), "n": n, "median": {k: pct(v) if k != "sharpe3y" else rnd(v) for k, v in median.items()}}

        def ranked(metric):
            values = [figures[c][metric] for c in codes if figures[c][metric] is not None]
            out = {}
            if len(values) >= MIN_PEERS:
                for c in codes:
                    x = figures[c][metric]
                    if x is not None:
                        rank = 1 + sum(v > x for v in values)
                        out[c] = (rank, quartile(rank, len(values)), len(values))
            return out

        by_return, by_sharpe = ranked("r3y"), ranked("sharpe3y")
        for c in codes:
            f = figures[c]
            windows = [(f["rolling"][e], window_median[e]) for e in ends if e in f["rolling"] and e in window_median]
            wins = sum(value >= mid for value, mid in windows)
            r, s = by_return.get(c), by_sharpe.get(c)
            funds[str(c)] = {
                "group": key, "navDate": f["navDate"].isoformat(), "firstDate": f["firstDate"].isoformat(),
                "r1y": pct(f["r1y"]), "r3y": pct(f["r3y"]), "r5y": pct(f["r5y"]), "sharpe3y": rnd(f["sharpe3y"]),
                "maxDrawdown3y": pct(f["maxDrawdown3y"]), "worstDay3y": pct(f["worstDay3y"]),
                "rank3y": r[0] if r else None, "quartile3y": r[1] if r else None, "n3y": r[2] if r else None,
                "sharpeRank": s[0] if s else None, "sharpeQuartile": s[1] if s else None, "nSharpe": s[2] if s else None,
                "consistency": rnd(100 * wins / len(windows), 2) if len(windows) >= MIN_WINDOWS else None,
                "windows": len(windows),
            }
    return groups, funds


def benchmark_figures(series: Series, fund_anchor: date) -> dict | None:
    """The benchmark's 1Y / 3Y / 5Y (E2) anchored at the fund's own ANCHOR date — the benchmark price on that date
    by E1 NEAREST-PREVIOUS (10-day cap) — so fund and benchmark cover the same period. None without that price."""
    anchor = nav_on(series, fund_anchor, "previous")
    if anchor is None:
        return None
    return {"anchorDate": anchor[0].isoformat(), "r1y": pct(trailing(series, anchor, 12)),
            "r3y": pct(trailing(series, anchor, 36)), "r5y": pct(trailing(series, anchor, 60))}


def attach_benchmarks(funds: dict, mapping: dict, series_by_code: dict, market_name: str | None = None) -> int:
    """funds[code]["benchmark"] = {code, name, anchorDate, r1y, r3y, r5y} | None, and funds[code]["market"] = the
    broad market (MARKET_CODE) on the same anchor, for the sector check. Returns how many have a benchmark.
    A Pulse-made multi-index blend (benchmark_data.is_composite) is not used: benchmark None and
    benchmarkExcluded says why (checked 22-Oct-2026: they do not follow their stated weights). Our own rebuilt blends
    (benchmark_blends.py, codes SB…) are used like any index."""
    count = 0
    market = series_by_code.get(MARKET_CODE)
    for code, entry in funds.items():
        anchor = date.fromisoformat(entry["navDate"])
        m = (mapping.get("funds") or {}).get(code)
        if m and not m["benchmarkCode"].startswith("SB") and is_composite(m.get("benchmarkName")):
            entry["benchmarkExcluded"] = {"code": m["benchmarkCode"], "name": m.get("benchmarkName"), "reason": COMPOSITE_REASON}
            m = None
        series = series_by_code.get(m["benchmarkCode"]) if m else None
        figures = benchmark_figures(series, anchor) if series else None
        entry["benchmark"] = {"code": m["benchmarkCode"], "name": m.get("benchmarkName"), **figures} if figures else None
        market_figures = benchmark_figures(market, anchor) if market else None
        entry["market"] = {"code": MARKET_CODE, "name": market_name, **market_figures} if market_figures else None
        count += figures is not None
    return count


def pct(ratio):
    return None if ratio is None else round(ratio * 100, 4)


def rnd(value, digits=4):
    return None if value is None else round(value, digits)


def group_key(scheme: dict) -> str:
    return f"{scheme['plan']}|{scheme['assetClass']}|{scheme['category']}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="compute and summarise; do not write to Supabase")
    args = parser.parse_args()
    started = time.monotonic()
    try:
        client = StorageClient(settings.supabase())
        manifest = client.download_json(MANIFEST_PATH)
        if not manifest or not manifest.get("amfiDataAsOf"):
            raise StorageError(f"{MANIFEST_PATH} not found or without amfiDataAsOf")
        as_of = date.fromisoformat(manifest["amfiDataAsOf"])
        schemes = {s["schemeCode"]: s for s in read_lists() if s["active"]}
        entries = [e for e in manifest["files"] if e["schemeCode"] in schemes
                   and (as_of - date.fromisoformat(e["lastDate"])).days <= STALE_DAYS]
        ends = month_ends(last_completed_month_end(as_of), ROLLING_WINDOWS)

        def one(entry):
            try:
                data = client.download(entry["path"])
                if data is None or sha256(data) != entry["sha256"]:
                    return entry["schemeCode"], None, "missing or differs from its manifest entry"
                return entry["schemeCode"], fund_figures(Series(from_parquet(data)), ends), None
            except Exception as error:  # one scheme's problem must not stop the others
                return entry["schemeCode"], None, repr(error)

        figures, errors = {}, []
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            for code, result, error in pool.map(one, entries):
                if error:
                    errors.append(f"{code}: {error}")
                else:
                    figures[code] = result
        groups, funds = peer_statistics(figures, {c: group_key(schemes[c]) for c in figures}, ends)

        # Each fund's own benchmark (benchmark bucket), same anchor date and E2 rules. Without the benchmark data the
        # statistics are still published, with benchmark null (the logic then treats it as unknown).
        with_benchmark, warnings = 0, []
        try:
            bench = StorageClient(settings.supabase(None, "SUPABASE_BENCHMARK_BUCKET"))
            mapping = bench.download_json(BENCH_MAPPING_PATH) or {}
            bmanifest = bench.download_json(BENCH_MANIFEST_PATH) or {"benchmarks": []}
            used = {m["benchmarkCode"] for m in (mapping.get("funds") or {}).values()} | {MARKET_CODE}
            market_name = next((e.get("name") for e in bmanifest["benchmarks"] if e["code"] == MARKET_CODE), None)

            def load(entry):
                data = bench.download(entry["path"])
                if data is None or sha256(data) != entry["sha256"]:
                    return entry["code"], None
                return entry["code"], Series(bench_from_parquet(data))

            with ThreadPoolExecutor(max_workers=WORKERS) as pool:
                series_by_code = {c: s for c, s in pool.map(load, [e for e in bmanifest["benchmarks"] if e["code"] in used]) if s}
            with_benchmark = attach_benchmarks(funds, mapping, series_by_code, market_name)
            if MARKET_CODE not in series_by_code:
                warnings.append(f"broad-market index {MARKET_CODE} not in the benchmark store — sector check unavailable")
        except (StorageError, settings.SettingsError) as error:
            warnings.append(f"benchmark data not available: {error}")
            for entry in funds.values():
                entry["benchmark"] = entry["market"] = None
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        out = {
            "schemaVersion": SCHEMA_VERSION, "asOf": as_of.isoformat(), "generatedAt": now,
            "method": {"riskFreeRate": RISK_FREE_RATE, "minPeers": MIN_PEERS, "staleDays": STALE_DAYS,
                       "rollingWindows": ROLLING_WINDOWS, "minWindows": MIN_WINDOWS,
                       "rollingFrom": ends[0].isoformat(), "rollingTo": ends[-1].isoformat(),
                       "peerGroup": "plan|assetClass|category (AMFI)", "units": "percent except sharpe3y"},
            "groups": groups, "funds": funds,
            "leftOut": {"stale": len(schemes) - len(entries), "errors": errors},
            "withBenchmark": with_benchmark, "warnings": warnings,
        }
        if not args.dry_run:
            client.upload_json(STATS_PATH, out)
    except (StorageError, settings.SettingsError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"Peer stats as of {as_of}: {len(funds)} funds in {len(groups)} groups | with benchmark {with_benchmark} | stale {len(schemes) - len(entries)} | "
          f"errors {len(errors)} | {round(time.monotonic() - started)} s" + (" | DRY RUN (nothing written)" if args.dry_run else ""))
    for line in warnings:
        print("  WARNING " + line)
    for line in errors[:20]:
        print("  ERROR " + line)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
