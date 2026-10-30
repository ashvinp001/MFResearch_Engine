"""Benchmark data, daily update (run by run_daily.ps1 after the fund NAV update) → Supabase benchmark bucket.

Usage:
    python data-pipeline/benchmark_daily.py            # the scheduled run
    python data-pipeline/benchmark_daily.py --dry-run  # everything except writing

Steps (idempotent; a missed day is filled by the next run):
  1. Mapping: Pulse's live fund→benchmark mapping (mf/nav_bm) resolved against the stored reference sheet
     (benchmark_data.resolve_mapping); every fund whose benchmark changed since the last run is reported.
  2. New benchmarks the mapping now uses: full history (collect_benchmarks.collect_one, all checks).
  3. New prices: each benchmark's price history (mf/bm_price_history, the same endpoint as the stored series —
     Pulse's per-day price list also fills weekends and holidays, the history does not) from RECHECK_DAYS
     before its latest stored date to today, checked (benchmark_data.check_history), cross-checked against
     Pulse's per-day price list on the latest day, and merged (nav_history.merge_daily, source "Pulse": new days
     added; a stored price that genuinely differs is corrected and flagged). A benchmark more than MAX_GAP_DAYS
     behind is collected again in full. A benchmark the collection rejected is listed, not retried.
  1b. Category rules on top of Pulse's mapping (benchmark_blends.apply_rules: gold / silver / overseas funds, and
     Balanced Advantage / Multi Asset blends rebuilt from their components); the mapping is stored with them.
  3b. Our own benchmarks (benchmark_blends.build_series: SBGOLD from the Gold BeES NAV, SBGS, SB<pulse code>
     blends by E7.1) rebuilt from the stored prices and stored under prices/sb/ like any index.
  4. manifest.json, latest.json, reports/daily/<date>.json, reports/daily-latest.json.
Exit code 1 when anything failed (the report says what); data already written stays consistent.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import settings  # noqa: E402
from benchmark_blends import BLEND_SOURCE, GOLD_CODE, GOLD_PROXY_SCHEME, apply_rules, build_series  # noqa: E402
from benchmark_data import (  # noqa: E402
    LATEST_PATH, MANIFEST_PATH, MAPPING_PATH, SCHEMA_VERSION, SOURCE, check_history, compare_on, from_parquet, object_path,
    to_parquet,
)
from collect_benchmarks import (  # noqa: E402
    CHECK_DATES, MANIFEST_FIELDS, MIN_INTERVAL_SECONDS, REPORT_PATH, Pacer, build_mapping, collect_one, published_on,
)
from nav_history import MANIFEST_PATH as NAV_MANIFEST_PATH, from_parquet as nav_from_parquet  # noqa: E402
from nav_history import merge_daily, recover_interrupted, sha256  # noqa: E402
from pulse_source import PulseClient, PulseError  # noqa: E402
from scheme_lists import read_lists  # noqa: E402
from supabase_storage import PARQUET_TYPE, StorageClient, StorageError  # noqa: E402

RECHECK_DAYS = 5       # the last few stored days are compared with Pulse's price list again (late corrections)
MAX_GAP_DAYS = 45


def build_own_benchmarks(synthetic: dict, stored: dict, bench: StorageClient, config: dict, dry_run: bool) -> dict:
    """Builds every benchmark in mapping["synthetic"] (benchmark_blends.build_series) from the stored index prices
    and the Gold BeES NAV (fund data bucket, SHA-256 checked), and stores each under prices/sb/ with its manifest
    entry in `stored` (updated in place). → {"updated": [codes], "errors": [...]}"""
    errors, updated = [], []
    if not synthetic:
        return {"updated": updated, "errors": errors}
    needed = {c for spec in synthetic.values() for c, _ in spec["components"] if not c.startswith("SB")}
    index_rows = {}
    for code in sorted(needed):
        entry = stored.get(code)
        data = bench.download(entry["path"]) if entry else None
        if data is None or sha256(data) != entry["sha256"]:
            errors.append(f"{code}: component of our own benchmarks missing or differs from its manifest entry")
            continue
        index_rows[code] = from_parquet(data)
    gold_rows = None
    if GOLD_CODE in synthetic:
        nav = StorageClient(settings.supabase(config))
        files = {f["schemeCode"]: f for f in (nav.download_json(NAV_MANIFEST_PATH) or {}).get("files", [])}
        entry = files.get(GOLD_PROXY_SCHEME)
        data = nav.download(entry["path"]) if entry else None
        if data is not None and sha256(data) == entry["sha256"]:
            gold_rows = nav_from_parquet(data)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for code, rows in build_series(synthetic, index_rows, gold_rows).items():
        if isinstance(rows, str):
            errors.append(f"{code} ({synthetic[code]['name']}): not built — {rows}")
            continue
        name = synthetic[code]["name"]
        data = to_parquet(rows, code, name, now, source=BLEND_SOURCE)
        stored_rows = from_parquet(data)
        entry = stored.get(code)
        last = stored_rows[-1]
        if entry and entry["name"] == name and entry["rows"] == len(stored_rows) and entry["lastDate"] == last[0].isoformat() \
                and entry["lastValue"] == str(last[1]) and entry.get("firstDate") == stored_rows[0][0].isoformat():
            continue   # unchanged since the last run
        if not dry_run:
            bench.upload(object_path(code), data, PARQUET_TYPE)
        stored[code] = {"code": code, "name": name, "family": "sb", "path": object_path(code), "firstDate": stored_rows[0][0].isoformat(),
                        "lastDate": last[0].isoformat(), "lastValue": str(last[1]), "rows": len(stored_rows), "sha256": sha256(data),
                        "updatedAt": now, "components": synthetic[code]["components"], "source": BLEND_SOURCE}
        updated.append(code)
    return {"updated": updated, "errors": errors}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="do not write to Supabase")
    args = parser.parse_args()
    started = time.monotonic()
    errors, flagged, new_codes = [], [], []
    try:
        config = settings.load()
        bench = StorageClient(settings.supabase(config, "SUPABASE_BENCHMARK_BUCKET"))
        pulse = PulseClient(settings.get("PULSE_BASE_URL", config), settings.get("PULSE_PARTNER", config), settings.get("PULSE_KEY", config))
        pulse.login()
        manifest = bench.download_json(MANIFEST_PATH)
        if not manifest:
            raise StorageError(f"{MANIFEST_PATH} not found — run collect_benchmarks.py first")
        stored = {e["code"]: e for e in manifest["benchmarks"]}
        today = datetime.now(timezone.utc).date()

        # 1. mapping
        previous = bench.download_json("mapping/funds.json") or {"funds": {}}
        mapping, mreport, live_day = build_mapping(bench, pulse, today, None, args.dry_run)
        # 1b. category rules and our own benchmarks on top of Pulse's mapping
        rules = apply_rules(mapping, [s for s in read_lists() if s["active"]], {c: e["name"] for c, e in stored.items()})
        if not args.dry_run:
            bench.upload_json(MAPPING_PATH, mapping)
        print(f"Rules: {rules['applied']} | our own benchmarks {rules['synthetic']} | blends not built {len(rules['notBuilt'])}")
        changed =[{"schemeCode": int(c), "from": previous["funds"].get(c, {}).get("benchmarkCode"), "to": e["benchmarkCode"]}
                   for c, e in mapping["funds"].items() if previous["funds"].get(c, {}).get("benchmarkCode") != e["benchmarkCode"]]
        print(f"Mapping (Pulse {live_day}, {len(mreport['pulse']['days'])} dates merged; {mreport['pulse']['fromEarlierDays']} funds from an earlier date): "
              f"{mreport['mapped']} schemes, {mreport['benchmarksUsed']} benchmarks | changed since last run {len(changed)}")

        # 2. benchmarks new to the mapping (one already rejected by the collection is listed, not retried daily)
        latest_day, latest_prices = published_on(pulse, live_day)
        ctx = {"pulse": pulse, "bench": bench, "today": today, "pacer": Pacer(MIN_INTERVAL_SECONDS), "dry_run": args.dry_run,
               "checks": [published_on(pulse, d) for d in CHECK_DATES] + [(latest_day, latest_prices)], "latest_day": latest_day}
        known_bad = {o["code"]: o["reason"] for o in (bench.download_json(REPORT_PATH) or {}).get("rejected", [])}
        not_stored = [{"code": c, "name": mapping["benchmarks"][c], "reason": known_bad[c]} for c in mapping["benchmarks"] if c not in stored and c in known_bad]
        for code in [c for c in mapping["benchmarks"] if c not in stored and c not in known_bad]:
            try:
                outcome = collect_one(code, mapping["benchmarks"][code], ctx)
            except Exception as error:  # one benchmark's problem must not stop the others
                outcome = {"status": "failed", "code": code, "reason": repr(error)}
            if outcome["status"] == "stored":
                stored[code] = {k: outcome.get(k) for k in MANIFEST_FIELDS}
                new_codes.append(code)
            elif outcome["status"] == "rejected":   # a data decision (no prices, failed cross-check), not a job failure
                not_stored.append({"code": code, "name": mapping["benchmarks"][code], "reason": outcome["reason"]})
            else:
                errors.append(f"{code} (new benchmark): {outcome['status']} — {outcome['reason']}")

        # 3. new prices — from the same price-history endpoint as the stored series (Pulse's per-day price list
        #    also fills weekends and holidays, the history does not), cross-checked on the latest day.
        floor = today - timedelta(days=MAX_GAP_DAYS)
        start = today
        added_total = corrected_total = 0

        def fetch(code, entry):
            first = date.fromisoformat(entry["lastDate"]) - timedelta(days=RECHECK_DAYS)
            ctx["pacer"].wait()
            window = (first, today)
            return first, check_history(code, [(window, pulse.bm_price_history(code, first.isoformat(), today.isoformat()))])

        used = set(mapping["benchmarks"])
        for code, entry in sorted(stored.items()):
            if code not in used:   # stored earlier, no longer used by any fund: kept as it is, not updated
                continue
            last = date.fromisoformat(entry["lastDate"])
            try:
                if last < floor:
                    outcome = collect_one(code, entry["name"], ctx)   # too far behind: full history again
                    if outcome["status"] != "stored":
                        errors.append(f"{code}: refill {outcome['status']} — {outcome['reason']}")
                        continue
                    stored[code] = {k: outcome.get(k) for k in MANIFEST_FIELDS}
                    continue
                first, checked = fetch(code, entry)
                start = min(start, first)
                if not checked.ok:
                    if checked.reason != "no prices":
                        errors.append(f"{code}: new prices not usable — {checked.reason}")
                    continue
                if code in latest_prices and compare_on(checked.rows, latest_day, latest_prices[code]) is False:
                    errors.append(f"{code}: price on {latest_day} differs from Pulse's price list ({latest_prices[code]}) — not updated")
                    continue
                wanted = {d: str(v) for d, v in checked.rows}
                data = bench.download(entry["path"])
                if data is None:
                    errors.append(f"{code}: {entry['path']} missing — not touched")
                    continue
                base, recovered = from_parquet(data), False
                if sha256(data) != entry["sha256"]:
                    # Uploaded by an earlier run that was stopped before writing the manifest: adopted only when it
                    # is verifiably that file (nav_history.recover_interrupted), else left untouched as before.
                    base = recover_interrupted(data, date.fromisoformat(entry["lastDate"]), entry.get("lastValue"), entry["rows"], wanted, read=from_parquet)
                    if base is None:
                        errors.append(f"{code}: {entry['path']} differs from its manifest entry — not touched")
                        continue
                    recovered = True
                rows, added, corrected, flags = merge_daily(base, wanted, source="Pulse")
                if recovered:
                    flags.insert(0, f"recovered: the file was already updated by an interrupted run (to {base[-1][0].isoformat()}, checked against Pulse)")
                if flags:
                    flagged.append({"code": code, "name": entry["name"], "flags": flags})
                if not added and not corrected:
                    if recovered:   # the file is right; only the manifest entry has to catch up with it
                        stored[code] = {**entry, "lastDate": rows[-1][0].isoformat(), "lastValue": str(rows[-1][1]), "rows": len(rows), "sha256": sha256(data)}
                    continue
                now = datetime.now(timezone.utc).isoformat(timespec="seconds")
                new_data = to_parquet(rows, code, entry["name"], now)
                if not args.dry_run:
                    bench.upload(object_path(code), new_data, PARQUET_TYPE)
                stored[code] = {**entry, "lastDate": rows[-1][0].isoformat(), "lastValue": str(rows[-1][1]), "rows": len(rows),
                                "sha256": sha256(new_data), "updatedAt": now}
                added_total += added
                corrected_total += corrected
            except Exception as error:  # one benchmark's problem must not stop the others
                errors.append(f"{code}: {error!r}")

        # 3b. our own benchmarks (benchmark_blends.py), rebuilt in full from the stored prices every run
        built = build_own_benchmarks(mapping.get("synthetic", {}), stored, bench, config, args.dry_run)
        errors += built["errors"]

        # 4. manifest, latest, report
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        files = sorted(stored.values(), key=lambda e: e["code"])
        latest_date = max((e["lastDate"] for e in files), default=None)
        behind = [e["code"] for e in files if e["code"] in used and latest_date and (date.fromisoformat(latest_date) - date.fromisoformat(e["lastDate"])).days > 7]
        report = {"generatedAt": now, "seconds": round(time.monotonic() - started), "pricesFrom": start.isoformat(), "pricesTo": today.isoformat(),
                  "pricesAdded": added_total, "pricesCorrected": corrected_total, "benchmarks": len(files), "newBenchmarks": new_codes,
                  "mappingChanged": changed, "benchmarksBehind": behind, "notStored": not_stored, "errors": errors, "flagged": flagged,
                  "rules": rules, "ownBenchmarks": built["updated"]}
        if not args.dry_run:
            bench.upload_json(MANIFEST_PATH, {**manifest, "schemaVersion": SCHEMA_VERSION, "source": SOURCE, "updatedAt": now,
                                              "latestDate": latest_date, "count": len(files), "benchmarks": files})
            bench.upload_json(LATEST_PATH, {"asOf": latest_date, "count": len(files),
                                            "values": {e["code"]: {"date": e["lastDate"], "value": e["lastValue"], "name": e["name"]} for e in files}})
            bench.upload_json(f"reports/daily/{today.isoformat()}.json", report)
            bench.upload_json("reports/daily-latest.json", report)
    except (StorageError, PulseError, settings.SettingsError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"Benchmark prices {start}..{today}: added {added_total} | corrected {corrected_total} | benchmarks {len(files)} "
          f"(new {len(new_codes)}, behind {len(behind)}) | mapping changes {len(changed)} | errors {len(errors)} | flagged {len(flagged)} | "
          f"{report['seconds']} s" + (" | DRY RUN (nothing written)" if args.dry_run else ""))
    for line in errors[:20]:
        print("  ERROR " + line)
    for o in not_stored:
        print(f"  NOT STORED {o['code']} {o['name']}: {o['reason']} (rejected by the collection; funds using it show no benchmark)")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
