"""One-time collection of daily NAV history (from 2015) for every scheme, straight into Supabase.

Usage:
    python data-pipeline/collect_nav_history.py --check          # test .env, the key and the bucket
    python data-pipeline/collect_nav_history.py --limit 10       # a trial on the first 10 schemes
    python data-pipeline/collect_nav_history.py                  # all schemes (resumes where it stopped)
    python data-pipeline/collect_nav_history.py --codes 122639 100119
    python data-pipeline/collect_nav_history.py --refresh        # collect again even if already stored
    python data-pipeline/collect_nav_history.py --verify         # download every file and compare SHA-256

Input:  data/schemes/ lists, MFAPI.in history per scheme, AMFI's NAV history report (check windows),
        .env (settings.py).
Output (bucket SUPABASE_BUCKET, nothing stored locally):
          nav/<plan>/<asset class>/<category>/<code>.parquet   checked, built in memory, read back, uploaded
          nav/manifest.json             every stored file: path, first/last date, rows, SHA-256 —
                                        saved every 200 schemes and at the end (the resume point)
          reports/nav-collection-latest.json   rejected, flagged and not-cross-checked schemes

When MFAPI's history disagrees with AMFI (or cannot be downloaded), the scheme's history is taken from
AMFI's own NAV history report instead (amfi_fallback) and must pass the same checks.

Guarantees: a scheme is stored only when every check in nav_history.validate_history passes; a
rejected or failed scheme is reported with its reason and tried again on the next run; the manifest
lists only files that are already in the bucket; nothing is estimated.
"""

from __future__ import annotations

import argparse
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import settings  # noqa: E402
from amfi_source import (  # noqa: E402
    download, find_amc_id, nav_history_url, parse_nav_file, parse_nav_history, scheme_history_from_amfi,
)
from mfapi_source import MfapiError, fetch_history  # noqa: E402
from nav_history import (  # noqa: E402
    HISTORY_FROM, MANIFEST_PATH, SCHEMA_VERSION, SOURCE, check_layout, from_parquet, object_path, sha256,
    to_parquet, validate_history,
)
from scheme_lists import read_lists  # noqa: E402
from supabase_storage import PARQUET_TYPE, StorageClient, StorageError  # noqa: E402

REPORT_PATH = "reports/nav-collection-latest.json"
WORKERS = 3
MIN_INTERVAL_SECONDS = 0.35   # at most ~3 MFAPI requests per second across all workers (a free API)
LATEST_WINDOW_DAYS = 9        # latest check window: AMFI's last ~week of NAVs (MFAPI may lag a day)
CHECKPOINT_EVERY = 200


class Pacer:
    """Spaces requests at least `interval` seconds apart across threads."""
    def __init__(self, interval: float):
        self.interval, self.lock, self.next_at = interval, threading.Lock(), 0.0

    def wait(self) -> None:
        with self.lock:
            now = time.monotonic()
            start = max(now, self.next_at)
            self.next_at = start + self.interval
        time.sleep(max(0.0, start - now))


def amfi_check_points(config: dict) -> tuple[date, dict[int, dict[date, str]]]:
    """AMFI's own NAVs for every scheme over the check windows: {code: {date: NAV as printed}}."""
    as_of = max(r.nav_date for r in parse_nav_file(download(settings.get("AMFI_NAV_URL", config))))
    template = settings.get("AMFI_NAV_HISTORY_URL", config)
    windows = [(date(2015, 6, 22), date(2015, 6, 30)), (date(2020, 12, 21), date(2020, 12, 31)),
               (as_of - timedelta(days=LATEST_WINDOW_DAYS), as_of)]
    points: dict[int, dict[date, str]] = {}
    for start, end in windows:
        found = parse_nav_history(download(nav_history_url(template, start, end)))
        if not found:
            raise SystemExit(f"AMFI's NAV history report for {start} to {end} came back empty — stopping")
        for (code, day), nav in found.items():
            points.setdefault(code, {})[day] = nav
        print(f"  AMFI check window {start} to {end}: {len(found)} NAVs")
    return as_of, points


def collect_one(scheme: dict, ctx: dict) -> dict:
    """Fetch, check, build and upload one scheme. Returns its outcome (never raises for data problems)."""
    code = scheme["schemeCode"]
    base = {"schemeCode": code, "schemeName": scheme["schemeName"], "plan": scheme["plan"],
            "assetClass": scheme["assetClass"], "category": scheme["category"]}
    ctx["pacer"].wait()
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    source = SOURCE
    try:
        payload = fetch_history(ctx["mfapi"], code)
        checked = validate_history(scheme, payload, ctx["amfi"].get(code, {}), ctx["as_of"], ctx["today"])
        problem = None if checked.ok else checked.reason
    except MfapiError as error:
        problem = f"MFAPI download failed: {error}"
    if problem:
        # MFAPI disagrees with AMFI (or has nothing): take the scheme's history from AMFI's own report.
        fallback = amfi_fallback(scheme, ctx)
        if fallback is None or not fallback.ok:
            reason = problem if fallback is None else f"{problem}; AMFI history also failed: {fallback.reason}"
            return {**base, "status": "rejected", "reason": reason, "flags": [] if fallback is None else fallback.flags}
        checked, source = fallback, AMFI_SOURCE
        checked.flags.insert(0, f"history taken from AMFI's NAV history report because {problem}")
    if not checked.rows:
        return {**base, "status": "no-history", "flags": checked.flags}
    data = to_parquet(checked.rows, scheme, fetched_at, source=source)
    path = object_path(scheme)
    ctx["client"].upload(path, data, PARQUET_TYPE)
    return {**base, "status": "stored", "path": path, "rows": len(checked.rows),
            "firstDate": checked.rows[0][0].isoformat(), "lastDate": checked.rows[-1][0].isoformat(),
            "lastNav": str(from_parquet(data)[-1][1]), "sha256": sha256(data), "verifiedWithAmfi": checked.verified, "flags": checked.flags, "fetchedAt": fetched_at}


AMFI_SOURCE = "AMFI NAV history report"


def amfi_fallback(scheme: dict, ctx: dict):
    """The scheme's full history (from HISTORY_FROM) from AMFI's report, through the same checks.
    None when AMFI's fund-house id for the scheme cannot be found."""
    code = scheme["schemeCode"]
    template = ctx["history_template"]
    recent = max(ctx["amfi"].get(code, {}) or [ctx["as_of"]])
    amc_id = find_amc_id(template, code, recent)
    if amc_id is None:
        return None
    points = scheme_history_from_amfi(template, amc_id, code, HISTORY_FROM, ctx["as_of"])
    payload = {"status": "SUCCESS", "meta": {"scheme_code": str(code), "isin_growth": scheme.get("isin"),
                                             "isin_div_reinvestment": scheme.get("isinReinvest")},
               "data": [{"date": d.strftime("%d-%m-%Y"), "nav": nav} for d, nav in sorted(points.items(), reverse=True)]}
    # No cross-check here: the data IS AMFI's; every other check applies unchanged.
    checked = validate_history(scheme, payload, {}, ctx["as_of"], ctx["today"])
    checked.flags = [f for f in checked.flags if "not cross-checked" not in f]
    return checked


MANIFEST_FIELDS = ("schemeCode", "schemeName", "plan", "assetClass", "category", "path", "firstDate", "lastDate",
                   "lastNav", "rows", "sha256", "verifiedWithAmfi", "fetchedAt", "updatedAt")


def save_progress(client: StorageClient, stored: dict[int, dict], outcomes: dict[int, dict], as_of: date) -> dict:
    """Manifest = stored files only (uploaded first); report = every outcome so far."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    files = sorted((stored[c] for c in stored), key=lambda e: e["path"])
    client.upload_json(MANIFEST_PATH, {
        "schemaVersion": SCHEMA_VERSION, "source": SOURCE, "historyFrom": HISTORY_FROM.isoformat(),
        "amfiDataAsOf": as_of.isoformat(), "updatedAt": now, "count": len(files),
        "columns": {"date": "date32", "nav": "decimal128(24,6)"},
        "files": [{k: e.get(k) for k in MANIFEST_FIELDS} for e in files],
    })
    by_status = lambda s: [o for o in outcomes.values() if o["status"] == s]  # noqa: E731
    report = {
        "updatedAt": now, "stored": len(files), "amfiCheckedPoints": sum(e.get("verifiedWithAmfi", 0) for e in files),
        "rejected": by_status("rejected"), "failed": by_status("failed"), "noHistorySince2015": by_status("no-history"),
        "notCrossChecked": [e["schemeCode"] for e in files if not e.get("verifiedWithAmfi")],
        "flagged": [{"schemeCode": e["schemeCode"], "schemeName": e["schemeName"], "flags": e["flags"]}
                    for e in outcomes.values() if e["status"] == "stored" and e.get("flags")],
    }
    client.upload_json(REPORT_PATH, report)
    return report


def verify(client: StorageClient) -> int:
    manifest = client.download_json(MANIFEST_PATH)
    if not manifest:
        print("No manifest in the bucket yet.")
        return 1

    def check(entry):
        data = client.download(entry["path"])
        if data is None:
            return f"{entry['path']}: missing"
        if sha256(data) != entry["sha256"]:
            return f"{entry['path']}: content differs from the manifest"
        rows = from_parquet(data)
        if len(rows) != entry["rows"] or rows[0][0].isoformat() != entry["firstDate"] or rows[-1][0].isoformat() != entry["lastDate"]:
            return f"{entry['path']}: rows or dates differ from the manifest"
        return None

    with ThreadPoolExecutor(max_workers=6) as pool:
        problems = [p for p in pool.map(check, manifest["files"]) if p]
    if problems:
        print(f"VERIFY FAILED for {len(problems)} of {len(manifest['files'])} files:")
        for line in problems[:50]:
            print("  " + line)
        return 1
    print(f"Verified: all {len(manifest['files'])} files in the bucket match the manifest exactly (SHA-256, rows, dates).")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="only test .env, the key and the bucket")
    parser.add_argument("--verify", action="store_true", help="only verify the bucket against its manifest")
    parser.add_argument("--limit", type=int, help="only the first N schemes (trial run)")
    parser.add_argument("--codes", type=int, nargs="+", help="only these scheme codes")
    parser.add_argument("--refresh", action="store_true", help="collect again even if already stored")
    args = parser.parse_args()

    try:
        config = settings.load()
        client = StorageClient(settings.supabase(config))
        print(f"Bucket '{client.bucket}': {client.ensure_bucket()} (private)")
        if args.check:
            return 0
        if args.verify:
            return verify(client)

        schemes = read_lists()
        check_layout(schemes)
        selected = [s for s in schemes if not args.codes or s["schemeCode"] in set(args.codes)]
        if args.limit:
            selected = selected[: args.limit]
        manifest = client.download_json(MANIFEST_PATH) or {"files": []}
        previous = client.download_json(REPORT_PATH) or {}
        stored = {e["schemeCode"]: e for e in manifest["files"]}
        outcomes = {o["schemeCode"]: o for key in ("rejected", "failed", "noHistorySince2015") for o in previous.get(key, [])}
        outcomes.update({e["schemeCode"]: {**e, "status": "stored", "flags": next(
            (f["flags"] for f in previous.get("flagged", []) if f["schemeCode"] == e["schemeCode"]), [])} for e in stored.values()})
        done = {c for c, o in outcomes.items() if o["status"] in ("stored", "no-history")}
        todo = [s for s in selected if args.refresh or s["schemeCode"] not in done]
        print(f"{len(schemes)} schemes in the lists | selected {len(selected)} | already stored {len(stored)} | to collect {len(todo)}")

        as_of, amfi = amfi_check_points(config)
        ctx = {"client": client, "mfapi": settings.get("MFAPI_BASE_URL", config), "amfi": amfi, "as_of": as_of,
               "history_template": settings.get("AMFI_NAV_HISTORY_URL", config),
               "today": datetime.now(timezone.utc).date(), "pacer": Pacer(MIN_INTERVAL_SECONDS)}
        started = time.monotonic()
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(collect_one, s, ctx): s for s in todo}
            for count, future in enumerate(as_completed(futures), start=1):
                scheme = futures[future]
                try:
                    outcome = future.result()
                except Exception as error:  # an unexpected problem must not lose the others' work
                    outcome = {"schemeCode": scheme["schemeCode"], "schemeName": scheme["schemeName"],
                               "plan": scheme["plan"], "status": "failed", "reason": f"unexpected error: {error!r}"}
                outcomes[outcome["schemeCode"]] = outcome
                if outcome["status"] == "stored":
                    stored[outcome["schemeCode"]] = outcome
                else:
                    stored.pop(outcome["schemeCode"], None)
                if count % CHECKPOINT_EVERY == 0:
                    save_progress(client, stored, outcomes, as_of)
                    print(f"  {count}/{len(todo)} done ({time.monotonic() - started:.0f} s) — progress saved", flush=True)
        report = save_progress(client, stored, outcomes, as_of)
    except (StorageError, settings.SettingsError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(f"\nStored {report['stored']} of {len(schemes)} schemes | no NAV since {HISTORY_FROM.isoformat()}: "
          f"{len(report['noHistorySince2015'])} | rejected: {len(report['rejected'])} | failed (retried next run): "
          f"{len(report['failed'])} | flagged: {len(report['flagged'])}")
    print(f"Cross-checked against AMFI's own history: {report['amfiCheckedPoints']} NAVs agree | "
          f"stored files with no common check date: {len(report['notCrossChecked'])}")
    for item in report["rejected"][:25]:
        print(f"  REJECTED {item['schemeCode']} {item.get('schemeName') or ''}: {item['reason']}")
    print(f"Full report in the bucket: {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
