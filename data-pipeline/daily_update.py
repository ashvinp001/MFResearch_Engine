"""Daily update (scheduled every morning): fund lists + new NAVs from AMFI, into Supabase.

Usage:
    python data-pipeline/daily_update.py            # the scheduled run
    python data-pipeline/daily_update.py --dry-run  # everything except writing to Supabase / data/schemes
    python data-pipeline/daily_update.py --reconcile  # also re-check every stored NAV in the window against AMFI

Steps (each run is idempotent and self-healing — a missed day is filled by the next run):
  1. Fund lists: AMFI daily file + Scheme Master -> data/schemes/ and Supabase schemes/ (build_universe).
  2. New NAVs: AMFI's NAV history report for every day after the earliest last-stored date of the
     active schemes (at most MAX_GAP_DAYS back) plus AMFI's daily file (the official latest NAV, as the
     report lags a day or two), merged into each scheme's Parquet file (nav_history.merge_daily: new
     days added; a stored NAV that genuinely differs from AMFI's is corrected to AMFI's and flagged).
  3. New schemes in the lists: full history from MFAPI, with all the collection checks.
  4. nav/manifest.json, nav/latest.json ({code: {date, nav}} — what the website shows as the current
     NAV) and reports/daily/<AMFI date>.json + reports/daily-latest.json.
Exit code 1 when anything failed (the report says what); data already written stays consistent.
"""

from __future__ import annotations

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import settings  # noqa: E402
from amfi_source import AmfiFormatError, download, nav_history_url, parse_nav_file, parse_nav_history  # noqa: E402
from build_universe import build, refresh_lists  # noqa: E402
from collect_nav_history import MANIFEST_FIELDS, MIN_INTERVAL_SECONDS, REPORT_PATH, Pacer, collect_one  # noqa: E402
from nav_history import (  # noqa: E402
    HISTORY_FROM, MANIFEST_PATH, SCHEMA_VERSION, SOURCE, HistoryRejected, from_parquet, merge_daily, object_path,
    parse_nav, recover_interrupted, same_nav, sha256, to_parquet,
)
from scheme_lists import LISTS_DIR, ListError, check, read_lists  # noqa: E402
from supabase_storage import PARQUET_TYPE, StorageClient, StorageError  # noqa: E402
from universe_rules import UnknownSectionError  # noqa: E402

LATEST_PATH = "nav/latest.json"
MAX_GAP_DAYS = 45          # AMFI history is fetched at most this far back; older gaps are reported
CHUNK_DAYS = 15            # AMFI history report requested in chunks of this many days
WORKERS = 12


def gap_points(config: dict, start: date, end: date, warnings: list[str]) -> dict[int, dict[date, str]]:
    """AMFI's NAV history report for start..end. A window the report cannot give (e.g. AMFI answers with a web
    page instead of the report) is skipped with a warning: the daily file still supplies the latest NAVs, and
    the next run that gets the report fills the gap (nothing is guessed)."""
    template = settings.get("AMFI_NAV_HISTORY_URL", config)
    points: dict[int, dict[date, str]] = {}
    chunk_start = start
    while chunk_start <= end:
        chunk_end = min(end, chunk_start + timedelta(days=CHUNK_DAYS - 1))
        try:
            for (code, day), nav in parse_nav_history(download(nav_history_url(template, chunk_start, chunk_end))).items():
                points.setdefault(code, {})[day] = nav
        except AmfiFormatError as error:
            warnings.append(f"AMFI NAV history report not available for {chunk_start}..{chunk_end} ({error}); "
                            "only AMFI's daily file was used — check AMFI_NAV_HISTORY_URL")
        chunk_start = chunk_end + timedelta(days=1)
    return points


def update_one(client: StorageClient, scheme: dict, entry: dict, points: dict[date, str], dry_run: bool) -> dict:
    """Append AMFI's new NAVs to one stored scheme. Returns {entry, added, flags} or {error}."""
    data = client.download(entry["path"])
    if data is None:
        return {"error": f"{entry['path']} is in the manifest but missing from the bucket"}
    recovered = False
    if sha256(data) != entry["sha256"]:
        # An earlier run uploaded this file and was stopped before writing the manifest: adopt it only when it is
        # verifiably that file (nav_history.recover_interrupted), else leave it untouched as before.
        base = recover_interrupted(data, date.fromisoformat(entry["lastDate"]), entry.get("lastNav"), entry["rows"], points)
        if base is None:
            return {"error": f"{entry['path']} differs from its manifest entry — not touched"}
        recovered = True
    else:
        base = from_parquet(data)
    rows, added, corrected, flags = merge_daily(base, points)
    if recovered:
        flags.insert(0, f"recovered: the file was already updated by an interrupted run (to {base[-1][0].isoformat()}, checked against AMFI)")
    path = object_path(scheme)
    moved = path != entry["path"]
    if not added and not corrected and not moved:
        if recovered:   # the file is right; only the manifest entry has to catch up with it
            return {"entry": {**entry, "lastDate": rows[-1][0].isoformat(), "lastNav": str(rows[-1][1]), "rows": len(rows), "sha256": sha256(data)},
                    "added": 0, "corrected": 0, "recovered": True, "flags": flags}
        return {"entry": {**entry, "lastNav": str(rows[-1][1])}, "added": 0, "corrected": 0, "flags": flags}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    new_data = to_parquet(rows, scheme, now)
    if not dry_run:
        client.upload(path, new_data, PARQUET_TYPE)
        if moved:
            client.delete(entry["path"])
    new_entry = {**entry, "schemeName": scheme["schemeName"], "plan": scheme["plan"], "assetClass": scheme["assetClass"],
                 "category": scheme["category"], "path": path, "lastDate": rows[-1][0].isoformat(), "lastNav": str(rows[-1][1]),
                 "rows": len(rows), "sha256": sha256(new_data), "updatedAt": now}
    if moved:
        flags.append(f"category changed: moved {entry['path']} -> {path}")
    return {"entry": new_entry, "added": added, "corrected": corrected, "recovered": recovered, "flags": flags}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="do not write to Supabase or data/schemes")
    parser.add_argument("--reconcile", action="store_true",
                        help="check every stored scheme against AMFI's NAVs in the window (not only new days)")
    args = parser.parse_args()
    started = time.monotonic()
    timings: dict[str, int] = {}
    errors: list[str] = []
    warnings: list[str] = []
    try:
        config = settings.load()
        client = StorageClient(settings.supabase(config))
        manifest = client.download_json(MANIFEST_PATH)
        if not manifest:
            raise StorageError(f"{MANIFEST_PATH} not found — run collect_nav_history.py first")

        # 1. fund lists
        text = download(settings.get("AMFI_NAV_URL", config))
        master_text = download(settings.get("AMFI_SCHEME_MASTER_URL", config))
        if args.dry_run:
            schemes, universe = build(text, master_text, read_lists(LISTS_DIR))
            check(schemes)
        else:
            schemes, universe = refresh_lists(client, text, master_text, verbose=False)
        as_of = date.fromisoformat(universe["dataAsOf"])
        by_code = {s["schemeCode"]: s for s in schemes}
        print(f"Fund lists: {universe['inUniverse']} schemes (active {universe['active']}) | AMFI data as of {as_of}")

        # 2. new NAVs for stored schemes
        stored = {e["schemeCode"]: e for e in manifest["files"]}
        floor = as_of - timedelta(days=MAX_GAP_DAYS)
        active_last = [date.fromisoformat(e["lastDate"]) for c, e in stored.items() if by_code.get(c, {}).get("active")]
        start = max(floor, min(active_last, default=as_of) + timedelta(days=1))
        points = gap_points(config, start, as_of, warnings) if start <= as_of else {}
        timings["amfiHistory"] = round(time.monotonic() - started)
        # AMFI's history report lags the daily file by a day or two: each scheme's latest NAV comes
        # from the daily file itself (the official latest NAV), as printed.
        for row in parse_nav_file(text):
            if row.nav is not None and row.scheme_code in by_code:
                points.setdefault(row.scheme_code, {})[row.nav_date] = row.nav_text
        print(f"AMFI NAVs {start} to {as_of} (history report + daily file): "
              f"{sum(len(p) for p in points.values())} NAVs for {len(points)} schemes")
        behind = [c for c, e in stored.items() if by_code.get(c, {}).get("active") and date.fromisoformat(e["lastDate"]) < floor]

        def needs_work(code):
            entry, wanted = stored[code], points.get(code, {})
            if args.reconcile and wanted:
                return True
            if by_code[code]["category"] != entry["category"] or "lastNav" not in entry:
                return True
            # Anything new, or AMFI's latest NAV disagreeing with the stored latest NAV.
            last = date.fromisoformat(entry["lastDate"])
            if any(day > last for day in wanted):
                return True
            try:
                published = parse_nav(wanted[last]) if last in wanted else None
            except HistoryRejected:
                return True  # let update_one record the flag
            return published is not None and not same_nav(Decimal(entry["lastNav"]), published)

        def work(code):
            try:
                return code, update_one(client, by_code[code], stored[code], points.get(code, {}), args.dry_run)
            except Exception as error:  # one scheme's problem must not stop the others
                return code, {"error": f"{error!r}"}

        added_total = corrected_total = recovered_total = 0
        flagged = []
        todo = [c for c in stored if c in by_code and needs_work(c)]
        print(f"Schemes to update: {len(todo)} of {len(stored)}")
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            for code, result in pool.map(work, todo):
                if "error" in result:
                    errors.append(f"{code}: {result['error']}")
                    continue
                stored[code] = result["entry"]
                added_total += result["added"]
                corrected_total += result["corrected"]
                recovered_total += 1 if result.get("recovered") else 0
                if result["flags"]:
                    flagged.append({"schemeCode": code, "schemeName": by_code[code]["schemeName"], "flags": result["flags"]})
        timings["updateFiles"] = round(time.monotonic() - started)

        # 3. schemes new to the lists: full history from MFAPI (skip ones the collection already rejected)
        previous = client.download_json(REPORT_PATH) or {}
        known_bad = {o["schemeCode"] for key in ("rejected", "noHistorySince2015") for o in previous.get(key, [])}
        new_schemes = [s for c, s in by_code.items() if c not in stored and c not in known_bad and s["active"]]
        ctx = {"client": client, "mfapi": settings.get("MFAPI_BASE_URL", config), "amfi": points, "as_of": as_of,
               "history_template": settings.get("AMFI_NAV_HISTORY_URL", config),
               "today": datetime.now(timezone.utc).date(), "pacer": Pacer(MIN_INTERVAL_SECONDS)}
        new_stored, new_rejected = [], []
        for scheme in new_schemes:
            if args.dry_run:
                new_stored.append(scheme["schemeCode"])
                continue
            outcome = collect_one(scheme, ctx)
            if outcome["status"] == "stored":
                stored[scheme["schemeCode"]] = {k: outcome.get(k) for k in MANIFEST_FIELDS}
                new_stored.append(scheme["schemeCode"])
            else:
                new_rejected.append({k: outcome.get(k) for k in ("schemeCode", "schemeName", "status", "reason")})

        # 4. manifest, latest NAVs, report
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        files = sorted(stored.values(), key=lambda e: e["path"])
        latest = {str(e["schemeCode"]): {"date": e["lastDate"], "nav": e["lastNav"]} for e in files if e.get("lastNav")}
        report = {
            "generatedAt": now, "amfiDataAsOf": as_of.isoformat(), "seconds": round(time.monotonic() - started),
            "navsAdded": added_total, "navsCorrectedToAmfi": corrected_total, "recoveredFromInterruptedRun": recovered_total, "secondsAfter": timings, "schemesStored": len(files), "schemesWithLatestNav": len(latest),
            "newSchemesStored": new_stored, "newSchemesNotStored": new_rejected,
            "activeSchemesTooFarBehind": behind, "errors": errors, "warnings": warnings, "flagged": flagged,
            "listsChanged": {k: universe[k] for k in ("inUniverse", "active", "carriedInactive", "excluded")},
        }
        if not args.dry_run:
            client.upload_json(MANIFEST_PATH, {
                "schemaVersion": SCHEMA_VERSION, "source": SOURCE + "; daily from AMFI NAV history report",
                "historyFrom": HISTORY_FROM.isoformat(), "amfiDataAsOf": as_of.isoformat(), "updatedAt": now,
                "count": len(files), "columns": manifest.get("columns"), "files": files,
            })
            client.upload_json(LATEST_PATH, {"asOf": as_of.isoformat(), "generatedAt": now, "count": len(latest), "navs": latest})
            client.upload_json(f"reports/daily/{as_of.isoformat()}.json", report)
            client.upload_json("reports/daily-latest.json", report)
    except (StorageError, ListError, UnknownSectionError, settings.SettingsError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(f"NAVs added {added_total} | corrected to AMFI {corrected_total} | recovered from an interrupted run {recovered_total} | schemes stored {len(files)} | latest NAV for {len(latest)} | new schemes "
          f"{len(new_stored)} | errors {len(errors)} | flagged {len(flagged)} | {report['seconds']} s"
          + (" | DRY RUN (nothing written)" if args.dry_run else ""))
    for line in errors[:20]:
        print("  ERROR " + line)
    for line in warnings:
        print("  WARNING " + line)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
