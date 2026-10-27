"""Benchmark data, one-time collection: fund→benchmark mapping + full price history since 2015 → Supabase.

Usage:
    python data-pipeline/collect_benchmarks.py --sheet <Fund-BM-Mapping.xlsx>   # first run: import the owner's sheet
    python data-pipeline/collect_benchmarks.py                                 # resume / re-run (reference already stored)
    python data-pipeline/collect_benchmarks.py --check                         # Pulse + bucket reachable; nothing written

Steps (bucket SUPABASE_BENCHMARK_BUCKET, created private if missing):
  1. Reference: the sheet's Fund - BM Mapping rows for our Regular / Direct Growth scheme codes
     -> reference/fund-bm-mapping-sheet.json (only with --sheet; afterwards the stored copy is used).
  2. Mapping: Pulse's live mapping (mf/nav_bm on its latest date) resolved against the reference
     (benchmark_data.resolve_mapping) -> mapping/funds.json + reports/mapping-latest.json.
  3. Prices: for every benchmark the mapping uses, daily history from 2015 (mf/bm_price_history in two-year
     windows), checked (benchmark_data.check_history) and CROSS-CHECKED against Pulse's per-day price list
     (mf/bm_data) on CHECK_DATES and on the latest date — any disagreement rejects that benchmark.
     -> prices/<family>/<code>.parquet, manifest.json (saved as it goes; a stopped run resumes), latest.json,
        reports/collection-latest.json.
Exit code 1 when a benchmark was rejected or failed (the report says which and why).
"""

from __future__ import annotations

import argparse
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import settings  # noqa: E402
from benchmark_data import (  # noqa: E402
    HISTORY_FROM, LATEST_PATH, MANIFEST_PATH, MAPPING_PATH, REFERENCE_PATH, SCHEMA_VERSION, SOURCE, check_history, compare_on,
    object_path, family, resolve_mapping, sheet_reference, to_parquet, two_year_windows, value_text,
)
from nav_history import HistoryRejected, parse_nav, sha256  # noqa: E402
from pulse_source import PulseClient, PulseError  # noqa: E402
from scheme_lists import read_lists  # noqa: E402
from supabase_storage import PARQUET_TYPE, StorageClient, StorageError  # noqa: E402
from xlsx_reader import sheet_rows  # noqa: E402

SHEET_NAME = "Fund - BM Mapping "          # as named in the owner's workbook (trailing space included)
CHECK_DATES = (date(2016, 6, 30), date(2020, 12, 31), date(2024, 6, 28))   # cross-check days (nearest earlier day with prices)
STALE_DAYS = 7
WORKERS = 4
MIN_INTERVAL_SECONDS = 0.15                # gap between Pulse calls (per process)
REPORT_PATH = "reports/collection-latest.json"
MANIFEST_FIELDS = ("code", "name", "family", "path", "firstDate", "lastDate", "lastValue", "rows", "sha256", "updatedAt")


class Pacer:
    def __init__(self, interval: float):
        self.interval, self.lock, self.next = interval, threading.Lock(), 0.0

    def wait(self):
        with self.lock:
            now = time.monotonic()
            if now < self.next:
                time.sleep(self.next - now)
            self.next = max(now, self.next) + self.interval


def our_schemes() -> list[dict]:
    """Regular and Direct Growth schemes in our fund lists (ETFs excluded, as the owner asked)."""
    return [s for s in read_lists() if s["plan"] in ("Regular", "Direct")]


LIVE_DAYS = 5       # Pulse's live mapping is merged over its last this-many dates with data


def latest_live(pulse: PulseClient, today: date) -> tuple[date, list[dict], dict]:
    """Pulse's live mapping, merged over its last LIVE_DAYS dates with data (within 15 days): each scheme from the
    most recent date that lists it. Pulse's list for one day can come back short (22-Oct-2026: ~180 funds missing),
    and a fund missing for a day must not fall back to the reference sheet's older code.
    Returns (latest date, rows, {"days": [...], "fromEarlierDays": n})."""
    merged: dict[str, dict] = {}
    days: list[date] = []
    latest_count = 0
    for back in range(16):
        day = today - timedelta(days=back)
        rows = pulse.nav_bm(day.isoformat())
        if not rows:
            continue
        days.append(day)
        if len(days) == 1:
            latest_count = len({str(r.get("scheme_code")) for r in rows})
        for r in rows:
            merged.setdefault(str(r.get("scheme_code")), r)   # newest first: keep the most recent entry
        if len(days) == LIVE_DAYS:
            break
    if not days:
        raise PulseError("mf/nav_bm returned no rows for the last 15 days")
    return days[0], list(merged.values()), {"days": [d.isoformat() for d in days], "latestDayCount": latest_count,
                                            "fromEarlierDays": len(merged) - latest_count}


def published_on(pulse: PulseClient, day: date, back: int = 7) -> tuple[date, dict]:
    """Pulse's per-day price list (mf/bm_data) on `day` or the nearest earlier day that has one."""
    for k in range(back + 1):
        d = day - timedelta(days=k)
        rows = pulse.bm_data(d.isoformat())
        if rows:
            out = {}
            for r in rows:
                try:
                    value = parse_nav(value_text(r.get("benchmark_value")))
                except HistoryRejected:
                    value = None
                if r.get("final_benchmark") and value is not None:
                    out[r["final_benchmark"]] = value
            return d, out
    return day, {}


def collect_one(code: str, name: str | None, ctx: dict) -> dict:
    """Full history for one benchmark, checked and cross-checked, uploaded. Returns a manifest entry or a rejection."""
    windows = []
    for start, end in two_year_windows(HISTORY_FROM, ctx["today"]):
        ctx["pacer"].wait()
        windows.append(((start, end), ctx["pulse"].bm_price_history(code, start.isoformat(), end.isoformat())))
    checked = check_history(code, windows)
    if not checked.ok:
        return {"code": code, "name": name, "status": "rejected", "reason": checked.reason}
    verified, flags = [], list(checked.flags)
    for day, prices in ctx["checks"]:
        if code not in prices:
            continue
        same = compare_on(checked.rows, day, prices[code])
        if same is False:
            stored = dict(checked.rows)[day]
            return {"code": code, "name": name, "status": "rejected",
                    "reason": f"history {stored} differs from Pulse's price list {prices[code]} on {day}"}
        if same:
            verified.append(day.isoformat())
    if not verified:
        flags.append("no cross-check date in common with Pulse's price list")
    last = checked.rows[-1]
    if (ctx["latest_day"] - last[0]).days > STALE_DAYS:
        flags.append(f"latest price {last[0]} is more than {STALE_DAYS} days before {ctx['latest_day']}")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    data = to_parquet(checked.rows, code, name, now)
    path = object_path(code)
    if not ctx["dry_run"]:
        ctx["bench"].upload(path, data, PARQUET_TYPE)
    return {"status": "stored", "code": code, "name": name, "family": family(code), "path": path,
            "firstDate": checked.rows[0][0].isoformat(), "lastDate": last[0].isoformat(), "lastValue": str(last[1]),
            "rows": len(checked.rows), "sha256": sha256(data), "updatedAt": now, "verifiedOn": verified, "flags": flags}


def build_mapping(bench: StorageClient, pulse: PulseClient, today: date, sheet_path: str | None, dry_run: bool):
    schemes = our_schemes()
    if sheet_path:
        reference = sheet_reference(sheet_rows(Path(sheet_path), SHEET_NAME), {s["schemeCode"] for s in schemes})
        stored = {"source": "Fund - BM Mapping sheet (owner's reference workbook)", "sheet": SHEET_NAME.strip(),
                  "importedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                  "count": len(reference), "rows": {str(k): v for k, v in sorted(reference.items())}}
        if not dry_run:
            bench.upload_json(REFERENCE_PATH, stored)
    else:
        stored = bench.download_json(REFERENCE_PATH)
        if not stored:
            raise StorageError(f"{REFERENCE_PATH} not found — run once with --sheet <workbook.xlsx>")
        reference = {int(k): v for k, v in stored["rows"].items()}
    live_day, live, live_info = latest_live(pulse, today)
    mapping, report = resolve_mapping(schemes, live, reference)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    mapping = {"schemaVersion": SCHEMA_VERSION, "pulseMappingDate": live_day.isoformat(), "pulseMappingDays": live_info["days"],
               "generatedAt": now,
               "rule": f"Pulse live mapping (mf/nav_bm, last {LIVE_DAYS} dates merged); owner's sheet as the cross-check — see benchmark_data.py",
               **mapping}
    report = {"generatedAt": now, "pulseMappingDate": live_day.isoformat(), "pulse": live_info, "referenceRows": len(reference), **report}
    if not dry_run:
        bench.upload_json(MAPPING_PATH, mapping)
        bench.upload_json("reports/mapping-latest.json", report)
    return mapping, report, live_day


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sheet", help="the owner's workbook (.xlsx) with the Fund - BM Mapping sheet")
    parser.add_argument("--check", action="store_true", help="test Pulse and the bucket only")
    parser.add_argument("--dry-run", action="store_true", help="collect and check, write nothing")
    parser.add_argument("--refresh", action="store_true", help="re-collect benchmarks already in the manifest")
    parser.add_argument("--limit", type=int, help="collect at most this many benchmarks (trial)")
    args = parser.parse_args()
    started = time.monotonic()
    try:
        config = settings.load()
        bench = StorageClient(settings.supabase(config, "SUPABASE_BENCHMARK_BUCKET"))
        pulse = PulseClient(settings.get("PULSE_BASE_URL", config), settings.get("PULSE_PARTNER", config), settings.get("PULSE_KEY", config))
        pulse.login()
        if args.check:
            print(f"Pulse login OK | bucket {bench.bucket}: {bench.ensure_bucket() if not args.dry_run else 'not checked (dry run)'}")
            return 0
        if not args.dry_run:
            print(f"Bucket {bench.bucket}: {bench.ensure_bucket()}")
        today = datetime.now(timezone.utc).date()
        mapping, mreport, live_day = build_mapping(bench, pulse, today, args.sheet, args.dry_run)
        print(f"Mapping (Pulse {live_day}): {mreport['mapped']} of {mreport['schemes']} schemes | verified by sheet {mreport['verifiedBySheet']} | "
              f"differ from sheet {len(mreport['differFromSheet'])} | sheet only {len(mreport['sheetOnly'])} | Pulse only {mreport['pulseOnly']} | "
              f"no benchmark {len(mreport['noBenchmark'])} | benchmarks {mreport['benchmarksUsed']}")

        latest_day, latest_prices = published_on(pulse, live_day)
        checks = [published_on(pulse, d) for d in CHECK_DATES] + [(latest_day, latest_prices)]
        print("Cross-check price lists: " + ", ".join(f"{d} ({len(p)} benchmarks)" for d, p in checks))
        manifest = (None if args.refresh else bench.download_json(MANIFEST_PATH)) or {"benchmarks": []}
        stored = {e["code"]: e for e in manifest["benchmarks"]}
        todo = [c for c in mapping["benchmarks"] if c not in stored][: args.limit]
        print(f"Benchmarks to collect: {len(todo)} (already stored {len(stored)})")
        ctx = {"pulse": pulse, "bench": bench, "today": today, "pacer": Pacer(MIN_INTERVAL_SECONDS), "checks": checks,
               "latest_day": latest_day, "dry_run": args.dry_run}
        rejected, failed, flagged, done = [], [], [], 0
        lock = threading.Lock()

        def save_manifest():
            if args.dry_run:
                return
            files = sorted(stored.values(), key=lambda e: e["code"])
            bench.upload_json(MANIFEST_PATH, {"schemaVersion": SCHEMA_VERSION, "source": SOURCE, "historyFrom": HISTORY_FROM.isoformat(),
                                              "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                              "latestDate": latest_day.isoformat(), "count": len(files), "benchmarks": files})

        def work(code):
            try:
                return code, collect_one(code, mapping["benchmarks"][code], ctx)
            except Exception as error:  # one benchmark's problem must not stop the others
                return code, {"status": "failed", "code": code, "reason": repr(error)}

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            for code, outcome in pool.map(work, todo):
                with lock:
                    done += 1
                    if outcome["status"] == "stored":
                        stored[code] = {k: outcome.get(k) for k in MANIFEST_FIELDS}
                        if outcome["flags"]:
                            flagged.append({"code": code, "name": outcome["name"], "flags": outcome["flags"]})
                    else:
                        (rejected if outcome["status"] == "rejected" else failed).append(outcome)
                    if done % 25 == 0:
                        save_manifest()
                        print(f"  {done}/{len(todo)} …")
        save_manifest()
        latest = {e["code"]: {"date": e["lastDate"], "value": e["lastValue"], "name": e["name"]} for e in stored.values()}
        report = {"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "seconds": round(time.monotonic() - started),
                  "stored": len(stored), "collectedNow": len(todo) - len(rejected) - len(failed), "rejected": rejected, "failed": failed,
                  "flagged": flagged, "crossCheckDates": [d.isoformat() for d, _ in checks]}
        if not args.dry_run:
            bench.upload_json(LATEST_PATH, {"asOf": latest_day.isoformat(), "count": len(latest), "values": latest})
            bench.upload_json(REPORT_PATH, report)
    except (StorageError, PulseError, settings.SettingsError, RuntimeError, KeyError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"Stored {len(stored)} benchmarks | rejected {len(rejected)} | failed {len(failed)} | flagged {len(flagged)} | {report['seconds']} s"
          + (" | DRY RUN (nothing written)" if args.dry_run else ""))
    for o in rejected + failed:
        print(f"  {o['status'].upper()} {o['code']} {o.get('name') or ''}: {o['reason']}")
    for f in flagged[:15]:
        print(f"  FLAG {f['code']} {f['name']}: {'; '.join(f['flags'])[:200]}")
    return 1 if rejected or failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
