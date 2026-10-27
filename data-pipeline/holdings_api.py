"""Fund holdings for the website (called by the local server for GET /api/fund-holdings?isins=…).

Usage (by serve.ps1):  python data-pipeline/holdings_api.py INF879O01027 INF846K01EW2 …
Output (stdout, JSON): { "funds": { "<isin>": { "asOn": "YYYY-MM", "holdings": [{ name, isin, assetType, sector, marketCap,
                                    weight }], "unresolved": [...] } }, "missing": [isins without holdings] }
That is the engine's holdings contract (MF_Calculation_Engine.md E15.5.12): rows classified by
pulse_source.classify, fund-of-funds looked through to their underlying holdings.

Holdings are fetched from PulseDB and kept in Supabase (holdings/<scheme code>.json) for CACHE_HOURS, so
repeated uploads do not call Pulse again; funds publish holdings monthly. Keys stay on the server (.env).
"""

from __future__ import annotations

import json
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import settings  # noqa: E402
from pulse_source import PulseClient, look_through, normalise  # noqa: E402
from scheme_lists import read_lists  # noqa: E402
from supabase_storage import StorageClient  # noqa: E402

MAX_ISINS = 80
CACHE_HOURS = 24
ISIN_RE = re.compile(r"^IN[A-Z0-9]{9}[0-9]$")


def main(argv: list[str]) -> int:
    isins = sorted({a.strip().upper() for a in argv})
    if not isins or len(isins) > MAX_ISINS or not all(ISIN_RE.match(i) for i in isins):
        print(json.dumps({"error": "bad ISIN list"}))
        return 2
    config = settings.load()
    by_isin = {}
    for scheme in read_lists():
        for isin in (scheme["isin"], scheme["isinReinvest"]):
            if isin:
                by_isin[isin] = scheme
    storage = StorageClient(settings.supabase(config))
    pulse = PulseClient(settings.get("PULSE_BASE_URL", config), settings.get("PULSE_PARTNER", config), settings.get("PULSE_KEY", config))
    login_lock = threading.Lock()
    now = datetime.now(timezone.utc)

    def pulse_holdings(code: int) -> list[dict]:
        with login_lock:   # signed in only when a fund actually needs PulseDB (all cached → Pulse not needed)
            if not pulse.auth:
                pulse.login()
        return pulse.holdings(code)

    def raw_holdings(code: int) -> dict:
        """{asOn, rows} for a scheme code — Supabase cache first, PulseDB when stale or missing. When PulseDB cannot
        be reached, an older cached copy is used (funds publish holdings monthly) rather than nothing."""
        path = f"holdings/{code}.json"
        cached = storage.download_json(path)
        if cached and now - datetime.fromisoformat(cached["fetchedAt"]) < timedelta(hours=CACHE_HOURS):
            return cached
        try:
            rows = pulse_holdings(code)
        except Exception:
            if cached:
                return cached
            raise
        entry = {"schemeCode": code, "fetchedAt": now.isoformat(timespec="seconds"),
                 "asOn": max((r.get("as_on_date") or "" for r in rows), default="") or None, "rows": rows}
        storage.upload_json(path, entry)
        return entry

    def normalised_for_isin(isin: str):
        scheme = by_isin.get(isin)
        if not scheme:
            return None
        entry = raw_holdings(scheme["schemeCode"])
        return normalise(entry["rows"]) or None, entry["asOn"]

    def one(isin: str):
        # One fund's problem (a PulseDB hiccup, an odd file) must not take the other funds' holdings with it.
        try:
            found = normalised_for_isin(isin)
            if not found or not found[0]:
                return isin, None
            rows, as_on = found
            flat, unresolved = look_through(rows, lambda inner: (normalised_for_isin(inner) or (None,))[0])
            return isin, {"asOn": as_on, "holdings": flat, "unresolved": unresolved}
        except Exception:
            return isin, None

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = dict(pool.map(one, isins))
    out = {"funds": {isin: value for isin, value in results.items() if value},
           "missing": [isin for isin, value in results.items() if not value]}
    sys.stdout.write(json.dumps(out, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
